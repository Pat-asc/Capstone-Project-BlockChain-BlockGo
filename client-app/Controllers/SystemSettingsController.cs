using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Npgsql;
using System;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.SignalR;

namespace Client_app.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class SystemSettingsController : ControllerBase
    {
        private readonly string _connectionString;
        private readonly ILogger<SystemSettingsController> _logger;
        private readonly IHubContext<ChatHub> _chatHubContext;

        public SystemSettingsController(IConfiguration configuration, ILogger<SystemSettingsController> logger, IHubContext<ChatHub> chatHubContext)
        {
            _connectionString = configuration.GetConnectionString("PostgresConnection") ?? configuration.GetConnectionString("MasterConnection") ?? throw new InvalidOperationException("PostgreSQL connection string not found.");
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
                    CREATE TABLE IF NOT EXISTS SystemSettings (
                        key VARCHAR(255) PRIMARY KEY,
                        value TEXT NOT NULL
                    );", conn);
                cmd.ExecuteNonQuery();
            }
            catch { /* Ignore */ }
        }

        public class SettingRequest
        {
            public string Key { get; set; } = string.Empty;
            public string Value { get; set; } = string.Empty;
        }

        [HttpGet("{key}")]
        public async Task<IActionResult> GetSetting(string key)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var cmd = new NpgsqlCommand("SELECT value FROM SystemSettings WHERE key = @k", conn);
                cmd.Parameters.AddWithValue("k", key);
                var value = await cmd.ExecuteScalarAsync();
                if (value != null)
                {
                    return Ok(new { status = "Success", value = value.ToString() });
                }
                return NotFound(new { status = "Error", message = "Setting not found." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost]
        [Authorize(Roles = "registrar,admin")]
        public async Task<IActionResult> SaveSetting([FromBody] SettingRequest req)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var cmd = new NpgsqlCommand(@"
                    INSERT INTO SystemSettings (key, value) VALUES (@k, @v) 
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", conn);
                cmd.Parameters.AddWithValue("k", req.Key);
                cmd.Parameters.AddWithValue("v", req.Value);
                await cmd.ExecuteNonQueryAsync();
                await _chatHubContext.Clients.All.SendAsync("SystemSettingChanged", new
                {
                    Key = req.Key,
                    Value = req.Value,
                    UpdatedAt = DateTime.UtcNow
                });
                return Ok(new { status = "Success" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost("reset-season")]
        [Authorize(Roles = "registrar,admin")]
        public async Task<IActionResult> ResetEncodingSeason()
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var tx = await conn.BeginTransactionAsync();

                using var cmdClearGrades = new NpgsqlCommand("DELETE FROM pending_grade_records", conn, tx);
                await cmdClearGrades.ExecuteNonQueryAsync();

                using var cmdClearFacSections = new NpgsqlCommand("DELETE FROM FacultySections", conn, tx);
                await cmdClearFacSections.ExecuteNonQueryAsync();

                using var cmdClearAcadSections = new NpgsqlCommand("DELETE FROM AcademicSections", conn, tx);
                await cmdClearAcadSections.ExecuteNonQueryAsync();

                using var cmdResetStudents = new NpgsqlCommand("UPDATE StudentProfiles SET section = NULL, assignment_status = 'Unassigned'", conn, tx);
                await cmdResetStudents.ExecuteNonQueryAsync();

                using var cmdResetFaculty = new NpgsqlCommand("UPDATE FacultyProfiles SET department = 'Unassigned'", conn, tx);
                await cmdResetFaculty.ExecuteNonQueryAsync();

                await tx.CommitAsync();

                _logger.LogInformation("Encoding season reset by {User}", User.Identity?.Name);

                return Ok(new { status = "Success", message = "Encoding season reset." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = $"Failed to reset season: {ex.Message}" });
            }
        }
    }
}
