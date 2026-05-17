using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.SignalR;
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
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using System.Security.Cryptography;
using ClosedXML.Excel;


namespace Client_app.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private const string EmailLogoContentId = "plv-logo";
        private readonly string _connectionString;
        private readonly IMemoryCache _cache;
        private readonly IConfiguration _configuration;
        private readonly IEmailService _emailService;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<AuthController> _logger;
        private readonly IHubContext<ChatHub> _chatHubContext;

        public AuthController(IConfiguration configuration, IMemoryCache memoryCache, IEmailService emailService, IHttpClientFactory httpClientFactory, ILogger<AuthController> logger, IHubContext<ChatHub> chatHubContext)
        {
            _connectionString = configuration.GetConnectionString("PostgresConnection") ?? throw new InvalidOperationException("PostgreSQL connection string 'PostgresConnection' not found.");
            _cache = memoryCache;
            _configuration = configuration;
            _emailService = emailService;
            _httpClientFactory = httpClientFactory;
            _logger = logger;
            _chatHubContext = chatHubContext;

            EnsureTableExists();
        }

        private void EnsureTableExists()
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                conn.Open();
                using var cmd = new NpgsqlCommand(@"
                    CREATE TABLE IF NOT EXISTS AcademicSections (
                        id SERIAL PRIMARY KEY,
                        department VARCHAR(50) NOT NULL,
                        year_level INT NOT NULL,
                        section_num INT NOT NULL,
                        UNIQUE(department, year_level, section_num)
                    );
                    
                    DO $$ 
                    BEGIN 
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='facultysections' AND column_name='subject') THEN
                            ALTER TABLE facultysections ADD COLUMN subject VARCHAR(100);
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='facultyprofiles' AND column_name='faculty_type') THEN
                            ALTER TABLE facultyprofiles ADD COLUMN faculty_type VARCHAR(20);
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='studentprofiles' AND column_name='middle_name') THEN
                            ALTER TABLE studentprofiles ADD COLUMN middle_name VARCHAR(100);
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='studentprofiles' AND column_name='phone') THEN
                            ALTER TABLE studentprofiles ADD COLUMN phone VARCHAR(50);
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='studentprofiles' AND column_name='address') THEN
                            ALTER TABLE studentprofiles ADD COLUMN address TEXT;
                        END IF;
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='studentprofiles' AND column_name='student_email') THEN
                            ALTER TABLE studentprofiles ADD COLUMN student_email VARCHAR(255);
                        END IF;
                    END $$;

                    DO $$
                    BEGIN
                        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='gradecorrectionlogs') THEN
                            ALTER TABLE gradecorrectionlogs
                                ALTER COLUMN oldgrade TYPE TEXT,
                                ALTER COLUMN newgrade TYPE TEXT;
                        END IF;
                    END $$;

                    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_faculty_section ON facultysections(user_id, department, section, subject);
                ", conn);
                cmd.ExecuteNonQuery();
            }
            catch { /* Ignore */ }
        }

        private Task NotifyAcademicDataChangedAsync(string reason, string? department = null, string? actor = null)
        {
            return _chatHubContext.Clients.All.SendAsync("AcademicDataChanged", new
            {
                Reason = reason,
                Department = department,
                Actor = actor,
                ChangedAt = DateTime.UtcNow
            });
        }

        private async Task SafeNotifyAcademicDataChangedAsync(string reason, string? department = null, string? actor = null)
        {
            try
            {
                await NotifyAcademicDataChangedAsync(reason, department, actor);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Academic data change notification failed for reason {Reason}.", reason);
            }
        }

        private async Task SafeInsertAuthAuditLogAsync(
            NpgsqlConnection conn,
            string recordId,
            string? oldValue,
            string? newValue,
            string reason,
            string? approvedBy)
        {
            try
            {
                using var cmdEnsureColumns = new NpgsqlCommand(@"
                    DO $$
                    BEGIN
                        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='gradecorrectionlogs') THEN
                            ALTER TABLE gradecorrectionlogs
                                ALTER COLUMN oldgrade TYPE TEXT,
                                ALTER COLUMN newgrade TYPE TEXT;
                        END IF;
                    END $$;", conn);
                await cmdEnsureColumns.ExecuteNonQueryAsync();

                using var auditCmd = new NpgsqlCommand(@"
                    INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp)
                    VALUES (@recordId, @oldValue, @newValue, @reason, @approvedBy, CURRENT_TIMESTAMP)", conn);
                auditCmd.Parameters.AddWithValue("recordId", recordId);
                auditCmd.Parameters.AddWithValue("oldValue", (object?)oldValue ?? DBNull.Value);
                auditCmd.Parameters.AddWithValue("newValue", (object?)newValue ?? DBNull.Value);
                auditCmd.Parameters.AddWithValue("reason", reason);
                auditCmd.Parameters.AddWithValue("approvedBy", (object?)(approvedBy ?? "Admin") ?? DBNull.Value);
                await auditCmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Auth revoke audit log insert failed for record {RecordId}.", recordId);
            }
        }

        private static string NormalizeSystemRole(string? role)
        {
            var normalized = (role ?? "student").Trim().ToLowerInvariant().Replace(" ", "_").Replace("-", "_");
            return normalized switch
            {
                "dept_admin" or "deptadmin" or "departmentadmin" or "department" or "admin" or "departmentmsp" or "chairperson" => "department_admin",
                "facultymsp" => "faculty",
                "registrarmsp" => "registrar",
                _ => normalized
            };
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
                var logoPath = ResolveEmailLogoPath();
                var htmlBody = CreateHtmlEmail(subject, content, useInlineLogo: logoPath != null);

                await _emailService.SendEmailAsync(normalizedEmail, subject, htmlBody, true, logoPath, EmailLogoContentId);

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
            request.Role = NormalizeSystemRole(request.Role);
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

                string finalPassword = "";
                if (request.Role?.ToLower() == "student")
                {
                    finalPassword = request.DateOfBirth ?? "";
                }
                else
                {
                    finalPassword = request.Password ?? "";
                }
                
                if (string.IsNullOrEmpty(finalPassword))
                {
                    _logger.LogWarning("Password/DOB validation failed for role '{Role}'. DOB: '{DOB}', Password Provided: {PassProvided}", request.Role, request.DateOfBirth, !string.IsNullOrEmpty(request.Password));
                    return BadRequest(new { status = "Error", message = request.Role?.ToLower() == "student" ? 
                        "Date of birth (mm/dd/yyyy) is required for students." : "Password is required." });
                }

                using var cmdUser = new NpgsqlCommand(@"
                    INSERT INTO Users (email, password_hash, role, status) 
                    VALUES (@email, crypt(@password, gen_salt('bf', 12)), @role, 'pending') RETURNING id", conn, transaction);
                cmdUser.Parameters.AddWithValue("email", normalizedEmail);
                cmdUser.Parameters.AddWithValue("password", finalPassword);
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
                    profileQuery = "INSERT INTO FacultyProfiles (user_id, full_name, department, faculty_type) VALUES (@uid, @name, @dept, @facultyType)";
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
                cmdProfile.Parameters.AddWithValue("facultyType", request.Role?.ToLower() == "faculty" ? (object?)(request.FacultyType ?? "full-time") : DBNull.Value);
                
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

                if (request.Role?.ToLower() == "student")
                {
                    var subject = "Your PLV Account - Default Password Info";
                    var content = $@"<p>Hello {request.FullName},</p>
                                   <p>Your account default password is your Date of Birth: <strong>{finalPassword}</strong></p>
                                   <p>You can change it after first login. Await registrar approval.</p>";
                    var htmlBody = CreateHtmlEmail(subject, content);
                    await _emailService.SendEmailAsync(normalizedEmail, subject, htmlBody, true);
                }

                _cache.Remove("pending_requests");
                await _chatHubContext.Clients.Group("role_registrar").SendAsync("NewRegistrationRequest", new
                {
                    RequestId = userId,
                    FullName = request.FullName,
                    Email = normalizedEmail,
                    Role = request.Role?.ToLower() ?? "student",
                    Department = request.Department,
                    CreatedAt = DateTime.UtcNow
                });

                await NotifyAcademicDataChangedAsync("registration_requested", request.Department, normalizedEmail);
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

            using (var cmd = new NpgsqlCommand(@"
                    SELECT u.id, fp.full_name, u.email, u.role, fp.department, u.status 
                    FROM Users u JOIN FacultyProfiles fp ON u.id = fp.user_id 
                    WHERE u.role = 'faculty' AND u.status = 'pending'
                    UNION
                    SELECT u.id, ap.full_name, u.email, u.role, ap.department, u.status 
                    FROM Users u JOIN AdminProfiles ap ON u.id = ap.user_id 
                    WHERE (
                        u.role = 'registrar'
                        OR LOWER(REPLACE(REPLACE(u.role, ' ', '_'), '-', '_')) IN ('department_admin', 'dept_admin', 'deptadmin', 'department', 'admin', 'chairperson')
                    ) AND u.status = 'pending'", conn))
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
            string userRole = NormalizeSystemRole(reader.GetString(1));
            await reader.CloseAsync(); 

            using (var normalizeRoleCmd = new NpgsqlCommand("UPDATE Users SET role = @role WHERE id = @id", conn, transaction))
            {
                normalizeRoleCmd.Parameters.AddWithValue("role", userRole);
                normalizeRoleCmd.Parameters.AddWithValue("id", id);
                await normalizeRoleCmd.ExecuteNonQueryAsync();
            }

            using var client = _httpClientFactory.CreateClient("FabricCAClient");
            var apiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
            client.DefaultRequestHeaders.Add("x-api-key", apiKey);

            var payload = new { email = userEmail, role = userRole };
            var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
            
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

            _cache.Remove("pending_requests");
            if (userRole == "student") _cache.Remove("approved_students");
            else if (userRole == "faculty") _cache.Remove("approved_faculties");
            else if (userRole == "department_admin") _cache.Remove("approved_department_admins");

            await NotifyAcademicDataChangedAsync("registration_approved", null, userEmail);
            return Ok(new { status = "Success", message = "Request approved and Fabric Wallet created successfully." });
        }

        [HttpDelete("requests/deny/{id}")]
        public async Task<IActionResult> DenyRequest(int id)
        {
            using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();

            using var findCmd = new NpgsqlCommand("SELECT email, role FROM Users WHERE id = @id AND status = 'pending'", conn);
            findCmd.Parameters.AddWithValue("id", id);
            using var reader = await findCmd.ExecuteReaderAsync();

            if (!await reader.ReadAsync())
            {
                return NotFound(new { status = "Error", message = "Request not found or already actioned." });
            }
            string userEmail = reader.GetString(0);
            string userRole = reader.GetString(1);
            await reader.CloseAsync();

            using var deleteCmd = new NpgsqlCommand("DELETE FROM Users WHERE id = @id", conn);
            deleteCmd.Parameters.AddWithValue("id", id);
            await deleteCmd.ExecuteNonQueryAsync();

            var emailSubject = "PLV System Access Update";
            var emailContent = $"<p>Hello,</p><p>We regret to inform you that your registration request for the role '<strong>{userRole}</strong>' has been denied by the administration.</p>";
            _ = _emailService.SendEmailAsync(userEmail, emailSubject, CreateHtmlEmail(emailSubject, emailContent), true);

            _cache.Remove("pending_requests");
            await NotifyAcademicDataChangedAsync("registration_denied", null, userEmail);
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

                string query = "UPDATE StudentProfiles SET department = @dept, section = @section, assignment_status = 'Enrolled' WHERE user_id = @id";
                using var cmd = new NpgsqlCommand(query, conn);
                cmd.Parameters.AddWithValue("dept", (object?)request.Department?.Trim() ?? DBNull.Value);
                cmd.Parameters.AddWithValue("section", (object?)request.Section?.Trim() ?? DBNull.Value);
                cmd.Parameters.AddWithValue("id", id);
                
                int rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0) return NotFound(new { status = "Error", message = "Student profile not found." });

                var emailSubject = "PLV Enrollment Update: Department Assignment";
                var emailContent = $"<p>Hello {userName},</p><p>The Registrar has officially enrolled you in the <strong>{request.Department}</strong> department, section <strong>{request.Section}</strong>.</p>";
                _ = _emailService.SendEmailAsync(userEmail, emailSubject, CreateHtmlEmail(emailSubject, emailContent), true);

                _cache.Remove("approved_students");

                await NotifyAcademicDataChangedAsync("student_assigned", request.Department, userEmail);
                return Ok(new { status = "Success", message = "Student assigned and automatically enrolled." });
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

                using var client = _httpClientFactory.CreateClient("FabricCAClient");
                var apiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
                client.DefaultRequestHeaders.Add("x-api-key", apiKey);

                var payload = new { username = userEmail, role = userRole };
                var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                var middlewareUrl = _configuration["Middleware:Url"] ?? _configuration["MIDDLEWARE_URL"] ?? "http://127.0.0.1:4000";
                var response = await client.PostAsync($"{middlewareUrl}/api/revoke", content);
                
                if (!response.IsSuccessStatusCode)
                {
                    var errBody = await response.Content.ReadAsStringAsync();
                    if (errBody.Contains("already revoked") || errBody.Contains("already inactive"))
                    {
                        _logger.LogWarning("WBSD 1.29.2: Account {Email} is already revoked on the CA.", userEmail);
                    }
                }

                using var tx = await conn.BeginTransactionAsync();

                using var delProfileCmd = new NpgsqlCommand("DELETE FROM StudentProfiles WHERE user_id = @id", conn, tx);
                delProfileCmd.Parameters.AddWithValue("id", id);
                await delProfileCmd.ExecuteNonQueryAsync();

                using var deleteCmd = new NpgsqlCommand("DELETE FROM Users WHERE id = @id", conn, tx);
                deleteCmd.Parameters.AddWithValue("id", id);
                await deleteCmd.ExecuteNonQueryAsync();

                await tx.CommitAsync();

                await SafeInsertAuthAuditLogAsync(
                    conn,
                    "SYSTEM-AUTH",
                    userEmail,
                    "DROPPED",
                    "Student Access Revoked",
                    User.Identity?.Name ?? "Admin"
                );

                _cache.Remove("approved_students");
                await SafeNotifyAcademicDataChangedAsync("student_dropped", null, userEmail);
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
                    WHERE LOWER(REPLACE(REPLACE(u.role, ' ', '_'), '-', '_')) IN ('department_admin', 'dept_admin', 'deptadmin', 'department', 'admin', 'chairperson')
                      AND u.status = 'APPROVED'", conn))
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    while (await reader.ReadAsync())
                    {
                        admins.Add(new {
                            id = reader.GetInt32(0),
                            fullname = reader.GetString(1),
                            email = reader.GetString(2),
                            department = reader.IsDBNull(3) ? "Unassigned" : reader.GetString(3),
                            role = NormalizeSystemRole(reader.GetString(4))
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
                cmdAdmin.Parameters.AddWithValue("dept", (object?)request.Department?.Trim() ?? DBNull.Value);
                cmdAdmin.Parameters.AddWithValue("id", id);
                
                int rows = await cmdAdmin.ExecuteNonQueryAsync();

                if (rows == 0) return NotFound(new { status = "Error", message = "Admin profile not found." });

                var emailSubject = "PLV Assignment: Department Head";
                var emailContent = $"<p>Hello {userName},</p><p>You have been officially assigned as the head of the <strong>{request.Department}</strong> department.</p>";
                _ = _emailService.SendEmailAsync(userEmail, emailSubject, CreateHtmlEmail(emailSubject, emailContent), true);

                _cache.Remove("approved_department_admins");

                await NotifyAcademicDataChangedAsync("department_admin_assigned", request.Department, userEmail);
                return Ok(new { status = "Success", message = "Department assigned successfully." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpDelete("admins/department/{id}/revoke")]
        [Authorize(Roles = "registrar,admin")]
        public async Task<IActionResult> RevokeDepartmentAdmin(int id)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                using var findCmd = new NpgsqlCommand(@"
                    SELECT u.email, u.role, ap.full_name, ap.department
                    FROM Users u
                    JOIN AdminProfiles ap ON u.id = ap.user_id
                    WHERE u.id = @id
                      AND LOWER(REPLACE(REPLACE(u.role, ' ', '_'), '-', '_')) IN ('department_admin', 'dept_admin', 'deptadmin', 'department', 'admin', 'chairperson')", conn);
                findCmd.Parameters.AddWithValue("id", id);

                using var reader = await findCmd.ExecuteReaderAsync();
                if (!await reader.ReadAsync())
                {
                    return NotFound(new { status = "Error", message = "Department admin/chairperson not found." });
                }

                string userEmail = reader.GetString(0);
                string userRole = reader.GetString(1);
                string userName = reader.IsDBNull(2) ? userEmail : reader.GetString(2);
                string department = reader.IsDBNull(3) ? "Unassigned" : reader.GetString(3);
                await reader.CloseAsync();

                using var client = _httpClientFactory.CreateClient("FabricCAClient");
                var apiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
                client.DefaultRequestHeaders.Add("x-api-key", apiKey);

                var payload = new { username = userEmail, role = userRole };
                var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                var middlewareUrl = _configuration["Middleware:Url"] ?? _configuration["MIDDLEWARE_URL"] ?? "http://127.0.0.1:4000";
                var response = await client.PostAsync($"{middlewareUrl}/api/revoke", content);

                if (!response.IsSuccessStatusCode)
                {
                    var errBody = await response.Content.ReadAsStringAsync();
                    if (errBody.Contains("already revoked") || errBody.Contains("already inactive") || errBody.Contains("does not exist") || errBody.Contains("not found"))
                    {
                        _logger.LogWarning("Chairperson account {Email} is already revoked or missing from the Fabric wallet/CA.", userEmail);
                    }
                    else
                    {
                        return StatusCode(502, new { status = "Error", message = $"Fabric revocation failed: {errBody}" });
                    }
                }

                using var tx = await conn.BeginTransactionAsync();

                using var delProfileCmd = new NpgsqlCommand("DELETE FROM AdminProfiles WHERE user_id = @id", conn, tx);
                delProfileCmd.Parameters.AddWithValue("id", id);
                await delProfileCmd.ExecuteNonQueryAsync();

                using var deleteCmd = new NpgsqlCommand("DELETE FROM Users WHERE id = @id", conn, tx);
                deleteCmd.Parameters.AddWithValue("id", id);
                await deleteCmd.ExecuteNonQueryAsync();

                await tx.CommitAsync();

                await SafeInsertAuthAuditLogAsync(
                    conn,
                    "SYSTEM-AUTH",
                    userEmail,
                    "REVOKED",
                    $"Chairperson Access Revoked ({department})",
                    User.Identity?.Name ?? "Admin"
                );

                _cache.Remove("approved_department_admins");
                await SafeNotifyAcademicDataChangedAsync("department_admin_revoked", department, userEmail);
                return Ok(new { status = "Success", message = $"{userName} access revoked." });
            }
            catch (Exception ex) { return StatusCode(500, new { status = "Error", message = ex.Message }); }
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
                    WHERE u.role = 'faculty' AND u.status = 'APPROVED'
                    UNION
                    SELECT u.id, ap.full_name, u.email, ap.department, 'Unassigned' as section, 'Unassigned' as year_level 
                    FROM Users u JOIN AdminProfiles ap ON u.id = ap.user_id 
                    WHERE LOWER(REPLACE(REPLACE(u.role, ' ', '_'), '-', '_')) IN ('department_admin', 'dept_admin', 'deptadmin', 'department', 'admin', 'chairperson') 
                      AND u.status = 'APPROVED'", conn))
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

                string userEmail = "", userName = "Faculty";
                using (var cmdEmail = new NpgsqlCommand(@"
                    SELECT u.email, COALESCE(fp.full_name, ap.full_name) 
                    FROM Users u 
                    LEFT JOIN FacultyProfiles fp ON u.id = fp.user_id 
                    LEFT JOIN AdminProfiles ap ON u.id = ap.user_id 
                    WHERE u.id = @id", conn))
                {
                    cmdEmail.Parameters.AddWithValue("id", id); 
                    using var reader = await cmdEmail.ExecuteReaderAsync();
                    if (await reader.ReadAsync())
                    {
                        userEmail = reader.GetString(0);
                        userName = reader.GetString(1);
                    }
                }

                string updateProfileQuery = "UPDATE FacultyProfiles SET department = @dept WHERE user_id = @id AND (department IS NULL OR department = 'Unassigned')";
                using var cmdProfile = new NpgsqlCommand(updateProfileQuery, conn);
                cmdProfile.Parameters.AddWithValue("dept", (object?)request.Department?.Trim() ?? DBNull.Value);
                cmdProfile.Parameters.AddWithValue("id", id);
                await cmdProfile.ExecuteNonQueryAsync();

                string insertSectionQuery = @"
                    INSERT INTO FacultySections (user_id, department, section, year_level, subject) 
                    VALUES (@id, @dept, @section, @year, @subj)
                    ON CONFLICT (user_id, department, section, subject) DO NOTHING";
                
                using var cmdSection = new NpgsqlCommand(insertSectionQuery, conn);
                cmdSection.Parameters.AddWithValue("id", id);
                cmdSection.Parameters.AddWithValue("dept", (object?)request.Department?.Trim() ?? DBNull.Value);
                cmdSection.Parameters.AddWithValue("section", (object?)request.Section?.Trim() ?? DBNull.Value);
                cmdSection.Parameters.AddWithValue("year", (object?)request.YearLevel?.Trim() ?? DBNull.Value);
                cmdSection.Parameters.AddWithValue("subj", request.Subject != null ? (object)request.Subject.Trim() : DBNull.Value);

                int rows = await cmdSection.ExecuteNonQueryAsync();
                
                if (rows == 0) 
                {
                    return Ok(new { status = "Info", message = $"Faculty is already assigned to {request.Department} Section {request.Section}." });
                }

                var emailSubject = "PLV Faculty Assignment";
                var emailContent = $"<p>Hello {userName},</p><p>You have been officially assigned to handle Section <strong>{request.Section}</strong> ({request.YearLevel}) for the <strong>{request.Department}</strong> department.</p>";
                _ = _emailService.SendEmailAsync(userEmail, emailSubject, CreateHtmlEmail(emailSubject, emailContent), true);

               _cache.Remove("approved_faculties");
                await NotifyAcademicDataChangedAsync("faculty_assigned", request.Department, userEmail);
                return Ok(new { status = "Success", message = "Faculty assigned successfully." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpDelete("faculty/{id}/revoke")]
        [Authorize(Roles = "registrar,admin")]
        public async Task<IActionResult> RevokeFaculty(int id)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                using var findCmd = new NpgsqlCommand("SELECT email, role FROM Users WHERE id = @id AND role = 'faculty'", conn);
                findCmd.Parameters.AddWithValue("id", id);
                using var reader = await findCmd.ExecuteReaderAsync();

                if (!await reader.ReadAsync())
                {
                    return NotFound(new { status = "Error", message = "Faculty not found." });
                }
                string userEmail = reader.GetString(0);
                string userRole = reader.GetString(1);
                await reader.CloseAsync();

                using var client = _httpClientFactory.CreateClient("FabricCAClient");
                var apiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
                client.DefaultRequestHeaders.Add("x-api-key", apiKey);

                var payload = new { username = userEmail, role = userRole };
                var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                var middlewareUrl = _configuration["Middleware:Url"] ?? _configuration["MIDDLEWARE_URL"] ?? "http://127.0.0.1:4000";
                var response = await client.PostAsync($"{middlewareUrl}/api/revoke", content);
                
                if (!response.IsSuccessStatusCode)
                {
                    var errBody = await response.Content.ReadAsStringAsync();
                    if (errBody.Contains("already revoked") || errBody.Contains("already inactive"))
                        _logger.LogWarning("WBSD 1.29.2: Account {Email} is already revoked on the CA.", userEmail);
                }

                using var tx = await conn.BeginTransactionAsync();

                using var delSecCmd = new NpgsqlCommand("DELETE FROM FacultySections WHERE user_id = @id", conn, tx);
                delSecCmd.Parameters.AddWithValue("id", id);
                await delSecCmd.ExecuteNonQueryAsync();

                using var delProfileCmd = new NpgsqlCommand("DELETE FROM FacultyProfiles WHERE user_id = @id", conn, tx);
                delProfileCmd.Parameters.AddWithValue("id", id);
                await delProfileCmd.ExecuteNonQueryAsync();

                using var deleteCmd = new NpgsqlCommand("DELETE FROM Users WHERE id = @id", conn, tx);
                deleteCmd.Parameters.AddWithValue("id", id);
                await deleteCmd.ExecuteNonQueryAsync();

                await tx.CommitAsync();

                await SafeInsertAuthAuditLogAsync(
                    conn,
                    "SYSTEM-AUTH",
                    userEmail,
                    "REVOKED",
                    "Faculty Access Revoked",
                    User.Identity?.Name ?? "Admin"
                );

                _cache.Remove("approved_faculties");
                await SafeNotifyAcademicDataChangedAsync("faculty_revoked", null, userEmail);
                return Ok(new { status = "Success", message = "Faculty access revoked." });
            }
            catch (Exception ex) { return StatusCode(500, new { status = "Error", message = ex.Message }); }
        }

        private string NormalizeDept(string dept)
        {
            var d = (dept ?? "").ToLower().Trim();
            if (d == "it" || d == "bsit" || d.Contains("information technology")) return "it";
            if (d == "cpe" || d == "bscpe" || d.Contains("computer engineering")) return "cpe";
            if (d == "ece" || d == "bsece" || d.Contains("electrical engineering") || d.Contains("electronics")) return "ece";
            if (d == "ce" || d == "bsce" || d.Contains("civil engineering")) return "ce";
            if (d.Contains("accountancy")) return "acc";
            if (d.Contains("financial")) return "fm";
            if (d.Contains("marketing")) return "mm";
            if (d.Contains("human resource")) return "hrm";
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

                await NotifyAcademicDataChangedAsync("faculty_section_unassigned", department, email);
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
                      AND sp.assignment_status IN ('Enrolled', 'Pending Department Approval')
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

                await NotifyAcademicDataChangedAsync("student_enrollment_approved", dept, userEmail);
                return Ok(new { status = "Success", message = "Student officially enrolled in the department!" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost("students/bulk-upload")]
        [Consumes("multipart/form-data")]
        public async Task<IActionResult> BulkUploadStudents([FromForm] IFormFile file, [FromForm] string? defaultDepartment, [FromForm] string? mode)
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { status = "Error", message = "A .csv or .xlsx file is required." });

            var normalizedMode = string.Equals(mode, "update", StringComparison.OrdinalIgnoreCase) ? "update" : "enroll";

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
                var parsedHeaders = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                string NormalizeHeader(string s) => System.Text.RegularExpressions.Regex.Replace(s.Trim().ToLower(), @"[^a-z0-9]+", "_").Trim('_');

                if (ext == ".xlsx")
                {
                    using var workbook = new XLWorkbook(tempFile);
                    var ws = workbook.Worksheet(1);
                    var headerRow = ws.FirstRowUsed();
                    var headerMap = new Dictionary<string, int>();
                    
                    if (headerRow != null)
                    {
                        foreach (var cell in headerRow.CellsUsed())
                        {
                            var normalizedHeader = NormalizeHeader(cell.Value.ToString() ?? "");
                            if (!string.IsNullOrEmpty(normalizedHeader)) {
                                headerMap[normalizedHeader] = cell.Address.ColumnNumber;
                                parsedHeaders.Add(normalizedHeader);
                            }
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

                        string[] fields;
                        if (line.Contains('\t')) fields = line.Split('\t');
                        else if (line.Contains(';')) fields = line.Split(';');
                        else fields = line.Split(',');

                        if (lineNum == 1)
                        {
                            headerMap = new Dictionary<string, int>();
                            for (int i = 0; i < fields.Length; i++)
                            {
                                var normalizedHeader = NormalizeHeader(fields[i]);
                                if (!string.IsNullOrEmpty(normalizedHeader)) {
                                    headerMap[normalizedHeader] = i;
                                    parsedHeaders.Add(normalizedHeader);
                                }
                            }
                            continue;
                        }

                        var dict = new Dictionary<string, string>();
                        if (headerMap != null) {
                            foreach (var kvp in headerMap)
                            {
                                if (kvp.Value < fields.Length)
                                    dict[kvp.Key] = fields[kvp.Value].Trim().Trim('"');
                            }
                        }
                        parsedRecords.Add(dict);
                    }
                }

                int successCount = 0;
                int failureCount = 0;
                var errors = new List<object>();

                var requiredGroups = new List<string[]>
                {
                    new[] { "student_id", "student_no", "student_number", "id_number" }
                };

                if (normalizedMode != "update")
                {
                    requiredGroups.Add(new[] { "birthday", "dob", "date_of_birth" });
                    
                    bool hasFullName = parsedHeaders.Contains("name") || parsedHeaders.Contains("full_name") || parsedHeaders.Contains("student_name");
                    bool hasFirstLast = parsedHeaders.Any(h => h.Contains("first")) && parsedHeaders.Any(h => h.Contains("last"));
                    
                    if (!hasFullName && !hasFirstLast)
                    {
                        requiredGroups.Add(new[] { "first_name", "firstname", "given_name", "name", "full_name" });
                        requiredGroups.Add(new[] { "last_name", "lastname", "surname" });
                    }
                }

                var missingGroups = requiredGroups
                    .Where(group => !group.Any(h => parsedHeaders.Contains(h)))
                    .Select(group => group[0])
                    .ToList();

                if (missingGroups.Count > 0)
                {
                    return BadRequest(new
                    {
                        status = "Error",
                        message = $"Missing required column(s): {string.Join(", ", missingGroups)}",
                        missingColumns = missingGroups
                    });
                }

                using var httpClient = _httpClientFactory.CreateClient("FabricCAClient");
                var apiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
                httpClient.DefaultRequestHeaders.Add("x-api-key", apiKey);
                var middlewareUrl = _configuration["Middleware:Url"] ?? _configuration["MIDDLEWARE_URL"] ?? "http://127.0.0.1:4000";

                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                for (int index = 0; index < parsedRecords.Count; index++)
                {
                    var record = parsedRecords[index];
                    var rowNumber = index + 2;
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
                        string studentNo = GetVal("student_id", "student_no", "student_number", "id_number");
                        string firstName = GetVal("first_name", "firstname", "given_name");
                        string lastName = GetVal("last_name", "lastname", "surname");
                        string middleName = GetVal("middle_name", "middlename", "middle");
                        string sex = GetVal("sex", "gender");
                        string email = GetVal("email", "email_address");
                        string phone = GetVal("number", "phone", "contact_number", "mobile_number");
                        string address = GetVal("address", "home_address");
                        string dobStr = GetVal("birthday", "dob", "date_of_birth");
                        string section = GetVal("section", "class_section");
                        string dept = GetVal("department", "course", "program");
                        
                        string name = GetVal("name", "full_name", "student_name");
                        if (string.IsNullOrEmpty(name)) {
                            name = $"{firstName} {middleName} {lastName}".Replace("  ", " ").Trim();
                        }

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
                        var invalidColumns = new List<string>();
                        if (string.IsNullOrEmpty(studentNo)) invalidColumns.Add("student_id");
                        
                        if (normalizedMode != "update") 
                        {
                            if (string.IsNullOrEmpty(name)) invalidColumns.Add("name (or first/last name)");
                            if (string.IsNullOrEmpty(dobStr)) invalidColumns.Add("birthday");
                        }

                        if (invalidColumns.Count > 0)
                            throw new Exception($"Missing required value(s) in column(s): {string.Join(", ", invalidColumns)}");

                        string loginId = studentNo; 
                        if (string.IsNullOrEmpty(email)) email = $"{loginId}@plv.edu.ph";

                        email = email.Trim().ToLower();
                        loginId = loginId.Trim().ToLower();
                        dobStr = dobStr.Trim();
                        middleName = middleName.Trim();
                        sex = sex.Trim();
                        phone = phone.Trim();
                        address = address.Trim();
                        if (!System.Text.RegularExpressions.Regex.IsMatch(loginId, @"^\d{2,4}-\d{4,}$"))
                            throw new Exception("Invalid value in column 'student_id'. Use xx-xxxx or xxxx-xxxx.");
                        
                        if (normalizedMode != "update" && !System.Text.RegularExpressions.Regex.IsMatch(dobStr, @"^\d{2}/\d{2}/\d{4}$") && !DateTime.TryParse(dobStr, out _))
                            throw new Exception("Invalid value in column 'birthday'. Use MM/DD/YYYY.");

                        string password = dobStr;

                        // Parse Birthday if available
                        DateTime? dobDate = null;
                        if (!string.IsNullOrEmpty(dobStr))
                        {
                            if (DateTime.TryParseExact(dobStr, "MM/dd/yyyy", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out DateTime parsedDob))
                            {
                                dobDate = parsedDob;
                            }
                            else if (DateTime.TryParse(dobStr, out DateTime fallbackDob))
                            {
                                dobDate = fallbackDob;
                                password = fallbackDob.ToString("MM/dd/yyyy");
                            }
                        }
                        
                        if (normalizedMode != "update" && !dobDate.HasValue) throw new Exception("Invalid value in column 'birthday'. Use MM/DD/YYYY.");

                        using var checkCmd = new NpgsqlCommand("SELECT id FROM Users WHERE email = @email OR email = @loginId", conn);
                        checkCmd.Parameters.AddWithValue("email", email);
                        checkCmd.Parameters.AddWithValue("loginId", loginId);
                        var existingIdObj = await checkCmd.ExecuteScalarAsync();
                        long exists = existingIdObj != null ? 1 : 0;

                        using var tx = await conn.BeginTransactionAsync();
                        
                        if (exists > 0)
                        {
                            if (normalizedMode != "update")
                                throw new Exception("Student already exists. Use Bulk Update Info instead.");

                            using var updateStatusCmd = new NpgsqlCommand("UPDATE Users SET status = 'APPROVED', password_hash = crypt(@password, gen_salt('bf', 12)) WHERE id = @id RETURNING id", conn, tx);
                            updateStatusCmd.Parameters.AddWithValue("id", Convert.ToInt32(existingIdObj));
                            updateStatusCmd.Parameters.AddWithValue("password", password);
                            int userId = (int)(await updateStatusCmd.ExecuteScalarAsync() ?? 0);

                            if (userId > 0)
                            {
                                using var updateProfile = new NpgsqlCommand(@"
                                    UPDATE StudentProfiles 
                                    SET full_name = COALESCE(@name, full_name),
                                        student_no = COALESCE(@studentno, student_no),
                                        department = COALESCE(@dept, department),
                                        section = COALESCE(@sec, section),
                                        date_of_birth = COALESCE(@dob, date_of_birth),
                                        student_email = COALESCE(@studentEmail, student_email),
                                        middle_name = COALESCE(@middleName, middle_name),
                                        sex = COALESCE(@sex, sex),
                                        phone = COALESCE(@phone, phone),
                                        address = COALESCE(@address, address),
                                        assignment_status = 'Enrolled'
                                    WHERE user_id = @uid", conn, tx);
                                updateProfile.Parameters.AddWithValue("name", !string.IsNullOrEmpty(name) ? (object)name : DBNull.Value);
                                updateProfile.Parameters.AddWithValue("studentno", !string.IsNullOrEmpty(studentNo) ? (object)studentNo : DBNull.Value);
                                updateProfile.Parameters.AddWithValue("dept", (object?)dept ?? DBNull.Value);
                                updateProfile.Parameters.AddWithValue("sec", string.IsNullOrEmpty(section) ? DBNull.Value : (object)section);
                                updateProfile.Parameters.AddWithValue("dob", dobDate.HasValue ? (object)dobDate.Value.Date : DBNull.Value);
                                updateProfile.Parameters.AddWithValue("studentEmail", string.IsNullOrEmpty(email) ? DBNull.Value : (object)email);
                                updateProfile.Parameters.AddWithValue("middleName", string.IsNullOrEmpty(middleName) ? DBNull.Value : (object)middleName);
                                updateProfile.Parameters.AddWithValue("sex", string.IsNullOrEmpty(sex) ? DBNull.Value : (object)sex);
                                updateProfile.Parameters.AddWithValue("phone", string.IsNullOrEmpty(phone) ? DBNull.Value : (object)phone);
                                updateProfile.Parameters.AddWithValue("address", string.IsNullOrEmpty(address) ? DBNull.Value : (object)address);
                                updateProfile.Parameters.AddWithValue("uid", userId);
                                await updateProfile.ExecuteNonQueryAsync();
                            }
                        }
                        else
                        {
                            if (normalizedMode == "update")
                                throw new Exception("Student does not exist yet. Use Bulk Enroll first.");

                            using var cmdUser = new NpgsqlCommand("INSERT INTO Users (email, password_hash, role, status) VALUES (@email, crypt(@password, gen_salt('bf', 12)), 'student', 'APPROVED') RETURNING id", conn, tx);
                            cmdUser.Parameters.AddWithValue("email", loginId);
                            cmdUser.Parameters.AddWithValue("password", password);
                            int userId = (int)(await cmdUser.ExecuteScalarAsync() ?? throw new Exception("Failed to retrieve new User ID"));

                            using var cmdProfile = new NpgsqlCommand(@"
                                INSERT INTO StudentProfiles (user_id, full_name, student_no, department, section, date_of_birth, student_email, middle_name, sex, phone, address, assignment_status) 
                                VALUES (@uid, @name, @studentno, @dept, @sec, @dob, @studentEmail, @middleName, @sex, @phone, @address, 'Enrolled')", conn, tx);
                            cmdProfile.Parameters.AddWithValue("uid", userId);
                            cmdProfile.Parameters.AddWithValue("name", !string.IsNullOrEmpty(name) ? (object)name : DBNull.Value);
                            cmdProfile.Parameters.AddWithValue("studentno", !string.IsNullOrEmpty(studentNo) ? (object)studentNo : DBNull.Value);
                            cmdProfile.Parameters.AddWithValue("dept", !string.IsNullOrEmpty(dept) ? (object)dept : DBNull.Value);
                            cmdProfile.Parameters.AddWithValue("sec", string.IsNullOrEmpty(section) ? DBNull.Value : (object)section);
                            cmdProfile.Parameters.AddWithValue("dob", dobDate.HasValue ? (object)dobDate.Value.Date : DBNull.Value);
                            cmdProfile.Parameters.AddWithValue("studentEmail", string.IsNullOrEmpty(email) ? DBNull.Value : (object)email);
                            cmdProfile.Parameters.AddWithValue("middleName", string.IsNullOrEmpty(middleName) ? DBNull.Value : (object)middleName);
                            cmdProfile.Parameters.AddWithValue("sex", string.IsNullOrEmpty(sex) ? DBNull.Value : (object)sex);
                            cmdProfile.Parameters.AddWithValue("phone", string.IsNullOrEmpty(phone) ? DBNull.Value : (object)phone);
                            cmdProfile.Parameters.AddWithValue("address", string.IsNullOrEmpty(address) ? DBNull.Value : (object)address);
                            await cmdProfile.ExecuteNonQueryAsync();
                        }

                        await tx.CommitAsync();

                        if (exists == 0)
                        {
                            // Fabric Wallet Generation
                            var payload = new { email = loginId, role = "student", password = password };
                            var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                            var fabResponse = await httpClient.PostAsync($"{middlewareUrl}/api/fabric/register-user", content);
                            
                            if (!fabResponse.IsSuccessStatusCode)
                            {
                                string errBody = await fabResponse.Content.ReadAsStringAsync();
                                throw new Exception($"Blockchain wallet registration failed: {errBody}");
                            }
                        }

                        successCount++;
                    }
                    catch (Exception rowEx)
                    {
                        failureCount++;
                        var studentIdVal = GetVal("student_id", "student_no", "student_number", "id_number");
                        errors.Add(new
                        {
                            row = rowNumber,
                            identifier = !string.IsNullOrWhiteSpace(studentIdVal) ? studentIdVal : "Unknown",
                            reason = rowEx.Message
                        });
                    }
                }

                // Invalidate Caches so UI immediately shows new students
                _cache.Remove("approved_students");
                _cache.Remove("pending_requests");

                await NotifyAcademicDataChangedAsync("students_bulk_uploaded", defaultDepartment, User.Identity?.Name);
                return Ok(new
                {
                    status = failureCount == 0 ? "Success" : "Partial Success",
                    totalProcessed = successCount + failureCount,
                    successful = successCount,
                    failed = failureCount,
                    errors = errors.Any() ? errors : null,
                    message = normalizedMode == "update"
                        ? (failureCount > 0
                            ? $"{successCount} student record(s) updated successfully. {failureCount} row(s) need attention."
                            : $"{successCount} student record(s) updated successfully.")
                        : (failureCount > 0
                            ? $"{successCount} students automatically enrolled and approved. {failureCount} row(s) need attention."
                            : $"{successCount} students automatically enrolled and approved.")
                });
            }
            finally
            {
                if (System.IO.File.Exists(tempFile))
                    System.IO.File.Delete(tempFile);
            }
        }

        private string? ResolveEmailLogoPath()
        {
            var configuredPath =
                _configuration["Email:LogoPath"] ??
                _configuration["Smtp:LogoPath"] ??
                _configuration["PlvLogoPath"];

            var candidates = new[]
            {
                configuredPath,
                Path.Combine(Directory.GetCurrentDirectory(), "plvlogo.png"),
                Path.Combine(Directory.GetCurrentDirectory(), "assets", "plvlogo.png"),
                Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "plvlogo.png"),
                Path.Combine(Directory.GetCurrentDirectory(), "frontend", "plvlogo.png"),
                Path.Combine(Directory.GetCurrentDirectory(), "frontend", "public", "plvlogo.png"),
                Path.Combine(Directory.GetCurrentDirectory(), "frontend", "src", "assets", "plvlogo.png"),
                Path.Combine(Directory.GetCurrentDirectory(), "..", "frontend", "src", "assets", "plvlogo.png"),
                Path.Combine(AppContext.BaseDirectory, "assets", "plvlogo.png"),
                Path.Combine(AppContext.BaseDirectory, "plvlogo.png"),
                Path.Combine(AppContext.BaseDirectory, "..", "assets", "plvlogo.png"),
                Path.Combine(AppContext.BaseDirectory, "..", "frontend", "src", "assets", "plvlogo.png"),
                Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "frontend", "src", "assets", "plvlogo.png"),
                Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "client-app", "assets", "plvlogo.png")
            };

            foreach (var candidate in candidates.Where(c => !string.IsNullOrWhiteSpace(c)))
            {
                try
                {
                    var fullPath = Path.GetFullPath(candidate!);
                    if (System.IO.File.Exists(fullPath)) return fullPath;
                }
                catch
                {
                    // Ignore malformed configured paths and continue through the known locations.
                }
            }

            return null;
        }

        private string CreateHtmlEmail(string subject, string content, bool useInlineLogo = false)
        {
            var year = DateTime.UtcNow.Year;
            var imagePath = ResolveEmailLogoPath();
            string logoSrc;
            
            if (useInlineLogo && imagePath != null)
            {
                logoSrc = $"cid:{EmailLogoContentId}";
            }
            else if (imagePath != null)
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
                var normalizedRole = NormalizeSystemRole(role);

                string query = "";
                NpgsqlCommand cmd;
                UserProfileDto? userProfile = null;

                // Base query to get user info
                string baseQuery = "SELECT u.id, u.email, u.role, u.status, ";

                if (normalizedRole == "student")
                {
                    query = baseQuery + "sp.full_name, sp.department, sp.student_no, sp.section, sp.date_of_birth, sp.student_email, sp.middle_name, sp.phone, sp.address, sp.sex FROM Users u JOIN StudentProfiles sp ON u.id = sp.user_id WHERE u.email = @email";
                    cmd = new NpgsqlCommand(query, conn);
                    cmd.Parameters.AddWithValue("email", email);
                    using var reader = await cmd.ExecuteReaderAsync();
                    if (await reader.ReadAsync())
                    {
                        userProfile = new UserProfileDto
                        {
                            Id = reader.GetInt32(0),
                            Email = reader.GetString(1),
                            Role = NormalizeSystemRole(reader.GetString(2)),
                            Status = reader.GetString(3),
                            FullName = reader.GetString(4),
                            Department = reader.IsDBNull(5) ? null : reader.GetString(5),
                            StudentNo = reader.IsDBNull(6) ? null : reader.GetString(6),
                            Section = reader.IsDBNull(7) ? null : reader.GetString(7),
                            DateOfBirth = reader.IsDBNull(8) ? null : reader.GetDateTime(8).ToString("MM/dd/yyyy"),
                            StudentEmail = reader.IsDBNull(9) ? null : reader.GetString(9),
                            MiddleName = reader.IsDBNull(10) ? null : reader.GetString(10),
                            Phone = reader.IsDBNull(11) ? null : reader.GetString(11),
                            Address = reader.IsDBNull(12) ? null : reader.GetString(12),
                            Sex = reader.IsDBNull(13) ? null : reader.GetString(13)
                        };
                    }
                }
                else if (normalizedRole == "faculty")
                {
                    query = baseQuery + "fp.full_name, fp.department, fp.section, fp.year_level, fp.faculty_type FROM Users u JOIN FacultyProfiles fp ON u.id = fp.user_id WHERE u.email = @email";
                    cmd = new NpgsqlCommand(query, conn);
                    cmd.Parameters.AddWithValue("email", email);
                    using var reader = await cmd.ExecuteReaderAsync();
                    if (await reader.ReadAsync())
                    {
                        userProfile = new UserProfileDto
                        {
                            Id = reader.GetInt32(0),
                            Email = reader.GetString(1),
                            Role = NormalizeSystemRole(reader.GetString(2)),
                            Status = reader.GetString(3),
                            FullName = reader.GetString(4),
                            Department = reader.IsDBNull(5) ? null : reader.GetString(5),
                            Section = reader.IsDBNull(6) ? null : reader.GetString(6),
                            YearLevel = reader.IsDBNull(7) ? null : reader.GetString(7),
                            FacultyType = reader.IsDBNull(8) ? null : reader.GetString(8)
                        };
                    }
                }
                else if (normalizedRole == "registrar" || normalizedRole == "department_admin") 
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
                            Role = NormalizeSystemRole(reader.GetString(2)),
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
                if (normalizedRole == "student" && !string.IsNullOrEmpty(userProfile.Section))
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

        [HttpPost("bulk-masterlist")]
        [Consumes("multipart/form-data")]
        public async Task<IActionResult> BulkMasterlistUpload([FromForm] IFormFile file, [FromForm] string department)
        {
            if (file == null || file.Length == 0) return BadRequest(new { status = "Error", message = "A .csv or .xlsx file is required." });
            
            var ext = Path.GetExtension(file.FileName).ToLower();
            if (ext != ".csv" && ext != ".xlsx") return BadRequest(new { status = "Error", message = "Only .csv and .xlsx files are supported." });

            var tempFile = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ext);
            try
            {
                using (var fileStream = new FileStream(tempFile, FileMode.Create)) await file.CopyToAsync(fileStream);
                var parsedRecords = new List<Dictionary<string, string>>();
                
                string NormalizeHeader(string s) => System.Text.RegularExpressions.Regex.Replace(s.Trim().ToLower(), @"[^a-z0-9]+", "_").Trim('_');

                if (ext == ".xlsx")
                {
                    using var workbook = new XLWorkbook(tempFile);
                    var ws = workbook.Worksheet(1);
                    var headerRow = ws.FirstRowUsed();
                    var headerMap = new Dictionary<string, int>();
                    if (headerRow != null)
                    {
                        foreach (var cell in headerRow.CellsUsed())
                        {
                            var normalized = NormalizeHeader(cell.Value.ToString() ?? "");
                            if (!string.IsNullOrEmpty(normalized)) headerMap[normalized] = cell.Address.ColumnNumber;
                        }

                        var rows = ws.RowsUsed().Skip(1);
                        foreach (var row in rows)
                        {
                            var dict = new Dictionary<string, string>();
                            foreach (var kvp in headerMap) dict[kvp.Key] = row.Cell(kvp.Value).Value.ToString().Trim();
                            parsedRecords.Add(dict);
                        }
                    }
                }
                else if (ext == ".csv")
                {
                    using var reader = new StreamReader(tempFile, Encoding.UTF8);
                    string? line; int lineNum = 0; Dictionary<string, int>? headerMap = null;
                    while ((line = await reader.ReadLineAsync()) != null)
                    {
                        lineNum++; line = line.Trim(); if (string.IsNullOrEmpty(line)) continue;
                        
                        // Robust CSV splitting (supports comma, semicolon, and tab)
                        string[] fields;
                        if (line.Contains('\t')) fields = line.Split('\t');
                        else if (line.Contains(';')) fields = line.Split(';');
                        else fields = line.Split(',');

                        if (lineNum == 1) 
                        { 
                            headerMap = new Dictionary<string, int>(); 
                            for (int i = 0; i < fields.Length; i++)
                            {
                                var normalized = NormalizeHeader(fields[i]);
                                if (!string.IsNullOrEmpty(normalized)) headerMap[normalized] = i;
                            }
                            continue; 
                        }

                        var dict = new Dictionary<string, string>();
                        if (headerMap != null) {
                            foreach (var kvp in headerMap)
                                if (kvp.Value < fields.Length) dict[kvp.Key] = fields[kvp.Value].Trim().Trim('"');
                        }
                        parsedRecords.Add(dict);
                    }
                }

                if (parsedRecords.Count == 0)
                {
                    return BadRequest(new { status = "Error", message = "No data records found in the uploaded file. Please check the file format and headers." });
                }

                using var httpClient = _httpClientFactory.CreateClient("FabricCAClient");
                var apiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
                httpClient.DefaultRequestHeaders.Add("x-api-key", apiKey);
                var middlewareUrl = _configuration["Middleware:Url"] ?? _configuration["MIDDLEWARE_URL"] ?? "http://127.0.0.1:4000";

                int successCount = 0;
                int failureCount = 0;
                int skippedCount = 0;
                var errors = new List<object>();

                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var createdFaculties = new HashSet<string>();
                var createdStudents = new HashSet<string>();

                foreach (var record in parsedRecords)
                {
                    string GetVal(params string[] keys)
                    {
                        foreach (var k in keys) if (record.TryGetValue(k, out var val) && !string.IsNullOrWhiteSpace(val)) return val;
                        return "";
                    }

                    try 
                    {
                        string studentNo = GetVal("student_no", "student_number", "id_number", "student_id", "id", "student_no_", "id_no");
                        string lastName = GetVal("last_name", "surname", "last", "lname");
                        string firstName = GetVal("first_name", "given_name", "first", "fname");
                        string mi = GetVal("mi", "middle_initial", "middle_name", "middle", "m_i");
                        string sex = GetVal("sex", "gender");
                        string yearLevel = GetVal("year_level", "year", "level", "yr_lvl", "year_lvl");
                        string section = GetVal("section", "class_section", "sec", "section_num");
                        string subjectCode = GetVal("subject_code", "course_code", "subject", "course", "subj_code", "subj");
                        string facultyName = GetVal("faculty_name", "professor", "instructor", "faculty", "teacher", "prof_name", "prof");
                        string facultyEmail = GetVal("faculty_email", "prof_email", "email", "instructor_email", "prof_email_address");

                        if (string.IsNullOrEmpty(studentNo) || string.IsNullOrEmpty(facultyName) || string.IsNullOrEmpty(subjectCode))
                        {
                            skippedCount++;
                            _logger.LogWarning("Skipping row in Masterlist: Missing StudentNo({S}), Faculty({F}), or Subject({Sub})", 
                                !string.IsNullOrEmpty(studentNo), !string.IsNullOrEmpty(facultyName), !string.IsNullOrEmpty(subjectCode));
                            continue;
                        }

                        string profLoginId = !string.IsNullOrWhiteSpace(facultyEmail) ? facultyEmail : facultyName;
                        string studentLoginId = studentNo.Trim(); 
                        string studentPassword = studentNo.Trim(); 
                        string fullName = $"{firstName} {mi} {lastName}".Replace("  ", " ").Trim();
                        if (string.IsNullOrEmpty(fullName)) fullName = "Student " + studentLoginId;

                        using var tx = await conn.BeginTransactionAsync();

                        // 1. Resolve and Autocreate Faculty
                        int facultyUserId = 0;
                        using (var checkFac = new NpgsqlCommand("SELECT id FROM Users WHERE LOWER(email) = LOWER(@email)", conn, tx))
                        {
                            checkFac.Parameters.AddWithValue("email", profLoginId);
                            var fIdObj = await checkFac.ExecuteScalarAsync();
                            if (fIdObj != null && fIdObj != DBNull.Value) facultyUserId = Convert.ToInt32(fIdObj);
                        }

                        if (facultyUserId == 0)
                        {
                            using var cmdUser = new NpgsqlCommand("INSERT INTO Users (email, password_hash, role, status) VALUES (@email, crypt(@password, gen_salt('bf', 12)), 'faculty', 'APPROVED') RETURNING id", conn, tx);
                            cmdUser.Parameters.AddWithValue("email", profLoginId);
                            cmdUser.Parameters.AddWithValue("password", "plvfaculty123"); 
                            facultyUserId = Convert.ToInt32(await cmdUser.ExecuteScalarAsync());

                            using var cmdProfile = new NpgsqlCommand("INSERT INTO FacultyProfiles (user_id, full_name, department) VALUES (@uid, @name, @dept)", conn, tx);
                            cmdProfile.Parameters.AddWithValue("uid", facultyUserId);
                            cmdProfile.Parameters.AddWithValue("name", facultyName);
                            cmdProfile.Parameters.AddWithValue("dept", department);
                            await cmdProfile.ExecuteNonQueryAsync();

                            if (!createdFaculties.Contains(profLoginId.ToLower()))
                            {
                                try {
                                    var payload = new { email = profLoginId, role = "faculty", password = "plvfaculty123" };
                                    var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                                    var fabResponse = await httpClient.PostAsync($"{middlewareUrl}/api/fabric/register-user", content);
                                    if (!fabResponse.IsSuccessStatusCode) _logger.LogWarning("Fabric Faculty wallet creation failed (skipping): {Body}", await fabResponse.Content.ReadAsStringAsync());
                                    createdFaculties.Add(profLoginId.ToLower());
                                } catch (Exception ex) { _logger.LogError(ex, "Fabric communication error for faculty {E}", profLoginId); }
                            }
                        }

                        // 2. Create Section Mapping
                        string fullSection = $"{yearLevel}-{section}";
                        using var cmdSec = new NpgsqlCommand("INSERT INTO AcademicSections (department, year_level, section_num) VALUES (@dept, @year, @sec) ON CONFLICT DO NOTHING", conn, tx);
                        cmdSec.Parameters.AddWithValue("dept", department);
                        cmdSec.Parameters.AddWithValue("year", int.TryParse(yearLevel, out int yl) ? yl : 1);
                        cmdSec.Parameters.AddWithValue("sec", int.TryParse(section, out int sn) ? sn : 1);
                        await cmdSec.ExecuteNonQueryAsync();

                        // Assign Section To Faculty
                        using var cmdAssign = new NpgsqlCommand(@"
                            INSERT INTO FacultySections (user_id, department, section, year_level, subject) 
                            VALUES (@uid, @dept, @sec, @year, @subj) 
                            ON CONFLICT (user_id, department, section, subject) DO NOTHING", conn, tx);
                        cmdAssign.Parameters.AddWithValue("uid", facultyUserId);
                        cmdAssign.Parameters.AddWithValue("dept", department);
                        cmdAssign.Parameters.AddWithValue("sec", section);
                        cmdAssign.Parameters.AddWithValue("year", yearLevel);
                        cmdAssign.Parameters.AddWithValue("subj", subjectCode);
                        await cmdAssign.ExecuteNonQueryAsync();

                        // 3. Resolve and Autocreate Student
                        int studentUserId = 0;
                        using (var checkStu = new NpgsqlCommand("SELECT id FROM Users WHERE LOWER(email) = LOWER(@email)", conn, tx))
                        {
                            checkStu.Parameters.AddWithValue("email", studentLoginId);
                            var sIdObj = await checkStu.ExecuteScalarAsync();
                            if (sIdObj != null && sIdObj != DBNull.Value) studentUserId = Convert.ToInt32(sIdObj);
                        }

                        if (studentUserId == 0)
                        {
                            using var cmdUser = new NpgsqlCommand("INSERT INTO Users (email, password_hash, role, status) VALUES (@email, crypt(@password, gen_salt('bf', 12)), 'student', 'APPROVED') RETURNING id", conn, tx);
                            cmdUser.Parameters.AddWithValue("email", studentLoginId);
                            cmdUser.Parameters.AddWithValue("password", studentPassword);
                            studentUserId = Convert.ToInt32(await cmdUser.ExecuteScalarAsync());

                            using var cmdProfile = new NpgsqlCommand(@"
                                INSERT INTO StudentProfiles (user_id, full_name, student_no, department, section, assignment_status, sex) 
                                VALUES (@uid, @name, @studentno, @dept, @sec, 'Enrolled', @sex)", conn, tx);
                            cmdProfile.Parameters.AddWithValue("uid", studentUserId);
                            cmdProfile.Parameters.AddWithValue("name", fullName);
                            cmdProfile.Parameters.AddWithValue("studentno", !string.IsNullOrEmpty(studentNo) ? (object)studentNo : DBNull.Value);
                            cmdProfile.Parameters.AddWithValue("dept", department);
                            cmdProfile.Parameters.AddWithValue("sec", fullSection);
                            cmdProfile.Parameters.AddWithValue("sex", !string.IsNullOrEmpty(sex) ? (object)sex : DBNull.Value);
                            await cmdProfile.ExecuteNonQueryAsync();

                            if (!createdStudents.Contains(studentLoginId.ToLower()))
                            {
                                try {
                                    var payload = new { email = studentLoginId, role = "student", password = studentPassword };
                                    var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                                    var fabResponse = await httpClient.PostAsync($"{middlewareUrl}/api/fabric/register-user", content);
                                    if (!fabResponse.IsSuccessStatusCode) _logger.LogWarning("Fabric Student wallet creation failed (skipping): {Body}", await fabResponse.Content.ReadAsStringAsync());
                                    createdStudents.Add(studentLoginId.ToLower());
                                } catch (Exception ex) { _logger.LogError(ex, "Fabric communication error for student {E}", studentLoginId); }
                            }
                        }
                        else
                        {
                            using var updateProfile = new NpgsqlCommand(@"
                                UPDATE StudentProfiles 
                                SET department = @dept, section = @sec, assignment_status = 'Enrolled'
                                WHERE user_id = @uid", conn, tx);
                            updateProfile.Parameters.AddWithValue("dept", department);
                            updateProfile.Parameters.AddWithValue("sec", fullSection);
                            updateProfile.Parameters.AddWithValue("uid", studentUserId);
                            await updateProfile.ExecuteNonQueryAsync();
                        }

                        await tx.CommitAsync();
                        successCount++;
                    }
                    catch (Exception ex)
                    {
                        failureCount++;
                        errors.Add(new { identifier = GetVal("student_no"), reason = ex.Message });
                        _logger.LogError(ex, "Error processing Masterlist row for student {S}", GetVal("student_no"));
                    }
                }

                try {
                    using var cmdChair = new NpgsqlCommand("SELECT u.email FROM Users u JOIN AdminProfiles ap ON u.id = ap.user_id WHERE ap.department = @dept AND LOWER(REPLACE(REPLACE(u.role, ' ', '_'), '-', '_')) IN ('department_admin', 'dept_admin', 'deptadmin', 'department', 'admin', 'chairperson') AND u.status = 'APPROVED' LIMIT 1", conn);
                    cmdChair.Parameters.AddWithValue("dept", department);
                    var chairEmail = (await cmdChair.ExecuteScalarAsync()) as string;
                    
                    if (!string.IsNullOrEmpty(chairEmail)) {
                        var subject = "PLV System: New Student Masterlist Uploaded";
                        var content = $"<p>Hello,</p><p>A new student masterlist for the <strong>{department}</strong> department has been successfully uploaded and processed. Please log in to the Chairperson portal to review the auto-generated sections and student assignments.</p>";
                        _ = _emailService.SendEmailAsync(chairEmail, subject, CreateHtmlEmail(subject, content), true);
                    }
                } catch (Exception notifyEx) { _logger.LogWarning(notifyEx, "Could not notify chairperson of masterlist upload"); }

                await NotifyAcademicDataChangedAsync("masterlist_uploaded", department, User.Identity?.Name);
                return Ok(new { 
                    status = (successCount > 0 && failureCount == 0) ? "Success" : (successCount > 0 ? "Partial Success" : "Error"), 
                    totalProcessed = parsedRecords.Count,
                    successful = successCount,
                    failed = failureCount,
                    skipped = skippedCount,
                    message = successCount > 0 ? $"Processed Masterlist: {successCount} mapped successfully." : "No records were successfully mapped. Please verify the file headers.",
                    errors = errors.Any() ? errors : null
                });

            }
            catch (Exception ex) { return StatusCode(500, new { status = "Error", message = ex.Message }); }
            finally { if (System.IO.File.Exists(tempFile)) System.IO.File.Delete(tempFile); }
        }

        public class CreateSectionRequest
        {
            [JsonPropertyName("department")]
            public string Department { get; set; } = string.Empty;
            [JsonPropertyName("yearLevel")]
            public string YearLevel { get; set; } = string.Empty;
            [JsonPropertyName("sectionNum")]
            public string SectionNum { get; set; } = string.Empty;
            [JsonPropertyName("assignToEmail")]
            public string? AssignToEmail { get; set; }
            [JsonPropertyName("subject")]
            public string? Subject { get; set; }
        }

        [Authorize]
        [HttpPost("sections")]
        public async Task<IActionResult> CreateSection([FromBody] CreateSectionRequest request)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                using var transaction = await conn.BeginTransactionAsync();

                using var cmd = new NpgsqlCommand("INSERT INTO AcademicSections (department, year_level, section_num) VALUES (@dept, @year, @sec) RETURNING id", conn, transaction);
                cmd.Parameters.AddWithValue("dept", request.Department);
                cmd.Parameters.AddWithValue("year", int.Parse(request.YearLevel));
                cmd.Parameters.AddWithValue("sec", int.Parse(request.SectionNum));
                
                var id = await cmd.ExecuteScalarAsync();

                if (!string.IsNullOrWhiteSpace(request.AssignToEmail))
                {
                    using var cmdUser = new NpgsqlCommand("SELECT id FROM Users WHERE LOWER(email) = LOWER(@email) LIMIT 1", conn, transaction);
                    cmdUser.Parameters.AddWithValue("email", request.AssignToEmail);
                    var userIdObj = await cmdUser.ExecuteScalarAsync();
                    
                    if (userIdObj != null && userIdObj != DBNull.Value)
                    {
                        using var cmdAssign = new NpgsqlCommand(@"
                            INSERT INTO FacultySections (user_id, department, section, year_level, subject) 
                            VALUES (@uid, @dept, @sec, @year, @subj) 
                            ON CONFLICT (user_id, department, section, subject) DO NOTHING", conn, transaction);
                        cmdAssign.Parameters.AddWithValue("uid", Convert.ToInt32(userIdObj));
                        cmdAssign.Parameters.AddWithValue("dept", request.Department);
                        cmdAssign.Parameters.AddWithValue("sec", request.SectionNum);
                        cmdAssign.Parameters.AddWithValue("year", request.YearLevel);
                        cmdAssign.Parameters.AddWithValue("subj", request.Subject != null ? (object)request.Subject.Trim() : DBNull.Value);
                        await cmdAssign.ExecuteNonQueryAsync();
                    }
                }

                await transaction.CommitAsync();

                await NotifyAcademicDataChangedAsync("section_created", request.Department, User.Identity?.Name);
                return Ok(new { status = "Success", message = "Section created successfully", id = id });
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                return BadRequest(new { status = "Error", message = "This section already exists in the department." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [Authorize]
        [HttpGet("sections/department/{department}")]
        public async Task<IActionResult> GetDepartmentSections(string department)
        {
            try
            {
                var sections = new List<object>();
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                using var cmd = new NpgsqlCommand("SELECT id, department, year_level, section_num FROM AcademicSections WHERE department = @dept ORDER BY year_level, section_num", conn);
                cmd.Parameters.AddWithValue("dept", department);

                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    sections.Add(new
                    {
                        id = reader.GetInt32(0).ToString(),
                        department = reader.GetString(1),
                        yearLevel = reader.GetInt32(2).ToString(),
                        sectionNum = reader.GetInt32(3).ToString()
                    });
                }

                return Ok(new { status = "Success", data = sections });
            }
            catch (Exception ex)
            {
                if (ex.Message.Contains("does not exist")) return Ok(new { status = "Success", data = new List<object>() });
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [Authorize]
        [HttpPost("sections/{id}/enroll")]
        [Consumes("multipart/form-data")]
        public async Task<IActionResult> EnrollStudents(string id, [FromForm] IFormFile file)
        {
            if (file == null || file.Length == 0) return BadRequest(new { status = "Error", message = "A .csv or .xlsx file is required." });

            try
            {
                string department = "", yearLevel = "", sectionNum = "";

                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                using (var cmdSec = new NpgsqlCommand("SELECT department, year_level, section_num FROM AcademicSections WHERE id = @id", conn))
                {
                    cmdSec.Parameters.AddWithValue("id", int.Parse(id));
                    using var readerSec = await cmdSec.ExecuteReaderAsync();
                    if (await readerSec.ReadAsync())
                    {
                        department = readerSec.GetString(0);
                        yearLevel = readerSec.GetInt32(1).ToString();
                        sectionNum = readerSec.GetInt32(2).ToString();
                    }
                    else return NotFound(new { status = "Error", message = "Section not found." });
                }

                var ext = Path.GetExtension(file.FileName).ToLower();
                var tempFile = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ext);
                int successCount = 0;
                
                try
                {
                    using (var fileStream = new FileStream(tempFile, FileMode.Create)) await file.CopyToAsync(fileStream);
                    var parsedRecords = new List<Dictionary<string, string>>();

                    if (ext == ".xlsx")
                    {
                        using var workbook = new XLWorkbook(tempFile);
                        var ws = workbook.Worksheet(1);
                        var headerRow = ws.FirstRowUsed();
                        var headerMap = new Dictionary<string, int>();
                        if (headerRow != null)
                        {
                            foreach (var cell in headerRow.CellsUsed())
                                headerMap[cell.Value.ToString().Trim().ToLower().Replace(" ", "_")] = cell.Address.ColumnNumber;

                            var rows = ws.RowsUsed().Skip(1);
                            foreach (var row in rows)
                            {
                                var dict = new Dictionary<string, string>();
                                foreach (var kvp in headerMap) dict[kvp.Key] = row.Cell(kvp.Value).Value.ToString().Trim();
                                parsedRecords.Add(dict);
                            }
                        }
                    }
                    else if (ext == ".csv")
                    {
                        using var reader = new StreamReader(tempFile, Encoding.UTF8);
                        string? line; int lineNum = 0; Dictionary<string, int>? headerMap = null;
                        while ((line = await reader.ReadLineAsync()) != null)
                        {
                            lineNum++; line = line.Trim(); if (string.IsNullOrEmpty(line)) continue;
                            var fields = line.Split(',');
                            if (lineNum == 1) { headerMap = new Dictionary<string, int>(); for (int i = 0; i < fields.Length; i++) headerMap[fields[i].Trim().ToLower().Replace(" ", "_")] = i; continue; }
                            var dict = new Dictionary<string, string>();
                            if (headerMap != null) {
                                foreach (var kvp in headerMap)
                                    if (kvp.Value < fields.Length) dict[kvp.Key] = fields[kvp.Value].Trim();
                            }
                            parsedRecords.Add(dict);
                        }
                    }

                    using var httpClient = _httpClientFactory.CreateClient("FabricCAClient");
                    var apiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
                    httpClient.DefaultRequestHeaders.Add("x-api-key", apiKey);
                    var middlewareUrl = _configuration["Middleware:Url"] ?? _configuration["MIDDLEWARE_URL"] ?? "http://127.0.0.1:4000";

                    foreach (var record in parsedRecords)
                    {
                        string GetVal(params string[] keys)
                        {
                            foreach (var k in keys) if (record.TryGetValue(k, out var val) && !string.IsNullOrWhiteSpace(val)) return val;
                            return "";
                        }

                        try
                        {
                            string name = GetVal("full_name", "name", "student_name");
                            string email = GetVal("email", "email_address");
                            string studentNo = GetVal("student_id", "student_no", "id_number", "studentid", "studentno");
                            string dobStr = GetVal("dob", "birthday", "date_of_birth");
                            
                            if (string.IsNullOrEmpty(email)) email = studentNo;
                            if (string.IsNullOrEmpty(email)) continue;
                            email = email.Trim().ToLower();

                            using var tx = await conn.BeginTransactionAsync();

                            using var checkCmd = new NpgsqlCommand("SELECT id FROM Users WHERE email = @email", conn, tx);
                            checkCmd.Parameters.AddWithValue("email", email);
                            var userIdObj = await checkCmd.ExecuteScalarAsync();

                            if (userIdObj != null)
                            {
                                int userId = (int)userIdObj;
                                using var updateStatusCmd = new NpgsqlCommand("UPDATE Users SET status = 'APPROVED' WHERE id = @id", conn, tx);
                                updateStatusCmd.Parameters.AddWithValue("id", userId);
                                await updateStatusCmd.ExecuteNonQueryAsync();

                                using var updateProfile = new NpgsqlCommand(@"
                                    UPDATE StudentProfiles 
                                    SET department = @dept, section = @sec, assignment_status = 'Enrolled'
                                    WHERE user_id = @id", conn, tx);
                                updateProfile.Parameters.AddWithValue("dept", department);
                                updateProfile.Parameters.AddWithValue("sec", $"{yearLevel}-{sectionNum}");
                                updateProfile.Parameters.AddWithValue("id", userId);
                                await updateProfile.ExecuteNonQueryAsync();
                            }
                            else
                            {
                                if (string.IsNullOrEmpty(name)) name = "Student " + email.Split('@')[0];
                                if (string.IsNullOrEmpty(dobStr)) dobStr = "01/01/2005"; 
                                
                                if (!DateTime.TryParse(dobStr, out DateTime dobDate)) throw new Exception($"Invalid date: {dobStr}");
                                string password = dobDate.ToString("MM/dd/yyyy");

                                using var cmdUser = new NpgsqlCommand("INSERT INTO Users (email, password_hash, role, status) VALUES (@email, crypt(@password, gen_salt('bf', 12)), 'student', 'APPROVED') RETURNING id", conn, tx);
                                cmdUser.Parameters.AddWithValue("email", email);
                                cmdUser.Parameters.AddWithValue("password", password);
                                int userId = (int)(await cmdUser.ExecuteScalarAsync() ?? throw new Exception("Failed to retrieve ID"));

                                using var cmdProfile = new NpgsqlCommand(@"
                                    INSERT INTO StudentProfiles (user_id, full_name, student_no, department, section, date_of_birth, assignment_status) 
                                    VALUES (@uid, @name, @studentno, @dept, @sec, @dob, 'Enrolled')", conn, tx);
                                cmdProfile.Parameters.AddWithValue("uid", userId);
                                cmdProfile.Parameters.AddWithValue("name", name);
                                cmdProfile.Parameters.AddWithValue("studentno", !string.IsNullOrEmpty(studentNo) ? (object)studentNo : DBNull.Value);
                                cmdProfile.Parameters.AddWithValue("dept", department);
                                cmdProfile.Parameters.AddWithValue("sec", $"{yearLevel}-{sectionNum}");
                                cmdProfile.Parameters.AddWithValue("dob", dobDate.Date);
                                await cmdProfile.ExecuteNonQueryAsync();

                                var payload = new { email = email, role = "student", password = password };
                                var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                                var fabResponse = await httpClient.PostAsync($"{middlewareUrl}/api/fabric/register-user", content);
                                if (!fabResponse.IsSuccessStatusCode)
                                {
                                    string errBody = await fabResponse.Content.ReadAsStringAsync();
                                    throw new Exception($"Blockchain wallet registration failed: {errBody}");
                                }
                            }

                            await tx.CommitAsync();
                            successCount++;
                        }
                        catch (Exception)
                        {
                            // Skip row error
                        }
                    }
                }
                finally { if (System.IO.File.Exists(tempFile)) System.IO.File.Delete(tempFile); }
                await NotifyAcademicDataChangedAsync("students_enrolled", department, User.Identity?.Name);
                return Ok(new { status = "Success", message = $"Successfully enrolled {successCount} students into {department} {yearLevel}-{sectionNum}!" });
            }
            catch (Exception ex) { return StatusCode(500, new { status = "Error", message = ex.Message }); }
        }

        [Authorize]
        [HttpDelete("sections/{id}")]
        public async Task<IActionResult> DeleteSection(string id)
        {
            if (!int.TryParse(id, out int sectionId)) return BadRequest(new { status = "Error", message = "Invalid section ID format." });

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                
                string dept = "", year = "", secNum = "";
                using (var getCmd = new NpgsqlCommand("SELECT department, year_level, section_num FROM AcademicSections WHERE id = @id", conn))
                {
                    getCmd.Parameters.AddWithValue("id", sectionId);
                    using var reader = await getCmd.ExecuteReaderAsync();
                    if (await reader.ReadAsync())
                    {
                        dept = reader.GetString(0);
                        year = reader.GetInt32(1).ToString();
                        secNum = reader.GetInt32(2).ToString();
                    }
                    else return Ok(new { status = "Success", message = "Section already deleted." });
                }

                using var tx = await conn.BeginTransactionAsync();

                using var cmdFac = new NpgsqlCommand("DELETE FROM FacultySections WHERE department = @dept AND year_level = @year AND section = @sec", conn, tx);
                cmdFac.Parameters.AddWithValue("dept", dept);
                cmdFac.Parameters.AddWithValue("year", year);
                cmdFac.Parameters.AddWithValue("sec", secNum);
                await cmdFac.ExecuteNonQueryAsync();

                using var cmdSec = new NpgsqlCommand("DELETE FROM AcademicSections WHERE id = @id", conn, tx);
                cmdSec.Parameters.AddWithValue("id", sectionId);
                await cmdSec.ExecuteNonQueryAsync();

                await tx.CommitAsync();
                await NotifyAcademicDataChangedAsync("section_deleted", dept, User.Identity?.Name);
                return Ok(new { status = "Success", message = "Section deleted successfully." });
            }
            catch (Exception ex) { return StatusCode(500, new { status = "Error", message = ex.Message }); }
        }

        [Authorize]
        [HttpDelete("sections/department/{department}")]
        public async Task<IActionResult> DeleteAllDepartmentSections(string department)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var tx = await conn.BeginTransactionAsync();

                using var cmdFac = new NpgsqlCommand("DELETE FROM FacultySections WHERE department = @dept", conn, tx);
                cmdFac.Parameters.AddWithValue("dept", department);
                await cmdFac.ExecuteNonQueryAsync();

                using var cmdSec = new NpgsqlCommand("DELETE FROM AcademicSections WHERE department = @dept", conn, tx);
                cmdSec.Parameters.AddWithValue("dept", department);
                await cmdSec.ExecuteNonQueryAsync();

                await tx.CommitAsync();
                await NotifyAcademicDataChangedAsync("department_sections_deleted", department, User.Identity?.Name);
                return Ok(new { status = "Success", message = $"All academic sections for {department} have been removed." });
            }
            catch (Exception ex) { return StatusCode(500, new { status = "Error", message = ex.Message }); }
        }
    }
}
