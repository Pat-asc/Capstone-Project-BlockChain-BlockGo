import React, { useState } from "react";
import RegistrarHeader from "../components/registrar/RegistrarHeader";
import RegistrarSidebar from "../components/registrar/RegistrarSidebar";
import RegistrarDashboard from "../components/registrar/RegistrarDashboard";
import FacultyMonitoring from "../components/registrar/FacultyMonitoring";
import EncodingPeriod from "../components/registrar/EncodingPeriod";
import StudentListImport, {
  StudentSubmissionLogs,
} from "../components/registrar/StudentListImport";
import GradeFinalization from "../components/registrar/GradeFinalization";
import RegistrarStudentSectioning from "../components/registrar/RegistrarStudentSectioning";
import RegistrarSectionsCreated from "../components/registrar/RegistrarSectionsCreated";
import { programs } from "../data/registrarData";

function RegistrarPortal({ onLogout, onResetEncodingSeason, allGrades = {} }) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sectioningDepartment, setSectioningDepartment] = useState(
    programs[0] || ""
  );
  const [sectioningVersion, setSectioningVersion] = useState(0);

  const registrarData = {
    name: "PLV Registrar",
    schoolYear: "2025-2026",
    semester: "2nd Semester",
  };

  const getSectionTitle = () => {
    switch (activeTab) {
      case "dashboard":
        return "Dashboard";
      case "encoding":
        return "Encoding Period";
      case "sectioning":
        return "Student Sectioning";
      case "sectionsCreated":
        return "Sections Created";
      case "monitoring":
        return "Monitoring";
      case "finalization":
        return "Grade Finalization";
      case "reports":
        return "Reports & PDF";
      default:
        return "Dashboard";
    }
  };

  const getSectionDescription = () => {
    switch (activeTab) {
      case "dashboard":
        return "Overview of registrar activities and grade encoding progress.";
      case "encoding":
        return "Manage the opening and closing of the encoding period.";
      case "sectioning":
        return "Import student lists and create sections.";
      case "sectionsCreated":
        return "Review, edit, promote, and maintain registrar-created sections.";
      case "monitoring":
        return "Track faculty encoding progress and monitor submission status in real time.";
      case "finalization":
        return "Finalize submitted grades and upload them to student accounts.";
      case "reports":
        return "Generate and download PDF summaries for records and documentation.";
      default:
        return "Overview of registrar activities and grade encoding progress.";
    }
  };

  const renderContent = () => {
  if (activeTab === "dashboard") {
    return <RegistrarDashboard />;
  }

  if (activeTab === "encoding") {
    return <EncodingPeriod onResetEncodingSeason={onResetEncodingSeason} />;
  }

  if (activeTab === "sectioning") {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="block max-w-xl">
            <span className="mb-2 block text-sm font-medium text-slate-700">
              Department
            </span>
            <select
              value={sectioningDepartment}
              onChange={(event) => setSectioningDepartment(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#003366]"
            >
              {programs.map((program) => (
                <option key={program} value={program}>
                  {program}
                </option>
              ))}
            </select>
          </label>
        </div>

        <StudentListImport
          selectedProgram={sectioningDepartment}
          onImportComplete={() =>
            setSectioningVersion((currentVersion) => currentVersion + 1)
          }
        />

        <RegistrarStudentSectioning
          key={sectioningVersion}
          chairpersonDepartment={sectioningDepartment}
        />

        <StudentSubmissionLogs />
      </div>
    );
  }

  if (activeTab === "monitoring") {
    return <FacultyMonitoring />;
  }

  if (activeTab === "sectionsCreated") {
    return <RegistrarSectionsCreated />;
  }

  if (activeTab === "finalization") {
    return <GradeFinalization allGrades={allGrades} />;
  }

  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
      <h3 className="text-xl font-semibold text-[#003366]">
        {getSectionTitle()}
      </h3>
      <p className="mt-2 text-sm text-slate-500">
        {getSectionDescription()}
      </p>
      <p className="mt-4 text-sm text-slate-400">
        This section will be added next.
      </p>
    </div>
  );
};

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      <RegistrarHeader registrarData={registrarData} onLogout={onLogout} />

      <div className="px-6 py-6">
        <div className="flex flex-col gap-6 lg:flex-row">
          <RegistrarSidebar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
          />

          <main className="flex-1 space-y-4">
            <div>
              <h2 className="text-2xl font-bold text-[#003366]">
                {getSectionTitle()}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {getSectionDescription()}
              </p>
            </div>

            {renderContent()}
          </main>
        </div>
      </div>
    </div>
  );
}

export default RegistrarPortal;
