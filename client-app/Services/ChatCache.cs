using Microsoft.Extensions.Caching.Memory;
using Client_app.Models;
using Client_app.Services;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Client_app.Services
{
    public class ChatCache : IChatCache
    {
        private readonly IMemoryCache _cache;
        private readonly MemoryCacheEntryOptions _oneYearOptions;
        private const string HistoryKeyPrefix = "chat_history_";
        private const string OnlineStatusesKey = "online_statuses";
        private static readonly TimeSpan OneYear = TimeSpan.FromDays(365);

        public ChatCache(IMemoryCache cache)
        {
            _cache = cache;
            _oneYearOptions = new MemoryCacheEntryOptions()
            {
                AbsoluteExpirationRelativeToNow = OneYear,
                Priority = CacheItemPriority.Normal
            };
        }

        public async Task SaveMessageAsync(ChatMessage message)
        {
            // Bidirectional key: sorted pair
            var key1 = GetHistoryKey(message.SenderEmail, message.ReceiverEmail);
            var key2 = GetHistoryKey(message.ReceiverEmail, message.SenderEmail);

            // Get or create lists
            var list1 = _cache.Get<List<ChatMessage>>(key1) ?? new List<ChatMessage>();
            var list2 = _cache.Get<List<ChatMessage>>(key1) ?? new List<ChatMessage>();

            list1.Add(message);
            list2.Add(message);

            // Limit to 5000 messages per pair (heavy caching)
            if (list1.Count > 5000) list1 = list1.Skip(list1.Count - 5000).ToList();
            if (list2.Count > 5000) list2 = list2.Skip(list2.Count - 5000).ToList();

            _cache.Set(key1, list1, _oneYearOptions);
            _cache.Set(key2, list2, _oneYearOptions);
        }

        public async Task<List<ChatMessage>> GetHistoryAsync(string user1, string user2)
        {
            var key = GetHistoryKey(user1, user2);
            return _cache.Get<List<ChatMessage>>(key) ?? new List<ChatMessage>();
        }

        public async Task UpdateOnlineStatusAsync(string email, bool isOnline, string role = "", string fullName = "")
        {
            var statuses = _cache.Get<ConcurrentDictionary<string, ChatUserStatus>>(OnlineStatusesKey) 
                          ?? new ConcurrentDictionary<string, ChatUserStatus>();

            var status = new ChatUserStatus
            {
                Email = email,
                IsOnline = isOnline,
                LastSeen = DateTime.UtcNow,
                Role = role,
                FullName = fullName
            };

            if (isOnline)
                statuses[email] = status;
            else
                statuses.TryRemove(email, out _);

            _cache.Set(OnlineStatusesKey, statuses, _oneYearOptions);
        }

        public async Task<List<ChatUserStatus>> GetOnlineStatusesAsync()
        {
            var statuses = _cache.Get<ConcurrentDictionary<string, ChatUserStatus>>(OnlineStatusesKey);
            return statuses?.Values.Where(s => s.IsOnline).ToList() ?? new List<ChatUserStatus>();
        }

        private static string GetHistoryKey(string u1, string u2)
        {
            var users = new[] { u1, u2 }.OrderBy(u => u).ToArray();
            return $"{HistoryKeyPrefix}{users[0]}_{users[1]}";
        }
    }
}

