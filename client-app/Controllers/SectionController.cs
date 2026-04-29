using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Npgsql;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using ClosedXML.Excel;

namespace BlockGo.Controllers
{
    [ApiController]
    [Route("api/Auth/sections")]
    public class SectionController : ControllerBase
    {
        private readonly string _connectionString;

        public SectionController(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("PostgresConnection") 
                ?? configuration.GetConnectionString("MasterConnection") 
                ?? throw new InvalidOperationException("PostgreSQL connection string not found.");
                
            EnsureTableExists();
        }

        private void EnsureTableExists()
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                conn.Open();
                // Auto-create the AcademicSections table if it doesn't exist yet
                using var cmd = new NpgsqlCommand(@"
                    CREATE TABLE IF NOT EXISTS AcademicSections (
                        id SERIAL PRIMARY KEY,
                        department VARCHAR(50) NOT NULL,
                        year_level INT NOT NULL,
                        section_num INT NOT NULL,
                        UNIQUE(department, year_level, section_num)
                    );
                    
                    -- Migration: Add subject column to FacultySections if it doesn't exist
                    DO $$ 
                    BEGIN 
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='facultysections' AND column_name='subject') THEN
                            ALTER TABLE facultysections ADD COLUMN subject VARCHAR(100);
                        END IF;
                    END $$;

