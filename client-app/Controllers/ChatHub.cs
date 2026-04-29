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
            // Assign the user to their own dedicated group for reliable direct messaging
            await Groups.AddToGroupAsync(Context.ConnectionId, $"user_{userEmail}");
            
            // Update online status
            await UpdateOnlineStatus(userEmail, true, role);
            
            // Notify others that I joined
            await Clients.Others.SendAsync("UserJoined", new { Email = userEmail, Role = role, FullName = userEmail.Split('@')[0] });
            
            // Request existing online users to announce themselves to me
            await Clients.Others.SendAsync("RequestRollCall", userEmail);
        }

        public async Task AnnouncePresence(string targetEmail, string myEmail, string myRole)
        {
            await Clients.Group($"user_{targetEmail}").SendAsync("UserJoined", new { Email = myEmail, Role = myRole, FullName = myEmail.Split('@')[0] });
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

        public async Task SendMessage(string senderEmail, string receiverEmail, string message)
        {
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

            // Send real-time using the receiver's dedicated group
            await Clients.Group($"user_{receiverEmail}").SendAsync("ReceiveMessage", new 
            { 
                Sender = senderEmail, 
                Message = message, 
                Timestamp = DateTime.UtcNow 
            });
        }

        public async Task GetChatHistory(string otherUserEmail)
        {
            var senderEmail = Context.UserIdentifier ?? string.Empty;
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
