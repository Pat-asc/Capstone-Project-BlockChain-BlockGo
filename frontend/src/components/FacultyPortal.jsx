import React, { useState, useCallback, useEffect } from 'react';
import plvlogo from '../assets/plvlogo.png';
import DownloadGradingSheetButton from './DownloadGradingSheetButton';
import '../assets/FacultyPortal.css';

const FacultyPortal = ({ facultyData, onLogout }) => {
  const [activeSection, setActiveSection] = useState(null);
  const [activeTab, setActiveTab] = useState("All Sections");
  const [searchQuery, setSearchQuery] = useState("");
  const [rowSaveState, setRowSaveState] = useState({});
  const [sectionStatus, setSectionStatus] = useState({});
  const [validationErrors, setValidationErrors] = useState({});
  
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [templateColumns, setTemplateColumns] = useState({});
  const [uploadingSection, setUploadingSection] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);
  const [isLoadingData, setIsLoadingData] = useState(true);

  const [sections, setSections] = useState({});

  const loadFacultyData = useCallback(async () => {
    setIsLoadingData(true);
    try {
      const token = localStorage.getItem('token');
      
      const sectionsRes = await fetch(`/api/Auth/faculty/${facultyData.email}/assigned-sections`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const sectionsData = await sectionsRes.json();

      const studentsRes = await fetch(`/api/Auth/students/approved`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const studentsData = await studentsRes.json();

      if (sectionsData.status === "Success" && studentsData.status === "Success") {
        const newSections = {};
        const allStudents = studentsData.students || [];

        sectionsData.sections.forEach(sec => {
          const sectionKey = `${sec.department} ${sec.section}`; 
          
          const enrolledStudents = allStudents.filter(s => 
            s.department === sec.department && 
            s.section === sec.section && 
            s.assignmentStatus === 'Enrolled'
          ).map(s => ({
            id: s.studentno || 'N/A',
            name: s.fullname,
            midterm: 0,
            finals: 0,
            remarks: 'Incomplete',
            customGrades: {}
          }));

          newSections[sectionKey] = {
            year: sec.yearLevel ? `${sec.yearLevel} Year` : "N/A",
            subjectCode: `${sec.department}-${sec.section}`, 
            subjectTitle: `Assigned Subject (${sec.department})`, 
            sectionCourse: sec.department,
            students: enrolledStudents
          };
        });

        setSections(newSections);
      }
    } catch (error) {
      console.error("Failed to load faculty sections:", error);
    } finally {
      setIsLoadingData(false);
    }
  }, [facultyData.email]);

  useEffect(() => {
    loadFacultyData();
  }, [loadFacultyData]);

  const totalSections = Object.keys(sections).length;

  const ENCODING_START = new Date('2026-04-01T00:00:00');
  const ENCODING_END   = new Date('2026-04-10T23:59:59');
  const now            = new Date();
  const msLeft         = ENCODING_END - now;
  const daysLeft       = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  const isClosed       = now < ENCODING_START || now > ENCODING_END;
  const isUrgent       = !isClosed && daysLeft <= 3;
  const isOpen         = !isClosed && !isUrgent;

  const getBannerState = () => {
    if (now > ENCODING_END)   return 'closed_after';
    if (now < ENCODING_START) return 'closed_before';
    if (isUrgent)             return 'urgent';
    return 'open';
  };
  const bannerState = getBannerState();

  const formatDate = (date) =>
    date.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });

  const tabData = ["All Sections", "1st Year", "2nd Year", "3rd Year", "4th Year"].map(label => {
    const count = label === "All Sections"
      ? totalSections
      : Object.values(sections).filter(s => s.year === label).length;
    const colors = { "All Sections": "gold", "1st Year": "blue", "2nd Year": "green", "3rd Year": "red", "4th Year": "green" };
    return { label, count, color: colors[label], progress: totalSections > 0 ? (count / totalSections) * 100 : 0 };
  });

  const calculatePLVPoint = (stu) => {
    let customAvg = 0;
    if (stu.customGrades && Object.keys(stu.customGrades).length > 0) {
        const vals = Object.values(stu.customGrades);
        const sum = vals.reduce((a, b) => a + (parseFloat(b) || 0), 0);
        customAvg = sum / vals.length;
    }

    const mid = parseFloat(stu.midterm) || 0;
    const fin = parseFloat(stu.finals) || 0;
    let avg = 0;
    if (customAvg > 0) {
        avg = (customAvg * 0.40) + (mid * 0.30) + (fin * 0.30);
    } else {
        avg = (mid + fin) / 2;
    }

    if (avg === 0) return 0.00;
    if (avg >= 98.5) return 1.00;
    if (avg >= 97) return 1.00;
    if (avg >= 94) return 1.25;
    if (avg >= 91) return 1.50;
    if (avg >= 88) return 1.75;
    if (avg >= 85) return 2.00;
    if (avg >= 82) return 2.25;
    if (avg >= 79) return 2.50;
    if (avg >= 75) return 3.00;
    return 5.00;
  };

  const getRemarks = (pt, midterm, finals) => {
    if (parseFloat(midterm) === 0 && parseFloat(finals) === 0) return 'Incomplete';
    if (pt === 0)     return 'Incomplete';
    if (pt <= 3.00)   return 'Passed';
    return 'Failed';
  };

  const validateGrade = (value) => {
    const num = parseFloat(value);
    if (value === '' || value === '0' || num === 0) return '';
    if (isNaN(num)) return 'Must be a number';
    if (num < 60 || num > 100) return 'Must be 60–100';
    return '';
  };

  const handleGradeChange = useCallback((sectionName, index, field, value) => {
    if (sectionStatus[sectionName] === 'finalized') return;
    const error = validateGrade(value);
    setValidationErrors(prev => ({
      ...prev,
      [sectionName]: { ...prev[sectionName], [index]: { ...(prev[sectionName]?.[index] || {}), [field]: error } }
    }));
    
    const updated = JSON.parse(JSON.stringify(sections));
    updated[sectionName].students[index][field] = value === '' ? 0 : parseFloat(value) || 0;
    
    const stu = updated[sectionName].students[index];
    const pt = calculatePLVPoint(stu);
    stu.remarks = getRemarks(pt, stu.midterm, stu.finals);
    
    setSections(updated);
    setRowSaveState(prev => ({ ...prev, [sectionName]: { ...(prev[sectionName] || {}), [index]: 'idle' } }));
  }, [sections, sectionStatus]);

  const handleCustomGradeChange = useCallback((sectionName, index, colId, value) => {
    if (sectionStatus[sectionName] === 'finalized') return;
    const updated = JSON.parse(JSON.stringify(sections));
    
    if (!updated[sectionName].students[index].customGrades) {
        updated[sectionName].students[index].customGrades = {};
    }
    updated[sectionName].students[index].customGrades[colId] = parseFloat(value) || 0;

    const stu = updated[sectionName].students[index];
    const pt = calculatePLVPoint(stu);
    stu.remarks = getRemarks(pt, stu.midterm, stu.finals);

    setSections(updated);
    setRowSaveState(prev => ({ ...prev, [sectionName]: { ...(prev[sectionName] || {}), [index]: 'idle' } }));
  }, [sections, sectionStatus]);

  const handleFileUpload = async (sectionName, e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingSection(sectionName);
    const formData = new FormData();
    formData.append('excel', file);
    formData.append('facultyId', facultyData.email);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:4000/api/batch-upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      const data = await response.json();
      if (response.ok) {
        setUploadResult({ type: 'success', title: 'Upload Successful', message: data.message, details: data.output });
      } else {
        setUploadResult({ type: 'error', title: 'Batch Upload Failed', message: data.error || data.details || 'Unknown error', details: data.output || data.errorOutput || '' });
      }
    } catch (err) {
      console.error(err);
      setUploadResult({ type: 'error', title: 'Upload Error', message: err.message });
    } finally {
      setUploadingSection(null);
      e.target.value = null; 
    }
  };

  const handleSaveRow = (sectionName, index) => {
    const errors = validationErrors[sectionName]?.[index] || {};
    if (errors.midterm || errors.finals) return;
    setRowSaveState(prev => ({ ...prev, [sectionName]: { ...(prev[sectionName] || {}), [index]: 'saving' } }));
    setTimeout(() => {
      setRowSaveState(prev => ({ ...prev, [sectionName]: { ...(prev[sectionName] || {}), [index]: 'saved' } }));
    }, 800);
  };

  const handleSaveAll = (sectionName) => {
    const students = sections[sectionName].students;
    const saving = {};
    students.forEach((_, i) => { saving[i] = 'saving'; });
    setRowSaveState(prev => ({ ...prev, [sectionName]: saving }));
    setTimeout(() => {
      const saved = {};
      students.forEach((_, i) => { saved[i] = 'saved'; });
      setRowSaveState(prev => ({ ...prev, [sectionName]: saved }));
      setSectionStatus(prev => ({ ...prev, [sectionName]: 'draft' }));
    }, 1000);
  };

  const handleSubmit = (sectionName) => {
    handleSaveAll(sectionName);
    setTimeout(() => {
      setSectionStatus(prev => ({ ...prev, [sectionName]: 'submitted' }));
    }, 1200);
  };

  const handleFinalize = (sectionName) => {
    if (window.confirm(`Finalize grades for ${sectionName}? This action cannot be undone and grades will be locked.`)) {
      setSectionStatus(prev => ({ ...prev, [sectionName]: 'finalized' }));
    }
  };

  const hasValidationErrors = (sectionName) => {
    const errs = validationErrors[sectionName] || {};
    return Object.values(errs).some(row => row.midterm || row.finals);
  };

  const currentStatus = activeSection ? sectionStatus[activeSection] : null;
  const isFinalized = currentStatus === 'finalized';

  return (
    <div className="portal-container">
      <nav className="header-greetings">
        <div className="greeting-text">
          <div className="greeting-text-content">
            <img src={plvlogo} alt="PLV Logo" className="plv-header-logo" />
            <h1>Welcome, {facultyData.sex === "Male" ? "Mr." : "Ms."} {facultyData.lastName}!</h1>
          </div>
          <button className="logout-btn" onClick={onLogout}>LOGOUT</button>
        </div>
      </nav>

      <header className="student-header">
        <div>
          <h1 style={{ margin: 0 }}>{facultyData.firstName} {facultyData.lastName}</h1>
          <h2 style={{ fontSize: '1.2rem', opacity: 0.9 }}>{facultyData.facultyId}</h2>
          <h2 style={{ fontSize: '1.2rem', opacity: 0.9 }}>{facultyData.name}</h2>
          <p>{facultyData.department}</p>
        </div>
        <div className="summary-section">
          <div className="stat-card"><span>Sections</span><div className="stat-val">{totalSections}</div></div>
          <div className="stat-card gold"><span>Classification</span><div className="stat-val">{facultyData.status}</div></div>
        </div>
      </header>

      {bannerState === 'closed_after' && (
        <div className="encoding-banner banner-closed">
          <div className="banner-icon-wrap closed-icon">🔒</div>
          <div>
            <strong>Grade Encoding Period is currently Closed</strong>
            <p>The encoding deadline has passed as of <strong>{formatDate(ENCODING_END)}</strong>. Contact or visit the Registrar's Office for any concerns.</p>
          </div>
        </div>
      )}

      {bannerState === 'closed_before' && (
        <div className="encoding-banner banner-closed">
          <div>
            <strong>Grade Encoding Period has not started yet</strong>
            <p>Encoding opens on <strong>{formatDate(ENCODING_START)}</strong>. Please check back then.</p>
          </div>
        </div>
      )}

      {bannerState === 'open' && (
        <div className="encoding-banner banner-open">
          <div>
            <strong>Grade Encoding Period is Open!</strong>
            <p>Finalize your section grades and upload to the Registrar by <strong>{formatDate(ENCODING_END)}</strong></p>
          </div>
        </div>
      )}

      {bannerState === 'urgent' && (
        <div className="encoding-banner banner-urgent">
          <div>
            <strong>Encoding Deadline in {daysLeft} {daysLeft === 1 ? 'Day' : 'Days'}!</strong>
            <p>You have <strong>{daysLeft} {daysLeft === 1 ? 'day' : 'days'}</strong> left to submit grades before the deadline on <strong>{formatDate(ENCODING_END)}</strong>. Please upload immediately to avoid penalties.</p>
          </div>
        </div>
      )}

      {!activeSection ? (
        <>
          <div className="filter-tabs-container">
            {tabData.map((tab) => (
              <div key={tab.label} className={`filter-tab ${activeTab === tab.label ? 'active' : ''}`} onClick={() => setActiveTab(tab.label)}>
                <div className="tab-top">
                  <span className="tab-label">{tab.label}</span>
                  <span className="tab-count-pill">{tab.count}</span>
                </div>
                <div className="tab-progress-bg">
                  <div className={`tab-progress-bar ${tab.color}`} style={{ width: `${tab.progress}%` }}></div>
                </div>
              </div>
            ))}
          </div>

          <div className="search-row">
            <div className="search-container">
              <input type="text" placeholder="Search for a section (e.g. BSIT 2-1)..." className="search-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              <span className="search-icon">🔍</span>
            </div>
          </div>

          <h2 className="year-title">{searchQuery ? `Results for "${searchQuery}"` : `${activeTab} Sections`}</h2>

          <div className="section-grid">
            {isLoadingData ? (
              <div style={{ textAlign: 'center', padding: '40px', gridColumn: '1 / -1', color: '#666' }}>
                  <p>Loading assigned sections and enrolled students...</p>
              </div>
            ) : Object.keys(sections).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', gridColumn: '1 / -1', color: '#666' }}>
                  <p>No sections are currently assigned to you.</p>
              </div>
            ) : (
              Object.entries(sections)
              .filter(([name, data]) => {
                const matchesTab = activeTab === "All Sections" || data.year === activeTab;
                const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase());
                return matchesTab && matchesSearch;
              })
              .map(([sectionName, sectionData]) => {
                const total = sectionData.students.length;
                const encoded = sectionData.students.filter(s => parseFloat(s.midterm) > 0 || parseFloat(s.finals) > 0).length;
                const fullyEncoded = sectionData.students.every(s => parseFloat(s.midterm) > 0 && parseFloat(s.finals) > 0);
                const partiallyEncoded = encoded > 0 && !fullyEncoded;
                const notEncoded = encoded === 0;
                const progressPct = total > 0 ? Math.round((encoded / total) * 100) : 0;
                const secStatus = sectionStatus[sectionName];

                const dotClass = secStatus === 'finalized' ? 'dot-finalized' : secStatus === 'submitted' ? 'dot-submitted' : fullyEncoded ? 'dot-done' : partiallyEncoded ? 'dot-partial' : 'dot-none';
                const statusLabel = secStatus === 'finalized' ? 'Finalized' : secStatus === 'submitted' ? 'Submitted' : fullyEncoded ? 'Encoded' : partiallyEncoded ? 'In Progress' : 'Not Started';
                const statusClass = secStatus === 'finalized' ? 'status-finalized' : secStatus === 'submitted' ? 'status-submitted' : fullyEncoded ? 'status-done' : partiallyEncoded ? 'status-partial' : 'status-none';
                const barClass = secStatus === 'finalized' ? 'bar-finalized' : secStatus === 'submitted' ? 'bar-submitted' : fullyEncoded ? 'bar-done' : partiallyEncoded ? 'bar-partial' : 'bar-none';

                return (
                  <div key={sectionName} className="section-card">
                    <div className="card-top-row">
                      <div className="subject-pill">{sectionData.subjectCode}</div>
                      <div className={`status-dot-wrap ${dotClass}`}>
                        <div className="status-dot"></div>
                        <span className={`status-dot-label ${statusClass}`}>{statusLabel}</span>
                      </div>
                    </div>
                    <h2 className="subject-title">{sectionData.subjectTitle}</h2>
                    <div className="section-dept-row">
                      <span className="section-name">{sectionName}</span>
                      <span className="dept-pill">{sectionData.sectionCourse}</span>
                    </div>
                    <hr className="card-divider" />
                    <div className="card-stats">
                      <span>Students: {total}</span>
                      <span>SY: 2025-2026</span>
                      <span>Semester: 2nd</span>
                    </div>
                    <div className="encode-progress-wrap">
                      <div className="encode-progress-top">
                        <span className="encode-progress-label">Encoding progress</span>
                        <span className={`encode-progress-pct ${statusClass}`}>{progressPct}%</span>
                      </div>
                      <div className="encode-bar-track">
                        <div className={`encode-bar-fill ${barClass}`} style={{ width: `${progressPct}%` }}></div>
                      </div>
                    </div>
                    <div className="section-actions">
                      <button className={`view-btn ${notEncoded ? 'encode-now' : ''}`} onClick={() => setActiveSection(sectionName)}>
                        {notEncoded ? 'Encode Now' : 'View Grades'}
                      </button>
                      
                      <button className="upload-label" style={{ backgroundColor: '#ffc107', color: '#000', border: 'none' }} onClick={() => setEditingTemplate(editingTemplate === sectionName ? null : sectionName)}>
                        {editingTemplate === sectionName ? 'Close Rules' : 'Edit Grading Rules'}
                      </button>

                    <DownloadGradingSheetButton department={sectionData.sectionCourse} section={sectionName.split(' ')[1] || sectionName} />

                      <label className="upload-label" style={{ background: '#f0fdf4', color: '#166534' }}>
                        {uploadingSection === sectionName ? 'Uploading...' : 'Upload Grading Sheet'}
                        <input type="file" className="upload-input-hidden" accept=".xlsx, .xls" onChange={(e) => handleFileUpload(sectionName, e)} disabled={uploadingSection === sectionName} />
                      </label>
                      <button className="registrar-btn">Upload to Registrar</button>
                    </div>

                    {editingTemplate === sectionName && (
                      <div style={{ marginTop: '15px', padding: '15px', backgroundColor: '#f8f9fa', border: '1px solid #ddd', borderRadius: '14px', textAlign: 'left' }}>
                          <h4 style={{ margin: '0 0 10px 0', color: '#003366', fontSize: '0.9rem' }}>Add Custom Column (Class Standing)</h4>
                          <ul style={{ paddingLeft: '20px', marginBottom: '10px', fontSize: '0.85rem', color: '#555' }}>
                              {(templateColumns[sectionName] || []).map(col => <li key={col.id}>{col.label}</li>)}
                          </ul>
                          <div style={{ display: 'flex', gap: '10px' }}>
                              <input type="text" id={`new-col-${sectionName}`} placeholder="e.g. Absences, Quizzes..." style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid #ccc' }} />
                              <button className="btn-submit" style={{ width: 'auto', margin: 0, padding: '8px 16px' }} onClick={() => {
                                  const input = document.getElementById(`new-col-${sectionName}`);
                                  if(input && input.value) {
                                      const cols = templateColumns[sectionName] || [];
                                      setTemplateColumns({...templateColumns, [sectionName]: [...cols, { id: Date.now().toString(), label: input.value }]});
                                      input.value = '';
                                  }
                              }}>Add</button>
                          </div>
                      </div>
                    )}
                  </div>
                );
              }))}
          </div>
        </>
      ) : (
        <div className="grading-view">
          <button className="back-btn" onClick={() => setActiveSection(null)}>← Back to Sections</button>

          <div className="table-container">
            <div className="table-header-custom">
              <div className="table-header-inner">
                <div>
                  <span className="subject-pill" style={{ marginRight: 8 }}>{sections[activeSection].subjectCode}</span>
                  <h3 style={{ display: 'inline', color: '#003366' }}>Section: {activeSection}</h3>
                  {currentStatus && (
                    <span className={`section-status-badge badge-${currentStatus}`} style={{ marginLeft: 12 }}>
                      {currentStatus === 'draft' ? 'Draft Saved' : currentStatus === 'submitted' ? 'Submitted' : 'Finalized 🔒'}
                    </span>
                  )}
                </div>
                <div className="bulk-actions">
                  {!isFinalized && (
                    <>
                      <button className="btn-save-all" onClick={() => handleSaveAll(activeSection)} disabled={hasValidationErrors(activeSection)}>
                         Save All
                      </button>
                      <button className="btn-submit" onClick={() => handleSubmit(activeSection)} disabled={hasValidationErrors(activeSection)}>
                         Submit Grades
                      </button>
                      {currentStatus === 'submitted' && (
                        <button className="btn-finalize" onClick={() => handleFinalize(activeSection)}>
                           Finalize
                        </button>
                      )}
                    </>
                  )}
                  {isFinalized && (
                    <span className="finalized-notice">Grades are locked and cannot be edited.</span>
                  )}
                </div>
              </div>
              {isFinalized && (
                <div className="finalized-banner">
                   These grades have been finalized and submitted to the Registrar. Contact the Registrar's Office for any changes.
                </div>
              )}
            </div>

            <table className="plv-table">
              <thead>
                <tr>
                  <th>Student ID</th>
                  <th>Student Name</th>
                  
                  {(templateColumns[activeSection] || []).map(col => (
                      <th key={col.id}>{col.label}</th>
                  ))}
                  
                  <th>Midterm <span style={{ fontWeight: 400, opacity: 0.7 }}>(60–100)</span></th>
                  <th>Finals <span style={{ fontWeight: 400, opacity: 0.7 }}>(60–100)</span></th>
                  <th>Final Grade</th>
                 
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sections[activeSection].students.map((stu, i) => {
                  const pt = calculatePLVPoint(stu);
                  const rowState = rowSaveState[activeSection]?.[i] || 'idle';
                  const errors = validationErrors[activeSection]?.[i] || {};
                  const hasError = errors.midterm || errors.finals;

                  return (
                    <tr key={`${stu.id}-${i}`} className={hasError ? 'row-error' : rowState === 'saved' ? 'row-saved' : ''}>
                      <td className="sub-code">{stu.id}</td>
                      <td>{stu.name}</td>
                      
                      {(templateColumns[activeSection] || []).map(col => (
                          <td key={col.id}>
                            <div className="input-wrap">
                              <input 
                                type="number" className="grade-input" 
                                placeholder="0" disabled={isFinalized}
                                value={(stu.customGrades && stu.customGrades[col.id]) || ''} 
                                onChange={(e) => handleCustomGradeChange(activeSection, i, col.id, e.target.value)} 
                              />
                            </div>
                          </td>
                      ))}
                      
                      <td>
                        <div className="input-wrap">
                          <input
                            className={`grade-input ${errors.midterm ? 'input-invalid' : ''}`}
                            type="number" min="60" max="100"
                            value={stu.midterm || ''}
                            disabled={isFinalized}
                            onChange={e => handleGradeChange(activeSection, i, 'midterm', e.target.value)}
                            placeholder="60–100"
                          />
                          {errors.midterm && <div className="field-error">{errors.midterm}</div>}
                        </div>
                      </td>
                      <td>
                        <div className="input-wrap">
                          <input
                            className={`grade-input ${errors.finals ? 'input-invalid' : ''}`}
                            type="number" min="60" max="100"
                            value={stu.finals || ''}
                            disabled={isFinalized}
                            onChange={e => handleGradeChange(activeSection, i, 'finals', e.target.value)}
                            placeholder="60–100"
                          />
                          {errors.finals && <div className="field-error">{errors.finals}</div>}
                        </div>
                      </td>
                      <td className="final-point">{pt > 0 ? pt.toFixed(2) : '—'}</td>
                      
                      <td>
                        <span className={`status-pill ${stu.remarks === 'Passed' ? 'passed' : stu.remarks === 'Failed' ? 'failed' : stu.remarks === 'Incomplete' ? 'incomplete' : 'dropped'}`}>
                          {stu.remarks || 'Incomplete'}
                        </span>
                      </td>
                      <td>
                        {!isFinalized ? (
                          <div className="row-action">
                            <button
                              className="row-save-btn"
                              onClick={() => handleSaveRow(activeSection, i)}
                              disabled={hasError || rowState === 'saving'}
                            >
                              {rowState === 'saving' ? '⏳' : '💾'}
                            </button>
                            <span className={`row-save-indicator indicator-${rowState}`}>
                              {rowState === 'saved' ? '✔ Saved' : rowState === 'saving' ? 'Saving...' : rowState === 'error' ? '❌ Error' : ''}
                            </span>
                          </div>
                        ) : (
                          <span className="row-save-indicator indicator-saved">🔒 Locked</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!isFinalized && (
              <div className="table-footer">
                <p className="footer-note">
                  <strong>Save (Draft)</strong> — saves without submitting. &nbsp;
                  <strong>Submit Grades</strong> — sends to Chairperson for review. &nbsp;
                  <strong>Finalize</strong> — locks grades permanently after submission.
                </p>
                <div className="footer-actions">
                  <button className="btn-save-all" onClick={() => handleSaveAll(activeSection)} disabled={hasValidationErrors(activeSection)}>
                     Save All (Draft)
                  </button>
                  <button className="btn-submit" onClick={() => handleSubmit(activeSection)} disabled={hasValidationErrors(activeSection)}>
                     Submit Grades
                  </button>
                  {currentStatus === 'submitted' && (
                    <button className="btn-finalize" onClick={() => handleFinalize(activeSection)}>
                       Finalize & Lock
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {uploadResult && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '14px', maxWidth: '650px', width: '90%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <h2 style={{ color: uploadResult.type === 'error' ? '#dc3545' : '#28a745', marginTop: 0, marginBottom: '10px' }}>{uploadResult.title}</h2>
            <p style={{ margin: '0 0 15px 0', fontWeight: 'bold' }}>{uploadResult.message}</p>
            
            {uploadResult.details && (
              <div style={{ backgroundColor: '#1e1e1e', color: '#4caf50', padding: '15px', borderRadius: '8px', overflowY: 'auto', flexGrow: 1, marginBottom: '20px' }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem' }}>{uploadResult.details}</pre>
              </div>
            )}
            
            <div style={{ textAlign: 'right', marginTop: uploadResult.details ? '0' : '20px' }}>
              <button className="btn-save-all" onClick={() => setUploadResult(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FacultyPortal;