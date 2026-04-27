import React, { useState, useCallback, useEffect } from 'react';
import plvlogo from '../../assets/plvlogo.png';
import DownloadGradingSheetButton from './DownloadGradingSheetButton';
import { fetchFacultySections, fetchApprovedStudents, batchUploadGrades } from '../../services/api';
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

  const loadFacultyData = useCallback(async () => {
    setIsLoadingData(true);

    // --- MOCK DATA FOR TESTING UI ---
    const mockSectionsList = [
      { department: 'BSIT', section: '3-1', yearLevel: '3rd' },
      { department: 'BSCS', section: '1-A', yearLevel: '1st' },
      { department: 'BSEMC', section: '4-1', yearLevel: '4th' }
    ];

    const mockStudentsList = [
      { department: 'BSIT', section: '3-1', assignmentStatus: 'Enrolled', studentno: '2021-0001', fullname: 'Dela Cruz, Juan' },
      { department: 'BSIT', section: '3-1', assignmentStatus: 'Enrolled', studentno: '2021-0002', fullname: 'Smith, Alice' },
      { department: 'BSIT', section: '3-1', assignmentStatus: 'Enrolled', studentno: '2021-0003', fullname: 'Garcia, Maria' },
      { department: 'BSCS', section: '1-A', assignmentStatus: 'Enrolled', studentno: '2024-0101', fullname: 'Johnson, Bob' },
      { department: 'BSCS', section: '1-A', assignmentStatus: 'Enrolled', studentno: '2024-0102', fullname: 'Williams, Charlie' },
      { department: 'BSEMC', section: '4-1', assignmentStatus: 'Enrolled', studentno: '2020-0099', fullname: 'Brown, David' }
    ];

    try {
      const sectionsData = await fetchFacultySections(facultyData.email).catch(() => null);
      const studentsData = await fetchApprovedStudents().catch(() => null);

      const actualSections = sectionsData?.sections?.length > 0 ? sectionsData.sections : mockSectionsList;
      const actualStudents = studentsData?.students?.length > 0 ? studentsData.students : mockStudentsList;

      const newSections = {};

      actualSections.forEach(sec => {
        const sectionKey = `${sec.department} ${sec.section}`; 
        
        const enrolledStudents = actualStudents.filter(s => 
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
      const data = await batchUploadGrades(formData);
      setUploadResult({ type: 'success', title: 'Upload Successful', message: data.message || 'Grades mapped', details: data.output });
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
    <div className="min-h-screen bg-slate-50 pb-10 font-sans">
      <FacultyHeader facultyData={facultyData} totalSections={totalSections} onLogout={onLogout} />

      <div className="mx-auto max-w-7xl">
        {bannerState === 'closed_after' && (
          <div className="mx-6 mt-5 flex items-center gap-4 rounded-xl border-l-4 border-red-500 bg-red-50 p-4 text-red-900 shadow-sm">
            <div className="text-2xl">🔒</div>
            <div>
              <strong className="block text-lg">Grade Encoding Period is currently Closed</strong>
              <p className="mt-1 text-sm">The encoding deadline has passed as of <strong>{formatDate(ENCODING_END)}</strong>. Contact or visit the Registrar's Office for any concerns.</p>
            </div>
          </div>
        )}

        {bannerState === 'closed_before' && (
          <div className="mx-6 mt-5 flex items-center gap-4 rounded-xl border-l-4 border-slate-500 bg-slate-50 p-4 text-slate-800 shadow-sm">
            <div>
              <strong className="block text-lg">Grade Encoding Period has not started yet</strong>
              <p className="mt-1 text-sm">Encoding opens on <strong>{formatDate(ENCODING_START)}</strong>. Please check back then.</p>
            </div>
          </div>
        )}

        {bannerState === 'open' && (
          <div className="mx-6 mt-5 flex items-center gap-4 rounded-xl border-l-4 border-green-500 bg-green-50 p-4 text-green-900 shadow-sm">
            <div>
              <strong className="block text-lg">Grade Encoding Period is Open!</strong>
              <p className="mt-1 text-sm">Finalize your section grades and upload to the Registrar by <strong>{formatDate(ENCODING_END)}</strong></p>
            </div>
          </div>
        )}

        {bannerState === 'urgent' && (
          <div className="mx-6 mt-5 flex items-center gap-4 rounded-xl border-l-4 border-yellow-500 bg-yellow-50 p-4 text-yellow-900 shadow-sm">
            <div>
              <strong className="block text-lg">Encoding Deadline in {daysLeft} {daysLeft === 1 ? 'Day' : 'Days'}!</strong>
              <p className="mt-1 text-sm">You have <strong>{daysLeft} {daysLeft === 1 ? 'day' : 'days'}</strong> left to submit grades before the deadline on <strong>{formatDate(ENCODING_END)}</strong>. Please upload immediately.</p>
            </div>
          </div>
        )}

      {!activeSection ? (
        <div className="px-6 py-4">
          <YearTabs activeTab={activeTab} setActiveTab={setActiveTab} sections={Object.values(sections)} />

          <div className="relative max-w-md my-6">
            <input type="text" placeholder="Search for a section..." className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 outline-none focus:border-[#003366] focus:ring-2 focus:ring-[#003366]/20" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
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
                  />
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="animate-in fade-in duration-300 px-6 py-6">
          <button className="mb-6 flex items-center gap-2 text-sm font-bold text-[#003366] hover:underline" onClick={() => setActiveSection(null)}>
            ← Back to Sections
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
                    {currentStatus === 'draft' ? 'Draft Saved' : currentStatus === 'submitted' ? 'Submitted' : 'Finalized 🔒'}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {!isFinalized && (
                  <>
                    <button className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50" onClick={() => handleSaveAll(activeSection)} disabled={hasValidationErrors(activeSection)}>
                       Save All (Draft)
                    </button>
                    <button className="rounded-xl bg-[#003366] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#002244] disabled:opacity-50" onClick={() => handleSubmit(activeSection)} disabled={hasValidationErrors(activeSection)}>
                       Submit Grades
                    </button>
                    {currentStatus === 'submitted' && (
                      <button className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700" onClick={() => handleFinalize(activeSection)}>
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
                              type="number" min="60" max="100" value={stu.midterm || ''} disabled={isFinalized}
                              onChange={e => handleGradeChange(activeSection, i, 'midterm', e.target.value)} placeholder="60-100"
                            />
                            {errors.midterm && <div className="absolute left-1/2 -translate-x-1/2 -bottom-5 whitespace-nowrap text-[10px] font-bold text-red-600">{errors.midterm}</div>}
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          <div className="relative inline-block">
                            <input
                              className={`w-20 rounded-lg border p-2 text-center outline-none focus:ring-2 focus:ring-[#003366]/20 disabled:bg-slate-100 disabled:text-slate-500 ${errors.finals ? 'border-red-500 bg-red-50' : 'border-slate-300'}`}
                              type="number" min="60" max="100" value={stu.finals || ''} disabled={isFinalized}
                              onChange={e => handleGradeChange(activeSection, i, 'finals', e.target.value)} placeholder="60-100"
                            />
                            {errors.finals && <div className="absolute left-1/2 -translate-x-1/2 -bottom-5 whitespace-nowrap text-[10px] font-bold text-red-600">{errors.finals}</div>}
                          </div>
                        </td>
                        <td className="p-4 text-center font-bold text-[#003366]">{pt > 0 ? pt.toFixed(2) : '—'}</td>
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
                                onClick={() => handleSaveRow(activeSection, i)} disabled={hasError || rowState === 'saving'} title="Save Row"
                              >
                                {rowState === 'saving' ? '⏳' : '💾'}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs font-bold text-slate-500">🔒 Locked</span>
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