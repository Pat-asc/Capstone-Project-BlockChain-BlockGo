import React, { useState, useEffect } from 'react';
import { fetchAllGrades } from '../../services/api';
import StudentNavbar from './StudentNavbar';
import StudentInfoCard from './StudentInfoCard';
import StudentSummary from './StudentSummary';
import StudentGradesTable from './StudentGradesTable';

const StudentPortal = ({ studentData, onLogout }) => {
  const [grades, setGrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadGrades = async () => {
      setLoading(true);
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
        const myGrades = allGrades.filter(g => 
            g.student_hash === studentData.email || 
            g.studentId === studentData.email ||
            g.studentId === studentData.email.split('@')[0]
        );
        
        setGrades(myGrades);
      } catch (error) {
        console.error('Error fetching grades from blockchain:', error);
      }
      setLoading(false);
    };

    loadGrades();
  }, [studentData.email]);

  // 2. Calculate Semester Totals
  const totalUnits = grades.length * 3; // Assuming 3 units per subject block for now
  
  const totalWeight = grades.reduce((sum, sub) => sum + ((parseFloat(sub.grade) || 0) * 3), 0);

  const calculatedGWA = totalUnits > 0 ? (totalWeight / totalUnits).toFixed(2) : "0.00";

  // 3. Status logic: Dean's List eligibility check
  const isDeansLister = grades.length > 0 && Number(calculatedGWA) <= 1.75 && grades.every(s => parseFloat(s.grade) <= 2.25);
  const failedSubjectsCount = grades.filter(s => parseFloat(s.grade) > 3.0 || parseFloat(s.grade) === 5.0).length;

  // Map the raw blockchain array to the structure expected by the new StudentGradesTable
  const mappedSubjects = grades.map(g => ({
      code: g.subject_code || 'N/A',
      name: g.course || 'N/A',
      units: 3, // Assuming 3 units per subject block for now
      midterm: g.grade, // Since the blockchain currently only stores the final average, we map it directly
      finals: g.grade,
  }));

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
            dateOfBirth: 'On File',
            sex: 'Not Specified',
            phone: 'On File',
            email: studentData.email,
            address: 'Valenzuela City, Philippines' // Default or fetch from profile if added later
          }} 
        />

        <StudentSummary 
          totalUnits={totalUnits} 
          gwa={calculatedGWA} 
          isDeansLister={isDeansLister} 
          failedSubjectsCount={failedSubjectsCount} 
        />

        {loading ? (
          <div className="mx-6 mt-10 rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <h3 className="text-xl font-bold text-[#003366]">Syncing Records with Blockchain Ledger...</h3>
            <p className="mt-2 text-sm text-slate-500">Please wait while we securely retrieve your academic records.</p>
          </div>
        ) : grades.length === 0 ? (
          <div className="mx-6 mt-10 rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <h3 className="text-xl font-bold text-slate-400">No Grades Found</h3>
            <p className="mt-2 text-sm text-slate-500">No ledger records have been finalized for your account yet.</p>
          </div>
        ) : (
          <StudentGradesTable subjects={mappedSubjects} />
        )}
      </div>
    </div>
  );
};

export default StudentPortal;