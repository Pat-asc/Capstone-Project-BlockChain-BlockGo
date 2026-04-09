import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchAllGrades, approveGrade, finalizeGrade, issueGrade, fetchPendingRequests, approveRegistrationRequest, denyRegistrationRequest, fetchApprovedStudents, assignStudent, fetchApprovedAdmins, assignDepartmentAdmin, fetchDepartmentPendingStudents, approveStudentEnrollment, fetchApprovedFaculties, assignFaculty } from '../services/api';
import DepartmentAdminTemplateReview from './DepartmentAdminTemplateReview';

const HoverableID = ({ fullId, isAuthorized }) => {
    const [isRevealed, setIsRevealed] = useState(false);

    const displayValue = fullId || 'Unknown';
    const isShort = displayValue.length <= 12;

    return (
        <span 
            onMouseEnter={() => setIsRevealed(true)}
            onMouseLeave={() => setIsRevealed(false)}
            onClick={() => setIsRevealed(!isRevealed)}
            style={{ 
                cursor: isAuthorized ? 'pointer' : 'default',
                display: 'inline-block',
                maxWidth: (isRevealed && isAuthorized) || isShort ? '350px' : '90px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                transition: 'max-width 0.4s ease-in-out',
                verticalAlign: 'bottom'
            }}
            title={displayValue}
        >
            {displayValue}
        </span>
    );
};

