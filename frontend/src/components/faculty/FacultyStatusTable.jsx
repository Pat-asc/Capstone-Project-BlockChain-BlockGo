import React from "react";

// Safe Fallback Helpers
const getChairActionLabel = () => "Review";
const getFacultyStatusClasses = () => "bg-slate-100 text-slate-800";
const getReviewStatusClasses = () => "bg-blue-100 text-blue-800";
const getReviewStatusLabel = (status) => status || "Pending";

function FacultyStatusTable({ rows = [], selectedReviewKey, onSelectSection }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-xl font-bold text-[#003366]">Faculty Encoding Monitoring</h3>
          <p className="mt-1 text-sm text-slate-500">
            Track who has not encoded yet, who already submitted to the chairperson, and which sections are approved or forwarded.
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="bg-[#003366] text-white">
              <th className="px-4 py-3 text-left text-sm">Faculty</th>
              <th className="px-4 py-3 text-left text-sm">Department</th>
              <th className="px-4 py-3 text-left text-sm">Section</th>
              <th className="px-4 py-3 text-left text-sm">Encoding</th>
              <th className="px-4 py-3 text-left text-sm">Faculty Status</th>
              <th className="px-4 py-3 text-left text-sm">Chairperson Review</th>
              <th className="px-4 py-3 text-left text-sm">Workflow State</th>
              <th className="px-4 py-3 text-left text-sm">Action</th>
            </tr>
          </thead>

          <tbody>
            {rows.length > 0 ? (
              rows.map((row) => {
                const isActive = selectedReviewKey === row.reviewKey;
                return (
                  <tr key={row.reviewKey} className={`border-b ${isActive ? "bg-blue-50" : "bg-white"}`}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{row.facultyName}</p>
                      <p className="text-xs text-slate-500">Faculty ID: {row.facultyId}</p>
                    </td>
                    <td className="px-4 py-3">{row.department}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{row.sectionName}</p>
                      <p className="text-xs text-slate-500">{row.subjectCode} | {row.schoolYear} | {row.semester}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{row.progress}% complete</p>
                      <p className="text-xs text-slate-500">{row.encodedCount} of {row.totalStudents} students</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getFacultyStatusClasses()}`}>{row.facultyEncodingStatus}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getReviewStatusClasses()}`}>{getReviewStatusLabel(row.reviewStatus)}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{getChairActionLabel()}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => onSelectSection(row)} className="rounded-xl bg-[#003366] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#00264d]">Review</button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr><td colSpan="8" className="py-8 text-center text-slate-500">No faculty sections found for this department yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export default FacultyStatusTable;