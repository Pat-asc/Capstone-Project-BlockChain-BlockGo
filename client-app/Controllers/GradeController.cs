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

namespace BlockGo.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class GradesController : ControllerBase
    {
        private readonly IBlockchainService _blockchainService;
        private readonly string _connectionString;
        private readonly ILogger<GradesController> _logger;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;

        public GradesController(
            IBlockchainService blockchainService, 
            IConfiguration configuration,
            ILogger<GradesController> logger,
            IHttpClientFactory httpClientFactory)
        {
            _blockchainService = blockchainService;
            _connectionString = configuration.GetConnectionString("PostgresConnection") ?? configuration.GetConnectionString("MasterConnection") ?? throw new InvalidOperationException("PostgreSQL connection string not found.");
            _logger = logger;
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
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

                using var cmdFac = new NpgsqlCommand(@"
                    SELECT department FROM (
                        SELECT fp.department FROM Users u JOIN FacultyProfiles fp ON u.id = fp.user_id WHERE u.email = @email AND u.status = 'APPROVED'
                        UNION 
                        SELECT ap.department FROM Users u JOIN AdminProfiles ap ON u.id = ap.user_id WHERE u.email = @email AND u.status = 'APPROVED'
                    ) AS combined LIMIT 1", conn);
                cmdFac.Parameters.AddWithValue("email", request.FacultyId);
                var facDept = await cmdFac.ExecuteScalarAsync() as string;
                if (facDept == null)
                    return Unauthorized(new { status = "Error", message = "Faculty not approved or does not exist." });

                using var cmdStu = new NpgsqlCommand("SELECT sp.department FROM Users u JOIN StudentProfiles sp ON u.id = sp.user_id WHERE u.email = @email AND u.role = 'student'", conn);
                cmdStu.Parameters.AddWithValue("email", request.StudentHash);
                var stuDept = await cmdStu.ExecuteScalarAsync() as string;
                if (stuDept == null)
                    return NotFound(new { status = "Error", message = "Student not found in registration logs." });

                if (!string.IsNullOrEmpty(stuDept) && stuDept != facDept)
                    return StatusCode(403, new { status = "Error", message = $"Access Denied: Cannot grade students outside the {facDept} department." });

                using var transaction = await conn.BeginTransactionAsync();
                try
                {
                    var blockchainRecord = request.ToBlockchainRecord("PLV");
                    var result = await _blockchainService.SubmitGradeAsync(blockchainRecord, request.FacultyId);

                    using var cmdLog = new NpgsqlCommand(@"
                        INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                        VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn, transaction);
                    cmdLog.Parameters.AddWithValue("rid", blockchainRecord.Id);
                    cmdLog.Parameters.AddWithValue("old", DBNull.Value);
                    cmdLog.Parameters.AddWithValue("new", request.Grade ?? "");
                    cmdLog.Parameters.AddWithValue("reason", "Initial Grade Entry");
                    cmdLog.Parameters.AddWithValue("appr", request.FacultyId);
                    await cmdLog.ExecuteNonQueryAsync();

                    await transaction.CommitAsync();

                    return Ok(new { status = "Success", message = "Grade secured on Ledger and Logged in Postgres!" });
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

        [HttpPost("bulk-upload")]
        [Consumes("multipart/form-data")]
        public async Task<IActionResult> BulkUploadGrades([FromForm] IFormFile file, [FromForm] string? semester, [FromForm] string? schoolYear)
        {
            _logger.LogInformation("Bulk upload initiated");

            if (file == null || file.Length == 0)
                return BadRequest(new { status = "Error", message = "A .csv or .xlsx file is required." });

            var facultyId = Request.Headers["x-user-identity"].ToString(); // Note: AuthController can also decode this from JWT
            if (string.IsNullOrEmpty(facultyId))
                return BadRequest(new { status = "Error", message = "Faculty identity required." });

            _logger.LogInformation("CSV upload for faculty: {FacultyId}", facultyId);

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

                    // Distribute Original File to IPFS Network
                    try
                    {
                        using var client = _httpClientFactory.CreateClient();
                        using var content = new MultipartFormDataContent();
                        using var fsIpfs = new FileStream(tempFile, FileMode.Open, FileAccess.Read);
                        content.Add(new StreamContent(fsIpfs), "file", file.FileName);
                        
                        var ipfsHost = Environment.GetEnvironmentVariable("IPFS_HOST") ?? "ipfs0";
                        var ipfsUrl = _configuration["IpfsApiUrl"] ?? $"http://{ipfsHost}:5001/api/v0/add";
                        var ipfsRes = await client.PostAsync(ipfsUrl, content);
                        if (ipfsRes.IsSuccessStatusCode)
                        {
                            var ipfsJson = await ipfsRes.Content.ReadAsStringAsync();
                            using var doc = JsonDocument.Parse(ipfsJson);
                            ipfsCid = doc.RootElement.GetProperty("Hash").GetString() ?? "";
                            _logger.LogInformation("File distributed to IPFS. CID: {CID}", ipfsCid);
                        }
                    }
                    catch (Exception ex) { _logger.LogWarning("IPFS upload skipped (daemon may be offline): {Message}", ex.Message); }

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
                            var getVal = (string col) => headerMap.ContainsKey(col) ? row.Cell(headerMap[col]).Value.ToString().Trim() : null;
                            var sId = getVal("student_id") ?? getVal("student_no");
                            if (string.IsNullOrEmpty(sId)) continue;

                            parsedRecords.Add(new GradeRequest
                            {
                                StudentId = sId,
                                Grade = getVal("grade") ?? getVal("final_grade") ?? "",
                                Course = getVal("course") ?? "Unknown",
                                Semester = !string.IsNullOrEmpty(semester) ? semester : (getVal("semester") ?? "Unknown"),
                                SchoolYear = !string.IsNullOrEmpty(schoolYear) ? schoolYear : (getVal("school_year") ?? "Unknown")
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

                                var fields = line.Split(',');
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
                                    StudentId = sId,
                                    Grade = GetCsvField(fields, headerMap, "grade") ?? GetCsvField(fields, headerMap, "final_grade") ?? "",
                                    Course = GetCsvField(fields, headerMap, "course") ?? "Unknown",
                                    Semester = !string.IsNullOrEmpty(semester) ? semester : (GetCsvField(fields, headerMap, "semester") ?? "Unknown"),
                                    SchoolYear = !string.IsNullOrEmpty(schoolYear) ? schoolYear : (GetCsvField(fields, headerMap, "school_year") ?? "Unknown")
                                });
                            }
                        }
                    }

                    // Process all extracted records uniformly
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

                            using var conn = new NpgsqlConnection(_connectionString);
                            await conn.OpenAsync();

                            using var cmdStu = new NpgsqlCommand("SELECT sp.department, u.email FROM Users u JOIN StudentProfiles sp ON u.id = sp.user_id WHERE (sp.student_no = @sid OR u.email = @sid) AND u.role = 'student'", conn);
                            cmdStu.Parameters.AddWithValue("sid", record.StudentId);
                            string? stuDept = null, stuEmail = null;
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
                                failureCount++;
                                errors.Add(new BulkUploadError { StudentId = record.StudentId, Reason = "Student not found" });
                                continue;
                            }

                            using var cmdFac = new NpgsqlCommand(@"
                                SELECT department FROM (
                                    SELECT fp.department FROM Users u JOIN FacultyProfiles fp ON u.id = fp.user_id WHERE u.email = @email AND u.status = 'APPROVED'
                                    UNION 
                                    SELECT ap.department FROM Users u JOIN AdminProfiles ap ON u.id = ap.user_id WHERE u.email = @email AND u.status = 'APPROVED'
                                ) AS combined LIMIT 1", conn);
                            cmdFac.Parameters.AddWithValue("email", facultyId);
                            var facDept = await cmdFac.ExecuteScalarAsync() as string;

                            if (facDept == null)
                            {
                                failureCount++;
                                errors.Add(new BulkUploadError { StudentId = record.StudentId, Reason = "Faculty not approved" });
                                continue;
                            }

                            record.StudentHash = stuEmail;
                            record.FacultyId = facultyId;
                            
                            // Attach the distributed IPFS CID to the blockchain record
                            // (Ensure you have added 'public string IpfsCID { get; set; }' to your GradeRequest model!)
                            record.IpfsCID = ipfsCid;

                            var blockchainRecord = record.ToBlockchainRecord("PLV");
                                
                            using var transaction = await conn.BeginTransactionAsync();
                            try
                            {
                                await _blockchainService.SubmitGradeAsync(blockchainRecord, facultyId);
                                
                                using var cmdLog = new NpgsqlCommand(@"
                                    INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                                    VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn, transaction);
                                cmdLog.Parameters.AddWithValue("rid", blockchainRecord.Id);
                                cmdLog.Parameters.AddWithValue("old", DBNull.Value);
                                cmdLog.Parameters.AddWithValue("new", record.Grade ?? "");
                                cmdLog.Parameters.AddWithValue("reason", "Bulk Excel/CSV Upload");
                                cmdLog.Parameters.AddWithValue("appr", facultyId);
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
                string existingGradeJson = await _blockchainService.GetGradeAsync(correction.RecordID, correction.ApprovedBy);
                var gradeToUpdate = JsonSerializer.Deserialize<AcademicRecord>(existingGradeJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (gradeToUpdate == null) 
                    return NotFound(new { status = "Error", message = "Original grade record not found on blockchain." });

                gradeToUpdate.Grade = correction.NewGrade;
                gradeToUpdate.FacultyId = correction.ApprovedBy;
                gradeToUpdate.Date = DateTime.UtcNow.ToString("yyyy-MM-dd");
                
                await _blockchainService.UpdateGradeAsync(gradeToUpdate, correction.ApprovedBy);

                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var cmdLog = new NpgsqlCommand(@"
                    INSERT INTO gradecorrectionlogs (recordid, oldgrade, newgrade, reasontext, approvedby, timestamp) 
                    VALUES (@rid, @old, @new, @reason, @appr, CURRENT_TIMESTAMP)", conn);
                cmdLog.Parameters.AddWithValue("rid", correction.RecordID);
                cmdLog.Parameters.AddWithValue("old", (object?)correction.OldGrade ?? DBNull.Value);
                cmdLog.Parameters.AddWithValue("new", (object?)correction.NewGrade ?? DBNull.Value);
                cmdLog.Parameters.AddWithValue("reason", correction.ReasonText ?? "");
                cmdLog.Parameters.AddWithValue("appr", correction.ApprovedBy ?? "");
                await cmdLog.ExecuteNonQueryAsync();

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

            try
            {
                var jsonResult = await _blockchainService.GetAllGradesAsync(invokerId);
                using var doc = JsonDocument.Parse(jsonResult);
                var root = doc.RootElement;
                if (root.TryGetProperty("data", out var dataElement))
                {
                    var grades = JsonSerializer.Deserialize<List<AcademicRecord>>(
                        dataElement.GetRawText(), 
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                    );
                    return Ok(new { status = "Success", count = grades?.Count ?? 0, data = grades });
                }
                return StatusCode(500, new { status = "Error", message = "Unexpected response format" });
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
                var jsonResult = await _blockchainService.GetGradeAsync(recordId, invokerId);
                var grade = JsonSerializer.Deserialize<AcademicRecord>(jsonResult, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return Ok(new { status = "Success", data = grade });
            }
            catch (Exception)
            {
                return NotFound(new { status = "Error", message = $"Grade not found: {recordId}" });
            }
        }

        [HttpPost("approve/{recordId}")]
        public async Task<IActionResult> ApproveGrade(string recordId, [FromQuery] string invokerId)
        {
            if (string.IsNullOrEmpty(invokerId)) 
                return BadRequest(new { status = "Error", message = "invokerId query parameter is required." });
            
            try
            {
                await _blockchainService.ApproveGradeAsync(recordId, invokerId);
                return Ok(new { status = "Success", message = "Grade approved by Department successfully." });
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
                await _blockchainService.FinalizeGradeAsync(recordId, invokerId);
                return Ok(new { status = "Success", message = "Grade finalized by Registrar successfully." });
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
                using var stream = file.OpenReadStream();
                content.Add(new StreamContent(stream), "file", file.FileName);
                
                var ipfsHost = Environment.GetEnvironmentVariable("IPFS_HOST") ?? "ipfs0";
                var ipfsUrl = _configuration["IpfsApiUrl"] ?? $"http://{ipfsHost}:5001/api/v0/add";
                var ipfsRes = await client.PostAsync(ipfsUrl, content);
                
                if (ipfsRes.IsSuccessStatusCode)
                {
                    var ipfsJson = await ipfsRes.Content.ReadAsStringAsync();
                    using var doc = JsonDocument.Parse(ipfsJson);
                    var cid = doc.RootElement.GetProperty("Hash").GetString();
                    return Ok(new { status = "Success", cid = cid, url = $"http://127.0.0.1:8080/ipfs/{cid}", message = "File securely distributed to IPFS." });
                }
                return StatusCode((int)ipfsRes.StatusCode, new { status = "Error", message = "IPFS daemon rejected the file." });
            }
            catch (Exception ex) { return StatusCode(500, new { status = "Error", message = $"IPFS service unreachable: {ex.Message}" }); }
        }
    }
}
