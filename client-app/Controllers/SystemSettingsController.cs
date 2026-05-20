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
                    );
                    CREATE TABLE IF NOT EXISTS bulk_grade_staging (
                        staging_id SERIAL PRIMARY KEY,
                        batch_id VARCHAR(100) NOT NULL,
                        student_hash VARCHAR(100) NOT NULL,
                        course VARCHAR(100),
                        subject_code VARCHAR(50),
                        subject_name VARCHAR(255),
                        grade VARCHAR(10),
                        semester VARCHAR(20),
                        school_year VARCHAR(20),
                        year_level VARCHAR(10),
                        section VARCHAR(50),
                        faculty_id VARCHAR(100),
                        status VARCHAR(50) DEFAULT 'PENDING_APPROVAL',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE IF NOT EXISTS sectioningstate (
                        key VARCHAR(100) PRIMARY KEY,
                        data_json JSONB NOT NULL,
                        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE IF NOT EXISTS bulk_grade_uploads (
                        upload_id SERIAL PRIMARY KEY,
                        batch_id UUID UNIQUE DEFAULT gen_random_uuid(),
                        faculty_email VARCHAR(255) NOT NULL,
                        faculty_department VARCHAR(255) NOT NULL,
                        total_records INTEGER DEFAULT 0,
                        successful_records INTEGER DEFAULT 0,
                        failed_records INTEGER DEFAULT 0,
                        status VARCHAR(50) DEFAULT 'PENDING_APPROVAL',
                        ipfs_cid VARCHAR(255),
                        semester VARCHAR(50),
                        school_year VARCHAR(10),
                        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        approved_by_dept_email VARCHAR(255),
                        approved_by_dept_at TIMESTAMP,
                        finalized_by_registrar_email VARCHAR(255),
                        finalized_by_registrar_at TIMESTAMP,
                        rejection_reason TEXT,
                        rejected_at TIMESTAMP,
                        rejected_by_email VARCHAR(255)
                    );", conn, tx);
                await cmdEnsureResetTables.ExecuteNonQueryAsync();

                using var cmdEnsureTemporaryStudentColumns = new NpgsqlCommand(@"
                    ALTER TABLE IF EXISTS StudentProfiles
                        ADD COLUMN IF NOT EXISTS is_temporary BOOLEAN DEFAULT FALSE,
                        ADD COLUMN IF NOT EXISTS student_status VARCHAR(50) DEFAULT 'regular';", conn, tx);
                await cmdEnsureTemporaryStudentColumns.ExecuteNonQueryAsync();

                using var cmdClearGrades = new NpgsqlCommand(@"
                    DELETE FROM pending_grade_records;
                    DELETE FROM bulk_grade_staging;
                    DELETE FROM bulk_grade_uploads;
                ", conn, tx);
                await cmdClearGrades.ExecuteNonQueryAsync();

                using var cmdClearFacSections = new NpgsqlCommand(@"
                    DELETE FROM FacultySections;
                    UPDATE FacultyProfiles SET section = NULL, year_level = NULL;
                ", conn, tx);
                await cmdClearFacSections.ExecuteNonQueryAsync();

                using var cmdClearAcademicSections = new NpgsqlCommand(@"
                    DELETE FROM AcademicSections;
                    DELETE FROM sectioningstate;
                    UPDATE StudentProfiles SET section = NULL, assignment_status = 'Unassigned';
                ", conn, tx);
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
                    INSERT INTO shared_client_state (key, value, updated_at)
                    VALUES 
                        ('registrarAssignments', '[]'::jsonb, NOW()),
                        ('studentSections', '[]'::jsonb, NOW()),
                        ('irregularSubjectAssignments', '[]'::jsonb, NOW()),
                        ('chairpersonStudentBatches', '[]'::jsonb, NOW()),
                        ('chairpersonSectionReviews', '{}'::jsonb, NOW()),
                        ('graduatingStudents', '[]'::jsonb, NOW()),
                        ('STUDENT_BATCHES_KEY', '[]'::jsonb, NOW()),
                        ('STUDENT_SUBMISSION_LOGS_KEY', '[]'::jsonb, NOW()),
                        ('studentPublishedGrades', '{}'::jsonb, NOW()),
                        ('facultyLoadResetAt', TO_JSONB(NOW()), NOW()),
                        ('sessionRecoveryDrafts', '{}'::jsonb, NOW()),
                        ('chairpersonSubmissionLogs', '[]'::jsonb, NOW()),
                        ('studentMasterlist', '[]'::jsonb, NOW())
                    ON CONFLICT (key) DO UPDATE SET 
                        value = EXCLUDED.value,
                        updated_at = EXCLUDED.updated_at;", conn, tx);
                await cmdClearSharedSectioningState.ExecuteNonQueryAsync();

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

                const string resetEncodingPeriod = "{\"semester\":\"2nd Semester\",\"startDate\":\"\",\"endDate\":\"\",\"term\":\"midterm\"}";
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
                    ChangeType = "season_reset",
                    Department = (string?)null,
                    Actor = User.Identity?.Name
                });

                return Ok(new
                {
                    status = "Success",
                    message = $"Encoding season reset. Sections, faculty loads, pending grades, temporary students, and sectioning state were cleared. Temporary students removed: {temporaryStudentsCleared}."
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = $"Failed to reset season: {ex.Message}" });
            }
        }
    }
}
