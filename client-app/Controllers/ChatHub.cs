using Microsoft.AspNetCore.SignalR;
using Client_app.Models;
using Client_app.Services;
using Microsoft.AspNetCore.Authorization;
using System.Security.Claims;
using System;
using System.Collections.Generic;
using System.Linq;
using Npgsql;
using NpgsqlTypes;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Threading.Tasks;

namespace Client_app.Controllers
{
    [Authorize]
    public class ChatHub : Hub
    {
        private readonly IChatCache _chatCache;
        private readonly IChatMessageEncryption _encryption;
        private readonly ILogger<ChatHub> _logger;
        private readonly string _connectionString;
        private static readonly TimeSpan DatabaseHistoryDuration = TimeSpan.FromDays(30);

        public ChatHub(IChatCache chatCache, IChatMessageEncryption encryption, IConfiguration configuration, ILogger<ChatHub> logger)
        {
            _chatCache = chatCache;
            _encryption = encryption;
            _logger = logger;
            _connectionString = configuration.GetConnectionString("PostgresConnection") ?? configuration.GetConnectionString("MasterConnection") ?? throw new InvalidOperationException("PostgreSQL connection string not found.");
        }

        public async Task JoinChat(string role)
        {
            var userEmail = Context.User?.Identity?.Name;
            if (string.IsNullOrEmpty(userEmail)) return;

            var resolvedRole = ResolveRole(role);
            var normalizedRole = NormalizeRole(resolvedRole);
            await Groups.AddToGroupAsync(Context.ConnectionId, $"private_{userEmail}");
            await Groups.AddToGroupAsync(Context.ConnectionId, $"role_{normalizedRole}");
            
            await UpdateOnlineStatus(userEmail, true, resolvedRole);
            await Clients.All.SendAsync("OnlineStatusChanged", new { Email = userEmail, IsOnline = true });
            await SendContactsToCallerAsync(userEmail, resolvedRole);

            var onlineUsers = await _chatCache.GetOnlineStatusesAsync();
            foreach (var user in onlineUsers.Where(u => !string.Equals(u.Email, userEmail, StringComparison.OrdinalIgnoreCase)))
            {
                await Clients.Caller.SendAsync("UserJoined", new { user.Email, user.Role, user.FullName });
            }
            
            await Clients.Others.SendAsync("UserJoined", new { Email = userEmail, Role = resolvedRole, FullName = userEmail.Split('@')[0] });
            
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
                await _chatCache.UpdateOnlineStatusAsync(userEmail, false, connectionId: Context.ConnectionId);
                var stillOnline = (await _chatCache.GetOnlineStatusesAsync())
                    .Any(u => string.Equals(u.Email, userEmail, StringComparison.OrdinalIgnoreCase));

                if (!stillOnline)
                {
                    await Clients.All.SendAsync("OnlineStatusChanged", new { Email = userEmail, IsOnline = false });
                    await Clients.Others.SendAsync("UserLeft", new { Email = userEmail });
                }
            }
            await base.OnDisconnectedAsync(exception);
        }

        public async Task GetChatContacts()
        {
            var userEmail = Context.User?.Identity?.Name;
            if (string.IsNullOrEmpty(userEmail)) return;

            await SendContactsToCallerAsync(userEmail, ResolveRole());
        }

        public async Task SendMessage(string receiverEmail, string message)
        {
            var senderEmail = Context.User?.Identity?.Name;
            if (string.IsNullOrEmpty(senderEmail) || string.IsNullOrEmpty(receiverEmail)) return;
            if (string.IsNullOrWhiteSpace(message)) return;

            await EnsureCanSendAsync(receiverEmail);

            var chatMessage = new ChatMessage
            {
                SenderEmail = senderEmail,
                ReceiverEmail = receiverEmail,
                Message = message.Trim(),
                Timestamp = DateTime.UtcNow,
                SentAt = DateTime.UtcNow,
                IsRead = false
            };

            await SaveAndBroadcastAsync(chatMessage);
        }

