using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Client_app.Services;
using Npgsql;
using Client_app.Models;
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Mail;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Security.Cryptography;
using ClosedXML.Excel;


namespace Client_app.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly string _connectionString;
        private readonly IMemoryCache _cache;
        private readonly IConfiguration _configuration;
        private readonly IEmailService _emailService;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<AuthController> _logger;

        public AuthController(IConfiguration configuration, IMemoryCache memoryCache, IEmailService emailService, IHttpClientFactory httpClientFactory, ILogger<AuthController> logger)
        {
            _connectionString = configuration.GetConnectionString("PostgresConnection") ?? throw new InvalidOperationException("PostgreSQL connection string 'PostgresConnection' not found.");
            _cache = memoryCache;
            _configuration = configuration;
            _emailService = emailService;
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        [HttpPost("send-verification")]
        public async Task<IActionResult> SendVerificationCode([FromBody] VerificationRequest request)
        {
            if (string.IsNullOrEmpty(request.Email))
            {
                return BadRequest(new { status = "Error", message = "Email is required." });
            }

            try
            {
                var normalizedEmail = request.Email.Trim().ToLower();

                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                using (var checkCmd = new NpgsqlCommand("SELECT COUNT(1) FROM Users WHERE email = @email", conn))
                {
                    checkCmd.Parameters.AddWithValue("email", normalizedEmail);
                    long userCount = (long)(await checkCmd.ExecuteScalarAsync() ?? 0);
                    if (userCount > 0)
                    {
                        return BadRequest(new { status = "Error", message = "An account with this email already exists or is currently pending approval." });
                    }
                }

                var verificationCode = RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
                var cacheKey = $"verification_{normalizedEmail}";
                _cache.Set(cacheKey, verificationCode, TimeSpan.FromMinutes(10));

                var subject = "Your PLV Account Verification Code";
                var content = $"<p>Hello,</p><p>Thank you for registering. Please use the following verification code to complete your signup process. The code is valid for 10 minutes.</p><p style='font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 5px; margin: 20px 0;'>{verificationCode}</p><p>If you did not request this, please ignore this email.</p>";
                var htmlBody = CreateHtmlEmail(subject, content);

                await _emailService.SendEmailAsync(normalizedEmail, subject, htmlBody, true);

                return Ok(new { status = "Success", message = "Verification code sent to your email." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = $"Failed to process request: {ex.Message}" });
            }
        }

        [HttpPost("request")]
        public async Task<IActionResult> RequestAccess([FromBody] SignupRequest request)
        {
            if (string.IsNullOrEmpty(request.Email))
            {
                return BadRequest(new { status = "Error", message = "Email is required." });
            }

            var normalizedEmail = request.Email.Trim().ToLower();
            var inputCode = request.VerificationCode?.Trim();

            // 1. Verify Code
            if (!_cache.TryGetValue($"verification_{normalizedEmail}", out string? cachedCode) || cachedCode != inputCode)
            {
                return BadRequest(new { status = "Error", message = "The verification code is incorrect or has expired. Please try again." });
            }
            _cache.Remove($"verification_{normalizedEmail}");

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                // Check if user already exists before proceeding
                using (var checkCmd = new NpgsqlCommand("SELECT COUNT(1) FROM Users WHERE email = @email", conn))
                {
                    checkCmd.Parameters.AddWithValue("email", normalizedEmail);
                    long userCount = (long)(await checkCmd.ExecuteScalarAsync() ?? 0);
                    if (userCount > 0)
                    {
                        return BadRequest(new { status = "Error", message = "An account with this email already exists or is currently pending approval." });
                    }
                }

                using var transaction = await conn.BeginTransactionAsync();

                DateTime? parsedDob = null;
                if (request.Role?.ToLower() == "student" && !string.IsNullOrEmpty(request.DateOfBirth))
                {
                    string[] formats = { "MM/dd/yyyy", "M/d/yyyy", "MM/d/yyyy", "M/dd/yyyy", "yyyy-MM-dd" };
                    if (DateTime.TryParseExact(request.DateOfBirth, formats, null, System.Globalization.DateTimeStyles.None, out DateTime dob))
                    {
                        parsedDob = dob;
                        request.DateOfBirth = dob.ToString("MM/dd/yyyy");
                    }
                    else
                    {
                        return BadRequest(new { status = "Error", message = "Invalid DOB format. Use mm/dd/yyyy." });
                    }
                }

                string finalPassword = request.Role?.ToLower() == "student" ? 
                    request.DateOfBirth ?? request.Password : 
                    request.Password;
                
                if (string.IsNullOrEmpty(finalPassword))
                {
                    return BadRequest(new { status = "Error", message = request.Role?.ToLower() == "student" ? 
                        "Date of birth (mm/dd/yyyy) is required for students." : "Password is required." });
                }

                // Request password hash from Node.js Middleware
                using var client = _httpClientFactory.CreateClient();
                var apiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
                client.DefaultRequestHeaders.Add("x-api-key", apiKey);
                var hashPayload = new { password = finalPassword };
                var hashContent = new StringContent(JsonSerializer.Serialize(hashPayload), Encoding.UTF8, "application/json");
                var middlewareUrl = _configuration["Middleware:Url"] ?? _configuration["MIDDLEWARE_URL"] ?? "http://127.0.0.1:4000";
                var hashResponse = await client.PostAsync($"{middlewareUrl}/api/crypto/hash-password", hashContent);
                
                if (!hashResponse.IsSuccessStatusCode) {
                    await transaction.RollbackAsync();
                    return StatusCode(500, new { status = "Error", message = "Failed to secure password via middleware." });
                }
                
                var hashResultStr = await hashResponse.Content.ReadAsStringAsync();
                using var hashDoc = JsonDocument.Parse(hashResultStr);
                string passwordHash = hashDoc.RootElement.GetProperty("hash").GetString() ?? throw new Exception("Failed to parse hash");

                // 1. Insert into base Users table
                using var cmdUser = new NpgsqlCommand(@"
                    INSERT INTO Users (email, password_hash, role, status) 
                    VALUES (@email, @hash, @role, 'pending') RETURNING id", conn, transaction);
                cmdUser.Parameters.AddWithValue("email", normalizedEmail);
                cmdUser.Parameters.AddWithValue("hash", passwordHash);
                cmdUser.Parameters.AddWithValue("role", request.Role?.ToLower() ?? "student");
                
                int userId = (int)(await cmdUser.ExecuteScalarAsync() ?? throw new Exception("Failed to retrieve new User ID"));

                string profileQuery = "";
                if (request.Role?.ToLower() == "student")
                {
                    profileQuery = @"INSERT INTO StudentProfiles (user_id, full_name, student_no, department, date_of_birth) 
                                   VALUES (@uid, @name, @studentno, @dept, @dob)";
                }
                else if (request.Role?.ToLower() == "faculty")
                {
                    profileQuery = "INSERT INTO FacultyProfiles (user_id, full_name, department) VALUES (@uid, @name, @dept)";
                }
                else 
                {
                    profileQuery = "INSERT INTO AdminProfiles (user_id, full_name, admin_level, department) VALUES (@uid, @name, @role, @dept)";
                }

                using var cmdProfile = new NpgsqlCommand(profileQuery, conn, transaction);
                cmdProfile.Parameters.AddWithValue("uid", userId);
                cmdProfile.Parameters.AddWithValue("name", request.FullName);
                cmdProfile.Parameters.AddWithValue("dept", (object?)request.Department ?? DBNull.Value);
                cmdProfile.Parameters.AddWithValue("role", request.Role ?? "");
                
                if (request.Role?.ToLower() == "student") 
                {
                    cmdProfile.Parameters.AddWithValue("studentno", (object?)request.StudentNo ?? DBNull.Value);
                    if (parsedDob.HasValue)
                    {
                        cmdProfile.Parameters.AddWithValue("dob", parsedDob.Value.Date);
                    }
                }

                await cmdProfile.ExecuteNonQueryAsync();
                await transaction.CommitAsync();

                // Send DOB password info to student email
                if (request.Role?.ToLower() == "student")
                {
                    var subject = "Your PLV Account - Default Password Info";
                    var content = $@"<p>Hello {request.FullName},</p>
                                   <p>Your account default password is your Date of Birth: <strong>{finalPassword}</strong></p>
                                   <p>You can change it after first login. Await registrar approval.</p>";
                    var htmlBody = CreateHtmlEmail(subject, content);
                    await _emailService.SendEmailAsync(normalizedEmail, subject, htmlBody, true);
                }

                // --- CACHE INVALIDATION ---
                _cache.Remove("pending_requests");

                return Ok(new { status = "Success", message = $"Registration request added. {(request.Role?.ToLower() == "student" ? $"Default password: {finalPassword} (will be emailed)" : "Password secured.")}" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = $"Registration failed: {ex.Message}" });
            }
        }

        [HttpGet("requests/pending")]
        public async Task<IActionResult> GetPendingRequests()
        {
            const string cacheKey = "pending_requests";
            if (_cache.TryGetValue(cacheKey, out object? cachedData) && cachedData != null)
            {
                return Ok(cachedData);
            }

            using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();

            var studentRequests = new List<object>();
            var staffRequests = new List<object>();

            // Fetch Student Requests using JOIN
            using (var cmd = new NpgsqlCommand(@"
                    SELECT u.id, sp.full_name, u.email, u.role, sp.department, sp.student_no, u.status 
                    FROM Users u JOIN StudentProfiles sp ON u.id = sp.user_id 
                    WHERE u.role = 'student' AND u.status = 'pending'", conn))
            using (var reader = await cmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    studentRequests.Add(new {
                        requestid = reader.GetInt32(0),
                        fullname = reader.GetString(1),
                        email = reader.GetString(2),
                        role = reader.GetString(3),
                        department = reader.IsDBNull(4) ? null : reader.GetString(4),
                        studentno = reader.GetString(5),
                        requeststatus = reader.GetString(6)
                    });
                }
            }

            // Fetch Staff/Faculty Requests using UNION
            using (var cmd = new NpgsqlCommand(@"
                    SELECT u.id, fp.full_name, u.email, u.role, fp.department, u.status 
                    FROM Users u JOIN FacultyProfiles fp ON u.id = fp.user_id 
                    WHERE u.role = 'faculty' AND u.status = 'pending'
                    UNION
                    SELECT u.id, ap.full_name, u.email, u.role, ap.department, u.status 
                    FROM Users u JOIN AdminProfiles ap ON u.id = ap.user_id 
                    WHERE u.role IN ('registrar', 'department_admin') AND u.status = 'pending'", conn))
            using (var reader = await cmd.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync())
                {
                    staffRequests.Add(new {
                        requestid = reader.GetInt32(0),
                        fullname = reader.GetString(1),
                        email = reader.GetString(2),
                        role = reader.IsDBNull(3) ? null : reader.GetString(3),
                        department = reader.IsDBNull(4) ? null : reader.GetString(4),
                        requeststatus = reader.GetString(5)
                    });
                }
            }

            var response = new { status = "Success", studentRequests, staffRequests };
            var cacheEntryOptions = new MemoryCacheEntryOptions().SetSlidingExpiration(TimeSpan.FromMinutes(5));
            _cache.Set(cacheKey, response, cacheEntryOptions);

            return Ok(response);
        }

        [HttpPut("requests/approve/{type}/{id}")]
        public async Task<IActionResult> ApproveRequest(string type, int id)
        {
            using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();
            using var transaction = await conn.BeginTransactionAsync();

            string query = "UPDATE Users SET status = 'APPROVED' WHERE id = @id AND status = 'pending' RETURNING email, role";

            using var cmd = new NpgsqlCommand(query, conn, transaction);
            cmd.Parameters.AddWithValue("id", id); 
            
            using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
            {
                return NotFound(new { status = "Error", message = "Registration request not found or already approved." });
            }
            
            string userEmail = reader.GetString(0) ?? "";
            string userRole = reader.GetString(1) ?? "";
            await reader.CloseAsync(); // MUST close the reader before committing or rolling back the transaction

            // Trigger the Node.js Middleware to Generate the Blockchain Wallet
            using var client = _httpClientFactory.CreateClient("FabricCAClient");
            var apiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
            client.DefaultRequestHeaders.Add("x-api-key", apiKey);

            var payload = new { email = userEmail, role = userRole };
            var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
            
            // Call the internal Fabric Gateway
            var middlewareUrl = _configuration["Middleware:Url"] ?? _configuration["MIDDLEWARE_URL"] ?? "http://127.0.0.1:4000";
            var response = await client.PostAsync($"{middlewareUrl}/api/fabric/register-user", content);
            
            if (!response.IsSuccessStatusCode) {
                await transaction.RollbackAsync();
                string errorBody = await response.Content.ReadAsStringAsync();
                return StatusCode(500, new { status = "Error", message = $"Blockchain Wallet failed to create. Database changes rolled back. Middleware Error: {errorBody}" });
            }

            await transaction.CommitAsync();

            var emailSubject = "PLV System Access Approved";
            var emailContent = $"<p>Hello,</p><p>Your registration request for the role '<strong>{userRole}</strong>' has been approved. You can now log in to the system.</p>";
            _ = _emailService.SendEmailAsync(userEmail, emailSubject, CreateHtmlEmail(emailSubject, emailContent), true);

            // --- CACHE INVALIDATION ---
            _cache.Remove("pending_requests");
            if (userRole == "student") _cache.Remove("approved_students");
            else if (userRole == "faculty") _cache.Remove("approved_faculties");
            else if (userRole == "department_admin") _cache.Remove("approved_department_admins");

            return Ok(new { status = "Success", message = "Request approved and Fabric Wallet created successfully." });
        }

        [HttpDelete("requests/deny/{id}")]
        public async Task<IActionResult> DenyRequest(int id)
        {
            using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();

            // Find the user to get their email before deleting
            using var findCmd = new NpgsqlCommand("SELECT email, role FROM Users WHERE id = @id AND status = 'pending'", conn);
            findCmd.Parameters.AddWithValue("id", id);
            using var reader = await findCmd.ExecuteReaderAsync();

            if (!await reader.ReadAsync())
            {
                return NotFound(new { status = "Error", message = "Request not found or already actioned." });
            }
            string userEmail = reader.GetString(0);
            string userRole = reader.GetString(1);
            await reader.CloseAsync(); // Close the reader before executing another command

            // Now, delete the user. Associated profiles should be deleted by cascading constraints.
            using var deleteCmd = new NpgsqlCommand("DELETE FROM Users WHERE id = @id", conn);
            deleteCmd.Parameters.AddWithValue("id", id);
            await deleteCmd.ExecuteNonQueryAsync();

            var emailSubject = "PLV System Access Update";
            var emailContent = $"<p>Hello,</p><p>We regret to inform you that your registration request for the role '<strong>{userRole}</strong>' has been denied by the administration.</p>";
            _ = _emailService.SendEmailAsync(userEmail, emailSubject, CreateHtmlEmail(emailSubject, emailContent), true);

            _cache.Remove("pending_requests");
            return Ok(new { status = "Success", message = "Request denied and removed." });
        }

        [HttpDelete("requests/cleanup-pending")]
        public async Task<IActionResult> CleanupPendingRequests()
        {
            var requestApiKey = Request.Headers["x-api-key"].ToString();
            var configuredApiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
            if (requestApiKey != configuredApiKey)
            {
                return StatusCode(403, new { status = "Error", message = "Unauthorized. Invalid Internal API Key." });
            }

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                
                // Deletes pending users created more than 30 days ago
                using var cmd = new NpgsqlCommand("DELETE FROM Users WHERE status = 'pending' AND created_at < NOW() - INTERVAL '30 days'", conn);
                int deletedCount = await cmd.ExecuteNonQueryAsync();

                _cache.Remove("pending_requests");

                return Ok(new { status = "Success", message = $"Successfully cleaned up {deletedCount} orphaned pending requests." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = $"Database error: {ex.Message}" });
            }
        }

        [HttpGet("students/approved")]
        public async Task<IActionResult> GetApprovedStudents()
        {
            const string cacheKey = "approved_students";
            if (_cache.TryGetValue(cacheKey, out object? cachedData) && cachedData != null)
            {
                return Ok(cachedData);
            }

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var students = new List<object>();

                // Fetch Approved Students
                using (var cmd = new NpgsqlCommand(@"
                    SELECT u.id, sp.full_name, u.email, sp.department, sp.student_no, sp.section, sp.assignment_status 
                    FROM Users u JOIN StudentProfiles sp ON u.id = sp.user_id 
                    WHERE u.role = 'student' AND u.status = 'APPROVED'", conn))
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                    {
                        students.Add(new {
                            id = reader.GetInt32(0),
                            fullname = reader.GetString(1),
                            email = reader.GetString(2),
                            department = reader.IsDBNull(3) ? null : reader.GetString(3),
                            studentno = reader.IsDBNull(4) ? null : reader.GetString(4),
                            section = reader.IsDBNull(5) ? null : reader.GetString(5),
                            assignmentStatus = reader.IsDBNull(6) ? "Unassigned" : reader.GetString(6)
                        });
                    }
                }

                var response = new { status = "Success", students };
                var cacheEntryOptions = new MemoryCacheEntryOptions().SetSlidingExpiration(TimeSpan.FromMinutes(5));
                _cache.Set(cacheKey, response, cacheEntryOptions);

                return Ok(response);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPut("students/{id}/assign")]
        public async Task<IActionResult> AssignStudent(int id, [FromBody] AssignStudentRequest request)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                // Fetch user info for email notification
                string userEmail = "", userName = "Student";
                using (var cmdEmail = new NpgsqlCommand("SELECT u.email, sp.full_name FROM Users u JOIN StudentProfiles sp ON u.id = sp.user_id WHERE u.id = @id", conn))
                {
                    cmdEmail.Parameters.AddWithValue("id", id); 
                    using var reader = await cmdEmail.ExecuteReaderAsync();
                    if (await reader.ReadAsync())
                    {
                        userEmail = reader.GetString(0);
                        userName = reader.GetString(1);
                    }
                }

                string query = "UPDATE StudentProfiles SET department = @dept, section = @section, assignment_status = 'Pending Department Approval' WHERE user_id = @id";
                using var cmd = new NpgsqlCommand(query, conn);
                cmd.Parameters.AddWithValue("dept", request.Department?.Trim());
                cmd.Parameters.AddWithValue("section", request.Section?.Trim());
                cmd.Parameters.AddWithValue("id", id);
                
                int rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0) return NotFound(new { status = "Error", message = "Student profile not found." });

                var emailSubject = "PLV Enrollment Update: Department Assignment";
                var emailContent = $"<p>Hello {userName},</p><p>The Registrar has assigned you to the <strong>{request.Department}</strong> department, section <strong>{request.Section}</strong>. Your enrollment is now pending final approval from the department head.</p>";
                _ = _emailService.SendEmailAsync(userEmail, emailSubject, CreateHtmlEmail(emailSubject, emailContent), true);

                // --- CACHE INVALIDATION ---
                _cache.Remove("approved_students");

                return Ok(new { status = "Success", message = "Student assigned. Awaiting department/faculty approval." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpDelete("students/{id}/drop")]
        public async Task<IActionResult> DropStudent(int id)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                using var findCmd = new NpgsqlCommand("SELECT email, role FROM Users WHERE id = @id AND role = 'student'", conn);
                findCmd.Parameters.AddWithValue("id", id);
                using var reader = await findCmd.ExecuteReaderAsync();

                if (!await reader.ReadAsync())
                {
                    return NotFound(new { status = "Error", message = "Student not found." });
                }
                string userEmail = reader.GetString(0);
                string userRole = reader.GetString(1);
                await reader.CloseAsync();

                // Request Middleware to Revoke Blockchain Identity
                using var client = _httpClientFactory.CreateClient("FabricCAClient");
                var apiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
                client.DefaultRequestHeaders.Add("x-api-key", apiKey);

                var payload = new { username = userEmail, role = userRole };
                var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                var middlewareUrl = _configuration["Middleware:Url"] ?? _configuration["MIDDLEWARE_URL"] ?? "http://127.0.0.1:4000";
                await client.PostAsync($"{middlewareUrl}/api/revoke", content);

                // Delete from DB (Cascades to StudentProfiles)
                using var deleteCmd = new NpgsqlCommand("DELETE FROM Users WHERE id = @id", conn);
                deleteCmd.Parameters.AddWithValue("id", id);
                await deleteCmd.ExecuteNonQueryAsync();

                _cache.Remove("approved_students");
                return Ok(new { status = "Success", message = "Student dropped and access revoked." });
            }
            catch (Exception ex) { return StatusCode(500, new { status = "Error", message = ex.Message }); }
        }

        [HttpGet("admins/department/approved")]
        public async Task<IActionResult> GetApprovedDepartmentAdmins()
        {
            const string cacheKey = "approved_department_admins";
            if (_cache.TryGetValue(cacheKey, out object? cachedData) && cachedData != null)
            {
                return Ok(cachedData);
            }

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var admins = new List<object>();

                using (var cmd = new NpgsqlCommand(@"
                    SELECT u.id, ap.full_name, u.email, ap.department, u.role 
                    FROM Users u JOIN AdminProfiles ap ON u.id = ap.user_id 
                    WHERE u.role = 'department_admin' AND u.status = 'APPROVED'", conn))
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                    {
                        admins.Add(new {
                            id = reader.GetInt32(0),
                            fullname = reader.GetString(1),
                            email = reader.GetString(2),
                            department = reader.IsDBNull(3) ? "Unassigned" : reader.GetString(3),
                            role = reader.GetString(4)
                        });
                    }
                }

                var response = new { status = "Success", admins };
                var cacheEntryOptions = new MemoryCacheEntryOptions().SetSlidingExpiration(TimeSpan.FromMinutes(5));
                _cache.Set(cacheKey, response, cacheEntryOptions);

                return Ok(response);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPut("admins/department/{id}/assign")]
        public async Task<IActionResult> AssignDepartmentAdmin(int id, [FromBody] AssignAdminRequest request)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                // Fetch user info for email notification
                string userEmail = "", userName = "Admin";
                using (var cmdEmail = new NpgsqlCommand("SELECT u.email, ap.full_name FROM Users u JOIN AdminProfiles ap ON u.id = ap.user_id WHERE u.id = @id", conn))
                {
                    cmdEmail.Parameters.AddWithValue("id", id); 
                    using var reader = await cmdEmail.ExecuteReaderAsync();
                    if (await reader.ReadAsync())
                    {
                        userEmail = reader.GetString(0);
                        userName = reader.GetString(1);
                    }
                }

                string queryAdmin = "UPDATE AdminProfiles SET department = @dept WHERE user_id = @id";
                using var cmdAdmin = new NpgsqlCommand(queryAdmin, conn);
                cmdAdmin.Parameters.AddWithValue("dept", request.Department?.Trim());
                cmdAdmin.Parameters.AddWithValue("id", id);
                
                int rows = await cmdAdmin.ExecuteNonQueryAsync();

                if (rows == 0) return NotFound(new { status = "Error", message = "Admin profile not found." });

                var emailSubject = "PLV Assignment: Department Head";
                var emailContent = $"<p>Hello {userName},</p><p>You have been officially assigned as the head of the <strong>{request.Department}</strong> department.</p>";
                _ = _emailService.SendEmailAsync(userEmail, emailSubject, CreateHtmlEmail(emailSubject, emailContent), true);

                // --- CACHE INVALIDATION ---
                _cache.Remove("approved_department_admins");

                return Ok(new { status = "Success", message = "Department assigned successfully." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpGet("faculty/approved")]
        public async Task<IActionResult> GetApprovedFaculties()
        {
            const string cacheKey = "approved_faculties";
            try
            {
                if (_cache.TryGetValue(cacheKey, out object? cachedData) && cachedData != null)
                {
                    return Ok(cachedData);
                }

                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var faculties = new List<object>();

                using (var cmd = new NpgsqlCommand(@"
                    SELECT u.id, fp.full_name, u.email, fp.department, fp.section, fp.year_level 
                    FROM Users u JOIN FacultyProfiles fp ON u.id = fp.user_id 
                    WHERE u.role = 'faculty' AND u.status = 'APPROVED'", conn))
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                    {
                        faculties.Add(new {
                            id = reader.GetInt32(0),
                            fullname = reader.GetString(1),
                            email = reader.GetString(2),
                            department = reader.IsDBNull(3) ? "Unassigned" : reader.GetString(3),
                            section = reader.IsDBNull(4) ? "Unassigned" : reader.GetString(4),
                            yearLevel = reader.IsDBNull(5) ? "Unassigned" : reader.GetString(5)
                        });
                    }
                }

                var response = new { status = "Success", faculties };
                var cacheEntryOptions = new MemoryCacheEntryOptions().SetSlidingExpiration(TimeSpan.FromMinutes(5));
                _cache.Set(cacheKey, response, cacheEntryOptions);

                return Ok(response);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPut("faculty/{id}/assign")]
        public async Task<IActionResult> AssignFaculty(int id, [FromBody] AssignFacultyRequest request)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                // Fetch user info for email notification
                string userEmail = "", userName = "Faculty";
                using (var cmdEmail = new NpgsqlCommand("SELECT u.email, fp.full_name FROM Users u JOIN FacultyProfiles fp ON u.id = fp.user_id WHERE u.id = @id", conn))
                {
                    cmdEmail.Parameters.AddWithValue("id", id); 
                    using var reader = await cmdEmail.ExecuteReaderAsync();
                    if (await reader.ReadAsync())
                    {
                        userEmail = reader.GetString(0);
                        userName = reader.GetString(1);
                    }
                }

                // 1. Update their Primary Department in their main profile (if it's their first assignment)
                string updateProfileQuery = "UPDATE FacultyProfiles SET department = @dept WHERE user_id = @id AND (department IS NULL OR department = 'Unassigned')";
                using var cmdProfile = new NpgsqlCommand(updateProfileQuery, conn);
                cmdProfile.Parameters.AddWithValue("dept", request.Department?.Trim());
                cmdProfile.Parameters.AddWithValue("id", id);
                await cmdProfile.ExecuteNonQueryAsync();

                // 2. Insert the specific class/section into the new FacultySections table
                string insertSectionQuery = @"
                    INSERT INTO FacultySections (user_id, department, section, year_level, subject) 
                    VALUES (@id, @dept, @section, @year, @subj)
                    ON CONFLICT (user_id, department, section, subject) DO NOTHING";
                
                using var cmdSection = new NpgsqlCommand(insertSectionQuery, conn);
                cmdSection.Parameters.AddWithValue("id", id);
                cmdSection.Parameters.AddWithValue("dept", request.Department?.Trim());
                cmdSection.Parameters.AddWithValue("section", request.Section?.Trim());
                cmdSection.Parameters.AddWithValue("year", request.YearLevel?.Trim());
                cmdSection.Parameters.AddWithValue("subj", (object?)request.Subject?.Trim() ?? DBNull.Value);

                int rows = await cmdSection.ExecuteNonQueryAsync();
                
                if (rows == 0) 
                {
                    // This means the ON CONFLICT triggered, so they are already assigned to this section.
                    return Ok(new { status = "Info", message = $"Faculty is already assigned to {request.Department} Section {request.Section}." });
                }

                var emailSubject = "PLV Faculty Assignment";
                var emailContent = $"<p>Hello {userName},</p><p>You have been officially assigned to handle Section <strong>{request.Section}</strong> ({request.YearLevel}) for the <strong>{request.Department}</strong> department.</p>";
                _ = _emailService.SendEmailAsync(userEmail, emailSubject, CreateHtmlEmail(emailSubject, emailContent), true);

                // --- CACHE INVALIDATION ---
                _cache.Remove("approved_faculties");

                return Ok(new { status = "Success", message = "Faculty assigned successfully." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        private string NormalizeDept(string dept)
        {
            var d = (dept ?? "").ToLower().Trim();
            if (d == "it" || d == "bsit" || d.Contains("information technology")) return "it";
            if (d == "cs" || d == "bscs" || d.Contains("computer science")) return "cs";
            if (d == "cpe" || d == "bscpe" || d.Contains("computer engineering")) return "cpe";
            if (d == "ece" || d == "bsece" || d.Contains("electrical engineering") || d.Contains("electronics")) return "ece";
            if (d == "ce" || d == "bsce" || d.Contains("civil engineering")) return "ce";
            if (d.Contains("accountancy")) return "acc";
            if (d.Contains("financial")) return "fm";
            if (d.Contains("marketing")) return "mm";
            if (d.Contains("human resource")) return "hrm";
            if (d.Contains("entrepreneurship")) return "ent";
            if (d.Contains("early childhood")) return "eced";
            if (d.Contains("english")) return "eng";
            if (d.Contains("filipino")) return "fil";
            if (d.Contains("mathematics")) return "math";
            if (d.Contains("science")) return "sci";
            if (d.Contains("social studies")) return "soc";
            if (d.Contains("physical education")) return "pe";
            if (d.Contains("communication")) return "comm";
            if (d.Contains("psychology")) return "psy";
            if (d.Contains("social work")) return "sw";
            if (d.Contains("public administration")) return "pa";
            return System.Text.RegularExpressions.Regex.Replace(d, "[^a-z0-9]", "");
        }

        [HttpGet("department/{email}/students/pending")]
        public async Task<IActionResult> GetDepartmentPendingStudents(string email)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                using var cmdAdmin = new NpgsqlCommand("SELECT department FROM AdminProfiles ap JOIN Users u ON ap.user_id = u.id WHERE u.email = @email", conn);
                cmdAdmin.Parameters.AddWithValue("email", email);
                var adminDept = (string?)await cmdAdmin.ExecuteScalarAsync();

                if (string.IsNullOrEmpty(adminDept) || adminDept == "Unassigned") 
                    return BadRequest(new { status = "Error", message = "Admin is not assigned to a department." });

                var students = new List<object>();
                using var cmd = new NpgsqlCommand(@"
                    SELECT u.id, sp.full_name, u.email, sp.student_no, sp.section, sp.department
                    FROM Users u JOIN StudentProfiles sp ON u.id = sp.user_id
                    WHERE u.role = 'student' AND sp.assignment_status = 'Pending Department Approval'", conn);

                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    var stuDept = reader.IsDBNull(5) ? "" : reader.GetString(5);
                    
                    if (NormalizeDept(stuDept) == NormalizeDept(adminDept))
                    {
                        students.Add(new {
                            id = reader.GetInt32(0),
                            fullname = reader.GetString(1),
                            email = reader.GetString(2),
                            studentno = reader.IsDBNull(3) ? null : reader.GetString(3),
                            section = reader.IsDBNull(4) ? null : reader.GetString(4)
                        });
                    }
                }
                return Ok(new { status = "Success", students });
            } 
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpGet("faculty/{email}/assigned-sections")]
        public async Task<IActionResult> GetFacultySections(string email)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var sections = new List<object>();
                using var cmd = new NpgsqlCommand(@"
                    SELECT fs.department, fs.section, fs.year_level, fs.subject 
                    FROM FacultySections fs 
                    JOIN Users u ON fs.user_id = u.id 
                    WHERE LOWER(u.email) = LOWER(@email) AND u.status = 'APPROVED'
                    ORDER BY fs.department, fs.year_level, fs.section", conn);
                
                cmd.Parameters.AddWithValue("email", email);

                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    sections.Add(new {
                        department = reader.GetString(0),
                        section = reader.GetString(1),
                        yearLevel = reader.IsDBNull(2) ? "N/A" : reader.GetString(2),
                        subject = reader.IsDBNull(3) ? "N/A" : reader.GetString(3)
                    });
                }

                return Ok(new { status = "Success", sections });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpDelete("faculty/{email}/assigned-sections")]
        public async Task<IActionResult> UnassignFacultySection(string email, [FromQuery] string department, [FromQuery] string yearLevel, [FromQuery] string section, [FromQuery] string? subject)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                using var cmd = new NpgsqlCommand(@"
                    DELETE FROM FacultySections 
                    WHERE user_id = (SELECT id FROM Users WHERE LOWER(email) = LOWER(@email) LIMIT 1)
                    AND department = @dept AND year_level = @year AND section = @sec
                    AND (subject = @subj OR (subject IS NULL AND @subj IS NULL))", conn);
                
                cmd.Parameters.AddWithValue("email", email);
                cmd.Parameters.AddWithValue("dept", department);
                cmd.Parameters.AddWithValue("year", yearLevel);
                cmd.Parameters.AddWithValue("sec", section);
                cmd.Parameters.AddWithValue("subj", (object?)subject?.Trim() ?? DBNull.Value);

                await cmd.ExecuteNonQueryAsync();

                return Ok(new { status = "Success", message = "Class unassigned successfully." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpGet("faculty/{email}/students")]
        public async Task<IActionResult> GetFacultyStudents(string email)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                // Fetch all approved students matching ANY of the faculty's assigned sections across multiple departments
                var students = new List<object>();
                using var cmdStudents = new NpgsqlCommand(@"
                    SELECT DISTINCT u.id, sp.full_name, u.email, sp.student_no, sp.assignment_status, sp.department, sp.section, fs.section, fs.year_level
                    FROM Users u 
                    JOIN StudentProfiles sp ON u.id = sp.user_id
                    JOIN FacultySections fs ON LOWER(TRIM(sp.department)) = LOWER(TRIM(fs.department)) 
                      AND (LOWER(TRIM(sp.section)) = LOWER(TRIM(fs.section)) 
                        OR LOWER(TRIM(sp.section)) = LOWER(TRIM(CONCAT(fs.year_level, fs.section))) 
                        OR LOWER(TRIM(sp.section)) = LOWER(TRIM(CONCAT(fs.year_level, '-', fs.section))) 
                        OR LOWER(TRIM(sp.section)) = LOWER(TRIM(CONCAT(fs.department, '-', fs.year_level, fs.section))) 
                        OR LOWER(TRIM(sp.section)) = LOWER(TRIM(CONCAT(fs.department, fs.year_level, fs.section)))
                        OR LOWER(TRIM(sp.section)) = LOWER(TRIM(CONCAT(fs.department, '-', fs.section))))
                    JOIN Users fu ON fs.user_id = fu.id
                    WHERE u.role = 'student' AND u.status = 'APPROVED'
                      AND sp.assignment_status = 'Enrolled'
                      AND fu.email = @email AND fu.status = 'APPROVED'", conn);
                
                cmdStudents.Parameters.AddWithValue("email", email);

                using (var reader = await cmdStudents.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                    {
                        students.Add(new {
                            id = reader.GetInt32(0),
                            fullname = reader.GetString(1),
                            email = reader.GetString(2),
                            studentno = reader.IsDBNull(3) ? "N/A" : reader.GetString(3),
                            enrollmentStatus = reader.IsDBNull(4) ? "Unassigned" : reader.GetString(4),
                            department = reader.IsDBNull(5) ? "N/A" : reader.GetString(5),
                            section = reader.IsDBNull(6) ? "N/A" : reader.GetString(6),
                            sectionNum = reader.IsDBNull(7) ? "N/A" : reader.GetString(7),
                            yearLevel = reader.IsDBNull(8) ? "N/A" : reader.GetString(8)
                        });
                    }
                }

                return Ok(new { status = "Success", students });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPut("students/{id}/approve-enrollment")]
        public async Task<IActionResult> ApproveStudentEnrollment(int id)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                // Fetch user info for email notification
                string userEmail = "", userName = "Student", dept = "", section = "";
                using (var cmdEmail = new NpgsqlCommand("SELECT u.email, sp.full_name, sp.department, sp.section FROM Users u JOIN StudentProfiles sp ON u.id = sp.user_id WHERE u.id = @id", conn))
                {
                    cmdEmail.Parameters.AddWithValue("id", id); 
                    using var reader = await cmdEmail.ExecuteReaderAsync();
                    if (await reader.ReadAsync())
                    {
                        userEmail = reader.GetString(0);
                        userName = reader.GetString(1);
                        dept = reader.IsDBNull(2) ? "their department" : reader.GetString(2);
                        section = reader.IsDBNull(3) ? "" : reader.GetString(3);
                    }
                }

                string query = "UPDATE StudentProfiles SET assignment_status = 'Enrolled' WHERE user_id = @id";
                using var cmd = new NpgsqlCommand(query, conn);
                cmd.Parameters.AddWithValue("id", id);
                
                int rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0) return NotFound(new { status = "Error", message = "Student not found." });

                var emailSubject = "PLV Enrollment Officially Approved!";
                var emailContent = $"<p>Congratulations {userName}!</p><p>Your enrollment for <strong>{dept} - Section {section}</strong> has been officially approved by your Department Admin. Welcome!</p>";
                _ = _emailService.SendEmailAsync(userEmail, emailSubject, CreateHtmlEmail(emailSubject, emailContent), true);

                _cache.Remove("approved_students");

                return Ok(new { status = "Success", message = "Student officially enrolled in the department!" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost("students/bulk-upload")]
        [Consumes("multipart/form-data")]
        public async Task<IActionResult> BulkUploadStudents([FromForm] IFormFile file, [FromForm] string? defaultDepartment)
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { status = "Error", message = "A .csv or .xlsx file is required." });

            var ext = Path.GetExtension(file.FileName).ToLower();
            if (ext != ".csv" && ext != ".xlsx")
                return BadRequest(new { status = "Error", message = "Only .csv and .xlsx files are supported." });

            var tempFile = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ext);
            var fallbackName = Path.GetFileNameWithoutExtension(file.FileName);
            bool isDepartmentFallback = fallbackName.StartsWith("Bachelor", StringComparison.OrdinalIgnoreCase) || 
                                        fallbackName.StartsWith("Master", StringComparison.OrdinalIgnoreCase) ||
                                        fallbackName.StartsWith("BS", StringComparison.OrdinalIgnoreCase);
            
            try
            {
                using (var fileStream = new FileStream(tempFile, FileMode.Create))
                    await file.CopyToAsync(fileStream);

                var parsedRecords = new List<Dictionary<string, string>>();

                if (ext == ".xlsx")
                {
                    using var workbook = new XLWorkbook(tempFile);
                    var ws = workbook.Worksheet(1);
                    var headerRow = ws.FirstRowUsed();
                    var headerMap = new Dictionary<string, int>();
                    
                    foreach (var cell in headerRow.CellsUsed())
                    {
                        headerMap[cell.Value.ToString().Trim().ToLower().Replace(" ", "_")] = cell.Address.ColumnNumber;
                    }

                    var rows = ws.RowsUsed().Skip(1);
                    foreach (var row in rows)
                    {
                        var dict = new Dictionary<string, string>();
                        foreach (var kvp in headerMap)
                        {
                            dict[kvp.Key] = row.Cell(kvp.Value).Value.ToString().Trim();
                        }
                        parsedRecords.Add(dict);
                    }
                }
                else if (ext == ".csv")
                {
                    using var reader = new StreamReader(tempFile, Encoding.UTF8);
                    string? line;
                    int lineNum = 0;
                    Dictionary<string, int>? headerMap = null;

                    while ((line = await reader.ReadLineAsync()) != null)
                    {
                        lineNum++;
                        line = line.Trim();
                        if (string.IsNullOrEmpty(line)) continue;

                        var fields = line.Split(',');
                        if (lineNum == 1)
                        {
                            headerMap = new Dictionary<string, int>();
                            for (int i = 0; i < fields.Length; i++)
                                headerMap[fields[i].Trim().ToLower().Replace(" ", "_")] = i;
                            continue;
                        }

                        var dict = new Dictionary<string, string>();
                        if (headerMap != null) {
                            foreach (var kvp in headerMap)
                            {
                                if (kvp.Value < fields.Length)
                                    dict[kvp.Key] = fields[kvp.Value].Trim();
                            }
                        }
                        parsedRecords.Add(dict);
                    }
                }

                int successCount = 0;
                int failureCount = 0;
                var errors = new List<object>();

                using var httpClient = _httpClientFactory.CreateClient("FabricCAClient");
                var apiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
                httpClient.DefaultRequestHeaders.Add("x-api-key", apiKey);
                var middlewareUrl = _configuration["Middleware:Url"] ?? _configuration["MIDDLEWARE_URL"] ?? "http://127.0.0.1:4000";

                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                foreach (var record in parsedRecords)
                {
                    string GetVal(params string[] keys)
                    {
                        foreach (var k in keys)
                        {
                            if (record.TryGetValue(k, out var val) && !string.IsNullOrWhiteSpace(val)) return val;
                        }
                        return "";
                    }

                    try
                    {
                        string name = GetVal("full_name", "name", "student_name");
                        string email = GetVal("email", "email_address");
                        string studentNo = GetVal("student_no", "student_number", "id_number");
                        string dobStr = GetVal("dob", "birthday", "date_of_birth");
                        string section = GetVal("section", "class_section");
                        string dept = GetVal("department", "course", "program");

                        // Smart Fallback: Decide if the filename is a Department or a Section
                        if (isDepartmentFallback) 
                        {
                            if (string.IsNullOrEmpty(dept)) dept = fallbackName;
                        }
                        else 
                        {
                            if (string.IsNullOrEmpty(section)) section = fallbackName;
                        }

                        if (string.IsNullOrEmpty(dept)) dept = defaultDepartment ?? "Unassigned";
                        if (string.IsNullOrEmpty(email)) email = studentNo; // Use student no as email if blank
                        
                        if (string.IsNullOrEmpty(email)) throw new Exception("Missing Email or Student Number");
                        if (string.IsNullOrEmpty(name)) throw new Exception("Missing Name");
                        if (string.IsNullOrEmpty(dobStr)) throw new Exception("Missing Birthday (DOB)");

                        email = email.Trim().ToLower();

                        // Parse Birthday to format the standard password MM/dd/yyyy
                        if (!DateTime.TryParse(dobStr, out DateTime dobDate))
                        {
                            throw new Exception($"Invalid date format for birthday: {dobStr}");
                        }
                        string password = dobDate.ToString("MM/dd/yyyy");

                        // Check if account already exists
                        using var checkCmd = new NpgsqlCommand("SELECT COUNT(1) FROM Users WHERE email = @email", conn);
                        checkCmd.Parameters.AddWithValue("email", email);
                        long exists = (long)await checkCmd.ExecuteScalarAsync();
                        if (exists > 0)
                        {
                            throw new Exception($"Account '{email}' already exists.");
                        }

                        // Hash Password via Middleware
                        var hashPayload = new { password = password };
                        var hashContent = new StringContent(JsonSerializer.Serialize(hashPayload), Encoding.UTF8, "application/json");
                        var hashResponse = await httpClient.PostAsync($"{middlewareUrl}/api/crypto/hash-password", hashContent);
                        if (!hashResponse.IsSuccessStatusCode) throw new Exception("Failed to secure password via middleware.");
                        
                        var hashResultStr = await hashResponse.Content.ReadAsStringAsync();
                        using var hashDoc = JsonDocument.Parse(hashResultStr);
                        string passwordHash = hashDoc.RootElement.GetProperty("hash").GetString() ?? throw new Exception("Failed to parse hash.");

                        // DB Insert (Auto Approved & Enrolled)
                        using var tx = await conn.BeginTransactionAsync();
                        
                        using var cmdUser = new NpgsqlCommand("INSERT INTO Users (email, password_hash, role, status) VALUES (@email, @hash, 'student', 'APPROVED') RETURNING id", conn, tx);
                        cmdUser.Parameters.AddWithValue("email", email);
                        cmdUser.Parameters.AddWithValue("hash", passwordHash);
                        int userId = (int)(await cmdUser.ExecuteScalarAsync() ?? throw new Exception("Failed to retrieve new User ID"));

                        using var cmdProfile = new NpgsqlCommand(@"
                            INSERT INTO StudentProfiles (user_id, full_name, student_no, department, section, date_of_birth, assignment_status) 
                            VALUES (@uid, @name, @studentno, @dept, @sec, @dob, 'Enrolled')", conn, tx);
                        cmdProfile.Parameters.AddWithValue("uid", userId);
                        cmdProfile.Parameters.AddWithValue("name", name);
                        cmdProfile.Parameters.AddWithValue("studentno", (object?)studentNo ?? DBNull.Value);
                        cmdProfile.Parameters.AddWithValue("dept", dept);
                        cmdProfile.Parameters.AddWithValue("sec", string.IsNullOrEmpty(section) ? DBNull.Value : section);
                        cmdProfile.Parameters.AddWithValue("dob", dobDate.Date);
                        await cmdProfile.ExecuteNonQueryAsync();

                        await tx.CommitAsync();

                        // Fabric Wallet Generation
                        var payload = new { email = email, role = "student" };
                        var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                        var fabResponse = await httpClient.PostAsync($"{middlewareUrl}/api/fabric/register-user", content);

                        successCount++;
                    }
                    catch (Exception rowEx)
                    {
                        failureCount++;
                        errors.Add(new { identifier = record.ContainsKey("email") ? record["email"] : record.ContainsKey("student_no") ? record["student_no"] : "Unknown", reason = rowEx.Message });
                    }
                }

                // Invalidate Caches so UI immediately shows new students
                _cache.Remove("approved_students");
                _cache.Remove("pending_requests");

                return Ok(new
                {
                    status = failureCount == 0 ? "Success" : "Partial Success",
                    totalProcessed = successCount + failureCount,
                    successful = successCount,
                    failed = failureCount,
                    errors = errors.Any() ? errors : null,
                    message = $"{successCount} students automatically enrolled and approved."
                });
            }
            finally
            {
                if (System.IO.File.Exists(tempFile))
                    System.IO.File.Delete(tempFile);
            }
        }

        private string CreateHtmlEmail(string subject, string content)
        {
            var year = DateTime.UtcNow.Year;
            var imagePath = Path.Combine(Directory.GetCurrentDirectory(), "..", "frontend", "src", "assets", "plvlogo.png");
            string logoSrc;
            
            if (System.IO.File.Exists(imagePath))
            {
                byte[] imageBytes = System.IO.File.ReadAllBytes(imagePath);
                logoSrc = $"data:image/png;base64,{Convert.ToBase64String(imageBytes)}";
            }
            else
            {
                logoSrc = "https://upload.wikimedia.org/wikipedia/en/5/52/Pamantasan_ng_Lungsod_ng_Valenzuela_logo.png";
            }

            return $@"
            <!DOCTYPE html>
            <html lang='en'>
            <head><meta charset='UTF-8'></head>
            <body style='font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f4f4f4;'>
                <div style='max-width: 600px; margin: auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);'>
                    <div style='text-align: center; padding-bottom: 20px; border-bottom: 1px solid #ddd;'>
                        <img src='{logoSrc}' alt='PLV Logo' style='max-width: 100px;'>
                        <h2 style='margin: 10px 0 0 0; color: #003366;'>Pamantasan ng Lungsod ng Valenzuela</h2>
                    </div>
                    <div style='padding: 20px 0; line-height: 1.6; color: #333;'>
                        <h3 style='color: #003366;'>{subject}</h3>
                        {content.Replace("\n", "<br />")}
                    </div>
                    <div style='text-align: center; padding-top: 20px; border-top: 1px solid #ddd; font-size: 0.9em; color: #777;'>
                        <p>&copy; {year} PLV BlockGo. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>";
        }

        [HttpGet("user-profile")]
        public async Task<IActionResult> GetUserProfile([FromQuery] string email, [FromQuery] string role)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                string query = "";
                NpgsqlCommand cmd;
                UserProfileDto? userProfile = null;

                // Base query to get user info
                string baseQuery = "SELECT u.id, u.email, u.role, u.status, ";

                if (role?.ToLower() == "student")
                {
                    query = baseQuery + "sp.full_name, sp.department, sp.student_no, sp.section FROM Users u JOIN StudentProfiles sp ON u.id = sp.user_id WHERE u.email = @email";
                    cmd = new NpgsqlCommand(query, conn);
                    cmd.Parameters.AddWithValue("email", email);
                    using var reader = await cmd.ExecuteReaderAsync();
                    if (await reader.ReadAsync())
                    {
                        userProfile = new UserProfileDto
                        {
                            Id = reader.GetInt32(0),
                            Email = reader.GetString(1),
                            Role = reader.GetString(2),
                            Status = reader.GetString(3),
                            FullName = reader.GetString(4),
                            Department = reader.IsDBNull(5) ? null : reader.GetString(5),
                            StudentNo = reader.IsDBNull(6) ? null : reader.GetString(6),
                            Section = reader.IsDBNull(7) ? null : reader.GetString(7)
                        };
                    }
                }
                else if (role?.ToLower() == "faculty")
                {
                    query = baseQuery + "fp.full_name, fp.department, fp.section, fp.year_level FROM Users u JOIN FacultyProfiles fp ON u.id = fp.user_id WHERE u.email = @email";
                    cmd = new NpgsqlCommand(query, conn);
                    cmd.Parameters.AddWithValue("email", email);
                    using var reader = await cmd.ExecuteReaderAsync();
                    if (await reader.ReadAsync())
                    {
                        userProfile = new UserProfileDto
                        {
                            Id = reader.GetInt32(0),
                            Email = reader.GetString(1),
                            Role = reader.GetString(2),
                            Status = reader.GetString(3),
                            FullName = reader.GetString(4),
                            Department = reader.IsDBNull(5) ? null : reader.GetString(5),
                            Section = reader.IsDBNull(6) ? null : reader.GetString(6),
                            YearLevel = reader.IsDBNull(7) ? null : reader.GetString(7)
                        };
                    }
                }
                else if (role?.ToLower() == "registrar" || role?.ToLower() == "department_admin" || role?.ToLower() == "department admin") 
                {
                    query = baseQuery + "ap.full_name, ap.department FROM Users u JOIN AdminProfiles ap ON u.id = ap.user_id WHERE u.email = @email";
                    cmd = new NpgsqlCommand(query, conn);
                    cmd.Parameters.AddWithValue("email", email);
                    using var reader = await cmd.ExecuteReaderAsync();
                    if (await reader.ReadAsync())
                    {
                        userProfile = new UserProfileDto
                        {
                            Id = reader.GetInt32(0),
                            Email = reader.GetString(1),
                            Role = reader.GetString(2),
                            Status = reader.GetString(3),
                            FullName = reader.GetString(4),
                            Department = reader.IsDBNull(5) ? null : reader.GetString(5)
                        };
                    }
                }
                else
                {
                    return BadRequest(new { status = "Error", message = "Invalid role specified." });
                }

                if (userProfile == null)
                {
                    return NotFound(new { status = "Error", message = "User profile not found." });
                }

                // NEW: If student, fetch their enrolled subjects from FacultySections
                if (role?.ToLower() == "student" && !string.IsNullOrEmpty(userProfile.Section))
                {
                    try
                    {
                        var subjects = new List<string>();
                        using var cmdSub = new NpgsqlCommand(@"
                            SELECT DISTINCT subject 
                            FROM FacultySections 
                            WHERE LOWER(TRIM(department)) = LOWER(TRIM(@dept)) 
                            AND (LOWER(TRIM(section)) = LOWER(TRIM(@sec))
                                 OR LOWER(TRIM(CONCAT(year_level, section))) = LOWER(TRIM(@sec))
                                 OR LOWER(TRIM(CONCAT(year_level, '-', section))) = LOWER(TRIM(@sec)))
                            AND subject IS NOT NULL", conn);
                        cmdSub.Parameters.AddWithValue("dept", userProfile.Department ?? "");
                        cmdSub.Parameters.AddWithValue("sec", userProfile.Section);

                        using var readerSub = await cmdSub.ExecuteReaderAsync();
                        while (await readerSub.ReadAsync())
                        {
                            subjects.Add(readerSub.GetString(0));
                        }
                        userProfile.EnrolledSubjects = subjects;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning("Failed to fetch enrolled subjects: {Message}", ex.Message);
                    }
                }

                return Ok(new { status = "Success", data = userProfile });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }
    }
}