using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Client_app.Models
{
    public class ChatMessage
    {
        [Key]
        public int Id { get; set; }
        
        public string SenderEmail { get; set; } = string.Empty;
        
        public string ReceiverEmail { get; set; } = string.Empty;
        
        public string Message { get; set; } = string.Empty;
        
        public DateTime Timestamp { get; set; }
        
        public bool IsRead { get; set; } = false;
        
        [JsonIgnore]
        public string? ConnectionId { get; set; } // SignalR client ID for real-time
    }
    
    public class ChatUserStatus
    {
        public string Email { get; set; } = string.Empty;
        public bool IsOnline { get; set; }
        public DateTime LastSeen { get; set; }
        public string Role { get; set; } = string.Empty;
        public string FullName { get; set; } = string.Empty;
    }
}