                    -- Update unique index to include subject
                    DROP INDEX IF EXISTS idx_unique_faculty_section;
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_faculty_section ON facultysections(user_id, department, section, subject);
                ", conn);
                cmd.ExecuteNonQuery();
            }
            catch { /* Ignore if unable to create (e.g. read-only permissions) */ }
        }

        public class CreateSectionRequest
        {
            [JsonPropertyName("department")]
            public string Department { get; set; } = string.Empty;
            [JsonPropertyName("yearLevel")]
            public string YearLevel { get; set; } = string.Empty;
            [JsonPropertyName("sectionNum")]
            public string SectionNum { get; set; } = string.Empty;
            [JsonPropertyName("assignToEmail")]
            public string? AssignToEmail { get; set; }
            [JsonPropertyName("subject")]
            public string? Subject { get; set; }
        }

        [HttpPost]
        public async Task<IActionResult> CreateSection([FromBody] CreateSectionRequest request)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                using var transaction = await conn.BeginTransactionAsync();

                using var cmd = new NpgsqlCommand("INSERT INTO AcademicSections (department, year_level, section_num) VALUES (@dept, @year, @sec) RETURNING id", conn, transaction);
                cmd.Parameters.AddWithValue("dept", request.Department);
                cmd.Parameters.AddWithValue("year", int.Parse(request.YearLevel));
                cmd.Parameters.AddWithValue("sec", int.Parse(request.SectionNum));
                
                var id = await cmd.ExecuteScalarAsync();

                if (!string.IsNullOrWhiteSpace(request.AssignToEmail))
                {
                    using var cmdUser = new NpgsqlCommand("SELECT id FROM Users WHERE LOWER(email) = LOWER(@email) LIMIT 1", conn, transaction);
                    cmdUser.Parameters.AddWithValue("email", request.AssignToEmail);
                    var userIdObj = await cmdUser.ExecuteScalarAsync();
                    
                    if (userIdObj != null)
                    {
                        using var cmdAssign = new NpgsqlCommand(@"
                            INSERT INTO FacultySections (user_id, department, section, year_level, subject) 
                            VALUES (@uid, @dept, @sec, @year, @subj) 
                            ON CONFLICT (user_id, department, section, subject) DO NOTHING", conn, transaction);
                        cmdAssign.Parameters.AddWithValue("uid", (int)userIdObj);
                        cmdAssign.Parameters.AddWithValue("dept", request.Department);
                        cmdAssign.Parameters.AddWithValue("sec", request.SectionNum);
                        cmdAssign.Parameters.AddWithValue("year", request.YearLevel);
                        cmdAssign.Parameters.AddWithValue("subj", (object?)request.Subject?.Trim() ?? DBNull.Value);
                        await cmdAssign.ExecuteNonQueryAsync();
                    }
                }

                await transaction.CommitAsync();

                return Ok(new { status = "Success", message = "Section created successfully", id = id });
            }
            catch (PostgresException ex) when (ex.SqlState == "23505")
            {
                return BadRequest(new { status = "Error", message = "This section already exists in the department." });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpGet("department/{department}")]
        public async Task<IActionResult> GetDepartmentSections(string department)
        {
            try
            {
                var sections = new List<object>();
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                using var cmd = new NpgsqlCommand("SELECT id, department, year_level, section_num FROM AcademicSections WHERE department = @dept ORDER BY year_level, section_num", conn);
                cmd.Parameters.AddWithValue("dept", department);

                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    sections.Add(new
                    {
                        id = reader.GetInt32(0).ToString(),
                        department = reader.GetString(1),
                        yearLevel = reader.GetInt32(2).ToString(),
                        sectionNum = reader.GetInt32(3).ToString()
                    });
                }

                return Ok(new { status = "Success", data = sections });
            }
            catch (Exception ex)
            {
                // Graceful fallback if the table isn't fully initialized yet
                if (ex.Message.Contains("does not exist")) return Ok(new { status = "Success", data = new List<object>() });
                return StatusCode(500, new { status = "Error", message = ex.Message });
            }
        }

        [HttpPost("{id}/enroll")]
        [Consumes("multipart/form-data")]
        public async Task<IActionResult> EnrollStudents(string id, [FromForm] IFormFile file)
        {
            if (file == null || file.Length == 0) return BadRequest(new { status = "Error", message = "A .csv or .xlsx file is required." });

            try
            {
                string department = "", yearLevel = "", sectionNum = "";

                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                using (var cmdSec = new NpgsqlCommand("SELECT department, year_level, section_num FROM AcademicSections WHERE id = @id", conn))
                {
                    cmdSec.Parameters.AddWithValue("id", int.Parse(id));
                    using var readerSec = await cmdSec.ExecuteReaderAsync();
                    if (await readerSec.ReadAsync())
                    {
                        department = readerSec.GetString(0);
                        yearLevel = readerSec.GetInt32(1).ToString();
                        sectionNum = readerSec.GetInt32(2).ToString();
                    }
                    else return NotFound(new { status = "Error", message = "Section not found." });
                }

                var ext = Path.GetExtension(file.FileName).ToLower();
                var tempFile = Path.Combine(Path.GetTempPath(), Guid.NewGuid() + ext);
                int successCount = 0;
                
                try
                {
                    using (var fileStream = new FileStream(tempFile, FileMode.Create)) await file.CopyToAsync(fileStream);
                    var studentIds = new List<string>();

                    if (ext == ".csv")
                    {
                        using var reader = new StreamReader(tempFile, System.Text.Encoding.UTF8);
                        string? line; int lineNum = 0; Dictionary<string, int>? headerMap = null;
                        while ((line = await reader.ReadLineAsync()) != null)
                        {
                            lineNum++; line = line.Trim(); if (string.IsNullOrEmpty(line)) continue;
                            var fields = line.Split(',');
                            if (lineNum == 1) { headerMap = new Dictionary<string, int>(); for (int i = 0; i < fields.Length; i++) headerMap[fields[i].Trim().ToLower().Replace(" ", "_")] = i; continue; }
                            string? GetField(string key) => headerMap != null && headerMap.TryGetValue(key, out int idx) && idx < fields.Length ? fields[idx].Trim() : null;
                            var sId = GetField("student_id") ?? GetField("student_no") ?? GetField("email") ?? GetField("studentno") ?? GetField("studentid");
                            if (!string.IsNullOrEmpty(sId)) studentIds.Add(sId);
                        }
                    }

                    foreach (var sId in studentIds)
                    {
                        using var cmdUpd = new NpgsqlCommand("UPDATE StudentProfiles SET department = @dept, section = @sec, assignment_status = 'Enrolled' WHERE student_no = @sid OR user_id = (SELECT id FROM Users WHERE email = @sid LIMIT 1)", conn);
                        cmdUpd.Parameters.AddWithValue("dept", department); cmdUpd.Parameters.AddWithValue("sec", $"{yearLevel}-{sectionNum}"); cmdUpd.Parameters.AddWithValue("sid", sId);
                        if (await cmdUpd.ExecuteNonQueryAsync() > 0) successCount++;
                    }
                }
                finally { if (System.IO.File.Exists(tempFile)) System.IO.File.Delete(tempFile); }
                return Ok(new { status = "Success", message = $"Successfully enrolled {successCount} students into {department} {yearLevel}-{sectionNum}!" });
            }
            catch (Exception ex) { return StatusCode(500, new { status = "Error", message = ex.Message }); }
        }
    }
}