        public async Task SendFile(
            string receiverEmail,
            string fileName,
            string mimeType,
            long sizeBytes,
            string base64Data,
            string message)
        {
            var senderEmail = Context.User?.Identity?.Name;
            if (string.IsNullOrEmpty(senderEmail) || string.IsNullOrEmpty(receiverEmail)) return;
            if (string.IsNullOrWhiteSpace(fileName)) return;
            await EnsureCanSendAsync(receiverEmail);

            byte[] attachmentBytes;
            try
            {
                attachmentBytes = Convert.FromBase64String(base64Data ?? string.Empty);
            }
            catch (FormatException)
            {
                throw new HubException("Invalid file data.");
            }

            const int maxBytes = 5 * 1024 * 1024;
            if (attachmentBytes.Length == 0 || attachmentBytes.Length > maxBytes || sizeBytes > maxBytes)
            {
                throw new HubException("File too large or empty. Maximum size is 5MB.");
            }

            var now = DateTime.UtcNow;
            var chatMessage = new ChatMessage
            {
                SenderEmail = senderEmail,
                ReceiverEmail = receiverEmail,
                Message = message?.Trim() ?? string.Empty,
                Timestamp = now,
                SentAt = now,
                AttachmentName = fileName,
                AttachmentMime = string.IsNullOrWhiteSpace(mimeType) ? "application/octet-stream" : mimeType,
                AttachmentSizeBytes = sizeBytes,
                AttachmentData = attachmentBytes,
                AttachmentDataBase64 = Convert.ToBase64String(attachmentBytes),
                IsRead = false
            };

            await SaveAndBroadcastAsync(chatMessage);
        }

        public async Task GetChatHistory(string otherUserEmail)
        {
            var senderEmail = Context.User?.Identity?.Name ?? string.Empty;
            
            if (!string.IsNullOrEmpty(senderEmail) && !string.IsNullOrEmpty(otherUserEmail))
            {
                var history = await GetMergedHistoryAsync(senderEmail, otherUserEmail);
                await Clients.Caller.SendAsync("ChatHistory", history);
            }
        }

        public async Task MarkConversationSeen(string otherUserEmail)
        {
            var viewerEmail = Context.User?.Identity?.Name ?? string.Empty;

            if (string.IsNullOrEmpty(viewerEmail) || string.IsNullOrEmpty(otherUserEmail)) return;

            var history = await GetMergedHistoryAsync(viewerEmail, otherUserEmail);
            await MarkConversationSeenAsync(viewerEmail, otherUserEmail, history);
        }

        public async Task SetTyping(string receiverEmail, bool isTyping)
        {
            var senderEmail = Context.User?.Identity?.Name;
            if (string.IsNullOrEmpty(senderEmail) || string.IsNullOrEmpty(receiverEmail)) return;

            await EnsureCanSendAsync(receiverEmail);

            await Clients.Group($"private_{receiverEmail}").SendAsync("UserTyping", new
            {
                Sender = senderEmail,
                Receiver = receiverEmail,
                IsTyping = isTyping
            });
        }

