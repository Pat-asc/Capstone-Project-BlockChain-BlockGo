import React from "react";
import plvlogo from "../../assets/plvlogo.png";

const FacultyHeader = ({ facultyData, totalSections, onLogout }) => {
  const rawName = (
    facultyData.fullName ||
    `${facultyData.firstName || ""} ${facultyData.lastName || ""}`.trim() ||
    facultyData.name ||
    facultyData.email ||
    "Faculty"
  ).trim();

  const facultyName = rawName
    .replace(/^(prof\.?|mr\.?|ms\.?|mrs\.?|dept admin|registrar)\s+/i, "")
    .trim() || "Faculty";

  const classification = facultyData.Classification || facultyData.facultyType || "Not set";

  return (
    <div className="w-full">

      {/* 🔵 TOP NAV BAR */}
      <div className="bg-[#003366] px-6 py-3 flex items-center justify-between">

        <div className="flex items-center gap-3">
          <img
            src={plvlogo}
            alt="PLV Logo"
            className="w-10 h-10 object-contain"
          />

          <div className="leading-tight">
            <p className="text-sm font-medium text-white/80">Faculty Portal</p>
            <h1 className="text-white text-sm font-semibold">
              Welcome Faculty
            </h1>
          </div>
        </div>

        <button
          onClick={onLogout}
          className="border border-yellow-400 text-yellow-400 px-4 py-2 rounded-lg font-bold text-sm hover:bg-yellow-400 hover:text-[#003366] transition"
        >
          LOGOUT
        </button>
      </div>

      {/* 🟦 MAIN HEADER CARD */}
      <div className="mt-5 px-4 md:px-6">
        <div className="rounded-xl bg-[#003366] p-4 md:p-6 text-white flex flex-col gap-4 md:flex-row md:items-center md:justify-between">

          {/* LEFT INFO */}
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold leading-tight">
              Prof. {facultyName}
            </h1>
            <p className="mt-2 text-sm opacity-90">{facultyData.department || "No department assigned"}</p>
          </div>

          {/* RIGHT STATS */}
          <div className="flex flex-wrap gap-3 md:gap-4">

            <div className="min-w-[110px] bg-white/20 px-4 py-3 rounded-lg text-center">
              <span className="text-xs block">Sections</span>
              <div className="text-lg font-bold">{totalSections}</div>
            </div>

            <div className="min-w-[140px] bg-yellow-400 text-[#003366] px-4 py-3 rounded-lg text-center font-bold">
              <span className="text-xs block">Classification</span>
              <div className="text-lg">{classification}</div>
            </div>

          </div>
        </div>
      </div>

    </div>
  );
};

export default FacultyHeader;
