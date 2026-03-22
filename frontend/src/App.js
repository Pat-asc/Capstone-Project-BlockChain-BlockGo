import React, { useState, useEffect } from "react";
import "./style.css"; 
import "./App.css";   
import Login from "./Login";
import StudentPortal from './StudentPortal';
import FacultyPortal from './FacultyPortal';
import GradesDashboard from './GradesDashboard.jsx';

// Mock Data
const TEST_STUDENT = {
  name: "Mayumi",
  role: "student",
  subjects: [
    { code: "IT-221", name: "Object Oriented Programming", units: 3, midterm: 85, finals: 95 },
    { code: "IT-222", name: "Data Structures", units: 3, midterm: 88, finals: 90 },
    { code: "IT-223", name: "Web Development", units: 3, midterm: 94, finals: 96 },
    { code: "GE-101", name: "Discrete Math", units: 3, midterm: 78, finals: 82 }
  ]
};

const TEST_FACULTY = {
  name: "Juan Rodriguez",
  role: "faculty",
  department: "College of Information Technology",
  status: "Full-Time",
  assignedClass: "IT-221: Object Oriented Programming"
};

const TEST_REGISTRAR = {
  name: "System Registrar",
  role: "registrar",
  department: "Administration"
};

function App() {
  const [user, setUser] = useState(null);

  // --- ADDED: Check for existing valid token on page load ---
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
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

  const handleLoginSuccess = (token) => {
    localStorage.setItem('token', token);
    try {
      // Decode the JWT to securely get the username and role signed by the backend
      const payload = JSON.parse(atob(token.split('.')[1]));
      const email = payload.username;
      
      let rawName = email.split('@')[0];
      rawName = rawName.replace('prof.', '').replace('student.', '').replace('dean.', '').replace('registrar.', '');
      let displayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

      // Map the Fabric MSP Role to the UI Dashboard Layout
      if (payload.role === "FacultyMSP") {
        setUser({ ...TEST_FACULTY, name: `Prof. ${displayName}`, email, role: 'faculty' });
      } else if (payload.role === "DepartmentMSP") {
        setUser({ ...TEST_REGISTRAR, name: `Dean ${displayName}`, email, role: 'dean' });
      } else if (payload.role === "RegistrarMSP") {
        setUser({ ...TEST_REGISTRAR, name: `Registrar ${displayName}`, email, role: 'registrar' });
      } else {
        setUser({ ...TEST_STUDENT, name: displayName, email, role: 'student' });
      }
    } catch (error) {
      console.error("Invalid token format.");
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
          {user.role === "student" ? (
            <StudentPortal studentData={user} onLogout={handleLogout} />
          ) : user.role === "faculty" ? (
            <FacultyPortal facultyData={user} onLogout={handleLogout} />
          ) : (
            <div style={{ position: 'relative', width: '100%', minHeight: '100vh', backgroundColor: '#f0f2f5' }}>
              <div style={{ position: 'absolute', top: '15px', right: '20px', zIndex: 10 }}>
                <button className="logout-btn" onClick={handleLogout} style={{ backgroundColor: '#003366', color: 'white', borderColor: '#003366', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>Logout</button>
              </div>
              {/* Registrar and Dean see the full Blockchain Dashboard */}
              <GradesDashboard loggedInEmail={user.email} loggedInName={user.name} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;