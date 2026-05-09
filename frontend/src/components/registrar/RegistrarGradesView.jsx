import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchAllGrades, finalizeGrade, fetchPendingRequests, approveRegistrationRequest, denyRegistrationRequest, fetchApprovedStudents, assignStudent, fetchApprovedAdmins, assignDepartmentAdmin, fetchApprovedFaculties, assignFaculty, dropStudent, getDecryptedIpfsUrl, fetchStagedGrades, finalizeStagedGrades } from '../../services/api';
import RegistrarHeader from './RegistrarHeader';
import RegistrarSidebar from './RegistrarSidebar';
import RegistrarDashboard from './RegistrarDashboard';
import StudentListImport from '../student/StudentListImport';
import EncodingPeriod from './EncodingPeriod';
import SystemLogs from './SystemLogs';
import PdfReportViewer from '../shared/PdfReportViewer';
import Modal from '../../services/Modal';
import RegistrarStudentSectioning from './RegistrarStudentSectioning';
import RegistrarSectionsCreated from './RegistrarSectionsCreated';

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

const RegistrarGradesView = ({
    loggedInEmail = '',
    loggedInName = '',
    chatUnreadCount = 0,
    latestChatNotice = null,
    onOpenChat,
}) => {
    const [grades, setGrades] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState(null); 
    const [mainTab, setMainTab] = useState('dashboard'); 
    
    const [pendingRequests, setPendingRequests] = useState([]);
    const [requestSearchTerm, setRequestSearchTerm] = useState('');

    const [approvedStudents, setApprovedStudents] = useState([]);
    const [studentAssignments, setStudentAssignments] = useState({});
    const [approvedAdmins, setApprovedAdmins] = useState([]);
    const [adminAssignments, setAdminAssignments] = useState({});
    const [approvedFaculties, setApprovedFaculties] = useState([]);
    const [facultyAssignments, setFacultyAssignments] = useState({});

    const [stagedGrades, setStagedGrades] = useState([]);
    const [stagedLoading, setStagedLoading] = useState(false);

    const [filterDept, setFilterDept] = useState('All');
    const [filterYear, setFilterYear] = useState('All');
    const [filterSection, setFilterSection] = useState('All');

    const departments = [
        "Bachelor of Science in Information Technology",
        "Bachelor of Science in Accountancy",
        "Bachelor of Science in Business Administration",
        "Bachelor of Science in Civil Engineering",
        "Bachelor of Science in Electrical Engineering",    
        "Bachelor of Science in Psychology",
        "Bachelor of Early Childhood Education",
        "Bachelor of Secondary Education major in English",
        "Bachelor of Secondary Education major in Filipino",
        "Bachelor of Secondary Education major in Mathematics",
        "Bachelor of Secondary Education major in Science",
        "Bachelor of Secondary Education major in Social Studies",
        "Bachelor of Physical Education",
        "Bachelor of Arts in Communication",
        "Bachelor of Arts in Psychology",
        "Bachelor of Science in Social Work",
        "Bachelor of Science in Public Administration",
        "Master of Arts in Education",
        "Master in Public Administration"
    ];
    const [sectioningDepartment, setSectioningDepartment] = useState(departments[0]);

    const [ipfsModalOpen, setIpfsModalOpen] = useState(false);
    const [ipfsCid, setIpfsCid] = useState("");
    const [vaultPassword, setVaultPassword] = useState("");
    const [showVaultPassword, setShowVaultPassword] = useState(false);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: "", message: "", onConfirm: null, isDestructive: false });

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

    const loadStagedGrades = useCallback(async () => {
        setStagedLoading(true);
        try {
            const response = await fetchAllGrades(loggedInEmail);
            const allData = Array.isArray(response) ? response : (response.data || []);
            const approvedGrades = allData.filter(g => g.status === 'DepartmentApproved' || g.status === 'Approved');
            const formattedStaged = approvedGrades.map(g => ({
                stagingId: g.id,
                studentHash: g.student_hash || g.studentId,
                subjectCode: g.subject_code,
                grade: g.grade,
                course: g.course,
                yearLevel: g.year_level || g.yearLevel || "N/A",
                section: g.section,
                status: g.status
            }));
            setStagedGrades(formattedStaged);
        } catch (error) { console.error('Error loading staged grades:', error); }
        setStagedLoading(false);
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
        if (mainTab === 'Requests') {
            loadRequests();
        }
        if (mainTab === 'finalization') {
            loadStagedGrades();
        }
    }, [mainTab, loadRequests, loadStagedGrades]);

    useEffect(() => {
        const handleAcademicDataChanged = () => {
            loadGrades(true);
            if (mainTab === 'Requests') loadRequests();
            if (mainTab === 'finalization') loadStagedGrades();
            if (mainTab === 'assignStudents') loadApprovedStudents();
            if (mainTab === 'assignAdmins') loadApprovedAdmins();
            if (mainTab === 'assignFaculties') loadApprovedFaculties();
        };

        window.addEventListener('blockgo:academic-data-changed', handleAcademicDataChanged);
        return () => window.removeEventListener('blockgo:academic-data-changed', handleAcademicDataChanged);
    }, [mainTab, loadGrades, loadRequests, loadStagedGrades, loadApprovedStudents, loadApprovedAdmins, loadApprovedFaculties]);

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

    const handleFinalizeStaged = async (stagingId) => {
        try {
            await finalizeGrade(stagingId, loggedInEmail);
            alert("Grade officially committed to the ledger!");
            loadStagedGrades();
            loadGrades(true);
        } catch (error) { alert(`Finalization failed: ${error.message}`); }
    };

    const handleViewIpfs = (cid) => {
        setIpfsCid(cid);
        setVaultPassword("");
        setShowVaultPassword(false);
        setIpfsModalOpen(true);
    };

    const submitIpfsPassword = () => {
        if (vaultPassword) {
            const url = getDecryptedIpfsUrl(ipfsCid, vaultPassword);
            window.open(url, "_blank");
            setIpfsModalOpen(false);
        } else {
            alert("Vault Password is required");
        }
    };

    const handleApproveRequest = async (id, type) => {
        setConfirmModal({
            isOpen: true,
            title: "Approve Request",
            message: `Are you sure you want to approve this ${type} registration request?`,
            onConfirm: async () => {
                try {
                    await approveRegistrationRequest(id, type);
                    alert("Request approved successfully!");
                    loadRequests(); 
                } catch (error) { alert(`Failed to approve: ${error.message}`); }
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const handleDenyRequest = async (id) => {
        setConfirmModal({
            isOpen: true,
            title: "Deny Request",
            message: "Are you sure you want to deny this request?",
            isDestructive: true,
            onConfirm: async () => {
                try {
                    await denyRegistrationRequest(id);
                    alert("Request denied and removed.");
                    loadRequests(); 
                } catch (error) { alert(`Failed to deny: ${error.message}`); }
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const handleDropStudent = async (id, name) => {
        setConfirmModal({
            isOpen: true,
            title: "Drop Student",
            message: `Are you sure you want to drop ${name}? This will revoke their system access completely.`,
            isDestructive: true,
            onConfirm: async () => {
                try {
                    await dropStudent(id);
                    alert(`${name} has been dropped and access revoked.`);
                    loadApprovedStudents();
                } catch (error) {
                    alert(error.message);
                }
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const sortedAndFilteredRequests = useMemo(() => {
        let sortableItems = [...pendingRequests];
        const searchTerm = requestSearchTerm.toLowerCase();
        return sortableItems.filter(req => Object.values(req).some(val => String(val).toLowerCase().includes(searchTerm)));
    }, [pendingRequests, requestSearchTerm]);

    const filteredGrades = grades.filter(grade => {
        if (!loggedInEmail) return false;
        const matchesDept = filterDept === 'All' || (grade.course || "").includes(filterDept) || (grade.subject_code || "").includes(filterDept);
        const matchesYear = filterYear === 'All' || (String(grade.year_level) === filterYear) || (grade.subject_code?.match(/[A-Za-z]+-?(\d)/)?.[1] === filterYear);
        const matchesSection = filterSection === 'All' || (String(grade.section) === filterSection) || (grade.section?.includes(filterSection));
        return matchesDept && matchesYear && matchesSection;
    });

    const handleDownloadLedgerPDF = () => {
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('l', 'mm', 'a4');
            doc.setTextColor(0, 51, 102);
            doc.setFontSize(22);
            doc.text("PLV OFFICIAL GRADES LEDGER", 14, 20);
            doc.setFontSize(10);
            doc.setTextColor(100);
            doc.text(`Academic Audit Report - Blockchain Verified`, 14, 27);
            doc.text(`Filter - Dept: ${filterDept} | Year: ${filterYear} | Section: ${filterSection}`, 14, 32);
            doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 37);

            const tableColumn = ["Record ID", "Student Hash", "Subject", "Grade", "Faculty", "Year", "Section", "Status"];
            const tableRows = filteredGrades.map(g => [
                g.id,
                g.student_hash || g.studentId || "N/A",
                g.subject_code,
                g.grade,
                g.facultyId || g.faculty_id || "N/A",
                g.year_level || "N/A",
                g.section || "N/A",
                g.status
            ]);

            doc.autoTable({
                head: [tableColumn],
                body: tableRows,
                startY: 42,
                theme: 'grid',
                headStyles: { fillColor: [0, 51, 102], fontSize: 8 },
                bodyStyles: { fontSize: 7 },
            });
            doc.save(`Grades_Ledger_Audit_${new Date().toISOString().split('T')[0]}.pdf`);
        } catch (error) { alert("Failed to export PDF."); }
    };

    return (
        <div className="flex h-screen w-full flex-col bg-slate-50 font-sans fixed inset-0 z-[100] overflow-auto">
            <RegistrarHeader registrarData={{ name: loggedInName }} onLogout={() => { localStorage.removeItem('token'); window.location.reload(); }} />
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden p-4 md:p-6 gap-6">
                <RegistrarSidebar
                    activeTab={mainTab}
                    setActiveTab={setMainTab}
                    chatUnreadCount={chatUnreadCount}
                    latestChatNotice={latestChatNotice}
                    onOpenChat={onOpenChat}
                />
                <main className="flex-1 overflow-y-auto pr-2">
                    {mainTab === 'dashboard' && <RegistrarDashboard grades={grades} />}
                    {mainTab === 'encoding' && <EncodingPeriod />}
                    {mainTab === 'studentlist' && <StudentListImport />}
                    {mainTab === 'sectioning' && (
                        <div className="space-y-4">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <label className="block max-w-xl">
                                    <span className="mb-2 block text-sm font-medium text-slate-700">Department</span>
                                    <select
                                        value={sectioningDepartment}
                                        onChange={(event) => setSectioningDepartment(event.target.value)}
                                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#003366]"
                                    >
                                        {departments.map((department) => (
                                            <option key={department} value={department}>
                                                {department}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <RegistrarStudentSectioning chairpersonDepartment={sectioningDepartment} />
                        </div>
                    )}
                    {mainTab === 'sectionsCreated' && <RegistrarSectionsCreated />}
                    {mainTab === 'reports' && (
                        <div className="flex flex-col gap-8">
                            <SystemLogs />
                            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                                <h3 className="mb-6 text-xl font-bold text-[#003366]">System Compliance Report Preview</h3>
                                <PdfReportViewer title="PLV System Activity & Compliance" />
                            </div>
                        </div>
                    )}
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
                    {mainTab === 'grades' && (
                        <>
                            <div className="mb-6 flex flex-col md:flex-row items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex flex-wrap items-center gap-4">
                                    <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold outline-none focus:border-[#003366]">
                                        <option value="All">All Departments</option>
                                        {departments.map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                    <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold outline-none focus:border-[#003366]">
                                        <option value="All">All Years</option>
                                        <option value="1">1st Year</option><option value="2">2nd Year</option><option value="3">3rd Year</option><option value="4">4th Year</option>
                                    </select>
                                    <select value={filterSection} onChange={(e) => setFilterSection(e.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold outline-none focus:border-[#003366]">
                                        <option value="All">All Sections</option>
                                        {[...Array(15)].map((_, i) => <option key={i+1} value={String(i+1)}>{i+1}</option>)}
                                    </select>
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={handleDownloadLedgerPDF} className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-emerald-700">Export PDF</button>
                                    <button onClick={loadGrades} className="rounded-xl bg-[#003366] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#00264d]">Refresh</button>
                                </div>
                            </div>
                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
                                <table className="w-full min-w-[800px] text-left text-sm">
                                    <thead>
                                        <tr className="bg-[#003366] text-white">
                                            <th className="p-4">Record ID</th><th className="p-4">Student Hash</th><th className="p-4">Subject</th><th className="p-4">Grade</th><th className="p-4">Faculty</th><th className="p-4">Status</th><th className="p-4">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredGrades.map((grade) => (
                                            <tr key={grade.id} className="border-b border-slate-100 hover:bg-slate-50">
                                                <td className="p-4 font-mono text-xs">{grade.id}</td>
                                                <td className="p-4 font-mono text-xs"><HoverableID fullId={grade.student_hash || grade.studentId} isAuthorized={true} /></td>
                                                <td className="p-4 font-bold">{grade.subject_code}</td>
                                                <td className="p-4 font-black">{grade.grade}</td>
                                                <td className="p-4">{grade.facultyId || "N/A"}</td>
                                                <td className="p-4"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase">{grade.status}</span></td>
                                                <td className="p-4">
                                                    {(grade.ipfs_cid || grade.IpfsCID) && <button onClick={() => handleViewIpfs(grade.ipfs_cid || grade.IpfsCID)} className="text-blue-600 font-bold hover:underline">View File</button>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                    {mainTab === 'finalization' && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                            <div className="mb-6 flex items-center justify-between">
                                <h3 className="text-xl font-bold text-[#003366]">Grades Pending Ledger Entry</h3>
                                <button onClick={loadStagedGrades} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200">Refresh Staging</button>
                            </div>
                            {stagedLoading ? <p>Loading staged records...</p> : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm">
                                        <thead>
                                            <tr className="bg-slate-100 text-slate-600">
                                                <th className="p-3">Student (Hashed)</th><th className="p-3">Subject</th><th className="p-3">Grade</th><th className="p-3">Dept</th><th className="p-3">Sec</th><th className="p-3">Status</th><th className="p-3">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {stagedGrades.length === 0 ? <tr><td colSpan="7" className="p-8 text-center text-slate-400">No grades approved by departments waiting for finalization.</td></tr> : stagedGrades.map(sg => (
                                                <tr key={sg.stagingId} className="border-b border-slate-50">
                                                    <td className="p-3 font-mono text-[10px]">{sg.studentHash}</td>
                                                    <td className="p-3 font-bold">{sg.subjectCode}</td>
                                                    <td className="p-3 font-black text-blue-700">{sg.grade}</td>
                                                    <td className="p-3 text-xs">{sg.course}</td>
                                                    <td className="p-3">{sg.yearLevel}-{sg.section}</td>
                                                    <td className="p-3"><span className="text-[10px] font-bold text-emerald-600">{sg.status}</span></td>
                                                    <td className="p-3">
                                                        <button onClick={() => handleFinalizeStaged(sg.stagingId)} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700">Commit to Ledger</button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                    {mainTab === 'Requests' && (
                        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                            <div className="border-b border-slate-200 p-4">
                                <input type="text" placeholder="Search..." value={requestSearchTerm} onChange={e => setRequestSearchTerm(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 outline-none" />
                            </div>
                            <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm">
                                <thead>
                                    <tr className="bg-[#003366] text-white">
                                        <th className="p-4">Role</th><th className="p-4">Name</th><th className="p-4">Student No.</th><th className="p-4">Email</th><th className="p-4">Department</th><th className="p-4">Actions</th>
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
                                        <th className="p-4">Name</th><th className="p-4">Student No.</th><th className="p-4">Status</th><th className="p-4">Assign Dept</th><th className="p-4">Assign Section</th><th className="p-4">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {approvedStudents.length === 0 ? <tr><td colSpan="6" className="p-8 text-center text-slate-500">No approved students waiting for assignment.</td></tr> : approvedStudents.map((student) => (
                                        <tr key={student.id} className="border-b border-slate-100 hover:bg-slate-50">
                                            <td className="p-4 font-bold text-slate-800">{student.fullname}</td>
                                            <td className="p-4">{student.studentno}</td>
                                            <td className="p-4"><span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${student.assignmentStatus === 'Unassigned' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}`}>{student.assignmentStatus}</span></td>
                                            <td className="p-4">
                                                <select defaultValue="" onChange={(e) => setStudentAssignments(prev => ({...prev, [student.id]: {...prev[student.id], department: e.target.value}}))} className="rounded-lg border border-slate-300 bg-white p-2 outline-none">
                                                    <option value="" disabled>Select Dept</option>
                                                    {departments.map(d => <option key={d} value={d}>{d}</option>)}
                                                </select>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex gap-2">
                                                    <select defaultValue="" onChange={(e) => setStudentAssignments(prev => ({...prev, [student.id]: {...prev[student.id], yearLevel: e.target.value}}))} className="rounded-lg border border-slate-300 bg-white p-2 outline-none">
                                                        <option value="" disabled>Year</option>
                                                        <option value="1">1st</option><option value="2">2nd</option><option value="3">3rd</option><option value="4">4th</option>
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
                                    ))}
                                </tbody>
                            </table></div>
                        </div>
                    )}
                    {mainTab === 'assignAdmins' && (
                        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                            <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm">
                                <thead>
                                    <tr className="bg-[#003366] text-white">
                                        <th className="p-4">Name</th><th className="p-4">Role</th><th className="p-4">Email</th><th className="p-4">Current Department</th><th className="p-4">Assign New Dept</th><th className="p-4">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {approvedAdmins.length === 0 ? <tr><td colSpan="6" className="p-8 text-center text-slate-500">No approved department admins waiting for assignment.</td></tr> : approvedAdmins.map((admin) => (
                                        <tr key={admin.id} className="border-b border-slate-100 hover:bg-slate-50">
                                            <td className="p-4 font-bold text-slate-800">{admin.fullname}</td>
                                            <td className="p-4 capitalize">{admin.role}</td>
                                            <td className="p-4 text-slate-500">{admin.email}</td>
                                            <td className="p-4"><span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${admin.department === 'Unassigned' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>{admin.department}</span></td>
                                            <td className="p-4">
                                                <select defaultValue="" onChange={(e) => setAdminAssignments(prev => ({...prev, [admin.id]: {department: e.target.value}}))} className="rounded-lg border border-slate-300 bg-white p-2 outline-none">
                                                    <option value="" disabled>Select Dept</option>
                                                    {departments.map(d => <option key={d} value={d}>{d}</option>)}
                                                </select>
                                            </td>
                                            <td className="p-4">
                                                <button onClick={() => submitAdminAssignment(admin.id)} className="rounded-lg bg-[#003366] px-4 py-2 font-bold text-white hover:bg-[#00264d]">Assign</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table></div>
                        </div>
                    )}
                    {mainTab === 'assignFaculties' && (
                        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                            <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm">
                                <thead>
                                    <tr className="bg-[#003366] text-white">
                                        <th className="p-4">Name</th><th className="p-4">Email</th><th className="p-4">Current Assignment</th><th className="p-4">Assign Dept</th><th className="p-4">Assign Section</th><th className="p-4">Assign Year</th><th className="p-4">Subject</th><th className="p-4">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {approvedFaculties.length === 0 ? <tr><td colSpan="8" className="p-8 text-center text-slate-500">No approved faculty members waiting for assignment.</td></tr> : approvedFaculties.map((faculty) => (
                                        <tr key={faculty.id} className="border-b border-slate-100 hover:bg-slate-50">
                                            <td className="p-4 font-bold text-slate-800">{faculty.fullname}</td>
                                            <td className="p-4 text-slate-500">{faculty.email}</td>
                                            <td className="p-4">{(!faculty.department || faculty.department === 'Unassigned') ? <span className="inline-block rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800">Unassigned</span> : <span className="inline-block rounded-lg bg-green-100 px-3 py-1 text-xs font-bold text-green-800">{faculty.department} - {faculty.yearLevel}{faculty.section}</span>}</td>
                                            <td className="p-4">
                                                <select defaultValue="" onChange={(e) => setFacultyAssignments(prev => ({...prev, [faculty.id]: {...prev[faculty.id], department: e.target.value}}))} className="rounded-lg border border-slate-300 bg-white p-2 outline-none">
                                                    <option value="" disabled>Select</option>
                                                    {departments.map(d => <option key={d} value={d}>{d}</option>)}
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
                                                    <option value="1">1st</option><option value="2">2nd</option><option value="3">3rd</option><option value="4">4th</option>
                                                </select>
                                            </td>
                                            <td className="p-4">
                                                <input type="text" placeholder="Subject Code" onChange={(e) => setFacultyAssignments(prev => ({...prev, [faculty.id]: {...prev[faculty.id], subject: e.target.value}}))} className="rounded-lg border border-slate-300 bg-white p-2 outline-none w-24" />
                                            </td>
                                            <td className="p-4">
                                                <button onClick={() => submitFacultyAssignment(faculty.id)} className="rounded-lg bg-[#003366] px-4 py-2 font-bold text-white hover:bg-[#00264d]">Assign</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table></div>
                        </div>
                    )}
                </main>
            </div>
            <Modal isOpen={ipfsModalOpen} onClose={() => setIpfsModalOpen(false)} title="IPFS Vault Decryption">
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-slate-600">This academic record is encrypted and distributed across the PLV IPFS Network. Enter the Vault Password to view the decrypted content.</p>
                    <div className="relative">
                        <input type={showVaultPassword ? "text" : "password"} value={vaultPassword} onChange={(e) => setVaultPassword(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 pr-10 text-sm outline-none focus:border-[#003366]" placeholder="Enter Vault Password" onKeyDown={(e) => e.key === 'Enter' && submitIpfsPassword()} autoFocus />
                        <button type="button" onClick={() => setShowVaultPassword(!showVaultPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#003366]">
                            {showVaultPassword ? (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            )}
                        </button>
                    </div>
                    <div className="flex justify-end gap-3 mt-4">
                        <button onClick={() => setIpfsModalOpen(false)} className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50">Cancel</button>
                        <button onClick={submitIpfsPassword} className="rounded-xl bg-[#003366] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#00264d]">Decrypt & View</button>
                    </div>
                </div>
            </Modal>            
            <Modal isOpen={confirmModal.isOpen} onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })} title={confirmModal.title}>
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-slate-600">{confirmModal.message}</p>
                    <div className="flex justify-end gap-3 mt-4">
                        <button onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })} className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50">Cancel</button>
                        <button onClick={confirmModal.onConfirm} className={`rounded-xl px-5 py-2.5 text-sm font-bold text-white transition ${confirmModal.isDestructive ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>Confirm</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};
export default RegistrarGradesView;
