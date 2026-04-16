using BlockGo.Models;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace BlockGo.Services
{
    public class BlockchainService : IBlockchainService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<BlockchainService>? _logger;
        private readonly string _middlewareBaseUrl;

        public BlockchainService(HttpClient httpClient, IConfiguration configuration, ILogger<BlockchainService>? logger = null)
        {
            _httpClient = httpClient;
            _logger = logger;
            _middlewareBaseUrl = configuration["Middleware:Url"] ?? throw new InvalidOperationException("Middleware URL not configured in appsettings.json.");
            
            var apiKey = configuration["InternalApiKey"] ?? throw new InvalidOperationException("Internal API Key not configured.");
            _httpClient.DefaultRequestHeaders.Add("x-api-key", apiKey);
        }

        public async Task<string> GetAllGradesAsync(string invokerUsername)
        {
            _logger?.LogInformation("Getting all grades from blockchain as {User}", invokerUsername);
            
            var request = new HttpRequestMessage(HttpMethod.Get, $"{_middlewareBaseUrl}/api/all-grades");
            request.Headers.Add("x-user-identity", invokerUsername); 

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                _logger?.LogError("Middleware GetAllGrades Error: {Error}", errorContent);
                throw new Exception($"Middleware Error: {errorContent}");
            }
            
            return await response.Content.ReadAsStringAsync();
        }

        public async Task<string> GetGradeAsync(string recordId, string invokerUsername)
        {
            _logger?.LogInformation("Getting grade for record ID: {RecordId} as {User}", recordId, invokerUsername);
            
            var request = new HttpRequestMessage(HttpMethod.Get, $"{_middlewareBaseUrl}/api/get-grade/{recordId}");
            request.Headers.Add("x-user-identity", invokerUsername);

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                _logger?.LogError("Middleware Approve Error: {Error}", errorContent);
                throw new Exception($"Middleware Error: {errorContent}");
            }
            
            return await response.Content.ReadAsStringAsync();
        }

        public async Task<string> SubmitGradeAsync(AcademicRecord record, string invokerUsername)
        {
            _logger?.LogInformation("Submitting grade for student: {StudentId} as {User}", record.Id, invokerUsername);
            
            var request = new HttpRequestMessage(HttpMethod.Post, $"{_middlewareBaseUrl}/api/issue-grade")
            {
                Content = JsonContent.Create(record)
            };
            request.Headers.Add("x-user-identity", invokerUsername);
            
            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                _logger?.LogError("Middleware Error: {Error}", errorContent);
                response.EnsureSuccessStatusCode();
            }
            
            return await response.Content.ReadAsStringAsync();
        }

        public async Task<string> UpdateGradeAsync(AcademicRecord record, string invokerUsername)
        {
            _logger?.LogInformation("Updating grade for student: {StudentId} as {User}", record.Id, invokerUsername);
            
            var request = new HttpRequestMessage(HttpMethod.Post, $"{_middlewareBaseUrl}/api/update-grade")
            {
                Content = JsonContent.Create(record)
            };
            request.Headers.Add("x-user-identity", invokerUsername);
            
            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                _logger?.LogError("Middleware UpdateGrade Error: {Error}", errorContent);
                throw new Exception($"Middleware Error: {errorContent}");
            }
            
            return await response.Content.ReadAsStringAsync();
        }

        public async Task<string> ApproveGradeAsync(string recordId, string invokerUsername)
        {
            _logger?.LogInformation("Approving grade for record: {RecordId} as {User}", recordId, invokerUsername);
            
            var request = new HttpRequestMessage(HttpMethod.Post, $"{_middlewareBaseUrl}/api/approve-grade/{recordId}")
            {
                Content = JsonContent.Create(new { })
            };
            request.Headers.Add("x-user-identity", invokerUsername);

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                _logger?.LogError("Middleware Approve Error: {Error}", errorContent);
                throw new Exception($"Middleware Error: {errorContent}");
            }
            
            return await response.Content.ReadAsStringAsync();
        }

        public async Task<string> FinalizeGradeAsync(string recordId, string invokerUsername)
        {
            _logger?.LogInformation("Finalizing grade for record: {RecordId} as {User}", recordId, invokerUsername);
            
            var request = new HttpRequestMessage(HttpMethod.Post, $"{_middlewareBaseUrl}/api/finalize-grade/{recordId}")
            {
                Content = JsonContent.Create(new { })
            };
            request.Headers.Add("x-user-identity", invokerUsername);

            var response = await _httpClient.SendAsync(request);
            
            if (!response.IsSuccessStatusCode)
            {
                var errorContent = await response.Content.ReadAsStringAsync();
                _logger?.LogError("Middleware Finalize Error: {Error}", errorContent);
                throw new Exception($"Middleware Error: {errorContent}");
            }
            
            return await response.Content.ReadAsStringAsync();
        }
    }
}