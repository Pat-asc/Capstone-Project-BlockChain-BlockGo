using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Client_app.Services;
using Npgsql;
using Client_app.Models; // Added for external DTOs
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Mail;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Security.Cryptography;


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

        public AuthController(IConfiguration configuration, IMemoryCache memoryCache, IEmailService emailService, IHttpClientFactory httpClientFactory)
        {
            _connectionString = configuration.GetConnectionString("PostgresConnection") ?? throw new InvalidOperationException("PostgreSQL connection string 'PostgresConnection' not found.");
            _cache = memoryCache;
            _configuration = configuration;
            _emailService = emailService;
            _httpClientFactory = httpClientFactory;
        }

        [HttpPost("send-verification")]
        public async Task<IActionResult> SendVerificationCode([FromBody] VerificationRequest request)
        {
            if (string.IsNullOrEmpty(request.Email))
            {
                return BadRequest(new { status = "Error", message = "Email is required." });
            }

            using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();

            using (var checkCmd = new NpgsqlCommand("SELECT COUNT(1) FROM Users WHERE email = @email", conn))
            {
                checkCmd.Parameters.AddWithValue("email", request.Email);
                long userCount = (long)(await checkCmd.ExecuteScalarAsync() ?? 0);
                if (userCount > 0)
                {
                    return BadRequest(new { status = "Error", message = "An account with this email already exists or is currently pending approval." });
                }
            }

            var verificationCode = RandomNumberGenerator.GetInt32(100000, 1000000).ToString();
            var cacheKey = $"verification_{request.Email}";
            _cache.Set(cacheKey, verificationCode, TimeSpan.FromMinutes(10));

            var subject = "Your PLV Account Verification Code";
            var content = $"<p>Hello,</p><p>Thank you for registering. Please use the following verification code to complete your signup process. The code is valid for 10 minutes.</p><p style='font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 5px; margin: 20px 0;'>{verificationCode}</p><p>If you did not request this, please ignore this email.</p>";
            var htmlBody = CreateHtmlEmail(subject, content);

            await _emailService.SendEmailAsync(request.Email, subject, htmlBody, true);

            return Ok(new { status = "Success", message = "Verification code sent to your email." });
        }

        [HttpPost("request")]
        public async Task<IActionResult> RequestAccess([FromBody] SignupRequest request)
        {
            // 1. Verify Code
            if (!_cache.TryGetValue($"verification_{request.Email}", out string? cachedCode) || cachedCode != request.VerificationCode)
            {
                return BadRequest(new { status = "Error", message = "The verification code is incorrect or has expired. Please try again." });
            }
            _cache.Remove($"verification_{request.Email}");

            using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();

            // Check if user already exists before proceeding
            using (var checkCmd = new NpgsqlCommand("SELECT COUNT(1) FROM Users WHERE email = @email", conn))
            {
                checkCmd.Parameters.AddWithValue("email", request.Email);
                long userCount = (long)(await checkCmd.ExecuteScalarAsync() ?? 0);
                if (userCount > 0)
                {
                    return BadRequest(new { status = "Error", message = "An account with this email already exists or is currently pending approval." });
                }
            }

            using var transaction = await conn.BeginTransactionAsync();

            // Request password hash from Node.js Middleware
            using var client = _httpClientFactory.CreateClient();
            var apiKey = _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
            client.DefaultRequestHeaders.Add("x-api-key", apiKey);
            var hashPayload = new { password = request.Password };
            var hashContent = new StringContent(JsonSerializer.Serialize(hashPayload), Encoding.UTF8, "application/json");
            var middlewareUrl = _configuration["Middleware:Url"] ?? throw new InvalidOperationException("Middleware URL not configured.");
            var hashResponse = await client.PostAsync($"{middlewareUrl}/api/crypto/hash-password", hashContent);
            
            if (!hashResponse.IsSuccessStatusCode) {
                return StatusCode(500, new { status = "Error", message = "Failed to secure password via middleware." });
            }
            
            var hashResultStr = await hashResponse.Content.ReadAsStringAsync();
            using var hashDoc = JsonDocument.Parse(hashResultStr);
            string passwordHash = hashDoc.RootElement.GetProperty("hash").GetString() ?? throw new Exception("Failed to parse hash");

            // 1. Insert into base Users table
            using var cmdUser = new NpgsqlCommand(@"
                INSERT INTO Users (email, password_hash, role, status) 
                VALUES (@email, @hash, @role, 'pending') RETURNING id", conn, transaction);
            cmdUser.Parameters.AddWithValue("email", request.Email);
            cmdUser.Parameters.AddWithValue("hash", passwordHash);
            cmdUser.Parameters.AddWithValue("role", request.Role?.ToLower() ?? "student");
            
            int userId = (int)(await cmdUser.ExecuteScalarAsync() ?? throw new Exception("Failed to retrieve new User ID"));

            string profileQuery = "";
            if (request.Role?.ToLower() == "student")
            {
                profileQuery = "INSERT INTO StudentProfiles (user_id, full_name, student_no, department) VALUES (@uid, @name, @studentno, @dept)";
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
            if (request.Role?.ToLower() == "student") {
                cmdProfile.Parameters.AddWithValue("studentno", (object?)request.StudentNo ?? DBNull.Value);
            }

            await cmdProfile.ExecuteNonQueryAsync();
            await transaction.CommitAsync();

            // --- CACHE INVALIDATION ---
            _cache.Remove("pending_requests");

            return Ok(new { status = "Success", message = "Registration request added to waitlist." });
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
            var apiKey = _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
            client.DefaultRequestHeaders.Add("x-api-key", apiKey);

            var payload = new { email = userEmail, role = userRole };
            var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
            
            // Call the internal Fabric Gateway
            var middlewareUrl = _configuration["Middleware:Url"] ?? throw new InvalidOperationException("Middleware URL not configured.");
            var response = await client.PostAsync($"{middlewareUrl}/api/fabric/register-user", content);
            
            if (!response.IsSuccessStatusCode) {
                await transaction.RollbackAsync();
                string errorBody = await response.Content.ReadAsStringAsync();
                return StatusCode(500, new { status = "Error", message = $"Approved in DB, but Blockchain Wallet failed: {errorBody}" });
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
            var configuredApiKey = _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
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
                cmd.Parameters.AddWithValue("dept", request.Department);
                cmd.Parameters.AddWithValue("section", request.Section);
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
                cmdAdmin.Parameters.AddWithValue("dept", request.Department);
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

                string query = "UPDATE FacultyProfiles SET department = @dept, section = @section, year_level = @year WHERE user_id = @id";
                using var cmd = new NpgsqlCommand(query, conn);
                cmd.Parameters.AddWithValue("dept", request.Department);
                cmd.Parameters.AddWithValue("section", request.Section);
                cmd.Parameters.AddWithValue("year", request.YearLevel);
                cmd.Parameters.AddWithValue("id", id);
                
                int rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0) return NotFound(new { status = "Error", message = "Faculty profile not found." });

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

        [HttpGet("department/{email}/students/pending")]
        public async Task<IActionResult> GetDepartmentPendingStudents(string email)
        {
            string cacheKey = $"department_pending_{email}";
            try
            {
                if (_cache.TryGetValue(cacheKey, out object? cachedData) && cachedData != null)
                {
                    return Ok(cachedData);
                }

                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                // First, find the department of the logged-in Admin
                using var cmdAdmin = new NpgsqlCommand("SELECT department FROM AdminProfiles ap JOIN Users u ON ap.user_id = u.id WHERE u.email = @email", conn);
                cmdAdmin.Parameters.AddWithValue("email", email);
                var adminDept = (string?)await cmdAdmin.ExecuteScalarAsync();

                if (string.IsNullOrEmpty(adminDept) || adminDept == "Unassigned") 
                    return BadRequest(new { status = "Error", message = "Admin is not assigned to a department." });

                var students = new List<object>();
                // Fetch students assigned to this specific department awaiting approval
                using var cmd = new NpgsqlCommand(@"
                    SELECT u.id, sp.full_name, u.email, sp.student_no, sp.section
                    FROM Users u JOIN StudentProfiles sp ON u.id = sp.user_id
                    WHERE u.role = 'student' AND sp.department = @dept AND sp.assignment_status = 'Pending Department Approval'", conn);
                cmd.Parameters.AddWithValue("dept", adminDept);

                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    students.Add(new {
                        id = reader.GetInt32(0),
                        fullname = reader.GetString(1),
                        email = reader.GetString(2),
                        studentno = reader.IsDBNull(3) ? null : reader.GetString(3),
                        section = reader.IsDBNull(4) ? null : reader.GetString(4)
                    });
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
                else if (role?.ToLower() == "registrar" || role?.ToLower() == "department_admin" || role?.ToLower() == "dean") // Assuming 'dean' maps to department_admin
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

                return Ok(new { status = "Success", data = userProfile });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }
    }
}