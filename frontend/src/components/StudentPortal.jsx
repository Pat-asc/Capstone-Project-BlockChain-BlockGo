import React, { useState, useEffect } from 'react';
import { fetchAllGrades } from '../services/api';

const StudentPortal = ({ studentData, onLogout }) => {
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadGrades = async () => {
      setLoading(true);
      try {
        const response = await fetchAllGrades(studentData.email);
        let allGrades = [];
        
        // Handle different backend response structures safely
        if (Array.isArray(response)) {
            allGrades = response;
        } else if (response.status === 'Success' && response.data) {
            allGrades = response.data;
        }

        // Filter strictly to only show the logged-in student's records
        const myGrades = allGrades.filter(g => 
            g.student_hash === studentData.email || 
            g.studentId === studentData.email ||
            g.studentId === studentData.email.split('@')[0]
        );
        
        setGrades(myGrades);
      } catch (error) {
        console.error('Error fetching grades from blockchain:', error);
      }
      setLoading(false);
    };

    loadGrades();
  }, [studentData.email]);

  // 2. Calculate Semester Totals
  const totalUnits = grades.length * 3; // Assuming 3 units per subject block for now
  
  const totalWeight = grades.reduce((sum, sub) => sum + ((parseFloat(sub.grade) || 0) * 3), 0);

  const calculatedGWA = totalUnits > 0 ? (totalWeight / totalUnits).toFixed(2) : "0.00";

  // 3. Status logic: Dean's List eligibility check
  const isDeansLister = grades.length > 0 && calculatedGWA <= 1.75 && grades.every(s => parseFloat(s.grade) <= 2.25);

  return (
    <div className="portal-container">
      {/* 1. Header with Stats, Branding, & LOGOUT */}
      <header className="student-header">
        <div className="student-info">
          <h2>{studentData.name}</h2>
          <p>Student ID: {studentData.studentNo || 'N/A'}</p>
          {isDeansLister && <span className="deans-lister-badge"> DEAN'S LISTER</span>}
        </div>
        
        <div className="summary-section">
          <div className="stat-card">
            <span>TOTAL UNITS</span>
            <h3>{totalUnits}</h3>
          </div>
          <div className="stat-card gold">
            <span>SEMESTER GWA</span>
            <h3>{calculatedGWA}</h3>
          </div>
          
          {/* Logout Button: Triggers session reset in App.js */}
          <button className="logout-btn" onClick={onLogout}>
            LOGOUT
          </button>
        </div>
      </header>

      {/* 2. Grade Table */}
      <div className="table-container">
        {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', fontSize: '1.2rem', color: '#003366', fontWeight: 'bold' }}>
                 Syncing Records with Blockchain Ledger...
            </div>
        ) : (
        <table className="plv-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Course</th>
              <th>Units</th>
              <th>Final Grade</th>
              <th>Ledger Status</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {grades.length === 0 ? (
                <tr>
                    <td colSpan="6" style={{ padding: '20px', textAlign: 'center', color: '#777' }}>No ledger records found for your account yet.</td>
                </tr>
            ) : (
            grades.map((sub, index) => {
              const finalPoint = parseFloat(sub.grade) || 0;
              const passed = finalPoint <= 3.0 && finalPoint > 0;

              return (
                <tr key={sub.id || index}>
                  <td className="sub-code">{sub.subject_code || 'N/A'}</td>
                  <td className="sub-title">{sub.course || 'N/A'}</td>
                  <td className="units-count">3</td>
                  <td className="final-point">{finalPoint.toFixed(2)}</td>
                  <td>
                    <span className="status-pill passed" style={{ backgroundColor: sub.status === 'Finalized' ? '#e6f4ea' : '#e8f0fe', color: sub.status === 'Finalized' ? '#1e8e3e' : '#1967d2' }}>
                      {sub.status || "Issued"}
                    </span>
                  </td>
                  <td>
                    <span className={`status-pill ${passed ? 'passed' : 'failed'}`}>
                      {passed ? "PASSED" : "FAILED"}
                    </span>
                  </td>
                </tr>
              );
            })
            )}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
};

export default StudentPortal;