        private async Task SaveAndBroadcastAsync(ChatMessage chatMessage)
        {
            var userRole = ResolveRole();
            var displayName = chatMessage.SenderEmail.Split('@')[0].Replace(".", " ");
            chatMessage.SentAt = chatMessage.SentAt == default ? DateTime.UtcNow : chatMessage.SentAt;
            chatMessage.Timestamp = chatMessage.Timestamp == default ? chatMessage.SentAt : chatMessage.Timestamp;

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureChatSchemaAsync(conn);

                using var cmd = new NpgsqlCommand(@"
                    INSERT INTO chat_messages (
                        sender_email,
                        receiver_email,
                        message,
                        timestamp,
                        sent_at,
                        is_read,
                        attachment_name,
                        attachment_mime,
                        attachment_size_bytes,
                        attachment_data
                    )
                    VALUES (
                        @sender,
                        @receiver,
                        @msg,
                        @ts,
                        @sentAt,
                        false,
                        @attachmentName,
                        @attachmentMime,
                        @attachmentSizeBytes,
                        @attachmentData
                    )
                    RETURNING id, delivered_at, seen_at;", conn);
                cmd.Parameters.AddWithValue("sender", chatMessage.SenderEmail);
                cmd.Parameters.AddWithValue("receiver", chatMessage.ReceiverEmail);
                cmd.Parameters.AddWithValue("msg", _encryption.Encrypt(chatMessage.Message));
                cmd.Parameters.AddWithValue("ts", chatMessage.Timestamp);
                cmd.Parameters.AddWithValue("sentAt", chatMessage.SentAt);
                cmd.Parameters.Add("attachmentName", NpgsqlDbType.Varchar).Value = (object?)chatMessage.AttachmentName ?? DBNull.Value;
                cmd.Parameters.Add("attachmentMime", NpgsqlDbType.Varchar).Value = (object?)chatMessage.AttachmentMime ?? DBNull.Value;
                cmd.Parameters.Add("attachmentSizeBytes", NpgsqlDbType.Bigint).Value = (object?)chatMessage.AttachmentSizeBytes ?? DBNull.Value;
                cmd.Parameters.Add("attachmentData", NpgsqlDbType.Bytea).Value = (object?)chatMessage.AttachmentData ?? DBNull.Value;

                using var reader = await cmd.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    chatMessage.Id = reader.GetInt32(0);
                    chatMessage.DeliveredAt = reader.IsDBNull(1) ? null : reader.GetDateTime(1);
                    chatMessage.SeenAt = reader.IsDBNull(2) ? null : reader.GetDateTime(2);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Chat message was not persisted to the database. Realtime delivery will continue from cache.");
            }

            await MarkDeliveredIfReceiverOnlineAsync(chatMessage);
            await _chatCache.SaveMessageAsync(chatMessage);

            var payload = new 
            { 
                MessageId = chatMessage.Id,
                Sender = chatMessage.SenderEmail, 
                Receiver = chatMessage.ReceiverEmail,
                SenderName = displayName,
                Role = userRole,
                Message = chatMessage.Message, 
                Text = chatMessage.Message,
                Timestamp = chatMessage.SentAt,
                SentAt = chatMessage.SentAt,
                DeliveredAt = chatMessage.DeliveredAt,
                SeenAt = chatMessage.SeenAt,
                chatMessage.AttachmentName,
                chatMessage.AttachmentMime,
                chatMessage.AttachmentSizeBytes,
                AttachmentDataBase64 = chatMessage.AttachmentDataBase64
            };
            await Clients.Groups(new List<string> { $"private_{chatMessage.ReceiverEmail}", $"private_{chatMessage.SenderEmail}" }).SendAsync("ReceiveMessage", payload);

            if (chatMessage.Id > 0 && chatMessage.DeliveredAt is not null)
            {
                await Clients.Group($"private_{chatMessage.SenderEmail}").SendAsync("MessageDelivered", new
                {
                    MessageId = chatMessage.Id,
                    DeliveredAt = chatMessage.DeliveredAt
                });
            }
        }

        private async Task MarkDeliveredIfReceiverOnlineAsync(ChatMessage chatMessage)
        {
            var onlineUsers = await _chatCache.GetOnlineStatusesAsync();
            var receiverOnline = onlineUsers.Any(u =>
                string.Equals(u.Email, chatMessage.ReceiverEmail, StringComparison.OrdinalIgnoreCase));

            if (!receiverOnline) return;

            chatMessage.DeliveredAt = DateTime.UtcNow;

            if (chatMessage.Id <= 0) return;

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureChatSchemaAsync(conn);

                using var cmd = new NpgsqlCommand(@"
                    UPDATE chat_messages
                    SET delivered_at = COALESCE(delivered_at, @deliveredAt)
                    WHERE id = @id;", conn);
                cmd.Parameters.AddWithValue("deliveredAt", chatMessage.DeliveredAt);
                cmd.Parameters.AddWithValue("id", chatMessage.Id);
                await cmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to mark chat message as delivered.");
            }
        }

