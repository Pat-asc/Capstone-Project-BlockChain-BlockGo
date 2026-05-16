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
                                status = 'Issued'
                            WHERE student_hash = @sh
                              AND subject_code = @subj
                              AND school_year = @sy
                              AND semester = @sem
                              AND section = @sec
                            RETURNING id
                        )
                        INSERT INTO pending_grade_records (id, student_hash, student_no, student_name, section, course, subject_code, grade, semester, school_year, faculty_id, date, ipfs_cid, status)
                        SELECT @id, @sh, @studentNo, @studentName, @sec, @course, @subj, @gr, @sem, @sy, @fac, @dt, @ipfs, 'Issued'
                        WHERE NOT EXISTS (SELECT 1 FROM updated)
                        ON CONFLICT (id) DO UPDATE SET
                            student_no = EXCLUDED.student_no,
                            student_name = EXCLUDED.student_name,
                            grade = EXCLUDED.grade,
                            status = 'Issued',
                            date = EXCLUDED.date;", conn, transaction);
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
                    SET status = 'Issued',
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
                        LOWER(TRIM(COALESCE(section, ''))) = LOWER(TRIM(@section))
                        OR (@compactSection <> '' AND LOWER(TRIM(COALESCE(section, ''))) = LOWER(TRIM(@compactSection)))
                        OR LOWER(TRIM(COALESCE(subject_code, ''))) = LOWER(TRIM(@section))
                        OR (@subjectCode <> '' AND LOWER(TRIM(COALESCE(subject_code, ''))) = LOWER(TRIM(@subjectCode)))
                        OR LOWER(TRIM(COALESCE(course, ''))) = LOWER(TRIM(@section))
                        OR (COALESCE(section, '') <> '' AND @section ILIKE '%' || section || '%')
                        OR (COALESCE(section, '') <> '' AND section ILIKE '%' || @section || '%')
                        OR (@compactSection <> '' AND COALESCE(section, '') <> '' AND section ILIKE '%' || @compactSection || '%')
                        OR (COALESCE(subject_code, '') <> '' AND @section ILIKE '%' || subject_code || '%')
                      )", conn);
                cmd.Parameters.AddWithValue("faculty", effectiveFacultyId);
                cmd.Parameters.AddWithValue("section", section);
                cmd.Parameters.AddWithValue("compactSection", compactSection);
                cmd.Parameters.AddWithValue("subjectCode", subjectCodeFromLabel);
                cmd.Parameters.AddWithValue("date", DateTime.UtcNow.ToString("yyyy-MM-dd"));

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

        private static string BuildUploadedGradePayload(string? rawGrade, string? rawMidterm, string? rawFinals, string? term)
        {
            if (string.IsNullOrWhiteSpace(rawGrade) && string.IsNullOrWhiteSpace(rawMidterm) && string.IsNullOrWhiteSpace(rawFinals)) return "";
            if (!string.IsNullOrWhiteSpace(rawGrade) && rawGrade.TrimStart().StartsWith("{")) return rawGrade;

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
                finalAverage = ToUniversityGrade(rawAverage).ToString("0.00")
            });
        }

        private static string? GetUploadedTermGrade(Func<string, string?> getter, string? term)
        {
            var activeTerm = string.Equals(term, "finals", StringComparison.OrdinalIgnoreCase) ? "finals" : "midterm";
            return activeTerm == "finals"
                ? getter("final_grade") ?? getter("finals_grade")
                : getter("midterm_grade");
        }

        private static string? GetUploadedMidtermGrade(Func<string, string?> getter)
        {
            return getter("midterm_grade");
        }

        private static string? GetUploadedFinalGrade(Func<string, string?> getter)
        {
            return getter("final_grade") ?? getter("finals_grade");
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
                var successCount = 0;
                var failureCount = 0;
                var errors = new List<BulkUploadError>();
                var parsedRecords = new List<GradeRequest>();

                var ext = Path.GetExtension(file.FileName).ToLower();
                if (ext != ".csv" && ext != ".xlsx")
                    return BadRequest(new { status = "Error", message = "Only .csv and .xlsx files are supported." });

                var tempFile = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ext);
                string ipfsCid = "";
                
                try
                {
                    using (var fileStream = new FileStream(tempFile, FileMode.Create))
                        await file.CopyToAsync(fileStream);

                    // Distribute Encrypted File to IPFS Network
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
                            _logger.LogInformation("Encrypted file distributed to IPFS. CID: {CID}", ipfsCid);
                            
                            // Explicitly distribute pin to other nodes in the cluster (fire-and-forget)
                            _ = Task.Run(() => DistributePinAsync(ipfsCid));
                        }
                    }
                    catch (Exception ex) { _logger.LogWarning("IPFS upload skipped (daemon may be offline): {Message}", ex.Message); }

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
                            var colName = cell.Value.ToString().Trim().ToLower().Replace(" ", "_");
                            if (!string.IsNullOrEmpty(colName)) headerMap[colName] = cell.Address.ColumnNumber;
                        }

                        var rows = ws.RowsUsed().Skip(1);
                        foreach (var row in rows)
                        {
                            var getVal = (string col) => headerMap.ContainsKey(col) ? row.Cell(headerMap[col]).Value.ToString().Trim() : null;
                            var sId = getVal("student_id") ?? getVal("student_no");
                            if (string.IsNullOrEmpty(sId)) continue;

                            parsedRecords.Add(new GradeRequest
                            {
                                StudentId = sId ?? "",
                                StudentName = getVal("student_name") ?? getVal("student") ?? "",
                                Section = !string.IsNullOrWhiteSpace(section) ? section : (getVal("section") ?? getVal("class_section") ?? ""),
                                Grade = BuildUploadedGradePayload(
                                    GetUploadedTermGrade(getVal, term),
                                    GetUploadedMidtermGrade(getVal),
                                    GetUploadedFinalGrade(getVal),
                                    term),
                                SubjectCode = getVal("subject_code") ?? course ?? "Unknown",
                                SubjectName = getVal("subject_name") ?? getVal("course") ?? course ?? "Unknown",
                                Course = getVal("course") ?? course ?? "Unknown",
                                Semester = !string.IsNullOrEmpty(semester) ? semester : (getVal("semester") ?? "Unknown"),
                                SchoolYear = !string.IsNullOrEmpty(schoolYear) ? schoolYear : (getVal("school_year") ?? "Unknown"),
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
                                        headerMap[fields[i].Trim().ToLower().Replace(" ", "_")] = i;
                                    continue;
                                }

                                var sId = GetCsvField(fields, headerMap, "student_id") ?? GetCsvField(fields, headerMap, "student_no");
                                if (string.IsNullOrEmpty(sId)) continue;

                                parsedRecords.Add(new GradeRequest
                                {
                                    StudentId = sId ?? "",
                                    StudentName = GetCsvField(fields, headerMap, "student_name") ?? GetCsvField(fields, headerMap, "student") ?? "",
                                    Section = !string.IsNullOrWhiteSpace(section) ? section : (GetCsvField(fields, headerMap, "section") ?? GetCsvField(fields, headerMap, "class_section") ?? ""),
                                    Grade = BuildUploadedGradePayload(
                                        GetUploadedTermGrade((key) => GetCsvField(fields, headerMap, key), term),
                                        GetUploadedMidtermGrade((key) => GetCsvField(fields, headerMap, key)),
                                        GetUploadedFinalGrade((key) => GetCsvField(fields, headerMap, key)),
                                        term),
                                    SubjectCode = GetCsvField(fields, headerMap, "subject_code") ?? course ?? "Unknown",
                                    SubjectName = GetCsvField(fields, headerMap, "subject_name") ?? GetCsvField(fields, headerMap, "course") ?? course ?? "Unknown",
                                    Course = GetCsvField(fields, headerMap, "course") ?? course ?? "Unknown",
                                    Semester = !string.IsNullOrEmpty(semester) ? semester : (GetCsvField(fields, headerMap, "semester") ?? "Unknown"),
                                    SchoolYear = !string.IsNullOrEmpty(schoolYear) ? schoolYear : (GetCsvField(fields, headerMap, "school_year") ?? "Unknown"),
                                    Date = DateTime.Now.ToString("yyyy-MM-dd")
                                });
                            }
                        }
                    }

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
                                    VALUES (@id, @sh, @studentNo, @studentName, @sec, @course, @subj, @gr, @sem, @sy, @fac, @dt, @ipfs, 'Issued')
                                    ON CONFLICT ON CONSTRAINT unique_grade_entry_section DO UPDATE SET
                                        student_no = EXCLUDED.student_no,
                                        student_name = EXCLUDED.student_name,
                                        section = EXCLUDED.section,
                                        course = EXCLUDED.course,
                                        grade = EXCLUDED.grade,
                                        faculty_id = EXCLUDED.faculty_id,
                                        date = EXCLUDED.date,
                                        ipfs_cid = EXCLUDED.ipfs_cid,
                                        status = 'Issued';", conn, transaction);
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
                        .ThenByDescending(record => string.Equals(record.Status, "Issued", StringComparison.OrdinalIgnoreCase))
                        .First())
                    .ToList();

                var enrichedGrades = new List<Dictionary<string, object>>();
                
                using var cmdProfiles = new NpgsqlCommand("SELECT u.email, sp.department, sp.section, sp.student_no, sp.full_name FROM Users u JOIN StudentProfiles sp ON u.id = sp.user_id", conn);
                var studentProfiles = new Dictionary<string, (string dept, string sec, string studentNo, string fullName)>();
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

                    if (!isAuthorizedViewer && g.FacultyId != invokerId && g.StudentHash != invokerId)
                    {
                        safeStudentHash = "[REDACTED]";
                        safeFacultyId = "[REDACTED]";
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

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var cmd = new NpgsqlCommand("SELECT id, student_hash, section, course, subject_code, grade, semester, school_year, faculty_id, date, ipfs_cid, status, note FROM pending_grade_records WHERE id = @id", conn);
                cmd.Parameters.AddWithValue("id", recordId);
                
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    if (await reader.ReadAsync())
                    {
                        var localGrade = new AcademicRecord {
                            Id = reader.IsDBNull(0) ? "" : reader.GetString(0),
                            StudentHash = reader.IsDBNull(1) ? "" : reader.GetString(1),
                            Section = reader.IsDBNull(2) ? "" : reader.GetString(2),
                            Course = reader.IsDBNull(3) ? "" : reader.GetString(3),
                            SubjectCode = reader.IsDBNull(4) ? "" : reader.GetString(4),
                            Grade = reader.IsDBNull(5) ? "" : reader.GetString(5),
                            Semester = reader.IsDBNull(6) ? "" : reader.GetString(6),
                            SchoolYear = reader.IsDBNull(7) ? "" : reader.GetString(7),
                            FacultyId = reader.IsDBNull(8) ? "" : reader.GetString(8),
                            Date = reader.IsDBNull(9) ? "" : reader.GetString(9),
                            IpfsCid = reader.IsDBNull(10) ? "" : reader.GetString(10),
                            Status = reader.IsDBNull(11) ? "" : reader.GetString(11),
                            Note = reader.IsDBNull(12) ? "" : reader.GetString(12),
                            University = "PLV",
                            Version = 1
                        };
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
            
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                
                using var cmd = new NpgsqlCommand("SELECT id, student_hash, section, course, subject_code, grade, semester, school_year, faculty_id, date, ipfs_cid, note FROM pending_grade_records WHERE id = @id", conn);
                cmd.Parameters.AddWithValue("id", recordId);
                
                AcademicRecord? pendingRecord = null;
                using (var reader = await cmd.ExecuteReaderAsync())
                {
                    if (await reader.ReadAsync())
                    {
                        pendingRecord = new AcademicRecord {
                            Id = reader.IsDBNull(0) ? "" : reader.GetString(0),
                            StudentHash = reader.IsDBNull(1) ? "" : reader.GetString(1),
                            Section = reader.IsDBNull(2) ? "" : reader.GetString(2),
                            Course = reader.IsDBNull(3) ? "" : reader.GetString(3),
                            SubjectCode = reader.IsDBNull(4) ? "" : reader.GetString(4),
                            Grade = reader.IsDBNull(5) ? "" : reader.GetString(5),
                            Semester = reader.IsDBNull(6) ? "" : reader.GetString(6),
                            SchoolYear = reader.IsDBNull(7) ? "" : reader.GetString(7),
                            FacultyId = reader.IsDBNull(8) ? "" : reader.GetString(8),
                            Date = reader.IsDBNull(9) ? "" : reader.GetString(9),
                            IpfsCid = reader.IsDBNull(10) ? "" : reader.GetString(10),
                            Note = reader.IsDBNull(11) ? "" : reader.GetString(11),
                            Status = "Finalized",
                            University = "PLV",
                            Version = 1
                        };
                    }
                }

                if (pendingRecord != null)
                {
                    var facId = string.IsNullOrEmpty(pendingRecord.FacultyId) ? invokerId : pendingRecord.FacultyId;
                    await _blockchainService.SubmitGradeAsync(pendingRecord, facId);
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
                
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                
                using var cmd = new NpgsqlCommand("UPDATE pending_grade_records SET status = 'Returned', note = @note, date = @dt WHERE id = @id RETURNING id", conn);
                cmd.Parameters.AddWithValue("note", request.Note ?? "");
                cmd.Parameters.AddWithValue("dt", DateTime.UtcNow.ToString("yyyy-MM-dd"));
                cmd.Parameters.AddWithValue("id", recordId);
                var res = await cmd.ExecuteScalarAsync();
                
                if (res != null)
                {
                    using var cmdLog = new NpgsqlCommand(@"
                        INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                        VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn);
                    cmdLog.Parameters.AddWithValue("rid", recordId);
                    cmdLog.Parameters.AddWithValue("old", "Forwarded");
                    cmdLog.Parameters.AddWithValue("new", "Returned");
                    cmdLog.Parameters.AddWithValue("reason", request.Note ?? "Returned for revision");
                    cmdLog.Parameters.AddWithValue("appr", invokerId);
                    await cmdLog.ExecuteNonQueryAsync();

                    await NotifyAcademicDataChangedAsync("grade_returned", null, invokerId);
                    return Ok(new { status = "Success", message = "Grade returned to faculty with notes (Staged)." });
                }

                var gradeJson = await _blockchainService.GetGradeAsync(recordId, invokerId);
                var gradeToUpdate = System.Text.Json.JsonSerializer.Deserialize<AcademicRecord>(gradeJson);

                if (gradeToUpdate == null) return NotFound(new { status = "Error", message = "Grade not found" });

                // Update status and attach note
                gradeToUpdate.Status = "Returned";
                gradeToUpdate.Date = DateTime.UtcNow.ToString("yyyy-MM-dd");
                
                // We use the 'Note' field in the blockchain record to store the revision instructions
                gradeToUpdate.Note = request.Note;

                await _blockchainService.UpdateGradeAsync(gradeToUpdate, invokerId);

                // Log the return action in PostgreSQL
                using var cmdLogBlockchain = new NpgsqlCommand(@"
                    INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                    VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn);
                cmdLogBlockchain.Parameters.AddWithValue("rid", recordId);
                cmdLogBlockchain.Parameters.AddWithValue("old", "Forwarded");
                cmdLogBlockchain.Parameters.AddWithValue("new", "Returned");
                cmdLogBlockchain.Parameters.AddWithValue("reason", request.Note ?? "Returned for revision");
                cmdLogBlockchain.Parameters.AddWithValue("appr", invokerId);
                await cmdLogBlockchain.ExecuteNonQueryAsync();

                await NotifyAcademicDataChangedAsync("grade_returned", gradeToUpdate.Course, invokerId);
                return Ok(new { status = "Success", message = "Grade returned to faculty with notes." });
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
                
                var textContent = System.Text.Encoding.UTF8.GetString(decryptedData);
                
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
                        
                        for (int i = 1; i < lines.Length; i++)
                        {
                            viewerHtml += "<tr>";
                            var cells = lines[i].Split(separator);
                            foreach (var c in cells) viewerHtml += $"<td>{System.Net.WebUtility.HtmlEncode(c)}</td>";
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
