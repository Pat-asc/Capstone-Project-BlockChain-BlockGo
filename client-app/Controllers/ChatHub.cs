using Microsoft.AspNetCore.SignalR;
using Client_app.Models;
using Client_app.Services;
using System.Text.Json;

namespace Client_app.Controllers
{
    public class ChatHub : Hub
    {
        private readonly IChatCache _chatCache;

        public ChatHub(IChatCache chatCache)
        {
            _chatCache = chatCache;
        }

        public async Task JoinChat(string userEmail, string role)
        {
            // Add user to group based on role (registrar sees all, students see registrar)
            await Groups.AddToGroupAsync(Context.ConnectionId, "registrar");
            if (role == "student") 
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, $"student_{userEmail}");
            }
            
            // Update online status
            await UpdateOnlineStatus(userEmail, true, role);
            
            // Notify others
            await Clients.OthersInGroup("registrar").SendAsync("UserJoined", new { Email = userEmail, Role = role });
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            // Update offline status
            var userEmail = Context.UserIdentifier;
            if (!string.IsNullOrEmpty(userEmail))
            {
                await UpdateOnlineStatus(userEmail, false);
                await Clients.Others.SendAsync("UserLeft", new { Email = userEmail });
            }
            await base.OnDisconnectedAsync(exception);
        }

        public async Task SendMessage(string receiverEmail, string message)
        {
            var senderEmail = Context.UserIdentifier;
            if (string.IsNullOrEmpty(senderEmail)) return;

            var chatMessage = new ChatMessage
            {
                SenderEmail = senderEmail,
                ReceiverEmail = receiverEmail,
                Message = message,
                Timestamp = DateTime.UtcNow,
                IsRead = false
            };

            // Save to cache (fire-and-forget)
            _ = _chatCache.SaveMessageAsync(chatMessage);

            // Send real-time
            await Clients.User(receiverEmail).SendAsync("ReceiveMessage", new 
            { 
                Sender = senderEmail, 
                Message = message, 
                Timestamp = DateTime.UtcNow 
            });
        }

        public async Task GetChatHistory(string otherUserEmail)
        {
            var senderEmail = Context.UserIdentifier;
            var history = await _chatCache.GetHistoryAsync(senderEmail, otherUserEmail);
            await Clients.Caller.SendAsync("ChatHistory", history);
        }

        private async Task UpdateOnlineStatus(string email, bool isOnline, string role = "")
        {
            await _chatCache.UpdateOnlineStatusAsync(email, isOnline, role);
            await Clients.All.SendAsync("OnlineStatusChanged", new { Email = email, IsOnline = isOnline });
        }
    }
}

