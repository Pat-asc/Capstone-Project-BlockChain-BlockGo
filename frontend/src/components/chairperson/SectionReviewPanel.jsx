import React, { useMemo, useState } from "react";
import {
  computeGradeStatus,
  getReviewStatusClasses,
  getReviewStatusLabel,
} from "../../utils/chairpersonHelpers";
import { getGradeEquivalent } from "../../utils/gradingHelpers";

const formatLogDate = (value) => {
  if (!value) return "--";

  return new Date(value).toLocaleString();
};

function SectionReviewPanel({
  selectedSection,
  activeTerm,
  onSendBack,
  onApprove,
  onSubmitToRegistrar,
}) {
  const [draftNotes, setDraftNotes] = useState({});
  const note = selectedSection
    ? draftNotes[selectedSection.reviewKey] ?? selectedSection.reviewNote ?? ""
    : "";

  const rows = useMemo(() => {
    if (!selectedSection) return [];

    return selectedSection.students.map((student) => {
      const record =
        selectedSection.grades[student.studentId] ||
        selectedSection.grades[student.id] ||
        {};

      const numericMidterm = Number(record.midterm);
      const numericFinals = Number(record.finals);
      const finalAverage =
        Number.isFinite(numericMidterm) &&
        Number.isFinite(numericFinals) &&
        numericMidterm > 0 &&
        numericFinals > 0
          ? ((numericMidterm + numericFinals) / 2).toFixed(2)
          : "-";

      const gradeEquivalent =
        finalAverage !== "-" && !Number.isNaN(Number(finalAverage))
          ? getGradeEquivalent(Number(finalAverage))
          : finalAverage;

      return {
        id: student.studentId || student.id,
        name: `${student.lastName || ""}, ${student.firstName || ""}`.replace(
          /^,\s*/,
          ""
        ),
        midterm: record.midterm || "-",
        finals: record.finals || "-",
        finalAverage,
        gradeEquivalent,
        standing: record.standing || "active",
        flagged: !!record.flagged,
        status: computeGradeStatus(record, activeTerm),
      };
    });
  }, [selectedSection, activeTerm]);

  if (!selectedSection) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
        <h3 className="text-xl font-semibold text-[#003366]">Section Review Panel</h3>
        <p className="mt-2 text-sm text-slate-500">
          Select a faculty section from the monitoring table to review submitted grades,
          send corrections back, approve, or forward them to the registrar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-xl font-bold text-[#003366]">Section Review Details</h3>
            <p className="mt-1 text-sm text-slate-500">
              {selectedSection.facultyName} • {selectedSection.sectionName} •{" "}
              {selectedSection.schoolYear} • {selectedSection.semester}
            </p>
          </div>

          <span
            className={`inline-flex w-fit rounded-full px-4 py-2 text-sm font-semibold ${getReviewStatusClasses(
              selectedSection.reviewStatus
            )}`}
          >
            {getReviewStatusLabel(selectedSection.reviewStatus)}
          </span>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Department</p>
            <p className="mt-1 font-semibold text-slate-800">{selectedSection.department}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Students</p>
            <p className="mt-1 font-semibold text-slate-800">{selectedSection.totalStudents}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Encoded</p>
            <p className="mt-1 font-semibold text-slate-800">
              {selectedSection.encodedCount} / {selectedSection.totalStudents}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Progress</p>
            <p className="mt-1 font-semibold text-slate-800">{selectedSection.progress}%</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-bold text-[#003366]">Submitted Grades</h3>
            <p className="mt-1 text-sm text-slate-500">
              Review all grades encoded by the faculty member before making a chairperson decision.
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-[#003366] text-white">
                <th className="px-4 py-3 text-left text-sm">Student ID</th>
                <th className="px-4 py-3 text-left text-sm">Student Name</th>
                <th className="px-4 py-3 text-left text-sm">Midterm</th>
                <th className="px-4 py-3 text-left text-sm">Finals</th>
                <th className="px-4 py-3 text-left text-sm">Final Grade</th>
                <th className="px-4 py-3 text-left text-sm">Equivalent</th>
                <th className="px-4 py-3 text-left text-sm">Standing</th>
                <th className="px-4 py-3 text-left text-sm">Status</th>
                <th className="px-4 py-3 text-left text-sm">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={`border-b ${row.flagged ? "bg-red-50" : "bg-white"}`}>
                  <td className="px-4 py-3">{row.id}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{row.name}</td>
                  <td className="px-4 py-3">{row.midterm}</td>
                  <td className="px-4 py-3">{row.finals}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{row.finalAverage}</td>
                  <td className="px-4 py-3">{row.gradeEquivalent}</td>
                  <td className="px-4 py-3 capitalize">
                    {String(row.standing).replaceAll("_", " ")}
                  </td>
                  <td className="px-4 py-3 capitalize">
                    {String(row.status).replaceAll("_", " ")}
                  </td>
                  <td className="px-4 py-3">{row.flagged ? "Flagged by faculty" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-[#003366]">Chairperson Decision</h3>
        <p className="mt-1 text-sm text-slate-500">
          Add a review note when sending a section back to faculty, or keep remarks for the approval trail.
        </p>

        <div className="mt-4">
          <label className="mb-2 block text-sm font-medium text-slate-700">Review Note</label>
          <textarea
            value={note}
            onChange={(event) => {
              if (!selectedSection) return;

              setDraftNotes((prev) => ({
                ...prev,
                [selectedSection.reviewKey]: event.target.value,
              }));
            }}
            placeholder="Enter the discrepancy, correction request, or approval remark here..."
            className="min-h-[120px] w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
          />
        </div>

        <div className="mt-6 flex flex-col gap-3 md:flex-row">
          <button
            onClick={() => onSendBack(note)}
            disabled={!note.trim() || selectedSection.reviewStatus === "forwarded"}
            className="rounded-xl bg-red-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Send Back to Faculty
          </button>
          <button
            onClick={() => onApprove(note)}
            disabled={selectedSection.reviewStatus === "forwarded"}
            className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Approve Section
          </button>
          <button
            onClick={() => onSubmitToRegistrar(note)}
            disabled={selectedSection.reviewStatus !== "approved"}
            className="rounded-xl bg-[#003366] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#00264d] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Forward to Registrar
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-[#003366]">Decision Log</h3>
        <p className="mt-1 text-sm text-slate-500">
          Approval and send-back history for this section.
        </p>

        <div className="mt-4 space-y-3">
          {(selectedSection.reviewLogs || []).length ? (
            [...selectedSection.reviewLogs].reverse().map((log, index) => (
              <div
                key={`${log.timestamp}-${index}`}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <span
                    className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${getReviewStatusClasses(
                      log.status
                    )}`}
                  >
                    {getReviewStatusLabel(log.status)}
                  </span>
                  <p className="text-xs text-slate-500">
                    {formatLogDate(log.timestamp)}
                  </p>
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  {log.actor || "Chairperson"}
                </p>
                {log.note ? (
                  <p className="mt-1 text-sm text-slate-600">{log.note}</p>
                ) : (
                  <p className="mt-1 text-sm text-slate-400">No note added.</p>
                )}
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">
              No chairperson decision has been recorded yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SectionReviewPanel;
