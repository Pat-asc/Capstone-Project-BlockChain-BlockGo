import React, { useMemo, useState } from "react";
import {
  getChairActionLabel,
  getFacultyStatus,
  getFacultyStatusClasses,
  getReviewStatusClasses,
  getReviewStatusLabel,
} from "../../utils/chairpersonHelpers";

const STUDENT_STATUS_DETAILS = [
  { key: "dropped", label: "Dropped" },
  { key: "unofficially_dropped", label: "UD" },
  { key: "withdrawn", label: "Withdrawn" },
  { key: "incomplete", label: "INC" },
];

const getStudentStatusDetails = (section) => {
  const counts = STUDENT_STATUS_DETAILS.reduce(
    (acc, status) => ({ ...acc, [status.key]: 0 }),
    {}
  );

  (section.students || []).forEach((student) => {
    const studentId = student.studentId || student.id;
    const record =
      section.grades?.[studentId] ||
      section.grades?.[student.studentId] ||
      section.grades?.[student.id] ||
      {};
    const standing = record.standing;

    if (counts[standing] !== undefined) {
      counts[standing] += 1;
    }
  });

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return { counts, total };
};

function FacultyStatusTable({ rows, selectedReviewKey, onSelectSection }) {
  const [expandedFacultyId, setExpandedFacultyId] = useState(null);

  const facultyRows = useMemo(() => {
    const facultyMap = new Map();

    rows.forEach((row) => {
      const key = row.facultyId;
      const current = facultyMap.get(key) || {
        facultyId: row.facultyId,
        facultyName: row.facultyName,
        department: row.department,
        sections: [],
      };

      const statusDetails = getStudentStatusDetails(row);

      current.sections.push({
        ...row,
        statusDetails,
      });
      facultyMap.set(key, current);
    });

    return Array.from(facultyMap.values()).map((faculty) => {
      const encodedSections = faculty.sections.filter(
        (section) => section.encodedCount > 0
      ).length;
      const completedSections = faculty.sections.filter(
        (section) => section.progress >= 100
      ).length;
      const submittedSections = faculty.sections.filter(
        (section) => section.reviewStatus === "submitted"
      ).length;
      const approvedSections = faculty.sections.filter(
        (section) => section.reviewStatus === "approved"
      ).length;
      const forwardedSections = faculty.sections.filter(
        (section) => section.reviewStatus === "forwarded"
      ).length;

      const statusDetails = faculty.sections.reduce(
        (acc, section) => {
          STUDENT_STATUS_DETAILS.forEach((status) => {
            acc.counts[status.key] += section.statusDetails.counts[status.key];
          });
          acc.total += section.statusDetails.total;
          return acc;
        },
        {
          counts: STUDENT_STATUS_DETAILS.reduce(
            (acc, status) => ({ ...acc, [status.key]: 0 }),
            {}
          ),
          total: 0,
        }
      );

      return {
        ...faculty,
        sections: [...faculty.sections].sort((left, right) => {
          if (right.statusDetails.total !== left.statusDetails.total) {
            return right.statusDetails.total - left.statusDetails.total;
          }

          return right.encodedCount - left.encodedCount;
        }),
        encodedSections,
        completedSections,
        submittedSections,
        approvedSections,
        forwardedSections,
        statusDetails,
        facultyEncodingStatus: getFacultyStatus({
          encodedSections,
          totalSections: faculty.sections.length,
        }),
      };
    });
  }, [rows]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-xl font-bold text-[#003366]">
            Faculty Encoding Monitoring
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Track who has not encoded yet, who already submitted to the
            chairperson, and which sections are approved or forwarded to the
            registrar.
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="bg-[#003366] text-white">
              <th className="px-4 py-3 text-left text-sm">Faculty</th>
              <th className="px-4 py-3 text-left text-sm">Department</th>
              <th className="px-4 py-3 text-left text-sm">Sections</th>
              <th className="px-4 py-3 text-left text-sm">Faculty Status</th>
              <th className="px-4 py-3 text-left text-sm">Review Summary</th>
              <th className="px-4 py-3 text-left text-sm">Action</th>
            </tr>
          </thead>

          <tbody>
            {facultyRows.length > 0 ? (
              facultyRows.map((faculty) => {
                const isExpanded = expandedFacultyId === faculty.facultyId;

                return (
                  <React.Fragment key={faculty.facultyId}>
                    <tr className="border-b bg-white">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800">
                          {faculty.facultyName}
                        </p>
                        <p className="text-xs text-slate-500">
                          Faculty ID: {faculty.facultyId}
                        </p>
                      </td>
                      <td className="px-4 py-3">{faculty.department}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800">
                          {faculty.encodedSections} of {faculty.sections.length} sections
                          started
                        </p>
                        <p className="text-xs text-slate-500">
                          {faculty.completedSections} completed
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getFacultyStatusClasses(
                            faculty.facultyEncodingStatus
                          )}`}
                        >
                          {faculty.facultyEncodingStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {faculty.submittedSections} submitted,{" "}
                        {faculty.approvedSections} approved,{" "}
                        {faculty.forwardedSections} forwarded
                        {faculty.statusDetails.total > 0 ? (
                          <p className="mt-1 text-xs font-semibold text-red-600">
                            {faculty.statusDetails.total} student status alert
                            {faculty.statusDetails.total === 1 ? "" : "s"}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedFacultyId(isExpanded ? null : faculty.facultyId)
                          }
                          className="rounded-xl bg-[#003366] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#00264d]"
                        >
                          {isExpanded ? "Hide Sections" : "View Sections"}
                        </button>
                      </td>
                    </tr>

                    {isExpanded ? (
                      <tr className="border-b bg-slate-50">
                        <td colSpan="6" className="px-4 py-4">
                          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                            <table className="min-w-full">
                              <thead>
                                <tr className="bg-slate-100 text-slate-700">
                                  <th className="px-4 py-3 text-left text-sm">
                                    Section
                                  </th>
                                  <th className="px-4 py-3 text-left text-sm">
                                    Encoding
                                  </th>
                                  <th className="px-4 py-3 text-left text-sm">
                                    Student Status Details
                                  </th>
                                  <th className="px-4 py-3 text-left text-sm">
                                    Chairperson Review
                                  </th>
                                  <th className="px-4 py-3 text-left text-sm">
                                    Workflow State
                                  </th>
                                  <th className="px-4 py-3 text-left text-sm">
                                    Action
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {faculty.sections.map((section) => {
                                  const isActive =
                                    selectedReviewKey === section.reviewKey;

                                  return (
                                    <tr
                                      key={section.reviewKey}
                                      className={`border-b last:border-b-0 ${
                                        isActive ? "bg-blue-50" : "bg-white"
                                      }`}
                                    >
                                      <td className="px-4 py-3">
                                        <p className="font-medium text-slate-800">
                                          {section.sectionName}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                          {section.subjectCode} |{" "}
                                          {section.schoolYear} |{" "}
                                          {section.semester}
                                        </p>
                                      </td>
                                      <td className="px-4 py-3">
                                        <p className="font-semibold text-slate-800">
                                          {section.progress}% complete
                                        </p>
                                        <p className="text-xs text-slate-500">
                                          {section.encodedCount} of{" "}
                                          {section.totalStudents} students encoded
                                        </p>
                                      </td>
                                      <td className="px-4 py-3">
                                        {section.statusDetails.total > 0 ? (
                                          <div className="flex flex-wrap gap-2">
                                            {STUDENT_STATUS_DETAILS.map((status) =>
                                              section.statusDetails.counts[
                                                status.key
                                              ] > 0 ? (
                                                <span
                                                  key={status.key}
                                                  className="inline-flex rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700"
                                                >
                                                  {status.label}:{" "}
                                                  {
                                                    section.statusDetails.counts[
                                                      status.key
                                                    ]
                                                  }
                                                </span>
                                              ) : null
                                            )}
                                          </div>
                                        ) : (
                                          <span className="text-sm text-slate-400">
                                            None
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        <span
                                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getReviewStatusClasses(
                                            section.reviewStatus
                                          )}`}
                                        >
                                          {getReviewStatusLabel(
                                            section.reviewStatus
                                          )}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3 text-sm text-slate-600">
                                        {getChairActionLabel(section.reviewStatus)}
                                      </td>
                                      <td className="px-4 py-3">
                                        <button
                                          type="button"
                                          onClick={() => onSelectSection(section)}
                                          className="rounded-xl border border-[#003366] px-4 py-2 text-sm font-semibold text-[#003366] transition hover:bg-[#003366] hover:text-white"
                                        >
                                          Review Section
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan="6" className="py-8 text-center text-slate-500">
                  No faculty sections found for this department yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default FacultyStatusTable;
