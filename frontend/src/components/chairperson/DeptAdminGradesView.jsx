import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchAllGrades, approveGrade, finalizeGrade, batchUploadGrades, fetchFacultySections, fetchFacultyStudents, createSection, fetchDepartmentSections, batchEnrollStudentsToSection, dropStudent, fetchApprovedFaculties, unassignFacultySection, getDecryptedIpfsUrl, getSystemSetting, issueGrade, bulkUploadMasterlist, deleteAcademicSection, deleteDepartmentAcademicSections } from '../../services/api';
import { useNotification } from '../../services/NotificationContext';
import ChairpersonHeader from './ChairpersonHeader';
import ChairpersonSidebar from './ChairpersonSidebar';
import ChairpersonOverview from './ChairpersonOverview';
import FacultyStatusTable from '../faculty/FacultyStatusTable';
import SectionReviewPanel from './SectionReviewPanel';
import Modal from '../../services/Modal';
import StudentSectioning from './StudentSectioning';
import AcademicAssignment from './AcademicAssignment';

const getGradeEquivalent = (grade) => {
    const n = parseFloat(grade);
    if (isNaN(n) || n === 0) return '5.00';
    if (n >= 98.5) return '1.00';
    if (n >= 94) return '1.25';
    if (n >= 91) return '1.50';
    if (n >= 88) return '1.75';
    if (n >= 85) return '2.00';
    if (n >= 82) return '2.25';
    if (n >= 79) return '2.50';
    if (n >= 75) return '3.00';
    return '5.00';
};

const getRecordGrade = (record) => record?.grade || record?.Grade || '';

const getRecordStudentKey = (record) => (
    record?.studentId ||
    record?.StudentId ||
    record?.student_hash ||
    record?.studentHash ||
    record?.StudentHash ||
    ''
);

const getRecordSubjectKey = (record) => (
    record?.subjectCode ||
    record?.SubjectCode ||
    record?.subject_code ||
    record?.course ||
    record?.Course ||
    ''
);

