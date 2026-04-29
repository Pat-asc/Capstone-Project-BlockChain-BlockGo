import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchAllGrades, approveGrade, finalizeGrade, fetchDepartmentPendingStudents, approveStudentEnrollment, batchUploadGrades, fetchFacultySections, fetchFacultyStudents, createSection, fetchDepartmentSections, batchEnrollStudentsToSection, dropStudent, fetchApprovedFaculties, unassignFacultySection } from '../../services/api';
import { useNotification } from '../../services/NotificationContext';
import ChairpersonHeader from './ChairpersonHeader';
import ChairpersonSidebar from './ChairpersonSidebar';
import ChairpersonOverview from './ChairpersonOverview';
import FacultyStatusTable from '../faculty/FacultyStatusTable';
import SectionReviewPanel from './SectionReviewPanel';

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

const DeptAdminGradesView = ({ loggedInEmail = '', loggedInName = '', userRole = '', department = '' }) => {
    const [grades, setGrades] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState(null); 
    
    const { addNotification } = useNotification();
    const [mainTab, setMainTab] = useState('grades'); 
    const [deptPendingStudents, setDeptPendingStudents] = useState([]);
    const [selectedReviewSection, setSelectedReviewSection] = useState(null);
    const [uploadFile, setUploadFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [mySections, setMySections] = useState([]);
    const [myStudents, setMyStudents] = useState([]);
    const [selectedMySection, setSelectedMySection] = useState(null);

    const [academicSections, setAcademicSections] = useState([]);
    const [newSectionData, setNewSectionData] = useState({ yearLevel: '', sectionNum: '', subjectCode: '' });
    const [enrollFile, setEnrollFile] = useState(null);
    const [enrollSectionId, setEnrollSectionId] = useState('');
    const [isCreatingSection, setIsCreatingSection] = useState(false);
    const [isEnrolling, setIsEnrolling] = useState(false);
    const [assignToFaculty, setAssignToFaculty] = useState('self');
    const [departmentFaculties, setDepartmentFaculties] = useState([]);
    const [forwardedBatches, setForwardedBatches] = useState([]);

    const deptMetrics = useMemo(() => {
        const facultySet = new Set();
        const sectionMap = {};

        grades.forEach(g => {
            const facId = g.facultyId || g.faculty_id || g.FacultyId || 'Unknown';
            const course = g.course || g.Course || g.subject_code || g.subjectCode || 'Unknown Section';
            const status = g.status || g.Status || '';

            if (facId !== 'Unknown') facultySet.add(facId);

            // Group statuses per unique section rather than per student grade
            const sectionKey = `${facId}-${course}`;
            if (!sectionMap[sectionKey]) {
                sectionMap[sectionKey] = status;
            } else {
                const current = sectionMap[sectionKey].toLowerCase();
                const next = status.toLowerCase();
                // Escalate status if mixed
                if (next === 'finalized' || (next.includes('approved') && current.includes('issued'))) {
                    sectionMap[sectionKey] = status;
                }
            }
        });

        let submitted = 0, approved = 0, forwarded = 0, returned = 0;
        Object.values(sectionMap).forEach(st => {
            const s = st.toLowerCase();
            if (s.includes('issued') || s.includes('submitted')) submitted++;
            if (s.includes('approved')) approved++;
            if (s.includes('finalized') || s.includes('forwarded')) forwarded++;
            if (s.includes('returned') || s.includes('rejected')) returned++;
        });

        return {
            totalFaculty: facultySet.size,
            totalSections: Object.keys(sectionMap).length,
            submittedSections: submitted,
            approvedSections: approved,
            returnedSections: returned,
            forwardedSections: forwarded
        };
    }, [grades]);

    const facultyRows = useMemo(() => {
        const groups = {};
        grades.forEach(g => {
            const facId = g.facultyId || g.faculty_id || g.FacultyId || 'Unknown';
            const course = g.course || g.Course || g.subject_code || g.subjectCode || 'Unknown Section';
            const status = (g.status || g.Status || '').toLowerCase();
            const key = `${facId}-${course}`;

            if (!groups[key]) {
                groups[key] = {
                    reviewKey: key,
                    facultyName: facId,
                    facultyId: facId,
                    department: course,
                    sectionName: course,
                    subjectCode: course,
                    schoolYear: g.schoolYear || g.SchoolYear || '2024',
                    semester: g.semester || g.Semester || '2nd Semester',
                    totalStudents: 0,
                    encodedCount: 0,
                    progress: 0,
                    facultyEncodingStatus: 'In Progress',
                    reviewStatus: 'pending',
                    grades: {},
                    students: [],
                    ipfsCid: g.ipfs_cid || g.IpfsCID || g.ipfsCid || null
                };
            }
            
            // Ensure the CID is captured even if the first student's record lacked it
            if (!groups[key].ipfsCid && (g.ipfs_cid || g.IpfsCID || g.ipfsCid)) {
                groups[key].ipfsCid = g.ipfs_cid || g.IpfsCID || g.ipfsCid;
            }
            groups[key].totalStudents += 1;
            
            const gradeVal = g.grade || g.Grade;
            if (gradeVal && gradeVal.trim() !== '') groups[key].encodedCount += 1;
            
            const studentKey = g.studentId || g.student_hash || g.StudentId || 'Unknown';
            groups[key].students.push({
                studentId: studentKey,
                lastName: '',
                firstName: studentKey
            });
            groups[key].grades[studentKey] = {
                midterm: '-',
                finals: '-',
                finalAverage: gradeVal || '-',
                standing: 'active',
                flagged: false
            };
            
            if (status.includes('issued') || status.includes('submitted')) groups[key].reviewStatus = 'submitted';
            if (status.includes('approved')) groups[key].reviewStatus = 'approved';
            if (status.includes('finalized') || status.includes('forwarded')) groups[key].reviewStatus = 'forwarded';
            if (status.includes('returned') || status.includes('rejected')) groups[key].reviewStatus = 'returned';
        });
        return Object.values(groups).map(g => {
            g.progress = g.totalStudents > 0 ? Math.round((g.encodedCount / g.totalStudents) * 100) : 0;
            g.facultyEncodingStatus = g.progress === 100 ? 'Completed' : 'In Progress';
            return g;
        });
    }, [grades]);

    const loadGrades = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        try {
            const response = await fetchAllGrades(loggedInEmail);
            setGrades(Array.isArray(response) ? response : (response.data || []));
        } catch (error) {
            if (!isBackground) setErrorMsg(`Could not fetch blockchain data: ${error.message}`);
        }
        if (!isBackground) setLoading(false);
    }, [loggedInEmail]);

    const loadDeptPendingStudents = useCallback(async () => {
        try {
            const response = await fetchDepartmentPendingStudents(loggedInEmail);
            if (response.status === 'Success') setDeptPendingStudents(response.students || []);
        } catch (error) { console.error('Error loading students:', error); }
    }, [loggedInEmail]);

    useEffect(() => { loadGrades(); }, [loadGrades]);
    useEffect(() => {
        let interval;
        if (mainTab === 'grades') interval = setInterval(() => loadGrades(true), 3000);
        return () => clearInterval(interval);
    }, [loggedInEmail, mainTab]);

    useEffect(() => {
        if (mainTab === 'sectioning') loadDeptPendingStudents();
        if (mainTab === 'sectioning') {
            try {
                const batches = JSON.parse(localStorage.getItem("STUDENT_BATCHES_KEY")) || [];
                
                // Robust normalization to match old shortcodes (e.g., "IT") with new full program names
                const normalizeDept = (dept) => {
                    const d = (dept || "").toLowerCase();
                    if (d === "it" || d === "bsit" || d.includes("information technology")) return "it";                
                    if (d === "ece" || d === "bsece" || d.includes("electrical engineering") || d.includes("electronics")) return "ece";
                    if (d === "ce" || d === "bsce" || d.includes("civil engineering")) return "ce";
                    if (d.includes("accountancy")) return "acc";
                    if (d.includes("financial")) return "fm";
                    if (d.includes("marketing")) return "mm";
                    if (d.includes("human resource")) return "hrm";
                    if (d.includes("entrepreneurship")) return "ent";
                    if (d.includes("early childhood")) return "eced";
                    if (d.includes("english")) return "eng";
                    if (d.includes("filipino")) return "fil";
                    if (d.includes("mathematics")) return "math";
                    if (d.includes("science")) return "sci";
                    if (d.includes("social studies")) return "soc";
                    if (d.includes("physical education")) return "pe";
                    if (d.includes("communication")) return "comm";
                    if (d.includes("psychology")) return "psy";
                    if (d.includes("social work")) return "sw";
                    if (d.includes("public administration")) return "pa";
                    return d.replace(/[^a-z0-9]/g, '');
                };

                const normalizedAdminDept = normalizeDept(department);
                const myBatches = batches.filter(b => normalizeDept(b.program) === normalizedAdminDept);
                setForwardedBatches(myBatches);
            } catch (e) {}
        }
    }, [mainTab, loadDeptPendingStudents, department]);

    const loadMyClasses = useCallback(async () => {
        try {
            const secRes = await fetchFacultySections(loggedInEmail);
            if (secRes.status === 'Success' || secRes.sections) setMySections(secRes.sections || secRes.data || []);
            
            const stuRes = await fetchFacultyStudents(loggedInEmail);
            if (stuRes.status === 'Success' || stuRes.students) setMyStudents(stuRes.students || stuRes.data || []);
        } catch (e) { console.error("Failed to load classes:", e); }
    }, [loggedInEmail]);

    useEffect(() => {
        if (mainTab === 'myClasses') loadMyClasses();
    }, [mainTab, loadMyClasses]);

    const loadDepartmentFaculties = useCallback(async () => {
        try {
            const res = await fetchApprovedFaculties();
            if (res.status === 'Success') {
                setDepartmentFaculties(res.faculties.filter(f => f.department === department));
            }
        } catch(e) { console.error(e); }
    }, [department]);

    const loadAcademicSections = useCallback(async () => {
        if (!department) return;
        try {
            const res = await fetchDepartmentSections(department);
            if (res.status === 'Success') {
                setAcademicSections(res.data || []);
            }
        } catch (e) {
            addNotification(`Failed to load sections: ${e.message}`, 'error');
        }
    }, [department, addNotification]);

    useEffect(() => {
        if (mainTab === 'assignment' || mainTab === 'myClasses') {
            loadAcademicSections();
        }
        if (mainTab === 'assignment') {
            loadDepartmentFaculties();
        }
    }, [mainTab, loadAcademicSections, loadDepartmentFaculties]);

    const handleBulkApprove = async () => {
        if (!selectedReviewSection) return;
        try {
            const recordsToApprove = grades.filter(g => {
                const facId = g.facultyId || g.faculty_id || g.FacultyId || 'Unknown';
                const course = g.course || g.Course || g.subject_code || g.subjectCode || 'Unknown Section';
                const status = (g.status || g.Status || '').toLowerCase();
                return `${facId}-${course}` === selectedReviewSection.reviewKey && status.includes('issued');
            });
            
            for (const g of recordsToApprove) await approveGrade(g.id, loggedInEmail);
            addNotification("Section approved successfully!", "success");
            setSelectedReviewSection(null);
            loadGrades();
        } catch(e) { addNotification(`Error approving section: ${e.message}`, "error"); }
    };

    const handleBulkForward = async () => {
        if (!selectedReviewSection) return;
        try {
            const recordsToForward = grades.filter(g => {
                const facId = g.facultyId || g.faculty_id || g.FacultyId || 'Unknown';
                const course = g.course || g.Course || g.subject_code || g.subjectCode || 'Unknown Section';
                const status = (g.status || g.Status || '').toLowerCase();
                return `${facId}-${course}` === selectedReviewSection.reviewKey && status.includes('approved');
            });

            for (const g of recordsToForward) await finalizeGrade(g.id, loggedInEmail);
            addNotification("Section forwarded to Registrar successfully!", "success");
            setSelectedReviewSection(null);
            loadGrades();
        } catch(e) { addNotification(`Error forwarding section: ${e.message}`, "error"); }
    };

    const handleBulkUpload = async () => {
        if (!uploadFile) return;
        setIsUploading(true);
        try {
            const semester = selectedMySection?.semester || "2nd Semester";
            const schoolYear = selectedMySection?.schoolYear || "2024";
            const course = selectedMySection?.subjectCode || "Unknown";

            const res = await batchUploadGrades(uploadFile, semester, schoolYear, course);
            if (res.status === 'Success' || res.status === 'Partial Success') {
                addNotification(`Uploaded successfully! Processed: ${res.totalProcessed}, Success: ${res.successful}`, 'success');
                setUploadFile(null);
                const fileInput = document.getElementById('chair-grade-upload');
                if (fileInput) fileInput.value = '';
                loadGrades();
            } else {
                addNotification(`Upload failed: ${res.message}`, 'error');
            }
        } catch (e) {
            addNotification(`Error: ${e.message}`, 'error');
        }
        setIsUploading(false);
    };

    const handleCreateSection = async (e) => {
        e.preventDefault();
        if (!newSectionData.yearLevel || !newSectionData.sectionNum || !department) {
            addNotification('Year Level and Section Number are required.', 'error');
            return;
        }
        setIsCreatingSection(true);
        try {
            let assignEmail = null;
            if (assignToFaculty === 'self') assignEmail = loggedInEmail;
            else if (assignToFaculty !== 'none') assignEmail = assignToFaculty;

            const payload = { ...newSectionData, department, assignToEmail: assignEmail, subject: newSectionData.subjectCode };
            const res = await createSection(payload);
            if (res.status === 'Success') {
                addNotification(`Section ${department} ${newSectionData.yearLevel}-${newSectionData.sectionNum} (${newSectionData.subjectCode}) created successfully!`, 'success');
                
                if (res.id) {
                    setEnrollSectionId(res.id.toString());
                }
                
                setNewSectionData({ yearLevel: '', sectionNum: '', subjectCode: '' });
                if (assignEmail === loggedInEmail) loadMyClasses(); // Instantly refresh the "My Classes" tab
                loadAcademicSections(); // Refresh the list
            } else {
                addNotification(res.message || 'Failed to create section.', 'error');
            }
        } catch (err) {
            addNotification(err.message, 'error');
        }
        setIsCreatingSection(false);
    };

    const handleBulkEnroll = async () => {
        if (!enrollFile || !enrollSectionId) {
            addNotification('Please select a section and a file to upload.', 'error');
            return;
        }
        setIsEnrolling(true);
        try {
            const res = await batchEnrollStudentsToSection(enrollFile, enrollSectionId);
            if (res.status === 'Success') {
                addNotification(res.message || 'Students enrolled successfully!', 'success');
                setEnrollFile(null);
                setEnrollSectionId('');
                const fileInput = document.getElementById('student-enroll-upload');
                if (fileInput) fileInput.value = '';
            } else {
                addNotification(res.message || 'Enrollment failed.', 'error');
            }
        } catch (err) {
            addNotification(err.message, 'error');
        }
        setIsEnrolling(false);
    };

    const handleBulkEnrollMyClass = async () => {
        if (!enrollFile || !selectedMySection) return;
        
        const matchedSection = academicSections.find(sec => 
            sec.department === selectedMySection.department && 
            String(sec.yearLevel) === String(selectedMySection.yearLevel) && 
            String(sec.sectionNum) === String(selectedMySection.sectionNum || selectedMySection.section)
        );

        if (!matchedSection) {
            addNotification("Could not resolve section ID. Please use the Academic Assignment tab.", "error");
            return;
        }

        setIsEnrolling(true);
        try {
            const res = await batchEnrollStudentsToSection(enrollFile, matchedSection.id);
            if (res.status === 'Success') {
                addNotification(res.message || 'Students enrolled successfully!', 'success');
                setEnrollFile(null);
                const fileInput = document.getElementById('myclass-student-enroll-upload');
                if (fileInput) fileInput.value = '';
                loadMyClasses();
            } else {
                addNotification(res.message || 'Enrollment failed.', 'error');
            }
        } catch (err) {
            addNotification(err.message, 'error');
        }
        setIsEnrolling(false);
    };

    const handleUnassignSection = async () => {
        if (!selectedMySection) return;
        if (!window.confirm(`Are you sure you want to unassign ${selectedMySection.department} ${selectedMySection.yearLevel}-${selectedMySection.sectionNum || selectedMySection.section} from your classes?`)) return;

        try {
            await unassignFacultySection(loggedInEmail, selectedMySection.department, selectedMySection.yearLevel, selectedMySection.sectionNum || selectedMySection.section);
            addNotification("Class unassigned successfully.", "success");
            setSelectedMySection(null);
            loadMyClasses();
        } catch (e) {
            addNotification(e.message, "error");
        }
    };

    const handleDropStudent = async (id, name) => {
        if (window.confirm(`Are you sure you want to drop ${name}? This will revoke their system access completely.`)) {
            try {
                await dropStudent(id);
                addNotification(`${name} has been dropped and access revoked.`, 'success');
                loadDeptPendingStudents();
                loadMyClasses();
            } catch (e) {
                addNotification(e.message, 'error');
            }
        }
    };

    const activeChairTab = mainTab;

    return (
        <div className="flex h-screen w-full flex-col bg-slate-50 font-sans fixed inset-0 z-[100] overflow-auto">
            <ChairpersonHeader chairpersonData={{ name: loggedInName, department: userRole }} departmentCount={deptMetrics.totalFaculty} onLogout={() => { localStorage.removeItem('token'); window.location.reload(); }} />
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden p-4 md:p-6 gap-6">
                <ChairpersonSidebar activeTab={activeChairTab === 'grades' ? 'dashboard' : activeChairTab} setActiveTab={setMainTab} />
                <main className="flex-1 overflow-y-auto pr-2">
                    {(activeChairTab === 'dashboard' || activeChairTab === 'grades') && <ChairpersonOverview metrics={deptMetrics} />}
                    {['forReview', 'returned', 'approved', 'forwarded'].includes(activeChairTab) && (
                        <div className="flex flex-col gap-6">
                            <FacultyStatusTable 
                                rows={facultyRows.filter(r => {
                                    if (activeChairTab === 'forReview') return r.reviewStatus === 'submitted' || r.reviewStatus === 'pending';
                                    if (activeChairTab === 'returned') return r.reviewStatus === 'returned';
                                    if (activeChairTab === 'approved') return r.reviewStatus === 'approved';
                                    if (activeChairTab === 'forwarded') return r.reviewStatus === 'forwarded';
                                    return true;
                                })} 
                                selectedReviewKey={selectedReviewSection?.reviewKey} 
                                onSelectSection={setSelectedReviewSection} 
                            />
                            {selectedReviewSection && (
                                <SectionReviewPanel selectedSection={selectedReviewSection} activeTerm="finals" onApprove={handleBulkApprove} onSubmitToRegistrar={handleBulkForward} onSendBack={() => { addNotification("Section sent back to faculty.", "success"); setSelectedReviewSection(null); }} />
                            )}
                        </div>
                    )}
                    {activeChairTab === 'sectioning' && (
                        <div className="flex flex-col gap-6">
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                <h2 className="text-xl font-bold text-[#003366] mb-4">Forwarded Student Lists (From Registrar)</h2>
                                {forwardedBatches.length === 0 ? (
                                    <p className="text-slate-500">No student lists have been forwarded to your department yet.</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="border-b border-slate-200 bg-slate-50 text-sm font-semibold text-[#003366]">
                                                    <th className="p-3">Batch Year</th>
                                                    <th className="p-3">Attached File</th>
                                                    <th className="p-3">Students</th>
                                                    <th className="p-3">Date Forwarded</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {forwardedBatches.map(batch => (
                                                    <tr key={batch.id} className="border-b border-slate-100 hover:bg-slate-50">
                                                        <td className="p-3 text-slate-800 font-bold">{batch.batchYear}</td>
                                                        <td className="p-3">
                                                            {batch.ipfsCid ? <a href={`http://127.0.0.1:5001/ipfs/bafybeiddnr2jz65byk67sjt6jsu6g7tueddr7odhzzpzli3rgudlbnc6iq/#/ipfs/${batch.ipfsCid}`} target="_blank" rel="noreferrer" className="text-blue-600 font-bold hover:underline"> View Content in IPFS</a> : batch.fileName}
                                                        </td>
                                                        <td className="p-3 text-slate-600">{batch.totalStudents}</td>
                                                        <td className="p-3 text-slate-500">{new Date(batch.submittedAt).toLocaleString()}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                            <h2 className="text-xl font-bold text-[#003366] mb-4">Pending Student Enrollments</h2>
                            {deptPendingStudents.length === 0 ? (
                                <p className="text-slate-500">No pending students awaiting your approval.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="border-b border-slate-200 bg-slate-50 text-sm font-semibold text-[#003366]">
                                                <th className="p-3">Student Name</th>
                                                <th className="p-3">Student No.</th>
                                                <th className="p-3">Section</th>
                                                <th className="p-3">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {deptPendingStudents.map(student => (
                                                <tr key={student.id} className="border-b border-slate-100 hover:bg-slate-50">
                                                    <td className="p-3 font-medium text-slate-800">{student.fullname}</td>
                                                    <td className="p-3 text-slate-600">{student.studentno || 'N/A'}</td>
                                                    <td className="p-3 text-slate-600">{student.section || 'N/A'}</td>
                                                    <td className="p-3">
                                                        <button onClick={async () => { try { await approveStudentEnrollment(student.id); addNotification(`${student.fullname} approved!`, 'success'); loadDeptPendingStudents(); loadMyClasses(); } catch(e) { addNotification(e.message, 'error'); } }} className="rounded-full bg-green-600 px-4 py-1.5 text-sm font-bold text-white transition hover:bg-green-700 mr-2">
                                                            Approve
                                                        </button>
                                                        <button onClick={() => handleDropStudent(student.id, student.fullname)} className="rounded-full bg-red-500 px-4 py-1.5 text-sm font-bold text-white transition hover:bg-red-600">
                                                            Drop
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                        </div>
                    )}
                    {activeChairTab === 'myClasses' && (
                        <div className="flex flex-col gap-6">
                            {!selectedMySection ? (
                                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                                    <h2 className="mb-4 text-xl font-bold text-[#003366]">My Assigned Classes</h2>
                                    {mySections.length === 0 ? (
                                        <p className="text-slate-500">You have no assigned classes yet.</p>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {mySections.map((sec, idx) => (
                                                <div key={idx} onClick={() => setSelectedMySection(sec)} className="cursor-pointer rounded-xl border border-slate-200 bg-slate-50 p-5 transition hover:border-[#003366] hover:shadow-md">
                                                    <h3 className="font-bold text-lg text-[#003366]">{sec.department} {sec.yearLevel}-{sec.sectionNum || sec.section}</h3>
                                                    <p className="text-sm font-bold text-blue-800 mt-1">{sec.subject || 'No Subject Assigned'}</p>
                                                    <p className="text-sm text-slate-500 mt-1">Manage Class & Upload Grades</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                    <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                                        <button onClick={() => setSelectedMySection(null)} className="flex items-center gap-2 text-sm font-bold text-[#003366] hover:underline">
                                            ← Back to Classes
                                        </button>
                                        <button onClick={handleUnassignSection} className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-600 transition hover:bg-red-100">
                                            Unassign Class
                                        </button>
                                    </div>
                                    <h2 className="text-xl font-bold text-[#003366] mb-6">{selectedMySection.department} {selectedMySection.yearLevel}-{selectedMySection.sectionNum || selectedMySection.section} ({selectedMySection.subject})</h2>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                                        {/* Upload Grades Panel */}
                                        <div className="rounded-xl bg-slate-50 p-5 border border-slate-200">
                                            <h3 className="font-bold text-[#003366] mb-2">1. Upload Grades</h3>
                                            <p className="text-sm text-slate-500 mb-4">Issue grades for this section.</p>
                                            <input 
                                                id="chair-grade-upload"
                                                type="file" 
                                                accept=".csv, .xlsx"
                                                onChange={(e) => setUploadFile(e.target.files[0])}
                                                className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 mb-4"
                                            />
                                            <button 
                                                onClick={handleBulkUpload}
                                                disabled={!uploadFile || isUploading}
                                                className="w-full rounded-xl bg-[#003366] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#00264d] disabled:opacity-50"
                                            >
                                                {isUploading ? 'Uploading...' : 'Upload Grades'}
                                            </button>
                                        </div>

                                        {/* Enroll Students Panel */}
                                        <div className="rounded-xl bg-slate-50 p-5 border border-slate-200">
                                            <h3 className="font-bold text-emerald-700 mb-2">2. Enroll Students</h3>
                                            <p className="text-sm text-slate-500 mb-4">Add students into this section.</p>
                                            <input 
                                                id="myclass-student-enroll-upload"
                                                type="file" 
                                                accept=".csv, .xlsx"
                                                onChange={(e) => setEnrollFile(e.target.files[0])}
                                                className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 mb-4"
                                            />
                                            <button 
                                                onClick={handleBulkEnrollMyClass}
                                                disabled={!enrollFile || isEnrolling}
                                                className="w-full rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                                            >
                                                {isEnrolling ? 'Enrolling...' : 'Bulk Enroll Students'}
                                            </button>
                                        </div>
                                    </div>

                                    <h3 className="font-bold text-lg text-slate-800 mb-4">Enrolled Students</h3>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="border-b border-slate-200 bg-slate-50 text-sm font-semibold text-[#003366]">
                                                    <th className="p-3">Student Name</th>
                                                    <th className="p-3">Student No.</th>
                                                    <th className="p-3">Email</th>
                                                    <th className="p-3">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {myStudents.filter(s => s.department === selectedMySection.department && String(s.yearLevel) === String(selectedMySection.yearLevel) && String(s.sectionNum || s.section) === String(selectedMySection.sectionNum || selectedMySection.section)).map(student => (
                                                    <tr key={student.id} className="border-b border-slate-100 hover:bg-slate-50 text-sm">
                                                        <td className="p-3 font-medium text-slate-800">{student.fullname}</td>
                                                        <td className="p-3 text-slate-600">{student.studentno}</td>
                                                        <td className="p-3 text-slate-500">{student.email}</td>
                                                        <td className="p-3">
                                                            <button onClick={() => handleDropStudent(student.id, student.fullname)} className="rounded-lg bg-red-50 px-3 py-1 text-xs font-bold text-red-600 transition hover:bg-red-100 border border-red-200">
                                                                Drop
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {myStudents.filter(s => s.department === selectedMySection.department && String(s.yearLevel) === String(selectedMySection.yearLevel) && String(s.sectionNum || s.section) === String(selectedMySection.sectionNum || selectedMySection.section)).length === 0 && (
                                                    <tr>
                                                        <td colSpan="3" className="p-6 text-center text-slate-500 bg-slate-50 rounded-b-xl">No students are currently assigned to this section.</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {activeChairTab === 'assignment' && (
                        <div className="flex flex-col gap-6">
                            {/* Section Creation Form */}
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                <h2 className="text-xl font-bold text-[#003366] mb-4">Create New Academic Section</h2>
                                <form onSubmit={handleCreateSection} className="flex flex-col md:flex-row items-end gap-4">
                                    <div className="flex-1">
                                        <label className="block text-sm font-medium text-slate-600 mb-1">Department</label>
                                        <input type="text" value={department} disabled className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-500" />
                                    </div>
                                    <div>
                                        <label htmlFor="yearLevel" className="block text-sm font-medium text-slate-600 mb-1">Year Level</label>
                                        <select id="yearLevel" value={newSectionData.yearLevel} onChange={e => setNewSectionData(p => ({...p, yearLevel: e.target.value}))} required className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-[#003366]">
                                            <option value="" disabled>Select Year</option>
                                            <option value="1">1st Year</option>
                                            <option value="2">2nd Year</option>
                                            <option value="3">3rd Year</option>
                                            <option value="4">4th Year</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="sectionNum" className="block text-sm font-medium text-slate-600 mb-1">Section Number</label>
                                        <input id="sectionNum" type="number" min="1" value={newSectionData.sectionNum} onChange={e => setNewSectionData(p => ({...p, sectionNum: e.target.value}))} required placeholder="e.g., 1" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-[#003366]" />
                                    </div>
                                    <div className="flex-1">
                                        <label htmlFor="subjectCode" className="block text-sm font-medium text-slate-600 mb-1">Subject Code</label>
                                        <input id="subjectCode" type="text" value={newSectionData.subjectCode} onChange={e => setNewSectionData(p => ({...p, subjectCode: e.target.value}))} required placeholder="e.g., IT-101" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-[#003366]" />
                                    </div>
                                    <button type="submit" disabled={isCreatingSection} className="rounded-lg bg-[#003366] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#00264d] disabled:opacity-50">
                                        {isCreatingSection ? 'Creating...' : 'Create Section'}
                                    </button>
                                </form>
                                <div className="mt-4">
                                    <label htmlFor="assignTo" className="block text-sm font-medium text-slate-600 mb-1">Assign Section To Professor</label>
                                    <select 
                                        id="assignTo" 
                                        value={assignToFaculty} 
                                        onChange={e => setAssignToFaculty(e.target.value)} 
                                        className="w-full max-w-md rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 outline-none focus:border-[#003366]"
                                    >
                                        <option value="none">Do not assign yet</option>
                                        <option value="self">Myself ({loggedInName})</option>
                                        {departmentFaculties.map(f => (
                                            <option key={f.id} value={f.email}>{f.fullname}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Bulk Student Enrollment Form */}
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                <h2 className="text-xl font-bold text-[#003366] mb-4">Bulk Enroll Students to Section</h2>
                                <p className="text-slate-500 mb-6">Upload a CSV or Excel file with student details to enroll them into a specific section. The file should contain at least a 'student_no' or 'email' column.</p>
                                <div className="flex flex-col md:flex-row items-end gap-4">
                                    <div className="flex-1">
                                        <label htmlFor="enrollSection" className="block text-sm font-medium text-slate-600 mb-1">Target Section</label>
                                        <select id="enrollSection" value={enrollSectionId} onChange={e => setEnrollSectionId(e.target.value)} required className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-[#003366]">
                                            <option value="" disabled>Select a section to enroll students into</option>
                                            {academicSections.map(sec => (
                                                <option key={sec.id} value={sec.id}>{sec.department} {sec.yearLevel}-{sec.sectionNum}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex-1">
                                        <label htmlFor="student-enroll-upload" className="block text-sm font-medium text-slate-600 mb-1">Student List File</label>
                                        <input id="student-enroll-upload" type="file" accept=".csv, .xlsx" onChange={(e) => setEnrollFile(e.target.files[0])} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                                    </div>
                                    <button onClick={handleBulkEnroll} disabled={isEnrolling || !enrollFile || !enrollSectionId} className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                                        {isEnrolling ? 'Enrolling...' : 'Bulk Enroll Students'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};
export default DeptAdminGradesView;