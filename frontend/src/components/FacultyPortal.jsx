import React, { useState, useEffect, useCallback } from 'react';
import { fetchPendingRequests, approveRegistrationRequest, issueGrade } from '../services/api';

const FacultyPortal = ({ facultyData, onLogout }) => {
  const [sections, setSections] = useState({
    "BSIT 2-1": [
      { id: '2023-001', name: 'Juan Dela Cruz', midterm: 85, finals: 90 },
      { id: '2023-002', name: 'Maria Santos', midterm: 70, finals: 75 },
    ],
    "BSIT 2-2": [
      { id: '2023-101', name: 'Ricardo Dalisay', midterm: 88, finals: 82 },
      { id: '2023-102', name: 'Liza Soberano', midterm: 95, finals: 91 },
    ],
    "BSIT 3-1": [
      { id: '2023-201', name: 'Boni Facio', midterm: 75, finals: 80 },
    ]
  });

  const [activeSection, setActiveSection] = useState(null);
  const [showRequests, setShowRequests] = useState(false);
  const [studentRequests, setStudentRequests] = useState([]);
  const [uploadingSection, setUploadingSection] = useState(null);
  const [approvingId, setApprovingId] = useState(null);

  const loadRequests = useCallback(async () => {
      try {
          const response = await fetchPendingRequests();
          if (response.status === 'Success') {
              // Filter students to only show those requesting to join this Professor's department
              const allStudents = response.studentRequests || [];
              const facDept = (facultyData.department || "").toLowerCase();
              
              const filteredStudents = allStudents.filter(req => {
                  if (facDept.includes('information') || facDept.includes('it')) return req.department === 'IT';
                  if (facDept.includes('computer') || facDept.includes('cs')) return req.department === 'CS';
                  if (facDept.includes('civil') || facDept.includes('ce')) return req.department === 'CE';
                  return req.department === facDept; // Fallback
              });
              
              setStudentRequests(filteredStudents);
          }
      } catch (error) {
          console.error('Error loading registration requests:', error);
      }
  }, [facultyData.department]);

  useEffect(() => {
      loadRequests();  // Load on component mount
  }, [loadRequests]);

  const handleApproveRequest = async (id) => {
      setApprovingId(id);
      try {
          // 1. Find the student details before they are removed from the waitlist
          const approvedStudent = studentRequests.find(req => req.requestid === id);
          
          // 2. Approve via the backend API
          await approveRegistrationRequest(id, 'student');
          
          // 3. Automatically add the newly approved student to the Professor's first section
          if (approvedStudent) {
              const firstSection = Object.keys(sections)[0];
              if (firstSection) {
                  setSections(prevSections => ({
                      ...prevSections,
                      [firstSection]: [...prevSections[firstSection], { id: approvedStudent.studentno, name: approvedStudent.fullname, midterm: 0, finals: 0 }]
                  }));
                  alert(`${approvedStudent.fullname} approved and automatically added to ${firstSection}!`);
              }
          } else {
              alert("Student request approved successfully!");
          }
          
          loadRequests(); // Refresh the waitlist automatically
      } catch (error) {
          alert(`Failed to approve request: ${error.message}`);
      } finally {
          setApprovingId(null);
      }
  };

  const calculatePLVPoint = (m, f) => {
    const avg = (parseFloat(m) + parseFloat(f)) / 2;
    if (avg >= 97) return 1.00;
    if (avg >= 94) return 1.25;
    if (avg >= 91) return 1.50;
    if (avg >= 88) return 1.75;
    if (avg >= 85) return 2.00;
    if (avg >= 82) return 2.25;
    if (avg >= 79) return 2.50;
    if (avg >= 76) return 2.75;
    if (avg >= 75) return 3.00;
    return 5.00;
  };

  const handleGradeChange = (sectionName, index, field, value) => {
    const updatedSections = { ...sections };
    updatedSections[sectionName][index][field] = parseFloat(value) || 0;
    setSections(updatedSections);
  };

  const handleUploadToRegistrar = async (sectionName) => {
    const students = sections[sectionName];
    if (students.length === 0) {
      alert("No students in this section to upload.");
      return;
    }

    setUploadingSection(sectionName);
    try {
      // Loop through all students in the section and issue their grades to the blockchain
      for (const stu of students) {
        const finalPoint = calculatePLVPoint(stu.midterm, stu.finals);
        
        // Generate a unique record ID based on student ID, section, and semester
        const recordId = `${stu.id}-${sectionName.replace(/\s+/g, '')}-2ndSem2024`;
        const studentEmail = `student.${stu.name.toLowerCase().split(' ')[0]}@plv.edu.ph`;

        const payload = {
            id: recordId,
            studentHash: studentEmail,
            studentId: stu.id,
            course: sectionName.split(' ')[0] || facultyData.department,
            subjectCode: sectionName, 
            section: sectionName.split(' ')[1] || "A",
            grade: finalPoint.toFixed(2),
            semester: "2nd Semester",
            schoolYear: "2024",
            university: "PLV",
            facultyId: facultyData.email
        };

        await issueGrade(payload, facultyData.email);
      }
      
      alert(`All grades for ${sectionName} have been successfully uploaded to the Registrar/Blockchain!`);
    } catch (error) {
      console.error(error);
      alert(`Failed to upload grades: ${error.message}`);
    } finally {
      setUploadingSection(null);
    }
  };

  const handleFileUpload = async (sectionName, e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingSection(sectionName);
    const formData = new FormData();
    formData.append('excel', file);
    formData.append('facultyId', facultyData.email);

    try {
      const response = await fetch('http://localhost:4000/api/batch-upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (response.ok) {
        alert(data.message);
      } else {
        alert(`Batch upload failed: ${data.error || data.details}`);
      }
    } catch (err) {
      console.error(err);
      alert(`Upload error: ${err.message}`);
    } finally {
      setUploadingSection(null);
    }
  };

  const sectionNames = Object.keys(sections);

  return (
    <div className="portal-container">
    <header className="student-header">
    <div>
        <h1 style={{ margin: 0 }}>Faculty Portal</h1>
        <h2 style={{ fontSize: '1.2rem', opacity: 0.9 }}>{facultyData.name}</h2>
        <p style={{ margin: '5px 0 0 0' }}>{facultyData.department}</p>
        <p style={{ margin: '5px 0 0 0', fontSize: '0.9rem', fontWeight: 'bold', opacity: 0.8 }}>2nd Semester, A.Y. 2023-2024</p>
    </div>

    <div className="summary-section">
    {/* Pending Students Box */}
        <div className="stat-card" style={{ cursor: 'pointer', border: showRequests ? '2px solid #003366' : 'none' }} onClick={() => { setShowRequests(true); setActiveSection(null); }}>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Pending Students</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: studentRequests.length > 0 ? '#d32f2f' : '#333' }}>{studentRequests.length}</div>
        </div>

    {/* Section Count Box */}
        <div className="stat-card" style={{ cursor: 'pointer', border: !showRequests && !activeSection ? '2px solid #003366' : 'none' }} onClick={() => { setShowRequests(false); setActiveSection(null); }}>
                <div style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Sections</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{Object.keys(sections).length}</div>
        </div>

    {/* Employment Status Box (GWA Style) */}
        <div className="stat-card gold">
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Classification</div>
            <div style={{ fontSize: '1.1rem' }}>{facultyData.status}</div>
        </div>

    <button className="logout-btn" onClick={onLogout}>
      LOGOUT
    </button>
  </div>
    </header>

      {/* 2. Dynamic View Content */}
       {showRequests ? (
        <div>
          <button className="drop-btn-small" onClick={() => setShowRequests(false)} style={{ marginBottom: '15px' }}>
            Back to Sections
          </button>
          <div className="table-container">
            <div className="table-header-custom">
              <h3 style={{ padding: '20px', margin: 0 }}>Pending Student Requests</h3>
            </div>
            <table className="plv-table">
              <thead>
                <tr>
                  <th>Student No.</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {studentRequests.length === 0 ? (
                    <tr>
                        <td colSpan="6" style={{ padding: '20px', textAlign: 'center', color: '#777' }}>No pending student requests.</td>
                    </tr>
                ) : (
                    studentRequests.map((req) => (
                        <tr key={req.requestid}>
                            <td className="sub-code">{req.studentno}</td>
                            <td className="sub-title">{req.fullname}</td>
                            <td>{req.email}</td>
                            <td>{req.department}</td>
                            <td><span className="status-pill passed" style={{ backgroundColor: '#fef7e0', color: '#b08d00' }}>{req.requeststatus}</span></td>
                            <td>
                                <button className="sign-in-btn" onClick={() => handleApproveRequest(req.requestid)} style={{ padding: '6px 12px', width: 'auto', margin: 0, opacity: approvingId === req.requestid ? 0.7 : 1, cursor: approvingId === req.requestid ? 'not-allowed' : 'pointer' }} disabled={approvingId === req.requestid}>
                                    {approvingId === req.requestid ? 'Approving...' : 'Approve'}
                                </button>
                            </td>
                        </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : !activeSection ? (
        <div className="section-grid">
          {sectionNames.map((name) => (
            <div key={name} className="stat-card section-card">
              <h3>{name}</h3>
              <p>{sections[name].length} Students</p>
              <div className="section-actions">
                <button className="sign-in-btn" onClick={() => setActiveSection(name)}>
                  View Grades
                </button>
                <label className="upload-label">
                  Upload Grading Sheet
                  <input type="file" accept=".xlsx, .xls" style={{ display: 'none' }} onChange={(e) => handleFileUpload(name, e)} disabled={uploadingSection === name} />
                </label>
                 <button className="upload-btn" onClick={() => handleUploadToRegistrar(name)} style={{ opacity: uploadingSection === name ? 0.7 : 1, cursor: uploadingSection === name ? 'not-allowed' : 'pointer' }} disabled={uploadingSection === name}>
                  {uploadingSection === name ? 'Uploading...' : 'Upload to Registrar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* 3. Grading Table View */
        <div>
          <button className="drop-btn-small" onClick={() => setActiveSection(null)} style={{ marginBottom: '15px' }}>
            Back to Sections
          </button>
          <div className="table-container">
            <div className="table-header-custom">
              <h3 style={{ padding: '20px', margin: 0 }}>Section: {activeSection}</h3>
            </div>
            <table className="plv-table">
              <thead>
                <tr>
                  <th>Student ID</th>
                  <th>Student Name</th>
                  <th>Midterm</th>
                  <th>Finals</th>
                  <th>Final Grade</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sections[activeSection].map((stu, index) => {
                  const finalPoint = calculatePLVPoint(stu.midterm, stu.finals);
                  const isPassed = finalPoint <= 3.0;
                  return (
                    <tr key={stu.id}>
                      <td className="sub-code">{stu.id}</td>
                      <td className="sub-title">{stu.name}</td>
                      <td><input type="number" className="grade-input" value={stu.midterm} onChange={(e) => handleGradeChange(activeSection, index, 'midterm', e.target.value)} /></td>
                      <td><input type="number" className="grade-input" value={stu.finals} onChange={(e) => handleGradeChange(activeSection, index, 'finals', e.target.value)} /></td>
                      <td className="final-point">{finalPoint.toFixed(2)}</td>
                      <td><span className={`status-pill ${isPassed ? 'passed' : 'failed'}`}>{isPassed ? "PASSED" : "FAILED"}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default FacultyPortal;