import React, { useState, useEffect } from "react";
import "./assets/style.css"; 
import "./assets/App.css";   
import Login from "./components/shared/Login";
import { fetchUserProfile } from './services/api';
import StudentPortal from './components/student/StudentPortal';
import FacultyPortal from './components/faculty/FacultyPortal';
import DeanGradesView from './components/chairperson/DeanGradesView';
import RegistrarGradesView from './components/registrar/RegistrarGradesView';
import Chat from './components/shared/Chat';

import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import StudentLanding from './components/student/StudentLanding';
import FacultyLanding from './components/faculty/FacultyLanding';

function AppContent() {
    const [user, setUser] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(base64));
        // Check if token is expired
        if (payload.exp * 1000 > Date.now()) {
          handleLoginSuccess(token);
        } else {
          localStorage.removeItem('token');
        }
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
      const dbRole = payload.dbRole || payload.role || payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'];

      // Fetch full user profile from the backend
      const profileResponse = await fetchUserProfile(email, dbRole);

      if (profileResponse.status === 'Success' && profileResponse.data) {
        const fetchedUser = profileResponse.data;
        
        // Determine display name based on role
        let displayName = fetchedUser.fullName;
        if (fetchedUser.role === 'faculty') {
          displayName = `Prof. ${fetchedUser.fullName}`;
        } else if (fetchedUser.role === 'department_admin') {
          displayName = `Dean ${fetchedUser.fullName}`;
        } else if (fetchedUser.role === 'registrar') {
          displayName = `Registrar ${fetchedUser.fullName}`;
        }

        // Set the user state with the fetched data
        setUser({
          id: fetchedUser.id,
          name: displayName, // Use the formatted display name
          email: fetchedUser.email,
          role: fetchedUser.role, // Use the role from the fetched profile
          studentNo: fetchedUser.studentNo,
          department: fetchedUser.department,
          section: fetchedUser.section,
          yearLevel: fetchedUser.yearLevel,
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
      }
      // Automatically clear the broken token and reset the user state
      localStorage.removeItem('token');
      setUser(null);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

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
          {isChatOpen && <Chat userEmail={user.email} userRole={user.role} onClose={() => setIsChatOpen(false)} />}

          {user.role === "student" ? (
            <StudentPortal studentData={user} onLogout={handleLogout} />
          ) : user.role === "faculty" ? (
            <FacultyPortal facultyData={user} onLogout={handleLogout} />
          ) : user.role === "department_admin" || user.role === "department admin" ? (
            <div style={{ position: 'relative', width: '100%', minHeight: '100vh', backgroundColor: '#f0f2f5' }}>
              <DeanGradesView loggedInEmail={user.email ?? ''} loggedInName={user.name ?? ''} userRole={user.role} />
            </div>
          ) : user.role === "registrar" ? (
            <div style={{ position: 'relative', width: '100%', minHeight: '100vh', backgroundColor: '#f0f2f5' }}>
              <RegistrarGradesView loggedInEmail={user.email ?? ''} loggedInName={user.name ?? ''} />
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
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;