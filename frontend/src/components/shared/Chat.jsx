import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as signalR from '@microsoft/signalr';
import { getChatHubUrl } from '../../services/api';
import { pullSharedClientState } from '../../utils/sharedClientState';

const roleKeyFromRoleString = (role) => {
  const r = (role || '').toLowerCase();
  if (r.includes('registrar')) return 'registrar';
  if (r.includes('faculty')) return 'faculty';
  if (
    r.includes('deptadmin') ||
    r.includes('dept_admin') ||
    r.includes('department_admin') ||
    r.includes('department admin') ||
    r.includes('admin')
  ) {
    return 'department_admin';
  }
  return 'student';
};

const displayNameForUser = (u) => {
  if (!u) return '';
  if (u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`.trim();
  return u.fullName || u.email || '';
};

const valueOf = (obj, ...keys) => {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
};

const isMimeTypeText = (text) =>
  /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:\s*;.*)?$/i.test(String(text || '').trim());

const getVisibleMessageText = (msg) => {
  const text = String(msg?.message || '').trim();
  const mime = String(msg?.attachmentMime || '').trim();

  if (!text) return '';
  if (mime && text.toLowerCase() === mime.toLowerCase()) return '';
  if (isMimeTypeText(text)) return '';

  return msg.message;
};

const normalizeUser = (user) => ({
  email: valueOf(user, 'email', 'Email') || '',
  role: valueOf(user, 'role', 'Role') || '',
  fullName: valueOf(user, 'fullName', 'FullName') || '',
  firstName: valueOf(user, 'firstName', 'FirstName') || '',
  lastName: valueOf(user, 'lastName', 'LastName') || '',
  isOnline: Boolean(valueOf(user, 'isOnline', 'IsOnline')),
  hasConversation: Boolean(valueOf(user, 'hasConversation', 'HasConversation')),
});

const normalizeMessage = (payload) => {
  const normalized = {
    id: valueOf(payload, 'messageId', 'MessageId', 'id', 'Id'),
    sender: valueOf(payload, 'sender', 'Sender', 'senderEmail', 'SenderEmail'),
    receiver: valueOf(payload, 'receiver', 'Receiver', 'receiverEmail', 'ReceiverEmail'),
    message: valueOf(payload, 'message', 'Message', 'text', 'Text') || '',
    sentAt: valueOf(payload, 'sentAt', 'SentAt', 'timestamp', 'Timestamp'),
    deliveredAt: valueOf(payload, 'deliveredAt', 'DeliveredAt') || null,
    seenAt: valueOf(payload, 'seenAt', 'SeenAt') || null,
    timestamp: valueOf(payload, 'sentAt', 'SentAt', 'timestamp', 'Timestamp'),
    attachmentName: valueOf(payload, 'attachmentName', 'AttachmentName'),
    attachmentMime: valueOf(payload, 'attachmentMime', 'AttachmentMime'),
    attachmentSizeBytes: valueOf(payload, 'attachmentSizeBytes', 'AttachmentSizeBytes'),
    attachmentDataBase64: valueOf(payload, 'attachmentDataBase64', 'AttachmentDataBase64'),
    receivedAt: valueOf(payload, 'receivedAt', 'ReceivedAt') || Date.now(),
  };

  normalized.message = getVisibleMessageText(normalized);

  if (!normalized.id) {
    normalized.id = [
      normalized.sender,
      normalized.receiver,
      normalized.sentAt || normalized.timestamp,
      normalized.message,
      normalized.attachmentName || '',
    ].join('|');
  }

  return normalized;
};

const isSameMessage = (a, b) => {
  if (!a?.id || !b?.id) return false;
  return String(a.id) === String(b.id);
};

const getMessageTimeMs = (message) => {
  const raw = message?.sentAt || message?.timestamp || message?.receivedAt;
  if (!raw) return null;
  const time = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  if (Number.isFinite(time)) return time;
  const fallbackTime = Number(raw);
  return Number.isFinite(fallbackTime) ? fallbackTime : null;
};

const sortMessagesOldestFirst = (list) =>
  [...list]
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const timeA = getMessageTimeMs(a.message);
      const timeB = getMessageTimeMs(b.message);

      if (timeA !== null && timeB !== null && timeA !== timeB) return timeA - timeB;

      const idA = Number(a.message?.id);
      const idB = Number(b.message?.id);
      if (Number.isFinite(idA) && Number.isFinite(idB) && idA !== idB) return idA - idB;

      return a.index - b.index;
    })
    .map(({ message }) => message);

const messageRenderKey = (msg, fallback) =>
  String(msg?.id || `${msg?.sender || 'unknown'}-${msg?.receiver || 'unknown'}-${msg?.sentAt || msg?.timestamp || fallback}`);

const mergeMessages = (existing, incoming) => {
  const merged = [...existing];
  for (const message of incoming) {
    const index = merged.findIndex((item) => isSameMessage(item, message));
    if (index >= 0) {
      merged[index] = { ...merged[index], ...message };
    } else {
      merged.push(message);
    }
  }
  return sortMessagesOldestFirst(merged);
};

const isConversationMessage = (msg, userEmail, otherEmail) =>
  (msg.sender === userEmail && msg.receiver === otherEmail) ||
  (msg.sender === otherEmail && msg.receiver === userEmail);

const isImageAttachment = (msg) => {
  const mime = (msg?.attachmentMime || '').toLowerCase();
  const name = (msg?.attachmentName || '').toLowerCase();
  return (
    mime.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|tiff?|heic|heif)$/i.test(name)
  );
};

const inferImageMime = (fileName = '') => {
  const name = fileName.toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.bmp')) return 'image/bmp';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  if (name.endsWith('.avif')) return 'image/avif';
  if (name.endsWith('.ico')) return 'image/x-icon';
  if (name.endsWith('.tif') || name.endsWith('.tiff')) return 'image/tiff';
  if (name.endsWith('.heic')) return 'image/heic';
  if (name.endsWith('.heif')) return 'image/heif';
  return 'image/png';
};

const imageSrcForMessage = (msg) => {
  if (!msg?.attachmentDataBase64) return '';
  return `data:${msg.attachmentMime || inferImageMime(msg.attachmentName)};base64,${msg.attachmentDataBase64}`;
};

const TypingIndicator = () => (
  <div className="mb-3 flex w-full items-start">
    <div className="relative rounded-2xl rounded-bl-none bg-slate-100 px-4 py-3 shadow-sm">
      <div className="absolute -left-2 bottom-2 h-0 w-0 border-y-[8px] border-r-[10px] border-y-transparent border-r-slate-100" />
      <div className="flex h-5 items-center gap-1" aria-label="Typing">
        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-500" style={{ animationDelay: '0ms' }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-500" style={{ animationDelay: '120ms' }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-500" style={{ animationDelay: '240ms' }} />
      </div>
    </div>
  </div>
);

const Chat = ({
  userEmail,
  userRole,
  onClose,
  isOpen = true,
  onUnreadChange,
  onIncomingMessage,
  onRegistrationRequest,
  autoOpenTarget,
}) => {
  const [connection, setConnection] = useState(null);
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [openChatUsers, setOpenChatUsers] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [conversationDrafts, setConversationDrafts] = useState({});

  const [onlineSearch, setOnlineSearch] = useState('');
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const [chatBoxWidth, setChatBoxWidth] = useState(400);
  const [chatBoxHeight, setChatBoxHeight] = useState(500);
  const [dragState, setDragState] = useState(null);

  const [latestActivity, setLatestActivity] = useState({});
  const [unreadCounts, setUnreadCounts] = useState({});
  const [imagePreview, setImagePreview] = useState(null);
  const [typingUsers, setTypingUsers] = useState({});

  const messagesEndRef = useRef(null);
  const secondaryMessagesRef = useRef(null);
  const connectionRef = useRef(null);
  const selectedUserRef = useRef(selectedUser);
  const openChatUsersRef = useRef(openChatUsers);
  const historyTargetRef = useRef('');
  const isOpenRef = useRef(isOpen);
  const seenRequestRef = useRef({});
  const typingHideTimersRef = useRef({});
  const typingStopTimersRef = useRef({});
  const typingLastSentRef = useRef({});

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  useEffect(() => {
    const hideTimers = typingHideTimersRef.current;
    const stopTimers = typingStopTimersRef.current;

    return () => {
      Object.values(hideTimers).forEach(window.clearTimeout);
      Object.values(stopTimers).forEach(window.clearTimeout);
    };
  }, []);

  const isConversationReadable = useCallback((targetEmail) =>
    Boolean(
      targetEmail &&
        isOpenRef.current &&
        openChatUsersRef.current.includes(targetEmail) &&
        document.visibilityState !== 'hidden'
    ), []);

  const markConversationSeen = useCallback((targetEmail, activeConnection = connectionRef.current) => {
    if (!activeConnection || !isConversationReadable(targetEmail)) return;

    const now = Date.now();
    if (now - (seenRequestRef.current[targetEmail] || 0) < 1200) return;
    seenRequestRef.current[targetEmail] = now;

    activeConnection
      .invoke('MarkConversationSeen', targetEmail)
      .catch((e) => console.error('[Chat] MarkConversationSeen failed:', e));
  }, [isConversationReadable]);

  const sendTypingState = useCallback((recipientEmail, isTyping, activeConnection = connectionRef.current) => {
    if (!activeConnection || !recipientEmail) return;
    activeConnection
      .invoke('SetTyping', recipientEmail, Boolean(isTyping))
      .catch((e) => console.error('[Chat] SetTyping failed:', e));
  }, []);

  const stopTyping = useCallback((recipientEmail, activeConnection = connectionRef.current) => {
    if (!recipientEmail) return;
    window.clearTimeout(typingStopTimersRef.current[recipientEmail]);
    delete typingStopTimersRef.current[recipientEmail];
    typingLastSentRef.current[recipientEmail] = 0;
    sendTypingState(recipientEmail, false, activeConnection);
  }, [sendTypingState]);

  const updateTyping = useCallback((recipientEmail, value, activeConnection = connectionRef.current) => {
    if (!recipientEmail || !activeConnection) return;

    window.clearTimeout(typingStopTimersRef.current[recipientEmail]);

    if (!String(value || '').trim()) {
      stopTyping(recipientEmail, activeConnection);
      return;
    }

    const now = Date.now();
    if (now - (typingLastSentRef.current[recipientEmail] || 0) > 900) {
      typingLastSentRef.current[recipientEmail] = now;
      sendTypingState(recipientEmail, true, activeConnection);
    }

    typingStopTimersRef.current[recipientEmail] = window.setTimeout(() => {
      stopTyping(recipientEmail, activeConnection);
    }, 1500);
  }, [sendTypingState, stopTyping]);

  useEffect(() => {
    selectedUserRef.current = selectedUser;
    if (selectedUser && isOpenRef.current) setUnreadCounts((prev) => ({ ...prev, [selectedUser]: 0 }));
  }, [selectedUser]);

  useEffect(() => {
    openChatUsersRef.current = openChatUsers;
    if (isOpen && openChatUsers.length > 0) {
      setUnreadCounts((prev) => {
        const next = { ...prev };
        openChatUsers.forEach((email) => {
          next[email] = 0;
        });
        return next;
      });
    }
  }, [isOpen, openChatUsers]);

  useEffect(() => {
    const targetEmail = autoOpenTarget?.email;
    if (!targetEmail || targetEmail === userEmail) return;

    setSelectedUser(targetEmail);
    setNewMessage('');
    setMessageSearch('');
    setIsUserDropdownOpen(false);
    setOpenChatUsers((prev) => {
      const next = prev.filter((email) => email !== targetEmail);
      next.push(targetEmail);
      return next.slice(-2);
    });
  }, [autoOpenTarget, userEmail]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const scrollSecondaryToBottom = () => {
    if (!secondaryMessagesRef.current) return;
    secondaryMessagesRef.current.scrollTop = secondaryMessagesRef.current.scrollHeight;
  };

  // SignalR lifecycle
  useEffect(() => {
    const chatUrl = getChatHubUrl();
    const token = localStorage.getItem('token');

    const conn = new signalR.HubConnectionBuilder()
      .withUrl(chatUrl, { accessTokenFactory: () => token || '' })
      .withAutomaticReconnect()
      .build();

    conn.on('ReceiveMessage', (payload) => {
      console.log('[Chat] ReceiveMessage:', payload);
      const normalized = normalizeMessage(payload);
      const otherUser = normalized.sender === userEmail ? normalized.receiver : normalized.sender;

      setMessages((prev) => mergeMessages(prev, [normalized]));

      if (otherUser) {
        setLatestActivity((prev) => {
          const ts = normalized.sentAt || normalized.timestamp;
          return { ...prev, [otherUser]: new Date(ts).getTime() };
        });

        setOnlineUsers((prev) =>
          prev.map((u) => (u.email === otherUser ? { ...u, hasConversation: true } : u))
        );
      }

      if (normalized.sender !== userEmail) {
        onIncomingMessage?.({
          from: otherUser,
          message: normalized.message,
          attachmentName: normalized.attachmentName,
          sentAt: normalized.sentAt || normalized.timestamp,
        });
      }

      setUnreadCounts((prev) => {
        const shouldNotify = !isOpenRef.current || !openChatUsersRef.current.includes(otherUser);
        if (shouldNotify && normalized.sender !== userEmail) {
          return { ...prev, [otherUser]: (prev[otherUser] || 0) + 1 };
        }
        return prev;
      });

      if (normalized.sender !== userEmail && isConversationReadable(otherUser)) {
        window.setTimeout(() => markConversationSeen(otherUser, conn), 250);
      }
    });

    conn.on('ChatHistory', (history) => {
      console.log('[Chat] ChatHistory received:', history?.length, 'messages');
      if (!history || !Array.isArray(history)) {
        console.warn('[Chat] ChatHistory is not an array');
        return;
      }

      const activeUser = historyTargetRef.current || selectedUserRef.current;
      if (!activeUser) return;
      
      const mapped = (history || [])
        .map((m) => ({
          ...normalizeMessage(m),
        }))
        .filter((msg) => isConversationMessage(msg, userEmail, activeUser));
      
      setMessages((prev) => mergeMessages(prev, mapped));

      if (isConversationReadable(activeUser)) {
        window.setTimeout(() => markConversationSeen(activeUser, conn), 250);
      }
    });

    conn.on('NewRegistrationRequest', (payload) => {
      console.log('[Chat] NewRegistrationRequest:', payload);
      onRegistrationRequest?.(payload);
    });

    conn.on('SystemSettingChanged', (payload) => {
      console.log('[Chat] SystemSettingChanged:', payload);
      window.dispatchEvent(new CustomEvent('blockgo:system-setting-changed', { detail: payload }));
    });

    conn.on('AcademicDataChanged', (payload) => {
      console.log('[Chat] AcademicDataChanged:', payload);
      pullSharedClientState()
        .catch((error) => console.warn('[Chat] Shared state pull failed:', error))
        .finally(() => {
          window.dispatchEvent(new CustomEvent('blockgo:academic-data-changed', { detail: payload }));
        });
    });

    conn.on('ChatContacts', (contacts) => {
      if (!Array.isArray(contacts)) return;
      const normalizedContacts = contacts.map(normalizeUser).filter((u) => u.email);
      setOnlineUsers(normalizedContacts);
    });

    conn.on('UserJoined', (user) => {
      const normalized = normalizeUser(user);
      if (!normalized.email) return;
      console.log('[Chat] UserJoined:', normalized.email);
      setOnlineUsers((prev) => {
        if (prev.some((u) => u.email === normalized.email)) {
          return prev.map((u) => (u.email === normalized.email ? { ...u, ...normalized, isOnline: true } : u));
        }
        return [...prev, { ...normalized, isOnline: true }];
      });
    });

    conn.on('RequestRollCall', (targetEmail) => {
      console.log('[Chat] RequestRollCall for:', targetEmail);
      if (userEmail) conn.invoke('AnnouncePresence', targetEmail).catch(e => console.error('[Chat] AnnouncePresence failed:', e));
    });

    conn.on('UserLeft', (user) => {
      const normalized = normalizeUser(user);
      console.log('[Chat] UserLeft:', normalized.email);
      setOnlineUsers((prev) =>
        prev.map((u) => (u.email === normalized.email ? { ...u, isOnline: false } : u))
      );
    });

    conn.on('OnlineStatusChanged', (payload) => {
      const email = valueOf(payload, 'email', 'Email');
      const isOnline = Boolean(valueOf(payload, 'isOnline', 'IsOnline'));
      if (!email) return;
      setOnlineUsers((prev) =>
        prev.map((u) => (u.email === email ? { ...u, isOnline } : u))
      );
    });

    conn.on('MessageDelivered', (payload) => {
      const messageId = valueOf(payload, 'messageId', 'MessageId');
      const deliveredAt = valueOf(payload, 'deliveredAt', 'DeliveredAt');
      console.log('[Chat] MessageDelivered:', messageId);
      setMessages((prev) =>
        prev.map((m) => {
          if (String(m.id) !== String(messageId)) return m;
          return { ...m, deliveredAt };
        })
      );
    });

    conn.on('MessageSeen', (payload) => {
      const messageId = valueOf(payload, 'messageId', 'MessageId');
      const seenAt = valueOf(payload, 'seenAt', 'SeenAt');
      const deliveredAt = valueOf(payload, 'deliveredAt', 'DeliveredAt');
      console.log('[Chat] MessageSeen:', messageId);
      setMessages((prev) =>
        prev.map((m) => {
          if (String(m.id) !== String(messageId)) return m;
          return { ...m, seenAt, deliveredAt: deliveredAt ?? m.deliveredAt };
        })
      );
    });

    conn.on('UserTyping', (payload) => {
      const sender = valueOf(payload, 'sender', 'Sender');
      const receiver = valueOf(payload, 'receiver', 'Receiver');
      const isTyping = Boolean(valueOf(payload, 'isTyping', 'IsTyping'));
      if (
        !sender ||
        String(receiver || '').toLowerCase() !== String(userEmail || '').toLowerCase() ||
        String(sender || '').toLowerCase() === String(userEmail || '').toLowerCase()
      ) {
        return;
      }

      window.clearTimeout(typingHideTimersRef.current[sender]);

      if (!isTyping) {
        setTypingUsers((prev) => ({ ...prev, [sender]: false }));
        return;
      }

      setTypingUsers((prev) => ({ ...prev, [sender]: true }));
      typingHideTimersRef.current[sender] = window.setTimeout(() => {
        setTypingUsers((prev) => ({ ...prev, [sender]: false }));
      }, 3500);
    });

    conn.start()
      .then(() => {
        console.log('[Chat] Connected to SignalR');
        setConnection(conn);
        conn.invoke('JoinChat', userRole || '').catch(e => console.error('[Chat] JoinChat failed:', e));
        conn.invoke('GetChatContacts').catch(e => console.error('[Chat] GetChatContacts failed:', e));
        pullSharedClientState().catch((error) => console.warn('[Chat] Initial shared state pull failed:', error));
      })
      .catch((err) => console.error('SignalR connection failed:', err));

    conn.onreconnected(() => {
      conn.invoke('JoinChat', userRole || '').catch(e => console.error('[Chat] JoinChat after reconnect failed:', e));
      conn.invoke('GetChatContacts').catch(e => console.error('[Chat] GetChatContacts after reconnect failed:', e));
      if (selectedUserRef.current) {
        conn.invoke('GetChatHistory', selectedUserRef.current).catch(e => console.error('[Chat] GetChatHistory after reconnect failed:', e));
      }
    });

    return () => {
      setConnection(null);
      conn.stop();
    };
  }, [userEmail, userRole, onIncomingMessage, onRegistrationRequest, isConversationReadable, markConversationSeen]);

  // Load history when selected user changes
  useEffect(() => {
    if (connection && selectedUser) {
      console.log('[Chat] Loading history with:', selectedUser);
      historyTargetRef.current = selectedUser;
      connection.invoke('GetChatHistory', selectedUser).catch(e => console.error('[Chat] GetChatHistory failed:', e));
    }
  }, [connection, selectedUser]);

  useEffect(() => {
    if (!connection || !isOpen || document.visibilityState === 'hidden') return;

    const visibleIncoming = openChatUsers.filter((email) =>
      messages.some(
        (msg) =>
          msg.sender === email &&
          msg.receiver === userEmail &&
          !msg.seenAt &&
          isConversationMessage(msg, userEmail, email)
      )
    );

    visibleIncoming.forEach((email) => markConversationSeen(email));
  }, [connection, isOpen, messages, openChatUsers, userEmail, markConversationSeen]);

  useEffect(() => {
    if (!connection) return undefined;

    const markOpenConversations = () => {
      if (document.visibilityState === 'hidden') return;
      openChatUsersRef.current.forEach((email) => markConversationSeen(email));
    };

    window.addEventListener('focus', markOpenConversations);
    document.addEventListener('visibilitychange', markOpenConversations);

    return () => {
      window.removeEventListener('focus', markOpenConversations);
      document.removeEventListener('visibilitychange', markOpenConversations);
    };
  }, [connection, markConversationSeen]);

  const selectedUserTyping = selectedUser ? typingUsers[selectedUser] : false;

  // Scroll
  useEffect(() => {
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, selectedUser, selectedUserTyping]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(scrollSecondaryToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, openChatUsers, typingUsers]);

  useEffect(() => {
    const totalUnread = Object.values(unreadCounts).reduce((total, count) => total + Number(count || 0), 0);
    onUnreadChange?.(totalUnread, unreadCounts);
  }, [unreadCounts, onUnreadChange]);

  const sortedOnlineUsers = useMemo(() => {
    return [...onlineUsers].sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      const timeA = latestActivity[a.email] || 0;
      const timeB = latestActivity[b.email] || 0;
      if (timeA !== timeB) return timeB - timeA;
      return displayNameForUser(a).localeCompare(displayNameForUser(b));
    });
  }, [onlineUsers, latestActivity]);

  const allowedTargetsByViewer = (viewerKey) => {
    if (viewerKey === 'faculty') return new Set(['registrar', 'department_admin', 'faculty']);
    if (viewerKey === 'department_admin') return new Set(['registrar', 'faculty']);
    if (viewerKey === 'registrar') return new Set(['department_admin', 'faculty', 'student']);
    return new Set(['registrar']);
  };

  const viewerKey = roleKeyFromRoleString(userRole);
  const allowedTargets = allowedTargetsByViewer(viewerKey);

  const onlineCandidates = useMemo(() => {
    const q = onlineSearch.trim().toLowerCase();
    return sortedOnlineUsers
      .filter((u) => u.email !== userEmail)
      .filter((u) => allowedTargets.has(roleKeyFromRoleString(u.role || '')))
      .filter((u) => {
        if (!q) return true;
        return displayNameForUser(u).toLowerCase().includes(q);
      });
  }, [sortedOnlineUsers, userEmail, onlineSearch, allowedTargets]);

  const grouped = useMemo(() => {
    const buckets = {
      department_admin: [],
      faculty: [],
      student: [],
      registrar: [],
    };
    for (const u of onlineCandidates) {
      const rk = roleKeyFromRoleString(u.role || '');
      const key = rk;
      if (buckets[key]) buckets[key].push(u);
    }
    return buckets;
  }, [onlineCandidates]);

  const allowedGroupOrder = useMemo(() => {
    return ['department_admin', 'faculty', 'student', 'registrar'].filter((k) => {
      const setHas = allowedTargets.has(k);
      return setHas;
    });
  }, [allowedTargets]);

  const filteredMessages = useMemo(() => {
    if (!selectedUser) return [];

    const inChat = sortMessagesOldestFirst(
      messages.filter((msg) => isConversationMessage(msg, userEmail, selectedUser))
    );

    if (!isSearching || !messageSearch.trim()) return inChat;

    const q = messageSearch.toLowerCase();
    return inChat.filter((m) => {
      const text = (m.message || '').toLowerCase();
      const fileName = (m.attachmentName || '').toLowerCase();
      return text.includes(q) || fileName.includes(q);
    });
  }, [messages, userEmail, selectedUser, isSearching, messageSearch]);

  const getConversationMessages = (email) => {
    if (!email) return [];
    return sortMessagesOldestFirst(
      messages.filter(
        (msg) =>
          (msg.sender === userEmail && msg.receiver === email) ||
          (msg.sender === email && msg.receiver === userEmail)
      )
    );
  };

  const sendMessageTo = async (recipientEmail, draftValue, clearDraft) => {
    if (draftValue.trim() && connection && recipientEmail) {
      const msgText = draftValue.trim();
      clearDraft();
      stopTyping(recipientEmail);
      connection.invoke('SendMessage', recipientEmail, msgText).catch(e => console.error('[Chat] SendMessage failed:', e));
    }
  };

  const sendMessage = async () => sendMessageTo(selectedUser, newMessage, () => setNewMessage(''));

  const handlePickFile = () => fileInputRef.current?.click();
  const fileInputRef = useRef(null);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!selectedUser || !connection) return;

    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      alert('File too large (max 5MB)');
      return;
    }

    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.onload = () => {
        const result = reader.result;
        const b64 = typeof result === 'string' ? result.split(',')[1] : '';
        resolve(b64);
      };
      reader.readAsDataURL(file);
    });

    try {
      await connection.invoke(
        'SendFile',
        selectedUser,
        file.name,
        file.type || 'application/octet-stream',
        file.size,
        base64,
        ''
      );
    } catch (err) {
      console.error('[Chat] SendFile failed:', err);
      alert(err?.message || 'File could not be sent.');
    }
  };

  const downloadAttachment = (msg) => {
    if (!msg.attachmentDataBase64) return;

    try {
      const byteCharacters = atob(msg.attachmentDataBase64);
      const byteNumbers = Array.from(byteCharacters, (char) => char.charCodeAt(0));
      const blob = new Blob([new Uint8Array(byteNumbers)], {
        type: msg.attachmentMime || 'application/octet-stream',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = msg.attachmentName || 'attachment';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Chat] Failed to download attachment:', err);
      alert('Attachment could not be downloaded.');
    }
  };

  const onResizeMouseDown = (e) => {
    e.preventDefault();
    setDragState({
      startX: e.clientX,
      startY: e.clientY,
      startW: chatBoxWidth,
      startH: chatBoxHeight,
    });
  };

  useEffect(() => {
    if (!dragState) return;

    const onMouseMove = (e) => {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      const newW = Math.min(720, Math.max(320, dragState.startW + dx));
      const newH = Math.min(900, Math.max(380, dragState.startH + dy));
      setChatBoxWidth(newW);
      setChatBoxHeight(newH);
    };

    const onMouseUp = () => setDragState(null);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragState]);

  const otherCount = useMemo(() => {
    return onlineCandidates.length;
  }, [onlineCandidates]);

  const [facultyTypeFilters, setFacultyTypeFilters] = useState({
    registrar: true,
    department_admin: true,
    faculty: true,
  });

  useEffect(() => {
    setFacultyTypeFilters({ registrar: true, department_admin: true, faculty: true });
  }, [viewerKey]);

  const filteredGroupsForUI = useMemo(() => {
    if (viewerKey !== 'faculty') return grouped;

    return {
      ...grouped,
      registrar: facultyTypeFilters.registrar ? grouped.registrar : [],
      department_admin: facultyTypeFilters.department_admin ? grouped.department_admin : [],
      faculty: facultyTypeFilters.faculty ? grouped.faculty : [],
    };
  }, [viewerKey, grouped, facultyTypeFilters]);

  const groupTitle = (key) => {
    if (key === 'department_admin') return 'Department Admins';
    if (key === 'faculty') return 'Faculties';
    if (key === 'student') return 'Students';
    if (key === 'registrar') return 'Registrar';
    return key;
  };

  const hasVisibleContacts = allowedGroupOrder.some((key) => (filteredGroupsForUI[key] || []).length > 0);

  const selectedUserDetails = useMemo(
    () => onlineUsers.find((u) => u.email === selectedUser),
    [onlineUsers, selectedUser]
  );

  const selectedUserName = selectedUserDetails ? displayNameForUser(selectedUserDetails) : selectedUser;
  const getNameForEmail = (email) => {
    const user = onlineUsers.find((u) => u.email === email);
    return user ? displayNameForUser(user) : email;
  };

  const secondaryChatUsers = openChatUsers.filter((email) => email && email !== selectedUser).slice(0, 1);

  const totalOnlineUsers = useMemo(() => {
    return onlineUsers.filter((u) => u.email !== userEmail && u.isOnline).length;
  }, [onlineUsers, userEmail]);

  const selectRecipient = (email) => {
    if (selectedUser && selectedUser !== email) stopTyping(selectedUser);
    setSelectedUser(email);
    setNewMessage('');
    setMessageSearch('');
    setIsUserDropdownOpen(false);
    setOpenChatUsers((prev) => {
      const next = prev.filter((item) => item !== email);
      next.push(email);
      return next.slice(-2);
    });
  };

  const closeConversation = (email) => {
    stopTyping(email);
    setOpenChatUsers((prev) => {
      const next = prev.filter((item) => item !== email);
      const fallback = next[next.length - 1] || '';
      setSelectedUser(fallback);
      if (next.length === 0) {
        window.setTimeout(() => onClose?.(), 0);
      }
      return next;
    });
    setNewMessage('');
    setMessageSearch('');
    setConversationDrafts((prev) => {
      const next = { ...prev };
      delete next[email];
      return next;
    });
    if (historyTargetRef.current === email) historyTargetRef.current = '';
  };

  const clearRecipient = () => {
    if (selectedUser) {
      closeConversation(selectedUser);
      return;
    }
    setSelectedUser('');
    setNewMessage('');
    setMessageSearch('');
    historyTargetRef.current = '';
  };

  const closeAllChatWindows = () => {
    openChatUsers.forEach((email) => stopTyping(email));
    setOpenChatUsers([]);
    setSelectedUser('');
    setNewMessage('');
    setMessageSearch('');
    setConversationDrafts({});
    historyTargetRef.current = '';
    onClose?.();
  };

  if (!isOpen) return null;

  return (
    <>
    <div
      className="fixed bottom-5 right-5 z-[1000] flex flex-col rounded-2xl bg-white font-sans shadow-2xl overflow-hidden"
      style={{ width: chatBoxWidth, height: chatBoxHeight }}
    >
      <div className="relative flex items-center justify-between border-b border-slate-200 p-5">
        <div>
          <h3 className="m-0 text-lg font-bold text-[#003366]">Chat</h3>
          <div className="mt-1 text-xs font-semibold text-slate-500">{totalOnlineUsers} users online</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsSearching((v) => !v)}
            className="cursor-pointer rounded-full p-2 text-sm font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            title="Search messages"
          >
            <span aria-hidden>Search</span>
          </button>
          <button onClick={closeAllChatWindows} className="cursor-pointer text-2xl leading-none text-slate-400 transition hover:text-slate-600">
            x
          </button>
        </div>
      </div>

      {isSearching && (
        <div className="border-b border-slate-200 p-3">
          <input
            type="text"
            value={messageSearch}
            onChange={(e) => setMessageSearch(e.target.value)}
            placeholder="Search in chat..."
            className="w-full rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-[#003366] focus:ring-1 focus:ring-[#003366]/20"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {!selectedUser ? (
          <div className="flex h-full items-center justify-center text-center">
            <p className="text-sm text-slate-400">Select a recipient to start chatting.</p>
          </div>
        ) : filteredMessages.length === 0 && !typingUsers[selectedUser] ? (
          <div className="flex h-full items-center justify-center text-center">
            <p className="text-sm text-slate-400">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          <>
          {filteredMessages.map((msg, i) => {
            const isMine = msg.sender === userEmail;
            const isImage = msg.attachmentName && isImageAttachment(msg) && msg.attachmentDataBase64;
            const imageSrc = isImage ? imageSrcForMessage(msg) : '';

            const senderUser = onlineUsers.find((u) => u.email === msg.sender);
            const senderName = senderUser ? displayNameForUser(senderUser) : msg.sender ? msg.sender.split('@')[0] : 'Unknown';

            return (
              <div key={messageRenderKey(msg, i)} className={`mb-3 flex w-full flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                <span className={`mb-1 text-[11px] font-semibold text-slate-500 ${isMine ? 'mr-3' : 'ml-3'}`}>
                  {isMine ? 'You' : senderName}
                </span>
                <div
                  className={`relative min-h-[40px] min-w-[56px] whitespace-pre-wrap px-4 py-3 leading-relaxed shadow-sm ${
                    isMine
                      ? 'rounded-2xl rounded-br-none bg-gradient-to-br from-[#003366] to-[#005599] text-white'
                      : 'rounded-2xl rounded-bl-none bg-slate-100 text-slate-800'
                  }`}
                  style={{ width: 'fit-content', maxWidth: '85%', overflowWrap: 'anywhere', wordBreak: 'break-word', overflowX: 'hidden' }}
                >
                  {isMine && (
                    <div className="absolute -right-2 bottom-2 h-0 w-0 border-y-[8px] border-l-[10px] border-y-transparent border-l-[#003366]" />
                  )}
                  {!isMine && (
                    <div className="absolute -left-2 bottom-2 h-0 w-0 border-y-[8px] border-r-[10px] border-y-transparent border-r-slate-100" />
                  )}

                  {isImage ? (
                    <div className="mb-2">
                      <button
                        type="button"
                        onClick={() => setImagePreview({ src: imageSrc, name: msg.attachmentName })}
                        className="block overflow-hidden rounded-xl border border-white/20 bg-black/5 text-left transition hover:opacity-90"
                        title="Open image preview"
                      >
                        <img
                          src={imageSrc}
                          alt={msg.attachmentName || 'Shared image'}
                          className="max-h-64 max-w-full object-contain"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadAttachment(msg)}
                        className="mt-2 block max-w-full truncate text-left text-[11px] font-semibold opacity-80 underline-offset-2 hover:underline"
                        title="Download image"
                      >
                        {msg.attachmentName}
                      </button>
                    </div>
                  ) : msg.attachmentName ? (
                    <div className="mb-2 text-[13px] sm:text-sm">
                      <button
                        type="button"
                        onClick={() => downloadAttachment(msg)}
                        disabled={!msg.attachmentDataBase64}
                        className={`text-left font-semibold underline-offset-2 ${
                          msg.attachmentDataBase64 ? 'cursor-pointer hover:underline' : 'cursor-default'
                        }`}
                        title={msg.attachmentDataBase64 ? 'Download attachment' : 'Attachment data unavailable'}
                      >
                        Attachment: {msg.attachmentName}
                      </button>
                    </div>
                  ) : (
                    <div className="mb-1 text-[13px] sm:text-sm">{getVisibleMessageText(msg)}</div>
                  )}

                  <div className={`mt-auto text-[11px] opacity-70 ${isMine ? 'text-right' : 'text-left'}`}>
                    {msg.sentAt ? new Date(msg.sentAt).toLocaleTimeString() : 'Sending...'}
                    {isMine && msg.seenAt ? (
                      <span className="ml-2 font-semibold opacity-90">Seen</span>
                    ) : isMine && msg.deliveredAt ? (
                      <span className="ml-2 font-semibold opacity-90">Delivered</span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
          {typingUsers[selectedUser] && <TypingIndicator />}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex flex-col gap-2 p-4 pt-0">
        <div className="relative">
          <details
            className="w-full"
            open={isUserDropdownOpen}
            onToggle={(e) => setIsUserDropdownOpen(e.currentTarget.open)}
          >
            <summary className="cursor-pointer list-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
              Select user
            </summary>

            <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={onlineSearch}
                  onChange={(e) => setOnlineSearch(e.target.value)}
                  placeholder="Search users..."
                  className="flex-1 rounded-full border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#003366] focus:ring-1 focus:ring-[#003366]/20"
                />
              </div>

              {viewerKey === 'faculty' && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={facultyTypeFilters.registrar}
                      onChange={(e) =>
                        setFacultyTypeFilters((p) => ({ ...p, registrar: e.target.checked }))
                      }
                    />
                    <span>Registrar</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={facultyTypeFilters.department_admin}
                      onChange={(e) =>
                        setFacultyTypeFilters((p) => ({ ...p, department_admin: e.target.checked }))
                      }
                    />
                    <span>Department Admins</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={facultyTypeFilters.faculty}
                      onChange={(e) => setFacultyTypeFilters((p) => ({ ...p, faculty: e.target.checked }))}
                    />
                    <span>Faculties</span>
                  </label>
                </div>
              )}

              <div className="mt-1 mb-2 text-xs text-slate-500">{otherCount} users available</div>

              <div className="flex max-h-64 flex-col gap-3 overflow-y-auto pr-1">
                {!hasVisibleContacts ? (
                  <div className="text-xs italic text-slate-400">No available chat targets</div>
                ) : (
                  allowedGroupOrder.map((key) => {
                    const arr = filteredGroupsForUI[key] || [];
                    if (!arr.length) return null;

                    return (
                      <div key={key}>
                        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{groupTitle(key)}</div>
                        <div className="flex flex-col gap-1">
                          {arr.map((u) => {
                            const displayName = displayNameForUser(u);
                            const isSelected = selectedUser === u.email;
                            const unreadCount = unreadCounts[u.email] || 0;
                            return (
                              <button
                                key={u.email}
                                onClick={() => selectRecipient(u.email)}
                                className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition ${
                                  isSelected ? 'bg-[#003366] text-white' : 'bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-[#003366]'
                                }`}
                                title={displayName}
                              >
                                <span className="truncate">{displayName}</span>
                                {!u.isOnline && (
                                  <span className="ml-2 text-[10px] font-semibold opacity-70">Offline</span>
                                )}
                                {unreadCount > 0 && (
                                  <span className="ml-3 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                                    {unreadCount > 9 ? '9+' : unreadCount}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </details>

          {selectedUser && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-[#003366]/20 bg-[#003366]/5 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-[#003366]">{selectedUserName}</div>
                <div className="truncate text-xs text-slate-500">{selectedUser}</div>
              </div>
              <button
                type="button"
                onClick={clearRecipient}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-base font-bold text-slate-500 shadow-sm transition hover:bg-red-50 hover:text-red-600"
                title="Close current recipient"
              >
                x
              </button>
            </div>
          )}
        </div>

      </div>

      <div className="flex gap-2 items-end p-4 pt-0">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
          aria-hidden="true"
        />

        <button
          type="button"
          onClick={handlePickFile}
          disabled={!selectedUser}
          title={selectedUser ? 'Send file' : 'Select a user to send a file'}
          className="shrink-0 mb-[2px] rounded-full bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Attach
        </button>

        <input
          type="text"
          value={newMessage}
          onChange={(e) => {
            setNewMessage(e.target.value);
            updateTyping(selectedUser, e.target.value);
          }}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          disabled={!selectedUser}
          placeholder={selectedUser ? 'Type a message...' : 'Select a recipient first'}
          className="flex-1 rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-[#003366] focus:ring-1 focus:ring-[#003366]/20"
        />

        <button
          onClick={sendMessage}
          disabled={!newMessage.trim() || !selectedUser}
          className="shrink-0 rounded-full bg-[#003366] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#00264d] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </div>

      <div
        onMouseDown={onResizeMouseDown}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
        title="Resize chat"
        style={{ background: 'transparent' }}
      />

      {imagePreview && (
        <div
          className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setImagePreview(null)}
        >
          <div className="relative max-h-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setImagePreview(null)}
              className="absolute -right-3 -top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-xl font-bold text-slate-700 shadow-lg transition hover:bg-slate-100"
              title="Close image preview"
            >
              x
            </button>
            <img
              src={imagePreview.src}
              alt={imagePreview.name || 'Image preview'}
              className="max-h-[86vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
            />
            {imagePreview.name && (
              <div className="mt-3 max-w-[92vw] truncate text-center text-sm font-semibold text-white">
                {imagePreview.name}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    {secondaryChatUsers.map((email, index) => {
      const draft = conversationDrafts[email] || '';
      const secondaryMessages = getConversationMessages(email);
      const rightOffset = chatBoxWidth + 36 + index * (chatBoxWidth + 16);
      return (
        <div
          key={email}
          className="fixed bottom-5 z-[999] flex flex-col overflow-hidden rounded-2xl bg-white font-sans shadow-2xl"
          style={{ width: chatBoxWidth, height: chatBoxHeight, right: rightOffset }}
        >
          <div className="flex items-center justify-between border-b border-slate-200 p-4">
            <div className="min-w-0">
              <h3 className="truncate text-base font-bold text-[#003366]">{getNameForEmail(email)}</h3>
              <p className="truncate text-xs text-slate-500">{email}</p>
            </div>
            <button
              type="button"
              onClick={() => closeConversation(email)}
              className="cursor-pointer text-2xl leading-none text-slate-400 transition hover:text-slate-600"
              title="Close conversation"
            >
              x
            </button>
          </div>

          <div ref={secondaryMessagesRef} className="flex-1 overflow-y-auto p-4">
            {secondaryMessages.length === 0 && !typingUsers[email] ? (
              <div className="flex h-full items-center justify-center text-center">
                <p className="text-sm text-slate-400">No messages yet.</p>
              </div>
            ) : (
              <>
              {secondaryMessages.map((msg, i) => {
                const isMine = msg.sender === userEmail;
                const isImage = msg.attachmentName && isImageAttachment(msg) && msg.attachmentDataBase64;
                const imageSrc = isImage ? imageSrcForMessage(msg) : '';
                const senderUser = onlineUsers.find((u) => u.email === msg.sender);
                const senderName = senderUser ? displayNameForUser(senderUser) : msg.sender ? msg.sender.split('@')[0] : 'Unknown';

                return (
                  <div key={`${messageRenderKey(msg, i)}-${email}`} className={`mb-3 flex w-full flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                    <span className={`mb-1 text-[11px] font-semibold text-slate-500 ${isMine ? 'mr-3' : 'ml-3'}`}>
                      {isMine ? 'You' : senderName}
                    </span>
                    <div
                      className={`relative min-h-[40px] min-w-[56px] whitespace-pre-wrap px-4 py-3 leading-relaxed shadow-sm ${
                        isMine
                          ? 'rounded-2xl rounded-br-none bg-gradient-to-br from-[#003366] to-[#005599] text-white'
                          : 'rounded-2xl rounded-bl-none bg-slate-100 text-slate-800'
                      }`}
                      style={{ width: 'fit-content', maxWidth: '85%', overflowWrap: 'anywhere', wordBreak: 'break-word', overflowX: 'hidden' }}
                    >
                      {isImage ? (
                        <button
                          type="button"
                          onClick={() => setImagePreview({ src: imageSrc, name: msg.attachmentName })}
                          className="block overflow-hidden rounded-xl border border-white/20 bg-black/5 text-left transition hover:opacity-90"
                          title="Open image preview"
                        >
                          <img src={imageSrc} alt={msg.attachmentName || 'Shared image'} className="max-h-64 max-w-full object-contain" />
                        </button>
                      ) : msg.attachmentName ? (
                        <button
                          type="button"
                          onClick={() => downloadAttachment(msg)}
                          disabled={!msg.attachmentDataBase64}
                          className={`text-left text-[13px] font-semibold underline-offset-2 ${
                            msg.attachmentDataBase64 ? 'cursor-pointer hover:underline' : 'cursor-default'
                          }`}
                          title={msg.attachmentDataBase64 ? 'Download attachment' : 'Attachment data unavailable'}
                        >
                          Attachment: {msg.attachmentName}
                        </button>
                      ) : (
                        <div className="mb-1 text-[13px] sm:text-sm">{getVisibleMessageText(msg)}</div>
                      )}
                      <div className={`mt-2 text-[11px] opacity-70 ${isMine ? 'text-right' : 'text-left'}`}>
                        {msg.sentAt ? new Date(msg.sentAt).toLocaleTimeString() : 'Sending...'}
                        {isMine && msg.seenAt ? (
                          <span className="ml-2 font-semibold opacity-90">Seen</span>
                        ) : isMine && msg.deliveredAt ? (
                          <span className="ml-2 font-semibold opacity-90">Delivered</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              {typingUsers[email] && <TypingIndicator />}
              </>
            )}
          </div>

          <div className="flex gap-2 p-4 pt-0">
            <input
              type="text"
              value={draft}
              onChange={(e) => {
                setConversationDrafts((prev) => ({ ...prev, [email]: e.target.value }));
                updateTyping(email, e.target.value);
              }}
              onKeyDown={(e) =>
                e.key === 'Enter' &&
                sendMessageTo(email, draft, () => setConversationDrafts((prev) => ({ ...prev, [email]: '' })))
              }
              placeholder="Type a message..."
              className="min-w-0 flex-1 rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-[#003366] focus:ring-1 focus:ring-[#003366]/20"
            />
            <button
              onClick={() => sendMessageTo(email, draft, () => setConversationDrafts((prev) => ({ ...prev, [email]: '' })))}
              disabled={!draft.trim()}
              className="shrink-0 rounded-full bg-[#003366] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#00264d] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      );
    })}
    </>
  );
};

export default Chat;
