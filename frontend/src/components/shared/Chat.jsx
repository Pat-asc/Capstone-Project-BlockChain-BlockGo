import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as signalR from '@microsoft/signalr';

const Chat = ({ userEmail, userRole, onClose }) => {
  const [connection, setConnection] = useState(null);
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [latestActivity, setLatestActivity] = useState({});
  const [unreadCounts, setUnreadCounts] = useState({});
  const messagesEndRef = useRef(null);
  const selectedUserRef = useRef(selectedUser);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    selectedUserRef.current = selectedUser;
    if (selectedUser) {
      setUnreadCounts(prev => ({ ...prev, [selectedUser]: 0 }));
    }
  }, [selectedUser]);

  useEffect(() => {
    const chatUrl = '/chatHub';

    const token = localStorage.getItem('token');

    const conn = new signalR.HubConnectionBuilder()
      .withUrl(chatUrl, {
        accessTokenFactory: () => token
      })
      .withAutomaticReconnect()
      .build();

    conn.start().then(() => {      conn.invoke('JoinChat', userRole);
    }).catch(err => console.error('SignalR connection failed:', err));

    conn.on('ReceiveMessage', (msg) => {
      setMessages(prev => [...prev, msg]);
      setLatestActivity(prev => {
        const otherUser = msg.sender === userEmail ? msg.receiver : msg.sender;
        return { ...prev, [otherUser]: new Date(msg.timestamp).getTime() };
      });
      setUnreadCounts(prev => {
        const otherUser = msg.sender === userEmail ? msg.receiver : msg.sender;
        if (otherUser !== selectedUserRef.current && msg.sender !== userEmail) {
          return { ...prev, [otherUser]: (prev[otherUser] || 0) + 1 };
        }
        return prev;
      });
    });

    conn.on('ChatHistory', (history) => {
      setMessages(history.map(m => ({
        sender: m.senderEmail,
        receiver: m.receiverEmail,
        message: m.message,
        timestamp: m.timestamp
      })));
      if (history.length > 0) {
        setLatestActivity(prev => {
          const lastMsg = history[history.length - 1];
          const otherUser = lastMsg.senderEmail === userEmail ? lastMsg.receiverEmail : lastMsg.senderEmail;
          const time = new Date(lastMsg.timestamp).getTime();
          return { ...prev, [otherUser]: Math.max(prev[otherUser] || 0, time) };
        });
      }
    });

    conn.on('UserJoined', (user) => {
      setOnlineUsers(prev => {
        if (prev.some(u => u.email === user.email)) return prev;
        return [...prev, user];
      });
    });

    conn.on('RequestRollCall', (targetEmail) => {
      if (userEmail) {
        conn.invoke('AnnouncePresence', targetEmail);
      }
    });

    conn.on('UserLeft', (user) => {
      setOnlineUsers(prev => prev.filter(u => u.email !== user.email));
    });

    conn.on('OnlineStatusChanged', (status) => {
    });

    setConnection(conn);

    return () => {
      conn.stop();
    };
  }, [userEmail, userRole]);

  useEffect(() => {
    if (connection && selectedUser) {
      connection.invoke('GetChatHistory', selectedUser);
    }
  }, [selectedUser, connection]);

  const sendMessage = async () => {
    if (newMessage.trim() && connection && selectedUser) {
      const msgText = newMessage.trim();
      setNewMessage('');
      
      await connection.invoke('SendMessage', selectedUser, msgText);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, selectedUser]);

  const sortedOnlineUsers = useMemo(() => {
    return [...onlineUsers].sort((a, b) => {
      const timeA = latestActivity[a.email] || 0;
      const timeB = latestActivity[b.email] || 0;
      if (timeA !== timeB) return timeB - timeA;
      return (a.fullName || a.email).localeCompare(b.fullName || b.email);
    });
  }, [onlineUsers, latestActivity]);

  return (
    <div className="fixed bottom-5 right-5 z-[1000] flex h-[500px] w-full max-w-[400px] flex-col rounded-2xl bg-white font-sans shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 p-5">
        <h3 className="m-0 text-lg font-bold text-[#003366]">Chat</h3>
        <button onClick={onClose} className="cursor-pointer text-2xl leading-none text-slate-400 transition hover:text-slate-600">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {messages
          .filter(msg => 
            (msg.sender === userEmail && msg.receiver === selectedUser) || 
            (msg.sender === selectedUser && msg.receiver === userEmail)
          )
          .map((msg, i) => {
          const textLength = msg.message.length;
          const lineCount = msg.message.split('\n').length;
          const isLong = textLength > 100 || lineCount > 3;
          const widthClass = isLong ? 'w-[85%]' : textLength > 50 ? 'w-[70%]' : 'w-[55%]';
          const isMine = msg.sender === userEmail;
          
          const senderUser = onlineUsers.find(u => u.email === msg.sender);
          const senderName = senderUser ? senderUser.fullName : (msg.sender ? msg.sender.split('@')[0] : 'Unknown');

          return (
            <div key={i} className={`mb-3 flex w-full flex-col ${isMine ? 'items-end' : 'items-start'}`}>
              <span className={`mb-1 text-[11px] font-semibold text-slate-500 ${isMine ? 'mr-3' : 'ml-3'}`}>
                {isMine ? 'You' : senderName}
              </span>
              <div className={`relative max-h-[250px] min-h-[40px] max-w-[85%] overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 leading-relaxed shadow-sm ${widthClass} ${isMine ? 'rounded-2xl rounded-br-none bg-gradient-to-br from-[#003366] to-[#005599] text-white' : 'rounded-2xl rounded-bl-none bg-slate-100 text-slate-800'}`}>
                {isMine && (
                  <div className="absolute -right-2 bottom-2 h-0 w-0 border-y-[8px] border-l-[10px] border-y-transparent border-l-[#003366]" />
                )}
                {!isMine && (
                  <div className="absolute -left-2 bottom-2 h-0 w-0 border-y-[8px] border-r-[10px] border-y-transparent border-r-slate-100" />
                )}
                
                <div className="mb-1 text-[13px] sm:text-sm">
                  {msg.message}
                </div>
                <div className={`mt-auto text-[11px] opacity-70 ${isMine ? 'text-right' : 'text-left'}`}>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex flex-col gap-2 p-4 pt-0">
        <div className="flex w-full gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {sortedOnlineUsers.filter(u => u.email !== userEmail).map(u => {
            const isSelected = selectedUser === u.email;
            const unreadCount = unreadCounts[u.email] || 0;
            const initials = u.fullName ? u.fullName.substring(0, 2).toUpperCase() : u.email.substring(0, 2).toUpperCase();
            return (
              <div key={u.email} className="relative">
                <button
                  onClick={() => setSelectedUser(u.email)}
                  title={u.fullName || u.email}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all ${
                    isSelected
                      ? 'bg-[#003366] text-white ring-2 ring-[#003366] ring-offset-2'
                      : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                  }`}
                >
                  {initials}
                </button>
                {unreadCount > 0 && (
                  <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </div>
                )}
              </div>
            );
          })}
          {sortedOnlineUsers.filter(u => u.email !== userEmail).length === 0 && (
            <div className="flex h-10 w-full items-center justify-center text-xs italic text-slate-400">
              No other users online
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <input 
            type="text" 
            value={newMessage} 
            onChange={(e) => setNewMessage(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Type a message..." 
            className="flex-1 rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-[#003366] focus:ring-1 focus:ring-[#003366]/20"
          />
          <button onClick={sendMessage} disabled={!newMessage.trim() || !selectedUser} className="shrink-0 rounded-full bg-[#003366] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#00264d] disabled:cursor-not-allowed disabled:opacity-50">
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default Chat;
