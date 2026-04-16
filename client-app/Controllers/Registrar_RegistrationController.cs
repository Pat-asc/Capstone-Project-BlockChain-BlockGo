using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using For_Testing_Only_Capstone.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Client_app.Models; // Added for RegistrationRequest

namespace Client_app.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class Registrar_RegistrationController : ControllerBase
    {
        private readonly RegistrarDbContext _context;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<Registrar_RegistrationController> _logger;

        public Registrar_RegistrationController(RegistrarDbContext context, IHttpClientFactory httpClientFactory, IConfiguration configuration, ILogger<Registrar_RegistrationController> logger)
        {
            _context = context;
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _logger = logger;
        }

        [HttpPost("grant/{sqlRequestId}")]
        public async Task<IActionResult> GrantAccess(int sqlRequestId, [FromBody] RegistrationRequest request)
        {
            try
            {
                var sqlRecord = await _context.Userrequests.FindAsync(sqlRequestId);
                if (sqlRecord == null || sqlRecord.Requeststatus != "PENDING")
                    return BadRequest(new { status = "Error", message = "Invalid request" });

                var middlewareUrl = _configuration["Middleware:Url"] ?? "http://localhost:4000";
                using var client = _httpClientFactory.CreateClient("FabricCAClient");
                var internalApiKey = _configuration["InternalApiKey"];
                if (string.IsNullOrEmpty(internalApiKey))
                {
                    return StatusCode(500, new { status = "Error", message = "Internal API Key is not configured." });
                }
                client.DefaultRequestHeaders.Add("x-api-key", internalApiKey);
                
                string mappedRole = "student";
                if (sqlRecord.Role != null)
                {
                    var r = sqlRecord.Role.ToLower();
                    if (r == "prof" || r == "faculty") mappedRole = "faculty";
                    else if (r == "dean" || r == "department" || r == "department_admin" || r == "dept") mappedRole = "department_admin";
                    else if (r == "registrar") mappedRole = "registrar";
                }

                var payload = new { 
                    username = sqlRecord.Email, 
                    password = request.Password, 
                    role = mappedRole 
                };

                var regRes = await client.PostAsJsonAsync($"{middlewareUrl}/api/register", payload);
                if (!regRes.IsSuccessStatusCode) return StatusCode((int)regRes.StatusCode, await regRes.Content.ReadAsStringAsync());

                var enrollRes = await client.PostAsJsonAsync($"{middlewareUrl}/api/enroll", payload);
                if (!enrollRes.IsSuccessStatusCode) return BadRequest("Wallet creation failed.");

                sqlRecord.Requeststatus = "APPROVED";
                await _context.SaveChangesAsync();
                return Ok(new { status = "Success", message = "Blockchain ID and Wallet Synchronized" });
            }
            catch (Exception ex) { return StatusCode(500, new { status = "Error", message = ex.Message }); }
        }
    }
}