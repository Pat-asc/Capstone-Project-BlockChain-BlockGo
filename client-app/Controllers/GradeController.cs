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
            {
                _logger.LogWarning("Invalid grade data received");
                return BadRequest(new { status = "Error", message = "Invalid grade data." });
            }

            try
            {
                var faculty = await _context.Userrequests
                    .FirstOrDefaultAsync(u => u.Email == request.FacultyId && u.Requeststatus == "APPROVED");
                
                if (faculty == null)
                {
                    _logger.LogWarning("Faculty not found or not approved: {FacultyId}", request.FacultyId);
                    return Unauthorized(new { 
                        status = "Error", 
                        message = "Faculty not approved or does not exist.",
                        tip = "Faculty must be registered and approved in the system first"
                    });
                }

                var student = await _context.Userrequests
                    .FirstOrDefaultAsync(u => u.Email == request.StudentHash && u.Role != null && u.Role.ToLower() == "student");

                if (student == null)
                {
                    _logger.LogWarning("Student not found: {StudentHash}", request.StudentHash);
                    return NotFound(new { 
                        status = "Error", 
                        message = "Student not found in registration logs." 
                    });
                }

                if (string.IsNullOrEmpty(student.Department) || student.Department != faculty.Department)
                {
                    _logger.LogWarning("Department mismatch. Faculty: {FacultyDept}, Student: {StudentDept}",
                        faculty.Department, student.Department);
                    return Forbid($"Access Denied: You cannot grade students outside the {faculty.Department} department.");
                }

                using var transaction = await _context.Database.BeginTransactionAsync();
                try
                {
                    _logger.LogInformation("Converting grade request to blockchain record");
                    var blockchainRecord = request.ToBlockchainRecord("PLV");
                    
                    _logger.LogInformation("Submitting grade to blockchain via middleware (IssueGrade)");
                    var result = await _blockchainService.SubmitGradeAsync(blockchainRecord, request.FacultyId);

                    var initialLog = request.ToInitialLog();
                    _context.Gradecorrectionlogs.Add(initialLog);
                    
                    await _context.SaveChangesAsync();
                    await transaction.CommitAsync();

                    _logger.LogInformation("✓ Grade recorded successfully for student: {StudentId}", request.StudentId);
                    
                    return Ok(new { 
                        status = "Success", 
                        message = "Grade secured on Ledger and Logged in Postgres!",
                        studentId = request.StudentId,
                        grade = request.Grade,
                        course = request.Course,
                        blockchainDetails = result,
                        timestamp = DateTime.UtcNow
                    });
                }
                catch (Exception ex)
                {
                    await transaction.RollbackAsync();
                    _logger.LogError(ex, "Transaction failed");
                    
                    return StatusCode(500, new { 
                        status = "Error", 
                        message = $"Ledger/Sync Failed: {ex.Message}",
                        details = ex.InnerException?.Message
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error recording grade");
                return StatusCode(500, new { 
                    status = "Error", 
                    message = "Internal server error",
                    error = ex.Message 
                });
            }
        }

        [HttpPost("correct")]
        public async Task<IActionResult> CorrectGrade([FromBody] GradeCorrectionRequest correction)
        {
            _logger.LogInformation("Correcting grade for record: {RecordID}", correction.RecordID);
            if (string.IsNullOrEmpty(correction.RecordID)) return BadRequest(new { status = "Error", message = "RecordID is required." });

            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                string existingGradeJson = await _blockchainService.GetGradeAsync(correction.RecordID, correction.ApprovedBy);
                var gradeToUpdate = JsonSerializer.Deserialize<AcademicRecord>(existingGradeJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

                if (gradeToUpdate == null) return NotFound(new { status = "Error", message = "Original grade record not found on blockchain." });

                gradeToUpdate.Grade = correction.NewGrade;
                gradeToUpdate.FacultyId = correction.ApprovedBy;
                gradeToUpdate.Date = DateTime.UtcNow.ToString("yyyy-MM-dd");
                
                var bcResult = await _blockchainService.UpdateGradeAsync(gradeToUpdate, correction.ApprovedBy);

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

                    return Ok(new { 
                        status = "Success", 
                        count = grades?.Count ?? 0, 
                        data = grades 
                    });
                }
                
                return StatusCode(500, new { status = "Error", message = "Unexpected response format from Middleware" });
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
            if (string.IsNullOrEmpty(invokerId)) return BadRequest(new { status = "Error", message = "invokerId query parameter is required for ABAC." });

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
                var result = await _blockchainService.ApproveGradeAsync(recordId, invokerId);
                return Ok(new { status = "Success", message = "Grade approved by Department successfully." });
            }
            catch (Exception ex) { return StatusCode(500, new { status = "Error", message = ex.Message }); }
        }

        [HttpPost("finalize/{recordId}")]
        public async Task<IActionResult> FinalizeGrade(string recordId, [FromQuery] string invokerId)
        {
            if (string.IsNullOrEmpty(invokerId)) 
                return BadRequest(new { status = "Error", message = "invokerId query parameter is required." });
            
            try
            {
                var result = await _blockchainService.FinalizeGradeAsync(recordId, invokerId);
                return Ok(new { status = "Success", message = "Grade finalized by Registrar successfully." });
            }
            catch (Exception ex) { return StatusCode(500, new { status = "Error", message = ex.Message }); }
        }
    }
}