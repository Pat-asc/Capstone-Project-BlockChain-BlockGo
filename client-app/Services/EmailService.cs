using System;
using System.Net.Mail;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;

namespace Client_app.Services
{
    public class EmailService : IEmailService
    {
        private readonly IConfiguration _configuration;

        public EmailService(IConfiguration configuration)
        {
            _configuration = configuration;
        }

        public async Task SendEmailAsync(string toEmail, string subject, string body, bool isHtml = false)
        {
            try
            {
                var smtpHost = _configuration["Smtp:Host"];
                
                if (!int.TryParse(_configuration["Smtp:Port"], out int smtpPort))
                {
                    smtpPort = 587;
                }

                var smtpUser = _configuration["Smtp:Username"] ?? _configuration["Smtp:User"];
                var smtpPass = _configuration["Smtp:Password"] ?? _configuration["Smtp:Pass"];

                if (string.IsNullOrEmpty(smtpHost) || string.IsNullOrEmpty(smtpUser) || string.IsNullOrEmpty(smtpPass) || smtpPass.Contains("your-"))
                {
                    Console.WriteLine($"[EMAIL SKIPPED] SMTP not configured. Intended for: {toEmail}");
                    return;
                }

                using var client = new SmtpClient(smtpHost, smtpPort)
                {
                    UseDefaultCredentials = false,
                    Credentials = new System.Net.NetworkCredential(smtpUser, smtpPass),
                    EnableSsl = true
                };

                var mailMessage = new MailMessage { Subject = subject, Body = body, IsBodyHtml = isHtml };
                mailMessage.From = new MailAddress(smtpUser, "PLV BlockGo");
                mailMessage.To.Add(toEmail);
                await client.SendMailAsync(mailMessage);
                Console.WriteLine($"[EMAIL SENT] Successfully sent email to {toEmail} with subject '{subject}'");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[EMAIL ERROR] Failed to send email to {toEmail}: {ex.Message}");
            }
        }
    }
}