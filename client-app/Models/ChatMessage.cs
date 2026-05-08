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

        public DateTime SentAt { get; set; }

        public DateTime? DeliveredAt { get; set; }

        public DateTime? SeenAt { get; set; }

        public string? AttachmentName { get; set; }

        public string? AttachmentMime { get; set; }

        public long? AttachmentSizeBytes { get; set; }

        [JsonIgnore]
        public byte[]? AttachmentData { get; set; }

        public string? AttachmentDataBase64 { get; set; }
        
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
        public bool HasConversation { get; set; }
    }
}