        private async Task<List<ChatMessage>> GetMergedHistoryAsync(string userEmail, string otherUserEmail)
        {
            var byId = new Dictionary<int, ChatMessage>();
            var cacheHistory = await _chatCache.GetHistoryAsync(userEmail, otherUserEmail);

            foreach (var message in cacheHistory)
            {
                if (message.Id > 0)
                {
                    byId[message.Id] = message;
                }
            }

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureChatSchemaAsync(conn);

                using var cmd = new NpgsqlCommand(@"
                    SELECT
                        id,
                        sender_email,
                        receiver_email,
                        message,
                        COALESCE(sent_at, timestamp) AS sent_at,
                        delivered_at,
                        seen_at,
                        is_read,
                        attachment_name,
                        attachment_mime,
                        attachment_size_bytes,
                        attachment_data
                    FROM chat_messages
                    WHERE (
                        (LOWER(sender_email) = LOWER(@userEmail) AND LOWER(receiver_email) = LOWER(@otherUserEmail))
                        OR
                        (LOWER(sender_email) = LOWER(@otherUserEmail) AND LOWER(receiver_email) = LOWER(@userEmail))
                    )
                    AND COALESCE(sent_at, timestamp) >= @cutoff
                    ORDER BY COALESCE(sent_at, timestamp) ASC;", conn);
                cmd.Parameters.AddWithValue("userEmail", userEmail);
                cmd.Parameters.AddWithValue("otherUserEmail", otherUserEmail);
                cmd.Parameters.AddWithValue("cutoff", DateTime.UtcNow.Subtract(DatabaseHistoryDuration));

                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    var id = reader.GetInt32(0);
                    var message = new ChatMessage
                    {
                        Id = id,
                        SenderEmail = reader.GetString(1),
                        ReceiverEmail = reader.GetString(2),
                        SentAt = reader.GetDateTime(4),
                        Timestamp = reader.GetDateTime(4),
                        DeliveredAt = reader.IsDBNull(5) ? null : reader.GetDateTime(5),
                        SeenAt = reader.IsDBNull(6) ? null : reader.GetDateTime(6),
                        IsRead = !reader.IsDBNull(7) && reader.GetBoolean(7),
                        AttachmentName = reader.IsDBNull(8) ? null : reader.GetString(8),
                        AttachmentMime = reader.IsDBNull(9) ? null : reader.GetString(9),
                        AttachmentSizeBytes = reader.IsDBNull(10) ? null : reader.GetInt64(10),
                        AttachmentDataBase64 = reader.IsDBNull(11) ? null : Convert.ToBase64String((byte[])reader[11])
                    };

                    try
                    {
                        message.Message = _encryption.Decrypt(reader.GetString(3));
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Skipping chat message {MessageId} because it could not be decrypted.", id);
                        continue;
                    }

                    byId[id] = message;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to load chat history from the database. Returning cache history only.");
            }

            foreach (var message in cacheHistory.Where(m => m.Id <= 0))
            {
                byId[message.GetHashCode()] = message;
            }

            return byId.Values
                .OrderBy(m => m.SentAt == default ? m.Timestamp : m.SentAt)
                .ToList();
        }

