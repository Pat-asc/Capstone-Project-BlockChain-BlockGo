import StudentNavbar from "../components/student/StudentNavbar";
import StudentInfoCard from "../components/student/StudentInfoCard";
import StudentSummary from "../components/student/StudentSummary";
import StudentGradesTable from "../components/student/StudentGradesTable";
import {
  getCalculatedGWA,
  getTotalUnits,
  isDeanLister,
} from "../utils/studentHelpers";

const StudentPortal = ({ studentData, onLogout, failedSubjectsCount }) => {
  const totalUnits = getTotalUnits(studentData.subjects);
  const gwa = getCalculatedGWA(studentData.subjects);
  const isDeansLister = isDeanLister(studentData.subjects, gwa);

  return (
    <div className="min-h-screen bg-slate-100">
      <StudentNavbar onLogout={onLogout} />
      <StudentInfoCard studentData={studentData} />
      <StudentSummary
        totalUnits={totalUnits}
        gwa={gwa}
        isDeansLister={isDeansLister}
        failedSubjectsCount={failedSubjectsCount}
      />
      <StudentGradesTable subjects={studentData.subjects} />
    </div>
  );
};

export default StudentPortal;