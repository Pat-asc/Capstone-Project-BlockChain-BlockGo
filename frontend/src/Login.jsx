// src/Login.jsx
import React, { useState } from 'react'; // Added useState
import './App.css';
import plvbg from './plvbg.png';
import plvlogo from './plvlogo.png';
import { submitRegistrationRequest } from './api';

const Login = ({ onLogin }) => { // Accept onLogin prop from App.js
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("student");
  const [department, setDepartment] = useState("CS");
  const [studentNo, setStudentNo] = useState("");

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      alert(data.message || "If that email exists, a reset link has been sent.");
      setIsForgotPassword(false);
    } catch (error) {
      alert("Error requesting password reset.");
    }
  };

  const handleSubmit = async (e) => {
  e.preventDefault();
  
  if (isSignup) {
    try {
        await submitRegistrationRequest({ fullName, email, password, role, department, studentNo: role === 'student' ? studentNo : undefined });
        alert("Registration request sent! Please wait for administrative approval.");
        setIsSignup(false);
    } catch (error) {
        alert("Failed to send registration request: " + error.message);
    }
    return;
  }

  try {
    // Authenticate against the Node.js backend
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password: password })
    });
    const data = await response.json();
    
    if (response.ok && data.token) {
      onLogin(data.token);
    } else {
      alert(data.error || "Login failed. Please check your credentials.");
    }
  } catch (error) {
    alert("Error connecting to the server: " + error.message);
  }
};

  return (
    <div className="login-container">
      <div 
        className="login-image-section" 
        style={{ backgroundImage: `url(${plvbg})` }}
      >
        
      </div>

      <div className="login-form-section">
        <div className="login-card">
          <img src={plvlogo} alt="PLV Logo" className="plv-logo" />
          

          <h2 className="welcome-text">{isSignup ? "Request System Access" : "Welcome"}</h2>
          
          {/* Added onSubmit handler */}
          <form className="login-form" onSubmit={handleSubmit} style={isSignup ? { maxHeight: '55vh', overflowY: 'auto', paddingRight: '10px' } : {}}>
            
            {/* Conditionally show Signup Fields */}
            {isSignup && (
              <>
                <div className="input-group">
                  <label>Full Name</label>
                  <input type="text" placeholder="e.g. Juan Dela Cruz" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
                <div className="input-group">
                  <label>Role</label>
                  <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid #ddd', borderRadius: '8px', boxSizing: 'border-box' }}>
                    <option value="student">Student</option>
                    <option value="faculty">Faculty / Professor</option>
                  </select>
                </div>
                {role === "student" && (
                  <div className="input-group">
                    <label>Student No.</label>
                    <input 
                      type="text" 
                      pattern="\d{2}-\d{4}" 
                      title="Format: YY-NNNN (e.g., 25-5055)" 
                      placeholder="e.g. 25-5055" 
                      value={studentNo} 
                      onChange={(e) => setStudentNo(e.target.value)} 
                      required 
                    />
                  </div>
                )}
                <div className="input-group">
                  <label>Department / College</label>
                  <select value={department} onChange={(e) => setDepartment(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid #ddd', borderRadius: '8px', boxSizing: 'border-box' }}>
                    <option value="CS">Computer Science</option>
                    <option value="IT">Information Technology</option>
                    <option value="CE">Civil Engineering</option>
                  </select>
                </div>
              </>
            )}

            <div className="input-group">
              <label>Email</label>
              <input 
              type="email" 
              placeholder="e.g. registrar@plv.edu.ph"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required 
              />
            </div>
            
            <div className="input-group">
              <label>Password</label>
              <input 
                type="password" 
                placeholder="Password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)} // Update password state
                required 
              />
            </div>

            <button type="submit" className="sign-in-btn">{isSignup ? "Submit Request" : "Sign In"}</button>
          </form>

          <p className="forgot-password" onClick={() => setIsSignup(!isSignup)} style={{ cursor: 'pointer', color: '#003366', fontWeight: 'bold', marginTop: '15px' }}>
            {isSignup ? "Already have an account? Sign In" : "Don't have an account? Request Access"}
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