        private async Task MarkConversationSeenAsync(string viewerEmail, string otherUserEmail, List<ChatMessage> history)
        {
            var seenAt = DateTime.UtcNow;
            var messageIds = history
                .Where(m =>
                    m.Id > 0 &&
                    string.Equals(m.SenderEmail, otherUserEmail, StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(m.ReceiverEmail, viewerEmail, StringComparison.OrdinalIgnoreCase) &&
                    m.SeenAt is null)
                .Select(m => m.Id)
                .ToArray();

            if (messageIds.Length == 0) return;

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureChatSchemaAsync(conn);

                using var cmd = new NpgsqlCommand(@"
                    UPDATE chat_messages
                    SET seen_at = COALESCE(seen_at, @seenAt),
                        delivered_at = COALESCE(delivered_at, @seenAt),
                        is_read = true
                    WHERE id = ANY(@ids);", conn);
                cmd.Parameters.AddWithValue("seenAt", seenAt);
                cmd.Parameters.AddWithValue("ids", messageIds);
                await cmd.ExecuteNonQueryAsync();

                foreach (var message in history.Where(m => messageIds.Contains(m.Id)))
                {
                    message.SeenAt = seenAt;
                    message.DeliveredAt ??= seenAt;
                    message.IsRead = true;
                    await Clients.Group($"private_{message.SenderEmail}").SendAsync("MessageSeen", new
                    {
                        MessageId = message.Id,
                        SeenAt = message.SeenAt,
                        DeliveredAt = message.DeliveredAt
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to mark chat messages as seen.");
            }
        }

        private static async Task EnsureChatSchemaAsync(NpgsqlConnection conn)
        {
            using var cmd = new NpgsqlCommand(@"
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id SERIAL PRIMARY KEY,
                    sender_email VARCHAR(100) NOT NULL,
                    receiver_email VARCHAR(100) NOT NULL,
                    message TEXT NOT NULL,
                    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    is_read BOOLEAN DEFAULT false,
                    attachment_name VARCHAR(255),
                    attachment_mime VARCHAR(100),
                    attachment_size_bytes BIGINT,
                    attachment_data BYTEA,
                    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    delivered_at TIMESTAMP WITH TIME ZONE,
                    seen_at TIMESTAMP WITH TIME ZONE
                );
                ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
                ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;
                ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255);
                ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_mime VARCHAR(100);
                ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_size_bytes BIGINT;
                ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_data BYTEA;
                ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
                ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE;
                ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS seen_at TIMESTAMP WITH TIME ZONE;
                ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_sender_email_fkey;
                ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_receiver_email_fkey;
                UPDATE chat_messages SET sent_at = COALESCE(sent_at, timestamp, CURRENT_TIMESTAMP) WHERE sent_at IS NULL;
                UPDATE chat_messages SET timestamp = COALESCE(timestamp, sent_at, CURRENT_TIMESTAMP) WHERE timestamp IS NULL;
                CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender_email);
                CREATE INDEX IF NOT EXISTS idx_chat_messages_receiver ON chat_messages(receiver_email);
                CREATE INDEX IF NOT EXISTS idx_chat_messages_sent_at ON chat_messages(sent_at);
                CREATE INDEX IF NOT EXISTS idx_chat_messages_pair_sent_at ON chat_messages(LOWER(sender_email), LOWER(receiver_email), sent_at);
                DELETE FROM chat_messages WHERE COALESCE(sent_at, timestamp) < NOW() - INTERVAL '30 days';", conn);
            await cmd.ExecuteNonQueryAsync();
        }

        private async Task SendContactsToCallerAsync(string userEmail, string viewerRole)
        {
            var onlineUsers = await _chatCache.GetOnlineStatusesAsync();
            var onlineByEmail = onlineUsers.ToDictionary(u => u.Email, StringComparer.OrdinalIgnoreCase);
            var contacts = new List<ChatUserStatus>();

            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureChatSchemaAsync(conn);

                using var cmd = new NpgsqlCommand(@"
                    SELECT
                        u.email,
                        u.role,
                        COALESCE(sp.full_name, fp.full_name, ap.full_name, split_part(u.email, '@', 1)) AS full_name,
                        EXISTS (
                            SELECT 1
                            FROM chat_messages cm
                            WHERE (
                                (LOWER(cm.sender_email) = LOWER(@userEmail) AND LOWER(cm.receiver_email) = LOWER(u.email))
                                OR
                                (LOWER(cm.sender_email) = LOWER(u.email) AND LOWER(cm.receiver_email) = LOWER(@userEmail))
                            )
                            AND COALESCE(cm.sent_at, cm.timestamp) >= NOW() - INTERVAL '30 days'
                        ) AS has_conversation
                    FROM users u
                    LEFT JOIN studentprofiles sp ON sp.user_id = u.id
                    LEFT JOIN facultyprofiles fp ON fp.user_id = u.id
                    LEFT JOIN adminprofiles ap ON ap.user_id = u.id
                    WHERE LOWER(u.email) <> LOWER(@userEmail)
                      AND LOWER(u.status) = 'approved'
                    ORDER BY full_name, u.email;", conn);
                cmd.Parameters.AddWithValue("userEmail", userEmail);

                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    var email = reader.GetString(0);
                    var role = reader.GetString(1);
                    var hasConversation = reader.GetBoolean(3);

                    if (!IsAllowedChatTarget(viewerRole, role) && !hasConversation) continue;

                    var isOnline = onlineByEmail.TryGetValue(email, out var onlineStatus);
                    contacts.Add(new ChatUserStatus
                    {
                        Email = email,
                        Role = role,
                        FullName = reader.IsDBNull(2) ? email.Split('@')[0] : reader.GetString(2),
                        IsOnline = isOnline,
                        LastSeen = isOnline ? onlineStatus!.LastSeen : DateTime.MinValue,
                        HasConversation = hasConversation
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to load chat contacts from database. Returning online contacts only.");
                contacts.AddRange(onlineUsers.Where(u =>
                    !string.Equals(u.Email, userEmail, StringComparison.OrdinalIgnoreCase) &&
                    IsAllowedChatTarget(viewerRole, u.Role)));
            }

            await Clients.Caller.SendAsync("ChatContacts", contacts);
        }

        private async Task EnsureCanSendAsync(string receiverEmail)
        {
            var senderRole = ResolveRole();
            var receiverRole = await GetUserRoleAsync(receiverEmail);

            if (string.IsNullOrEmpty(receiverRole))
            {
                throw new HubException("The selected chat user does not exist.");
            }

            if (!IsAllowedChatTarget(senderRole, receiverRole))
            {
                throw new HubException("You are not allowed to send messages to this user.");
            }
        }

        private async Task<string> GetUserRoleAsync(string email)
        {
            try
            {
                using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                using var cmd = new NpgsqlCommand("SELECT role FROM users WHERE LOWER(email) = LOWER(@email) AND LOWER(status) = 'approved' LIMIT 1;", conn);
                cmd.Parameters.AddWithValue("email", email);
                return (await cmd.ExecuteScalarAsync())?.ToString() ?? string.Empty;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to resolve chat receiver role for {Email}.", email);
                return string.Empty;
            }
        }

        private static bool IsAllowedChatTarget(string viewerRole, string targetRole)
        {
            var viewer = NormalizeRole(viewerRole);
            var target = NormalizeRole(targetRole);

            if (viewer == "faculty") return target == "registrar" || target == "department_admin" || target == "faculty";
            if (viewer == "department_admin") return target == "registrar" || target == "faculty";
            if (viewer == "registrar") return target == "department_admin" || target == "faculty" || target == "student";
            return target == "registrar";
        }

        private static string NormalizeRole(string? role)
        {
            var value = (role ?? string.Empty).ToLowerInvariant();
            if (value.Contains("registrar")) return "registrar";
            if (value.Contains("faculty")) return "faculty";
            if (value.Contains("deptadmin") || value.Contains("dept_admin") || value.Contains("department_admin") || value.Contains("department admin") || value.Contains("admin")) return "department_admin";
            return "student";
        }

        private string ResolveRole(string? providedRole = null)
        {
            return Context.User?.FindFirst("dbRole")?.Value
                ?? Context.User?.FindFirst(ClaimTypes.Role)?.Value
                ?? providedRole
                ?? "student";
        }

        private async Task UpdateOnlineStatus(string email, bool isOnline, string role = "")
        {
            await _chatCache.UpdateOnlineStatusAsync(email, isOnline, role, email.Split('@')[0], Context.ConnectionId);
        }
    }
}
