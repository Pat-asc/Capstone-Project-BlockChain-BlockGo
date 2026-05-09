import React, { useState, useCallback, useEffect } from 'react';
import plvlogo from '../../assets/plvlogo.png';
import DownloadGradingSheetButton from './DownloadGradingSheetButton';
import { fetchFacultySections, fetchFacultyStudents, fetchAllGrades, batchUploadGrades, getSystemSetting, issueGrade, submitSectionGrades } from '../../services/api';
import FacultyHeader from './FacultyHeader';
import YearTabs from './YearTabs';
import ProgramCard from './ProgramCard';

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

  const [encodingStart, setEncodingStart] = useState(null);
  const [encodingEnd, setEncodingEnd] = useState(null);
  const [encodingTerm, setEncodingTerm] = useState("midterm");
  const [encodingSemester, setEncodingSemester] = useState("2nd Semester");

  useEffect(() => {
    const applyEncodingPeriod = (value) => {
      if (!value) return;
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      setEncodingSemester(parsed.semester || "2nd Semester");
      if (!parsed.startDate || !parsed.endDate) return;
      setEncodingStart(new Date(parsed.startDate));
      setEncodingTerm(parsed.term === "finals" ? "finals" : "midterm");
      const end = new Date(parsed.endDate);
      end.setHours(23, 59, 59, 999);
      setEncodingEnd(end);
    };

    const loadEncodingPeriod = async () => {
        try {
            const res = await getSystemSetting("encoding_period");
            if (res.status === "Success" && res.value) {
                applyEncodingPeriod(res.value);
            }
        } catch (e) { console.error(e); }
    };

    const handleSystemSettingChanged = (event) => {
      const key = event.detail?.key || event.detail?.Key;
      const value = event.detail?.value || event.detail?.Value;
      if (key === 'encoding_period') applyEncodingPeriod(value);
    };

    loadEncodingPeriod();
    window.addEventListener('blockgo:system-setting-changed', handleSystemSettingChanged);

    return () => {
      window.removeEventListener('blockgo:system-setting-changed', handleSystemSettingChanged);
    };
  }, []);

  const loadFacultyData = useCallback(async (isBackground = false) => {
    if (!isBackground) setIsLoadingData(true);

    try {
      const sectionsData = await fetchFacultySections(facultyData.email).catch(() => null);
      const studentsData = await fetchFacultyStudents(facultyData.email).catch(() => null);
      const gradesData = await fetchAllGrades(facultyData.email).catch(() => null);

      const actualSections = Array.isArray(sectionsData?.sections) ? sectionsData.sections : [];
      const actualStudents = Array.isArray(studentsData?.students) ? studentsData.students : [];
      const actualGrades = Array.isArray(gradesData) ? gradesData : (gradesData?.data || []);

      const newSections = {};

      const parseSavedGrade = (rawGrade) => {
        if (!rawGrade) return { midterm: 0, finals: 0, finalAverage: 0 };
        if (typeof rawGrade === 'number') return { midterm: rawGrade, finals: rawGrade, finalAverage: rawGrade };
        if (typeof rawGrade === 'string' && rawGrade.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(rawGrade);
            return {
              midterm: parseFloat(parsed.midterm) || 0,
              finals: parseFloat(parsed.finals) || 0,
              finalAverage: parseFloat(parsed.finalAverage || parsed.final || parsed.grade) || 0
            };
          } catch (e) {
            return { midterm: 0, finals: 0, finalAverage: 0 };
          }
        }
        const numericGrade = parseFloat(rawGrade) || 0;
        return { midterm: numericGrade, finals: numericGrade, finalAverage: numericGrade };
      };

      const getGradeStudentKey = (grade) => (
        grade.student_hash ||
        grade.studentHash ||
        grade.StudentHash ||
        grade.studentId ||
        grade.StudentId ||
        ''
      );

      const getGradeSubjectKey = (grade) => (
        grade.subject_code ||
        grade.subjectCode ||
        grade.SubjectCode ||
        grade.course ||
        grade.Course ||
        ''
      );

      actualSections.forEach(sec => {
        const sectionKey = `${sec.department} ${sec.section}${sec.subject ? ` (${sec.subject})` : ''}`; 
        
        const enrolledStudents = actualStudents.filter(s => 
          s.department === sec.department && 
          (String(s.section) === String(sec.section) || String(s.sectionNum) === String(sec.section)) && 
          (s.assignmentStatus === 'Enrolled' || s.enrollmentStatus === 'Enrolled')
        ).map(s => {
          const savedGrade = actualGrades.find(g => {
            const gradeStudentKey = getGradeStudentKey(g);
            const gradeSubjectKey = getGradeSubjectKey(g);
            const sameStudent = gradeStudentKey === s.email || gradeStudentKey === s.studentno;
            const sameSubject = gradeSubjectKey === sec.subject || gradeSubjectKey === sec.department || gradeSubjectKey === `${sec.department}-${sec.section}`;
            return sameStudent && sameSubject;
          });
          const savedValues = parseSavedGrade(savedGrade?.grade || savedGrade?.Grade);

          return {
            id: s.studentno || 'N/A',
            name: s.fullname,
            email: s.email,
            midterm: savedValues.midterm,
            finals: savedValues.finals,
            remarks: savedValues.finalAverage ? getRemarks(savedValues.finalAverage, savedValues.midterm, savedValues.finals) : 'Incomplete',
            customGrades: {}
          };
        });

        newSections[sectionKey] = {
          year: sec.yearLevel ? `${sec.yearLevel} Year` : "N/A",
          subjectCode: sec.subject || `${sec.department}-${sec.section}`, 
          subjectTitle: sec.subject || `Assigned Subject (${sec.department})`, 
          sectionCourse: sec.department,
          students: enrolledStudents
        };
      });

      setSections(newSections);
    } catch (error) {
      console.error("Failed to load faculty sections:", error);
    } finally {
      if (!isBackground) setIsLoadingData(false);
    }
  }, [facultyData.email]);

  useEffect(() => {
    loadFacultyData();
    const handleAcademicDataChanged = () => loadFacultyData(true);
    window.addEventListener('blockgo:academic-data-changed', handleAcademicDataChanged);

    return () => window.removeEventListener('blockgo:academic-data-changed', handleAcademicDataChanged);
  }, [loadFacultyData]);

  const totalSections = Object.keys(sections).length;

  const now            = new Date();
  const msLeft         = encodingEnd ? encodingEnd - now : 0;
  const daysLeft       = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  const isClosed       = !encodingStart || !encodingEnd || now < encodingStart || now > encodingEnd;
  const isUrgent       = !isClosed && daysLeft <= 3;
  const isOpen         = !isClosed && !isUrgent;

  const getBannerState = () => {
    if (!encodingStart || !encodingEnd) return 'not_set';
    if (now > encodingEnd)   return 'closed_after';
    if (now < encodingStart) return 'closed_before';
    if (isUrgent)             return 'urgent';
    return 'open';
  };
  const bannerState = getBannerState();

  const formatDate = (date) =>
    date ? date.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }) : 'not set';

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
    } else if (encodingTerm === "midterm") {
        avg = mid;
    } else if (encodingTerm === "finals") {
        avg = mid > 0 ? (mid + fin) / 2 : fin;
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
    if (field === 'midterm' && encodingTerm !== 'midterm') return;
    if (field === 'finals' && encodingTerm !== 'finals') return;
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
  }, [sections, sectionStatus, encodingTerm]);

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

  const handleExportPDFClassGrades = (sectionName) => {
    const sectionData = sections[sectionName];
    if (!sectionData || !sectionData.students) return;
    
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setTextColor(0, 51, 102);
        doc.setFontSize(16);
        doc.text("PLV OFFICIAL GRADING SHEET", 14, 20);
        
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Department: ${sectionData.sectionCourse}`, 14, 28);
        doc.text(`Section: ${sectionName}`, 14, 33);
        doc.text(`Faculty: ${facultyData.name}`, 14, 38);
        
        const tableColumn = ["Student ID", "Student Name", "Midterm", "Finals", "Final Grade", "Remarks"];
        const tableRows = sectionData.students.map(student => {
            const finalGrade = calculatePLVPoint(student);
            return [ student.id, student.name, student.midterm || "", student.finals || "", finalGrade > 0 ? finalGrade.toFixed(2) : "", student.remarks || "Incomplete" ];
        });
        
        doc.autoTable({
            head: [tableColumn], body: tableRows, startY: 45, theme: 'striped',
            headStyles: { fillColor: [0, 51, 102], fontSize: 9 }, bodyStyles: { fontSize: 8 }
        });
        
        doc.save(`${sectionName.replace(/[^a-zA-Z0-9-]/g, "_")}_GradingSheet.pdf`);
    } catch (err) {
        alert("Could not generate PDF. Make sure jsPDF is available.");
    }
  };

  const handleExportClassGrades = (sectionName) => {
    const sectionData = sections[sectionName];
    if (!sectionData || !sectionData.students) return;
    
    const headers = ["Student ID", "Student Name", "Midterm", "Finals", "Final Grade"];
    const rows = sectionData.students.map(student => {
        const finalGrade = calculatePLVPoint(student);
        return [
            student.id, 
            `"${student.name}"`, 
            student.midterm || "", 
            student.finals || "", 
            finalGrade > 0 ? finalGrade.toFixed(2) : ""
        ].join(",");
    });
    
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.setAttribute("download", `${sectionName.replace(/[^a-zA-Z0-9-]/g, "_")}_Grades.csv`);
    link.click();
  };

  const handleFileUpload = async (sectionName, e) => {
    const file = e.target.files[0];
    if (!file) return;

    const sectionData = sections[sectionName];
    const semester = encodingSemester; 
    const schoolYear = "2024";
    const course = sectionData.subjectCode || sectionName;

    setUploadingSection(sectionName);

    try {
      const res = await batchUploadGrades(file, semester, schoolYear, course, facultyData.email, encodingTerm);
      if (res.status === 'Success' || res.status === 'Partial Success') {
        setUploadResult({ 
          type: 'success', 
          title: 'Upload Successful', 
          message: `Processed: ${res.totalProcessed}, Success: ${res.successful}`, 
          details: res.errors ? JSON.stringify(res.errors, null, 2) : 'All records processed successfully.'
        });
        loadFacultyData();
      } else {
        setUploadResult({ type: 'error', title: 'Upload Failed', message: res.message });
      }
    } catch (err) {
      console.error(err);
      setUploadResult({ type: 'error', title: 'Batch Upload Failed', message: err.message });
    } finally {
      setUploadingSection(null);
      e.target.value = null; 
    }
  };

  const handleSaveRow = (sectionName, index) => {
    const errors = validationErrors[sectionName]?.[index] || {};
    if (errors.midterm || errors.finals) return;
    setRowSaveState(prev => ({ ...prev, [sectionName]: { ...(prev[sectionName] || {}), [index]: 'saving' } }));
    
    try {
      const student = sections[sectionName].students[index];
      const sectionData = sections[sectionName];
      const gradePayload = {
          StudentId: student.id,
          StudentHash: student.email || student.id,
          Section: String(sectionData.subjectCode).split('-').pop() || "1",
          Course: sectionData.sectionCourse,
          SubjectCode: sectionData.subjectCode,
          Grade: JSON.stringify({ midterm: student.midterm, finals: student.finals, finalAverage: calculatePLVPoint(student).toFixed(2) }),
          Semester: encodingSemester,
          SchoolYear: "2024",
          FacultyId: facultyData.email,
          Date: new Date().toISOString().split('T')[0]
      };
      
      issueGrade(gradePayload).then(() => {
        setRowSaveState(prev => ({ ...prev, [sectionName]: { ...(prev[sectionName] || {}), [index]: 'saved' } }));
      }).catch((e) => {
        console.error(e);
        alert("Failed to save grade: " + e.message);
        setRowSaveState(prev => ({ ...prev, [sectionName]: { ...(prev[sectionName] || {}), [index]: 'idle' } }));
      });
    } catch(e) {
      console.error(e);
      setRowSaveState(prev => ({ ...prev, [sectionName]: { ...(prev[sectionName] || {}), [index]: 'idle' } }));
    }
  };

  const handleSaveAll = async (sectionName) => {
    const students = sections[sectionName].students;
    const saving = {};
    students.forEach((_, i) => { saving[i] = 'saving'; });
    setRowSaveState(prev => ({ ...prev, [sectionName]: saving }));
    
    try {
      const sectionData = sections[sectionName];
      const promises = students.map(student => {
          const gradePayload = {
              StudentId: student.id,
              StudentHash: student.email || student.id,
              Section: String(sectionData.subjectCode).split('-').pop() || "1",
              Course: sectionData.sectionCourse,
              SubjectCode: sectionData.subjectCode,
              Grade: JSON.stringify({ midterm: student.midterm, finals: student.finals, finalAverage: calculatePLVPoint(student).toFixed(2) }),
              Semester: encodingSemester,
              SchoolYear: "2024",
              FacultyId: facultyData.email,
              Date: new Date().toISOString().split('T')[0]
          };
          return issueGrade(gradePayload);
      });
      
      await Promise.all(promises);
      
      const saved = {};
      students.forEach((_, i) => { saved[i] = 'saved'; });
      setRowSaveState(prev => ({ ...prev, [sectionName]: saved }));
      setSectionStatus(prev => ({ ...prev, [sectionName]: 'draft' }));
    } catch (error) {
      console.error(error);
      alert(`Failed to save all grades: ${error.message}`);
      const idle = {};
      students.forEach((_, i) => { idle[i] = 'idle'; });
      setRowSaveState(prev => ({ ...prev, [sectionName]: idle }));
    }
  };

  const handleSubmit = async (sectionName) => {
    const students = sections[sectionName].students;
    const hasIncomplete = students.some(s =>
      encodingTerm === 'midterm'
        ? (parseFloat(s.midterm) || 0) === 0
        : (parseFloat(s.finals) || 0) === 0
    );
    
    if (hasIncomplete) {
      alert(`Submission Blocked: All students in the section must have ${encodingTerm === 'midterm' ? 'Midterm' : 'Finals'} grades encoded before submitting to the Chairperson.`);
      return;
    }

    try {
      await handleSaveAll(sectionName);
      
      await submitSectionGrades(sections[sectionName].sectionCourse, sectionName);
      setSectionStatus(prev => ({ ...prev, [sectionName]: 'submitted' }));
    } catch (e) { alert("Error submitting section: " + e.message); }
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
  const isMidtermLocked = encodingTerm !== 'midterm';
  const isFinalsLocked = encodingTerm !== 'finals';

  return (
    <div className="min-h-screen bg-slate-50 pb-10 font-sans">
      <FacultyHeader
        facultyData={{ ...facultyData, semester: encodingSemester }}
        totalSections={totalSections}
        onLogout={onLogout}
      />

      <div className="mx-auto max-w-7xl">
        {bannerState === 'not_set' && (
          <div className="mx-6 mt-5 flex items-center gap-4 rounded-xl border-l-4 border-slate-400 bg-white p-4 text-slate-800 shadow-sm">
            <div>
              <strong className="block text-lg">Grade Encoding Period is not set</strong>
              <p className="mt-1 text-sm">The registrar has not opened an encoding schedule yet.</p>
            </div>
          </div>
        )}

        {bannerState === 'closed_after' && (
          <div className="mx-6 mt-5 flex items-center gap-4 rounded-xl border-l-4 border-red-500 bg-red-50 p-4 text-red-900 shadow-sm">
            <div className="text-2xl">LOCKED</div>
            <div>
              <strong className="block text-lg">Grade Encoding Period is currently Closed</strong>
              <p className="mt-1 text-sm">The encoding deadline has passed as of <strong>{formatDate(encodingEnd)}</strong>. Contact or visit the Registrar's Office for any concerns.</p>
            </div>
          </div>
        )}

        {bannerState === 'closed_before' && (
          <div className="mx-6 mt-5 flex items-center gap-4 rounded-xl border-l-4 border-slate-500 bg-slate-50 p-4 text-slate-800 shadow-sm">
            <div>
              <strong className="block text-lg">Grade Encoding Period has not started yet</strong>
              <p className="mt-1 text-sm">Encoding opens on <strong>{formatDate(encodingStart)}</strong>. Please check back then.</p>
            </div>
          </div>
        )}

        {bannerState === 'open' && (
          <div className="mx-6 mt-5 flex items-center gap-4 rounded-xl border-l-4 border-green-500 bg-green-50 p-4 text-green-900 shadow-sm">
            <div>
              <strong className="block text-lg">Grade Encoding Period is Open!</strong>
              <p className="mt-1 text-sm">Finalize your section grades and upload to the Registrar by <strong>{formatDate(encodingEnd)}</strong></p>
            </div>
          </div>
        )}

        {bannerState === 'urgent' && (
          <div className="mx-6 mt-5 flex items-center gap-4 rounded-xl border-l-4 border-yellow-500 bg-yellow-50 p-4 text-yellow-900 shadow-sm">
            <div>
              <strong className="block text-lg">Encoding Deadline in {daysLeft} {daysLeft === 1 ? 'Day' : 'Days'}!</strong>
              <p className="mt-1 text-sm">You have <strong>{daysLeft} {daysLeft === 1 ? 'day' : 'days'}</strong> left to submit grades before the deadline on <strong>{formatDate(encodingEnd)}</strong>. Please upload immediately.</p>
            </div>
          </div>
        )}

      {!activeSection ? (
        <div className="px-6 py-4">
          <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <YearTabs
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              sections={Object.values(sections)}
              className="mt-0 flex-1 px-0 py-0"
            />

            <div className="relative w-full lg:w-80 lg:flex-shrink-0">
              <input type="text" placeholder="Search for a section..." className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 outline-none focus:border-[#003366] focus:ring-2 focus:ring-[#003366]/20" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
          </div>

          <h2 className="mb-4 text-2xl font-bold text-[#003366]">{searchQuery ? `Results for "${searchQuery}"` : `${activeTab}`}</h2>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {isLoadingData ? (
              <div className="col-span-full py-10 text-center text-slate-500">Loading assigned sections and enrolled students...</div>
            ) : Object.keys(sections).length === 0 ? (
              <div className="col-span-full py-10 text-center text-slate-500">No sections are currently assigned to you.</div>
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
                const progressPct = total > 0 ? Math.round((encoded / total) * 100) : 0;
                const secStatus = sectionStatus[sectionName];

                return (
                  <ProgramCard 
                    key={sectionName}
                    sectionName={sectionName}
                    sectionData={sectionData}
                    onClick={() => setActiveSection(sectionName)}
                    progress={progressPct}
                    reviewStatus={secStatus === 'finalized' ? 'forwarded' : secStatus === 'submitted' ? 'submitted' : 'pending'}
                    onSubmit={() => handleSubmit(sectionName)}
                    onUpload={(e) => handleFileUpload(sectionName, e)}
                    isUploading={uploadingSection === sectionName}
                    isClosed={isClosed}
                  />
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="animate-in fade-in duration-300 px-6 py-6">
          <button className="mb-6 flex items-center gap-2 text-sm font-bold text-[#003366] hover:underline" onClick={() => setActiveSection(null)}>
            Back to Sections
          </button>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 p-6 md:flex-row md:items-center">
              <div>
                <span className="mr-2 rounded-lg bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">{sections[activeSection].subjectCode}</span>
                <h3 className="inline text-xl font-bold text-[#003366]">Section: {activeSection}</h3>
                {currentStatus && (
                  <span className={`ml-3 rounded-full px-3 py-1 text-xs font-bold ${
                    currentStatus === 'draft' ? 'bg-yellow-100 text-yellow-800' :
                    currentStatus === 'submitted' ? 'bg-blue-100 text-blue-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {currentStatus === 'draft' ? 'Draft Saved' : currentStatus === 'submitted' ? 'Submitted' : 'Finalized'}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {!isFinalized && (
                  <>
                    <div className="relative overflow-hidden">
                      <input
                        type="file"
                        accept=".csv, .xlsx"
                        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                        onChange={(e) => handleFileUpload(activeSection, e)}
                        disabled={uploadingSection === activeSection || isClosed}
                      />
                      <button className="rounded-lg bg-yellow-400 px-4 py-2.5 text-sm font-bold text-[#003366] transition hover:bg-yellow-500 disabled:opacity-50" disabled={uploadingSection === activeSection || isClosed}>
                        {uploadingSection === activeSection ? 'Upload' : 'Bulk Upload'}
                      </button>
                    </div>

                    <button onClick={() => handleExportClassGrades(activeSection)} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50">
                      Export CSV
                    </button>
                    <button onClick={() => handleExportPDFClassGrades(activeSection)} className="rounded-lg border border-emerald-600 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 transition hover:bg-emerald-50">
                      Export PDF
                    </button>
                    <button className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50" onClick={() => handleSaveAll(activeSection)} disabled={hasValidationErrors(activeSection) || isClosed}>
                       Save All (Draft)
                    </button>
                    <button className="rounded-lg bg-[#003366] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#00264d] disabled:opacity-50" onClick={() => handleSubmit(activeSection)} disabled={hasValidationErrors(activeSection) || isClosed}>
                       Submit to Chairperson
                    </button>
                    {currentStatus === 'submitted' && (
                      <button className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700" onClick={() => handleFinalize(activeSection)}>
                         Finalize & Lock
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {isFinalized && (
              <div className="border-b border-red-200 bg-red-50 p-4 text-center text-sm font-semibold text-red-700">
                 These grades have been finalized and submitted to the Registrar. Contact the Registrar's Office for any changes.
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead className="bg-[#003366] text-white">
                  <tr>
                    <th className="p-4">Student ID</th>
                    <th className="p-4">Student Name</th>
                    <th className="p-4 text-center">Midterm <span className="font-normal opacity-70">(60-100)</span></th>
                    <th className="p-4 text-center">Finals <span className="font-normal opacity-70">(60-100)</span></th>
                    <th className="p-4 text-center">Final Grade</th>
                    <th className="p-4 text-center">Status</th>
                    <th className="p-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sections[activeSection].students.map((stu, i) => {
                    const pt = calculatePLVPoint(stu);
                    const rowState = rowSaveState[activeSection]?.[i] || 'idle';
                    const errors = validationErrors[activeSection]?.[i] || {};
                    const hasError = errors.midterm || errors.finals;

                    return (
                      <tr key={`${stu.id}-${i}`} className={`border-b border-slate-100 hover:bg-slate-50 ${hasError ? 'bg-red-50' : rowState === 'saved' ? 'bg-green-50' : ''}`}>
                        <td className="p-4 font-semibold text-slate-700">{stu.id}</td>
                        <td className="p-4 font-medium text-slate-800">{stu.name}</td>
                        <td className="p-4 text-center">
                          <div className="relative inline-block">
                            <input
                              className={`w-20 rounded-lg border p-2 text-center outline-none focus:ring-2 focus:ring-[#003366]/20 disabled:bg-slate-100 disabled:text-slate-500 ${errors.midterm ? 'border-red-500 bg-red-50' : 'border-slate-300'}`}
                              type="number" min="60" max="100" value={stu.midterm || ''} disabled={isFinalized || isClosed || isMidtermLocked}
                              onChange={e => handleGradeChange(activeSection, i, 'midterm', e.target.value)} placeholder="60-100"
                            />
                            {errors.midterm && <div className="absolute left-1/2 -translate-x-1/2 -bottom-5 whitespace-nowrap text-[10px] font-bold text-red-600">{errors.midterm}</div>}
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          <div className="relative inline-block">
                            <input
                              className={`w-20 rounded-lg border p-2 text-center outline-none focus:ring-2 focus:ring-[#003366]/20 disabled:bg-slate-100 disabled:text-slate-500 ${errors.finals ? 'border-red-500 bg-red-50' : 'border-slate-300'}`}
                              type="number" min="60" max="100" value={stu.finals || ''} disabled={isFinalized || isClosed || isFinalsLocked}
                              onChange={e => handleGradeChange(activeSection, i, 'finals', e.target.value)} placeholder="60-100"
                            />
                            {errors.finals && <div className="absolute left-1/2 -translate-x-1/2 -bottom-5 whitespace-nowrap text-[10px] font-bold text-red-600">{errors.finals}</div>}
                          </div>
                        </td>
                        <td className="p-4 text-center text-lg font-bold text-[#003366]">{pt > 0 ? pt.toFixed(2) : '—'}</td>
                        <td className="p-4 text-center">
                          <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${
                              stu.remarks === 'Passed' ? 'bg-green-100 text-green-700' :
                              stu.remarks === 'Failed' ? 'bg-red-100 text-red-700' :
                              stu.remarks === 'Incomplete' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-slate-100 text-slate-700'
                          }`}>
                            {stu.remarks || 'Incomplete'}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          {!isFinalized ? (
                            <div className="flex items-center justify-center gap-2">
                              <button
                                className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1 text-lg hover:bg-blue-50 hover:border-blue-300 disabled:opacity-50"
                                onClick={() => handleSaveRow(activeSection, i)} disabled={hasError || rowState === 'saving' || isClosed} title="Save Row"
                              >
                                {rowState === 'saving' ? 'Loading..' : 'Upload'}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs font-bold text-slate-500">Locked</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {uploadResult && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className={`mb-2 text-2xl font-bold ${uploadResult.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>
              {uploadResult.title}
            </h2>
            <p className="mb-4 font-semibold text-slate-700">{uploadResult.message}</p>
            
            {uploadResult.details && (
              <div className="mb-5 flex-grow overflow-y-auto rounded-xl bg-slate-900 p-4 text-sm text-green-400">
                <pre className="whitespace-pre-wrap font-mono">{uploadResult.details}</pre>
              </div>
            )}
            
            <div className="text-right">
              <button className="rounded-xl bg-slate-200 px-5 py-2 font-bold text-slate-800 transition hover:bg-slate-300" onClick={() => setUploadResult(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default FacultyPortal;
