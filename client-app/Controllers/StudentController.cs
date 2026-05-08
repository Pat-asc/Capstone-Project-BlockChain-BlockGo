using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using For_Testing_Only_Capstone.Models;
using System;
using System.Threading.Tasks;

namespace Client_app.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class StudentController : ControllerBase
    {
        private readonly RegistrarDbContext _context;

        public StudentController(RegistrarDbContext context)
        {
            _context = context;
        }

        [HttpGet("profile")]
        [Authorize(Roles = "student")]
        public async Task<IActionResult> GetProfile()
        {
            var email = User.Identity?.Name;
            if (string.IsNullOrEmpty(email)) return Unauthorized();

            try
            {
                using var connection = _context.Database.GetDbConnection();
                await connection.OpenAsync();
                using var command = connection.CreateCommand();

                command.CommandText = @"
                    SELECT phone, sex, middle_name 
                    FROM studentprofiles 
                    WHERE user_id = (SELECT id FROM users WHERE email = @email)";

                var pEmail = command.CreateParameter(); pEmail.ParameterName = "@email"; pEmail.Value = email; command.Parameters.Add(pEmail);

                using var reader = await command.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    return Ok(new
                    {
                        phone = reader.IsDBNull(0) ? "" : reader.GetString(0),
                        sex = reader.IsDBNull(1) ? "" : reader.GetString(1),
                        middleName = reader.IsDBNull(2) ? "" : reader.GetString(2)
                    });
                }
                return NotFound(new { message = "Profile not found." });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Profile Fetch Error]: {ex}");
                return StatusCode(500, new { message = "Database error fetching profile.", error = ex.Message });
            }
        }

        [HttpPut("profile")]
        [Authorize(Roles = "student,registrar,department_admin,deptAdmin,faculty")] 
        public async Task<IActionResult> UpdateProfile([FromBody] UpdateProfileRequest request)
        {
            var email = User.Identity?.Name;
            // If the user is an admin/faculty, they might be passing a specific student email
            // (Need to extend UpdateProfileRequest to support this if we want admins to edit others)
            if (string.IsNullOrEmpty(email)) return Unauthorized();

            try
            {
                using var connection = _context.Database.GetDbConnection();
                await connection.OpenAsync();
                using var command = connection.CreateCommand();

                command.CommandText = @"
                    UPDATE studentprofiles 
                    SET phone = @phone, sex = @sex, middle_name = @middleName
                    WHERE user_id = (SELECT id FROM users WHERE email = @email)";

                var pPhone = command.CreateParameter(); pPhone.ParameterName = "@phone"; pPhone.Value = string.IsNullOrEmpty(request.Phone) ? DBNull.Value : request.Phone; command.Parameters.Add(pPhone);
                var pSex = command.CreateParameter(); pSex.ParameterName = "@sex"; pSex.Value = string.IsNullOrEmpty(request.Sex) ? DBNull.Value : request.Sex; command.Parameters.Add(pSex);
                var pMiddleName = command.CreateParameter(); pMiddleName.ParameterName = "@middleName"; pMiddleName.Value = string.IsNullOrEmpty(request.MiddleName) ? DBNull.Value : request.MiddleName; command.Parameters.Add(pMiddleName);
                var pEmail = command.CreateParameter(); pEmail.ParameterName = "@email"; pEmail.Value = email; command.Parameters.Add(pEmail);

                int rowsAffected = await command.ExecuteNonQueryAsync();

                if (rowsAffected == 0) return NotFound(new { message = "Profile not found." });

                return Ok(new { message = "Profile updated successfully." });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[Profile Update Error]: {ex}");
                return StatusCode(500, new { message = "Database error updating profile.", error = ex.Message });
            }
        }
    }

    public class UpdateProfileRequest
    {
        public string? Phone { get; set; }
        public string? Sex { get; set; }
        public string? MiddleName { get; set; }
    }
}