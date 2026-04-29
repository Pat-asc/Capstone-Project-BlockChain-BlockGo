import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchAllGrades, finalizeGrade, fetchPendingRequests, approveRegistrationRequest, denyRegistrationRequest, fetchApprovedStudents, assignStudent, fetchApprovedAdmins, assignDepartmentAdmin, fetchApprovedFaculties, assignFaculty, dropStudent } from '../../services/api';
import RegistrarHeader from './RegistrarHeader';
import RegistrarSidebar from './RegistrarSidebar';
import RegistrarDashboard from './RegistrarDashboard';
import StudentListImport from '../student/StudentListImport';
import EncodingPeriod from './EncodingPeriod';

const HoverableID = ({ fullId, isAuthorized }) => {
    const [isRevealed, setIsRevealed] = useState(false);
    const displayValue = fullId || 'Unknown';
    const isShort = displayValue.length <= 12;
    const maxWidthClass = (isRevealed && isAuthorized) || isShort ? 'max-w-[350px]' : 'max-w-[90px]';
    return (
        <span 
            onMouseEnter={() => setIsRevealed(true)}
            onMouseLeave={() => setIsRevealed(false)}
            onClick={() => setIsRevealed(!isRevealed)}
            className={`inline-block truncate align-bottom transition-[max-width] duration-300 ease-in-out ${isAuthorized ? 'cursor-pointer' : 'cursor-default'} ${maxWidthClass}`}
            title={displayValue}
        >
            {displayValue}
        </span>
    );
};

