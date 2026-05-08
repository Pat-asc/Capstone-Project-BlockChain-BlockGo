import React, { useMemo, useState } from "react";
import { facultyList } from "../../data/registrarData";
import {
  AVAILABLE_YEAR_LEVELS,
  STUDENT_BATCHES_KEY,
  downloadStudentCsvFile,
  getDefaultSectionName,
  parseStudentIdSpreadsheet,
} from "../../utils/studentSectioningHelpers";

const SEMESTER_OPTIONS = ["1st Semester", "2nd Semester", "Summer"];
const DAY_OPTIONS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const parseCsvRows = (csvText = "") => {
  const rows = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
        .map((value) => value.replace(/^"|"$/g, "").trim())
    );

  const [headers = [], ...dataRows] = rows;
  const normalizedHeaders = headers.map((header) =>
    header.toLowerCase().replace(/\s+/g, " ")
  );

  return dataRows.map((row) =>
    normalizedHeaders.reduce((record, header, index) => {
      record[header] = row[index] || "";
      return record;
    }, {})
  );
};

function AcademicAssignment({ chairpersonDepartment = "" }) {
  const [selectedFacultyId, setSelectedFacultyId] = useState("");
  const [selectedYearLevel, setSelectedYearLevel] = useState("1st Year");
  const [selectedSectionName, setSelectedSectionName] = useState("");
  const [subjectCode, setSubjectCode] = useState("");
  const [subjectTitle, setSubjectTitle] = useState("");
  const [units, setUnits] = useState("");
  const [semester, setSemester] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleDay, setScheduleDay] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [facultyLoadingFile, setFacultyLoadingFile] = useState(null);
  const [facultyLoadingPreview, setFacultyLoadingPreview] = useState([]);
  const [facultyLoadingErrors, setFacultyLoadingErrors] = useState([]);

  const [savedAssignments, setSavedAssignments] = useState(() => {
    const saved = localStorage.getItem("registrarAssignments");
    return saved ? JSON.parse(saved) : [];
  });

  const studentSections =
    JSON.parse(localStorage.getItem("studentSections")) || [];
  const studentBatches =
    JSON.parse(localStorage.getItem(STUDENT_BATCHES_KEY)) || [];

  const createdSections = studentBatches
    .filter((batch) => batch.status !== "Promoted")
    .flatMap((batch) =>
      (batch.sectionPlans || []).map((section) => {
        const sectionName =
          section.sectionName ||
          getDefaultSectionName(batch.program, section.sectionCode);
        const yearLevel = section.yearLevel || "";

        return {
          key: [
            batch.program,
            yearLevel,
            sectionName,
            batch.batchYear,
            batch.semester || "",
          ].join("|"),
          program: batch.program,
          yearLevel,
          section: sectionName,
          schoolYear: batch.batchYear,
          semester: batch.semester || "",
          students: (batch.students || [])
            .filter(
              (student) =>
                student.sectionCode === section.sectionCode &&
                (student.yearLevel || yearLevel) === yearLevel
            )
            .map((student) => ({
              studentId: student.studentId,
              sex: student.sex || "",
              firstName: student.firstName || "",
              lastName: student.lastName || "",
              middleInitial: student.middleInitial || "",
              studentType: student.studentType || "Regular",
              remarks: student.remarks || "",
              repeatedSubjects: student.repeatedSubjects || "",
              irregularSubjects: student.irregularSubjects || [],
            })),
        };
      })
    );
  const sectionOptions = [
    ...studentSections,
    ...createdSections.filter(
      (createdSection) =>
        !studentSections.some(
          (section) =>
            section.program === createdSection.program &&
            section.yearLevel === createdSection.yearLevel &&
            section.section === createdSection.section &&
            section.schoolYear === createdSection.schoolYear &&
            (section.semester || "") === (createdSection.semester || "")
        )
    ),
  ];

  const selectedProgram = chairpersonDepartment;

  const filteredFaculty = facultyList.filter(
    (faculty) => faculty.program === selectedProgram
  );

  const filteredSections = sectionOptions.filter(
    (section) =>
      section.program === selectedProgram &&
      section.yearLevel === selectedYearLevel
  );

  const selectedFaculty = facultyList.find(
    (faculty) => faculty.id === Number(selectedFacultyId)
  );

  const selectedSection = filteredSections.find(
    (section) => section.section === selectedSectionName
  );

  const selectedSectionStudents = selectedSection?.students || [];
  const selectedDaysText = scheduleDay;

  const resetForm = () => {
    setSelectedFacultyId("");
    setSelectedSectionName("");
    setSubjectCode("");
    setSubjectTitle("");
    setUnits("");
    setSemester("");
    setScheduleTime("");
    setScheduleDate("");
    setScheduleDay("");
    setSelectedFile(null);
  };

  const handleDownloadSectionTemplate = () => {
    if (!selectedSection) {
      alert("Please choose a section first.");
      return;
    }

    if (!selectedSectionStudents.length) {
      alert("This section has no students yet.");
      return;
    }

    downloadStudentCsvFile(
      selectedSectionStudents,
      `${selectedProgram}-${selectedSection?.schoolYear || "section"}-${selectedSectionName}.csv`
    );
  };

  const handleAssign = () => {
    if (
      !selectedProgram ||
      !selectedFacultyId ||
      !selectedSectionName ||
      !subjectCode.trim() ||
      !subjectTitle.trim() ||
      !units.trim() ||
      !semester.trim()
    ) {
      alert("Please complete the required fields.");
      return;
    }

    if (!selectedSection) {
      alert("Selected section was not found.");
      return;
    }

    if (!selectedFaculty) {
      alert("Selected faculty was not found.");
      return;
    }

    if (selectedFile && !selectedFile.name.toLowerCase().endsWith(".csv")) {
      alert("Please upload the section roster in CSV format.");
      return;
    }

    const saveAssignment = (rosterStudents, rosterFileName = "Created section roster") => {
      const alreadyExists = savedAssignments.some(
        (item) =>
          item.facultyId === Number(selectedFacultyId) &&
          item.sectionName === selectedSectionName &&
          item.schoolYear === selectedSection.schoolYear &&
          item.semester.toLowerCase() === semester.trim().toLowerCase() &&
          item.subjectCode.toLowerCase() === subjectCode.trim().toLowerCase()
      );

      if (alreadyExists) {
        alert("This faculty section load already exists.");
        return;
      }

      const newAssignment = {
        id: Date.now(),
        facultyId: Number(selectedFacultyId),
        facultyName: selectedFaculty.name,
        program: selectedProgram,
        sectionName: selectedSection.section,
        yearLevel: selectedSection.yearLevel,
        subjectCode: subjectCode.trim(),
        subjectTitle: subjectTitle.trim(),
        units: units.trim(),
        schedule: scheduleTime.trim(),
        date: scheduleDate,
        day: selectedDaysText,
        schoolYear: selectedSection.schoolYear,
        semester: semester.trim(),
        rosterFileName,
        rosterStudents,
        uploadedAt: new Date().toISOString(),
      };

      const updatedAssignments = [...savedAssignments, newAssignment];
      setSavedAssignments(updatedAssignments);
      localStorage.setItem(
        "registrarAssignments",
        JSON.stringify(updatedAssignments)
      );

      alert("Section distributed to faculty successfully.");
      resetForm();
    };

    if (!selectedFile) {
      if (!selectedSectionStudents.length) {
        alert("Selected section has no students to distribute.");
        return;
      }

      saveAssignment(selectedSectionStudents);
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      const text = event.target?.result;

      if (!text) {
        alert("Unable to read the uploaded CSV file.");
        return;
      }

      const parsedStudents = parseStudentIdSpreadsheet(text);

      if (!parsedStudents.length) {
        alert(
          "The section CSV must contain Student ID, Sex, Last Name, First Name, and Middle Initial columns with valid rows."
        );
        return;
      }

      saveAssignment(parsedStudents, selectedFile.name);
    };

    reader.readAsText(selectedFile);
  };

  const findSectionByName = (sectionName = "") =>
    sectionOptions.find(
      (section) =>
        section.program === selectedProgram &&
        section.section.toLowerCase() === sectionName.trim().toLowerCase()
    );

  const buildFacultyLoadingPreview = (rows) => {
    const previewRows = [];
    const errors = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const facultyName = row["faculty name"] || row.faculty || row.name;
      const rowSubjectTitle =
        row["subject title"] || row["subject name"] || row.subject;
      const rowSubjectCode = row["subject code"] || row.code;
      const sectionName = row.section || row["section name"];
      const rowSemester = row.semester || semester || "2nd Semester";
      const rowUnits = row.units || "3";
      const rowDate = row.date || "";
      const rowDay = row.day || "";
      const rowTime = row.time || row.schedule || "";

      if (!facultyName || !rowSubjectTitle || !rowSubjectCode || !sectionName) {
        errors.push(`Row ${rowNumber}: missing required loading fields.`);
        return;
      }

      const faculty = filteredFaculty.find(
        (item) => item.name.toLowerCase() === facultyName.trim().toLowerCase()
      );
      const section = findSectionByName(sectionName);

      if (!faculty) {
        errors.push(`Row ${rowNumber}: faculty "${facultyName}" was not found.`);
        return;
      }

      if (!section) {
        errors.push(`Row ${rowNumber}: section "${sectionName}" was not found.`);
        return;
      }

      const alreadyExists = savedAssignments.some(
        (item) =>
          item.facultyId === Number(faculty.id) &&
          item.sectionName === section.section &&
          item.schoolYear === section.schoolYear &&
          item.semester.toLowerCase() === rowSemester.trim().toLowerCase() &&
          item.subjectCode.toLowerCase() === rowSubjectCode.trim().toLowerCase()
      );

      if (alreadyExists) {
        errors.push(`Row ${rowNumber}: duplicate faculty loading skipped.`);
        return;
      }

      previewRows.push({
        id: `${rowNumber}-${faculty.id}-${section.section}-${rowSubjectCode}`,
        facultyId: Number(faculty.id),
        facultyName: faculty.name,
        program: selectedProgram,
        sectionName: section.section,
        yearLevel: section.yearLevel,
        subjectCode: rowSubjectCode.trim(),
        subjectTitle: rowSubjectTitle.trim(),
        units: rowUnits.trim(),
        schedule: rowTime.trim(),
        date: rowDate.trim(),
        day: rowDay.trim(),
        schoolYear: section.schoolYear,
        semester: rowSemester.trim(),
        rosterFileName: "Created section roster",
        rosterStudents: section.students || [],
      });
    });

    return { previewRows, errors };
  };

  const handleDownloadFacultyLoadingTemplate = () => {
    const template =
      "Faculty Name,Subject Title,Subject Code,Section,Units,Semester,Date,Day,Time\n" +
      "Juan Dela Cruz,Introduction to Computing,IT 101,BSIT 1-1,3,2nd Semester,,Monday,7:00 AM - 9:00 AM\n" +
      "Juan Dela Cruz,Computer Programming 1,IT 102,BSIT 1-2,3,2nd Semester,,Tuesday,10:00 AM - 12:00 PM";
    const blob = new Blob([template], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.setAttribute("download", "faculty-loading-template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportFacultyLoading = () => {
    if (!selectedProgram) {
      alert("No department selected for faculty loading.");
      return;
    }

    if (!facultyLoadingFile) {
      alert("Please choose a faculty loading CSV file.");
      return;
    }

    if (!facultyLoadingFile.name.toLowerCase().endsWith(".csv")) {
      alert("Please upload a CSV file.");
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      const rows = parseCsvRows(event.target?.result || "");
      const { previewRows, errors } = buildFacultyLoadingPreview(rows);

      setFacultyLoadingPreview(previewRows);
      setFacultyLoadingErrors(errors);

      if (!previewRows.length) {
        alert(
          `No valid faculty loading rows found.${
            errors.length ? `\n\n${errors.slice(0, 5).join("\n")}` : ""
          }`
        );
      }
    };

    reader.readAsText(facultyLoadingFile);
  };

  const handleConfirmFacultyLoading = () => {
    if (!facultyLoadingPreview.length) {
      alert("No faculty loading preview to distribute.");
      return;
    }

    const timestamp = Date.now();
    const importedAssignments = facultyLoadingPreview.map((item, index) => ({
      ...item,
      id: timestamp + index,
      uploadedAt: new Date().toISOString(),
    }));
    const updatedAssignments = [...savedAssignments, ...importedAssignments];

    setSavedAssignments(updatedAssignments);
    localStorage.setItem("registrarAssignments", JSON.stringify(updatedAssignments));
    setFacultyLoadingFile(null);
    setFacultyLoadingPreview([]);
    setFacultyLoadingErrors([]);
    alert(
      `${importedAssignments.length} faculty loading assignment${
        importedAssignments.length === 1 ? "" : "s"
      } distributed.`
    );
  };

  const handleDeleteAssignment = (id) => {
    const updatedAssignments = savedAssignments.filter((item) => item.id !== id);
    setSavedAssignments(updatedAssignments);
    localStorage.setItem(
      "registrarAssignments",
      JSON.stringify(updatedAssignments)
    );
  };

  const assignmentRows = useMemo(() => savedAssignments, [savedAssignments]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-xl font-bold text-[#003366]">Faculty Loading</h3>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Upload one CSV to assign multiple faculty subject loads at once.
              Use one row per subject and section.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadFacultyLoadingTemplate}
            className="rounded-xl border border-[#003366] px-4 py-2 text-sm font-semibold text-[#003366] hover:bg-[#003366] hover:text-white"
          >
            Download Template
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="shrink-0 text-sm font-medium text-slate-700">
                Faculty Loading CSV
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={(event) => {
                  setFacultyLoadingFile(event.target.files?.[0] || null);
                  setFacultyLoadingPreview([]);
                  setFacultyLoadingErrors([]);
                }}
                className="block w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-500 file:mr-10 file:border-0 file:border-r file:border-solid file:border-slate-300 file:bg-transparent file:pr-4 file:text-sm file:font-semibold file:text-slate-500"
              />
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {facultyLoadingFile
                ? `Selected file: ${facultyLoadingFile.name}`
                : "Required columns: Faculty Name, Subject Title, Subject Code, Section. Optional: Units, Semester, Date, Day, Time."}
            </p>
          </div>

          <button
            type="button"
            onClick={handleImportFacultyLoading}
            className="rounded-xl bg-[#003366] px-5 py-3 text-sm font-semibold text-white hover:bg-[#00264d]"
          >
            Preview Faculty Loading
          </button>
        </div>

        {(facultyLoadingPreview.length > 0 || facultyLoadingErrors.length > 0) ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h4 className="text-lg font-bold text-[#003366]">
                  Faculty Loading Preview
                </h4>
                <p className="mt-1 text-sm text-slate-500">
                  Review the rows before distributing them to faculty.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFacultyLoadingPreview([]);
                    setFacultyLoadingErrors([]);
                  }}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Clear Preview
                </button>
                <button
                  type="button"
                  onClick={handleConfirmFacultyLoading}
                  disabled={!facultyLoadingPreview.length}
                  className="rounded-xl bg-[#003366] px-4 py-2 text-sm font-semibold text-white hover:bg-[#00264d] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Confirm Distribution
                </button>
              </div>
            </div>

            {facultyLoadingErrors.length ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                {facultyLoadingErrors.slice(0, 5).map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full bg-white">
                <thead>
                  <tr className="bg-[#003366] text-white">
                    <th className="px-4 py-3 text-left text-sm">Faculty</th>
                    <th className="px-4 py-3 text-left text-sm">Subject</th>
                    <th className="px-4 py-3 text-left text-sm">Section</th>
                    <th className="px-4 py-3 text-left text-sm">Units</th>
                    <th className="px-4 py-3 text-left text-sm">Semester</th>
                    <th className="px-4 py-3 text-left text-sm">Schedule</th>
                  </tr>
                </thead>
                <tbody>
                  {facultyLoadingPreview.length ? (
                    facultyLoadingPreview.map((item) => (
                      <tr key={item.id} className="border-b">
                        <td className="px-4 py-3">{item.facultyName}</td>
                        <td className="px-4 py-3">
                          {item.subjectCode} - {item.subjectTitle}
                        </td>
                        <td className="px-4 py-3">{item.sectionName}</td>
                        <td className="px-4 py-3">{item.units || "--"}</td>
                        <td className="px-4 py-3">{item.semester || "--"}</td>
                        <td className="px-4 py-3">
                          {[item.date, item.day, item.schedule]
                            .filter(Boolean)
                            .join(" | ") || "--"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6" className="py-6 text-center text-slate-500">
                        No valid rows to preview.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-xl font-bold text-[#003366]">
          Manual Faculty Section Distribution
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          After sectioning students, distribute each created section to the
          assigned faculty together with the subject and schedule details for
          grade encoding. Upload a CSV only when you need to override the roster.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Faculty
            </label>
            <select
              value={selectedFacultyId}
              onChange={(e) => setSelectedFacultyId(e.target.value)}
              disabled={!selectedProgram}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100"
            >
              <option value="">Choose faculty</option>
              {filteredFaculty.map((faculty) => (
                <option key={faculty.id} value={faculty.id}>
                  {faculty.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Year Level
            </label>
            <select
              value={selectedYearLevel}
              onChange={(e) => {
                setSelectedYearLevel(e.target.value);
                setSelectedSectionName("");
              }}
              disabled={!selectedProgram}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100"
            >
              {AVAILABLE_YEAR_LEVELS.map((yearLevel) => (
                <option key={yearLevel} value={yearLevel}>
                  {yearLevel}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Section
            </label>
            <select
              value={selectedSectionName}
              onChange={(e) => setSelectedSectionName(e.target.value)}
              disabled={!selectedProgram}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-100"
            >
              <option value="">Choose section</option>
              {filteredSections.length ? (
                filteredSections.map((section, index) => (
                  <option
                    key={`${section.section}-${section.schoolYear}-${index}`}
                    value={section.section}
                  >
                    {section.section} - {section.yearLevel}
                  </option>
                ))
              ) : (
                <option value="" disabled>
                  No {selectedYearLevel} sections found
                </option>
              )}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Subject Code
            </label>
            <input
              type="text"
              value={subjectCode}
              onChange={(e) => setSubjectCode(e.target.value)}
              placeholder="e.g. IT 101"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Total Units
            </label>
            <input
              type="number"
              min="1"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder="e.g. 3"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm xl:max-w-32"
            />
          </div>

          <div className="md:col-span-2 xl:col-span-2">
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Subject Title
            </label>
            <input
              type="text"
              value={subjectTitle}
              onChange={(e) => setSubjectTitle(e.target.value)}
              placeholder="e.g. Introduction to Computing"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Semester
            </label>
            <select
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            >
              <option value="">Choose semester</option>
              {SEMESTER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Time (Optional)
            </label>
            <input
              type="text"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              placeholder="e.g. 7:00 AM - 9:00 AM"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Date (Optional)
            </label>
            <input
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Day (Optional)
            </label>
            <select
              value={scheduleDay}
              onChange={(e) => setScheduleDay(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
            >
              <option value="">Choose day</option>
              {DAY_OPTIONS.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2 xl:col-span-3">
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Optional Section CSV Override
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
            />
            <div className="mt-2 flex flex-col gap-2 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
              <span>
                {selectedFile
                  ? `Selected file: ${selectedFile.name}`
                  : "Leave blank to use the created section roster."}
              </span>

              <button
                type="button"
                onClick={handleDownloadSectionTemplate}
                className="rounded-xl border border-[#003366] px-4 py-2 font-semibold text-[#003366] transition hover:bg-[#003366] hover:text-white"
              >
                Export Current Section CSV
              </button>
            </div>
          </div>
        </div>

        {(selectedFaculty ||
          selectedSection ||
          subjectCode ||
          subjectTitle ||
          units ||
          semester ||
          scheduleTime ||
          scheduleDate ||
          selectedDaysText) && (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Faculty</p>
              <p className="mt-1 font-semibold text-slate-800">
                {selectedFaculty?.name || "--"}
              </p>
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Section</p>
              <p className="mt-1 font-semibold text-slate-800">
                {selectedSection?.section || "--"}
              </p>
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Year Level</p>
              <p className="mt-1 font-semibold text-slate-800">
                {selectedSection?.yearLevel || "--"}
              </p>
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Units</p>
              <p className="mt-1 font-semibold text-slate-800">
                {units || "--"}
              </p>
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Time</p>
              <p className="mt-1 font-semibold text-slate-800">
                {scheduleTime || "--"}
              </p>
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Date</p>
              <p className="mt-1 font-semibold text-slate-800">
                {scheduleDate || "--"}
              </p>
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Day</p>
              <p className="mt-1 font-semibold text-slate-800">
                {selectedDaysText || "--"}
              </p>
            </div>

            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Subject Code</p>
              <p className="mt-1 font-semibold text-slate-800">
                {subjectCode || "--"}
              </p>
            </div>

            <div className="rounded-xl bg-slate-50 p-4 md:col-span-2">
              <p className="text-sm text-slate-500">Semester</p>
              <p className="mt-1 font-semibold text-slate-800">
                {semester || "--"}
              </p>
            </div>

            <div className="rounded-xl bg-slate-50 p-4 md:col-span-3">
              <p className="text-sm text-slate-500">CSV Students Available</p>
              <p className="mt-1 font-semibold text-slate-800">
                {selectedSectionStudents.length || 0}
              </p>
            </div>

            <div className="rounded-xl bg-slate-50 p-4 md:col-span-2 xl:col-span-6">
              <p className="text-sm text-slate-500">Subject Title</p>
              <p className="mt-1 font-semibold text-slate-800">
                {subjectTitle || "--"}
              </p>
            </div>
          </div>
        )}

        <button
          onClick={handleAssign}
          className="mt-6 rounded-xl bg-[#003366] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#00264d]"
        >
          Distribute Section to Faculty
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold text-[#003366]">
          Distributed Faculty Sections
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          One faculty member can receive multiple section assignments, each with
          its own subject and schedule details.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-[#003366] text-white">
                <th className="px-4 py-3 text-left text-sm">Faculty</th>
                <th className="px-4 py-3 text-left text-sm">Section</th>
                <th className="px-4 py-3 text-left text-sm">Students</th>
                <th className="px-4 py-3 text-left text-sm">CSV File</th>
                <th className="px-4 py-3 text-left text-sm">Subject</th>
                <th className="px-4 py-3 text-left text-sm">Units</th>
                <th className="px-4 py-3 text-left text-sm">Semester</th>
                <th className="px-4 py-3 text-left text-sm">Date</th>
                <th className="px-4 py-3 text-left text-sm">Time</th>
                <th className="px-4 py-3 text-left text-sm">Day</th>
                <th className="px-4 py-3 text-left text-sm">Action</th>
              </tr>
            </thead>

            <tbody>
              {assignmentRows.length > 0 ? (
                assignmentRows.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="px-4 py-3">{item.facultyName}</td>
                    <td className="px-4 py-3">{item.sectionName}</td>
                    <td className="px-4 py-3">
                      {item.rosterStudents?.length || 0}
                    </td>
                    <td className="px-4 py-3">{item.rosterFileName || "--"}</td>
                    <td className="px-4 py-3">
                      {item.subjectCode} - {item.subjectTitle}
                    </td>
                    <td className="px-4 py-3">{item.units || "--"}</td>
                    <td className="px-4 py-3">{item.semester || "--"}</td>
                    <td className="px-4 py-3">{item.date || "--"}</td>
                    <td className="px-4 py-3">{item.schedule || "--"}</td>
                    <td className="px-4 py-3">{item.day || "--"}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDeleteAssignment(item.id)}
                        className="rounded-lg border border-red-200 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="11" className="py-6 text-center text-slate-500">
                    No uploaded section CSVs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default AcademicAssignment;
