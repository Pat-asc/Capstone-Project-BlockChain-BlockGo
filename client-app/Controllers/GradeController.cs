using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
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

namespace BlockGo.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class GradesController : ControllerBase
    {
        private readonly IBlockchainService _blockchainService;
        private readonly RegistrarDbContext _context;
        private readonly ILogger<GradesController> _logger;

        public GradesController(
            IBlockchainService blockchainService, 
            RegistrarDbContext context,
            ILogger<GradesController> logger)
        {
            _blockchainService = blockchainService;
            _context = context;
            _logger = logger;
        }

        [HttpPost("record")]
        public async Task<IActionResult> RecordGrade([FromBody] GradeRequest request)
        {
            _logger.LogInformation("Recording grade for student: {StudentId}", request.StudentId);
            if (request == null)
                return BadRequest(new { status = "Error", message = "Invalid grade data." });

            try
            {
                var faculty = await _context.Userrequests
                    .FirstOrDefaultAsync(u => u.Email == request.FacultyId && u.Requeststatus == "APPROVED");
                if (faculty == null)
                    return Unauthorized(new { status = "Error", message = "Faculty not approved or does not exist." });

                var student = await _context.Userrequests
                    .FirstOrDefaultAsync(u => u.Email == request.StudentHash && u.Role != null && u.Role.ToLower() == "student");
                if (student == null)
                    return NotFound(new { status = "Error", message = "Student not found in registration logs." });

                if (student != null && !string.IsNullOrEmpty(student.Department) && student.Department != faculty.Department)
                    return Forbid($"Access Denied: Cannot grade students outside the {faculty.Department} department.");

                using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                    var blockchainRecord = request.ToBlockchainRecord("PLV");
                    var result = await _blockchainService.SubmitGradeAsync(blockchainRecord, request.FacultyId);
                    var initialLog = request.ToInitialLog();
                    _context.Gradecorrectionlogs.Add(initialLog);
                    await _context.SaveChangesAsync();
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
        public async Task<IActionResult> BulkUploadGradesCSV(IFormFile csvFile)
        {
            _logger.LogInformation("CSV bulk upload initiated");

            if (csvFile == null || csvFile.Length == 0)
                return BadRequest(new { status = "Error", message = "CSV file is required." });

            var facultyId = Request.Headers["x-user-identity"].ToString();
            if (string.IsNullOrEmpty(facultyId))
                return BadRequest(new { status = "Error", message = "Faculty identity required." });

            _logger.LogInformation("CSV upload for faculty: {FacultyId}", facultyId);

            try
            {
                var successCount = 0;
                var failureCount = 0;
                var errors = new List<BulkUploadError>();

                var tempFile = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ".csv");
                
                try
                {
                    using (var fileStream = new FileStream(tempFile, FileMode.Create))
                        await csvFile.CopyToAsync(fileStream);

                    using (var reader = new StreamReader(tempFile, System.Text.Encoding.UTF8))
                    {
                        string line;
                        int lineNum = 0;
                        Dictionary<string, int> headerMap = null;

                        while ((line = await reader.ReadLineAsync()) != null)
                        {
                            lineNum++;
                            line = line.Trim();
                            if (string.IsNullOrEmpty(line)) continue;

                            var fields = line.Split(',');

                            // Parse header
                            if (lineNum == 1)
                            {
                                headerMap = new Dictionary<string, int>();
                                for (int i = 0; i < fields.Length; i++)
                                    headerMap[fields[i].Trim()] = i;
                                continue;
                            }

                            // Parse data row
                            try
                            {
                                var studentId = GetCsvField(fields, headerMap, "student_id");
                                var grade = GetCsvField(fields, headerMap, "grade");
                                var course = GetCsvField(fields, headerMap, "course") ?? "Unknown";
                                var semester = GetCsvField(fields, headerMap, "semester") ?? "Unknown";

                                if (string.IsNullOrEmpty(studentId) || string.IsNullOrEmpty(grade))
                                {
                                    failureCount++;
                                    errors.Add(new BulkUploadError { StudentId = studentId ?? "UNKNOWN", Reason = "Missing student_id or grade" });
                                    continue;
                                }

                                var student = await _context.Userrequests
                                    .FirstOrDefaultAsync(u => u.Email == studentId && u.Role != null && u.Role.ToLower() == "student");

                                if (student == null)
                                {
                                    failureCount++;
                                    errors.Add(new BulkUploadError { StudentId = studentId, Reason = "Student not found" });
                                    continue;
                                }

                                var faculty = await _context.Userrequests
                                    .FirstOrDefaultAsync(u => 
                                        u.Email == facultyId && 
                                        u.Requeststatus == "APPROVED");

                                if (faculty == null)
                                {
                                    failureCount++;
                                    errors.Add(new BulkUploadError { StudentId = studentId, Reason = "Faculty not approved" });
                                    continue;
                                }

                                if (!string.IsNullOrEmpty(student.Department) && student.Department != faculty.Department)
                                {
                                    failureCount++;
                                    errors.Add(new BulkUploadError { StudentId = studentId, Reason = "Department mismatch" });
                                    continue;
                                }

                                var gradeRequest = new GradeRequest
                                {
                                    StudentId = studentId,
                                    StudentHash = student.Email,
                                    Grade = grade,
                                    Course = course,
                                    FacultyId = facultyId,
                                    Semester = semester
                                };

                                var blockchainRecord = gradeRequest.ToBlockchainRecord("PLV");
                                
                                using var transaction = await _context.Database.BeginTransactionAsync();
                                try
                                {
                                    await _blockchainService.SubmitGradeAsync(blockchainRecord, facultyId);
                                    var initialLog = gradeRequest.ToInitialLog();
                                    _context.Gradecorrectionlogs.Add(initialLog);
                                    await _context.SaveChangesAsync();
                                    await transaction.CommitAsync();
                                    successCount++;
                                }
                                catch (Exception txEx)
                                {
                                    await transaction.RollbackAsync();
                                    failureCount++;
                                    errors.Add(new BulkUploadError { StudentId = studentId, Reason = txEx.Message });
                                }
                            }
                            catch (Exception ex)
                            {
                                failureCount++;
                                errors.Add(new BulkUploadError { StudentId = "ERROR", Reason = ex.Message });
                            }
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

        private string? GetCsvField(string[] fields, Dictionary<string, int> headerMap, string fieldName)
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

            using var transaction = await _context.Database.BeginTransactionAsync();
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

                var auditLog = new Gradecorrectionlog {
                    Recordid = correction.RecordID,
                    Oldgrade = correction.OldGrade,
                    Newgrade = correction.NewGrade,
                    Reasontext = correction.ReasonText,
                    Approvedby = correction.ApprovedBy,
                    Timestamp = DateTime.UtcNow
                };

                _context.Gradecorrectionlogs.Add(auditLog);
                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                return Ok(new { status = "Success", message = "Correction synchronized." });
            }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
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
    }
}
