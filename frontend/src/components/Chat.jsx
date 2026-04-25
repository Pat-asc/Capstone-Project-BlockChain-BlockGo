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
      setOnlineUsers(prev => [...prev, user]);
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
      await connection.invoke('SendMessage', selectedUser, newMessage);
      setNewMessage('');
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="chat-container" style={{
      position: 'fixed', bottom: '20px', right: '20px', width: '400px', height: '500px',
      background: 'white', borderRadius: '15px', boxShadow: '0 20px 40px rgba(0,0,0,0.1)',
      display: 'flex', flexDirection: 'column', zIndex: 1000
    }}>
      <div style={{ padding: '20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, color: '#003366' }}>Chat</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}>×</button>
      </div>

      <div style={{ flex: 1, padding: '15px', overflowY: 'auto' }}>
{messages.map((msg, i) => {
          // Adaptive sizing like Messenger: estimate width/height based on text
          const textLength = msg.message.length;
          const lineCount = msg.message.split('\n').length;
          const isLong = textLength > 100 || lineCount > 3;
          const bubbleWidth = isLong ? '85%' : textLength > 50 ? '70%' : '45%';
          
          return (
            <div key={i} style={{
              marginBottom: '12px', 
              display: 'flex',
              justifyContent: msg.sender === userEmail ? 'flex-end' : 'flex-start'
            }}>
              <div style={{
                width: bubbleWidth,
                maxWidth: '85%',
                minHeight: '40px',
                padding: isLong ? '16px 20px' : '12px 16px',
                borderRadius: '24px',
                background: msg.sender === userEmail 
                  ? 'linear-gradient(135deg, #003366 0%, #005599 100%)' 
                  : '#f1f3f4',
                color: msg.sender === userEmail ? 'white' : '#1d1d1d',
                boxShadow: msg.sender === userEmail 
                  ? '2px 4px 12px rgba(0,51,102,0.3)' 
                  : '0 2px 8px rgba(0,0,0,0.1)',
                position: 'relative',
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                lineHeight: 1.4,
                maxHeight: '200px',
                overflow: 'auto'
              }}>
                {/* Message tail like Messenger */}
                <div style={{
                  position: 'absolute',
                  width: 0,
                  height: 0,
                  border: msg.sender === userEmail 
                    ? '8px solid transparent' 
                    : '8px solid #f1f3f4'
                }} />
                {msg.sender === userEmail && (
                  <div style={{
                    position: 'absolute',
                    right: -5,
                    bottom: 8,
                    width: 0,
                    height: 0,
                    borderTop: '8px solid transparent',
                    borderBottom: '8px solid transparent',
                    borderLeft: '10px solid #003366'
                  }} />
                )}
                {msg.sender !== userEmail && (
                  <div style={{
                    position: 'absolute',
                    left: -5,
                    bottom: 8,
                    width: 0,
                    height: 0,
                    borderTop: '8px solid transparent',
                    borderBottom: '8px solid transparent',
                    borderRight: '10px solid #f1f3f4'
                  }} />
                )}
                <div style={{ marginBottom: '4px' }}>
                  {msg.message}
                </div>
                <div style={{ 
                  fontSize: '11px', 
                  opacity: 0.7, 
                  textAlign: msg.sender === userEmail ? 'right' : 'left',
                  marginTop: 'auto'
                }}>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ padding: '0 15px 15px', display: 'flex', gap: '10px' }}>
        <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}
          style={{ flex: 1, padding: '10px', borderRadius: '20px', border: '1px solid #ddd' }}>
          <option value="">Select User</option>
          {onlineUsers.map(u => <option key={u.email} value={u.email}>{u.fullName}</option>)}
        </select>
        <input 
          type="text" 
          value={newMessage} 
          onChange={(e) => setNewMessage(e.target.value)} 
          placeholder="Type a message..." 
          style={{ flex: 2, padding: '10px', borderRadius: '20px', border: '1px solid #ddd' }}
        />
        <button onClick={sendMessage} disabled={!newMessage.trim() || !selectedUser}
          style={{ padding: '10px 20px', borderRadius: '20px', background: '#003366', color: 'white', border: 'none', cursor: 'pointer' }}>
          Send
        </button>
      </div>
    </div>
  );
};

export default Chat;
