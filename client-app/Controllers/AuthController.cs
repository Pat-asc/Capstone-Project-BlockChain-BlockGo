using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace Client_app.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly string _connectionString;

        public AuthController(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("PostgresConnection") 
                ?? "Host=127.0.0.1;Database=ActivityLogs;Username=BLOCKGO;Password=PLVBLOCKGO";
        }

        public class SignupRequest
        {
            public string FullName { get; set; }
            public string Email { get; set; }
            public string Password { get; set; }
            public string Role { get; set; }
            public string Department { get; set; }
            public string? StudentNo { get; set; }
        }

        public class AssignStudentRequest
        {
            public string Department { get; set; }
            public string Section { get; set; }
        }

        public class AssignAdminRequest
        {
            public string Department { get; set; }
        }

        public class AssignFacultyRequest
        {
            public string Department { get; set; }
            public string Section { get; set; }
            public string YearLevel { get; set; }
        }

        [HttpPost("request")]
        public async Task<IActionResult> RequestAccess([FromBody] SignupRequest request)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var transaction = await conn.BeginTransactionAsync();

                // Request password hash from Node.js Middleware
                using var client = new HttpClient();
                var hashPayload = new { password = request.Password };
                var hashContent = new StringContent(JsonSerializer.Serialize(hashPayload), Encoding.UTF8, "application/json");
                var hashResponse = await client.PostAsync("http://localhost:4000/api/crypto/hash-password", hashContent);
                
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

                // 2. Insert into appropriate Profile table
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

                return Ok(new { status = "Success", message = "Registration request added to waitlist." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpGet("requests/pending")]
        public async Task<IActionResult> GetPendingRequests()
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var studentRequests = new List<object>();
                var staffRequests = new List<object>();

                // Fetch Student Requests using JOIN
                using (var cmd = new NpgsqlCommand(@"
                    SELECT u.id, sp.full_name, u.email, sp.department, sp.student_no, u.status 
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
                            department = reader.IsDBNull(3) ? null : reader.GetString(3),
                            studentno = reader.GetString(4),
                            requeststatus = reader.GetString(5)
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

                return Ok(new { status = "Success", studentRequests, staffRequests });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPut("requests/approve/{type}/{id}")]
        public async Task<IActionResult> ApproveRequest(string type, int id)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                string query = "UPDATE Users SET status = 'APPROVED' WHERE id = @id AND status = 'pending' RETURNING email, role";

                using var cmd = new NpgsqlCommand(query, conn);
                cmd.Parameters.AddWithValue("id", id);
                
                using var reader = await cmd.ExecuteReaderAsync();
                if (!await reader.ReadAsync())
                {
                    return NotFound(new { status = "Error", message = "Registration request not found or already approved." });
                }
                
                string userEmail = reader.GetString(0);
                string userRole = reader.GetString(1);

                // Trigger the Node.js Middleware to Generate the Blockchain Wallet
                using var client = new HttpClient();
                var payload = new { email = userEmail, role = userRole };
                var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                
                // Call the internal Fabric Gateway
                var response = await client.PostAsync("http://localhost:4000/api/fabric/register-user", content);
                
                if (!response.IsSuccessStatusCode) {
                    string errorBody = await response.Content.ReadAsStringAsync();
                    return StatusCode(500, new { status = "Error", message = $"Approved in DB, but Blockchain Wallet failed: {errorBody}" });
                }

                return Ok(new { status = "Success", message = "Request approved and Fabric Wallet created successfully." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpGet("students/approved")]
        public async Task<IActionResult> GetApprovedStudents()
        {
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

                return Ok(new { status = "Success", students });
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

                string query = "UPDATE StudentProfiles SET department = @dept, section = @section, assignment_status = 'Pending Department Approval' WHERE user_id = @id";
                using var cmd = new NpgsqlCommand(query, conn);
                cmd.Parameters.AddWithValue("dept", request.Department);
                cmd.Parameters.AddWithValue("section", request.Section);
                cmd.Parameters.AddWithValue("id", id);
                
                int rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0) return NotFound(new { status = "Error", message = "Student profile not found." });

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

                return Ok(new { status = "Success", admins });
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

                string queryAdmin = "UPDATE AdminProfiles SET department = @dept WHERE user_id = @id";
                using var cmdAdmin = new NpgsqlCommand(queryAdmin, conn);
                cmdAdmin.Parameters.AddWithValue("dept", request.Department);
                cmdAdmin.Parameters.AddWithValue("id", id);
                
                int rows = await cmdAdmin.ExecuteNonQueryAsync();

                if (rows == 0) return NotFound(new { status = "Error", message = "Admin profile not found." });

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
            try
            {
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

                return Ok(new { status = "Success", faculties });
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

                string query = "UPDATE FacultyProfiles SET department = @dept, section = @section, year_level = @year WHERE user_id = @id";
                using var cmd = new NpgsqlCommand(query, conn);
                cmd.Parameters.AddWithValue("dept", request.Department);
                cmd.Parameters.AddWithValue("section", request.Section);
                cmd.Parameters.AddWithValue("year", request.YearLevel);
                cmd.Parameters.AddWithValue("id", id);
                
                int rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0) return NotFound(new { status = "Error", message = "Faculty profile not found." });

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
            try
            {
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

                string query = "UPDATE StudentProfiles SET assignment_status = 'Enrolled' WHERE user_id = @id";
                using var cmd = new NpgsqlCommand(query, conn);
                cmd.Parameters.AddWithValue("id", id);
                
                int rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0) return NotFound(new { status = "Error", message = "Student not found." });

                return Ok(new { status = "Success", message = "Student officially enrolled in the department!" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }
    }
}