const GradesDashboard = ({ loggedInEmail = '', loggedInName = '' }) => {
    const [grades, setGrades] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState(null); 
    
    const [mainTab, setMainTab] = useState('grades'); 
    const [pendingRequests, setPendingRequests] = useState([]);
    const [requestSearchTerm, setRequestSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'requestid', direction: 'descending' });

    const [approvedStudents, setApprovedStudents] = useState([]);
    const [studentAssignments, setStudentAssignments] = useState({});

    const [approvedAdmins, setApprovedAdmins] = useState([]);
    const [adminAssignments, setAdminAssignments] = useState({});

    const [approvedFaculties, setApprovedFaculties] = useState([]);
    const [facultyAssignments, setFacultyAssignments] = useState({});

    const [deptPendingStudents, setDeptPendingStudents] = useState([]);

    // Filters for Registrar Dashboard
    const [filterDept, setFilterDept] = useState('All');
    const [filterYear, setFilterYear] = useState('All');

    // Form State
    const [showForm, setShowForm] = useState(false);
    const [formData, setFormData] = useState({
        recordId: '',
        studentHash: '',
        subjectCode: '',
        course: '',
        grade: ''
    });

    const loadGrades = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        if (!isBackground) setErrorMsg(null);
        try {
            const response = await fetchAllGrades(loggedInEmail);
            
            if (Array.isArray(response)) {
                setGrades(response);
            } else if (response.status === 'Success' && response.data) {
                setGrades(response.data);
            } else {
                setGrades([]);
            }
        } catch (error) {
            console.error('Error loading grades:', error);
            if (!isBackground) setErrorMsg(`Could not fetch latest blockchain data: ${error.message}`);
            setGrades([]);
        }
        if (!isBackground) setLoading(false);
    }, [loggedInEmail]);

    const loadRequests = useCallback(async () => {
        try {
            const response = await fetchPendingRequests();
            if (response.status === 'Success') {
                const allRequests = [
                    ...(response.studentRequests || []),
                    ...(response.staffRequests || [])
                ];
                setPendingRequests(allRequests);
            }
        } catch (error) {
            console.error('Error loading registration requests:', error);
        }
    }, []);

    const loadApprovedStudents = useCallback(async () => {
        try {
            const response = await fetchApprovedStudents();
            if (response.status === 'Success') {
                setApprovedStudents(response.students || []);
            }
        } catch (error) {
            console.error('Error loading approved students:', error);
        }
    }, []);

    const loadApprovedAdmins = useCallback(async () => {
        try {
            const response = await fetchApprovedAdmins();
            if (response.status === 'Success') {
                setApprovedAdmins(response.admins || []);
            }
        } catch (error) {
            console.error('Error loading approved admins:', error);
        }
    }, []);

    const loadApprovedFaculties = useCallback(async () => {
        try {
            const response = await fetchApprovedFaculties();
            if (response.status === 'Success') {
                setApprovedFaculties(response.faculties || []);
            }
        } catch (error) {
            console.error('Error loading approved faculties:', error);
        }
    }, []);

    const loadDeptPendingStudents = useCallback(async () => {
        try {
            const response = await fetchDepartmentPendingStudents(loggedInEmail);
            if (response.status === 'Success') {
                setDeptPendingStudents(response.students || []);
            }
        } catch (error) {
            console.error('Error loading department students:', error);
        }
    }, [loggedInEmail]);

    const submitStudentAssignment = async (id) => {
        const assignment = studentAssignments[id];
        if (!assignment || !assignment.department || !assignment.section) {
            alert("Please provide both a department and a section.");
            return;
        }
        try {
            await assignStudent(id, { Department: assignment.department, Section: assignment.section });
            alert("Student assigned successfully! Pending department approval.");
            loadApprovedStudents();
        } catch (error) {
            alert(`Failed to assign student: ${error.message}`);
        }
    };

    const submitAdminAssignment = async (id) => {
        const assignment = adminAssignments[id];
        if (!assignment || !assignment.department) {
            alert("Please select a department.");
            return;
        }
        try {
            await assignDepartmentAdmin(id, { Department: assignment.department });
            alert("Admin assigned successfully!");
            loadApprovedAdmins();
        } catch (error) {
            alert(`Failed to assign admin: ${error.message}`);
        }
    };

    const submitFacultyAssignment = async (id) => {
        const assignment = facultyAssignments[id];
        if (!assignment || !assignment.department || !assignment.section || !assignment.yearLevel) {
            alert("Please provide department, section, and year level.");
            return;
        }
        try {
            await assignFaculty(id, { Department: assignment.department, Section: assignment.section, YearLevel: assignment.yearLevel });
            alert("Faculty assigned successfully!");
            loadApprovedFaculties();
        } catch (error) {
            alert(`Failed to assign faculty: ${error.message}`);
        }
    };

    useEffect(() => { // Initial load for grades
        loadGrades();
    }, [loadGrades]);

    // AUTO-REFRESH (POLLING) for Pending Requests
    useEffect(() => { // Handles loading and polling for the requests tab
        let interval;
        if (loggedInEmail?.includes('registrar') && mainTab === 'Requests') {
            loadRequests(); // Load immediately on tab open
            interval = setInterval(() => {
                loadRequests(); // Fetch quietly in the background every 3 seconds
            }, 3000);
        }
        return () => {
            if (interval) clearInterval(interval); // Cleanup when changing tabs
        };
    }, [loggedInEmail, mainTab, loadRequests]);

    // AUTO-REFRESH (POLLING) for Grades Ledger
    useEffect(() => {
        let interval;
        if (mainTab === 'grades') {
            interval = setInterval(() => {
                loadGrades(true); // Fetch quietly in the background every 3 seconds
            }, 3000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [loggedInEmail, mainTab]);

    useEffect(() => {
        if (mainTab === 'assignStudents') loadApprovedStudents();
        if (mainTab === 'assignAdmins') loadApprovedAdmins();
        if (mainTab === 'assignFaculties') loadApprovedFaculties();
        if (mainTab === 'deptStudents') loadDeptPendingStudents();
    }, [mainTab]);

    const handleApproveEnrollment = async (id) => {
        try {
            await approveStudentEnrollment(id);
            alert("Student officially enrolled in the department!");
            loadDeptPendingStudents();
        } catch (error) {
            alert(`Failed to approve enrollment: ${error.message}`);
        }
    };

    const handleApprove = async (recordId) => {
        try {
            await approveGrade(recordId, 'dean@cs.plv.edu.ph');
            alert(`Record ${recordId} Successfully Approved by Department!`);
            loadGrades(); // Refresh the data
        } catch (error) {
            alert(`Failed to approve record: ${error.message}`);
        }
    };

    const handleFinalize = async (recordId) => {
        try {
            // Force the Registrar's email for the finalize test
            await finalizeGrade(recordId, 'registrar@plv.edu.ph');
            alert(`Record ${recordId} Successfully Finalized!`);
            loadGrades(); // Refresh the data
        } catch (error) {
            alert(`Failed to finalize record: ${error.message}`);
        }
    };

    const handleIssueGrade = async (e) => {
        e.preventDefault();
        try {
            const payload = {
                id: formData.recordId,
                studentHash: formData.studentHash,
                studentId: formData.studentHash.split('@')[0], // Derived mock ID
                course: formData.course,
                subjectCode: formData.subjectCode,
                section: "A", // Default for testing
                grade: formData.grade,
                semester: "2nd Semester",
                schoolYear: "2024",
                university: "PLV",
                facultyId: loggedInEmail
            };
            
            await issueGrade(payload, loggedInEmail);
            alert("Grade successfully issued to the Blockchain!");
            setShowForm(false);
            setFormData({ recordId: '', studentHash: '', subjectCode: '', course: '', grade: '' });
            loadGrades(); // Refresh table
        } catch (error) {
            alert(`Error issuing grade: ${error.message}`);
        }
    };

    const handleApproveRequest = async (id, type) => {
        try {
            await approveRegistrationRequest(id, type);
            alert("Registration request approved successfully!");
            loadRequests(); // Refresh the list of pending requests
        } catch (error) {
            alert(`Failed to approve request: ${error.message}`);
        }
    };

    const handleDenyRequest = async (id) => {
        // eslint-disable-next-line no-restricted-globals
        if (confirm('Are you sure you want to deny and permanently delete this registration request?')) {
            try {
                await denyRegistrationRequest(id);
                alert("Registration request has been denied and removed.");
                loadRequests(); // Refresh the list
            } catch (error) {
                alert(`Failed to deny request: ${error.message}`);
            }
        }
    };

    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const sortedAndFilteredRequests = useMemo(() => {
        let sortableItems = [...pendingRequests];

        // Sorting
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                const valA = a[sortConfig.key] || '';
                const valB = b[sortConfig.key] || '';
                if (valA < valB) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (valA > valB) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }

        // Filtering
        if (!requestSearchTerm) {
            return sortableItems;
        }
        const searchTerm = requestSearchTerm.toLowerCase();
        return sortableItems.filter(req =>
            Object.values(req).some(val =>
                String(val).toLowerCase().includes(searchTerm)
            )
        );
    }, [pendingRequests, sortConfig, requestSearchTerm]);

    const filteredGrades = grades.filter(grade => {
        if (!loggedInEmail) {
            return false;
        }

        let isVisible = false;
        
        if (loggedInEmail.includes('registrar')) {
            isVisible = true;
        } else if (loggedInEmail.includes('student')) {
            isVisible = grade.student_hash === loggedInEmail || grade.studentId === loggedInEmail;
        } else {
            const isCS_IT = grade.subject_code?.includes('CS') || grade.subject_code?.includes('IT') || grade.course?.includes('CS');
            const isEngineering = grade.subject_code?.includes('ENGR') || grade.subject_code?.includes('CE') || grade.course?.includes('Eng');

            if (loggedInEmail.includes('dean') || loggedInEmail.includes('prof.alden')) {
                isVisible = isCS_IT;
            } else if (loggedInEmail.includes('prof.engineering') || loggedInEmail.includes('Faculty')) {
                isVisible = isEngineering;
            } else {
                const facultyId = grade.facultyId || grade.faculty_id || grade.FacultyId || grade.Faculty_id;
                isVisible = facultyId === loggedInEmail;
            }
        }

        // Apply extra Registrar filters (Department & Year)
        if (isVisible && loggedInEmail.includes('registrar')) {
            if (filterDept !== 'All' && !grade.course?.includes(filterDept) && !grade.subject_code?.includes(filterDept)) {
                return false;
            }
            if (filterYear !== 'All') {
                // Determine year level from subject code (e.g. "CS202" -> "2", "IT-101" -> "1")
                const yearMatch = grade.subject_code?.match(/[A-Za-z]+-?(\d)/);
                const yearLevel = yearMatch ? yearMatch[1] : null;
                
                if (yearLevel !== filterYear) {
                    return false;
                }
            }
        }

        return isVisible;
    });

    const getStatusStyle = (status) => {
        switch(status) {
            case 'Finalized': return { backgroundColor: '#e6f4ea', color: '#1e8e3e', padding: '6px 12px', borderRadius: '20px', fontSize: '0.85em', fontWeight: 'bold' };
            case 'DepartmentApproved': return { backgroundColor: '#e8f0fe', color: '#1967d2', padding: '6px 12px', borderRadius: '20px', fontSize: '0.85em', fontWeight: 'bold' };
            case 'Issued': return { backgroundColor: '#fef7e0', color: '#b08d00', padding: '6px 12px', borderRadius: '20px', fontSize: '0.85em', fontWeight: 'bold' };
            default: return { backgroundColor: '#f1f3f4', color: '#5f6368', padding: '6px 12px', borderRadius: '20px', fontSize: '0.85em', fontWeight: 'bold' };
        }
    };

    const inputStyle = { padding: '10px', borderRadius: '4px', border: '1px solid #ccc', width: '100%', boxSizing: 'border-box' };

    return (
        <div style={{ padding: '40px 20px', fontFamily: "'Inter', 'Segoe UI', sans-serif", maxWidth: '1200px', margin: '0 auto' }}>
            <h2 style={{ color: '#003366', borderBottom: '2px solid #e0e0e0', paddingBottom: '10px' }}>Pamantasan Ng Lungsod Ng Valenzuela.</h2>
            
            {/* --- TAB NAVIGATION (Registrar Only) --- */}
            {loggedInEmail.includes('registrar') && (
                <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                    <button onClick={() => setMainTab('grades')} style={{ padding: '10px 20px', fontWeight: 'bold', backgroundColor: mainTab === 'grades' ? '#003366' : '#f0f2f5', color: mainTab === 'grades' ? 'white' : '#333', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Grades Ledger</button>
                    <button onClick={() => setMainTab('Requests')} style={{ padding: '10px 20px', fontWeight: 'bold', backgroundColor: mainTab === 'Requests' ? '#003366' : '#f0f2f5', color: mainTab === 'Requests' ? 'white' : '#333', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Pending Requests</button>
                    <button onClick={() => setMainTab('assignStudents')} style={{ padding: '10px 20px', fontWeight: 'bold', backgroundColor: mainTab === 'assignStudents' ? '#003366' : '#f0f2f5', color: mainTab === 'assignStudents' ? 'white' : '#333', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Assign Students</button>
                    <button onClick={() => setMainTab('assignAdmins')} style={{ padding: '10px 20px', fontWeight: 'bold', backgroundColor: mainTab === 'assignAdmins' ? '#003366' : '#f0f2f5', color: mainTab === 'assignAdmins' ? 'white' : '#333', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Assign Department Admin</button>
                    <button onClick={() => setMainTab('assignFaculties')} style={{ padding: '10px 20px', fontWeight: 'bold', backgroundColor: mainTab === 'assignFaculties' ? '#003366' : '#f0f2f5', color: mainTab === 'assignFaculties' ? 'white' : '#333', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Assign Faculty</button>
                </div>
            )}
            
            {/* --- TAB NAVIGATION (Department Admin / Dean Only) --- */}
            {loggedInEmail.includes('dean') && (
                <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                    <button onClick={() => setMainTab('grades')} style={{ padding: '10px 20px', fontWeight: 'bold', backgroundColor: mainTab === 'grades' ? '#003366' : '#f0f2f5', color: mainTab === 'grades' ? 'white' : '#333', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Grades Ledger</button>
                    <button onClick={() => setMainTab('deptStudents')} style={{ padding: '10px 20px', fontWeight: 'bold', backgroundColor: mainTab === 'deptStudents' ? '#003366' : '#f0f2f5', color: mainTab === 'deptStudents' ? 'white' : '#333', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Pending Enrollments</button>
                    <button onClick={() => setMainTab('reviewTemplates')} style={{ padding: '10px 20px', fontWeight: 'bold', backgroundColor: mainTab === 'reviewTemplates' ? '#003366' : '#f0f2f5', color: mainTab === 'reviewTemplates' ? 'white' : '#333', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Review Grade Templates</button>
                </div>
            )}

            {mainTab === 'grades' && (
                <>
            {/* Controls Section */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 0', backgroundColor: 'white', padding: '15px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                <div>
                    <span style={{ marginRight: '15px', color: '#003366', fontWeight: 'bold', fontSize: '1.1em' }}>
                        Logged in as: {loggedInName ? `${loggedInName} (${loggedInEmail})` : loggedInEmail}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    {loggedInEmail.includes('registrar') && (
                        <>
                            <select value={filterDept} onChange={e => setFilterDept(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', outline: 'none' }}>
                                <option value="All">All Departments</option>
                                <option value="CS">Computer Science</option>
                                <option value="IT">Information Tech</option>
                                <option value="CE">Civil Engineering</option>
                            </select>
                            <select value={filterYear} onChange={e => setFilterYear(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', outline: 'none' }}>
                                <option value="All">All Years</option>
                                <option value="1">1st Year</option>
                                <option value="2">2nd Year</option>
                                <option value="3">3rd Year</option>
                                <option value="4">4th Year</option>
                            </select>
                        </>
                    )}
                    <button onClick={loadGrades} style={{ padding: '10px 20px', backgroundColor: '#003366', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', transition: 'background 0.2s' }}>
                        {loading ? 'Syncing blocks...' : 'Refresh Ledger'}
                    </button>
                    {/* Only Faculty can see the Issue Grade button */}
                    {(loggedInEmail.includes('prof') || loggedInEmail.includes('Faculty')) && (
                        <button onClick={() => setShowForm(!showForm)} style={{ padding: '10px 20px', backgroundColor: showForm ? '#dc3545' : '#34a853', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                            {showForm ? 'Cancel' : '+ Issue New Grade'}
                        </button>
                    )}
                </div>
            </div>

            {/* Issue Grade Form */}
            {showForm && (
                <div style={{ backgroundColor: '#f8f9fa', padding: '25px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #ddd', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                    <h3 style={{ marginTop: 0, color: '#003366', marginBottom: '15px' }}>Issue New Blockchain Grade</h3>
                    <form onSubmit={handleIssueGrade} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                        <input required placeholder="Record ID (e.g. 10-CS202)" value={formData.recordId} onChange={e => setFormData({...formData, recordId: e.target.value})} style={inputStyle} />
                        <input required placeholder="Student Email (e.g. student.mayumi@plv.edu.ph)" value={formData.studentHash} onChange={e => setFormData({...formData, studentHash: e.target.value})} style={inputStyle} />
                        <input required placeholder="Subject Code (e.g. CS202)" value={formData.subjectCode} onChange={e => setFormData({...formData, subjectCode: e.target.value})} style={inputStyle} />
                        <input required placeholder="Course (e.g. BSCS)" value={formData.course} onChange={e => setFormData({...formData, course: e.target.value})} style={inputStyle} />
                        <input required placeholder="Grade (e.g. 1.25)" value={formData.grade} onChange={e => setFormData({...formData, grade: e.target.value})} style={inputStyle} />
                        <button type="submit" style={{ backgroundColor: '#003366', color: 'white', border: 'none', padding: '10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1em' }}>Secure on Ledger</button>
                    </form>
                </div>
            )}

            {/* Clean Inline Error Message */}
            {errorMsg && (
                <div style={{ backgroundColor: '#ffebee', color: '#d32f2f', padding: '12px', borderRadius: '4px', marginBottom: '20px', borderLeft: '4px solid #d32f2f' }}>
                     {errorMsg}
                </div>
            )}

            {loading ? <p>Loading blocks...</p> : (
                <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#003366', color: 'white' }}>
                                <th style={{ padding: '15px' }}>Record ID</th>
                                <th style={{ padding: '15px' }}>Student</th>
                                <th style={{ padding: '15px' }}>Subject</th>
                                <th style={{ padding: '15px' }}>Grade</th>
                                <th style={{ padding: '15px' }}>Faculty ID</th>
                                <th style={{ padding: '15px' }}>Status</th>
                                <th style={{ padding: '15px' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredGrades.length === 0 ? (
                                <tr>
                                    <td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#777' }}>No ledger records found for this department/user.</td>
                                </tr>
                            ) : (
                                filteredGrades.map((grade, index) => (
                                    <tr key={grade.id} style={{ backgroundColor: index % 2 === 0 ? '#ffffff' : '#f8f9fa', borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '15px', color: '#555', fontFamily: 'monospace' }}>{grade.id}</td>
                                        <td style={{ padding: '15px', color: '#666', fontFamily: 'monospace' }}>
                                            <HoverableID 
                                                fullId={grade.student_hash || grade.studentId} 
                                                isAuthorized={(loggedInEmail.includes('student') && (grade.student_hash === loggedInEmail || grade.studentId === loggedInEmail)) || loggedInEmail.includes('registrar')} 
                                            />
                                        </td>
                                        <td style={{ padding: '15px', fontWeight: 'bold', color: '#333' }}>{grade.subject_code}</td>
                                        <td style={{ padding: '15px', fontSize: '1.1em', fontWeight: '900', color: '#000' }}>{grade.grade}</td>
                                        <td style={{ padding: '15px', color: '#666', fontFamily: 'monospace' }}>
                                            <HoverableID 
                                                fullId={grade.facultyId || grade.faculty_id || grade.FacultyId || grade.Faculty_id} 
                                                isAuthorized={loggedInEmail.includes('registrar')} 
                                            />
                                        </td>
                                        <td style={{ padding: '15px' }}>
                                            <span style={getStatusStyle(grade.status)}>{grade.status}</span>
                                        </td>
                                        <td style={{ padding: '15px' }}>
                                            {grade.status === 'Issued' && loggedInEmail.includes('dean') && (
                                                <button onClick={() => handleApprove(grade.id)} style={{ backgroundColor: '#fbbc04', color: '#333', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>Verify & Approve (Dean)</button>
                                            )}
                                            {grade.status === 'DepartmentApproved' && loggedInEmail.includes('registrar') && (
                                                <button onClick={() => handleFinalize(grade.id)} style={{ backgroundColor: '#34a853', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>Finalize to Ledger (Registrar)</button>
                                            )}
                                            {grade.status === 'Finalized' && <span style={{ color: '#1e8e3e', fontWeight: 'bold' }}>Encrypted & Locked</span>}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}
                </>
            )}

            {/* Faculty Requests Tab */}
            {mainTab === 'Requests' && (
                <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                    <div style={{ padding: '15px', borderBottom: '1px solid #eee' }}>
                        <input
                            type="text"
                            placeholder="Search by name, email, role, or student no..."
                            value={requestSearchTerm}
                            onChange={e => setRequestSearchTerm(e.target.value)}
                            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
                        />
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#003366', color: 'white' }}>
                                <th onClick={() => requestSort('role')} style={{ padding: '15px', cursor: 'pointer' }}>Role</th>
                                <th onClick={() => requestSort('fullname')} style={{ padding: '15px', cursor: 'pointer' }}>Name</th>
                                <th onClick={() => requestSort('studentno')} style={{ padding: '15px', cursor: 'pointer' }}>Student No.</th>
                                <th onClick={() => requestSort('email')} style={{ padding: '15px', cursor: 'pointer' }}>Email</th>
                                <th onClick={() => requestSort('department')} style={{ padding: '15px', cursor: 'pointer' }}>Department</th>
                                <th onClick={() => requestSort('requeststatus')} style={{ padding: '15px', cursor: 'pointer' }}>Status</th>
                                <th style={{ padding: '15px' }}>Actions</th>
                            </tr>
                        </thead>

                        <tbody>
                            {sortedAndFilteredRequests.length === 0 ? (
                                <tr>
                                    <td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#777' }}>
                                        {pendingRequests.length > 0 ? 'No requests match your search.' : 'No pending registration requests.'}
                                    </td>
                                </tr>
                            ) : (
                                sortedAndFilteredRequests.map((req, index) => (
                                    <tr key={req.requestid} style={{ backgroundColor: index % 2 === 0 ? '#ffffff' : '#f8f9fa', borderBottom: '1px solid #eee' }}>
                                    <td style={{ padding: '15px', fontWeight: 'bold', textTransform: 'capitalize' }}>{req.role}</td>
                                        <td style={{ padding: '15px' }}>{req.fullname}</td>
                                        <td style={{ padding: '15px' }}>{req.studentno || 'N/A'}</td>
                                        <td style={{ padding: '15px', color: '#666' }}>{req.email}</td>
                                        <td style={{ padding: '15px' }}>{req.department}</td>

                                        <td style={{ padding: '15px' }}>{req.requeststatus}</td>
                                        <td style={{ padding: '15px' }}>
                                            <button onClick={() => handleDenyRequest(req.requestid)} style={{ backgroundColor: '#dc3545', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', marginRight: '5px' }}>Deny</button>
                                            <button onClick={() => handleApproveRequest(req.requestid, req.role)} style={{ backgroundColor: '#34a853', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Approve</button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Assign Students Tab */}
            {mainTab === 'assignStudents' && (
                <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#003366', color: 'white' }}>
                                <th style={{ padding: '15px' }}>Name</th>
                                <th style={{ padding: '15px' }}>Student No.</th>
                                <th style={{ padding: '15px' }}>Status</th>
                                <th style={{ padding: '15px' }}>Assign Dept</th>
                                <th style={{ padding: '15px' }}>Assign Section</th>
                                <th style={{ padding: '15px' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {approvedStudents.length === 0 ? (
                                <tr>
                                    <td colSpan="6" style={{ padding: '20px', textAlign: 'center', color: '#777' }}>No approved students waiting for assignment.</td>
                                </tr>
                            ) : (
                                approvedStudents.map((student, index) => (
                                    <tr key={student.id} style={{ backgroundColor: index % 2 === 0 ? '#ffffff' : '#f8f9fa', borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '15px', fontWeight: 'bold' }}>{student.fullname}</td>
                                        <td style={{ padding: '15px' }}>{student.studentno}</td>
                                        <td style={{ padding: '15px' }}>
                                            <span style={{ padding: '6px 12px', borderRadius: '20px', fontSize: '0.85em', fontWeight: 'bold', backgroundColor: student.assignmentStatus === 'Unassigned' ? '#fef7e0' : '#e8f0fe', color: student.assignmentStatus === 'Unassigned' ? '#b08d00' : '#1967d2' }}>
                                                {student.assignmentStatus}
                                            </span>
                                        </td>
                                        <td style={{ padding: '15px' }}>
                                            <select defaultValue="" onChange={(e) => setStudentAssignments(prev => ({...prev, [student.id]: {...prev[student.id], department: e.target.value}}))} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}>
                                                <option value="" disabled>Select Dept</option>
                                                <option value="IT">IT</option>
                                                <option value="CS">CS</option>
                                                <option value="CpE">CpE</option>
                                                <option value="ECE">ECE</option>
                                            </select>
                                        </td>
                                        <td style={{ padding: '15px' }}>
                                            <input type="text" placeholder="e.g. BSIT-1A" onChange={(e) => setStudentAssignments(prev => ({...prev, [student.id]: {...prev[student.id], section: e.target.value}}))} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '120px' }} />
                                        </td>
                                        <td style={{ padding: '15px' }}>
                                            <button onClick={() => submitStudentAssignment(student.id)} style={{ backgroundColor: '#1967d2', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Assign</button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Assign Department Admins Tab */}
            {mainTab === 'assignAdmins' && (
                <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#003366', color: 'white' }}>
                                <th style={{ padding: '15px' }}>Name</th>
                                <th style={{ padding: '15px' }}>Role</th>
                                <th style={{ padding: '15px' }}>Email</th>
                                <th style={{ padding: '15px' }}>Current Department</th>
                                <th style={{ padding: '15px' }}>Assign New Dept</th>
                                <th style={{ padding: '15px' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {approvedAdmins.length === 0 ? (
                                <tr>
                                    <td colSpan="6" style={{ padding: '20px', textAlign: 'center', color: '#777' }}>No approved department admins waiting for assignment.</td>
                                </tr>
                            ) : (
                                approvedAdmins.map((admin, index) => (
                                    <tr key={admin.id} style={{ backgroundColor: index % 2 === 0 ? '#ffffff' : '#f8f9fa', borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '15px', fontWeight: 'bold' }}>{admin.fullname}</td>
                                        <td style={{ padding: '15px', textTransform: 'capitalize' }}>{admin.role}</td>
                                        <td style={{ padding: '15px' }}>{admin.email}</td>
                                        <td style={{ padding: '15px' }}>
                                            <span style={{ padding: '6px 12px', borderRadius: '20px', fontSize: '0.85em', fontWeight: 'bold', backgroundColor: admin.department === 'Unassigned' ? '#ffebee' : '#e6f4ea', color: admin.department === 'Unassigned' ? '#d32f2f' : '#1e8e3e' }}>
                                                {admin.department}
                                            </span>
                                        </td>
                                        <td style={{ padding: '15px' }}>
                                            <select defaultValue="" onChange={(e) => setAdminAssignments(prev => ({...prev, [admin.id]: {department: e.target.value}}))} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}>
                                                <option value="" disabled>Select Dept</option>
                                                <option value="IT">IT</option>
                                                <option value="CS">CS</option>
                                                <option value="CpE">CpE</option>
                                                <option value="ECE">ECE</option>
                                            </select>
                                        </td>
                                        <td style={{ padding: '15px' }}>
                                            <button onClick={() => submitAdminAssignment(admin.id)} style={{ backgroundColor: '#1967d2', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Assign</button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Assign Faculty Tab */}
            {mainTab === 'assignFaculties' && (
                <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#003366', color: 'white' }}>
                                <th style={{ padding: '15px' }}>Name</th>
                                <th style={{ padding: '15px' }}>Email</th>
                                <th style={{ padding: '15px' }}>Current Assignment</th>
                                <th style={{ padding: '15px' }}>Assign Dept</th>
                                <th style={{ padding: '15px' }}>Assign Section</th>
                                <th style={{ padding: '15px' }}>Assign Year</th>
                                <th style={{ padding: '15px' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {approvedFaculties.length === 0 ? (
                                <tr>
                                    <td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#777' }}>No approved faculty members waiting for assignment.</td>
                                </tr>
                            ) : (
                                approvedFaculties.map((faculty, index) => (
                                    <tr key={faculty.id} style={{ backgroundColor: index % 2 === 0 ? '#ffffff' : '#f8f9fa', borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '15px', fontWeight: 'bold' }}>{faculty.fullname}</td>
                                        <td style={{ padding: '15px' }}>{faculty.email}</td>
                                        <td style={{ padding: '15px' }}>
                                            {(!faculty.department || faculty.department === 'Unassigned') ? (
                                                <span style={{ padding: '6px 12px', borderRadius: '20px', fontSize: '0.85em', fontWeight: 'bold', backgroundColor: '#ffebee', color: '#d32f2f' }}>
                                                    Unassigned
                                                </span>
                                            ) : (
                                                <span style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '0.85em', fontWeight: 'bold', backgroundColor: '#e6f4ea', color: '#1e8e3e', display: 'inline-block' }}>
                                                    {faculty.department} - {faculty.yearLevel}{faculty.section}
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ padding: '15px' }}>
                                            <select defaultValue="" onChange={(e) => setFacultyAssignments(prev => ({...prev, [faculty.id]: {...prev[faculty.id], department: e.target.value}}))} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}>
                                                <option value="" disabled>Select</option>
                                                <option value="IT">IT</option>
                                                <option value="CS">CS</option>
                                                <option value="CpE">CpE</option>
                                                <option value="ECE">ECE</option>
                                            </select>
                                        </td>
                                        <td style={{ padding: '15px' }}>
                                            <input type="text" placeholder="e.g. A" onChange={(e) => setFacultyAssignments(prev => ({...prev, [faculty.id]: {...prev[faculty.id], section: e.target.value}}))} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '80px' }} />
                                        </td>
                                        <td style={{ padding: '15px' }}>
                                            <select defaultValue="" onChange={(e) => setFacultyAssignments(prev => ({...prev, [faculty.id]: {...prev[faculty.id], yearLevel: e.target.value}}))} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}>
                                                <option value="" disabled>Select</option>
                                                <option value="1">1st</option>
                                                <option value="2">2nd</option>
                                                <option value="3">3rd</option>
                                                <option value="4">4th</option>
                                            </select>
                                        </td>
                                        <td style={{ padding: '15px' }}>
                                            <button onClick={() => submitFacultyAssignment(faculty.id)} style={{ backgroundColor: '#1967d2', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Assign</button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Department Admin: Approve Students Tab */}
            {mainTab === 'deptStudents' && (
                <div style={{ backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#003366', color: 'white' }}>
                                <th style={{ padding: '15px' }}>Name</th>
                                <th style={{ padding: '15px' }}>Email</th>
                                <th style={{ padding: '15px' }}>Student No.</th>
                                <th style={{ padding: '15px' }}>Section</th>
                                <th style={{ padding: '15px' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {deptPendingStudents.length === 0 ? (
                                <tr>
                                    <td colSpan="5" style={{ padding: '20px', textAlign: 'center', color: '#777' }}>No pending student assignments for your department.</td>
                                </tr>
                            ) : (
                                deptPendingStudents.map((student, index) => (
                                    <tr key={student.id} style={{ backgroundColor: index % 2 === 0 ? '#ffffff' : '#f8f9fa', borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '15px', fontWeight: 'bold' }}>{student.fullname}</td>
                                        <td style={{ padding: '15px' }}>{student.email}</td>
                                        <td style={{ padding: '15px' }}>{student.studentno}</td>
                                        <td style={{ padding: '15px', fontWeight: 'bold', color: '#1967d2' }}>{student.section}</td>
                                        <td style={{ padding: '15px' }}>
                                            <button onClick={() => handleApproveEnrollment(student.id)} style={{ backgroundColor: '#34a853', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Approve Enrollment</button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Department Admin: Review Grade Templates Tab */}
            {mainTab === 'reviewTemplates' && (
                <DepartmentAdminTemplateReview adminData={{ fullName: loggedInName, department: filterDept === 'All' ? 'CS' : filterDept, email: loggedInEmail }} onLogout={() => {}} />
            )}
        </div>
    );
};

export default GradesDashboard;