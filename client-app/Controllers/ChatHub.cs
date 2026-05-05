using Microsoft.AspNetCore.SignalR;
using Client_app.Models;
using Client_app.Services;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;
using System;
using System.Collections.Generic;
using Npgsql;
using Microsoft.Extensions.Configuration;
using System.Threading.Tasks;

namespace Client_app.Controllers
{
    [Authorize]
    public class ChatHub : Hub
    {
        private readonly IChatCache _chatCache;
        private readonly string _connectionString;

        public ChatHub(IChatCache chatCache, IConfiguration configuration)
        {
            _chatCache = chatCache;
            _connectionString = configuration.GetConnectionString("PostgresConnection") ?? configuration.GetConnectionString("MasterConnection") ?? throw new InvalidOperationException("PostgreSQL connection string not found.");
        }

        public async Task JoinChat(string role)
        {
            var userEmail = Context.User?.Identity?.Name;
            if (string.IsNullOrEmpty(userEmail)) return;

            await Groups.AddToGroupAsync(Context.ConnectionId, $"private_{userEmail}");
            
            await UpdateOnlineStatus(userEmail, true, role);
            
            await Clients.Others.SendAsync("UserJoined", new { Email = userEmail, Role = role, FullName = userEmail.Split('@')[0] });
            
            await Clients.Others.SendAsync("RequestRollCall", userEmail);
        }

        public async Task AnnouncePresence(string targetEmail)
        {
            var myEmail = Context.User?.Identity?.Name;
            var myRole = Context.User?.FindFirst("dbRole")?.Value ?? Context.User?.FindFirst(ClaimTypes.Role)?.Value ?? "student";
            if (string.IsNullOrEmpty(myEmail)) return;

            await Clients.Group($"private_{targetEmail}").SendAsync("UserJoined", new { Email = myEmail, Role = myRole, FullName = myEmail.Split('@')[0] });
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            var userEmail = Context.User?.Identity?.Name;
            if (!string.IsNullOrEmpty(userEmail))
            {
                await UpdateOnlineStatus(userEmail, false);
                await Clients.Others.SendAsync("UserLeft", new { Email = userEmail });
            }
            await base.OnDisconnectedAsync(exception);
        }

        public async Task SendMessage(string receiverEmail, string message)
        {
            var senderEmail = Context.User?.Identity?.Name;
            if (string.IsNullOrEmpty(senderEmail) || string.IsNullOrEmpty(receiverEmail)) return;

            var userRole = Context.User?.FindFirst("dbRole")?.Value ?? Context.User?.FindFirst(ClaimTypes.Role)?.Value ?? "student";
            var displayName = senderEmail.Split('@')[0].Replace(".", " ");

            var chatMessage = new ChatMessage
            {
                SenderEmail = senderEmail,
                ReceiverEmail = receiverEmail,
                Message = message,
                Timestamp = DateTime.UtcNow,
                IsRead = false
            };

            _ = _chatCache.SaveMessageAsync(chatMessage);

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var cmd = new NpgsqlCommand(@"
                    INSERT INTO chat_messages (sender_email, receiver_email, message, timestamp, is_read) 
                    VALUES (@sender, @receiver, @msg, @ts, false)", conn);
                cmd.Parameters.AddWithValue("sender", senderEmail);
                cmd.Parameters.AddWithValue("receiver", receiverEmail);
                cmd.Parameters.AddWithValue("msg", message);
                cmd.Parameters.AddWithValue("ts", chatMessage.Timestamp);
                await cmd.ExecuteNonQueryAsync();
            }
            catch { /* Ignore DB connection issues so chat stays realtime via Cache */ }

            var payload = new 
            { 
                Sender = senderEmail, 
                Receiver = receiverEmail,
                SenderName = displayName,
                Role = userRole,
                Message = message, 
                Text = message, 
                Timestamp = DateTime.UtcNow 
            };
            await Clients.Groups(new List<string> { $"private_{receiverEmail}", $"private_{senderEmail}" }).SendAsync("ReceiveMessage", payload);
        }

        public async Task GetChatHistory(string otherUserEmail)
        {
            var senderEmail = Context.User?.Identity?.Name ?? string.Empty;
            
            if (!string.IsNullOrEmpty(senderEmail) && !string.IsNullOrEmpty(otherUserEmail))
            {
                var history = await _chatCache.GetHistoryAsync(senderEmail, otherUserEmail);
                await Clients.Caller.SendAsync("ChatHistory", history);
            }
        }

        private async Task UpdateOnlineStatus(string email, bool isOnline, string role = "")
        {
            await _chatCache.UpdateOnlineStatusAsync(email, isOnline, role);
            await Clients.All.SendAsync("OnlineStatusChanged", new { Email = email, IsOnline = isOnline });
        }
    }
}
