using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;
using Npgsql;
using BlockGo.Models;
using BlockGo.Services;
using Client_app.Models; 
using System;
using System.Threading.Tasks;
using For_Testing_Only_Capstone.Models;
using System.Text.Json;
using System.Collections.Generic;
using System.Linq;
using BlockGo.Mappers;
using System.Globalization;
using System.IO;
using ClosedXML.Excel;
using System.Net.Http;
using System.Security.Cryptography;
using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;
using System.Text.Json.Serialization;
using Client_app.Services;
using Client_app.Controllers;
using Microsoft.AspNetCore.SignalR;


namespace BlockGo.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class GradesController : ControllerBase
    {
        private readonly IBlockchainService _blockchainService;
        private readonly string _connectionString;
        private readonly ILogger<GradesController> _logger;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly IEmailService _emailService;
        private readonly IHubContext<ChatHub> _chatHubContext;

        public GradesController(
            IBlockchainService blockchainService, 
            IConfiguration configuration,
            ILogger<GradesController> logger,
            IHttpClientFactory httpClientFactory,
            IEmailService emailService,
            IHubContext<ChatHub> chatHubContext)
        {
            _blockchainService = blockchainService;
            _connectionString = configuration.GetConnectionString("PostgresConnection") ?? configuration.GetConnectionString("MasterConnection") ?? throw new InvalidOperationException("PostgreSQL connection string not found.");
            _logger = logger;
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _emailService = emailService;
            _chatHubContext = chatHubContext;
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

        public class FlagRequest
        {
            public bool IsFlagged { get; set; }
        }

        public class AcademicStatusRequest
        {
            public string Status { get; set; } = string.Empty;
        }

        private sealed class EncodingPeriodSetting
        {
            [JsonPropertyName("schoolYear")]
            public string SchoolYear { get; set; } = string.Empty;

            [JsonPropertyName("semester")]
            public string Semester { get; set; } = string.Empty;

            [JsonPropertyName("startDate")]
            public string StartDate { get; set; } = string.Empty;

            [JsonPropertyName("endDate")]
            public string EndDate { get; set; } = string.Empty;

            [JsonPropertyName("term")]
            public string Term { get; set; } = "midterm";
        }

        private async Task<(bool Allowed, string? Message)> ValidateEncodingPeriodAsync(
            NpgsqlConnection conn,
            string? requestedTerm = null,
            string? requestedSemester = null,
            string? requestedSchoolYear = null)
        {
            using var cmd = new NpgsqlCommand("SELECT value FROM SystemSettings WHERE key = 'encoding_period' LIMIT 1", conn);
            var rawValue = await cmd.ExecuteScalarAsync() as string;

            if (string.IsNullOrWhiteSpace(rawValue))
            {
                return (false, "Grade encoding period is not open.");
            }

            EncodingPeriodSetting? setting;
            try
            {
                setting = JsonSerializer.Deserialize<EncodingPeriodSetting>(
                    rawValue,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            }
            catch
            {
                return (false, "Grade encoding period is not open.");
            }

            if (setting == null ||
                string.IsNullOrWhiteSpace(setting.StartDate) ||
                string.IsNullOrWhiteSpace(setting.EndDate) ||
                !DateTime.TryParse(setting.StartDate, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var startDate) ||
                !DateTime.TryParse(setting.EndDate, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var endDate))
            {
                return (false, "Grade encoding period is not open.");
            }

            startDate = startDate.Date;
            endDate = endDate.Date.AddDays(1).AddTicks(-1);

            var now = DateTime.Now;
            if (now < startDate || now > endDate)
            {
                return (false, $"Grade encoding period is closed. Allowed window: {startDate:MMMM dd, yyyy} to {endDate:MMMM dd, yyyy}.");
            }

            var activeTerm = string.Equals(setting.Term, "finals", StringComparison.OrdinalIgnoreCase) ? "finals" : "midterm";
            if (!string.IsNullOrWhiteSpace(requestedTerm))
            {
                var normalizedRequestedTerm = string.Equals(requestedTerm, "finals", StringComparison.OrdinalIgnoreCase) ? "finals" : "midterm";
                if (!string.Equals(activeTerm, normalizedRequestedTerm, StringComparison.OrdinalIgnoreCase))
                {
                    return (false, $"Only {activeTerm} encoding is currently allowed.");
                }
            }

            if (!string.IsNullOrWhiteSpace(requestedSemester) &&
                !string.IsNullOrWhiteSpace(setting.Semester) &&
                !string.Equals(setting.Semester.Trim(), requestedSemester.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                return (false, $"Encoding is currently open only for {setting.Semester}.");
            }

            if (!string.IsNullOrWhiteSpace(requestedSchoolYear) &&
                !string.IsNullOrWhiteSpace(setting.SchoolYear) &&
                !string.Equals(setting.SchoolYear.Trim(), requestedSchoolYear.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                return (false, $"Encoding is currently open only for SY {setting.SchoolYear}.");
            }

            return (true, null);
        }

        private async Task<(string? Department, string? Identity)> ResolveApprovedAcademicIdentityAsync(
            NpgsqlConnection conn,
            string? preferredIdentity,
            string? fallbackIdentity = null)
        {
            async Task<(string? Department, string? Identity)> TryResolveAsync(string? identity)
            {
                if (string.IsNullOrWhiteSpace(identity)) return (null, null);

                using var cmd = new NpgsqlCommand(@"
                    SELECT department FROM (
                        SELECT fp.department FROM Users u JOIN FacultyProfiles fp ON u.id = fp.user_id WHERE LOWER(u.email) = LOWER(@email) AND u.status = 'APPROVED'
                        UNION
                        SELECT ap.department FROM Users u JOIN AdminProfiles ap ON u.id = ap.user_id WHERE LOWER(u.email) = LOWER(@email) AND u.status = 'APPROVED'
                    ) AS combined LIMIT 1", conn);
                cmd.Parameters.AddWithValue("email", identity);
                var department = await cmd.ExecuteScalarAsync() as string;
                return department == null ? (null, null) : (department, identity);
            }

            var resolved = await TryResolveAsync(preferredIdentity);
            if (resolved.Department != null) return resolved;

            if (!string.Equals(preferredIdentity, fallbackIdentity, StringComparison.OrdinalIgnoreCase))
            {
                resolved = await TryResolveAsync(fallbackIdentity);
                if (resolved.Department != null) return resolved;
            }

            return (null, null);
        }

        [HttpPost("record")]
        public async Task<IActionResult> RecordGrade([FromBody] GradeRequest request)
        {
            _logger.LogInformation("Recording grade for student: {StudentId}", request.StudentId);
            if (request == null)
                return BadRequest(new { status = "Error", message = "Invalid grade data." });

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var encodingValidation = await ValidateEncodingPeriodAsync(
                    conn,
                    requestedSemester: request.Semester,
                    requestedSchoolYear: request.SchoolYear);
                if (!encodingValidation.Allowed)
                {
                    return StatusCode(403, new { status = "Error", message = encodingValidation.Message });
                }

                var jwtUser = User.Identity?.Name
                    ?? User.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Email)?.Value
                    ?? User.Claims.FirstOrDefault(c => c.Type == "email")?.Value;

                var resolvedFaculty = await ResolveApprovedAcademicIdentityAsync(
                    conn,
                    request.FacultyId,
                    jwtUser
                );
                var facDept = resolvedFaculty.Department;
                var effectiveFacultyId = resolvedFaculty.Identity;
                if (facDept == null)
                    return BadRequest(new { status = "Error", message = "Faculty not approved or does not exist." });

                using var cmdStu = new NpgsqlCommand(@"
                    SELECT sp.department, u.email
                    FROM Users u
                    JOIN StudentProfiles sp ON u.id = sp.user_id
                    WHERE u.role = 'student'
                      AND (
                        LOWER(u.email) = LOWER(@studentHash)
                        OR sp.student_no = @studentId
                        OR LOWER(u.email) = LOWER(@studentId)
                      )
                    LIMIT 1", conn);
                cmdStu.Parameters.AddWithValue("studentHash", request.StudentHash ?? (object)DBNull.Value);
                cmdStu.Parameters.AddWithValue("studentId", request.StudentId ?? (object)DBNull.Value);
                string? stuDept = null;
                string? stuEmail = null;
                string stuNumber = request.StudentId ?? "";
                string stuName = request.StudentName ?? "";
                using (var stuReader = await cmdStu.ExecuteReaderAsync())
                {
                    if (await stuReader.ReadAsync())
                    {
                        stuDept = stuReader.IsDBNull(0) ? null : stuReader.GetString(0);
                        stuEmail = stuReader.IsDBNull(1) ? null : stuReader.GetString(1);
                    }
                }
                if (stuDept == null || string.IsNullOrWhiteSpace(stuEmail))
                {
                    string defaultDob = "01/01/2005";
                    string defaultPassword = "01/01/2005";
                    string generatedEmail = !string.IsNullOrWhiteSpace(request.StudentId) && request.StudentId.Contains("@")
                        ? request.StudentId
                        : $"{request.StudentId}@plv.edu.ph";
                    stuNumber = request.StudentId ?? "";
                    stuName = !string.IsNullOrWhiteSpace(request.StudentName) ? request.StudentName : $"Student {request.StudentId}";

                    using var txCreate = await conn.BeginTransactionAsync();

                    using (var cmdUser = new NpgsqlCommand(
                        "INSERT INTO Users (email, password_hash, role, status) VALUES (@email, crypt(@password, gen_salt('bf', 12)), 'student', 'APPROVED') RETURNING id",
                        conn,
                        txCreate))
                    {
                        cmdUser.Parameters.AddWithValue("email", generatedEmail);
                        cmdUser.Parameters.AddWithValue("password", defaultPassword);
                        int newUserId = (int)(await cmdUser.ExecuteScalarAsync() ?? throw new Exception("Failed to get ID"));

                        using var cmdProfile = new NpgsqlCommand(@"
                            INSERT INTO StudentProfiles (user_id, full_name, student_no, department, section, date_of_birth, assignment_status)
                            VALUES (@uid, @name, @studentno, @dept, @sec, @dob, 'Enrolled')",
                            conn,
                            txCreate);
                        cmdProfile.Parameters.AddWithValue("uid", newUserId);
                        cmdProfile.Parameters.AddWithValue("name",
                            !IsPlaceholderStudentName(request.StudentName, request.StudentId)
                                ? request.StudentName
                                : "Student " + (request.StudentId ?? ""));
                        cmdProfile.Parameters.AddWithValue("studentno", (object?)request.StudentId ?? DBNull.Value);
                        cmdProfile.Parameters.AddWithValue("dept", request.Course ?? "Unassigned");
                        cmdProfile.Parameters.AddWithValue("sec", DBNull.Value);
                        cmdProfile.Parameters.AddWithValue("dob", DateTime.Parse(defaultDob));
                        await cmdProfile.ExecuteNonQueryAsync();
                    }

                    await txCreate.CommitAsync();

                    var payload = new { email = generatedEmail, role = "student", password = defaultPassword };
                    var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                    var middlewareUrl = _configuration["Middleware:Url"] ?? _configuration["MIDDLEWARE_URL"] ?? "http://127.0.0.1:4000";

                    using var client = _httpClientFactory.CreateClient("FabricCAClient");
                    var apiK = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
                    client.DefaultRequestHeaders.Add("x-api-key", apiK);

                    var fabResponse = await client.PostAsync($"{middlewareUrl}/api/fabric/register-user", content);
                    if (!fabResponse.IsSuccessStatusCode)
                        throw new Exception($"Blockchain wallet auto-creation failed: {await fabResponse.Content.ReadAsStringAsync()}");

                    stuEmail = generatedEmail;
                    stuDept = request.Course ?? "Unassigned";
                }

                using (var cmdStuIdentity = new NpgsqlCommand(@"
                    SELECT sp.student_no, sp.full_name
                    FROM Users u
                    JOIN StudentProfiles sp ON u.id = sp.user_id
                    WHERE u.role = 'student'
                      AND (
                        LOWER(u.email) = LOWER(@studentHash)
                        OR sp.student_no = @studentId
                        OR LOWER(u.email) = LOWER(@studentId)
                      )
                    LIMIT 1", conn))
                {
                    cmdStuIdentity.Parameters.AddWithValue("studentHash", request.StudentHash ?? (object)DBNull.Value);
                    cmdStuIdentity.Parameters.AddWithValue("studentId", request.StudentId ?? (object)DBNull.Value);
                    using var identityReader = await cmdStuIdentity.ExecuteReaderAsync();
                    if (await identityReader.ReadAsync())
                    {
                        if (!identityReader.IsDBNull(0)) stuNumber = identityReader.GetString(0);
                        if (!identityReader.IsDBNull(1))
                        {
                            stuName = ResolvePreferredStudentName(
                                stuName,
                                identityReader.GetString(1),
                                request.StudentId
                            );
                        }
                    }
                }

                var blockchainRecord = request.ToBlockchainRecord("PLV");
                blockchainRecord.FacultyId = effectiveFacultyId ?? request.FacultyId ?? "";
                blockchainRecord.StudentHash = stuEmail;
                blockchainRecord.StudentNo = stuNumber;
                blockchainRecord.StudentName = stuName;

                await RevokeInactiveStudentAccessIfNeededAsync(
                    conn,
                    blockchainRecord.StudentHash,
                    blockchainRecord.StudentNo,
                    blockchainRecord.Grade,
                    effectiveFacultyId
                );
                
                using var transaction = await conn.BeginTransactionAsync();
                try
                {
                    using var cmdInitTable = new NpgsqlCommand(@"
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
                        );", conn, transaction);
                    await cmdInitTable.ExecuteNonQueryAsync();

                    using var cmdEnsureGradeText = new NpgsqlCommand("ALTER TABLE pending_grade_records ALTER COLUMN grade TYPE TEXT;", conn, transaction);
                    await cmdEnsureGradeText.ExecuteNonQueryAsync();

                    using var cmdEnsureIdentityColumns = new NpgsqlCommand(EnsurePendingGradeRecordIdentityColumnsSql(), conn, transaction);
                    await cmdEnsureIdentityColumns.ExecuteNonQueryAsync();

                    using var cmdEnsureUniqueConstraint = new NpgsqlCommand(EnsurePendingGradeSectionScopedConstraintSql(), conn, transaction);
                    await cmdEnsureUniqueConstraint.ExecuteNonQueryAsync();

                    using var cmdStage = new NpgsqlCommand(@"
                        WITH updated AS (
                            UPDATE pending_grade_records
                            SET section = @sec,
                                student_no = @studentNo,
                                student_name = @studentName,
                                course = @course,
                                grade = @gr,
                                faculty_id = @fac,
                                date = @dt,
                                ipfs_cid = COALESCE(NULLIF(@ipfs, ''), ipfs_cid),
                                status = 'Draft'
                            WHERE LOWER(TRIM(student_hash)) = LOWER(TRIM(@sh))
                              AND LOWER(TRIM(subject_code)) = LOWER(TRIM(@subj))
                              AND LOWER(TRIM(school_year)) = LOWER(TRIM(@sy))
                              AND LOWER(TRIM(semester)) = LOWER(TRIM(@sem))
                              AND (
                                LOWER(TRIM(COALESCE(section, ''))) = LOWER(TRIM(@sec))
                                OR (COALESCE(section, '') <> '' AND section ILIKE '%' || @sec || '%')
                                OR (@sec <> '' AND @sec ILIKE '%' || COALESCE(section, '') || '%')
                                OR LOWER(TRIM(COALESCE(section, ''))) = LOWER(TRIM(@subj))
                              )
                            RETURNING id
                        )
                        INSERT INTO pending_grade_records (id, student_hash, student_no, student_name, section, course, subject_code, grade, semester, school_year, faculty_id, date, ipfs_cid, status)
                        SELECT @id, @sh, @studentNo, @studentName, @sec, @course, @subj, @gr, @sem, @sy, @fac, @dt, @ipfs, 'Draft'
                        WHERE NOT EXISTS (SELECT 1 FROM updated)
                        ON CONFLICT ON CONSTRAINT unique_grade_entry_section DO UPDATE SET
                            student_no = EXCLUDED.student_no,
                            student_name = EXCLUDED.student_name,
                            section = EXCLUDED.section,
                            course = EXCLUDED.course,
                            grade = EXCLUDED.grade,
                            faculty_id = EXCLUDED.faculty_id,
                            date = EXCLUDED.date,
                            ipfs_cid = COALESCE(NULLIF(EXCLUDED.ipfs_cid, ''), pending_grade_records.ipfs_cid),
                            status = 'Draft';", conn, transaction);
                    cmdStage.Parameters.AddWithValue("id", blockchainRecord.Id ?? (object)Guid.NewGuid().ToString());
                    cmdStage.Parameters.AddWithValue("sh", blockchainRecord.StudentHash ?? "");
                    cmdStage.Parameters.AddWithValue("studentNo", blockchainRecord.StudentNo ?? "");
                    cmdStage.Parameters.AddWithValue("studentName", blockchainRecord.StudentName ?? "");
                    cmdStage.Parameters.AddWithValue("sec", blockchainRecord.Section ?? "");
                    cmdStage.Parameters.AddWithValue("course", blockchainRecord.Course ?? "");
                    cmdStage.Parameters.AddWithValue("subj", blockchainRecord.SubjectCode ?? "");
                    cmdStage.Parameters.AddWithValue("gr", blockchainRecord.Grade ?? "");
                    cmdStage.Parameters.AddWithValue("sem", blockchainRecord.Semester ?? "");
                    cmdStage.Parameters.AddWithValue("sy", blockchainRecord.SchoolYear ?? "");
                    cmdStage.Parameters.AddWithValue("fac", blockchainRecord.FacultyId ?? "");
                    cmdStage.Parameters.AddWithValue("dt", blockchainRecord.Date ?? "");
                    cmdStage.Parameters.AddWithValue("ipfs", blockchainRecord.IpfsCid ?? "");
                    await cmdStage.ExecuteNonQueryAsync();

                    using var cmdEnsureLogGradeText = new NpgsqlCommand(@"
                        ALTER TABLE gradecorrectionlogs
                        ALTER COLUMN oldgrade TYPE TEXT,
                        ALTER COLUMN newgrade TYPE TEXT;", conn, transaction);
                    await cmdEnsureLogGradeText.ExecuteNonQueryAsync();

                    using var cmdLog = new NpgsqlCommand(@"
                        INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                        VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn, transaction);
                    cmdLog.Parameters.AddWithValue("rid", blockchainRecord.Id ?? (object)Guid.NewGuid().ToString());
                    cmdLog.Parameters.AddWithValue("old", DBNull.Value);
                    cmdLog.Parameters.AddWithValue("new", request.Grade ?? "");
                    cmdLog.Parameters.AddWithValue("reason", "Initial Grade Entry (Staged)");
                    cmdLog.Parameters.AddWithValue("appr", effectiveFacultyId ?? (object)DBNull.Value);
                    await cmdLog.ExecuteNonQueryAsync();

                    await transaction.CommitAsync();

                    await NotifyAcademicDataChangedAsync("grade_recorded", blockchainRecord.Course, effectiveFacultyId);
                    return Ok(new { status = "Success", message = "Grade securely staged for Chairperson approval!" });
                }
                catch (Exception ex)
                {
                    await transaction.RollbackAsync();
                    return StatusCode(500, new { status = "Error", message = ex.Message });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error recording grade");
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost("submit-section")]
        public async Task<IActionResult> SubmitSection([FromQuery] string department, [FromQuery] string section)
        {
            var facultyId = User.Identity?.Name 
                ?? User.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Email)?.Value
                ?? User.Claims.FirstOrDefault(c => c.Type == "email")?.Value;

            if (string.IsNullOrWhiteSpace(facultyId))
                return BadRequest(new { status = "Error", message = "Faculty identity is required." });

            if (string.IsNullOrWhiteSpace(section))
                return BadRequest(new { status = "Error", message = "Section is required." });

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var encodingValidation = await ValidateEncodingPeriodAsync(conn);
                if (!encodingValidation.Allowed)
                {
                    return StatusCode(403, new { status = "Error", message = encodingValidation.Message });
                }

                var resolvedFaculty = await ResolveApprovedAcademicIdentityAsync(
                    conn,
                    facultyId,
                    facultyId
                );
                var effectiveFacultyId = resolvedFaculty.Identity ?? facultyId;
                var compactSection = ExtractCompactSectionToken(section);
                var subjectCodeFromLabel = ExtractSubjectCodeFromSectionLabel(section);

                using var cmdInitTable = new NpgsqlCommand(@"
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
                    );", conn);
                await cmdInitTable.ExecuteNonQueryAsync();

                using var cmdEnsureIdentityColumns = new NpgsqlCommand(EnsurePendingGradeRecordIdentityColumnsSql(), conn);
                await cmdEnsureIdentityColumns.ExecuteNonQueryAsync();

                using var cmd = new NpgsqlCommand(@"
                    UPDATE pending_grade_records
                    SET status = 'SubmittedToChairperson',
                        date = @date,
                        section = CASE
                            WHEN COALESCE(NULLIF(TRIM(section), ''), '') = ''
                                OR LOWER(TRIM(section)) = LOWER(TRIM(@compactSection))
                                OR LOWER(TRIM(section)) = LOWER(TRIM(subject_code))
                            THEN @section
                            ELSE section
                        END,
                        student_no = COALESCE(
                            NULLIF(student_no, ''),
                            (
                                SELECT sp.student_no
                                FROM Users u
                                JOIN StudentProfiles sp ON u.id = sp.user_id
                                WHERE LOWER(u.email) = LOWER(pending_grade_records.student_hash)
                                LIMIT 1
                            )
                        ),
                        student_name = COALESCE(
                            NULLIF(student_name, ''),
                            (
                                SELECT sp.full_name
                                FROM Users u
                                JOIN StudentProfiles sp ON u.id = sp.user_id
                                WHERE LOWER(u.email) = LOWER(pending_grade_records.student_hash)
                                LIMIT 1
                            )
                        )
                    WHERE LOWER(TRIM(faculty_id)) = LOWER(TRIM(@faculty))
                      AND (
                        (
                            LOWER(TRIM(COALESCE(section, ''))) = LOWER(TRIM(@section))
                            OR (@compactSection <> '' AND LOWER(TRIM(COALESCE(section, ''))) = LOWER(TRIM(@compactSection)))
                            OR (COALESCE(section, '') <> '' AND section ILIKE '%' || @section || '%')
                            OR (COALESCE(section, '') <> '' AND @section ILIKE '%' || section || '%')
                            OR (@compactSection <> '' AND COALESCE(section, '') <> '' AND section ILIKE '%' || @compactSection || '%')
                            OR (@compactSection <> '' AND COALESCE(section, '') <> '' AND @compactSection ILIKE '%' || section || '%')
                        )
                        AND (
                            @subjectCode = ''
                            OR LOWER(TRIM(COALESCE(subject_code, ''))) = LOWER(TRIM(@subjectCode))
                            OR (COALESCE(subject_code, '') <> '' AND @section ILIKE '%' || subject_code || '%')
                        )
                      )", conn);
                cmd.Parameters.AddWithValue("faculty", effectiveFacultyId);
                cmd.Parameters.AddWithValue("section", section);
                cmd.Parameters.AddWithValue("compactSection", compactSection);
                cmd.Parameters.AddWithValue("subjectCode", subjectCodeFromLabel);
                cmd.Parameters.AddWithValue("date", DateTime.UtcNow.ToString("o"));

                var updated = await cmd.ExecuteNonQueryAsync();
                if (updated == 0)
                {
                    _logger.LogWarning(
                        "SubmitSection matched no staged rows for faculty {FacultyId} and section {Section}",
                        effectiveFacultyId,
                        section
                    );
                    return BadRequest(new
                    {
                        status = "Error",
                        message = "No staged grades matched the submitted section. Please save the section grades first.",
                        updated
                    });
                }

                await NotifyAcademicDataChangedAsync("section_submitted", department, facultyId);
                return Ok(new { status = "Success", message = "Section submitted to Chairperson.", updated });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error submitting section {Section} for {FacultyId}", section, facultyId);
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        private byte[] EncryptStream(Stream inputStream)
        {
            using var aes = Aes.Create();
            var key = _configuration["IpfsEncryptionKey"] ?? "default-encryption-key-32chars!!!";
            aes.Key = System.Text.Encoding.UTF8.GetBytes(key.PadRight(32).Substring(0, 32));
            aes.GenerateIV();
            var iv = aes.IV;

            using var outputStream = new MemoryStream();
            outputStream.Write(iv, 0, iv.Length);

            using (var encryptor = aes.CreateEncryptor())
            using (var cryptoStream = new CryptoStream(outputStream, encryptor, CryptoStreamMode.Write))
            {
                inputStream.CopyTo(cryptoStream);
            }
            return outputStream.ToArray();
        }

        private static double ToUniversityGrade(double rawAverage)
        {
            if (rawAverage <= 0) return 0;
            if (rawAverage >= 98.5) return 1.00;
            if (rawAverage >= 94) return 1.25;
            if (rawAverage >= 91) return 1.50;
            if (rawAverage >= 88) return 1.75;
            if (rawAverage >= 85) return 2.00;
            if (rawAverage >= 82) return 2.25;
            if (rawAverage >= 79) return 2.50;
            if (rawAverage >= 75) return 3.00;
            return 5.00;
        }

        private static string GetJsonElementValueAsString(JsonElement element)
        {
            return element.ValueKind switch
            {
                JsonValueKind.String => element.GetString() ?? "",
                JsonValueKind.Number => element.ToString(),
                JsonValueKind.True => bool.TrueString,
                JsonValueKind.False => bool.FalseString,
                JsonValueKind.Null => "",
                JsonValueKind.Undefined => "",
                _ => element.ToString()
            };
        }

        private static string NormalizeAttendanceValue(string? value)
        {
            return string.IsNullOrWhiteSpace(value) ? "not applicable" : value.Trim();
        }

        private static string? ComputeWeightedGrade(
            string? quizzes,
            string? assignments,
            string? attendance,
            string? exam)
        {
            if (!double.TryParse(quizzes, out var quizScore) ||
                !double.TryParse(assignments, out var assignmentScore) ||
                !double.TryParse(exam, out var examScore))
            {
                return null;
            }

            var hasAttendance = double.TryParse(attendance, out var attendanceScore);
            var weighted = (quizScore * 0.20) + (assignmentScore * 0.10) + (examScore * 0.60);
            var divisor = 0.90;

            if (hasAttendance)
            {
                weighted += attendanceScore * 0.10;
                divisor = 1.00;
            }

            return (weighted / divisor).ToString("0.##");
        }

        private static string NormalizeAttendanceForLedger(string? rawPayload)
        {
            if (string.IsNullOrWhiteSpace(rawPayload)) return rawPayload ?? "";

            try
            {
                if (!rawPayload.TrimStart().StartsWith("{"))
                {
                    return JsonSerializer.Serialize(new
                    {
                        finalAverage = rawPayload,
                        attendance = "not applicable"
                    });
                }

                var node = System.Text.Json.Nodes.JsonNode.Parse(rawPayload)?.AsObject() ?? new System.Text.Json.Nodes.JsonObject();
                if (!node.ContainsKey("attendance") || string.IsNullOrWhiteSpace(node["attendance"]?.ToString()))
                {
                    node["attendance"] = "not applicable";
                }
                if (!node.ContainsKey("midtermAttendance") || string.IsNullOrWhiteSpace(node["midtermAttendance"]?.ToString()))
                {
                    node["midtermAttendance"] = "not applicable";
                }
                if (!node.ContainsKey("finalAttendance") || string.IsNullOrWhiteSpace(node["finalAttendance"]?.ToString()))
                {
                    node["finalAttendance"] = "not applicable";
                }
                return node.ToJsonString();
            }
            catch
            {
                return rawPayload;
            }
        }

        private static bool ShouldRevokeStudentAccessForGradePayload(string? rawPayload)
        {
            if (string.IsNullOrWhiteSpace(rawPayload) || !rawPayload.TrimStart().StartsWith("{"))
            {
                return false;
            }

            try
            {
                using var gradeDoc = JsonDocument.Parse(rawPayload);
                var root = gradeDoc.RootElement;

                if (root.TryGetProperty("accessRevoked", out var accessRevokedProp) &&
                    accessRevokedProp.ValueKind == JsonValueKind.True)
                {
                    return true;
                }

                if (root.TryGetProperty("standing", out var standingProp) &&
                    string.Equals(GetJsonElementValueAsString(standingProp), "inactive", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }

                return false;
            }
            catch
            {
                return false;
            }
        }

        private async Task RevokeInactiveStudentAccessIfNeededAsync(
            NpgsqlConnection conn,
            string? studentEmail,
            string? studentNo,
            string? gradePayload,
            string? actor)
        {
            if (!ShouldRevokeStudentAccessForGradePayload(gradePayload)) return;

            try
            {
                int userId = 0;
                string resolvedEmail = studentEmail ?? "";

                using (var findCmd = new NpgsqlCommand(@"
                    SELECT u.id, u.email
                    FROM Users u
                    LEFT JOIN StudentProfiles sp ON u.id = sp.user_id
                    WHERE u.role = 'student'
                      AND (
                        LOWER(u.email) = LOWER(@studentEmail)
                        OR sp.student_no = @studentNo
                        OR LOWER(u.email) = LOWER(@studentNo)
                      )
                    LIMIT 1", conn))
                {
                    findCmd.Parameters.AddWithValue("studentEmail", (object?)studentEmail ?? DBNull.Value);
                    findCmd.Parameters.AddWithValue("studentNo", (object?)studentNo ?? DBNull.Value);
                    using var reader = await findCmd.ExecuteReaderAsync();
                    if (!await reader.ReadAsync()) return;

                    userId = reader.IsDBNull(0) ? 0 : reader.GetInt32(0);
                    resolvedEmail = reader.IsDBNull(1) ? resolvedEmail : reader.GetString(1);
                }

                if (userId <= 0 || string.IsNullOrWhiteSpace(resolvedEmail)) return;

                try
                {
                    using var client = _httpClientFactory.CreateClient("FabricCAClient");
                    var apiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"];
                    if (!string.IsNullOrWhiteSpace(apiKey))
                    {
                        client.DefaultRequestHeaders.Add("x-api-key", apiKey);
                    }

                    var middlewareUrl = _configuration["Middleware:Url"] ?? _configuration["MIDDLEWARE_URL"] ?? "http://127.0.0.1:4000";
                    var revokePayload = new { username = resolvedEmail, role = "student" };
                    var content = new StringContent(JsonSerializer.Serialize(revokePayload), Encoding.UTF8, "application/json");
                    var response = await client.PostAsync($"{middlewareUrl}/api/revoke", content);

                    if (!response.IsSuccessStatusCode)
                    {
                        var errBody = await response.Content.ReadAsStringAsync();
                        if (!errBody.Contains("already revoked", StringComparison.OrdinalIgnoreCase) &&
                            !errBody.Contains("already inactive", StringComparison.OrdinalIgnoreCase))
                        {
                            _logger.LogWarning("Student Fabric revocation failed for {Email}: {Error}", resolvedEmail, errBody);
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Student Fabric revocation failed for {Email}.", resolvedEmail);
                }

                using (var updateCmd = new NpgsqlCommand(@"
                    UPDATE Users SET status = 'INACTIVE' WHERE id = @id AND role = 'student';
                    UPDATE StudentProfiles SET assignment_status = 'Inactive' WHERE user_id = @id;", conn))
                {
                    updateCmd.Parameters.AddWithValue("id", userId);
                    await updateCmd.ExecuteNonQueryAsync();
                }

                try
                {
                    using var auditCmd = new NpgsqlCommand(@"
                        INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp)
                        VALUES (@recordId, @oldValue, @newValue, @reason, @approvedBy, CURRENT_TIMESTAMP)", conn);
                    auditCmd.Parameters.AddWithValue("recordId", studentNo ?? resolvedEmail);
                    auditCmd.Parameters.AddWithValue("oldValue", "APPROVED");
                    auditCmd.Parameters.AddWithValue("newValue", "INACTIVE");
                    auditCmd.Parameters.AddWithValue("reason", "Student access revoked because both midterm and final grades are missing.");
                    auditCmd.Parameters.AddWithValue("approvedBy", (object?)actor ?? DBNull.Value);
                    await auditCmd.ExecuteNonQueryAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Inactive student audit log insert failed for {Email}.", resolvedEmail);
                }

                await NotifyAcademicDataChangedAsync("student_inactivated_missing_grades", null, actor);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to inactivate student with missing midterm/final grades.");
            }
        }

        private static string BuildUploadedGradePayload(
            string? rawGrade,
            string? rawMidterm,
            string? rawFinals,
            string? term,
            string? rawMidtermAttendance = null,
            string? rawFinalAttendance = null)
        {
            if (string.IsNullOrWhiteSpace(rawGrade) && string.IsNullOrWhiteSpace(rawMidterm) && string.IsNullOrWhiteSpace(rawFinals)) return "";
            if (!string.IsNullOrWhiteSpace(rawGrade) && rawGrade.TrimStart().StartsWith("{")) return NormalizeAttendanceForLedger(rawGrade);

            var activeTerm = string.Equals(term, "finals", StringComparison.OrdinalIgnoreCase) ? "finals" : "midterm";
            var midterm = double.TryParse(rawMidterm, out var parsedMidterm) ? parsedMidterm : 0;
            var finals = double.TryParse(rawFinals, out var parsedFinals) ? parsedFinals : 0;

            if (double.TryParse(rawGrade, out var parsedGrade))
            {
                if (activeTerm == "finals" && finals <= 0) finals = parsedGrade;
                if (activeTerm == "midterm" && midterm <= 0) midterm = parsedGrade;
            }

            var rawAverage = activeTerm == "finals"
                ? (midterm > 0 ? (midterm + finals) / 2 : finals)
                : midterm;
            return JsonSerializer.Serialize(new
            {
                midterm = midterm > 0 ? midterm.ToString("0.##") : "",
                finals = finals > 0 ? finals.ToString("0.##") : "",
                finalAverage = ToUniversityGrade(rawAverage).ToString("0.00"),
                attendance = "not applicable",
                midtermAttendance = NormalizeAttendanceValue(rawMidtermAttendance),
                finalAttendance = NormalizeAttendanceValue(rawFinalAttendance),
                standing = "active",
                flagged = false,
                remarks = ""
            });
        }

        private delegate string? GetValDelegate(params string[] cols);

        private static string? GetUploadedTermGrade(GetValDelegate getVal, string? term)
        {
            var activeTerm = string.Equals(term, "finals", StringComparison.OrdinalIgnoreCase) ? "finals" : "midterm";
            var uploadedGrade = activeTerm == "finals"
                ? getVal("final_rating", "final_grade", "finals_grade", "grade", "rating")
                : getVal("midterm_grade", "midterm_rating", "midterm");

            if (!string.IsNullOrWhiteSpace(uploadedGrade) && double.TryParse(uploadedGrade, out _))
            {
                return uploadedGrade;
            }

            return activeTerm == "finals"
                ? ComputeWeightedGrade(
                    getVal("final_quizzes", "final_quiz", "quizzes_final"),
                    getVal("final_assignments", "final_assignment", "assignments_final"),
                    getVal("final_attendance", "attendance_final"),
                    getVal("final_exam", "finals_exam", "exam_final"))
                : ComputeWeightedGrade(
                    getVal("quizzes", "quiz", "midterm_quizzes"),
                    getVal("assignments", "assignment", "midterm_assignments"),
                    getVal("attendance", "midterm_attendance"),
                    getVal("midterm_exam", "exam", "midterm"));
        }

        private static string? GetUploadedMidtermGrade(GetValDelegate getVal, string? term)
        {
            if (string.Equals(term, "finals", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }
            return getVal("midterm_grade", "midterm", "midterm_rating");
        }

        private static string? GetUploadedFinalGrade(GetValDelegate getVal, string? term)
        {
            if (!string.Equals(term, "finals", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }
            return getVal("final_rating", "final_grade", "finals_grade", "final", "finals");
        }

        private static string GetGradeLogValue(string? rawPayload, string? term)
        {
            if (string.IsNullOrWhiteSpace(rawPayload)) return "";

            if (!rawPayload.TrimStart().StartsWith("{"))
            {
                return rawPayload.Length > 10 ? rawPayload.Substring(0, 10) : rawPayload;
            }

            try
            {
                using var doc = JsonDocument.Parse(rawPayload);
                var activeTerm = string.Equals(term, "finals", StringComparison.OrdinalIgnoreCase) ? "finals" : "midterm";
                var propertyName = activeTerm == "finals" ? "finals" : "midterm";

                if (doc.RootElement.TryGetProperty(propertyName, out var gradeElement))
                {
                    var gradeValue = gradeElement.ToString() ?? "";
                    return gradeValue.Length > 10 ? gradeValue.Substring(0, 10) : gradeValue;
                }
            }
            catch
            {
            }

            return "";
        }

        private static string EnsurePendingGradeSectionScopedConstraintSql() => @"
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'unique_grade_entry'
                ) THEN
                    ALTER TABLE pending_grade_records DROP CONSTRAINT unique_grade_entry;
                END IF;

                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'unique_grade_entry_section'
                ) THEN
                    ALTER TABLE pending_grade_records
                    ADD CONSTRAINT unique_grade_entry_section
                    UNIQUE (student_hash, subject_code, school_year, semester, section);
                END IF;
            END $$;";

        private static string EnsurePendingGradeRecordIdentityColumnsSql() => @"
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'pending_grade_records' AND column_name = 'student_no'
                ) THEN
                    ALTER TABLE pending_grade_records ADD COLUMN student_no VARCHAR(255);
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'pending_grade_records' AND column_name = 'student_name'
                ) THEN
                    ALTER TABLE pending_grade_records ADD COLUMN student_name VARCHAR(255);
                END IF;
            END $$;";

        private static string ResolveDisplaySection(string? recordSection, string? profileSection)
        {
            var normalizedRecordSection = string.IsNullOrWhiteSpace(recordSection) ? "" : recordSection.Trim();
            if (!string.IsNullOrWhiteSpace(normalizedRecordSection))
            {
                return normalizedRecordSection;
            }

            var normalizedProfileSection = string.IsNullOrWhiteSpace(profileSection) ? "" : profileSection.Trim();
            return string.IsNullOrWhiteSpace(normalizedProfileSection) ? "Unknown" : normalizedProfileSection;
        }

        private static string ExtractCompactSectionToken(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "";

            var normalized = value.Trim();
            var programMatch = Regex.Match(normalized, @"\b([A-Za-z]{2,}\s*\d+-\d+)\b", RegexOptions.IgnoreCase);
            if (programMatch.Success)
            {
                return programMatch.Groups[1].Value.Trim();
            }

            var numericMatch = Regex.Match(normalized, @"\b(\d+-\d+)\b");
            return numericMatch.Success ? numericMatch.Groups[1].Value.Trim() : "";
        }

        private static string ExtractSubjectCodeFromSectionLabel(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "";

            var match = Regex.Match(value.Trim(), @"\(([^)]+)\)\s*$");
            return match.Success ? match.Groups[1].Value.Trim() : "";
        }

        private static string ResolveYearLevelFromSection(string? displaySection, string? profileSection)
        {
            var sectionSource = string.IsNullOrWhiteSpace(displaySection) ? profileSection : displaySection;
            if (string.IsNullOrWhiteSpace(sectionSource))
            {
                return "Unknown";
            }

            var match = Regex.Match(sectionSource, @"\b([1-4])(?:st|nd|rd|th)?(?:\s*year)?\s*-\s*\d+\b", RegexOptions.IgnoreCase);
            if (match.Success)
            {
                return match.Groups[1].Value;
            }

            var leadingDigitMatch = Regex.Match(sectionSource.Trim(), @"^([1-4])\b");
            if (leadingDigitMatch.Success)
            {
                return leadingDigitMatch.Groups[1].Value;
            }

            return "Unknown";
        }

        private static int GetAcademicRecordCompletenessScore(AcademicRecord record)
        {
            var score = 0;

            if (!string.IsNullOrWhiteSpace(record.StudentNo)) score += 4;
            if (!string.IsNullOrWhiteSpace(record.StudentName)) score += 4;
            if (!string.IsNullOrWhiteSpace(record.Section)) score += 2;
            if (!string.IsNullOrWhiteSpace(record.Status)) score += 1;
            if (!string.IsNullOrWhiteSpace(record.IpfsCid)) score += 1;

            return score;
        }

        private static bool IsPlaceholderStudentName(string? value, string? studentId = null)
        {
            var normalized = (value ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(normalized)) return true;

            if (string.Equals(normalized, "student", StringComparison.OrdinalIgnoreCase)) return true;

            if (!string.IsNullOrWhiteSpace(studentId) &&
                string.Equals(normalized, $"Student {studentId}".Trim(), StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            return false;
        }

        private static string ResolvePreferredStudentName(string? currentName, string? candidateName, string? studentId = null)
        {
            if (!IsPlaceholderStudentName(candidateName, studentId))
            {
                return (candidateName ?? string.Empty).Trim();
            }

            return string.IsNullOrWhiteSpace(currentName)
                ? (candidateName ?? string.Empty).Trim()
                : currentName.Trim();
        }

        [HttpPost("bulk-upload")]
        [Consumes("multipart/form-data")]
        public async Task<IActionResult> BulkUploadGrades([FromForm] IFormFile file, [FromForm] string? semester, [FromForm] string? schoolYear, [FromForm] string? facultyId, [FromForm] string? course, [FromForm] string? term, [FromForm] string? section)
        {
            _logger.LogInformation("Bulk upload initiated by user: {User}", User.Identity?.Name);

            if (file == null || file.Length == 0)
                return BadRequest(new { status = "Error", message = "A .csv or .xlsx file is required." });

            var jwtUser = User.Identity?.Name;
            var jwtRole = User.Claims.FirstOrDefault(c => c.Type == "dbRole")?.Value ?? User.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Role)?.Value;
            var apiKey = Request.Headers["x-api-key"].ToString();
            var internalApiKey = _configuration["InternalApiKey"];

            // Determine effective facultyId
            var targetFacultyId = string.IsNullOrEmpty(facultyId) ? jwtUser : facultyId;

            // Identity Verification: Prevent Spoofing
            if (apiKey != internalApiKey)
            {
                if (string.IsNullOrEmpty(jwtUser))
                {
                    _logger.LogWarning("Unauthorized bulk upload attempt: Missing JWT identity");
                    return BadRequest(new { status = "Error", message = "Session expired or invalid. Please login again." });
                }

                if (targetFacultyId != jwtUser)
                {
                    // Allow admins/chairpersons to upload for others
                    bool isAdmin = jwtRole == "chairperson" || jwtRole == "dept_admin" || jwtRole == "department_admin" || jwtRole == "registrar" || jwtRole == "admin";
                    if (!isAdmin)
                    {
                        _logger.LogWarning("Unauthorized bulk upload attempt: JWT user {JwtUser} tried to upload for {FacultyId}", jwtUser, targetFacultyId);
                        return BadRequest(new { status = "Error", message = "Identity mismatch. You can only upload grades for yourself." });
                    }
                }
            }

            if (string.IsNullOrEmpty(targetFacultyId))
                return BadRequest(new { status = "Error", message = "Faculty identity required." });

            _logger.LogInformation("CSV upload for faculty: {FacultyId} (Initiated by: {JwtUser})", targetFacultyId, jwtUser);
            
            // Sync variable name for the rest of the method
            facultyId = targetFacultyId;

            try
            {
                using (var periodConn = new NpgsqlConnection(_connectionString))
                {
                    await periodConn.OpenAsync();
                    var encodingValidation = await ValidateEncodingPeriodAsync(periodConn, term, semester, schoolYear);
                    if (!encodingValidation.Allowed)
                    {
                        return StatusCode(403, new { status = "Error", message = encodingValidation.Message });
                    }
                }

                var successCount = 0;
                var failureCount = 0;
                var errors = new List<BulkUploadError>();
                var parsedRecords = new List<GradeRequest>();

                var ext = Path.GetExtension(file.FileName).ToLower();
                string NormalizeHeader(string s) => System.Text.RegularExpressions.Regex.Replace(s.Trim().ToLower(), @"[^a-z0-9]+", "_").Trim('_');

                if (ext != ".csv" && ext != ".xlsx")
                    return BadRequest(new { status = "Error", message = "Only .csv and .xlsx files are supported." });

                var tempFile = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ext);
                string ipfsCid = "";
                
                try
                {
                    using (var fileStream = new FileStream(tempFile, FileMode.Create))
                        await file.CopyToAsync(fileStream);

                    // Persist every bulk-uploaded grading sheet to the IPFS vault so reviewers
                    // can always open the attachment for the section, regardless of term.
                    if (file.Length > 0)
                    {
                        try
                        {
                            using var client = _httpClientFactory.CreateClient();
                            using var content = new MultipartFormDataContent();
                            
                            // Encrypt before upload
                            byte[] encryptedData;
                            using (var fsEncrypt = new FileStream(tempFile, FileMode.Open, FileAccess.Read))
                            {
                                encryptedData = EncryptStream(fsEncrypt);
                            }
                            
                            content.Add(new ByteArrayContent(encryptedData), "file", file.FileName + ".enc");
                            
                            var ipfsHost = Environment.GetEnvironmentVariable("IPFS_HOST") ?? "ipfs0";
                            var ipfsUrl = _configuration["IpfsApiUrl"] ?? $"http://{ipfsHost}:5001/api/v0/add?cid-version=1&wrap-with-directory=false";
                            var ipfsRes = await client.PostAsync(ipfsUrl, content);
                            if (ipfsRes.IsSuccessStatusCode)
                            {
                                var ipfsJson = await ipfsRes.Content.ReadAsStringAsync();
                                var lines = ipfsJson.Split('\n', StringSplitOptions.RemoveEmptyEntries);
                                foreach (var line in lines)
                                {
                                    try {
                                        using var doc = JsonDocument.Parse(line);
                                        var root = doc.RootElement;
                                        if (root.TryGetProperty("Hash", out var hashProp)) {
                                            var currentHash = hashProp.GetString();
                                            // If wrap-with-directory=true, we get 2+ hashes. 
                                            // The file hash has a 'Name' property. The directory hash has an empty 'Name'.
                                            // We want the file hash so we can 'cat' it later.
                                            if (root.TryGetProperty("Name", out var nameProp) && !string.IsNullOrEmpty(nameProp.GetString())) {
                                                ipfsCid = currentHash ?? ipfsCid;
                                            } else if (string.IsNullOrEmpty(ipfsCid)) {
                                                ipfsCid = currentHash ?? ipfsCid; // Fallback to whatever we find first
                                            }
                                        }
                                    } catch { }
                                }
                                _logger.LogInformation("Encrypted finals file distributed to IPFS. CID: {CID}", ipfsCid);
                                
                                // Explicitly distribute pin to other nodes in the cluster (fire-and-forget)
                                _ = Task.Run(() => DistributePinAsync(ipfsCid));
                            }
                        }
                        catch (Exception ex) { _logger.LogWarning("IPFS upload skipped (daemon may be offline): {Message}", ex.Message); }
                    }

                    if (ext == ".xlsx")
                    {
                        using var workbook = new XLWorkbook(tempFile);
                        var ws = workbook.Worksheet(1);
                        if (ws == null) return BadRequest(new { status = "Error", message = "The Excel file is empty." });
                        
                        var headerRow = ws.FirstRowUsed();
                        if (headerRow == null) return BadRequest(new { status = "Error", message = "No data found in Excel sheet." });
                        
                        var headerMap = new Dictionary<string, int>();
                        
                        foreach (var cell in headerRow.CellsUsed())
                        {
                            var colName = NormalizeHeader(cell.Value.ToString() ?? "");
                            if (!string.IsNullOrEmpty(colName)) headerMap[colName] = cell.Address.ColumnNumber;
                        }

                        var rows = ws.RowsUsed().Skip(1);
                        foreach (var row in rows)
                        {
                            string? GetVal(params string[] cols) 
                            {
                                foreach (var col in cols) 
                                {
                                    if (headerMap.ContainsKey(col)) 
                                    {
                                        var cell = row.Cell(headerMap[col]);
                                        var val = "";
                                        try { val = cell.HasFormula ? cell.CachedValue.ToString() : cell.Value.ToString(); }
                                        catch { val = cell.Value.ToString(); }
                                        if (!string.IsNullOrWhiteSpace(val)) return val.Trim();
                                    }
                                }
                                return null;
                            }

                            var sId = GetVal("student_id", "student_no", "id_number", "student_number");
                            if (string.IsNullOrEmpty(sId)) continue;

                            parsedRecords.Add(new GradeRequest
                            {
                                StudentId = sId ?? "",
                                StudentName = GetVal("student_name", "student", "full_name", "name") ?? "",
                                Section = !string.IsNullOrWhiteSpace(section) ? section : (GetVal("section", "class_section", "sec") ?? ""),
                                Grade = BuildUploadedGradePayload(
                                    GetUploadedTermGrade(GetVal, term),
                                    GetUploadedMidtermGrade(GetVal, term),
                                    GetUploadedFinalGrade(GetVal, term),
                                    term,
                                    GetVal("attendance", "midterm_attendance"),
                                    GetVal("final_attendance", "attendance_final")),
                                SubjectCode = GetVal("subject_code", "course_code", "code", "subject") ?? course ?? "Unknown",
                                SubjectName = GetVal("subject_name", "descriptive_title", "course") ?? course ?? "Unknown",
                                Course = GetVal("course", "department", "program") ?? course ?? "Unknown",
                                Semester = !string.IsNullOrEmpty(semester) ? semester : (GetVal("semester", "term") ?? "Unknown"),
                                SchoolYear = !string.IsNullOrEmpty(schoolYear) ? schoolYear : (GetVal("school_year", "schoolyear", "year") ?? "Unknown"),
                                Date = DateTime.Now.ToString("yyyy-MM-dd")
                            });
                        }
                    }
                    else if (ext == ".csv")
                    {
                        using (var reader = new StreamReader(tempFile, System.Text.Encoding.UTF8))
                        {
                            string? line;
                            int lineNum = 0;
                            Dictionary<string, int>? headerMap = null;

                            while ((line = await reader.ReadLineAsync()) != null)
                            {
                                lineNum++;
                                line = line.Trim();
                                if (string.IsNullOrEmpty(line)) continue;

                                var fields = ParseCsvLine(line);
                                if (lineNum == 1)
                                {
                                    headerMap = new Dictionary<string, int>();
                                    for (int i = 0; i < fields.Length; i++)
                                    {
                                        var colName = NormalizeHeader(fields[i]);
                                        if (!string.IsNullOrEmpty(colName)) headerMap[colName] = i;
                                    }
                                    continue;
                                }

                                string? GetVal(params string[] cols) 
                                {
                                    if (headerMap != null)
                                    {
                                        foreach (var col in cols)
                                        {
                                            if (headerMap.ContainsKey(col))
                                            {
                                                int idx = headerMap[col];
                                                if (idx < fields.Length && !string.IsNullOrWhiteSpace(fields[idx]))
                                                    return fields[idx].Trim().Trim('"');
                                            }
                                        }
                                    }
                                    return null;
                                }

                                var sId = GetVal("student_id", "student_no", "id_number", "student_number");
                                if (string.IsNullOrEmpty(sId)) continue;

                                parsedRecords.Add(new GradeRequest
                                {
                                    StudentId = sId ?? "",
                                    StudentName = GetVal("student_name", "student", "full_name", "name") ?? "",
                                    Section = !string.IsNullOrWhiteSpace(section) ? section : (GetVal("section", "class_section", "sec") ?? ""),
                                    Grade = BuildUploadedGradePayload(
                                        GetUploadedTermGrade(GetVal, term),
                                        GetUploadedMidtermGrade(GetVal, term),
                                        GetUploadedFinalGrade(GetVal, term),
                                        term,
                                        GetVal("attendance", "midterm_attendance"),
                                        GetVal("final_attendance", "attendance_final")),
                                    SubjectCode = GetVal("subject_code", "course_code", "code", "subject") ?? course ?? "Unknown",
                                    SubjectName = GetVal("subject_name", "descriptive_title", "course") ?? course ?? "Unknown",
                                    Course = GetVal("course", "department", "program") ?? course ?? "Unknown",
                                    Semester = !string.IsNullOrEmpty(semester) ? semester : (GetVal("semester", "term") ?? "Unknown"),
                                    SchoolYear = !string.IsNullOrEmpty(schoolYear) ? schoolYear : (GetVal("school_year", "schoolyear", "year") ?? "Unknown"),
                                    Date = DateTime.Now.ToString("yyyy-MM-dd")
                                });
                            }
                        }
                    }

                    var allLedgerGrades = new List<AcademicRecord>();
                    try {
                        var jsonResult = await _blockchainService.GetAllGradesAsync(facultyId);
                        using var doc = JsonDocument.Parse(jsonResult);
                        if (doc.RootElement.TryGetProperty("data", out var dataElement))
                        {
                            var blockchainGrades = JsonSerializer.Deserialize<List<AcademicRecord>>(
                                dataElement.GetRawText(), 
                                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                            );
                            if (blockchainGrades != null) allLedgerGrades.AddRange(blockchainGrades);
                        }
                    } catch (Exception ex) { _logger.LogWarning("Could not pre-fetch ledger grades for bulk upload: {Msg}", ex.Message); }

                    // Process all extracted records uniformly
                    var processedCombos = new HashSet<string>();
                    foreach (var record in parsedRecords)
                    {
                        try
                        {
                            if (string.IsNullOrEmpty(record.StudentId) || string.IsNullOrEmpty(record.Grade))
                            {
                                failureCount++;
                                errors.Add(new BulkUploadError { StudentId = record.StudentId ?? "UNKNOWN", Reason = "Missing student identifier or grade" });
                                continue;
                            }

                            var comboKey = $"{record.StudentId.ToLower()}_{(record.SubjectCode ?? record.Course ?? "").ToLower()}";
                            if (processedCombos.Contains(comboKey)) {
                                failureCount++;
                                errors.Add(new BulkUploadError { StudentId = record.StudentId, Reason = "Duplicate subject detected in upload" });
                                continue;
                            }
                            processedCombos.Add(comboKey);

                            using var conn = new NpgsqlConnection(_connectionString);
                            await conn.OpenAsync();

                            using var cmdStu = new NpgsqlCommand("SELECT sp.department, u.email FROM Users u JOIN StudentProfiles sp ON u.id = sp.user_id WHERE (sp.student_no = @sid OR u.email = @sid) AND u.role = 'student'", conn);
                            cmdStu.Parameters.AddWithValue("sid", record.StudentId);
                            string? stuDept = null, stuEmail = null;
                            string stuNumber = record.StudentId ?? "";
                            string stuName = record.StudentName ?? "";
                            using (var reader = await cmdStu.ExecuteReaderAsync())
                            {
                                if (await reader.ReadAsync())
                                {
                                    stuDept = reader.IsDBNull(0) ? null : reader.GetString(0);
                                    stuEmail = reader.GetString(1);
                                }
                            }

                            if (stuEmail == null)
                            {
                                // Auto-Create Missing Student to make the Grade upload perfectly idempotent
                                string defaultDob = "01/01/2005";
                                string defaultPassword = "01/01/2005";
                                string generatedEmail = record.StudentId + "@plv.edu.ph";
                                if (!string.IsNullOrEmpty(record.StudentId) && record.StudentId.Contains("@"))
                                    generatedEmail = record.StudentId;

                                using var txCreate = await conn.BeginTransactionAsync();
                                
                                using var cmdUser = new NpgsqlCommand("INSERT INTO Users (email, password_hash, role, status) VALUES (@email, crypt(@password, gen_salt('bf', 12)), 'student', 'APPROVED') RETURNING id", conn, txCreate);
                                cmdUser.Parameters.AddWithValue("email", generatedEmail);
                                cmdUser.Parameters.AddWithValue("password", defaultPassword);
                                int newUserId = (int)(await cmdUser.ExecuteScalarAsync() ?? throw new Exception("Failed to get ID"));

                                using var cmdProfile = new NpgsqlCommand(@"
                                    INSERT INTO StudentProfiles (user_id, full_name, student_no, department, section, date_of_birth, assignment_status) 
                                    VALUES (@uid, @name, @studentno, @dept, @sec, @dob, 'Enrolled')", conn, txCreate);
                                cmdProfile.Parameters.AddWithValue("uid", newUserId);
                                cmdProfile.Parameters.AddWithValue("name",
                                    !IsPlaceholderStudentName(record.StudentName, record.StudentId)
                                        ? record.StudentName
                                        : "Student " + (record.StudentId ?? ""));
                                cmdProfile.Parameters.AddWithValue("studentno", (object?)record.StudentId ?? DBNull.Value);
                                cmdProfile.Parameters.AddWithValue("dept", course ?? "Unassigned");
                                cmdProfile.Parameters.AddWithValue("sec", DBNull.Value);
                                cmdProfile.Parameters.AddWithValue("dob", DateTime.Parse(defaultDob));
                                await cmdProfile.ExecuteNonQueryAsync();
                                
                                await txCreate.CommitAsync();

                                var payload = new { email = generatedEmail, role = "student", password = defaultPassword };
                                var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                                var middlewareUrl = _configuration["Middleware:Url"] ?? _configuration["MIDDLEWARE_URL"] ?? "http://127.0.0.1:4000";
                                
                                using var client = _httpClientFactory.CreateClient("FabricCAClient");
                                var apiK = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
                                client.DefaultRequestHeaders.Add("x-api-key", apiK);
                                
                                var fabResponse = await client.PostAsync($"{middlewareUrl}/api/fabric/register-user", content);
                                
                                if (!fabResponse.IsSuccessStatusCode)
                                    throw new Exception($"Blockchain wallet auto-creation failed: {await fabResponse.Content.ReadAsStringAsync()}");
                                
                                stuEmail = generatedEmail;
                                stuDept = course ?? "Unassigned";
                                stuName = !string.IsNullOrWhiteSpace(record.StudentName) ? record.StudentName : $"Student {record.StudentId}";
                            }

                            using (var cmdStuIdentity = new NpgsqlCommand(@"
                                SELECT sp.student_no, sp.full_name
                                FROM Users u
                                JOIN StudentProfiles sp ON u.id = sp.user_id
                                WHERE (sp.student_no = @sid OR u.email = @sid) AND u.role = 'student'
                                LIMIT 1", conn))
                            {
                                cmdStuIdentity.Parameters.AddWithValue("sid", record.StudentId);
                                using var identityReader = await cmdStuIdentity.ExecuteReaderAsync();
                                if (await identityReader.ReadAsync())
                                {
                                    if (!identityReader.IsDBNull(0)) stuNumber = identityReader.GetString(0);
                                    if (!identityReader.IsDBNull(1))
                                    {
                                        stuName = ResolvePreferredStudentName(
                                            stuName,
                                            identityReader.GetString(1),
                                            record.StudentId
                                        );
                                    }
                                }
                            }

                            var resolvedFaculty = await ResolveApprovedAcademicIdentityAsync(
                                conn,
                                facultyId,
                                jwtUser
                            );
                            var facDept = resolvedFaculty.Department;
                            var effectiveFacultyId = resolvedFaculty.Identity;

                            if (facDept == null)
                            {
                                failureCount++;
                                errors.Add(new BulkUploadError { StudentId = record.StudentId ?? "Unknown", Reason = "Faculty not approved" });
                                continue;
                            }


                            var blockchainRecord = record.ToBlockchainRecord("PLV");
                            blockchainRecord.Section = !string.IsNullOrWhiteSpace(record.Section) ? record.Section : (section ?? "");
                            blockchainRecord.StudentHash = stuEmail ?? "";
                            blockchainRecord.StudentNo = stuNumber;
                            blockchainRecord.StudentName = stuName;
                            blockchainRecord.FacultyId = effectiveFacultyId ?? facultyId ?? "";
                            blockchainRecord.IpfsCid = ipfsCid;

                            string? existingId = null;
                            string? existingGradeJson = null;
                            
                            using (var cmdCheck = new NpgsqlCommand("SELECT id, grade FROM pending_grade_records WHERE LOWER(student_hash) = LOWER(@sh) AND LOWER(subject_code) = LOWER(@subj) AND school_year = @sy AND semester = @sem AND LOWER(section) = LOWER(@sec) LIMIT 1", conn))
                            {
                                cmdCheck.Parameters.AddWithValue("sh", blockchainRecord.StudentHash ?? "");
                                cmdCheck.Parameters.AddWithValue("subj", blockchainRecord.SubjectCode ?? "");
                                cmdCheck.Parameters.AddWithValue("sy", blockchainRecord.SchoolYear ?? "");
                                cmdCheck.Parameters.AddWithValue("sem", blockchainRecord.Semester ?? "");
                                cmdCheck.Parameters.AddWithValue("sec", blockchainRecord.Section ?? "");
                                using var checkReader = await cmdCheck.ExecuteReaderAsync();
                                if (await checkReader.ReadAsync())
                                {
                                    existingId = checkReader.GetString(0);
                                    existingGradeJson = checkReader.GetString(1);
                                }
                            }

                            if (existingId == null)
                            {
                                var existingLedgerRecord = allLedgerGrades.FirstOrDefault(g => 
                                    string.Equals(g.StudentHash, blockchainRecord.StudentHash, StringComparison.OrdinalIgnoreCase) && 
                                    string.Equals(g.SubjectCode, blockchainRecord.SubjectCode, StringComparison.OrdinalIgnoreCase) &&
                                    string.Equals(g.SchoolYear, blockchainRecord.SchoolYear, StringComparison.OrdinalIgnoreCase) &&
                                    string.Equals(g.Semester, blockchainRecord.Semester, StringComparison.OrdinalIgnoreCase) &&
                                    string.Equals(g.Section, blockchainRecord.Section, StringComparison.OrdinalIgnoreCase)
                                );
                                if (existingLedgerRecord != null) {
                                    existingId = existingLedgerRecord.Id;
                                    existingGradeJson = existingLedgerRecord.Grade;
                                }
                            }

                            blockchainRecord.Id = existingId ?? Guid.NewGuid().ToString();

                            string uploadedMidterm = "", uploadedFinals = "";
                            if (!string.IsNullOrEmpty(record.Grade) && record.Grade.TrimStart().StartsWith("{")) {
                                using var doc = JsonDocument.Parse(record.Grade);
                                if (doc.RootElement.TryGetProperty("midterm", out var m)) uploadedMidterm = GetJsonElementValueAsString(m);
                                if (doc.RootElement.TryGetProperty("finals", out var f)) uploadedFinals = GetJsonElementValueAsString(f);
                            } else {
                                if (string.Equals(term, "finals", StringComparison.OrdinalIgnoreCase)) uploadedFinals = record.Grade ?? "";
                                else uploadedMidterm = record.Grade ?? "";
                            }

                            string mergedMidterm = uploadedMidterm, mergedFinals = uploadedFinals;
                            if (!string.IsNullOrEmpty(existingGradeJson) && existingGradeJson.TrimStart().StartsWith("{")) {
                                using var doc = JsonDocument.Parse(existingGradeJson);
                                if (string.IsNullOrEmpty(mergedMidterm) && doc.RootElement.TryGetProperty("midterm", out var m)) mergedMidterm = GetJsonElementValueAsString(m);
                                if (string.IsNullOrEmpty(mergedFinals) && doc.RootElement.TryGetProperty("finals", out var f)) mergedFinals = GetJsonElementValueAsString(f);
                            } else if (!string.IsNullOrEmpty(existingGradeJson)) {
                                if (string.Equals(term, "finals", StringComparison.OrdinalIgnoreCase) && string.IsNullOrEmpty(mergedMidterm)) mergedMidterm = existingGradeJson;
                            }

                            blockchainRecord.Grade = BuildUploadedGradePayload(null, mergedMidterm, mergedFinals, term);
                                
                            using var transaction = await conn.BeginTransactionAsync();
                            try
                            {
                                using var cmdInitTable = new NpgsqlCommand(@"
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
                                    );", conn, transaction);
                                await cmdInitTable.ExecuteNonQueryAsync();

                                using var cmdEnsureGradeText = new NpgsqlCommand("ALTER TABLE pending_grade_records ALTER COLUMN grade TYPE TEXT;", conn, transaction);
                                await cmdEnsureGradeText.ExecuteNonQueryAsync();

                                using var cmdEnsureIdentityColumns = new NpgsqlCommand(EnsurePendingGradeRecordIdentityColumnsSql(), conn, transaction);
                                await cmdEnsureIdentityColumns.ExecuteNonQueryAsync();

                                using var cmdAddConstraint = new NpgsqlCommand(EnsurePendingGradeSectionScopedConstraintSql(), conn, transaction);
                                await cmdAddConstraint.ExecuteNonQueryAsync();

                                using var cmdStage = new NpgsqlCommand(@"
                                    INSERT INTO pending_grade_records (id, student_hash, student_no, student_name, section, course, subject_code, grade, semester, school_year, faculty_id, date, ipfs_cid, status)
                        VALUES (@id, @sh, @studentNo, @studentName, @sec, @course, @subj, @gr, @sem, @sy, @fac, @dt, @ipfs, 'Draft')
                                    ON CONFLICT (id) DO UPDATE SET
                                        student_no = EXCLUDED.student_no,
                                        student_name = EXCLUDED.student_name,
                                        section = EXCLUDED.section,
                                        course = EXCLUDED.course,
                                        grade = EXCLUDED.grade,
                                        faculty_id = EXCLUDED.faculty_id,
                                        date = EXCLUDED.date,
                                        ipfs_cid = COALESCE(NULLIF(EXCLUDED.ipfs_cid, ''), pending_grade_records.ipfs_cid),
                            status = 'Draft';", conn, transaction);
                                cmdStage.Parameters.AddWithValue("id", blockchainRecord.Id ?? Guid.NewGuid().ToString());
                                cmdStage.Parameters.AddWithValue("sh", blockchainRecord.StudentHash ?? "");
                                cmdStage.Parameters.AddWithValue("studentNo", blockchainRecord.StudentNo ?? "");
                                cmdStage.Parameters.AddWithValue("studentName", blockchainRecord.StudentName ?? "");
                                cmdStage.Parameters.AddWithValue("sec", blockchainRecord.Section ?? "");
                                cmdStage.Parameters.AddWithValue("course", blockchainRecord.Course ?? "");
                                cmdStage.Parameters.AddWithValue("subj", blockchainRecord.SubjectCode ?? "");
                                cmdStage.Parameters.AddWithValue("gr", blockchainRecord.Grade ?? "");
                                cmdStage.Parameters.AddWithValue("sem", blockchainRecord.Semester ?? "");
                                cmdStage.Parameters.AddWithValue("sy", blockchainRecord.SchoolYear ?? "");
                                cmdStage.Parameters.AddWithValue("fac", blockchainRecord.FacultyId ?? "");
                                cmdStage.Parameters.AddWithValue("dt", blockchainRecord.Date ?? "");
                                cmdStage.Parameters.AddWithValue("ipfs", blockchainRecord.IpfsCid ?? "");
                                await cmdStage.ExecuteNonQueryAsync();

                                using var cmdEnsureLogGradeText = new NpgsqlCommand(@"
                                    ALTER TABLE gradecorrectionlogs
                                    ALTER COLUMN oldgrade TYPE TEXT,
                                    ALTER COLUMN newgrade TYPE TEXT;", conn, transaction);
                                await cmdEnsureLogGradeText.ExecuteNonQueryAsync();

                                using var cmdLog = new NpgsqlCommand(@"
                                    INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                                    VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn, transaction);
                                cmdLog.Parameters.AddWithValue("rid", blockchainRecord.Id);
                                cmdLog.Parameters.AddWithValue("old", (object)DBNull.Value);
                                cmdLog.Parameters.AddWithValue("new", GetGradeLogValue(record.Grade, term));
                                cmdLog.Parameters.AddWithValue("reason", "Bulk Excel/CSV Upload (Staged)");
                                cmdLog.Parameters.AddWithValue("appr", effectiveFacultyId ?? facultyId ?? (object)DBNull.Value);
                                await cmdLog.ExecuteNonQueryAsync();
                                
                                await transaction.CommitAsync();
                                successCount++;
                            }
                            catch (Exception txEx)
                            {
                                await transaction.RollbackAsync();
                                failureCount++;
                                errors.Add(new BulkUploadError { StudentId = record.StudentId, Reason = txEx.Message });
                            }
                        }
                        catch (Exception ex)
                        {
                            failureCount++;
                            errors.Add(new BulkUploadError { StudentId = record.StudentId ?? "ERROR", Reason = ex.Message });
                        }
                    }
                }
                finally
                {
                if (System.IO.File.Exists(tempFile))
                    System.IO.File.Delete(tempFile);
                }

                await NotifyAcademicDataChangedAsync("grades_bulk_uploaded", course, facultyId);
                return Ok(new
                {
                    status = failureCount == 0 ? "Success" : "Partial Success",
                    totalProcessed = successCount + failureCount,
                    successful = successCount,
                    failed = failureCount,
                    errors = errors.Any() ? errors : null,
                    timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "CSV upload failed");
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        private static string[] ParseCsvLine(string line)
        {
            var fields = new List<string>();
            var current = new StringBuilder();
            var inQuotes = false;

            for (int i = 0; i < line.Length; i++)
            {
                var c = line[i];
                if (c == '"')
                {
                    if (inQuotes && i + 1 < line.Length && line[i + 1] == '"')
                    {
                        current.Append('"');
                        i++;
                    }
                    else
                    {
                        inQuotes = !inQuotes;
                    }
                }
                else if (c == ',' && !inQuotes)
                {
                    fields.Add(current.ToString());
                    current.Clear();
                }
                else
                {
                    current.Append(c);
                }
            }

            fields.Add(current.ToString());
            return fields.ToArray();
        }

        private string? GetCsvField(string[] fields, Dictionary<string, int>? headerMap, string fieldName)
        {
            if (headerMap != null && headerMap.ContainsKey(fieldName))
            {
                int idx = headerMap[fieldName];
                if (idx < fields.Length)
                    return fields[idx].Trim();
            }
            return null;
        }

        [HttpPost("correct")]
        public async Task<IActionResult> CorrectGrade([FromBody] GradeCorrectionRequest correction)
        {
            if (string.IsNullOrEmpty(correction.RecordID)) 
                return BadRequest(new { status = "Error", message = "RecordID is required." });

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                using var cmdCheck = new NpgsqlCommand("SELECT grade FROM pending_grade_records WHERE id = @id", conn);
                cmdCheck.Parameters.AddWithValue("id", correction.RecordID);
                var existingPending = await cmdCheck.ExecuteScalarAsync();

                if (existingPending != null)
                {
                    using var cmdUpdate = new NpgsqlCommand("UPDATE pending_grade_records SET grade = @grade, status = 'Corrected', date = @dt WHERE id = @id", conn);
                    cmdUpdate.Parameters.AddWithValue("grade", correction.NewGrade ?? "");
                    cmdUpdate.Parameters.AddWithValue("dt", DateTime.UtcNow.ToString("yyyy-MM-dd"));
                    cmdUpdate.Parameters.AddWithValue("id", correction.RecordID ?? (object)DBNull.Value);
                    await cmdUpdate.ExecuteNonQueryAsync();
                }
                else
                {
                    string existingGradeJson = await _blockchainService.GetGradeAsync(correction.RecordID, correction.ApprovedBy);
                    var gradeToUpdate = JsonSerializer.Deserialize<AcademicRecord>(existingGradeJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (gradeToUpdate == null) 
                        return NotFound(new { status = "Error", message = "Original grade record not found on blockchain." });

                    gradeToUpdate.Grade = correction.NewGrade ?? "";
                    gradeToUpdate.FacultyId = correction.ApprovedBy ?? "";
                    gradeToUpdate.Date = DateTime.UtcNow.ToString("yyyy-MM-dd");
                    
                    await _blockchainService.UpdateGradeAsync(gradeToUpdate, correction.ApprovedBy ?? "Unknown");
                }

                using var cmdLog = new NpgsqlCommand(@"
                    INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                    VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn);
                cmdLog.Parameters.AddWithValue("rid", correction.RecordID ?? (object)DBNull.Value);
                cmdLog.Parameters.AddWithValue("old", correction.OldGrade != null ? (object)correction.OldGrade : DBNull.Value);
                cmdLog.Parameters.AddWithValue("new", correction.NewGrade != null ? (object)correction.NewGrade : DBNull.Value);
                cmdLog.Parameters.AddWithValue("reason", correction.ReasonText ?? "");
                cmdLog.Parameters.AddWithValue("appr", correction.ApprovedBy ?? "");
                await cmdLog.ExecuteNonQueryAsync();

                await NotifyAcademicDataChangedAsync("grade_corrected", null, correction.ApprovedBy);
                return Ok(new { status = "Success", message = "Correction synchronized." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpGet("all")]
        public async Task<IActionResult> GetAllGrades([FromQuery] string invokerId)
        {
            if (string.IsNullOrEmpty(invokerId)) 
                return BadRequest(new { status = "Error", message = "invokerId query parameter is required." });

            var jwtRole = User.Claims.FirstOrDefault(c => c.Type == "dbRole")?.Value ?? User.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Role)?.Value;
            bool isAuthorizedViewer = jwtRole == "registrar" || jwtRole == "chairperson" || jwtRole == "department_admin" || jwtRole == "deptAdmin" || jwtRole == "admin";
            bool isStudent = jwtRole == "student";

            try
            {
                var allGrades = new List<AcademicRecord>();

                try {
                    var jsonResult = await _blockchainService.GetAllGradesAsync(invokerId);
                    using var doc = JsonDocument.Parse(jsonResult);
                    if (doc.RootElement.TryGetProperty("data", out var dataElement))
                    {
                        var blockchainGrades = JsonSerializer.Deserialize<List<AcademicRecord>>(
                            dataElement.GetRawText(), 
                            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                        );
                        if (blockchainGrades != null) allGrades.AddRange(blockchainGrades);
                    }
                } catch (Exception ex) {
                    _logger.LogWarning("Could not fetch blockchain grades: {Msg}", ex.Message);
                }

                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                
                using var cmdInitTable = new NpgsqlCommand("CREATE TABLE IF NOT EXISTS pending_grade_records (id VARCHAR(255) PRIMARY KEY, student_hash VARCHAR(255), student_no VARCHAR(255), student_name VARCHAR(255), section VARCHAR(100), course VARCHAR(255), subject_code VARCHAR(100), grade TEXT, semester VARCHAR(50), school_year VARCHAR(50), faculty_id VARCHAR(255), date VARCHAR(50), ipfs_cid VARCHAR(255), status VARCHAR(50), note TEXT);", conn);
                await cmdInitTable.ExecuteNonQueryAsync();

                using var cmdEnsureIdentityColumns = new NpgsqlCommand(EnsurePendingGradeRecordIdentityColumnsSql(), conn);
                await cmdEnsureIdentityColumns.ExecuteNonQueryAsync();

                using var cmd = new NpgsqlCommand("SELECT id, student_hash, student_no, student_name, section, course, subject_code, grade, semester, school_year, faculty_id, date, ipfs_cid, status, note FROM pending_grade_records", conn);
                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    allGrades.Add(new AcademicRecord {
                        Id = reader.IsDBNull(0) ? "" : reader.GetString(0),
                        StudentHash = reader.IsDBNull(1) ? "" : reader.GetString(1),
                        StudentNo = reader.IsDBNull(2) ? "" : reader.GetString(2),
                        StudentName = reader.IsDBNull(3) ? "" : reader.GetString(3),
                        Section = reader.IsDBNull(4) ? "" : reader.GetString(4),
                        Course = reader.IsDBNull(5) ? "" : reader.GetString(5),
                        SubjectCode = reader.IsDBNull(6) ? "" : reader.GetString(6),
                        Grade = reader.IsDBNull(7) ? "" : reader.GetString(7),
                        Semester = reader.IsDBNull(8) ? "" : reader.GetString(8),
                        SchoolYear = reader.IsDBNull(9) ? "" : reader.GetString(9),
                        FacultyId = reader.IsDBNull(10) ? "" : reader.GetString(10),
                        Date = reader.IsDBNull(11) ? "" : reader.GetString(11),
                        IpfsCid = reader.IsDBNull(12) ? "" : reader.GetString(12),
                        Status = reader.IsDBNull(13) ? "" : reader.GetString(13),
                        Note = reader.IsDBNull(14) ? "" : reader.GetString(14),
                        University = "PLV",
                        Version = 1
                    });
                }
                await reader.CloseAsync();

                // Deduplicate records that might temporarily exist in both staging and the ledger.
                // Prefer the richer local staged copy when it contains student number/name metadata.
                allGrades = allGrades
                    .GroupBy(g => g.Id)
                    .Select(group => group
                        .OrderByDescending(GetAcademicRecordCompletenessScore)
                        .ThenByDescending(record => string.Equals(record.Status, "Submitted", StringComparison.OrdinalIgnoreCase) || string.Equals(record.Status, "Issued", StringComparison.OrdinalIgnoreCase))
                        .First())
                    .ToList();

                var enrichedGrades = new List<Dictionary<string, object>>();
                
                using var cmdProfiles = new NpgsqlCommand("SELECT u.email, sp.department, sp.section, sp.student_no, sp.full_name FROM Users u JOIN StudentProfiles sp ON u.id = sp.user_id", conn);
                var studentProfiles = new Dictionary<string, (string dept, string sec, string studentNo, string fullName)>(StringComparer.OrdinalIgnoreCase);
                using var profReader = await cmdProfiles.ExecuteReaderAsync();
                while (await profReader.ReadAsync())
                {
                    studentProfiles[profReader.GetString(0)] = (
                        profReader.IsDBNull(1) ? "Unknown" : profReader.GetString(1),
                        profReader.IsDBNull(2) ? "Unknown" : profReader.GetString(2),
                        profReader.IsDBNull(3) ? "" : profReader.GetString(3),
                        profReader.IsDBNull(4) ? "" : profReader.GetString(4)
                    );
                }
                await profReader.CloseAsync();

                foreach(var g in allGrades) 
                {
                    string dept = "Unknown";
                    string profileSection = "Unknown";
                    string sec = ResolveDisplaySection(g.Section, null);
                    string year = ResolveYearLevelFromSection(sec, null);
                    string studentNo = g.StudentNo ?? "";
                    string studentName = g.StudentName ?? "";
                    
                    if (g.StudentHash != null && studentProfiles.TryGetValue(g.StudentHash, out var prof))
                    {
                        dept = prof.dept;
                        profileSection = prof.sec;
                        sec = ResolveDisplaySection(g.Section, prof.sec);
                        if (string.IsNullOrWhiteSpace(studentNo)) studentNo = prof.studentNo;
                        if (string.IsNullOrWhiteSpace(studentName) || IsPlaceholderStudentName(studentName, studentNo))
                        {
                            studentName = ResolvePreferredStudentName(studentName, prof.fullName, studentNo);
                        }
                        year = ResolveYearLevelFromSection(sec, prof.sec);
                    }

                    string safeStudentHash = g.StudentHash ?? "";
                    string safeFacultyId = g.FacultyId ?? "";

                    if (!isAuthorizedViewer && 
                        !string.Equals(g.FacultyId, invokerId, StringComparison.OrdinalIgnoreCase) && 
                        !string.Equals(g.StudentHash, invokerId, StringComparison.OrdinalIgnoreCase))
                    {
                        safeStudentHash = "[REDACTED]";
                        safeFacultyId = "[REDACTED]";
                    }

                    if (isStudent && !string.Equals(g.Status, "Finalized", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                        g.Grade = "";
                        g.Note = "Pending Finalization";
                    }

                    enrichedGrades.Add(new Dictionary<string, object> {
                        { "id", g.Id ?? "" },
                        { "student_hash", safeStudentHash },
                        { "studentId", !string.IsNullOrWhiteSpace(studentNo) ? studentNo : safeStudentHash },
                        { "student_no", studentNo },
                        { "studentNo", studentNo },
                        { "student_name", studentName },
                        { "section", sec },
                        { "record_section", g.Section ?? "" },
                        { "student_section", profileSection },
                        { "course", g.Course ?? "" },
                        { "subject_code", g.SubjectCode ?? "" },
                        { "grade", g.Grade ?? "" },
                        { "semester", g.Semester ?? "" },
                        { "school_year", g.SchoolYear ?? "" },
                        { "faculty_id", safeFacultyId },
                        { "date", g.Date ?? "" },
                        { "ipfs_cid", g.IpfsCid ?? "" },
                        { "status", g.Status ?? "" },
                        { "note", g.Note ?? "" },
                        { "university", g.University ?? "" },
                        { "version", g.Version },
                        { "department", dept },
                        { "year_level", year }
                    });
                }
                
                var sortedGrades = enrichedGrades
                    .OrderBy(g => g["department"].ToString())
                    .ThenBy(g => g["year_level"].ToString())
                    .ThenBy(g => g["section"].ToString())
                    .ToList();

                return Ok(new { status = "Success", count = sortedGrades.Count, data = sortedGrades });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to fetch grades");
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpGet("{recordId}")]
        public async Task<IActionResult> GetGrade(string recordId, [FromQuery] string invokerId)
        {
            if (string.IsNullOrEmpty(invokerId)) 
                return BadRequest(new { status = "Error", message = "invokerId query parameter is required." });

            var jwtRole = User.Claims.FirstOrDefault(c => c.Type == "dbRole")?.Value ?? User.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Role)?.Value;
            bool isStudent = jwtRole == "student";

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var cmd = new NpgsqlCommand("SELECT id, student_hash, student_no, student_name, section, course, subject_code, grade, semester, school_year, faculty_id, date, ipfs_cid, status, note FROM pending_grade_records WHERE id = @id", conn);
                cmd.Parameters.AddWithValue("id", recordId);
                
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    if (await reader.ReadAsync())
                    {
                        var localGrade = new AcademicRecord {
                            Id = reader.IsDBNull(0) ? "" : reader.GetString(0),
                            StudentHash = reader.IsDBNull(1) ? "" : reader.GetString(1),
                            StudentNo = reader.IsDBNull(2) ? "" : reader.GetString(2),
                            StudentName = reader.IsDBNull(3) ? "" : reader.GetString(3),
                            Section = reader.IsDBNull(4) ? "" : reader.GetString(4),
                            Course = reader.IsDBNull(5) ? "" : reader.GetString(5),
                            SubjectCode = reader.IsDBNull(6) ? "" : reader.GetString(6),
                            Grade = reader.IsDBNull(7) ? "" : reader.GetString(7),
                            Semester = reader.IsDBNull(8) ? "" : reader.GetString(8),
                            SchoolYear = reader.IsDBNull(9) ? "" : reader.GetString(9),
                            FacultyId = reader.IsDBNull(10) ? "" : reader.GetString(10),
                            Date = reader.IsDBNull(11) ? "" : reader.GetString(11),
                            IpfsCid = reader.IsDBNull(12) ? "" : reader.GetString(12),
                            Status = reader.IsDBNull(13) ? "" : reader.GetString(13),
                            Note = reader.IsDBNull(14) ? "" : reader.GetString(14),
                            University = "PLV",
                            Version = 1
                        };
                        
                        if (isStudent && !string.Equals(localGrade.Status, "Finalized", StringComparison.OrdinalIgnoreCase))
                            return NotFound(new { status = "Error", message = "Grade is pending finalization." });
                        {
                            localGrade.Grade = "";
                            localGrade.Note = "Pending Finalization";
                        }

                        return Ok(new { status = "Success", data = localGrade });
                    }
                }

                var jsonResult = await _blockchainService.GetGradeAsync(recordId, invokerId);
                var ledgerGrade = JsonSerializer.Deserialize<AcademicRecord>(jsonResult, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return Ok(new { status = "Success", data = ledgerGrade });
            }
            catch (Exception)
            {
                return NotFound(new { status = "Error", message = $"Grade not found: {recordId}" });
            }
        }

        [HttpGet("history/{recordId}")]
        [Authorize(Roles = "registrar,admin,department_admin,deptAdmin,faculty,chairperson")]
        public async Task<IActionResult> GetGradeHistory(string recordId, [FromQuery] string invokerId)
        {
            if (string.IsNullOrEmpty(invokerId)) 
                return BadRequest(new { status = "Error", message = "invokerId query parameter is required." });

            var jwtRole = User.Claims.FirstOrDefault(c => c.Type == "dbRole")?.Value ?? User.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Role)?.Value;
            if (jwtRole == "student") 
                return StatusCode(403, new { status = "Error", message = "ABAC Denied: Students cannot view the full audit history." });

            try
            {
                var client = _httpClientFactory.CreateClient("FabricCAClient");
                var apiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY") ?? _configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
                client.DefaultRequestHeaders.Add("x-api-key", apiKey);
                var middlewareUrl = _configuration["Middleware:Url"] ?? _configuration["MIDDLEWARE_URL"] ?? "http://127.0.0.1:4000";
                
                var payload = new { fcn = "GetGradeHistory", args = new[] { recordId }, username = invokerId };
                var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                
                var response = await client.PostAsync($"{middlewareUrl}/api/fabric/query", content);
                
                if (!response.IsSuccessStatusCode)
                {
                    var errBody = await response.Content.ReadAsStringAsync();
                    return StatusCode((int)response.StatusCode, new { status = "Error", message = $"Failed to query blockchain history: {errBody}" });
                }
                
                var responseStr = await response.Content.ReadAsStringAsync();
                return Ok(new { status = "Success", data = JsonDocument.Parse(responseStr) });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost("approve/{recordId}")]
        public async Task<IActionResult> ApproveGrade(string recordId, [FromQuery] string invokerId)
        {
            if (string.IsNullOrEmpty(invokerId)) 
                return BadRequest(new { status = "Error", message = "invokerId query parameter is required." });
            
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var cmd = new NpgsqlCommand("UPDATE pending_grade_records SET status = 'DepartmentApproved' WHERE id = @id RETURNING id", conn);
                cmd.Parameters.AddWithValue("id", recordId);
                var res = await cmd.ExecuteScalarAsync();
                
                if (res != null) 
                {
                    await NotifyAcademicDataChangedAsync("grade_approved", null, invokerId);
                    return Ok(new { status = "Success", message = "Grade approved by Department successfully (Staged)." });
                }

                await _blockchainService.ApproveGradeAsync(recordId, invokerId);
                await NotifyAcademicDataChangedAsync("grade_approved", null, invokerId);
                return Ok(new { status = "Success", message = "Grade approved by Department successfully (Ledger)." });
            }
            catch (Exception ex) 
            { 
                return StatusCode(500, new { status = "Error", message = ex.Message }); 
            }
        }

        [HttpPost("finalize/{recordId}")]
        public async Task<IActionResult> FinalizeGrade(string recordId, [FromQuery] string invokerId)
        {
            if (string.IsNullOrEmpty(invokerId)) 
                return BadRequest(new { status = "Error", message = "invokerId query parameter is required." });
            
            var jwtRole = User.Claims.FirstOrDefault(c => c.Type == "dbRole")?.Value ?? User.Claims.FirstOrDefault(c => c.Type == ClaimTypes.Role)?.Value;
            var isRegistrar = jwtRole == "registrar" || jwtRole == "admin" || jwtRole == "RegistrarMSP";
            
            if (!isRegistrar)
            {
                using var connIntercept = new NpgsqlConnection(_connectionString);
                await connIntercept.OpenAsync();
                using var cmdApprove = new NpgsqlCommand("UPDATE pending_grade_records SET status = 'DepartmentApproved' WHERE id = @id", connIntercept);
                cmdApprove.Parameters.AddWithValue("id", recordId);
                await cmdApprove.ExecuteNonQueryAsync();
                
                await NotifyAcademicDataChangedAsync("grade_forwarded", null, invokerId);
                return Ok(new { status = "Success", message = "Section forwarded to Registrar successfully." });
            }
            
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                
                using var cmd = new NpgsqlCommand("SELECT id, student_hash, student_no, student_name, section, course, subject_code, grade, semester, school_year, faculty_id, date, ipfs_cid, note FROM pending_grade_records WHERE id = @id", conn);
                cmd.Parameters.AddWithValue("id", recordId);
                
                AcademicRecord? pendingRecord = null;
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    if (await reader.ReadAsync())
                    {
                        pendingRecord = new AcademicRecord {
                            Id = reader.IsDBNull(0) ? "" : reader.GetString(0),
                            StudentHash = reader.IsDBNull(1) ? "" : reader.GetString(1),
                            StudentNo = reader.IsDBNull(2) ? "" : reader.GetString(2),
                            StudentName = reader.IsDBNull(3) ? "" : reader.GetString(3),
                            Section = reader.IsDBNull(4) ? "" : reader.GetString(4),
                            Course = reader.IsDBNull(5) ? "" : reader.GetString(5),
                            SubjectCode = reader.IsDBNull(6) ? "" : reader.GetString(6),
                            Grade = reader.IsDBNull(7) ? "" : reader.GetString(7),
                            Semester = reader.IsDBNull(8) ? "" : reader.GetString(8),
                            SchoolYear = reader.IsDBNull(9) ? "" : reader.GetString(9),
                            FacultyId = reader.IsDBNull(10) ? "" : reader.GetString(10),
                            Date = reader.IsDBNull(11) ? "" : reader.GetString(11),
                            IpfsCid = reader.IsDBNull(12) ? "" : reader.GetString(12),
                            Note = reader.IsDBNull(13) ? "" : reader.GetString(13),
                            Status = "Finalized",
                            University = "PLV",
                            Version = 1
                        };
                    }
                }

                if (pendingRecord != null)
                {
                    pendingRecord.Grade = NormalizeAttendanceForLedger(pendingRecord.Grade);
                    var facId = string.IsNullOrEmpty(pendingRecord.FacultyId) ? invokerId : pendingRecord.FacultyId;
                    
                    bool isExistingOnLedger = false;
                    try {
                        var existing = await _blockchainService.GetGradeAsync(recordId, facId);
                        if (!string.IsNullOrEmpty(existing) && !existing.Contains("error") && !existing.Contains("not found")) isExistingOnLedger = true;
                    } catch { }

                    if (isExistingOnLedger) await _blockchainService.UpdateGradeAsync(pendingRecord, facId);
                    else await _blockchainService.SubmitGradeAsync(pendingRecord, facId);

                    await _blockchainService.ApproveGradeAsync(recordId, invokerId);
                    await _blockchainService.FinalizeGradeAsync(recordId, invokerId);
                    
                    using var cmdDel = new NpgsqlCommand("DELETE FROM pending_grade_records WHERE id = @id", conn);
                    cmdDel.Parameters.AddWithValue("id", recordId);
                    await cmdDel.ExecuteNonQueryAsync();
                    
                    NotifyStudentOfFinalization(recordId, invokerId);
                    await NotifyAcademicDataChangedAsync("grade_finalized", pendingRecord.Course, invokerId);
                    return Ok(new { status = "Success", message = "Grade finalized and successfully written to Ledger." });
                }

                await _blockchainService.FinalizeGradeAsync(recordId, invokerId);
                NotifyStudentOfFinalization(recordId, invokerId);
                await NotifyAcademicDataChangedAsync("grade_finalized", null, invokerId);
                return Ok(new { status = "Success", message = "Grade finalized on Ledger." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        private void NotifyStudentOfFinalization(string recordId, string invokerId)
        {
            _ = Task.Run(async () => {
                try {
                    var recJson = await _blockchainService.GetGradeAsync(recordId, invokerId);
                    var finRec = JsonSerializer.Deserialize<AcademicRecord>(recJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (finRec != null && !string.IsNullOrEmpty(finRec.StudentHash) && finRec.StudentHash.Contains("@")) {
                        var subj = "PLV Academic Update: Grade Finalized";
                        var htmlBody = $"<div style='font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;'><h2 style='color: #003366;'>Pamantasan ng Lungsod ng Valenzuela</h2><p>Hello,</p><p>Your grade for subject <strong>{finRec.SubjectCode}</strong> has been officially finalized and permanently recorded to the academic ledger.</p><p>You may view it on the Student Portal.</p></div>";
                        await _emailService.SendEmailAsync(finRec.StudentHash, subj, htmlBody, true);
                    }
                } catch (Exception ex) { _logger.LogWarning(ex, "Failed to send finalization notification to student."); }
            });
        }

        public class SubmitFinalsRequest
        {
            public string FinalGrade { get; set; } = string.Empty;
            public string InvokerId { get; set; } = string.Empty;
        }

        [HttpPost("submit-finals/{recordId}")]
        public async Task<IActionResult> SubmitFinals(string recordId, [FromBody] SubmitFinalsRequest request)
        {
            if (string.IsNullOrEmpty(recordId) || string.IsNullOrEmpty(request.FinalGrade))
            {
                return BadRequest(new { status = "Error", message = "Record ID and final grade are required." });
            }

            var invokerId = request.InvokerId ?? User.Identity?.Name ?? "Unknown";

            try
            {
                // 1. Fetch the existing record from the ledger or staging area
                string existingGradeJson = await _blockchainService.GetGradeAsync(recordId, invokerId);
                var gradeRecord = JsonSerializer.Deserialize<AcademicRecord>(existingGradeJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

                if (gradeRecord == null)
                {
                    return NotFound(new { status = "Error", message = "Original grade record not found on blockchain." });
                }

                // 2. Parse the existing Grade JSON payload to get the midterm grade
                string midtermGradeStr = "";
                if (!string.IsNullOrEmpty(gradeRecord.Grade) && gradeRecord.Grade.Trim().StartsWith("{"))
                {
                    using var gradePayloadDoc = JsonDocument.Parse(gradeRecord.Grade);
                    if (gradePayloadDoc.RootElement.TryGetProperty("midterm", out var midtermProp))
                    {
                        midtermGradeStr = GetJsonElementValueAsString(midtermProp);
                    }
                }
                else
                {
                    // Fallback: If it's not a JSON object, assume the existing grade is the midterm
                    midtermGradeStr = gradeRecord.Grade;
                }

                // 3. Build the new, merged payload using the existing helper
                string newGradePayload = BuildUploadedGradePayload(
                    rawGrade: request.FinalGrade, // The new grade being submitted for the active term
                    rawMidterm: midtermGradeStr,   // The existing midterm grade
                    rawFinals: request.FinalGrade, // The new final grade
                    term: "finals"                 // Specify the context is for finals
                );

                // 4. Update the record and submit it to the blockchain
                gradeRecord.Grade = newGradePayload;
                gradeRecord.Date = DateTime.UtcNow.ToString("yyyy-MM-dd");
                gradeRecord.Status = "Corrected"; // Or a more specific status like "FinalsSubmitted"

                await _blockchainService.UpdateGradeAsync(gradeRecord, invokerId);

                // 5. Log the update for audit purposes
                using (var conn = new NpgsqlConnection(_connectionString))
                {
                    await conn.OpenAsync();
                    using var cmdLog = new NpgsqlCommand(@"
                        INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                        VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn);
                    cmdLog.Parameters.AddWithValue("rid", recordId);
                    cmdLog.Parameters.AddWithValue("old", GetGradeLogValue(gradeRecord.Grade, "midterm"));
                    cmdLog.Parameters.AddWithValue("new", GetGradeLogValue(newGradePayload, "finals"));
                    cmdLog.Parameters.AddWithValue("reason", "Finals Grade Entry");
                    cmdLog.Parameters.AddWithValue("appr", invokerId);
                    await cmdLog.ExecuteNonQueryAsync();
                }

                await NotifyAcademicDataChangedAsync("finals_grade_submitted", gradeRecord.Course, invokerId);

                return Ok(new { status = "Success", message = "Finals grade has been successfully recorded and is pending review." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error submitting final grade for record {RecordId}", recordId);
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        private async Task<bool> UpdatePendingGradeJsonAsync(string recordId, Action<System.Text.Json.Nodes.JsonObject> updateAction)
        {
            try {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var cmdSel = new NpgsqlCommand("SELECT grade FROM pending_grade_records WHERE id = @id", conn);
                cmdSel.Parameters.AddWithValue("id", recordId);
                var existingGrade = await cmdSel.ExecuteScalarAsync() as string;
                
                if (existingGrade == null) return false;
                
                System.Text.Json.Nodes.JsonObject gradeObj;
                if (existingGrade.TrimStart().StartsWith("{")) {
                    try { gradeObj = System.Text.Json.Nodes.JsonNode.Parse(existingGrade)?.AsObject() ?? new System.Text.Json.Nodes.JsonObject(); }
                    catch { gradeObj = new System.Text.Json.Nodes.JsonObject(); gradeObj["finalAverage"] = existingGrade; }
                } else {
                    gradeObj = new System.Text.Json.Nodes.JsonObject(); gradeObj["finalAverage"] = existingGrade;
                }
                
                updateAction(gradeObj);
                
                using var cmdUpd = new NpgsqlCommand("UPDATE pending_grade_records SET grade = @gr, date = @dt WHERE id = @id", conn);
                cmdUpd.Parameters.AddWithValue("gr", gradeObj.ToJsonString());
                cmdUpd.Parameters.AddWithValue("dt", DateTime.UtcNow.ToString("yyyy-MM-dd"));
                cmdUpd.Parameters.AddWithValue("id", recordId);
                await cmdUpd.ExecuteNonQueryAsync();
                
                return true;
            } catch { return false; }
        }

        [HttpPost("flag/{recordId}")]
        public async Task<IActionResult> FlagGrade(string recordId, [FromQuery] string invokerId, [FromBody] FlagRequest request)
        {
            if (string.IsNullOrEmpty(invokerId)) 
                return BadRequest(new { status = "Error", message = "invokerId query parameter is required." });

            try
            {
                if (await UpdatePendingGradeJsonAsync(recordId, obj => obj["flagged"] = request.IsFlagged))
                {
                    await NotifyAcademicDataChangedAsync(request.IsFlagged ? "grade_flagged" : "grade_unflagged", null, invokerId);
                    return Ok(new { status = "Success", message = request.IsFlagged ? "Record flagged for Chairperson review (Staged)." : "Flag removed (Staged)." });
                }

                var jsonResult = await _blockchainService.GetGradeAsync(recordId, invokerId);
                var gradeToUpdate = JsonSerializer.Deserialize<AcademicRecord>(jsonResult, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (gradeToUpdate == null) 
                    return NotFound(new { status = "Error", message = "Record not found on blockchain." });

                System.Text.Json.Nodes.JsonObject gradeObj;
                if (!string.IsNullOrEmpty(gradeToUpdate.Grade) && gradeToUpdate.Grade.TrimStart().StartsWith("{"))
                {
                    try {
                        gradeObj = System.Text.Json.Nodes.JsonNode.Parse(gradeToUpdate.Grade)?.AsObject() ?? new System.Text.Json.Nodes.JsonObject();
                    } catch {
                        gradeObj = new System.Text.Json.Nodes.JsonObject();
                        gradeObj["finalAverage"] = gradeToUpdate.Grade;
                    }
                }
                else
                {
                    gradeObj = new System.Text.Json.Nodes.JsonObject();
                    gradeObj["finalAverage"] = gradeToUpdate.Grade ?? "";
                }

                gradeObj["flagged"] = request.IsFlagged;
                gradeToUpdate.Grade = gradeObj.ToJsonString();
                gradeToUpdate.Date = DateTime.UtcNow.ToString("yyyy-MM-dd");
                
                await _blockchainService.UpdateGradeAsync(gradeToUpdate, invokerId);

                if (request.IsFlagged) {
                    try {
                        using var conn = new NpgsqlConnection(_connectionString);
                        await conn.OpenAsync();
                        using var cmdChair = new NpgsqlCommand("SELECT u.email FROM Users u JOIN AdminProfiles ap ON u.id = ap.user_id WHERE ap.department = @dept AND u.role IN ('department_admin', 'deptAdmin') AND u.status = 'APPROVED' LIMIT 1", conn);
                        cmdChair.Parameters.AddWithValue("dept", gradeToUpdate.Course ?? "");
                        var chairEmail = (await cmdChair.ExecuteScalarAsync()) as string;

                        if (!string.IsNullOrEmpty(chairEmail)) {
                            var subj = "PLV Grades Ledger: Grade Flagged for Review";
                            var msg = $"<div style='font-family: Arial, sans-serif; padding: 20px;'><h2 style='color: #003366;'>Pamantasan ng Lungsod ng Valenzuela</h2><p>Hello,</p><p>A grade for subject <strong>{gradeToUpdate.SubjectCode}</strong> has been flagged for review. Please check the Chairperson portal for more details.</p></div>";
                            await _emailService.SendEmailAsync(chairEmail, subj, msg, true);
                        }
                    } catch (Exception ex) { _logger.LogWarning(ex, "Failed to notify chairperson about flagged grade."); }
                }

                await NotifyAcademicDataChangedAsync(request.IsFlagged ? "grade_flagged" : "grade_unflagged", gradeToUpdate.Course, invokerId);
                return Ok(new { status = "Success", message = request.IsFlagged ? "Record flagged for Chairperson review." : "Flag removed." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost("return/{recordId}")]
        [Authorize(Roles = "department_admin,deptAdmin,registrar")]
        public async Task<IActionResult> ReturnGrade(string recordId, [FromBody] ReturnRequest request)
        {
            try
            {
                var invokerId = request.InvokerId ?? User.Identity?.Name ?? "Unknown";
                var note = (request.Note ?? string.Empty).Trim();
                var isRegistrar = User.IsInRole("registrar");
                var nextStatus = isRegistrar ? "RegistrarRejected" : "Returned";
                var oldStatusLabel = isRegistrar ? "Forwarded to Registrar" : "Forwarded";
                var newStatusLabel = isRegistrar ? "Registrar Rejected" : "Returned";
                var successMessage = isRegistrar
                    ? "Grade rejected by registrar with notes."
                    : "Grade returned to faculty with notes.";
                if (string.IsNullOrWhiteSpace(note))
                {
                    return BadRequest(new { status = "Error", message = "A return note is required." });
                }
                
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                
                using var cmd = new NpgsqlCommand("UPDATE pending_grade_records SET status = @status, note = @note, date = @dt WHERE id = @id RETURNING id", conn);
                cmd.Parameters.AddWithValue("status", nextStatus);
                cmd.Parameters.AddWithValue("note", note);
                cmd.Parameters.AddWithValue("dt", DateTime.UtcNow.ToString("o"));
                cmd.Parameters.AddWithValue("id", recordId);
                var res = await cmd.ExecuteScalarAsync();
                
                if (res != null)
                {
                    using var cmdLog = new NpgsqlCommand(@"
                    INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                        VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn);
                    cmdLog.Parameters.AddWithValue("rid", recordId);
                    cmdLog.Parameters.AddWithValue("old", oldStatusLabel);
                    cmdLog.Parameters.AddWithValue("new", newStatusLabel);
                    cmdLog.Parameters.AddWithValue("reason", note);
                    cmdLog.Parameters.AddWithValue("appr", invokerId);
                    await cmdLog.ExecuteNonQueryAsync();

                    await NotifyAcademicDataChangedAsync("grade_returned", null, invokerId);
                    return Ok(new { status = "Success", message = $"{successMessage} (Staged)." });
                }

                var gradeJson = await _blockchainService.GetGradeAsync(recordId, invokerId);
                var gradeToUpdate = System.Text.Json.JsonSerializer.Deserialize<AcademicRecord>(gradeJson);

                if (gradeToUpdate == null) return NotFound(new { status = "Error", message = "Grade not found" });

                // Update status and attach note
                gradeToUpdate.Status = nextStatus;
                gradeToUpdate.Date = DateTime.UtcNow.ToString("yyyy-MM-dd");
                
                // We use the 'Note' field in the blockchain record to store the revision instructions
                gradeToUpdate.Note = note;

                await _blockchainService.UpdateGradeAsync(gradeToUpdate, invokerId);

                // Log the return action in PostgreSQL
                using var cmdLogBlockchain = new NpgsqlCommand(@"
                    INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                    VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn);
                cmdLogBlockchain.Parameters.AddWithValue("rid", recordId);
                cmdLogBlockchain.Parameters.AddWithValue("old", oldStatusLabel);
                cmdLogBlockchain.Parameters.AddWithValue("new", newStatusLabel);
                cmdLogBlockchain.Parameters.AddWithValue("reason", note);
                cmdLogBlockchain.Parameters.AddWithValue("appr", invokerId);
                await cmdLogBlockchain.ExecuteNonQueryAsync();

                await NotifyAcademicDataChangedAsync("grade_returned", gradeToUpdate.Course, invokerId);
                return Ok(new { status = "Success", message = successMessage });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        public class ReturnRequest
        {
            public string? Note { get; set; }
            public string? InvokerId { get; set; }
        }

        [HttpPost("status/{recordId}")]
        public async Task<IActionResult> UpdateAcademicStatus(string recordId, [FromQuery] string invokerId, [FromBody] AcademicStatusRequest request)
        {
            if (string.IsNullOrEmpty(invokerId)) 
                return BadRequest(new { status = "Error", message = "invokerId query parameter is required." });

            try
            {
                if (await UpdatePendingGradeJsonAsync(recordId, obj => obj["remarks"] = request.Status))
                {
                    await NotifyAcademicDataChangedAsync("academic_status_updated", null, invokerId);
                    return Ok(new { status = "Success", message = $"Academic status updated to {request.Status} (Staged)." });
                }

                var jsonResult = await _blockchainService.GetGradeAsync(recordId, invokerId);
                var gradeToUpdate = JsonSerializer.Deserialize<AcademicRecord>(jsonResult, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (gradeToUpdate == null) 
                    return NotFound(new { status = "Error", message = "Record not found on blockchain." });

                System.Text.Json.Nodes.JsonObject gradeObj;
                if (!string.IsNullOrEmpty(gradeToUpdate.Grade) && gradeToUpdate.Grade.TrimStart().StartsWith("{"))
                {
                    try {
                        gradeObj = System.Text.Json.Nodes.JsonNode.Parse(gradeToUpdate.Grade)?.AsObject() ?? new System.Text.Json.Nodes.JsonObject();
                    } catch {
                        gradeObj = new System.Text.Json.Nodes.JsonObject();
                        gradeObj["finalAverage"] = gradeToUpdate.Grade;
                    }
                }
                else
                {
                    gradeObj = new System.Text.Json.Nodes.JsonObject();
                    gradeObj["finalAverage"] = gradeToUpdate.Grade ?? "";
                }

                gradeObj["remarks"] = request.Status;
                gradeToUpdate.Grade = gradeObj.ToJsonString();
                gradeToUpdate.Date = DateTime.UtcNow.ToString("yyyy-MM-dd");
                
                await _blockchainService.UpdateGradeAsync(gradeToUpdate, invokerId);

                await NotifyAcademicDataChangedAsync("academic_status_updated", gradeToUpdate.Course, invokerId);
                return Ok(new { status = "Success", message = $"Academic status updated to {request.Status}." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpGet("audit-all")]
        [Authorize(Roles = "registrar,admin")]
        public async Task<IActionResult> GetSystemAuditLogs()
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var logs = new List<object>();
                using var cmd = new NpgsqlCommand(@"
                    SELECT logid, recordid, oldgrade, newgrade, reasontext, approvedby, timestamp 
                    FROM gradecorrectionlogs 
                    ORDER BY timestamp DESC", conn);
                
                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    logs.Add(new {
                        id = reader.GetInt32(0),
                        recordId = reader.GetString(1),
                        oldGrade = reader.IsDBNull(2) ? null : reader.GetString(2),
                        newGrade = reader.IsDBNull(3) ? null : reader.GetString(3),
                        reason = reader.IsDBNull(4) ? null : reader.GetString(4),
                        approvedBy = reader.IsDBNull(5) ? null : reader.GetString(5),
                        timestamp = reader.GetDateTime(6)
                    });
                }

                return Ok(new { status = "Success", data = logs });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpGet("audit-logs/{recordId}")]
        public async Task<IActionResult> GetAuditLogs(string recordId)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var logs = new List<object>();
                using var cmd = new NpgsqlCommand(@"
                    SELECT logid, recordid, oldgrade, newgrade, reasontext, approvedby, timestamp 
                    FROM gradecorrectionlogs 
                    WHERE recordid = @rid 
                    ORDER BY timestamp DESC", conn);
                
                cmd.Parameters.AddWithValue("rid", recordId);

                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    logs.Add(new {
                        id = reader.GetInt32(0),
                        recordId = reader.GetString(1),
                        oldGrade = reader.IsDBNull(2) ? null : reader.GetString(2),
                        newGrade = reader.IsDBNull(3) ? null : reader.GetString(3),
                        reason = reader.IsDBNull(4) ? null : reader.GetString(4),
                        approvedBy = reader.IsDBNull(5) ? null : reader.GetString(5),
                        timestamp = reader.GetDateTime(6)
                    });
                }

                return Ok(new { status = "Success", data = logs });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost("upload-ipfs")]
        [Consumes("multipart/form-data")]
        public async Task<IActionResult> UploadToIpfs([FromForm] IFormFile file)
        {
            if (file == null || file.Length == 0) return BadRequest(new { status = "Error", message = "File is required." });

            try
            {
                using var client = _httpClientFactory.CreateClient();
                using var content = new MultipartFormDataContent();
                
                // Encrypt before upload
                byte[] encryptedData;
                using (var stream = file.OpenReadStream())
                {
                    encryptedData = EncryptStream(stream);
                }
                
                content.Add(new ByteArrayContent(encryptedData), "file", file.FileName + ".enc");
                
                var ipfsHost = Environment.GetEnvironmentVariable("IPFS_HOST") ?? "ipfs0";
                var ipfsUrl = _configuration["IpfsApiUrl"] ?? $"http://{ipfsHost}:5001/api/v0/add?cid-version=1&wrap-with-directory=false";
                var ipfsRes = await client.PostAsync(ipfsUrl, content);
                
                if (ipfsRes.IsSuccessStatusCode)
                {
                    var ipfsJson = await ipfsRes.Content.ReadAsStringAsync();
                    var cid = "";
                    
                    // Robust multi-line JSON parsing
                    var lines = ipfsJson.Split('\n', StringSplitOptions.RemoveEmptyEntries);
                    foreach (var line in lines)
                    {
                        try {
                            using var doc = JsonDocument.Parse(line);
                            if (doc.RootElement.TryGetProperty("Hash", out var hashProp)) {
                                cid = hashProp.GetString() ?? cid;
                            }
                        } catch { }
                    }

                    // Explicitly distribute pin to other nodes in the cluster
                    _ = Task.Run(() => DistributePinAsync(cid));

                    return Ok(new { status = "Success", cid = cid, url = $"/ipfs/{cid}", message = "File encrypted and securely distributed to IPFS." });
                }
                return StatusCode((int)ipfsRes.StatusCode, new { status = "Error", message = "IPFS daemon rejected the file." });
            }
            catch (Exception ex) { return StatusCode(500, new { status = "Error", message = $"IPFS service unreachable: {ex.Message}" }); }
        }

        [HttpGet("view-ipfs/{cid}")]
        public async Task<IActionResult> ViewIpfsFile(string cid)
        {
            // Resilient parameter detection
            var vaultPassword = Request.Query["vaultPassword"].ToString();
            if (string.IsNullOrEmpty(vaultPassword)) vaultPassword = Request.Query["password"].ToString();
            if (string.IsNullOrEmpty(vaultPassword)) vaultPassword = Request.Query["vault_password"].ToString();
            if (string.IsNullOrEmpty(vaultPassword)) vaultPassword = Request.Query["vaultpass"].ToString();

            if (string.IsNullOrEmpty(vaultPassword))
            {
                _logger.LogWarning("ViewIpfsFile: vaultPassword missing. CID: {CID}. Providing HTML Challenge.", cid);
                
                // Return a simple HTML prompt if accessed via browser/direct link without password
                var html = $@"
                <!DOCTYPE html>
                <html>
                <head>
                    <title>SPII Vault Access Control</title>
                    <style>
                        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f1f5f9; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
                        .card {{ background: white; padding: 2.5rem; border-radius: 2rem; shadow: 0 20px 25px -5px rgba(0,0,0,0.1); width: 100%; max-width: 450px; border: 1px solid #e2e8f0; text-align: center; }}
                        .badge {{ display: inline-block; padding: 0.25rem 0.75rem; background: #e0f2fe; color: #0369a1; border-radius: 9999px; font-size: 0.75rem; font-weight: bold; margin-bottom: 1rem; }}
                        h2 {{ color: #003366; margin: 0 0 0.5rem 0; font-size: 1.5rem; }}
                        p {{ color: #64748b; font-size: 0.9rem; margin-bottom: 2rem; line-height: 1.5; }}
                        .cid-box {{ background: #f8fafc; padding: 0.75rem; border-radius: 0.75rem; font-family: monospace; font-size: 0.7rem; color: #475569; margin-bottom: 2rem; border: 1px dashed #cbd5e1; word-break: break-all; }}
                        input {{ width: 100%; padding: 1rem; margin-bottom: 1.25rem; border: 2px solid #e2e8f0; border-radius: 1rem; box-sizing: border-box; outline: none; font-size: 1rem; transition: border-color 0.2s; }}
                        input:focus {{ border-color: #003366; }}
                        button {{ width: 100%; padding: 1rem; background: #003366; color: white; border: none; border-radius: 1rem; font-weight: bold; cursor: pointer; transition: transform 0.1s, background 0.2s; font-size: 1rem; }}
                        button:hover {{ background: #00264d; }}
                        button:active {{ transform: scale(0.98); }}
                        .links {{ margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #f1f5f9; }}
                        .links a {{ color: #64748b; font-size: 0.8rem; text-decoration: none; }}
                        .links a:hover {{ text-decoration: underline; color: #003366; }}
                    </style>
                </head>
                <body>
                    <div class='card'>
                        <div class='badge'>DISTRIBUTED VAULT</div>
                        <h2>Private Record Access</h2>
                        <p>This academic record is encrypted and distributed across the PLV IPFS Network. Enter the Vault Password to view the decrypted content.</p>
                        
                        <div class='cid-box'>CID: {cid}</div>

                        <form onsubmit='handleSubmit(event)'>
                            <input type='password' id='pass' placeholder='Enter Vault Password' required autofocus />
                            <button type='submit'>Decrypt & View in Browser</button>
                        </form>

                        <div class='links'>
                            <a href='/ipfs/{cid}' target='_blank'>View Raw Encrypted Block (via IPFS Gateway)</a>
                        </div>
                    </div>
                    <script>
                        function handleSubmit(e) {{
                            e.preventDefault();
                            const pass = document.getElementById('pass').value;
                            const url = new URL(window.location.href);
                            url.searchParams.set('vaultPassword', pass);
                            window.location.href = url.toString();
                        }}
                    </script>
                </body>
                </html>";
                return Content(html, "text/html");
            }

            // Verify vault password against internal secret (simple check for this prototype)
            var expectedPassword = _configuration["VaultPassword"] ?? "PLV-Vault-2026";
            if (vaultPassword != expectedPassword)
            {
                return BadRequest(new { status = "Error", message = "Invalid Vault Password. Access Denied." });
            }

            try
            {
                var ipfsHost = Environment.GetEnvironmentVariable("IPFS_HOST") ?? "ipfs0";
                var ipfsUrl = $"http://{ipfsHost}:8080/ipfs/{cid}";

                using var client = _httpClientFactory.CreateClient();
                var response = await client.GetAsync(ipfsUrl);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning("IPFS Gateway returned {StatusCode} for CID {CID}", response.StatusCode, cid);
                    return NotFound(new { status = "Error", message = "File not found on IPFS Gateway." });
                }

                var encryptedData = await response.Content.ReadAsByteArrayAsync();
                
                // Check if the content is HTML (likely a Directory listing from IPFS)
                var contentStr = System.Text.Encoding.UTF8.GetString(encryptedData.Take(100).ToArray());
                if (contentStr.Contains("<!DOCTYPE html>") || contentStr.Contains("<html"))
                {
                    return BadRequest(new { status = "Error", message = "This record was uploaded in an older format (Directory CID) and cannot be decrypted directly." });
                }

                if (encryptedData.Length < 16)
                {
                    return BadRequest(new { status = "Error", message = "Invalid encrypted data format." });
                }

                // Extract IV from the first 16 bytes
                byte[] iv = new byte[16];
                Array.Copy(encryptedData, 0, iv, 0, 16);
                byte[] ciphertext = new byte[encryptedData.Length - 16];
                Array.Copy(encryptedData, 16, ciphertext, 0, ciphertext.Length);

                var key = _configuration["IpfsEncryptionKey"] ?? "default-encryption-key-32chars!!!";
                var keyBytes = System.Text.Encoding.UTF8.GetBytes(key.PadRight(32).Substring(0, 32));

                using var aes = Aes.Create();
                aes.Key = keyBytes;
                aes.IV = iv;

                using var msInput = new MemoryStream(ciphertext);
                using var msOutput = new MemoryStream();
                try 
                {
                    using (var decryptor = aes.CreateDecryptor())
                    using (var cryptoStream = new CryptoStream(msInput, decryptor, CryptoStreamMode.Read))
                    {
                        await cryptoStream.CopyToAsync(msOutput);
                    }
                }
                catch (CryptographicException)
                {
                    return BadRequest(new { status = "Error", message = "Decryption failed. Invalid key or corrupted data." });
                }

                var decryptedData = msOutput.ToArray();
                
                // Content detection for the Cloud Viewer
                var buffer = new byte[4];
                if (decryptedData.Length >= 4) Array.Copy(decryptedData, 0, buffer, 0, 4);
                bool isPdf = (buffer[0] == 0x25 && buffer[1] == 0x50 && buffer[2] == 0x44 && buffer[3] == 0x46);
                bool isZipContainer = decryptedData.Length >= 2 && decryptedData[0] == 0x50 && decryptedData[1] == 0x4B;
                bool isExcelWorkbook = false;
                string? workbookPreviewHtml = null;
                string? workbookDownloadUrl = null;

                if (isZipContainer)
                {
                    try
                    {
                        using var workbookStream = new MemoryStream(decryptedData);
                        using var workbook = new XLWorkbook(workbookStream);
                        var worksheet = workbook.Worksheets.FirstOrDefault();
                        if (worksheet != null)
                        {
                            isExcelWorkbook = true;
                            var usedRange = worksheet.RangeUsed();
                            var workbookFileName = $"Decrypted_Record_{cid}.xlsx";
                            workbookDownloadUrl =
                                "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," +
                                Convert.ToBase64String(decryptedData);

                            if (usedRange != null)
                            {
                                var previewBuilder = new StringBuilder();
                                previewBuilder.Append("<div style='padding: 1rem 1.5rem; border-bottom: 1px solid #e2e8f0; background: #f8fafc;'>");
                                previewBuilder.Append($"<div style='font-weight: 700; color: #0f172a;'>Workbook Preview: {System.Net.WebUtility.HtmlEncode(worksheet.Name)}</div>");
                                previewBuilder.Append("<div style='font-size: 0.8rem; color: #64748b; margin-top: 0.25rem;'>Showing the first worksheet from the decrypted Excel grading sheet.</div>");
                                previewBuilder.Append($"<div style='margin-top: 0.75rem;'><a href='{workbookDownloadUrl}' download='{System.Net.WebUtility.HtmlEncode(workbookFileName)}' class='btn btn-primary'>Download Excel File</a></div>");
                                previewBuilder.Append("</div>");
                                previewBuilder.Append("<table><tbody>");

                                foreach (var row in usedRange.Rows())
                                {
                                    previewBuilder.Append("<tr>");
                                    foreach (var cell in row.Cells(usedRange.FirstColumn().ColumnNumber(), usedRange.LastColumn().ColumnNumber()))
                                    {
                                        var cellValue = "";
                                        try
                                        {
                                            cellValue = cell.HasFormula
                                                ? cell.CachedValue.ToString()
                                                : cell.GetFormattedString();
                                        }
                                        catch
                                        {
                                            cellValue = cell.Value.ToString();
                                        }

                                        var cellTag = row.RowNumber() == usedRange.FirstRow().RowNumber() ? "th" : "td";
                                        previewBuilder.Append($"<{cellTag}>{System.Net.WebUtility.HtmlEncode(cellValue)}</{cellTag}>");
                                    }
                                    previewBuilder.Append("</tr>");
                                }

                                previewBuilder.Append("</tbody></table>");
                                workbookPreviewHtml = previewBuilder.ToString();
                            }
                        }
                    }
                    catch
                    {
                        isExcelWorkbook = false;
                    }
                }

                var textContent = isExcelWorkbook ? string.Empty : System.Text.Encoding.UTF8.GetString(decryptedData);
                
                // --- CLOUD VIEWER HTML ---
                var viewerHtml = $@"
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Cloud Viewer - {cid}</title>
                    <style>
                        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 2rem; color: #1e293b; }}
                        .container {{ max-width: 1200px; margin: 0 auto; background: white; border-radius: 1.5rem; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; overflow: hidden; display: flex; flex-direction: column; height: 85vh; }}
                        .header {{ background: #003366; color: white; padding: 1.25rem 2rem; display: flex; justify-content: space-between; align-items: center; }}
                        .header h1 {{ margin: 0; font-size: 1.1rem; font-weight: 800; letter-spacing: -0.025em; }}
                        .header .meta {{ font-size: 0.7rem; opacity: 0.8; font-family: monospace; }}
                        .content {{ flex: 1; overflow: auto; padding: 0; background: #fff; position: relative; }}
                        
                        /* Table Styling for CSVs */
                        table {{ width: 100%; border-collapse: collapse; font-size: 0.85rem; border: none; }}
                        th {{ text-align: left; background: #f8fafc; padding: 0.75rem 1rem; font-weight: 700; color: #475569; border-bottom: 2px solid #e2e8f0; position: sticky; top: 0; z-index: 10; }}
                        td {{ padding: 0.75rem 1rem; border-bottom: 1px solid #f1f5f9; color: #334155; }}
                        tr:hover {{ background: #f1f5f9; }}

                        /* PDF Embed */
                        embed {{ width: 100%; height: 100%; border: none; position: absolute; top: 0; left: 0; }}

                        .btn {{ padding: 0.5rem 1rem; border-radius: 0.5rem; font-weight: bold; text-decoration: none; font-size: 0.75rem; transition: all 0.2s; cursor: pointer; border: none; }}
                        .btn-white {{ background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2); }}
                        .btn-white:hover {{ background: rgba(255,255,255,0.2); }}
                        .btn-primary {{ background: #003366; color: white; border: 1px solid #003366; display: inline-flex; align-items: center; }}
                        .btn-primary:hover {{ background: #00264d; border-color: #00264d; }}
                    </style>
                </head>
                <body>
                    <div class='container'>
                        <div class='header'>
                            <div>
                                <h1>PLV Vault: Decrypted Record Viewer</h1>
                                <div class='meta'>ID: {cid}</div>
                            </div>
                            <button onclick='window.close()' class='btn btn-white'>Close Cloud Viewer</button>
                        </div>
                        <div class='content'>";

                if (isPdf)
                {
                    var base64Pdf = Convert.ToBase64String(decryptedData);
                    viewerHtml += $@"<embed src='data:application/pdf;base64,{base64Pdf}' type='application/pdf' />";
                }
                else if (isExcelWorkbook)
                {
                    viewerHtml += workbookPreviewHtml ?? "<div style='padding: 2rem; color: #475569;'>The decrypted Excel workbook was detected, but no preview data was available.</div>";
                }
                else if (textContent.Contains(",") || textContent.Contains("\t"))
                {
                    viewerHtml += "<table><thead><tr>";
                    var separator = textContent.Contains("\t") ? '\t' : ',';
                    var lines = textContent.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.RemoveEmptyEntries);
                    if (lines.Length > 0)
                    {
                        var headers = lines[0].Split(separator);
                        foreach (var h in headers) viewerHtml += $"<th>{System.Net.WebUtility.HtmlEncode(h)}</th>";
                        viewerHtml += "</tr></thead><tbody>";
                        var attendanceColumnIndexes = headers
                            .Select((header, index) => new { Header = header, Index = index })
                            .Where(item => item.Header.Contains("attendance", StringComparison.OrdinalIgnoreCase))
                            .Select(item => item.Index)
                            .ToHashSet();
                        
                        for (int i = 1; i < lines.Length; i++)
                        {
                            viewerHtml += "<tr>";
                            var cells = lines[i].Split(separator);
                            for (int cellIndex = 0; cellIndex < headers.Length; cellIndex++)
                            {
                                var cellValue = cellIndex < cells.Length ? cells[cellIndex] : "";
                                if (attendanceColumnIndexes.Contains(cellIndex) && string.IsNullOrWhiteSpace(cellValue))
                                {
                                    cellValue = "not applicable";
                                }
                                viewerHtml += $"<td>{System.Net.WebUtility.HtmlEncode(cellValue)}</td>";
                            }
                            viewerHtml += "</tr>";
                        }
                    }
                    viewerHtml += "</tbody></table>";
                }
                else
                {
                    viewerHtml += $"<pre style='padding: 2rem; margin: 0; white-space: pre-wrap; font-family: monospace;'>{System.Net.WebUtility.HtmlEncode(textContent)}</pre>";
                }

                viewerHtml += @"
                        </div>
                    </div>
                </body>
                </html>";

                return Content(viewerHtml, "text/html");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving or decrypting IPFS file");
                return StatusCode(500, new { status = "Error", message = $"Decryption failed: {ex.Message}" });
            }
        }

        private async Task DistributePinAsync(string cid)
        {
            if (string.IsNullOrEmpty(cid)) return;

            // List of IPFS nodes in the distributed network
            var nodes = new[] { "ipfs0", "ipfs1", "ipfs2", "ipfs3", "ipfs4", "ipfs5" };
            
            var pinTasks = nodes.Select(async node =>
            {
                try
                {
                    using var client = _httpClientFactory.CreateClient();
                    client.Timeout = TimeSpan.FromSeconds(10); // Slightly longer timeout per node
                    
                    var pinUrl = $"http://{node}:5001/api/v0/pin/add?arg={cid}";
                    var response = await client.PostAsync(pinUrl, null);
                    if (response.IsSuccessStatusCode)
                    {
                        _logger.LogInformation("Successfully distributed/pinned CID {CID} to node {Node}", cid, node);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning("Failed to distribute pin to {Node}: {Message}", node, ex.Message);
                }
            });

            await Task.WhenAll(pinTasks);
        }
    }
}
