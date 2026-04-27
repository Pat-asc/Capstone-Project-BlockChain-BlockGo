import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchAllGrades, approveGrade, finalizeGrade, fetchDepartmentPendingStudents, approveStudentEnrollment } from '../../../services/api';
import ChairpersonHeader from './ChairpersonHeader';
import ChairpersonSidebar from './ChairpersonSidebar';
import ChairpersonOverview from './ChairpersonOverview';
import FacultyStatusTable from './FacultyStatusTable';
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

const DeanGradesView = ({ loggedInEmail = '', loggedInName = '', userRole = '' }) => {
    const [grades, setGrades] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState(null); 
    
    const [mainTab, setMainTab] = useState('grades'); 
    const [deptPendingStudents, setDeptPendingStudents] = useState([]);
    const [selectedReviewSection, setSelectedReviewSection] = useState(null);

    const deanMetrics = useMemo(() => {
        const facultySet = new Set();
        let submitted = 0, approved = 0, forwarded = 0;
        grades.forEach(g => {
            if (g.facultyId || g.faculty_id) facultySet.add(g.facultyId || g.faculty_id);
            if (g.status === 'Issued') submitted++;
            if (g.status === 'DepartmentApproved') approved++;
            if (g.status === 'Finalized') forwarded++;
        });
        return {
            totalFaculty: facultySet.size,
            totalSections: new Set(grades.map(g => g.subject_code)).size,
            submittedSections: submitted,
            returnedSections: 0,
            approvedSections: approved
        };
    }, [grades]);

    const facultyRows = useMemo(() => {
        const groups = {};
        grades.forEach(g => {
            const key = `${g.facultyId || g.faculty_id}-${g.subject_code}`;
            if (!groups[key]) {
                groups[key] = {
                    reviewKey: key,
                    facultyName: g.facultyId || g.faculty_id || 'Unknown',
                    facultyId: g.facultyId || g.faculty_id || 'Unknown',
                    department: g.course || 'Unknown',
                    sectionName: `${g.course} - ${g.subject_code}`,
                    subjectCode: g.subject_code,
                    schoolYear: g.schoolYear || '2024',
                    semester: g.semester || '2nd Semester',
                    totalStudents: 0,
                    encodedCount: 0,
                    progress: 0,
                    facultyEncodingStatus: 'In Progress',
                    reviewStatus: 'pending',
                    grades: {},
                    students: []
                };
            }
            groups[key].totalStudents += 1;
            groups[key].encodedCount += 1;
            
            const studentKey = g.studentId || g.student_hash;
            groups[key].students.push({
                studentId: studentKey,
                lastName: '',
                firstName: studentKey
            });
            groups[key].grades[studentKey] = {
                midterm: '-',
                finals: '-',
                finalAverage: g.grade,
                standing: 'active',
                flagged: false
            };
            
            if (g.status === 'Issued') groups[key].reviewStatus = 'submitted';
            if (g.status === 'DepartmentApproved') groups[key].reviewStatus = 'approved';
            if (g.status === 'Finalized') groups[key].reviewStatus = 'forwarded';
        });
        return Object.values(groups).map(g => {
            g.progress = Math.round((g.encodedCount / g.totalStudents) * 100);
            g.facultyEncodingStatus = 'Completed';
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
    }, [mainTab]);

    const handleBulkApprove = async () => {
        if (!selectedReviewSection) return;
        try {
            const recordsToApprove = grades.filter(g => `${g.facultyId || g.faculty_id}-${g.subject_code}` === selectedReviewSection.reviewKey && g.status === 'Issued');
            for (const g of recordsToApprove) await approveGrade(g.id, loggedInEmail);
            alert("Section approved successfully!");
            setSelectedReviewSection(null);
            loadGrades();
        } catch(e) { alert("Error approving section: " + e.message); }
    };

    const handleBulkForward = async () => {
        if (!selectedReviewSection) return;
        try {
            const recordsToForward = grades.filter(g => `${g.facultyId || g.faculty_id}-${g.subject_code}` === selectedReviewSection.reviewKey && g.status === 'DepartmentApproved');
            for (const g of recordsToForward) await finalizeGrade(g.id, loggedInEmail);
            alert("Section forwarded to Registrar successfully!");
            setSelectedReviewSection(null);
            loadGrades();
        } catch(e) { alert("Error forwarding section: " + e.message); }
    };

    const activeChairTab = ['grades', 'Requests', 'assignStudents', 'assignAdmins', 'assignFaculties'].includes(mainTab) ? 'dashboard' : mainTab;

    return (
        <div className="flex h-screen w-full flex-col bg-slate-50 font-sans fixed inset-0 z-[100] overflow-auto">
            <ChairpersonHeader chairpersonData={{ name: loggedInName, department: userRole }} departmentCount={deanMetrics.totalFaculty} onLogout={() => { localStorage.removeItem('token'); window.location.reload(); }} />
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden p-4 md:p-6 gap-6">
                <ChairpersonSidebar activeTab={activeChairTab === 'grades' ? 'dashboard' : activeChairTab} setActiveTab={setMainTab} />
                <main className="flex-1 overflow-y-auto pr-2">
                    {(activeChairTab === 'dashboard' || activeChairTab === 'grades') && <ChairpersonOverview metrics={deanMetrics} />}
                    {activeChairTab === 'forReview' && (
                        <div className="flex flex-col gap-6">
                            <FacultyStatusTable rows={facultyRows} selectedReviewKey={selectedReviewSection?.reviewKey} onSelectSection={setSelectedReviewSection} />
                            <SectionReviewPanel selectedSection={selectedReviewSection} activeTerm="finals" onApprove={handleBulkApprove} onSubmitToRegistrar={handleBulkForward} onSendBack={() => { alert("Sent back"); setSelectedReviewSection(null); }} />
                        </div>
                    )}
                    {/* Sectioning UI removed for brevity, handled entirely in Registrar panel */}
                </main>
            </div>
        </div>
    );
};
export default DeanGradesView;