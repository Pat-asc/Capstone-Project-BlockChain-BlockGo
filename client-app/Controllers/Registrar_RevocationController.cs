using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using For_Testing_Only_Capstone.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Client_app.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class Registrar_RevocationController : ControllerBase
    {
        private readonly RegistrarDbContext _context;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<Registrar_RevocationController> _logger;

        public Registrar_RevocationController(RegistrarDbContext context, IHttpClientFactory httpClientFactory, IConfiguration configuration, ILogger<Registrar_RevocationController> logger)
        {
            _context = context;
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _logger = logger;
        }

        [HttpDelete("revoke/{sqlRequestId}")]
public async Task<IActionResult> RevokeAccess(int sqlRequestId)
{
    try
    {
        var sqlRecord = await _context.Userrequests.FindAsync(sqlRequestId);
        if (sqlRecord == null || sqlRecord.Requeststatus != "APPROVED")
            return BadRequest(new { status = "Error", message = "User not in APPROVED state" });

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
            role = mappedRole 
        };

        var revokeRes = await client.PostAsJsonAsync($"{middlewareUrl}/api/revoke", payload);
        
        if (revokeRes.IsSuccessStatusCode)
        {
            sqlRecord.Requeststatus = "REVOKED";
            await _context.SaveChangesAsync();
            return Ok(new { status = "Success", message = "Access Revoked and Wallet Cleaned" });
        }

        return StatusCode((int)revokeRes.StatusCode, await revokeRes.Content.ReadAsStringAsync());
    }
    catch (Exception ex) { return StatusCode(500, new { status = "Error", message = ex.Message }); }
        }
    }
}