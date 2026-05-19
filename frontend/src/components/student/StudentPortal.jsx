import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchAllGrades, getSystemSetting } from '../../services/api';
import StudentNavbar from './StudentNavbar';
import StudentInfoCard from './StudentInfoCard';
import StudentSummary from './StudentSummary';
import StudentGradesTable from './StudentGradesTable';
import { getPLVPoint } from '../../utils/studentHelpers';
import { useRecoveredState } from '../../utils/sessionRecovery';

const StudentPortal = ({ studentData, onLogout }) => {
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSemester, setActiveSemester] = useState('Semester Grades');
  const [selectedSchoolYear, setSelectedSchoolYear] = useRecoveredState('student:selectedSchoolYear', '');
  const [selectedSemester, setSelectedSemester] = useRecoveredState('student:selectedSemester', '');
  const [isTorPreviewOpen, setIsTorPreviewOpen] = useRecoveredState('student:isTorPreviewOpen', false);

  const rawFullName = studentData.name || '';
  const firstName = rawFullName.split(' ')[0] || '';
  const storedMiddleName = studentData.middleName || '';
  const remainingName = rawFullName.split(' ').slice(1).join(' ').trim();
  const escapedMiddleName = storedMiddleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lastName = storedMiddleName && escapedMiddleName
    ? remainingName.replace(new RegExp(`^${escapedMiddleName}\\s*`, 'i'), '').trim()
    : remainingName;

  const getStudentKey = useCallback((grade) => (
    grade.student_hash ||
    grade.studentHash ||
    grade.StudentHash ||
    grade.studentId ||
    grade.StudentId ||
    ''
  ), []);

  const parseGradePayload = useCallback((grade) => {
    const rawGrade = grade.grade || grade.Grade;

    if (!rawGrade) {
        return { midterm: '---', finals: '---', finalAverage: '---' };
    }

    if (typeof rawGrade === 'object') {
        return {
            midterm: rawGrade.midterm || '---',
            finals: rawGrade.finals || '---',
            finalAverage: rawGrade.finalAverage || rawGrade.final || rawGrade.grade || '---',
            attendance: rawGrade.attendance || rawGrade.midtermAttendance || rawGrade.finalAttendance || 'not applicable'
        };
    }

    if (typeof rawGrade === 'string' && rawGrade.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(rawGrade);
            return {
                midterm: parsed.midterm || '---',
                finals: parsed.finals || '---',
                finalAverage: parsed.finalAverage || parsed.final || parsed.grade || '---',
                attendance: parsed.attendance || parsed.midtermAttendance || parsed.finalAttendance || 'not applicable'
            };
        } catch (error) {
            console.error("Failed to parse grade JSON:", error);
        }
    }

    return { midterm: '---', finals: '---', finalAverage: rawGrade };
  }, []);

  const loadGrades = useCallback(async (isBackground = false) => {
      if (!isBackground) setLoading(true);
      try {
        const response = await fetchAllGrades(studentData.email);
        let allGrades = [];
        
        // Handle different backend response structures safely
        if (Array.isArray(response)) {
            allGrades = response;
        } else if (response.status === 'Success' && response.data) {
            allGrades = response.data;
        }

        // Filter strictly to only show the logged-in student's records
        const myGrades = allGrades.filter(g => {
            const studentKey = getStudentKey(g);
            return studentKey === studentData.email || studentKey === studentData.email.split('@')[0];
        });
        
        setGrades(myGrades);
      } catch (error) {
        console.error('Error fetching grades from blockchain:', error);
      }
      if (!isBackground) setLoading(false);
  }, [getStudentKey, studentData.email]);

  useEffect(() => {
    loadGrades();
    const handleAcademicDataChanged = () => loadGrades(true);
    window.addEventListener('blockgo:academic-data-changed', handleAcademicDataChanged);

    return () => window.removeEventListener('blockgo:academic-data-changed', handleAcademicDataChanged);
  }, [loadGrades]);

  useEffect(() => {
    const applyEncodingPeriod = (value) => {
      if (!value) return;
      try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        setActiveSemester(parsed?.semester ? `${parsed.semester} Grades` : 'Semester Grades');
      } catch (error) {
        console.error('Failed to parse encoding period for student portal:', error);
      }
    };

    const loadEncodingPeriod = async () => {
      try {
        const res = await getSystemSetting('encoding_period');
        if (res.status === 'Success' && res.value) {
          applyEncodingPeriod(res.value);
        }
      } catch (error) {
        console.error('Failed to load encoding period for student portal:', error);
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

  const schoolYearOptions = useMemo(() => Array.from(new Set(
    grades
      .map((grade) => grade.school_year || grade.schoolYear || grade.SchoolYear)
      .filter(Boolean)
  )).sort().reverse(), [grades]);

  const semesterOptions = useMemo(() => Array.from(new Set(
    grades
      .filter((grade) => {
        if (!selectedSchoolYear) return true;
        return String(grade.school_year || grade.schoolYear || grade.SchoolYear || '') === selectedSchoolYear;
      })
      .map((grade) => grade.semester || grade.Semester)
      .filter(Boolean)
  )).sort(), [grades, selectedSchoolYear]);

  useEffect(() => {
    if (!selectedSchoolYear && schoolYearOptions.length > 0) {
      setSelectedSchoolYear(schoolYearOptions[0]);
    }
  }, [selectedSchoolYear, schoolYearOptions]);

  useEffect(() => {
    if (!selectedSemester && semesterOptions.length > 0) {
      setSelectedSemester(semesterOptions[0]);
    } else if (selectedSemester && semesterOptions.length > 0 && !semesterOptions.includes(selectedSemester)) {
      setSelectedSemester(semesterOptions[0]);
    }
  }, [selectedSemester, semesterOptions]);

  const visibleGrades = grades.filter((grade) => {
    const schoolYear = String(grade.school_year || grade.schoolYear || grade.SchoolYear || '');
    const semester = String(grade.semester || grade.Semester || '');
    return (!selectedSchoolYear || schoolYear === selectedSchoolYear) &&
      (!selectedSemester || semester === selectedSemester);
  });

  const extractYearLevel = (grade) => {
    const raw = String(grade.year_level || grade.yearLevel || grade.YearLevel || grade.section || '').toLowerCase();
    if (raw.includes('1') || raw.includes('1st')) return '1';
    if (raw.includes('2') || raw.includes('2nd')) return '2';
    if (raw.includes('3') || raw.includes('3rd')) return '3';
    if (raw.includes('4') || raw.includes('4th')) return '4';
    return '';
  };

  const completedCourseYears = new Set(grades.map(extractYearLevel).filter(Boolean));
  const canPrintTOR = ['1', '2', '3', '4'].every((year) => completedCourseYears.has(year));

  const showTorIncompleteMessage = () => {
    alert('complete your course years before printing');
  };

  const buildTorRows = () => grades.map((grade) => {
    const parsed = parseGradePayload(grade);
    const mid = parseFloat(parsed.midterm);
    const fin = parseFloat(parsed.finals);
    const numericAverage =
      !isNaN(mid) && !isNaN(fin)
        ? (mid + fin) / 2
        : parseFloat(parsed.finalAverage);
    const finalGrade = !isNaN(numericAverage) ? numericAverage.toFixed(2) : '---';
    const equivalent = !isNaN(numericAverage) ? getPLVPoint(numericAverage, numericAverage).toFixed(2) : '---';

    return {
      schoolYear: grade.school_year || grade.schoolYear || grade.SchoolYear || '--',
      semester: grade.semester || grade.Semester || '--',
      code: grade.subject_code || grade.subjectCode || grade.SubjectCode || 'N/A',
      name: grade.subject_name || grade.subjectName || grade.SubjectName || grade.subject_code || grade.subjectCode || 'Unknown Subject',
      units: 3,
      finalGrade,
      equivalent,
      remarks: finalGrade !== '---' ? (Number(finalGrade) >= 75 ? 'Passed' : 'Failed') : 'Pending',
    };
  });

  const handlePreviewTOR = () => {
    if (!canPrintTOR) {
      showTorIncompleteMessage();
      return;
    }
    setIsTorPreviewOpen(true);
  };

  const handleSaveTOR = () => {
    if (!canPrintTOR) {
      showTorIncompleteMessage();
      return;
    }
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const rows = buildTorRows();

      doc.setTextColor(0, 51, 102);
      doc.setFontSize(16);
      doc.text('PAMANTASAN NG LUNGSOD NG VALENZUELA', 14, 18);
      doc.setFontSize(12);
      doc.text('Transcript of Records', 14, 26);
      doc.setTextColor(40);
      doc.setFontSize(10);
      doc.text(`Student: ${[firstName, storedMiddleName, lastName].filter(Boolean).join(' ')}`, 14, 38);
      doc.text(`Student No: ${studentData.studentNo || 'N/A'}`, 14, 44);
      doc.text(`Program: ${studentData.department || 'N/A'}`, 14, 50);
      doc.text(`Section: ${studentData.section || 'N/A'}`, 14, 56);

      doc.autoTable({
        startY: 66,
        head: [['School Year', 'Semester', 'Code', 'Subject', 'Units', 'Grade', 'Equivalent', 'Remarks']],
        body: rows.map((row) => [
          row.schoolYear,
          row.semester,
          row.code,
          row.name,
          row.units,
          row.finalGrade,
          row.equivalent,
          row.remarks,
        ]),
        headStyles: { fillColor: [0, 51, 102], fontSize: 8 },
        bodyStyles: { fontSize: 8 },
      });

      doc.save(`${studentData.studentNo || 'student'}_TOR.pdf`);
    } catch (error) {
      alert('Could not generate TOR PDF. Please try again.');
    }
  };

  const handlePrintTOR = () => {
    if (!canPrintTOR) {
      showTorIncompleteMessage();
      return;
    }
    const rows = buildTorRows();
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Transcript of Records</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
            h1 { color: #003366; font-size: 20px; margin: 0; }
            h2 { font-size: 15px; margin: 4px 0 18px; }
            .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 24px; font-size: 12px; margin-bottom: 18px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th { background: #003366; color: white; text-align: left; }
            th, td { border: 1px solid #cbd5e1; padding: 7px; }
          </style>
        </head>
        <body>
          <h1>PAMANTASAN NG LUNGSOD NG VALENZUELA</h1>
          <h2>Transcript of Records</h2>
          <div class="meta">
            <div><strong>Student:</strong> ${[firstName, storedMiddleName, lastName].filter(Boolean).join(' ')}</div>
            <div><strong>Student No:</strong> ${studentData.studentNo || 'N/A'}</div>
            <div><strong>Program:</strong> ${studentData.department || 'N/A'}</div>
            <div><strong>Section:</strong> ${studentData.section || 'N/A'}</div>
          </div>
          <table>
            <thead>
              <tr><th>School Year</th><th>Semester</th><th>Code</th><th>Subject</th><th>Units</th><th>Grade</th><th>Equivalent</th><th>Remarks</th></tr>
            </thead>
            <tbody>
              ${rows.map((row) => `<tr><td>${row.schoolYear}</td><td>${row.semester}</td><td>${row.code}</td><td>${row.name}</td><td>${row.units}</td><td>${row.finalGrade}</td><td>${row.equivalent}</td><td>${row.remarks}</td></tr>`).join('')}
            </tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const totalUnits = visibleGrades.length * 3; // Assuming 3 units per subject block for now
  
  const totalWeight = visibleGrades.reduce((sum, sub) => {
    const parsed = parseGradePayload(sub);
    const mid = parseFloat(parsed.midterm);
    const fin = parseFloat(parsed.finals);
    const numericAverage =
      !isNaN(mid) && !isNaN(fin)
        ? (mid + fin) / 2
        : parseFloat(parsed.finalAverage);
    const equivalent = !isNaN(numericAverage) ? getPLVPoint(numericAverage, numericAverage) : 0;
    return sum + (equivalent * 3);
  }, 0);

  const calculatedGWA = totalUnits > 0 ? (totalWeight / totalUnits).toFixed(2) : "0.00";

  const isDeansLister = visibleGrades.length > 0 && Number(calculatedGWA) <= 1.75 && visibleGrades.every(s => {
    const parsed = parseGradePayload(s);
    const mid = parseFloat(parsed.midterm);
    const fin = parseFloat(parsed.finals);
    const numericAverage =
      !isNaN(mid) && !isNaN(fin)
        ? (mid + fin) / 2
        : parseFloat(parsed.finalAverage);
    const equivalent = !isNaN(numericAverage) ? getPLVPoint(numericAverage, numericAverage) : Infinity;
    return equivalent <= 2.25;
  });
  const failedSubjectsCount = visibleGrades.filter(s => {
    const parsed = parseGradePayload(s);
    const mid = parseFloat(parsed.midterm);
    const fin = parseFloat(parsed.finals);
    const numericAverage =
      !isNaN(mid) && !isNaN(fin)
        ? (mid + fin) / 2
        : parseFloat(parsed.finalAverage);
    return !isNaN(numericAverage) && numericAverage < 75;
  }).length;

  let mappedSubjects = visibleGrades.map(g => {
    const parsed = parseGradePayload(g);
    
    let rawAverage = "---";
    const mid = parseFloat(parsed.midterm);
    const fin = parseFloat(parsed.finals);
    
    if (!isNaN(mid) && !isNaN(fin)) {
        rawAverage = ((mid + fin) / 2).toFixed(2);
    } else if (!isNaN(mid)) {
        rawAverage = mid.toFixed(2);
    } else if (!isNaN(fin)) {
        rawAverage = fin.toFixed(2);
    }

    const numericAverage = parseFloat(rawAverage);
    const computedEquivalent =
      !isNaN(numericAverage) ? getPLVPoint(numericAverage, numericAverage).toFixed(2) : "---";

    let computedRemarks = "Pending";
    if (!isNaN(numericAverage)) {
        computedRemarks = numericAverage >= 75 ? "Passed" : "Failed";
    }

    return {
      code: g.subject_code || g.subjectCode || g.SubjectCode || 'N/A',
      name: g.subject_name || g.subjectName || g.SubjectName || g.subject_code || g.subjectCode || 'Unknown Subject',
      units: 3,
      midterm: parsed.midterm,
      finals: parsed.finals,
      finalGrade: rawAverage !== "---" ? rawAverage : parsed.finalAverage,
      equivalent: computedEquivalent,
      remarks: computedRemarks
    };
  });

  if (mappedSubjects.length === 0 && studentData.enrolledSubjects && studentData.enrolledSubjects.length > 0) {
      mappedSubjects = studentData.enrolledSubjects.map(subName => ({
          code: 'PENDING',
          name: subName,
          units: 3,
          midterm: '---',
          finals: '---'
      }));
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-10">
      <StudentNavbar onLogout={onLogout} />
        
      <div className="mx-auto max-w-7xl">
        <StudentInfoCard 
          studentData={{
            firstName,
            lastName,
            middleName: storedMiddleName || 'Not provided',
            studentId: studentData.studentNo || 'N/A',
            dateOfBirth: studentData.dateOfBirth || 'Not provided',
            sex: studentData.sex || 'Not provided',
            phone: studentData.phone || 'Not provided',
            email: studentData.studentEmail || studentData.email,
            department: studentData.department,
            section: studentData.section,
            address: studentData.address || 'Not provided'
          }}
          onPreviewTOR={handlePreviewTOR}
          onSaveTOR={handleSaveTOR}
          torDisabled={!canPrintTOR}
        />

        <div className="mx-4 mt-5 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:mx-6 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            School Year
            <select
              value={selectedSchoolYear}
              onChange={(event) => {
                setSelectedSchoolYear(event.target.value);
                setSelectedSemester('');
              }}
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#003366]"
            >
              {schoolYearOptions.length === 0 ? <option value="">No records</option> : null}
              {schoolYearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Semester
            <select
              value={selectedSemester}
              onChange={(event) => setSelectedSemester(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#003366]"
            >
              {semesterOptions.length === 0 ? <option value="">No records</option> : null}
              {semesterOptions.map((semester) => (
                <option key={semester} value={semester}>{semester}</option>
              ))}
            </select>
          </label>
        </div>

        <StudentSummary 
          totalUnits={totalUnits} 
          gwa={calculatedGWA} 
          isDeansLister={isDeansLister} 
          failedSubjectsCount={failedSubjectsCount} 
          semesterLabel={selectedSchoolYear && selectedSemester ? `${selectedSchoolYear} - ${selectedSemester} Grades` : activeSemester}
        />

        {failedSubjectsCount >= 2 && (
          <div className="mx-6 mt-4 flex items-center gap-4 rounded-xl border-l-4 border-red-600 bg-red-50 p-4 text-red-900 shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <strong className="block text-lg">Academic Warning</strong>
              <p className="mt-1 text-sm">You have failed two or more subjects. Please consult with the Registrar or your Department Chairperson regarding your academic standing.</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="mx-6 mt-10 rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <h3 className="text-xl font-bold text-[#003366]">Syncing Records with Blockchain Ledger...</h3>
            <p className="mt-2 text-sm text-slate-500">Please wait while we securely retrieve your academic records.</p>
          </div>
        ) : (mappedSubjects.length === 0 && (!studentData.enrolledSubjects || studentData.enrolledSubjects.length === 0)) ? (
          <div className="mx-6 mt-10 rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <h3 className="text-xl font-bold text-slate-400">No Grades Found</h3>
            <p className="mt-2 text-sm text-slate-500">No ledger records or enrollment data found for your account yet.</p>
          </div>
        ) : (
          <StudentGradesTable subjects={mappedSubjects} />
        )}
      </div>

      {isTorPreviewOpen && (
        <div className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 flex flex-col gap-3 border-b border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-bold text-[#003366]">Transcript of Records Preview</h3>
                <p className="text-sm text-slate-500">Mock TOR layout for review before printing.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={handlePrintTOR} className="rounded-lg bg-[#003366] px-4 py-2 text-sm font-bold text-white">Print</button>
                <button type="button" onClick={handleSaveTOR} className="rounded-lg border border-[#003366] px-4 py-2 text-sm font-bold text-[#003366]">Save PDF</button>
                <button type="button" onClick={() => setIsTorPreviewOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">Close</button>
              </div>
            </div>
            <div className="p-5">
              <div className="border border-slate-300 p-5">
                <h1 className="text-xl font-extrabold text-[#003366]">PAMANTASAN NG LUNGSOD NG VALENZUELA</h1>
                <p className="mt-1 text-sm font-semibold text-slate-700">Transcript of Records</p>
                <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  <p><strong>Student:</strong> {[firstName, storedMiddleName, lastName].filter(Boolean).join(' ')}</p>
                  <p><strong>Student No:</strong> {studentData.studentNo || 'N/A'}</p>
                  <p><strong>Program:</strong> {studentData.department || 'N/A'}</p>
                  <p><strong>Section:</strong> {studentData.section || 'N/A'}</p>
                </div>
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-sm">
                    <thead className="bg-[#003366] text-white">
                      <tr>
                        <th className="border p-2 text-left">School Year</th>
                        <th className="border p-2 text-left">Semester</th>
                        <th className="border p-2 text-left">Code</th>
                        <th className="border p-2 text-left">Subject</th>
                        <th className="border p-2 text-center">Units</th>
                        <th className="border p-2 text-center">Grade</th>
                        <th className="border p-2 text-center">Equivalent</th>
                        <th className="border p-2 text-center">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buildTorRows().map((row, index) => (
                        <tr key={`${row.code}-${index}`}>
                          <td className="border p-2">{row.schoolYear}</td>
                          <td className="border p-2">{row.semester}</td>
                          <td className="border p-2 font-semibold text-[#003366]">{row.code}</td>
                          <td className="border p-2">{row.name}</td>
                          <td className="border p-2 text-center">{row.units}</td>
                          <td className="border p-2 text-center">{row.finalGrade}</td>
                          <td className="border p-2 text-center">{row.equivalent}</td>
                          <td className="border p-2 text-center">{row.remarks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentPortal;
