// src/Login.jsx
import React, { useState, useEffect } from 'react';
import '../assets/App.css';
import plvbg from '../assets/plvbg.png';
import plvlogo from '../assets/plvlogo.png';
import { submitRegistrationRequest, sendVerificationCode } from '../services/api';

const Login = ({ onLogin }) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [currentView, setCurrentView] = useState('signIn');
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("student");
  const [department, setDepartment] = useState("CS");
  const [studentNo, setStudentNo] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [signupStep, setSignupStep] = useState(1);
  const [verificationCode, setVerificationCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token || window.location.pathname.includes('/reset-password')) {
      if (token) setResetToken(token);
      setCurrentView('resetPassword');
    }
  }, []);

  const validatePassword = (pwd) => {
    if (pwd.length < 8) return "Password must be at least 8 characters long.";
    if (!/[A-Z]/.test(pwd)) return "Password must contain at least one uppercase letter.";
    if (!/[a-z]/.test(pwd)) return "Password must contain at least one lowercase letter.";
    if (!/\d/.test(pwd)) return "Password must contain at least one number.";
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) return "Password must contain at least one special character.";
    return "";
  };

  const handleSendCode = async (e) => {
    e.preventDefault();

    // Email validation
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    // Validate password before proceeding to the next step
    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (!email) {
      setError('Email is required to send a verification code.');
      return;
    }

    setIsLoading(true);
    setError('');
    try {
        await sendVerificationCode(email);
        setMessage(`Verification code sent to ${email}. Please check your inbox.`);
        setSignupStep(2);
    } catch (error) {
        setError(error.message || 'Failed to send verification code.');
    } finally {
        setIsLoading(false);
    }
  };

  const handleSignupSubmit = async (e) => {
    e.preventDefault();

    setIsLoading(true);
    setError('');
    try {
        await submitRegistrationRequest({ fullName, email, password, role, department, studentNo: role === 'student' ? studentNo : undefined, verificationCode });
        setMessage("Registration request submitted successfully! Please wait for registrar approval.");
        setCurrentView('signIn'); // Go back to login screen
        setSignupStep(1);   // Reset signup flow
    } catch (error) {
        setError(error.message || 'Signup failed. Please check your details.');
    } finally {
        setIsLoading(false);
    }
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('http://localhost:4000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email, password: password })
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error(`Server returned an HTML error page. The Node.js Middleware is down or Nginx cannot reach it. Raw response: ${text.substring(0, 30)}...`);
      }

      if (response.ok && data.token) onLogin(data.token);
      else setError(data.error || "Login failed. Invalid email or password.");
    } catch (error) {
      setError("Error connecting to the server: " + error.message);
    }
    setIsLoading(false);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setIsLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('http://localhost:4000/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error(`Server returned an HTML error page. The Node.js Middleware is down. Raw response: ${text.substring(0, 30)}...`);
      }

      if (!response.ok) throw new Error(data.message || 'An error occurred.');
      setMessage(data.message);
    } catch (error) {
      setError(error.message);
    }
    setIsLoading(false);
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setIsLoading(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('http://localhost:4000/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword: password })
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        throw new Error(`Server returned an HTML error page. The Node.js Middleware is down. Raw response: ${text.substring(0, 30)}...`);
      }

      if (!response.ok) throw new Error(data.error || data.message || 'An error occurred.');
      setMessage(data.message || 'Password updated successfully.');
      setTimeout(() => {
        setCurrentView('signIn');
        setPassword('');
        setConfirmPassword('');
        window.history.replaceState({}, document.title, "/"); // Clean up the URL
      }, 3000);
    } catch (error) {
      setError(error.message);
    }
    setIsLoading(false);
  };

  return (
    <div className="login-container">
      <style>
        {`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 1s ease-in-out infinite;
            margin-right: 10px;
            vertical-align: middle;
          }
        `}
      </style>
      <div 
        className="login-image-section" 
        style={{ backgroundImage: `url(${plvbg})` }}
      >
        
    </div>

      <div className="login-form-section">
        <div className="login-card">
          <img src={plvlogo} alt="PLV Logo" className="plv-logo" />
          

          <h2 className="welcome-text">
            {currentView === 'signIn' && "Welcome"}
            {currentView === 'signUp' && "Request System Access"}
            {currentView === 'forgotPassword' && "Reset Password"}
            {currentView === 'resetPassword' && "Create New Password"}
          </h2>
          {error && <p style={{ color: 'red', textAlign: 'center' }}>{error}</p>}
          {message && <p style={{ color: 'green', textAlign: 'center' }}>{message}</p>}
          
          {/* SIGN UP FORM */}
          {currentView === 'signUp' && (
            <form className="login-form" 
              onSubmit={signupStep === 1 ? handleSendCode : handleSignupSubmit} 
              style={{ maxHeight: '55vh', overflowY: 'auto', paddingRight: '10px' }}
            >
              <>
                {/* Signup Fields */}
                <div className="input-group">
                  <label>Full Name</label>
                  <input type="text" placeholder="e.g. Juan Dela Cruz" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
                <div className="input-group">
                  <label>I am a...</label>
                  <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid #ddd', borderRadius: '8px', boxSizing: 'border-box' }}>
                    <option value="student">Student</option>
                    <option value="faculty">Faculty / Professor</option>
                    <option value="department_admin">Department Admin</option>
                  </select>
                </div>
                {role === "student" && (
                  <div className="input-group">
                    <label>Student No.</label>
                    <input 
                      type="text" 
                      pattern="\\d{2}-\\d{4}" 
                      title="Format: YY-NNNN (e.g., 25-5055)" 
                      placeholder="e.g. 25-5055" 
                      value={studentNo} 
                      onChange={(e) => setStudentNo(e.target.value)} 
                      required 
                    />
                  </div>
                )}
                {role === "student" && (
                  <div className="input-group">
                    <label>Date of Birth (mm/dd/yyyy) *</label>
                    <input 
                      type="text" 
                      pattern="\\d{2}/\\d{2}/\\d{4}" 
                      title="Format: mm/dd/yyyy (e.g., 05/15/2005)" 
                      placeholder="e.g. 05/15/2005" 
                      id="dobField"
                      value={dateOfBirth} 
                      onChange={(e) => setDateOfBirth(e.target.value)} 
                      required 
                    />
                    <small style={{color: '#666', fontSize: '12px'}}>This will be your default password</small>
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
                <div className="input-group">
                  <label>Email</label>
                  <input 
                    type="email" 
                    placeholder="e.g. registrar@plv.edu.ph"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required 
                    disabled={signupStep === 2}
                  />
                </div>
                {signupStep === 1 && (
                  <div className="input-group">
                    <label>Password</label>
                    <input 
                      type="password" 
                      placeholder="Password" 
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required 
                    />
                  </div>
                )}
                {signupStep === 2 && (
                  <div className="input-group">
                    <label>Verification Code</label>
                    <input type="text" placeholder="6-digit code from your email" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} required />
                  </div>
                )}
                <button type="submit" className="sign-in-btn" disabled={isLoading}>
                  {isLoading ? (<><span className="spinner"></span> Processing...</>) :
                    (signupStep === 1 ? 'Send Verification Code' : 'Complete Signup')
                  }
                </button>
              </>
            </form>
          )}

          {/* SIGN IN FORM */}
          {currentView === 'signIn' && (
            <form className="login-form" onSubmit={handleLoginSubmit}>
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
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required 
                />
              </div>
              <button type="submit" className="sign-in-btn" disabled={isLoading}>
                {isLoading ? (<><span className="spinner"></span> Signing In...</>) : 'Sign In'}
              </button>
              <p className="forgot-password" onClick={() => { setCurrentView('forgotPassword'); setError(''); setMessage(''); }} style={{ cursor: 'pointer', color: '#003366', fontWeight: 'normal', marginTop: '10px', textAlign: 'right' }}>
                Forgot Password?
              </p>
            </form>
          )}

          {/* FORGOT PASSWORD FORM */}
          {currentView === 'forgotPassword' && (
            <form className="login-form" onSubmit={handleForgotPassword}>
              <p style={{ textAlign: 'center', marginBottom: '15px', color: '#666' }}>Enter your email to receive a password reset link.</p>
              <div className="input-group">
                <label>Email</label>
                <input type="email" placeholder="Your registered email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <button type="submit" className="sign-in-btn" disabled={isLoading}>
                {isLoading ? (<><span className="spinner"></span> Sending...</>) : 'Send Reset Link'}
              </button>
            </form>
          )}

          {/* RESET PASSWORD FORM */}
          {currentView === 'resetPassword' && (
            <form className="login-form" onSubmit={handleResetSubmit}>
              <p style={{ textAlign: 'center', marginBottom: '15px', color: '#666' }}>Enter your new password below.</p>
              <div className="input-group">
                <label>New Password</label>
                <input type="password" placeholder="New Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div className="input-group">
                <label>Confirm Password</label>
                <input type="password" placeholder="Confirm New Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
              </div>
              <button type="submit" className="sign-in-btn" disabled={isLoading}>
                {isLoading ? (<><span className="spinner"></span> Updating...</>) : 'Update Password'}
              </button>
            </form>
          )}

          {currentView !== 'resetPassword' && (
            <p className="toggle-view" onClick={() => { setCurrentView(currentView === 'signIn' || currentView === 'forgotPassword' ? 'signUp' : 'signIn'); setError(''); setMessage(''); }} style={{ cursor: 'pointer', color: '#003366', fontWeight: 'bold', marginTop: '15px' }}>
              {currentView === 'signIn' || currentView === 'forgotPassword' ? "Don't have an account? Request Access" : "Already have an account? Sign In"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
export default Login;
