import React, { useState, useEffect } from "react";
import "./assets/style.css"; 
import "./assets/App.css";   
import Login from "./components/Login";
import { fetchUserProfile } from './services/api'; // Import the new API function
import StudentPortal from './components/StudentPortal';
import FacultyPortal from './components/FacultyPortal';
import GradesDashboard from './components/GradesDashboard';

function App() {
  const [user, setUser] = useState(null);

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

  const handleLoginSuccess = async (token) => { // Made async
    localStorage.setItem('token', token);
    try {
      // Decode the JWT to securely get the username and role signed by the backend
      const payload = JSON.parse(atob(token.split('.')[1]));
      const email = payload.username;
      const dbRole = payload.dbRole; // Get the database role from the JWT

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
              <GradesDashboard loggedInEmail={user.email ?? ''} loggedInName={user.name ?? ''} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;