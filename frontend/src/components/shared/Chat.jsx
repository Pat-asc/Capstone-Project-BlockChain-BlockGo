import React, { useState, useEffect, useRef } from 'react';
import * as signalR from '@microsoft/signalr';

const Chat = ({ userEmail, userRole, onClose }) => {
  const [connection, setConnection] = useState(null);
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    // Use relative path in production so Nginx proxies the WebSocket connection
    const chatUrl = process.env.NODE_ENV !== 'development' 
      ? '/chatHub' 
      : 'http://localhost:5000/chatHub';

    const conn = new signalR.HubConnectionBuilder()
      .withUrl(chatUrl)
      .build();

    conn.start().then(() => {
      conn.invoke('JoinChat', userEmail, userRole);
    }).catch(err => console.error('SignalR connection failed:', err));

    conn.on('ReceiveMessage', (msg) => {
      setMessages(prev => [...prev, msg]);
    });

    conn.on('UserJoined', (user) => {
      setOnlineUsers(prev => {
        if (prev.some(u => u.email === user.email)) return prev;
        return [...prev, user];
      });
    });

    conn.on('UserLeft', (user) => {
      setOnlineUsers(prev => prev.filter(u => u.email !== user.email));
    });

    conn.on('OnlineStatusChanged', (status) => {
      // Update status list
    });

    setConnection(conn);

    return () => {
      conn.stop();
    };
  }, [userEmail, userRole]);

  const sendMessage = async () => {
    if (newMessage.trim() && connection && selectedUser) {
      const msgText = newMessage.trim();
      setNewMessage('');
      
      // Optimistic UI Update: Show message locally immediately
      setMessages(prev => [...prev, {
        sender: userEmail,
        message: msgText,
        timestamp: new Date().toISOString()
      }]);

      await connection.invoke('SendMessage', userEmail, selectedUser, msgText);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="fixed bottom-5 right-5 z-[1000] flex h-[500px] w-full max-w-[400px] flex-col rounded-2xl bg-white font-sans shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 p-5">
        <h3 className="m-0 text-lg font-bold text-[#003366]">Chat</h3>
        <button onClick={onClose} className="cursor-pointer text-2xl leading-none text-slate-400 transition hover:text-slate-600">×</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
{messages.map((msg, i) => {
          // Adaptive sizing like Messenger: estimate width/height based on text
          const textLength = msg.message.length;
          const lineCount = msg.message.split('\n').length;
          const isLong = textLength > 100 || lineCount > 3;
          const widthClass = isLong ? 'w-[85%]' : textLength > 50 ? 'w-[70%]' : 'w-[55%]';
          const isMine = msg.sender === userEmail;
          
          return (
            <div key={i} className={`mb-3 flex w-full ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`relative max-h-[250px] min-h-[40px] max-w-[85%] overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 leading-relaxed shadow-sm ${widthClass} ${isMine ? 'rounded-2xl rounded-br-none bg-gradient-to-br from-[#003366] to-[#005599] text-white' : 'rounded-2xl rounded-bl-none bg-slate-100 text-slate-800'}`}>
                {/* Message tail like Messenger */}
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

      <div className="flex gap-3 p-4 pt-0">
        <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className="flex-1 rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-[#003366] focus:ring-1 focus:ring-[#003366]/20">
          <option value="">Select User</option>
          {onlineUsers.map(u => <option key={u.email} value={u.email}>{u.fullName}</option>)}
        </select>
        <input 
          type="text" 
          value={newMessage} 
          onChange={(e) => setNewMessage(e.target.value)} 
          placeholder="Type a message..." 
          className="flex-[2] rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-[#003366] focus:ring-1 focus:ring-[#003366]/20"
        />
        <button onClick={sendMessage} disabled={!newMessage.trim() || !selectedUser} className="shrink-0 rounded-full bg-[#003366] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#00264d] disabled:cursor-not-allowed disabled:opacity-50">
          Send
        </button>
      </div>
    </div>
  );
};

export default Chat;