const parseStoredGrade = (rawGrade) => {
    if (!rawGrade) return { midterm: '', finals: '', finalAverage: '' };
    if (typeof rawGrade === 'number') return { midterm: '', finals: '', finalAverage: rawGrade };
    if (typeof rawGrade === 'string' && rawGrade.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(rawGrade);
            return {
                midterm: parsed.midterm || '',
                finals: parsed.finals || '',
                finalAverage: parsed.finalAverage || parsed.final || parsed.grade || ''
            };
        } catch (e) {
            return { midterm: '', finals: '', finalAverage: rawGrade };
        }
    }
    return { midterm: '', finals: '', finalAverage: rawGrade };
};

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
    const [masterlistFile, setMasterlistFile] = useState(null);
    const [isUploadingMasterlist, setIsUploadingMasterlist] = useState(false);
    const [classGrades, setClassGrades] = useState({});
    const [classValidationErrors, setClassValidationErrors] = useState({});
    const [isSavingGrades, setIsSavingGrades] = useState(false);

    const [ipfsModalOpen, setIpfsModalOpen] = useState(false);
    const [ipfsCid, setIpfsCid] = useState("");
    const [vaultPassword, setVaultPassword] = useState("");
    const [showVaultPassword, setShowVaultPassword] = useState(false);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: "", message: "", onConfirm: null });

    const [passThreshold, setPassThreshold] = useState(75);
    const [statusFilter, setStatusFilter] = useState("All");
    const [activeSemester, setActiveSemester] = useState("2nd Semester");

    useEffect(() => {
        const fetchThreshold = async () => {
            try {
                const data = await getSystemSetting('pass_fail_threshold');
                if (data.status === "Success" && data.value) {
                    setPassThreshold(parseFloat(data.value));
                }
            } catch (e) {
                console.warn("Using default pass/fail threshold");
            }
        };
        fetchThreshold();
    }, []);

    useEffect(() => {
        const applyEncodingPeriod = (value) => {
            if (!value) return;
            const parsed = typeof value === 'string' ? JSON.parse(value) : value;
            setActiveSemester(parsed?.semester || "2nd Semester");
        };

        const loadEncodingPeriod = async () => {
            try {
                const data = await getSystemSetting('encoding_period');
                if (data.status === "Success" && data.value) {
                    applyEncodingPeriod(data.value);
                }
            } catch (e) {
                console.warn("Using default semester");
            }
        };

        const handleSystemSettingChanged = (event) => {
            const key = event.detail?.key || event.detail?.Key;
            const value = event.detail?.value || event.detail?.Value;
            if (key === 'encoding_period') applyEncodingPeriod(value);
        };

        loadEncodingPeriod();
        window.addEventListener('blockgo:system-setting-changed', handleSystemSettingChanged);
        return () => window.removeEventListener('blockgo:system-setting-changed', handleSystemSettingChanged);
    }, []);

    const deptMetrics = useMemo(() => {
        const facultySet = new Set();
        const sectionMap = {};

        grades.forEach(g => {
            let facId = g.facultyId || g.faculty_id || g.FacultyId || 'Unknown';
            
            // Clean up Fabric Base64 X.509 Identity
            if (facId.length > 40 && !facId.includes('@')) {
                try {
                    const decoded = atob(facId);
                    const cnMatch = decoded.match(/CN=([^,]+)/);
                    if (cnMatch && cnMatch[1]) facId = cnMatch[1];
                } catch(e) {}
            }

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
            let facId = g.facultyId || g.faculty_id || g.FacultyId || 'Unknown';
            
            // Clean up Fabric Base64 X.509 Identity
            if (facId.length > 40 && !facId.includes('@')) {
                try {
                    const decoded = atob(facId);
                    const cnMatch = decoded.match(/CN=([^,]+)/);
                    if (cnMatch && cnMatch[1]) facId = cnMatch[1];
                } catch(e) {}
            }

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
            
            const gradeVal = parseStoredGrade(getRecordGrade(g)).finalAverage;
            if (String(gradeVal || '').trim() !== '') groups[key].encodedCount += 1;
            
            const studentKey = getRecordStudentKey(g) || 'Unknown';
            groups[key].students.push({
                studentId: studentKey,
                lastName: '',
                firstName: studentKey
            });
            groups[key].grades[studentKey] = {
                midterm: '-',
                finals: '-',
                finalAverage: gradeVal || '-',
                    standing: g.remarks || g.Remarks || 'active',
                    flagged: g.flagged || g.Flagged === true || String(g.flagged).toLowerCase() === "true"
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

    useEffect(() => { loadGrades(); }, [loadGrades]);

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
        const handleAcademicDataChanged = () => {
            loadGrades(true);
            if (mainTab === 'myClasses') loadMyClasses();
            if (mainTab === 'assignment') {
                loadAcademicSections();
                loadDepartmentFaculties();
            }
        };

        window.addEventListener('blockgo:academic-data-changed', handleAcademicDataChanged);
        return () => window.removeEventListener('blockgo:academic-data-changed', handleAcademicDataChanged);
    }, [loadGrades, mainTab, loadMyClasses, loadAcademicSections, loadDepartmentFaculties]);

    useEffect(() => {
        if (mainTab === 'assignment' || mainTab === 'myClasses') {
            loadAcademicSections();
        }
        if (mainTab === 'assignment') {
            loadDepartmentFaculties();
        }
    }, [mainTab, loadAcademicSections, loadDepartmentFaculties]);

    const getGradeStatus = useCallback((finalGrade) => {
        const n = parseFloat(finalGrade);
        if (isNaN(n)) return 'Incomplete';
        // Handle both PLV 1.0-5.0 system and 100-60 base systems
        if (passThreshold <= 5.0) {
             return n <= passThreshold ? 'Passed' : 'Failed';
        }
        return n >= passThreshold ? 'Passed' : 'Failed';
    }, [passThreshold]);

    useEffect(() => {
        if (selectedMySection && mainTab === 'myClasses') {
            const initialGrades = {};
            const sectionStudents = myStudents.filter(s => 
                s.department === selectedMySection.department && 
                String(s.yearLevel) === String(selectedMySection.yearLevel) && 
                String(s.sectionNum || s.section) === String(selectedMySection.sectionNum || selectedMySection.section)
            );
            sectionStudents.forEach(student => {
                const existing = grades.find(g => {
                    const studentKey = getRecordStudentKey(g);
                    const subjectKey = getRecordSubjectKey(g);
                    return (studentKey === student.studentno || studentKey === student.email) &&
                        (subjectKey === selectedMySection.subject || subjectKey === selectedMySection.department);
                });
                const parsedGrade = parseStoredGrade(getRecordGrade(existing));
                initialGrades[student.id] = {
                    ...parsedGrade,
                    standing: student.assignmentStatus || 'Enrolled',
                    flagged: existing?.flagged || false,
                    remarks: existing?.remarks || ''
                };
            });
            setClassGrades(initialGrades);
        }
    }, [selectedMySection, myStudents, grades, mainTab]);

    const validateGrade = (value) => {
        const num = parseFloat(value);
        if (value === '' || value === '0' || num === 0) return '';
        if (isNaN(num)) return 'Must be a number';
        if (num < 60 || num > 100) return 'Must be 60–100';
        return '';
    };

    const handleClassGradeChange = (studentId, field, value) => {
        if (field === 'midterm' || field === 'finals') {
            const error = validateGrade(value);
            setClassValidationErrors(prev => ({
                ...prev,
                [studentId]: { ...prev[studentId], [field]: error }
            }));
        }

        setClassGrades(prev => {
            const studentGrade = prev[studentId] || {};
            const updated = { ...studentGrade, [field]: value };
            
            if (field === 'midterm' || field === 'finals') {
                const mid = field === 'midterm' ? value : updated.midterm;
                const fin = field === 'finals' ? value : updated.finals;
                if (mid && fin && !isNaN(mid) && !isNaN(fin)) {
                    updated.finalAverage = ((parseFloat(mid) + parseFloat(fin)) / 2).toFixed(2);
                } else {
                    updated.finalAverage = '';
                }
            }
            return { ...prev, [studentId]: updated };
        });
    };

    const handleDownloadMasterlistTemplate = () => {
        const csvContent = "Student No,Last Name,First Name,MI,Sex,Year Level,Section,Subject Code,Faculty Name,Faculty Email\n23-0001,Dela Cruz,Juan,A,Male,3,1,IT-101,Prof. Smith,smith@plv.edu.ph\n";
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `Masterlist_Template_${department}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

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
            const course = selectedMySection?.subject || "Unknown";
            const facultyId = selectedMySection?.facultyId || loggedInEmail;

            const res = await batchUploadGrades(uploadFile, semester, schoolYear, course, facultyId);
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

    const handleSaveClassGrades = async () => {
        const hasErrors = Object.values(classValidationErrors).some(errs => errs.midterm || errs.finals);
        if (hasErrors) {
            addNotification('Please fix validation errors before saving.', 'error');
            return;
        }

        setIsSavingGrades(true);
        try {
            const sectionStudents = myStudents.filter(s => 
                s.department === selectedMySection.department && 
                String(s.yearLevel) === String(selectedMySection.yearLevel) && 
                String(s.sectionNum || s.section) === String(selectedMySection.sectionNum || selectedMySection.section)
            );

            for (const student of sectionStudents) {
                const cg = classGrades[student.id];
                if (!cg || (!cg.midterm && !cg.finals && !cg.finalAverage)) continue;
                
                const gradePayload = JSON.stringify({ midterm: cg.midterm, finals: cg.finals, finalAverage: cg.finalAverage });
                const payload = {
                    StudentId: student.studentno || student.email,
                    FacultyId: loggedInEmail,
                    SubjectCode: selectedMySection.subject || 'Unknown',
                    SubjectName: selectedMySection.subject || 'Unknown',
                    Course: selectedMySection.department,
                    Semester: "2nd Semester",
                    SchoolYear: "2024",
                    Grade: gradePayload
                };
                await issueGrade(payload);
            }
            addNotification('Grades saved successfully to the ledger!', 'success');
            loadGrades();
        } catch (e) { addNotification(`Error saving grades: ${e.message}`, 'error'); }
        setIsSavingGrades(false);
    };

    const handleExportClassGrades = () => {
        if (!selectedMySection) return;
        const sectionStudents = myStudents.filter(s => 
            s.department === selectedMySection.department && 
            String(s.yearLevel) === String(selectedMySection.yearLevel) && 
            String(s.sectionNum || s.section) === String(selectedMySection.sectionNum || selectedMySection.section)
        );
        
        const headers = ["Student ID", "Student Name", "Midterm", "Finals", "Final Grade"];
        const rows = sectionStudents.map(student => {
            const cg = classGrades[student.id] || {};
            return [student.studentno || student.email, `"${student.fullname}"`, cg.midterm || "", cg.finals || "", cg.finalAverage || ""].join(",");
        });
        
        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
        const link = document.createElement("a");
        link.href = encodeURI(csvContent);
        link.setAttribute("download", `${selectedMySection.department}_${selectedMySection.yearLevel}-${selectedMySection.sectionNum || selectedMySection.section}_Grades.csv`);
        link.click();
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

    const handleMasterlistUpload = async () => {
        if (!masterlistFile) {
            addNotification('Please select a CSV or Excel file to upload.', 'error');
            return;
        }
        setIsUploadingMasterlist(true);
        try {
            const data = await bulkUploadMasterlist(masterlistFile, department);
            if (data.status === 'Success' || data.status === 'Partial Success') {
                addNotification(data.message || 'Masterlist processed successfully. Accounts and sections created.', 'success');
                setMasterlistFile(null);
                const fileInput = document.getElementById('masterlist-upload');
                if (fileInput) fileInput.value = '';
                loadMyClasses();
                loadAcademicSections();
                    loadDepartmentFaculties();
            } else {
                addNotification(data.message || 'Masterlist upload failed.', 'error');
            }
        } catch (err) {
            addNotification(err.message, 'error');
        }
        setIsUploadingMasterlist(false);
    };

    const handleUnassignSection = async () => {
        if (!selectedMySection) return;
        setConfirmModal({
            isOpen: true,
            title: "Unassign Class",
            message: `Are you sure you want to unassign ${selectedMySection.department} ${selectedMySection.yearLevel}-${selectedMySection.sectionNum || selectedMySection.section} from your classes?`,
            onConfirm: async () => {
                try {
                    await unassignFacultySection(loggedInEmail, selectedMySection.department, selectedMySection.yearLevel, selectedMySection.sectionNum || selectedMySection.section);
                    addNotification("Class unassigned successfully.", "success");
                    setSelectedMySection(null);
                    loadMyClasses();
                } catch (e) {
                    addNotification(e.message, "error");
                }
                setConfirmModal({ isOpen: false, title: "", message: "", onConfirm: null });
            }
        });
    };

    const handleDropStudent = async (id, name) => {
        setConfirmModal({
            isOpen: true,
            title: "Drop Student",
            message: `Are you sure you want to drop ${name}? This will revoke their system access completely.`,
            onConfirm: async () => {
                try {
                    await dropStudent(id);
                    addNotification(`${name} has been dropped and access revoked.`, 'success');
                    loadMyClasses();
                } catch (e) {
                    addNotification(e.message, 'error');
                }
                setConfirmModal({ isOpen: false, title: "", message: "", onConfirm: null });
            }
        });
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
            addNotification("Vault Password is required", "error");
        }
    };

    const handleDeleteSection = async (id, sectionName) => {
        setConfirmModal({
            isOpen: true,
            title: "Delete Section",
            message: `Are you sure you want to delete Section ${sectionName}? This will also remove the faculty assignment for this section.`,
            onConfirm: async () => {
                try {
                    await deleteAcademicSection(id);
                    addNotification(`Section ${sectionName} deleted successfully.`, "success");
                    loadAcademicSections();
                    loadMyClasses();
                } catch (e) { addNotification(e.message, "error"); }
                setConfirmModal({ isOpen: false, title: "", message: "", onConfirm: null });
            }
        });
    };

    const handleDeleteAllSections = async () => {
        setConfirmModal({
            isOpen: true,
            title: "Clear All Sections",
            message: `Are you sure you want to delete ALL academic sections for ${department}? This is typically done at the end of the school year.`,
            onConfirm: async () => {
                try {
                    await deleteDepartmentAcademicSections(department);
                    addNotification(`All sections for ${department} cleared.`, "success");
                    loadAcademicSections();
                    loadMyClasses();
                } catch (e) { addNotification(e.message, "error"); }
                setConfirmModal({ isOpen: false, title: "", message: "", onConfirm: null });
            }
        });
    };

    const activeChairTab = mainTab;

    return (
        <div className="flex h-screen w-full flex-col bg-slate-50 font-sans fixed inset-0 z-[100] overflow-auto">
            <ChairpersonHeader chairpersonData={{ name: loggedInName, department, semester: activeSemester }} departmentCount={deptMetrics.totalFaculty} onLogout={() => { localStorage.removeItem('token'); window.location.reload(); }} />
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden p-4 md:p-6 gap-6">
                <ChairpersonSidebar activeTab={activeChairTab === 'grades' ? 'dashboard' : activeChairTab} setActiveTab={setMainTab} />
                <main className="flex-1 overflow-y-auto pr-2">
                    {(activeChairTab === 'dashboard' || activeChairTab === 'grades') && <ChairpersonOverview metrics={deptMetrics} />}
                        {['forReview', 'returned', 'approved', 'forwarded', 'flagged'].includes(activeChairTab) && (
                        <div className="flex flex-col gap-6">
                            <FacultyStatusTable 
                                rows={facultyRows.filter(r => {
                                    if (activeChairTab === 'forReview') return r.reviewStatus === 'submitted' || r.reviewStatus === 'pending';
                                    if (activeChairTab === 'returned') return r.reviewStatus === 'returned';
                                    if (activeChairTab === 'approved') return r.reviewStatus === 'approved';
                                    if (activeChairTab === 'forwarded') return r.reviewStatus === 'forwarded';
                                        if (activeChairTab === 'flagged') return Object.values(r.grades).some(g => g.flagged);
                                    return true;
                                })} 
                                selectedReviewKey={selectedReviewSection?.reviewKey} 
                                onSelectSection={setSelectedReviewSection} 
                            />
                            {selectedReviewSection && (
                                <div className="flex flex-col gap-4">
                                    {selectedReviewSection.ipfsCid && (
                                        <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
                                            <div>
                                                <h4 className="font-bold text-blue-900">Attached Grading Sheet (IPFS Vault)</h4>
                                                <p className="text-sm text-blue-700">The faculty member securely attached the source Excel/CSV file.</p>
                                            </div>
                                            <button onClick={() => handleViewIpfs(selectedReviewSection.ipfsCid)} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700">
                                                Decrypt & View
                                            </button>
                                        </div>
                                    )}
                                    <SectionReviewPanel 
                                        selectedSection={selectedReviewSection} 
                                        activeTerm="finals" 
                                        onApprove={handleBulkApprove} 
                                        onSubmitToRegistrar={handleBulkForward} 
                                        onSendBack={() => { addNotification("Section sent back to faculty.", "success"); setSelectedReviewSection(null); }} 
                                        onViewIpfs={handleViewIpfs}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                    {activeChairTab === 'sectioning' && (
                        <div className="flex flex-col gap-6">
                            <StudentSectioning chairpersonDepartment={department} />
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
                                    
                                    <div className="mb-6 rounded-xl bg-slate-50 p-5 border border-slate-200 flex flex-col md:flex-row md:items-end gap-4">
                                        <div className="flex-1">
                                            <h3 className="font-bold text-emerald-700 mb-2">Enroll Missing Students</h3>
                                            <p className="text-sm text-slate-500 mb-4">Upload a CSV/Excel file to add students to this section.</p>
                                            <input 
                                                id="myclass-student-enroll-upload"
                                                type="file" 
                                                accept=".csv, .xlsx"
                                                onChange={(e) => setEnrollFile(e.target.files[0])}
                                                className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                                            />
                                        </div>
                                        <button 
                                            onClick={handleBulkEnrollMyClass}
                                            disabled={!enrollFile || isEnrolling}
                                            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                                        >
                                            {isEnrolling ? 'Enrolling...' : 'Bulk Enroll Students'}
                                        </button>
                                    </div>

                                    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-md mt-6">
                                        <div className="flex flex-col gap-4 px-6 py-5 md:flex-row md:items-center md:justify-between bg-slate-50 border-b border-slate-200">
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-3">
                                                    <span className="shrink-0 rounded-lg bg-blue-100 px-3 py-1 text-sm font-bold text-blue-700">
                                                        {selectedMySection.subject || 'Subject'}
                                                    </span>
                                                    <h2 className="text-xl font-bold text-[#003366]">
                                                        Section: {selectedMySection.yearLevel}-{selectedMySection.sectionNum || selectedMySection.section}
                                                    </h2>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-3">
                                                <select 
                                                    value={statusFilter} 
                                                    onChange={e => setStatusFilter(e.target.value)} 
                                                    className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#003366]"
                                                >
                                                    <option value="All">All Statuses</option>
                                                    <option value="Enrolled">Active</option>
                                                    <option value="Dropped">Dropped</option>
                                                    <option value="UD">UD</option>
                                                    <option value="W">W</option>
                                                    <option value="INC">INC</option>
                                                </select>
                                                <div className="relative overflow-hidden">
                                                    <input 
                                                        type="file" 
                                                        accept=".csv, .xlsx"
                                                        onChange={(e) => setUploadFile(e.target.files[0])}
                                                        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                                                    />
                                                    <button
                                                        disabled={isUploading}
                                                        className="rounded-lg bg-yellow-400 px-4 py-2.5 text-sm font-bold text-[#003366] transition hover:bg-yellow-500 disabled:opacity-50"
                                                    >
                                                        {uploadFile ? `Selected: ${uploadFile.name.substring(0, 10)}...` : 'Select File'}
                                                    </button>
                                                </div>
                                                {uploadFile && (
                                                    <button
                                                        onClick={handleBulkUpload}
                                                        disabled={isUploading}
                                                        className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
                                                    >
                                                        {isUploading ? 'Uploading...' : 'Confirm Upload'}
                                                    </button>
                                                )}
                                                <button
                                                    onClick={handleExportClassGrades}
                                                    className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                                                >
                                                    Export CSV
                                                </button>
                                                <button
                                                    onClick={handleSaveClassGrades}
                                                    disabled={isSavingGrades || Object.values(classValidationErrors).some(errs => errs.midterm || errs.finals)}
                                                    className="rounded-xl bg-[#003366] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#00264d] disabled:opacity-50"
                                                >
                                                    {isSavingGrades ? 'Saving to Ledger...' : 'Save Grades to Ledger'}
                                                </button>
                                            </div>
                                        </div>

                                        <div className="overflow-x-auto">
                                            <table className="w-full min-w-[900px]">
                                                <thead>
                                                    <tr className="border-b-4 border-yellow-400 bg-[#003b78] text-white">
                                                        <th className="px-6 py-4 text-left text-[15px] font-bold uppercase tracking-wide">Student ID</th>
                                                        <th className="px-6 py-4 text-left text-[15px] font-bold uppercase tracking-wide">Student Name</th>
                                                        <th className="px-6 py-4 text-center text-[15px] font-bold uppercase tracking-wide">Midterm <span className="font-normal text-slate-300">(60-100)</span></th>
                                                        <th className="px-6 py-4 text-center text-[15px] font-bold uppercase tracking-wide">Finals <span className="font-normal text-slate-300">(60-100)</span></th>
                                                        <th className="px-6 py-4 text-center text-[15px] font-bold uppercase tracking-wide">Final Grade</th>
                                                        <th className="px-6 py-4 text-center text-[15px] font-bold uppercase tracking-wide">Equivalent</th>
                                                        <th className="px-6 py-4 text-center text-[15px] font-bold uppercase tracking-wide">Status</th>
                                                        <th className="px-6 py-4 text-center text-[15px] font-bold uppercase tracking-wide">Standing</th>
                                                        <th className="px-6 py-4 text-center text-[15px] font-bold uppercase tracking-wide">Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {myStudents.filter(s => s.department === selectedMySection.department && String(s.yearLevel) === String(selectedMySection.yearLevel) && String(s.sectionNum || s.section) === String(selectedMySection.sectionNum || selectedMySection.section))
                                                    .filter(s => {
                                                        const standing = (classGrades[s.id] || {}).standing || 'Enrolled';
                                                        return statusFilter === "All" || standing === statusFilter;
                                                    })
                                                    .map(student => {
                                                        const studentData = classGrades[student.id] || {};
                                                        const final = studentData.finalAverage || '-';
                                                        const status = getGradeStatus(final);
                                                        const standing = studentData.standing || 'Enrolled';
                                                        const isFlagged = studentData.flagged;
                                                        const errors = classValidationErrors[student.id] || {};
                                                        const hasError = errors.midterm || errors.finals;

                                                        return (
                                                            <tr key={student.id} className={`border-b border-slate-200 hover:bg-slate-50 ${hasError || isFlagged ? 'bg-red-50' : 'bg-white'}`}>
                                                                <td className="px-6 py-5 font-semibold text-slate-700">{student.studentno}</td>
                                                                <td className="px-6 py-5 font-medium text-slate-800">{student.fullname}</td>
                                                                <td className="px-6 py-5 text-center">
                                                                    <div className="relative inline-block">
                                                                        <input type="number" min="60" max="100" value={studentData.midterm || ''} onChange={(e) => handleClassGradeChange(student.id, 'midterm', e.target.value)} className={`h-10 w-20 rounded-xl border px-2 text-center outline-none focus:ring-2 focus:ring-[#003366]/20 ${errors.midterm ? 'border-red-500 bg-red-50' : 'border-slate-300 bg-white'}`} placeholder="60-100" />
                                                                        {errors.midterm && <div className="absolute left-1/2 -translate-x-1/2 -bottom-5 whitespace-nowrap text-[10px] font-bold text-red-600">{errors.midterm}</div>}
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-5 text-center">
                                                                    <div className="relative inline-block">
                                                                        <input type="number" min="60" max="100" value={studentData.finals || ''} onChange={(e) => handleClassGradeChange(student.id, 'finals', e.target.value)} className={`h-10 w-20 rounded-xl border px-2 text-center outline-none focus:ring-2 focus:ring-[#003366]/20 ${errors.finals ? 'border-red-500 bg-red-50' : 'border-slate-300 bg-white'}`} placeholder="60-100" />
                                                                        {errors.finals && <div className="absolute left-1/2 -translate-x-1/2 -bottom-5 whitespace-nowrap text-[10px] font-bold text-red-600">{errors.finals}</div>}
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-5 text-center font-bold text-[#003366] text-lg">{final}</td>
                                                                <td className="px-6 py-5 text-center font-bold text-slate-700">{final !== '-' && !isNaN(final) ? getGradeEquivalent(final) : final}</td>
                                                                <td className="px-6 py-5 text-center">
                                                                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${status === 'Passed' ? 'bg-green-100 text-green-700' : status === 'Failed' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{status}</span>
                                                                </td>
                                                                <td className="px-6 py-5 text-center">
                                                                    <select value={standing} onChange={(e) => handleClassGradeChange(student.id, 'standing', e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium outline-none text-slate-700">
                                                                        <option value="Enrolled">Active</option>
                                                                        <option value="Dropped">Dropped</option>
                                                                        <option value="UD">UD</option>
                                                                        <option value="W">W</option>
                                                                        <option value="INC">INC</option>
                                                                    </select>
                                                                </td>
                                                                <td className="px-6 py-5 text-center">
                                                                    <button onClick={() => handleDropStudent(student.id, student.fullname)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-100 border border-red-200">Drop</button>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                    {myStudents.filter(s => s.department === selectedMySection.department && String(s.yearLevel) === String(selectedMySection.yearLevel) && String(s.sectionNum || s.section) === String(selectedMySection.sectionNum || selectedMySection.section)).length === 0 && (
                                                        <tr><td colSpan="9" className="p-8 text-center text-slate-500 bg-slate-50 rounded-b-xl text-base">No students are currently assigned to this section.</td></tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {activeChairTab === 'assignment' && (
                        <AcademicAssignment chairpersonDepartment={department} />
                    )}
                </main>
            </div>
            {/* IPFS Vault Password Modal */}
            <Modal isOpen={ipfsModalOpen} onClose={() => setIpfsModalOpen(false)} title="IPFS Vault Decryption">
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-slate-600">
                        This academic record is encrypted and distributed across the PLV IPFS Network. 
                        Enter the Vault Password to view the decrypted content.
                    </p>
                    <div className="relative">
                        <input 
                            type={showVaultPassword ? "text" : "password"} 
                            value={vaultPassword} 
                            onChange={(e) => setVaultPassword(e.target.value)} 
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 pr-10 text-sm outline-none focus:border-[#003366]" 
                            placeholder="Enter Vault Password" 
                            onKeyDown={(e) => e.key === 'Enter' && submitIpfsPassword()}
                            autoFocus
                        />
                        <button
                            type="button"
                            onClick={() => setShowVaultPassword(!showVaultPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[#003366]"
                            title={showVaultPassword ? "Hide Password" : "Show Password"}
                        >
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
            
            {/* Confirmation Modal */}
            <Modal isOpen={confirmModal.isOpen} onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })} title={confirmModal.title}>
                <div className="flex flex-col gap-4">
                    <p className="text-sm text-slate-600">{confirmModal.message}</p>
                    <div className="flex justify-end gap-3 mt-4">
                        <button onClick={() => setConfirmModal({ ...confirmModal, isOpen: false })} className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50">Cancel</button>
                        <button onClick={confirmModal.onConfirm} className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-red-700">Confirm</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};
export default DeptAdminGradesView;
