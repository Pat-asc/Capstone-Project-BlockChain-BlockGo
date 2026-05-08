import React, { useState, useEffect, useCallback } from "react";
import "./assets/style.css"; 
import "./assets/App.css";   
import Login from "./components/shared/Login";
import { fetchUserProfile } from './services/api';
import StudentPortal from './components/student/StudentPortal';
import FacultyPortal from './components/faculty/FacultyPortal';
import DeptAdminGradesView from './components/chairperson/DeptAdminGradesView';
import RegistrarGradesView from './components/registrar/RegistrarGradesView';
import Chat from './components/shared/Chat';

import { BrowserRouter as Router } from 'react-router-dom';
import { NotificationProvider, useNotification } from './services/NotificationContext';

const normalizeAppRole = (role) => {
  const normalized = String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'dept_admin' || normalized === 'deptadmin' || normalized === 'departmentadmin' || normalized === 'department' || normalized === 'admin' || normalized === 'departmentmsp') {
    return 'department_admin';
  }
  if (normalized === 'facultymsp') return 'faculty';
  if (normalized === 'registrarmsp') return 'registrar';
  return normalized;
};

function AppContent() {
  const [user, setUser] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatUnreadTotal, setChatUnreadTotal] = useState(0);
  const [latestChatNotice, setLatestChatNotice] = useState(null);
  const [chatAutoOpenTarget, setChatAutoOpenTarget] = useState(null);
  const { addNotification } = useNotification();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(base64));
        handleLoginSuccess(token);
      } catch (e) {
        localStorage.removeItem('token');
      }
    }
  }, []);

  const handleLoginSuccess = async (token) => { // Made async
    localStorage.setItem('token', token);
    try {
      // Decode the JWT to securely get the username and role signed by the backend
      const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64));
      
      // Log the payload to the console so you can see exactly what keys your backend uses
      console.log("Decoded Token Payload:", payload);
      
      // Add safe fallbacks for standard JWT structures
      const email = payload.username || payload.email || payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'];
      const dbRole = normalizeAppRole(payload.dbRole || payload.role || payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']);

      // Fetch full user profile from the backend
      const profileResponse = await fetchUserProfile(email, dbRole);

      if (profileResponse.status === 'Success' && profileResponse.data) {
        const fetchedUser = profileResponse.data;
        const appRole = normalizeAppRole(fetchedUser.role || dbRole);
        
        // Determine display name based on role
        let displayName = fetchedUser.fullName;
        if (appRole === 'faculty') {
          displayName = `Prof. ${fetchedUser.fullName}`;
        } else if (appRole === 'department_admin') {
          displayName = `Dept Admin ${fetchedUser.fullName}`;
        } else if (appRole === 'registrar') {
          displayName = `Registrar ${fetchedUser.fullName}`;
        }

        // Set the user state with the fetched data
        setUser({
          id: fetchedUser.id,
          name: displayName, // Use the formatted display name
          email: fetchedUser.email,
          role: appRole,
          rawRole: fetchedUser.role,
          studentNo: fetchedUser.studentNo,
          dateOfBirth: fetchedUser.dateOfBirth,
          sex: fetchedUser.sex,
          phone: fetchedUser.phone,
          address: fetchedUser.address,
          department: fetchedUser.department,
          section: fetchedUser.section,
          yearLevel: fetchedUser.yearLevel,
          enrolledSubjects: fetchedUser.enrolledSubjects,
          facultyType: fetchedUser.facultyType,
          Classification: fetchedUser.facultyType || fetchedUser.classification,
          status: fetchedUser.status // Add status if needed
        });
      } else {
        console.error("Failed to fetch user profile:", profileResponse.message);
        throw new Error("Failed to load user profile.");
      }
    } catch (error) {
      console.error("Error during login process:", error);
      if (error instanceof SyntaxError) {
        console.error("Invalid token format. It could not be parsed.");
        localStorage.removeItem('token');
      }
      setUser(null);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setChatUnreadTotal(0);
    setLatestChatNotice(null);
    setChatAutoOpenTarget(null);
  };

  const handleUnreadChange = useCallback((totalUnread) => {
    setChatUnreadTotal(totalUnread);
  }, []);

  const handleIncomingMessage = useCallback(({ from, message, attachmentName }) => {
    const senderName = from ? from.split('@')[0] : 'A user';
    const chatPreview = message || (attachmentName ? `Sent ${attachmentName}` : 'Sent an attachment');
    const isRegistrar = normalizeAppRole(user?.role).includes('registrar');

    setLatestChatNotice({
      from: senderName,
      message: chatPreview,
      receivedAt: new Date().toISOString(),
    });

    if (isRegistrar && from) {
      setIsChatOpen(true);
      setChatAutoOpenTarget({ email: from, nonce: Date.now() });
    }
  }, [user?.role]);

  const handleRegistrationRequest = useCallback((request) => {
    const isRegistrar = normalizeAppRole(user?.role).includes('registrar');
    if (!isRegistrar) return;

    const name = request?.fullName || request?.FullName || request?.email || request?.Email || 'A new user';
    const role = request?.role || request?.Role || 'user';
    addNotification(`New registration request from ${name} (${role})`, 'success');
  }, [addNotification, user?.role]);

  const currentUserRole = normalizeAppRole(user?.role);

  return (
    <div className="main-app-wrapper">
      {!user ? (
        <Login onLogin={handleLoginSuccess} />
      ) : (
        <>
          {/* Floating Chat Button */}
          {!isChatOpen && (
            <button 
              onClick={() => setIsChatOpen(true)} 
              style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 1000, padding: '15px 25px', backgroundColor: '#003366', color: 'white', border: 'none', borderRadius: '30px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', fontWeight: 'bold', fontSize: '16px' }}>
              💬 Open Chat
            </button>
          )}
          {!isChatOpen && chatUnreadTotal > 0 && (
            <span
              style={{
                position: 'fixed',
                bottom: '52px',
                right: '18px',
                zIndex: 1001,
                display: 'inline-flex',
                minWidth: 22,
                height: 22,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 999,
                background: '#ef4444',
                color: 'white',
                fontSize: 12,
                fontWeight: 700,
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
              }}
            >
              {chatUnreadTotal > 9 ? '9+' : chatUnreadTotal}
            </span>
          )}
          <Chat
            userEmail={user.email}
            userRole={currentUserRole}
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            onUnreadChange={handleUnreadChange}
            onIncomingMessage={handleIncomingMessage}
            onRegistrationRequest={handleRegistrationRequest}
            autoOpenTarget={chatAutoOpenTarget}
          />

          {currentUserRole === "student" ? (
            <StudentPortal studentData={user} onLogout={handleLogout} />
          ) : currentUserRole === "faculty" ? (
            <FacultyPortal facultyData={user} onLogout={handleLogout} />
          ) : currentUserRole === "department_admin" ? (
            <div style={{ position: 'relative', width: '100%', minHeight: '100vh', backgroundColor: '#f0f2f5' }}>
              <DeptAdminGradesView loggedInEmail={user.email ?? ''} loggedInName={user.name ?? ''} userRole={currentUserRole} department={user.department ?? ''} />
            </div>
          ) : currentUserRole === "registrar" ? (
            <div style={{ position: 'relative', width: '100%', minHeight: '100vh', backgroundColor: '#f0f2f5' }}>
              <RegistrarGradesView
                loggedInEmail={user.email ?? ''}
                loggedInName={user.name ?? ''}
                chatUnreadCount={chatUnreadTotal}
                latestChatNotice={latestChatNotice}
                onOpenChat={() => setIsChatOpen(true)}
              />
            </div>
          ) : (
            <div style={{ position: 'relative', width: '100%', minHeight: '100vh', backgroundColor: '#f0f2f5' }}>
              <div style={{ position: 'absolute', top: '15px', right: '20px', zIndex: 10 }}>
                <button className="logout-btn" onClick={handleLogout} style={{ backgroundColor: '#003366', color: 'white', borderColor: '#003366', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>Logout</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function App() {
  return (
    <NotificationProvider>
      <Router>
        <AppContent />
      </Router>
    </NotificationProvider>
  );
}

export default App;