const RegistrarGradesView = ({ loggedInEmail = '', loggedInName = '' }) => {
    const [grades, setGrades] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState(null); 
    const [mainTab, setMainTab] = useState('dashboard'); 
    
    const [pendingRequests, setPendingRequests] = useState([]);
    const [requestSearchTerm, setRequestSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'requestid', direction: 'descending' });

    const [approvedStudents, setApprovedStudents] = useState([]);
    const [studentAssignments, setStudentAssignments] = useState({});
    const [approvedAdmins, setApprovedAdmins] = useState([]);
    const [adminAssignments, setAdminAssignments] = useState({});
    const [approvedFaculties, setApprovedFaculties] = useState([]);
    const [facultyAssignments, setFacultyAssignments] = useState({});

    const [filterDept, setFilterDept] = useState('All');
    const [filterYear, setFilterYear] = useState('All');

    const handleDropStudent = async (id, name) => {
        if (window.confirm(`Are you sure you want to drop ${name}? This will revoke their system access completely.`)) {
            try {
                await dropStudent(id);
                alert(`${name} has been dropped and access revoked.`);
                loadApprovedStudents();
            } catch (error) {
                alert(error.message);
            }
        }
    };

    const loadGrades = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        try {
            const response = await fetchAllGrades(loggedInEmail);
            setGrades(Array.isArray(response) ? response : (response.data || []));
        } catch (error) {
            if (!isBackground) setErrorMsg(`Could not fetch data: ${error.message}`);
        }
        if (!isBackground) setLoading(false);
    }, [loggedInEmail]);

    const loadRequests = useCallback(async () => {
        try {
            const response = await fetchPendingRequests();
            if (response.status === 'Success') setPendingRequests([...(response.studentRequests || []), ...(response.staffRequests || [])]);
        } catch (error) { console.error('Error loading requests:', error); }
    }, []);

    const loadApprovedStudents = useCallback(async () => {
        try {
            const response = await fetchApprovedStudents();
            if (response.status === 'Success') setApprovedStudents(response.students || []);
        } catch (error) { console.error('Error loading students:', error); }
    }, []);

    const loadApprovedAdmins = useCallback(async () => {
        try {
            const response = await fetchApprovedAdmins();
            if (response.status === 'Success') setApprovedAdmins(response.admins || []);
        } catch (error) { console.error('Error loading admins:', error); }
    }, []);

    const loadApprovedFaculties = useCallback(async () => {
        try {
            const response = await fetchApprovedFaculties();
            if (response.status === 'Success') setApprovedFaculties(response.faculties || []);
        } catch (error) { console.error('Error loading faculties:', error); }
    }, []);

    useEffect(() => { loadGrades(); }, [loadGrades]);

    useEffect(() => { 
        let interval;
        if (mainTab === 'Requests') {
            loadRequests(); 
            interval = setInterval(() => loadRequests(), 3000);
        }
        return () => clearInterval(interval); 
    }, [mainTab, loadRequests]);

    useEffect(() => {
        if (mainTab === 'assignStudents') loadApprovedStudents();
        if (mainTab === 'assignAdmins') loadApprovedAdmins();
        if (mainTab === 'assignFaculties') loadApprovedFaculties();
    }, [mainTab]);

    const submitStudentAssignment = async (id) => {
        const assignment = studentAssignments[id];
        if (!assignment || !assignment.department || !assignment.yearLevel || !assignment.sectionNum) return alert("Please provide department, year, and section.");
        try {
            const combinedSection = `${assignment.yearLevel}-${assignment.sectionNum}`;
            await assignStudent(id, { Department: assignment.department, Section: combinedSection });
            alert("Student assigned successfully!");
            loadApprovedStudents();
        } catch (error) { alert(`Failed to assign: ${error.message}`); }
    };

    const submitAdminAssignment = async (id) => {
        const assignment = adminAssignments[id];
        if (!assignment || !assignment.department) return alert("Please select a department.");
        try {
            await assignDepartmentAdmin(id, { Department: assignment.department });
            alert("Admin assigned successfully!");
            loadApprovedAdmins();
        } catch (error) { alert(`Failed to assign: ${error.message}`); }
    };

    const submitFacultyAssignment = async (id) => {
        const assignment = facultyAssignments[id];
        if (!assignment || !assignment.department || !assignment.section || !assignment.yearLevel || !assignment.subject) return alert("Please provide department, section, year level, and subject.");
        try {
            await assignFaculty(id, { Department: assignment.department, Section: assignment.section, YearLevel: assignment.yearLevel, Subject: assignment.subject });
            alert("Faculty assigned successfully!");
            loadApprovedFaculties();
        } catch (error) { alert(`Failed to assign: ${error.message}`); }
    };

    const handleFinalize = async (recordId) => {
        try {
            await finalizeGrade(recordId, loggedInEmail);
            alert(`Record ${recordId} Successfully Finalized!`);
            loadGrades(); 
        } catch (error) { alert(`Failed to finalize record: ${error.message}`); }
    };

    const handleApproveRequest = async (id, type) => {
        try {
            await approveRegistrationRequest(id, type);
            alert("Request approved successfully!");
            loadRequests(); 
        } catch (error) { alert(`Failed to approve: ${error.message}`); }
    };

    const handleDenyRequest = async (id) => {
        if (window.confirm('Are you sure you want to deny this request?')) {
            try {
                await denyRegistrationRequest(id);
                alert("Request denied and removed.");
                loadRequests(); 
            } catch (error) { alert(`Failed to deny: ${error.message}`); }
        }
    };

    const sortedAndFilteredRequests = useMemo(() => {
        let sortableItems = [...pendingRequests];
        if (!requestSearchTerm) return sortableItems;
        const searchTerm = requestSearchTerm.toLowerCase();
        return sortableItems.filter(req => Object.values(req).some(val => String(val).toLowerCase().includes(searchTerm)));
    }, [pendingRequests, requestSearchTerm]);

    const filteredGrades = grades.filter(grade => {
        if (!loggedInEmail) return false;
        if (filterDept !== 'All' && !grade.course?.includes(filterDept) && !grade.subject_code?.includes(filterDept)) return false;
        if (filterYear !== 'All') {
            const yearLevel = grade.subject_code?.match(/[A-Za-z]+-?(\d)/)?.[1];
            if (yearLevel !== filterYear) return false;
        }
        return true;
    });

    return (
        <div className="flex h-screen w-full flex-col bg-slate-50 font-sans fixed inset-0 z-[100] overflow-auto">
            <RegistrarHeader registrarData={{ name: loggedInName }} onLogout={() => { localStorage.removeItem('token'); window.location.reload(); }} />
            
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden p-4 md:p-6 gap-6">
                <RegistrarSidebar activeTab={mainTab} setActiveTab={setMainTab} />
                <main className="flex-1 overflow-y-auto pr-2">
                    {mainTab === 'dashboard' && <RegistrarDashboard grades={grades} />}
                    {mainTab === 'encoding' && <EncodingPeriod />}
                    {mainTab === 'studentlist' && <StudentListImport />}
                    
                    {mainTab === 'monitoring' && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm mb-6">
                            <h3 className="mb-6 text-xl font-bold text-[#003366]">System Administration Tools</h3>
                            <div className="flex flex-wrap gap-3">
                                <button onClick={() => setMainTab('grades')} className="rounded-lg bg-blue-100 px-4 py-2 font-bold text-blue-800 hover:bg-blue-200 transition">Grades Ledger</button>
                                <button onClick={() => setMainTab('Requests')} className="rounded-lg bg-blue-100 px-4 py-2 font-bold text-blue-800 hover:bg-blue-200 transition">Pending Requests</button>
                                <button onClick={() => setMainTab('assignStudents')} className="rounded-lg bg-blue-100 px-4 py-2 font-bold text-blue-800 hover:bg-blue-200 transition">Assign Students</button>
                                <button onClick={() => setMainTab('assignAdmins')} className="rounded-lg bg-blue-100 px-4 py-2 font-bold text-blue-800 hover:bg-blue-200 transition">Assign Admins</button>
                                <button onClick={() => setMainTab('assignFaculties')} className="rounded-lg bg-blue-100 px-4 py-2 font-bold text-blue-800 hover:bg-blue-200 transition">Assign Faculty</button>
                            </div>
                        </div>
                    )}
                    
                    <div className="w-full">
                        {mainTab === 'grades' && (
                            <>
                                <div className="mb-6 flex flex-col md:flex-row items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                    <div><span className="text-lg font-bold text-[#003366]">Logged in as: {loggedInEmail}</span></div>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <button onClick={loadGrades} className="rounded-xl bg-[#003366] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#00264d]">
                                            {loading ? 'Syncing blocks...' : 'Refresh Ledger'}
                                        </button>
                                    </div>
                                </div>
                                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
                                    <table className="w-full min-w-[800px] text-left text-sm">
                                        <thead>
                                            <tr className="bg-[#003366] text-white">
                                                <th className="p-4">Record ID</th>
                                                <th className="p-4">Student</th>
                                                <th className="p-4">Subject</th>
                                                <th className="p-4">Grade</th>
                                                <th className="p-4">Faculty ID</th>
                                                <th className="p-4">Status</th>
                                                <th className="p-4">File Attachment</th>
                                                <th className="p-4">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredGrades.map((grade) => (
                                                <tr key={grade.id} className="border-b border-slate-100 hover:bg-slate-50">
                                                    <td className="p-4 font-mono text-slate-500">{grade.id}</td>
                                                    <td className="p-4 font-mono text-slate-700"><HoverableID fullId={grade.student_hash || grade.studentId} isAuthorized={true} /></td>
                                                    <td className="p-4 font-bold text-slate-800">{grade.subject_code}</td>
                                                    <td className="p-4 text-lg font-black text-black">{grade.grade}</td>
                                                    <td className="p-4 font-mono text-slate-700"><HoverableID fullId={grade.facultyId || grade.faculty_id} isAuthorized={true} /></td>
                                                    <td className="p-4">
                                                        <span className="inline-block rounded-full px-3 py-1 text-xs font-bold bg-slate-100">{grade.status}</span>
                                                    </td>
                                                    <td className="p-4">
                                                        {(grade.ipfs_cid || grade.IpfsCID || grade.ipfsCid) ? (
                                                            <a href={`http://127.0.0.1:5001/ipfs/bafybeiddnr2jz65byk67sjt6jsu6g7tueddr7odhzzpzli3rgudlbnc6iq/#/ipfs/${grade.ipfs_cid || grade.IpfsCID || grade.ipfsCid}`} target="_blank" rel="noreferrer" className="flex inline-flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 transition hover:bg-blue-100">
                                                                 View
                                                            </a>
                                                        ) : <span className="text-xs font-semibold text-slate-400">N/A</span>}
                                                    </td>
                                                    <td className="p-4">
                                                        {grade.status === 'DepartmentApproved' && (
                                                            <button onClick={() => handleFinalize(grade.id)} className="rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white shadow-sm hover:bg-emerald-700">Finalize</button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}

                        {mainTab === 'Requests' && (
                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                                <div className="border-b border-slate-200 p-4">
                                    <input type="text" placeholder="Search..." value={requestSearchTerm} onChange={e => setRequestSearchTerm(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 outline-none" />
                                </div>
                                <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm">
                                    <thead>
                                        <tr className="bg-[#003366] text-white">
                                            <th className="p-4">Role</th>
                                            <th className="p-4">Name</th>
                                            <th className="p-4">Student No.</th>
                                            <th className="p-4">Email</th>
                                            <th className="p-4">Department</th>
                                            <th className="p-4">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedAndFilteredRequests.map((req) => (
                                            <tr key={req.requestid} className="border-b border-slate-100 hover:bg-slate-50">
                                                <td className="p-4 font-bold capitalize text-slate-800">{req.role}</td>
                                                <td className="p-4">{req.fullname}</td>
                                                <td className="p-4">{req.studentno || 'N/A'}</td>
                                                <td className="p-4 text-slate-500">{req.email}</td>
                                                <td className="p-4">{req.department}</td>
                                                <td className="p-4">
                                                    <button onClick={() => handleDenyRequest(req.requestid)} className="mr-2 rounded-lg bg-red-500 px-3 py-1 text-xs font-bold text-white hover:bg-red-600">Deny</button>
                                                    <button onClick={() => handleApproveRequest(req.requestid, req.role)} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700">Approve</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table></div>
                            </div>
                        )}

                        {mainTab === 'assignStudents' && (
                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                                <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm">
                                    <thead>
                                        <tr className="bg-[#003366] text-white">
                                            <th className="p-4">Name</th>
                                            <th className="p-4">Student No.</th>
                                            <th className="p-4">Status</th>
                                            <th className="p-4">Assign Dept</th>
                                            <th className="p-4">Assign Section</th>
                                            <th className="p-4">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {approvedStudents.length === 0 ? (
                                            <tr>
                                                <td colSpan="6" className="p-8 text-center text-slate-500">No approved students waiting for assignment.</td>
                                            </tr>
                                        ) : (
                                            approvedStudents.map((student, index) => (
                                                <tr key={student.id} className="border-b border-slate-100 hover:bg-slate-50">
                                                    <td className="p-4 font-bold text-slate-800">{student.fullname}</td>
                                                    <td className="p-4">{student.studentno}</td>
                                                    <td className="p-4">
                                                        <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${student.assignmentStatus === 'Unassigned' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}`}>
                                                            {student.assignmentStatus}
                                                        </span>
                                                    </td>
                                                    <td className="p-4">
                                                        <select defaultValue="" onChange={(e) => setStudentAssignments(prev => ({...prev, [student.id]: {...prev[student.id], department: e.target.value}}))} className="rounded-lg border border-slate-300 bg-white p-2 outline-none">
                                                            <option value="" disabled>Select Dept</option>
                                                            <option value="Bachelor of Science in Accountancy">Bachelor of Science in Accountancy</option>
                                                            <option value="Bachelor of Science in Business Administration major in Financial Management">Bachelor of Science in Business Administration major in Financial Management</option>
                                                            <option value="Bachelor of Science in Business Administration major in Marketing Management">Bachelor of Science in Business Administration major in Marketing Management</option>
                                                            <option value="Bachelor of Science in Business Administration major in Human Resource Management">Bachelor of Science in Business Administration major in Human Resource Management</option>
                                                            <option value="Bachelor of Science in Entrepreneurship">Bachelor of Science in Entrepreneurship</option>
                                                            <option value="Bachelor of Science in Civil Engineering">Bachelor of Science in Civil Engineering</option>
                                                            <option value="Bachelor of Science in Electrical Engineering">Bachelor of Science in Electrical Engineering</option>
                                                            <option value="Bachelor of Science in Information Technology">Bachelor of Science in Information Technology</option>
                                                            <option value="Bachelor of Early Childhood Education">Bachelor of Early Childhood Education</option>
                                                            <option value="Bachelor of Secondary Education major in English">Bachelor of Secondary Education major in English</option>
                                                            <option value="Bachelor of Secondary Education major in Filipino">Bachelor of Secondary Education major in Filipino</option>
                                                            <option value="Bachelor of Secondary Education major in Mathematics">Bachelor of Secondary Education major in Mathematics</option>
                                                            <option value="Bachelor of Secondary Education major in Science">Bachelor of Secondary Education major in Science</option>
                                                            <option value="Bachelor of Secondary Education major in Social Studies">Bachelor of Secondary Education major in Social Studies</option>
                                                            <option value="Bachelor of Physical Education">Bachelor of Physical Education</option>
                                                            <option value="Bachelor of Arts in Communication">Bachelor of Arts in Communication</option>
                                                            <option value="Bachelor of Arts in Psychology">Bachelor of Arts in Psychology</option>
                                                            <option value="Bachelor of Science in Social Work">Bachelor of Science in Social Work</option>
                                                            <option value="Bachelor of Science in Public Administration">Bachelor of Science in Public Administration</option>
                                                            <option value="Master of Arts in Education">Master of Arts in Education</option>
                                                            <option value="Master in Public Administration">Master in Public Administration</option>
                                                        </select>
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="flex gap-2">
                                                            <select defaultValue="" onChange={(e) => setStudentAssignments(prev => ({...prev, [student.id]: {...prev[student.id], yearLevel: e.target.value}}))} className="rounded-lg border border-slate-300 bg-white p-2 outline-none">
                                                                <option value="" disabled>Year</option>
                                                                <option value="1">1st</option>
                                                                <option value="2">2nd</option>
                                                                <option value="3">3rd</option>
                                                                <option value="4">4th</option>
                                                            </select>
                                                            <select defaultValue="" onChange={(e) => setStudentAssignments(prev => ({...prev, [student.id]: {...prev[student.id], sectionNum: e.target.value}}))} className="rounded-lg border border-slate-300 bg-white p-2 outline-none">
                                                                <option value="" disabled>Sec</option>
                                                                {[...Array(15)].map((_, i) => <option key={i+1} value={i+1}>{i+1}</option>)}
                                                            </select>
                                                        </div>
                                                    </td>
                                                    <td className="p-4">
                                                        <button onClick={() => submitStudentAssignment(student.id)} className="rounded-lg bg-[#003366] px-4 py-2 font-bold text-white hover:bg-[#00264d] mr-2">Assign</button>
                                                        <button onClick={() => handleDropStudent(student.id, student.fullname)} className="rounded-lg bg-red-500 px-4 py-2 font-bold text-white hover:bg-red-600">Drop</button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table></div>
                            </div>
                        )}
                        {mainTab === 'assignAdmins' && (
                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                                <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm">
                                    <thead>
                                        <tr className="bg-[#003366] text-white">
                                            <th className="p-4">Name</th>
                                            <th className="p-4">Role</th>
                                            <th className="p-4">Email</th>
                                            <th className="p-4">Current Department</th>
                                            <th className="p-4">Assign New Dept</th>
                                            <th className="p-4">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {approvedAdmins.length === 0 ? (
                                            <tr>
                                                <td colSpan="6" className="p-8 text-center text-slate-500">No approved department admins waiting for assignment.</td>
                                            </tr>
                                        ) : (
                                            approvedAdmins.map((admin, index) => (
                                                <tr key={admin.id} className="border-b border-slate-100 hover:bg-slate-50">
                                                    <td className="p-4 font-bold text-slate-800">{admin.fullname}</td>
                                                    <td className="p-4 capitalize">{admin.role}</td>
                                                    <td className="p-4 text-slate-500">{admin.email}</td>
                                                    <td className="p-4">
                                                        <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${admin.department === 'Unassigned' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                                            {admin.department}
                                                        </span>
                                                    </td>
                                                    <td className="p-4">
                                                        <select defaultValue="" onChange={(e) => setAdminAssignments(prev => ({...prev, [admin.id]: {department: e.target.value}}))} className="rounded-lg border border-slate-300 bg-white p-2 outline-none">
                                                            <option value="" disabled>Select Dept</option>
                                                            <option value="Bachelor of Science in Accountancy">Bachelor of Science in Accountancy</option>
                                                            <option value="Bachelor of Science in Business Administration major in Financial Management">Bachelor of Science in Business Administration major in Financial Management</option>
                                                            <option value="Bachelor of Science in Business Administration major in Marketing Management">Bachelor of Science in Business Administration major in Marketing Management</option>
                                                            <option value="Bachelor of Science in Business Administration major in Human Resource Management">Bachelor of Science in Business Administration major in Human Resource Management</option>
                                                            <option value="Bachelor of Science in Entrepreneurship">Bachelor of Science in Entrepreneurship</option>
                                                            <option value="Bachelor of Science in Civil Engineering">Bachelor of Science in Civil Engineering</option>
                                                            <option value="Bachelor of Science in Electrical Engineering">Bachelor of Science in Electrical Engineering</option>
                                                            <option value="Bachelor of Science in Computer Engineering">Bachelor of Science in Computer Engineering</option>
                                                            <option value="Bachelor of Science in Information Technology">Bachelor of Science in Information Technology</option>
                                                            <option value="Bachelor of Early Childhood Education">Bachelor of Early Childhood Education</option>
                                                            <option value="Bachelor of Secondary Education major in English">Bachelor of Secondary Education major in English</option>
                                                            <option value="Bachelor of Secondary Education major in Filipino">Bachelor of Secondary Education major in Filipino</option>
                                                            <option value="Bachelor of Secondary Education major in Mathematics">Bachelor of Secondary Education major in Mathematics</option>
                                                            <option value="Bachelor of Secondary Education major in Science">Bachelor of Secondary Education major in Science</option>
                                                            <option value="Bachelor of Secondary Education major in Social Studies">Bachelor of Secondary Education major in Social Studies</option>
                                                            <option value="Bachelor of Physical Education">Bachelor of Physical Education</option>
                                                            <option value="Bachelor of Arts in Communication">Bachelor of Arts in Communication</option>
                                                            <option value="Bachelor of Arts in Psychology">Bachelor of Arts in Psychology</option>
                                                            <option value="Bachelor of Science in Social Work">Bachelor of Science in Social Work</option>
                                                            <option value="Bachelor of Science in Public Administration">Bachelor of Science in Public Administration</option>
                                                            <option value="Master of Arts in Education">Master of Arts in Education</option>
                                                            <option value="Master in Public Administration">Master in Public Administration</option>
                                                        </select>
                                                    </td>
                                                    <td className="p-4">
                                                        <button onClick={() => submitAdminAssignment(admin.id)} className="rounded-lg bg-[#003366] px-4 py-2 font-bold text-white hover:bg-[#00264d]">Assign</button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table></div>
                            </div>
                        )}
                        {mainTab === 'assignFaculties' && (
                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                                <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm">
                                    <thead>
                                        <tr className="bg-[#003366] text-white">
                                            <th className="p-4">Name</th>
                                            <th className="p-4">Email</th>
                                            <th className="p-4">Current Assignment</th>
                                            <th className="p-4">Assign Dept</th>
                                            <th className="p-4">Assign Section</th>
                                            <th className="p-4">Assign Year</th>
                                            <th className="p-4">Subject</th>
                                            <th className="p-4">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {approvedFaculties.length === 0 ? (
                                            <tr>
                                                <td colSpan="8" className="p-8 text-center text-slate-500">No approved faculty members waiting for assignment.</td>
                                            </tr>
                                        ) : (
                                            approvedFaculties.map((faculty, index) => (
                                                <tr key={faculty.id} className="border-b border-slate-100 hover:bg-slate-50">
                                                    <td className="p-4 font-bold text-slate-800">{faculty.fullname}</td>
                                                    <td className="p-4 text-slate-500">{faculty.email}</td>
                                                    <td className="p-4">
                                                        {(!faculty.department || faculty.department === 'Unassigned') ? (
                                                            <span className="inline-block rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800">
                                                                Unassigned
                                                            </span>
                                                        ) : (
                                                            <span className="inline-block rounded-lg bg-green-100 px-3 py-1 text-xs font-bold text-green-800">
                                                                {faculty.department} - {faculty.yearLevel}{faculty.section}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="p-4">
                                                        <select defaultValue="" onChange={(e) => setFacultyAssignments(prev => ({...prev, [faculty.id]: {...prev[faculty.id], department: e.target.value}}))} className="rounded-lg border border-slate-300 bg-white p-2 outline-none">
                                                            <option value="" disabled>Select</option>
                                                            <option value="Bachelor of Science in Accountancy">Bachelor of Science in Accountancy</option>
                                                            <option value="Bachelor of Science in Business Administration major in Financial Management">Bachelor of Science in Business Administration major in Financial Management</option>
                                                            <option value="Bachelor of Science in Business Administration major in Marketing Management">Bachelor of Science in Business Administration major in Marketing Management</option>
                                                            <option value="Bachelor of Science in Business Administration major in Human Resource Management">Bachelor of Science in Business Administration major in Human Resource Management</option>
                                                            <option value="Bachelor of Science in Civil Engineering">Bachelor of Science in Civil Engineering</option>
                                                            <option value="Bachelor of Science in Electrical Engineering">Bachelor of Science in Electrical Engineering</option>
                                                            <option value="Bachelor of Science in Computer Engineering">Bachelor of Science in Computer Engineering</option>
                                                            <option value="Bachelor of Science in Information Technology">Bachelor of Science in Information Technology</option>
                                                            <option value="Bachelor of Early Childhood Education">Bachelor of Early Childhood Education</option>
                                                            <option value="Bachelor of Secondary Education major in English">Bachelor of Secondary Education major in English</option>
                                                            <option value="Bachelor of Secondary Education major in Filipino">Bachelor of Secondary Education major in Filipino</option>
                                                            <option value="Bachelor of Secondary Education major in Mathematics">Bachelor of Secondary Education major in Mathematics</option>
                                                            <option value="Bachelor of Secondary Education major in Science">Bachelor of Secondary Education major in Science</option>
                                                            <option value="Bachelor of Secondary Education major in Social Studies">Bachelor of Secondary Education major in Social Studies</option>
                                                            <option value="Bachelor of Arts in Communication">Bachelor of Arts in Communication</option>
                                                            <option value="Bachelor of Arts in Psychology">Bachelor of Arts in Psychology</option>
                                                            <option value="Bachelor of Science in Social Work">Bachelor of Science in Social Work</option>
                                                            <option value="Bachelor of Science in Public Administration">Bachelor of Science in Public Administration</option>
                                                            <option value="Master of Arts in Education">Master of Arts in Education</option>
                                                            <option value="Master in Public Administration">Master in Public Administration</option>
                                                        </select>
                                                    </td>
                                                    <td className="p-4">
                                                        <select defaultValue="" onChange={(e) => setFacultyAssignments(prev => ({...prev, [faculty.id]: {...prev[faculty.id], section: e.target.value}}))} className="rounded-lg border border-slate-300 bg-white p-2 outline-none">
                                                            <option value="" disabled>Sec</option>
                                                            {[...Array(15)].map((_, i) => <option key={i+1} value={i+1}>{i+1}</option>)}
                                                        </select>
                                                    </td>
                                                    <td className="p-4">
                                                        <select defaultValue="" onChange={(e) => setFacultyAssignments(prev => ({...prev, [faculty.id]: {...prev[faculty.id], yearLevel: e.target.value}}))} className="rounded-lg border border-slate-300 bg-white p-2 outline-none">
                                                            <option value="" disabled>Select</option>
                                                            <option value="1">1st</option>
                                                            <option value="2">2nd</option>
                                                            <option value="3">3rd</option>
                                                            <option value="4">4th</option>
                                                        </select>
                                                    </td>
                                                    <td className="p-4">
                                                        <input type="text" placeholder="Subject Code" onChange={(e) => setFacultyAssignments(prev => ({...prev, [faculty.id]: {...prev[faculty.id], subject: e.target.value}}))} className="rounded-lg border border-slate-300 bg-white p-2 outline-none w-24" />
                                                    </td>
                                                    <td className="p-4">
                                                        <button onClick={() => submitFacultyAssignment(faculty.id)} className="rounded-lg bg-[#003366] px-4 py-2 font-bold text-white hover:bg-[#00264d]">Assign</button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table></div>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
};
export default RegistrarGradesView;