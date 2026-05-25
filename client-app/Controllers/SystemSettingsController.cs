using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Npgsql;
using System;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.SignalR;
using System.Text.Json;

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

                using var cmdEnsureResetTables = new NpgsqlCommand(@"
                    CREATE TABLE IF NOT EXISTS pending_grade_records (
                        id VARCHAR(255) PRIMARY KEY,
                        student_hash VARCHAR(255),
                        student_no VARCHAR(255),
                        student_name VARCHAR(255),
                        section VARCHAR(100),
                        course VARCHAR(255),
                        subject_code VARCHAR(100),
                        grade TEXT,
                        semester VARCHAR(50),
                        school_year VARCHAR(50),
                        faculty_id VARCHAR(255),
                        date VARCHAR(50),
                        ipfs_cid VARCHAR(255),
                        status VARCHAR(50),
                        note TEXT
                    );
                    CREATE TABLE IF NOT EXISTS FacultySections (
                        id SERIAL PRIMARY KEY,
                        user_id INT,
                        department VARCHAR(255),
                        section VARCHAR(100),
                        year_level VARCHAR(50),
                        subject VARCHAR(100)
                    );
                    CREATE TABLE IF NOT EXISTS AcademicSections (
                        id SERIAL PRIMARY KEY,
                        department VARCHAR(50) NOT NULL,
                        year_level INT NOT NULL,
                        section_num INT NOT NULL,
                        UNIQUE(department, year_level, section_num)
                    );", conn, tx);
                await cmdEnsureResetTables.ExecuteNonQueryAsync();

                using var cmdEnsureTemporaryStudentColumns = new NpgsqlCommand(@"
                    ALTER TABLE IF EXISTS StudentProfiles
                        ADD COLUMN IF NOT EXISTS is_temporary BOOLEAN DEFAULT FALSE,
                        ADD COLUMN IF NOT EXISTS student_status VARCHAR(50) DEFAULT 'regular';", conn, tx);
                await cmdEnsureTemporaryStudentColumns.ExecuteNonQueryAsync();

                using var cmdClearGrades = new NpgsqlCommand("DELETE FROM pending_grade_records", conn, tx);
                await cmdClearGrades.ExecuteNonQueryAsync();

                using var cmdClearFacSections = new NpgsqlCommand("DELETE FROM FacultySections", conn, tx);
                await cmdClearFacSections.ExecuteNonQueryAsync();

                using var cmdClearAcademicSections = new NpgsqlCommand("DELETE FROM AcademicSections", conn, tx);
                await cmdClearAcademicSections.ExecuteNonQueryAsync();

                using var cmdEnsureSharedState = new NpgsqlCommand(@"
                    CREATE TABLE IF NOT EXISTS shared_client_state (
                        key TEXT PRIMARY KEY,
                        value JSONB NOT NULL,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_by TEXT
                    );", conn, tx);
                await cmdEnsureSharedState.ExecuteNonQueryAsync();

                using var cmdClearSharedSectioningState = new NpgsqlCommand(@"
                    DELETE FROM shared_client_state
                    WHERE key IN (
                        'registrarAssignments',
                        'studentSections',
                        'irregularSubjectAssignments',
                        'chairpersonStudentBatches',
                        'chairpersonSectionReviews',
                        'sessionRecoveryDrafts'
                    );", conn, tx);
                await cmdClearSharedSectioningState.ExecuteNonQueryAsync();

                var resetTimestamp = DateTime.UtcNow;
                var resetTimestampJson = JsonSerializer.Serialize(resetTimestamp.ToString("O"));
                using var cmdSetFacultyLoadResetToken = new NpgsqlCommand(@"
                    INSERT INTO shared_client_state (key, value, updated_at, updated_by)
                    VALUES ('facultyLoadResetAt', @value::jsonb, @updatedAt, @updatedBy)
                    ON CONFLICT (key)
                    DO UPDATE SET value = EXCLUDED.value,
                                  updated_at = EXCLUDED.updated_at,
                                  updated_by = EXCLUDED.updated_by;", conn, tx);
                cmdSetFacultyLoadResetToken.Parameters.AddWithValue("value", resetTimestampJson);
                cmdSetFacultyLoadResetToken.Parameters.AddWithValue("updatedAt", resetTimestamp);
                cmdSetFacultyLoadResetToken.Parameters.AddWithValue("updatedBy", (object?)User.Identity?.Name ?? DBNull.Value);
                await cmdSetFacultyLoadResetToken.ExecuteNonQueryAsync();

                using var cmdClearTemporaryStudents = new NpgsqlCommand(@"
                    WITH temp_users AS (
                        SELECT u.id
                        FROM Users u
                        JOIN StudentProfiles sp ON u.id = sp.user_id
                        WHERE u.role = 'student'
                          AND COALESCE(sp.is_temporary, FALSE) = TRUE
                    ),
                    deleted_profiles AS (
                        DELETE FROM StudentProfiles
                        WHERE user_id IN (SELECT id FROM temp_users)
                        RETURNING user_id
                    )
                    DELETE FROM Users
                    WHERE id IN (SELECT id FROM temp_users);", conn, tx);
                var temporaryStudentsCleared = await cmdClearTemporaryStudents.ExecuteNonQueryAsync();

                var today = DateTime.Now;
                var startYear = today.Month < 6 ? today.Year - 1 : today.Year;
                var defaultSchoolYear = $"{startYear}-{startYear + 1}";
                var resetEncodingPeriod = JsonSerializer.Serialize(new
                {
                    schoolYear = defaultSchoolYear,
                    semester = "2nd Semester",
                    startDate = "",
                    endDate = "",
                    term = "midterm"
                });
                using var cmdResetEncodingPeriod = new NpgsqlCommand(@"
                    INSERT INTO SystemSettings (key, value) VALUES ('encoding_period', @value)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", conn, tx);
                cmdResetEncodingPeriod.Parameters.AddWithValue("value", resetEncodingPeriod);
                await cmdResetEncodingPeriod.ExecuteNonQueryAsync();

                await tx.CommitAsync();

                _logger.LogInformation("Encoding season reset by {User}", User.Identity?.Name);
                await _chatHubContext.Clients.All.SendAsync("SystemSettingChanged", new
                {
                    Key = "encoding_period",
                    Value = resetEncodingPeriod,
                    UpdatedAt = DateTime.UtcNow
                });
                await _chatHubContext.Clients.All.SendAsync("AcademicDataChanged", new
                {
                    Reason = "encoding_season_reset",
                    Department = (string?)null,
                    Actor = User.Identity?.Name,
                    UpdatedAt = resetTimestamp
                });

                return Ok(new
                {
                    status = "Success",
                    message = $"Encoding season reset. Sections,faculty loads, pending grades, temporary students, and sectioning state were cleared. Temporary students removed: {temporaryStudentsCleared}."
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = $"Failed to reset season: {ex.Message}" });
            }
        }
    }
}
