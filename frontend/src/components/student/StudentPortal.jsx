import React, { useState, useEffect, useCallback } from 'react';
import { fetchAllGrades } from '../../services/api';
import StudentNavbar from './StudentNavbar';
import StudentInfoCard from './StudentInfoCard';
import StudentSummary from './StudentSummary';
import StudentGradesTable from './StudentGradesTable';

const StudentPortal = ({ studentData, onLogout }) => {
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);

  const getStudentKey = useCallback((grade) => (
    grade.student_hash ||
    grade.studentHash ||
    grade.StudentHash ||
    grade.studentId ||
    grade.StudentId ||
    ''
  ), []);

  const getGradeValue = useCallback((grade) => {
    const rawGrade = grade.grade || grade.Grade || '';
    if (typeof rawGrade === 'number') return rawGrade;
    if (typeof rawGrade !== 'string') return '';

    if (rawGrade.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(rawGrade);
        return parsed.finalAverage || parsed.final || parsed.grade || '';
      } catch (e) {
        return rawGrade;
      }
    }

    return rawGrade;
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

  // 2. Calculate Semester Totals
  const totalUnits = grades.length * 3; // Assuming 3 units per subject block for now
  
  const totalWeight = grades.reduce((sum, sub) => sum + ((parseFloat(getGradeValue(sub)) || 0) * 3), 0);

  const calculatedGWA = totalUnits > 0 ? (totalWeight / totalUnits).toFixed(2) : "0.00";

  // 3. Status logic: Dean's List eligibility check
  const isDeansLister = grades.length > 0 && Number(calculatedGWA) <= 1.75 && grades.every(s => parseFloat(getGradeValue(s)) <= 2.25);
  const failedSubjectsCount = grades.filter(s => parseFloat(getGradeValue(s)) > 3.0 || parseFloat(getGradeValue(s)) === 5.0).length;

  // Map the raw blockchain array to the structure expected by the new StudentGradesTable
  let mappedSubjects = grades.map(g => {
    const finalGrade = getGradeValue(g);
    return {
      code: g.subject_code || g.subjectCode || g.SubjectCode || 'N/A',
      name: g.subject_name || g.subjectName || g.SubjectName || g.course || g.Course || 'N/A',
      units: 3, // Assuming 3 units per subject block for now
      midterm: finalGrade,
      finals: finalGrade,
    };
  });

  // If no grades on blockchain but the student is enrolled in subjects, show them as 'PENDING'
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
            firstName: studentData.name?.split(' ')[0] || '',
            lastName: studentData.name?.split(' ').slice(1).join(' ') || '',
            middleName: '', // Optional, parse if needed
            studentId: studentData.studentNo || 'N/A',
            dateOfBirth: studentData.dateOfBirth || 'Not provided',
            sex: studentData.sex || 'Not provided',
            phone: studentData.phone || 'Not provided',
            email: studentData.email,
            department: studentData.department,
            section: studentData.section,
            address: studentData.address || 'Not provided'
          }} 
        />

        <StudentSummary 
          totalUnits={totalUnits} 
          gwa={calculatedGWA} 
          isDeansLister={isDeansLister} 
          failedSubjectsCount={failedSubjectsCount} 
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
    </div>
  );
};

export default StudentPortal;
