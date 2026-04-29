import React, { useMemo, useState } from "react";

// Safe Fallback Helpers
const computeGradeStatus = () => "Passed";
const getReviewStatusClasses = () => "bg-blue-50 text-blue-800";
const getReviewStatusLabel = (status) => status || "Pending";
const getGradeEquivalent = (grade) => grade;

function SectionReviewPanel({
  selectedSection,
  activeTerm,
  onSendBack,
  onApprove,
  onSubmitToRegistrar,
}) {
  const [draftNotes, setDraftNotes] = useState({});
  const note = selectedSection ? draftNotes[selectedSection.reviewKey] ?? selectedSection.reviewNote ?? "" : "";

  const rows = useMemo(() => {
    if (!selectedSection) return [];
    return selectedSection.students.map((student) => {
      const record = selectedSection.grades[student.studentId] || {};
      return {
        id: student.studentId || student.id,
        name: `${student.lastName || ""}, ${student.firstName || ""}`.replace(/^,\s*/, ""),
        midterm: record.midterm || "-",
        finals: record.finals || "-",
        finalAverage: record.finalAverage || "-",
        gradeEquivalent: getGradeEquivalent(record.finalAverage || "-"),
        standing: record.standing || "active",
        flagged: !!record.flagged,
        status: computeGradeStatus(),
      };
    });
  }, [selectedSection, activeTerm]);

  if (!selectedSection) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
        <h3 className="text-xl font-semibold text-[#003366]">Section Review Panel</h3>
        <p className="mt-2 text-sm text-slate-500">Select a faculty section to review grades.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-xl font-bold text-[#003366]">Section Review Details</h3>
            <p className="mt-1 text-sm text-slate-500">{selectedSection.facultyName} • {selectedSection.sectionName}</p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <span className={`inline-flex w-fit rounded-full px-4 py-2 text-sm font-semibold ${getReviewStatusClasses()}`}>{getReviewStatusLabel(selectedSection.reviewStatus)}</span>
            {selectedSection.ipfsCid ? (
              <a 
                  href={`http://127.0.0.1:5001/ipfs/bafybeiddnr2jz65byk67sjt6jsu6g7tueddr7odhzzpzli3rgudlbnc6iq/#/ipfs/${selectedSection.ipfsCid}`} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-100 shadow-sm"
              >
                   View Attached Source File
              </a>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-4 py-2 text-sm font-medium text-slate-400 shadow-sm">
                  No File Attached
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-[#003366]">Submitted Grades</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-[#003366] text-white">
                <th className="px-4 py-3 text-left text-sm">Student ID</th>
                <th className="px-4 py-3 text-left text-sm">Student Name</th>
                <th className="px-4 py-3 text-left text-sm">Midterm</th>
                <th className="px-4 py-3 text-left text-sm">Finals</th>
                <th className="px-4 py-3 text-left text-sm">Final Grade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b bg-white">
                  <td className="px-4 py-3">{row.id}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{row.name}</td>
                  <td className="px-4 py-3">{row.midterm}</td>
                  <td className="px-4 py-3">{row.finals}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{row.finalAverage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-[#003366]">Chairperson Decision</h3>
        <div className="mt-4">
          <label className="mb-2 block text-sm font-medium text-slate-700">Review Note</label>
          <textarea
            value={note}
            onChange={(event) => setDraftNotes((prev) => ({ ...prev, [selectedSection.reviewKey]: event.target.value }))}
            placeholder="Enter discrepancy or approval remark here..."
            className="min-h-[120px] w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
          />
        </div>
        <div className="mt-6 flex flex-col gap-3 md:flex-row">
          <button onClick={() => onSendBack(note)} className="rounded-xl bg-red-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-600">
            Send Back to Faculty
          </button>
          <button onClick={() => onApprove(note)} className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700">
            Approve Section
          </button>
          <button onClick={() => onSubmitToRegistrar(note)} className="rounded-xl bg-[#003366] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#00264d]">
            Forward to Registrar
          </button>
        </div>
      </div>
    </div>
  );
}
export default SectionReviewPanel;