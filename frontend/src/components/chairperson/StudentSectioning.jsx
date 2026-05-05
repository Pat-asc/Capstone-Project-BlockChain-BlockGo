import React, { useEffect, useMemo, useState } from "react";

const AVAILABLE_YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const STUDENT_BATCHES_KEY = "chairperson_student_batches";
const YEAR_LEVEL_PREFIXES = { "1st Year": "1", "2nd Year": "2", "3rd Year": "3", "4th Year": "4" };

const getDefaultSectionName = (program, sectionCode) => {
  return `${program || "Section"} ${sectionCode}`;
};

const downloadStudentCsvFile = (students, filename) => {
  if (!students || students.length === 0) return;
  const headers = ["Student ID", "Last Name", "First Name", "Middle Initial", "Sex"];
  const rows = students.map((s) => [s.studentId, s.lastName, s.firstName, s.middleInitial, s.sex]);
  const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map((e) => e.join(",")).join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", filename || "section_roster.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const parseStudentIdSpreadsheet = (csvText) => {
  if (!csvText) return [];
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  const studentIdIdx = headers.findIndex((h) => h.includes("studentid") || h.includes("studentno") || h.includes("idnumber"));
  const lastNameIdx = headers.findIndex((h) => h.includes("lastname") || h.includes("surname"));
  const firstNameIdx = headers.findIndex((h) => h.includes("firstname") || h.includes("givenname"));
  const miIdx = headers.findIndex((h) => h.includes("mi") || h.includes("middleinitial"));
  const sexIdx = headers.findIndex((h) => h.includes("sex") || h.includes("gender"));

  const parsed = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(",").map((c) => c.trim());
    if (row.length === 0) continue;
    const studentId = studentIdIdx >= 0 ? row[studentIdIdx] : null;
    if (!studentId) continue;
    parsed.push({
      studentId,
      lastName: lastNameIdx >= 0 ? row[lastNameIdx] : "",
      firstName: firstNameIdx >= 0 ? row[firstNameIdx] : "",
      middleInitial: miIdx >= 0 ? row[miIdx] : "",
      sex: sexIdx >= 0 ? row[sexIdx] : "",
    });
  }
  return parsed;
};

const buildStudentName = (student) =>
  [student.lastName, student.firstName, student.middleInitial]
    .filter(Boolean)
    .join(", ")
    .replace(", ,", ",");

const compareStudentsByName = (left, right) => {
  const leftName = [
    left.lastName,
    left.firstName,
    left.middleInitial,
    left.studentId,
  ]
    .join(" ")
    .toLowerCase();
  const rightName = [
    right.lastName,
    right.firstName,
    right.middleInitial,
    right.studentId,
  ]
    .join(" ")
    .toLowerCase();

  return leftName.localeCompare(rightName);
};

const buildGeneratedSections = ({
  program,
  yearLevel,
  sectionCount,
}) => {
  const resolvedSectionCount = Math.max(sectionCount, 1);
  const yearPrefix = YEAR_LEVEL_PREFIXES[yearLevel] || "1";

  return Array.from({ length: resolvedSectionCount }, (_, index) => {
    const sectionCode = `${yearPrefix}-${index + 1}`;

    return {
      id: `${sectionCode}-${Date.now()}-${index}`,
      sectionCode,
      sectionName: getDefaultSectionName(program, sectionCode),
      yearLevel,
    };
  });
};

const sectionMatchesYearLevel = (section = {}, yearLevel = "1st Year") => {
  const yearPrefix = YEAR_LEVEL_PREFIXES[yearLevel] || "";

  if (section.yearLevel) {
    return section.yearLevel === yearLevel;
  }

  return !!yearPrefix && section.sectionCode?.startsWith(`${yearPrefix}-`);
};

const REMOVAL_REASONS = [
  "Duplicate student record",
  "Wrong program",
  "Not in final enrolled list",
  "Encoding error",
  "Other",
];

function StudentSectioning({ chairpersonDepartment, onSectioningSaved }) {
  const [batches, setBatches] = useState(() => {
    const saved = localStorage.getItem(STUDENT_BATCHES_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [selectedBatchKey, setSelectedBatchKey] = useState("");
  const [sectioningBatchYear, setSectioningBatchYear] = useState(() =>
    String(new Date().getFullYear())
  );
  const [selectedYearLevel, setSelectedYearLevel] = useState("1st Year");
  const [manualSectionCount, setManualSectionCount] = useState("1");
  const [selectedSectionCode, setSelectedSectionCode] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [lateStudent, setLateStudent] = useState({
    studentId: "",
    sex: "",
    lastName: "",
    firstName: "",
    middleInitial: "",
  });
  const [isSaving, setIsSaving] = useState(false);

  const [expandedFacultyId, setExpandedFacultyId] = useState(null);
  const [selectedReviewKey, setSelectedReviewKey] = useState("");
  const [facultyRows, setFacultyRows] = useState([]);

  useEffect(() => {
    const loadFacultyData = async () => {
      try {
        const token = localStorage.getItem("token");
        const headers = {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        };

        const facRes = await fetch("/api/Auth/faculty/approved", { headers });
        const facData = await facRes.json();

        if (facData.status === "Success") {
          const deptFaculties = facData.faculties.filter(
            (f) => f.department === chairpersonDepartment
          );

          // Fetch assigned sections for each faculty in the department
          const rows = await Promise.all(
            deptFaculties.map(async (faculty) => {
              const secRes = await fetch(
                `/api/Auth/faculty/${encodeURIComponent(faculty.email)}/assigned-sections`,
                { headers }
              );
              const secData = await secRes.json();
              const sections = secData.status === "Success" ? secData.sections : [];

              return {
                facultyId: faculty.email,
                facultyName: faculty.fullname,
                department: faculty.department,
                facultyEncodingStatus: "Pending", // Defaulting gracefully for sectioning view
                encodedSections: 0,
                completedSections: 0,
                submittedSections: 0,
                approvedSections: 0,
                forwardedSections: 0,
                statusDetails: { total: 0, counts: {} },
                sections: sections.map((sec) => ({
                  reviewKey: `${faculty.email}-${sec.section}`,
                  sectionName: `Section ${sec.yearLevel}-${sec.section}`,
                  subjectCode: sec.subject || "N/A",
                  schoolYear: new Date().getFullYear() + "-" + (new Date().getFullYear() + 1),
                  semester: "1st Semester",
                  progress: 0,
                  encodedCount: 0,
                  totalStudents: 0,
                  statusDetails: { total: 0, counts: {} },
                  reviewStatus: "pending",
                })),
              };
            })
          );

          setFacultyRows(rows);
        }
      } catch (error) {
        console.error("Failed to load faculty sections:", error);
      }
    };

    if (chairpersonDepartment) {
      loadFacultyData();
    }
  }, [chairpersonDepartment]);

  const getFacultyStatusClasses = (status) => {
    switch (status?.toLowerCase()) {
      case "completed": return "bg-emerald-100 text-emerald-700";
      case "in progress": return "bg-yellow-100 text-yellow-700";
      default: return "bg-slate-100 text-slate-700";
    }
  };

  const getReviewStatusClasses = (status) => {
    switch (status?.toLowerCase()) {
      case "approved": return "bg-emerald-100 text-emerald-700";
      case "returned": return "bg-red-100 text-red-700";
      case "forwarded": return "bg-blue-100 text-blue-700";
      case "submitted": return "bg-yellow-100 text-yellow-700";
      default: return "bg-slate-100 text-slate-700";
    }
  };

  const getReviewStatusLabel = (status) => {
    if (!status) return "Pending";
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const getChairActionLabel = (status) => {
    switch (status?.toLowerCase()) {
      case "submitted": return "Needs Review";
      case "approved": return "Ready to Forward";
      case "forwarded": return "Sent to Registrar";
      case "returned": return "Waiting for Faculty";
      default: return "Waiting for Submission";
    }
  };

  const STUDENT_STATUS_DETAILS = [
    { key: "failing", label: "Failing" },
    { key: "incomplete", label: "Incomplete" },
    { key: "dropped", label: "Dropped" }
  ];

  const onSelectSection = (section) => {
    setSelectedReviewKey(section.reviewKey);
  };

  const departmentBatches = useMemo(() => {
    return batches
      .filter(
        (batch) =>
          batch.program === chairpersonDepartment &&
          (batch.status || "Forwarded") === "Forwarded"
      )
      .sort(
        (left, right) =>
          new Date(right.submittedAt || 0) - new Date(left.submittedAt || 0)
      );
  }, [batches, chairpersonDepartment]);

  const departmentWorkspaces = useMemo(
    () => batches.filter((batch) => batch.program === chairpersonDepartment),
    [batches, chairpersonDepartment]
  );

  const savedSectioningWorkspace = departmentWorkspaces.find((batch) =>
    (batch.sectionPlans || []).some((section) =>
      sectionMatchesYearLevel(section, selectedYearLevel)
    )
  );
  const fallbackSectioningWorkspace =
    savedSectioningWorkspace ||
    departmentWorkspaces.find((batch) => (batch.sectionPlans || []).length > 0) ||
    null;
  const selectedBatch =
    departmentWorkspaces.find((batch) => batch.key === selectedBatchKey) ||
    (!selectedBatchKey ? fallbackSectioningWorkspace : null) ||
    null;
  const activeBatchKey = selectedBatchKey || selectedBatch?.key || "";
  const displayedBatchYear = selectedBatch?.batchYear || sectioningBatchYear;

  const sectionPlans = selectedBatch?.sectionPlans || [];
  const yearSectionPlans = sectionPlans.filter(
    (section) => sectionMatchesYearLevel(section, selectedYearLevel)
  );
  const students = selectedBatch?.students || [];
  const removedStudents = selectedBatch?.removedStudents || [];
  const selectedSection =
    yearSectionPlans.find((section) => section.sectionCode === selectedSectionCode) ||
    yearSectionPlans[0] ||
    null;

  const sectionSummaries = yearSectionPlans.map((section) => {
    const sectionStudents = students
      .filter(
        (student) =>
          student.sectionCode === section.sectionCode &&
          student.yearLevel === selectedYearLevel
      )
      .sort(compareStudentsByName);
    return {
      ...section,
      sectionName:
        section.sectionName ||
        getDefaultSectionName(selectedBatch?.program, section.sectionCode),
      assigned: sectionStudents.length,
      students: sectionStudents,
    };
  });

  const searchValue = studentSearch.trim().toLowerCase();
  const visibleSectionStudents = selectedSection
    ? students
        .filter(
          (student) =>
            student.sectionCode === selectedSection.sectionCode &&
            student.yearLevel === selectedYearLevel
        )
        .sort(compareStudentsByName)
        .filter((student) => {
          if (!searchValue) return true;

          const fullName = buildStudentName(student).toLowerCase();

          return (
            student.studentId.toLowerCase().includes(searchValue) ||
            fullName.includes(searchValue)
          );
        })
    : [];

  useEffect(() => {
    localStorage.setItem(STUDENT_BATCHES_KEY, JSON.stringify(batches));
  }, [batches]);

  const updateSelectedBatch = (updater) => {
    if (!activeBatchKey) return;

    setBatches((previousBatches) =>
      previousBatches.map((batch) =>
        batch.key === activeBatchKey ? updater(batch) : batch
      )
    );
  };

  const handleDownloadRegistrarCsv = (batch) => {
    const csvContent = batch.receivedCsvContent;

    if (!csvContent) {
      alert("This imported list has no registrar CSV content saved.");
      return;
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.setAttribute(
      "download",
      batch.fileName || `${batch.program}-${batch.batchYear}-registrar-list.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleGenerateSections = () => {
    if (!chairpersonDepartment) {
      alert("Please choose a department first.");
      return;
    }

    if (!/^\d{4}$/.test(sectioningBatchYear)) {
      alert("Enter a valid 4-digit batch year.");
      return;
    }

    const requestedSectionCount = Number(manualSectionCount);

    if (!Number.isInteger(requestedSectionCount) || requestedSectionCount <= 0) {
      alert("Enter how many sections to create.");
      return;
    }

    const workspaceKey = selectedBatch
      ? activeBatchKey
      : [chairpersonDepartment, sectioningBatchYear, "sectioning"].join("|");
    const createdAt = new Date().toISOString();
    const workspaceId = Number(createdAt.replace(/\D/g, "").slice(0, 13));
    const workspace =
      selectedBatch ||
      departmentWorkspaces.find((batch) => batch.key === workspaceKey) || {
        id: workspaceId,
        key: workspaceKey,
        program: chairpersonDepartment,
        batchYear: sectioningBatchYear,
        submittedTo: `${chairpersonDepartment} Chairperson`,
        fileName: "Chairperson sectioning workspace",
        submittedAt: createdAt,
        status: "Sectioning",
        students: [],
        sectionPlans: [],
        removedStudents: [],
      };
    const generatedSections = buildGeneratedSections({
      program: workspace.program,
      yearLevel: selectedYearLevel,
      sectionCount: requestedSectionCount,
    });

    const nextWorkspace = {
      ...workspace,
      importedCount: workspace.importedCount || workspace.students?.length || 0,
      sectionPlans: [
        ...(workspace.sectionPlans || []).filter(
          (section) => (section.yearLevel || "") !== selectedYearLevel
        ),
        ...generatedSections,
      ],
      students: workspace.students || [],
      lastSectionedAt: new Date().toISOString(),
    };

    setBatches((previousBatches) => [
      ...previousBatches.filter((batch) => batch.key !== workspaceKey),
      nextWorkspace,
    ]);
    setSelectedBatchKey(workspaceKey);
    setSectioningBatchYear(workspace.batchYear || sectioningBatchYear);
    setSelectedSectionCode(generatedSections[0]?.sectionCode || "");
  };

  const handleSectionNameChange = (sectionCode, sectionName) => {
    updateSelectedBatch((batch) => {
      const nextSectionPlans = (batch.sectionPlans || []).map((section) =>
        section.sectionCode === sectionCode ? { ...section, sectionName } : section
      );

      return {
        ...batch,
        sectionPlans: nextSectionPlans,
        students: (batch.students || []).map((student) =>
          student.sectionCode === sectionCode
            ? { ...student, sectionName }
            : student
        ),
      };
    });
  };

  const handleDeleteSection = (sectionCode) => {
    const section = sectionPlans.find((plan) => plan.sectionCode === sectionCode);
    const sectionName =
      section?.sectionName ||
      getDefaultSectionName(selectedBatch?.program, sectionCode);

    const confirmed = window.confirm(
      `Delete ${sectionName}? Students in this section will become unassigned.`
    );

    if (!confirmed) return;

    updateSelectedBatch((batch) => ({
      ...batch,
      sectionPlans: (batch.sectionPlans || []).filter(
        (plan) => plan.sectionCode !== sectionCode
      ),
      students: (batch.students || []).map((student) =>
        student.sectionCode === sectionCode
          ? {
              ...student,
              sectionCode: "",
              sectionName: "",
            }
          : student
      ),
      lastSectionedAt: new Date().toISOString(),
    }));

    if (selectedSectionCode === sectionCode) {
      const nextSection = yearSectionPlans.find(
        (plan) => plan.sectionCode !== sectionCode
      );
      setSelectedSectionCode(nextSection?.sectionCode || "");
    }
  };

  const handleMoveStudent = (studentId, sectionCode) => {
    const targetSection = sectionPlans.find(
      (section) => section.sectionCode === sectionCode
    );

    updateSelectedBatch((batch) => ({
      ...batch,
      students: (batch.students || []).map((student) =>
        student.studentId === studentId
          ? {
              ...student,
              yearLevel: sectionCode ? targetSection?.yearLevel || selectedYearLevel : "",
              sectionCode,
              sectionName: targetSection
                ? targetSection.sectionName ||
                  getDefaultSectionName(batch.program, targetSection.sectionCode)
                : "",
            }
          : student
      ),
      lastSectionedAt: new Date().toISOString(),
    }));
  };

  const handleStartRemoveStudent = (student) => {
    setPendingRemoval({
      studentId: student.studentId,
      studentName: buildStudentName(student),
      reason: REMOVAL_REASONS[0],
      note: "",
    });
  };

  const handleCancelRemoveStudent = () => {
    setPendingRemoval(null);
  };

  const handleConfirmRemoveStudent = () => {
    if (!pendingRemoval?.reason) {
      alert("Please choose a removal reason before removing a student.");
      return;
    }

    updateSelectedBatch((batch) => {
      const studentToRemove = (batch.students || []).find(
        (student) => student.studentId === pendingRemoval.studentId
      );

      if (!studentToRemove) return batch;

      return {
        ...batch,
        students: (batch.students || []).filter(
          (student) => student.studentId !== pendingRemoval.studentId
        ),
        removedStudents: [
          {
            ...studentToRemove,
            removedAt: new Date().toISOString(),
            removalReason: pendingRemoval.reason,
            removalNote: pendingRemoval.note.trim(),
            removedFromSectionCode: studentToRemove.sectionCode || "",
            removedFromSectionName: studentToRemove.sectionName || "",
          },
          ...(batch.removedStudents || []),
        ],
        lastSectionedAt: new Date().toISOString(),
      };
    });

    setPendingRemoval(null);
  };

  const handleRestoreStudent = (studentId) => {
    updateSelectedBatch((batch) => {
      const removedStudent = (batch.removedStudents || []).find(
        (student) => student.studentId === studentId
      );

      if (!removedStudent) return batch;

      const alreadyActive = (batch.students || []).some(
        (student) =>
          student.studentId.toLowerCase() === removedStudent.studentId.toLowerCase()
      );

      if (alreadyActive) {
        alert("This student ID already exists in the active roster.");
        return batch;
      }

      const originalSectionExists = (batch.sectionPlans || []).some(
        (section) => section.sectionCode === removedStudent.removedFromSectionCode
      );

      const restoredStudent = {
        studentId: removedStudent.studentId,
        sex: removedStudent.sex || "",
        lastName: removedStudent.lastName || "",
        firstName: removedStudent.firstName || "",
        middleInitial: removedStudent.middleInitial || "",
        yearLevel: originalSectionExists
          ? removedStudent.yearLevel || selectedYearLevel
          : "",
        sectionCode: originalSectionExists
          ? removedStudent.removedFromSectionCode
          : "",
        sectionName: originalSectionExists
          ? removedStudent.removedFromSectionName
          : "",
        isLateEnrollee: removedStudent.isLateEnrollee || false,
      };

      return {
        ...batch,
        students: [...(batch.students || []), restoredStudent],
        removedStudents: (batch.removedStudents || []).filter(
          (student) => student.studentId !== studentId
        ),
        lastSectionedAt: new Date().toISOString(),
      };
    });
  };

  const handleLateStudentChange = (field, value) => {
    setLateStudent((current) => ({ ...current, [field]: value }));
  };

  const handleAddLateStudent = () => {
    if (!selectedBatch) return;

    const studentId = lateStudent.studentId.trim();

    if (
      !studentId ||
      !lateStudent.sex ||
      !lateStudent.lastName.trim() ||
      !lateStudent.firstName.trim() ||
      !lateStudent.middleInitial.trim()
    ) {
      alert("Complete all late enrollee fields before adding the student.");
      return;
    }

    const duplicateStudent = students.some(
      (student) => student.studentId.toLowerCase() === studentId.toLowerCase()
    );

    if (duplicateStudent) {
      alert("This student ID is already in the roster.");
      return;
    }

    const targetSection = selectedSection || yearSectionPlans[0] || null;
    const nextStudent = {
      studentId,
      sex: lateStudent.sex,
      lastName: lateStudent.lastName.trim(),
      firstName: lateStudent.firstName.trim(),
      middleInitial: lateStudent.middleInitial.trim().slice(0, 2),
      yearLevel: targetSection ? targetSection.yearLevel || selectedYearLevel : "",
      sectionCode: targetSection?.sectionCode || "",
      sectionName: targetSection
        ? targetSection.sectionName ||
          getDefaultSectionName(selectedBatch.program, targetSection.sectionCode)
        : "",
      isLateEnrollee: true,
    };

    updateSelectedBatch((batch) => ({
      ...batch,
      students: [...(batch.students || []), nextStudent],
      lastSectionedAt: new Date().toISOString(),
    }));

    setLateStudent({
      studentId: "",
      sex: "",
      lastName: "",
      firstName: "",
      middleInitial: "",
    });
  };

  const handleDownloadSectionCsv = (sectionCode) => {
    if (!selectedBatch) return;

    const section = sectionPlans.find((plan) => plan.sectionCode === sectionCode);
    const sectionStudents = students
      .filter((student) => student.sectionCode === sectionCode)
      .sort(compareStudentsByName);

    if (!sectionStudents.length) {
      alert("No students are assigned to this section yet.");
      return;
    }

    downloadStudentCsvFile(
      sectionStudents,
      `${section?.sectionName || sectionCode}-${selectedBatch.batchYear}.csv`
    );
  };

  const handleUploadSectionCsv = (sectionCode, file) => {
    if (!selectedBatch || !file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      alert("Please upload the section roster in CSV format.");
      return;
    }

    const targetSection = sectionPlans.find(
      (section) => section.sectionCode === sectionCode
    );

    if (!targetSection) {
      alert("Selected section was not found.");
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

      const parsedById = new Map(
        parsedStudents.map((student) => [
          student.studentId.toLowerCase(),
          student,
        ])
      );
      const targetSectionName =
        targetSection.sectionName ||
        getDefaultSectionName(selectedBatch.program, targetSection.sectionCode);
      const targetYearLevel = targetSection.yearLevel || selectedYearLevel;
      const existingAssignedSectionById = new Map(
        (selectedBatch.students || []).map((student) => [
          student.studentId.toLowerCase(),
          student.sectionCode || "",
        ])
      );
      const skippedAssignedStudents = parsedStudents.filter((student) => {
        const assignedSection = existingAssignedSectionById.get(
          student.studentId.toLowerCase()
        );

        return assignedSection && assignedSection !== targetSection.sectionCode;
      });

      updateSelectedBatch((batch) => {
        const existingIds = new Set(
          (batch.students || []).map((student) => student.studentId.toLowerCase())
        );
        const updatedStudents = (batch.students || []).map((student) => {
          const parsedStudent = parsedById.get(student.studentId.toLowerCase());

          if (parsedStudent) {
            const isAlreadyInAnotherSection =
              student.sectionCode && student.sectionCode !== targetSection.sectionCode;

            if (isAlreadyInAnotherSection) {
              return student;
            }

            return {
              ...student,
              ...parsedStudent,
              yearLevel: targetYearLevel,
              sectionCode: targetSection.sectionCode,
              sectionName: targetSectionName,
            };
          }

          return student;
        });

        const newStudents = parsedStudents
          .filter(
            (student) => !existingIds.has(student.studentId.toLowerCase())
          )
          .map((student) => ({
            ...student,
            yearLevel: targetYearLevel,
            sectionCode: targetSection.sectionCode,
            sectionName: targetSectionName,
            addedFromSectionCsv: true,
          }));

        return {
          ...batch,
          students: [...updatedStudents, ...newStudents],
          lastSectionedAt: new Date().toISOString(),
        };
      });

      if (skippedAssignedStudents.length) {
        alert(
          `Section roster updated from CSV. ${skippedAssignedStudents.length} student ID(s) were already assigned to another section, so they were not moved.`
        );
        return;
      }

      alert("Section roster updated from CSV.");
    };

    reader.readAsText(file);
  };

  const handleSaveSectioning = async () => {
    if (!selectedBatch || !chairpersonDepartment) return;
    setIsSaving(true);
    const token = localStorage.getItem("token");
    
    try {
        for (const section of sectionSummaries) {
            if (!section.students || section.students.length === 0) continue;

            const yearLevelMatch = section.yearLevel.match(/\d+/);
            const yearLvl = yearLevelMatch ? yearLevelMatch[0] : "1";
            const sectionNum = section.sectionCode.split("-")[1] || "1";

            const createRes = await fetch("/api/Auth/sections", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    department: chairpersonDepartment,
                    yearLevel: yearLvl,
                    sectionNum: sectionNum,
                    subjectCode: `GEN-${section.sectionCode}`, 
                })
            });

            const createData = await createRes.json();
            const sectionId = createData.id;

            if (sectionId) {
                const csvHeaders = ["student_no", "last_name", "first_name", "mi", "sex"];
                const csvRows = section.students.map((s) => [s.studentId, s.lastName, s.firstName, s.middleInitial, s.sex]);
                const csvContent = [csvHeaders, ...csvRows].map(e => e.join(",")).join("\n");
                const blob = new Blob([csvContent], { type: "text/csv" });
                const formData = new FormData();
                formData.append("file", blob, `${section.sectionCode}.csv`);

                await fetch(`/api/Auth/sections/${sectionId}/enroll`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
            }
        }
        const remainingBatches = batches.filter((batch) => batch.key !== activeBatchKey);
        setBatches(remainingBatches);
        setSelectedBatchKey("");
        alert("Sections created and students enrolled successfully via API!");
        onSectioningSaved?.();
    } catch (error) {
        console.error("Failed to save sections to backend:", error);
        alert("An error occurred while saving to the backend. See console for details.");
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-slate-500 mb-1">
              IT Chairperson Section Generator
            </p>
            <h2 className="text-xl font-bold text-[#003366]">Year-Level Sectioning</h2>
            <p className="text-sm text-slate-500 mt-1">
              Work from the enrolled list forwarded by the registrar, generate
              sections per year level, update each roster from CSV, and save the
              final rosters for academic assignment.
            </p>
          </div>
          <button
            type="button"
            onClick={handleSaveSectioning}
            disabled={!selectedBatch || !sectionPlans.length || isSaving}
            className="rounded-lg bg-[#003366] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#00264d] disabled:opacity-50"
          >
            {isSaving ? "Saving to Database..." : "Save Final Rosters"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Imported Lists */}
        <div className="xl:col-span-1 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-xl font-bold text-[#003366] mb-4">Imported Lists</h2>
          <p className="text-slate-500 text-sm mb-4">
            Download the registrar-forwarded CSV file and arrange sections in
            Excel before uploading section rosters here.
          </p>

          <div className="space-y-3">
            {departmentBatches.length > 0 ? (
              departmentBatches.map((batch) => (
                <div
                  key={batch.key}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <p className="font-bold text-[#003366]">{batch.program}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Batch {batch.batchYear}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    {new Date(batch.submittedAt).toLocaleString("en-US")}
                  </p>
                  <span className="mt-3 inline-flex rounded-full bg-blue-100 text-blue-800 px-3 py-1 text-xs font-semibold">
                    {(batch.students || []).length} imported
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDownloadRegistrarCsv(batch)}
                    className="mt-3 w-full rounded-lg border border-[#003366] px-3 py-2 text-sm font-bold text-[#003366] hover:bg-[#003366] hover:text-white transition"
                  >
                    Download CSV
                  </button>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">
                No imported student list is available for this department.
              </div>
            )}
          </div>
        </div>

        <div className="xl:col-span-2 flex flex-col gap-6">
          {/* Section Generator */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-xl font-bold text-[#003366] mb-4">Section Generator</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                    Year level
                </label>
                  <select
                    value={selectedYearLevel}
                    onChange={(event) => {
                      const nextYearLevel = event.target.value;
                      const workspaceWithYear =
                        (selectedBatch?.sectionPlans || []).some((section) =>
                          sectionMatchesYearLevel(section, nextYearLevel)
                        )
                          ? selectedBatch
                          : departmentWorkspaces.find((batch) =>
                              (batch.sectionPlans || []).some((section) =>
                                sectionMatchesYearLevel(section, nextYearLevel)
                              )
                            );
                      const nextYearSection = (
                        workspaceWithYear?.sectionPlans || []
                      ).find((section) =>
                        sectionMatchesYearLevel(section, nextYearLevel)
                      );

                      setSelectedYearLevel(nextYearLevel);
                      if (workspaceWithYear?.key) {
                        setSelectedBatchKey(workspaceWithYear.key);
                        setSectioningBatchYear(
                          workspaceWithYear.batchYear || sectioningBatchYear
                        );
                      }
                      setSelectedSectionCode(nextYearSection?.sectionCode || "");
                    }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-[#003366]"
                  >
                    {AVAILABLE_YEAR_LEVELS.map((yearLevel) => (
                      <option key={yearLevel} value={yearLevel}>
                        {yearLevel}
                      </option>
                    ))}
                  </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                    Batch year
                </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={displayedBatchYear}
                    onChange={(event) =>
                      setSectioningBatchYear(
                        event.target.value.replace(/\D/g, "").slice(0, 4)
                      )
                    }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-[#003366]"
                  />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                    Number of sections
                </label>
                  <input
                    type="number"
                    min="1"
                    value={manualSectionCount}
                    onChange={(event) => setManualSectionCount(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 outline-none focus:border-[#003366]"
                  />
              </div>
            </div>
            <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={handleGenerateSections}
                className="rounded-lg bg-[#003366] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#00264d]"
                >
                  Generate Sections
                </button>
              </div>
          </div>

          {/* Section Preview */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-[#003366]">Section Preview</h2>
              <p className="text-slate-500 text-sm mt-1">
                    Review each generated section separately and edit section
                    names before saving the final rosters. Uploading a CSV here
                    replaces that section roster.
                  </p>
                </div>

              {sectionSummaries.length ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {sectionSummaries.map((section) => (
                  <div
                      key={section.sectionCode}
                      className={`rounded-xl border p-4 transition ${
                        selectedSection?.sectionCode === section.sectionCode
                        ? "border-[#003366] bg-blue-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setSelectedSectionCode(section.sectionCode)}
                          className="text-left"
                        >
                          <p className="text-sm font-semibold text-slate-500">
                            Section {section.sectionCode}
                          </p>
                        <p className="mt-1 text-lg font-bold text-[#003366]">
                            {section.sectionName}
                          </p>
                        </button>

                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                          {section.assigned} student
                          {section.assigned === 1 ? "" : "s"}
                        </span>
                      </div>

                      <input
                        type="text"
                        value={section.sectionName}
                        onChange={(event) =>
                          handleSectionNameChange(
                            section.sectionCode,
                            event.target.value
                          )
                        }
                      className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#003366]"
                        aria-label={`Edit ${section.sectionCode} section name`}
                      />

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedSectionCode(section.sectionCode)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                        >
                          View Roster
                        </button>
                      <label className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition">
                          Upload CSV
                          <input
                            type="file"
                            accept=".csv"
                            onChange={(event) => {
                              handleUploadSectionCsv(
                                section.sectionCode,
                                event.target.files?.[0]
                              );
                              event.target.value = "";
                            }}
                            className="hidden"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => handleDownloadSectionCsv(section.sectionCode)}
                        className="rounded-lg border border-[#003366] px-3 py-2 text-xs font-bold text-[#003366] hover:bg-[#003366] hover:text-white transition"
                        >
                          Export CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSection(section.sectionCode)}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-100 transition"
                        >
                          Delete
                        </button>
                      </div>
                  </div>
                  ))}
                </div>
              ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  Generate sections to preview students by section.
                </div>
              )}
          </div>
        </div>
      </div>

      {/* Section Roster */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-xl font-bold text-[#003366]">
                    {selectedSection
                      ? selectedSection.sectionName ||
                        getDefaultSectionName(
                          selectedBatch.program,
                          selectedSection.sectionCode
                        )
                      : "Section Roster"}
                  </h3>
            <p className="text-sm text-slate-500 mt-1">
                    Move students between generated sections, add late
                    enrollees, and remove duplicates or wrong entries.
                  </p>
                </div>

                <input
                  type="text"
                  value={studentSearch}
                  onChange={(event) => setStudentSearch(event.target.value)}
                  placeholder="Search this section..."
            className="w-full md:w-64 rounded-lg border border-slate-300 px-4 py-2 text-sm outline-none focus:border-[#003366]"
                />
              </div>

              {pendingRemoval ? (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                <p className="text-sm font-bold text-red-700">
                        Remove {pendingRemoval.studentName}
                      </p>
                <p className="mt-1 text-xs text-red-600">
                        This student will move to the removed students audit list.
                      </p>
                    </div>

              <div className="flex flex-wrap items-center gap-3">
                      <select
                        value={pendingRemoval.reason}
                        onChange={(event) =>
                          setPendingRemoval((current) => ({
                            ...current,
                            reason: event.target.value,
                          }))
                        }
                  className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-500"
                        aria-label="Removal reason"
                      >
                        {REMOVAL_REASONS.map((reason) => (
                          <option key={reason} value={reason}>
                            {reason}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={pendingRemoval.note}
                        onChange={(event) =>
                          setPendingRemoval((current) => ({
                            ...current,
                            note: event.target.value,
                          }))
                        }
                        placeholder="Optional note"
                        className="rounded-xl border border-red-200 bg-white px-4 py-3 text-sm outline-none focus:border-red-500"
                      />
                      <button
                        type="button"
                        onClick={handleCancelRemoveStudent}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmRemoveStudent}
                        className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-700"
                      >
                        Confirm Remove
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-[#003366] text-white">
                      <th className="px-4 py-3 text-left text-sm">Student ID</th>
                      <th className="px-4 py-3 text-left text-sm">Name</th>
                      <th className="px-4 py-3 text-left text-sm">Sex</th>
                      <th className="px-4 py-3 text-left text-sm">Section</th>
                      <th className="px-4 py-3 text-left text-sm">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSectionStudents.length > 0 ? (
                      visibleSectionStudents.map((student) => (
                        <tr key={student.studentId} className="border-b bg-white">
                          <td className="px-4 py-3 font-semibold text-slate-800">
                            {student.studentId}
                            {student.isLateEnrollee ? (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                                Late
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {buildStudentName(student)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {student.sex || "--"}
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={student.sectionCode || ""}
                              onChange={(event) =>
                                handleMoveStudent(student.studentId, event.target.value)
                              }
                              className="w-full min-w-44 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#003366]"
                            >
                              <option value="">Unassigned</option>
                              {sectionSummaries.map((section) => (
                                <option
                                  key={section.sectionCode}
                                  value={section.sectionCode}
                                >
                                  {section.sectionName}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => handleStartRemoveStudent(student)}
                              className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" className="py-8 text-center text-slate-500">
                          {selectedSection
                            ? "No students found in this section."
                            : "Generate sections to view section rosters."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-xl font-bold text-[#003366]">
                Add Student
              </h3>
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
                <input
                  type="text"
                  value={lateStudent.studentId}
                  onChange={(event) =>
                    handleLateStudentChange("studentId", event.target.value)
                  }
                  placeholder="Student ID"
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
                />
                <select
                  value={lateStudent.sex}
                  onChange={(event) =>
                    handleLateStudentChange("sex", event.target.value)
                  }
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
                >
                  <option value="">Sex</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
                <input
                  type="text"
                  value={lateStudent.lastName}
                  onChange={(event) =>
                    handleLateStudentChange("lastName", event.target.value)
                  }
                  placeholder="Last name"
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
                />
                <input
                  type="text"
                  value={lateStudent.firstName}
                  onChange={(event) =>
                    handleLateStudentChange("firstName", event.target.value)
                  }
                  placeholder="First name"
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
                />
                <input
                  type="text"
                  value={lateStudent.middleInitial}
                  onChange={(event) =>
                    handleLateStudentChange("middleInitial", event.target.value)
                  }
                  placeholder="M.I."
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
                />
                <button
                  type="button"
                  onClick={handleAddLateStudent}
                  disabled={!sectionPlans.length}
                  className="rounded-xl bg-[#003366] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#00264d] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Add Student
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5">
                <h3 className="text-xl font-bold text-[#003366]">
                  Removed Students
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Students removed from the final rosters stay here for audit
                  review and can be restored if needed.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="px-4 py-3 text-left text-sm">Student ID</th>
                      <th className="px-4 py-3 text-left text-sm">Name</th>
                      <th className="px-4 py-3 text-left text-sm">Previous Section</th>
                      <th className="px-4 py-3 text-left text-sm">Reason</th>
                      <th className="px-4 py-3 text-left text-sm">Removed At</th>
                      <th className="px-4 py-3 text-left text-sm">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {removedStudents.length > 0 ? (
                      removedStudents.map((student) => (
                        <tr key={`${student.studentId}-${student.removedAt}`} className="border-b bg-white">
                          <td className="px-4 py-3 font-semibold text-slate-800">
                            {student.studentId}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {buildStudentName(student)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {student.removedFromSectionName || "Unassigned"}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <p>{student.removalReason || "--"}</p>
                            {student.removalNote ? (
                              <p className="mt-1 text-xs text-slate-500">
                                {student.removalNote}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {student.removedAt
                              ? new Date(student.removedAt).toLocaleString("en-US")
                              : "--"}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => handleRestoreStudent(student.studentId)}
                              className="rounded-lg border border-[#003366] px-3 py-2 text-sm font-semibold text-[#003366] hover:bg-[#003366] hover:text-white"
                            >
                              Restore
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6" className="py-8 text-center text-slate-500">
                          No students have been removed from this batch.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

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
                      <tr className="border-b border-slate-100 bg-white hover:bg-slate-50">
                        <td className="p-3">
                              <p className="font-semibold text-slate-800">
                                {faculty.facultyName}
                              </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                                Faculty ID: {faculty.facultyId}
                              </p>
                            </td>
                        <td className="p-3 text-slate-700">{faculty.department}</td>
                        <td className="p-3">
                              <p className="font-semibold text-slate-800">
                                {faculty.encodedSections} of {faculty.sections.length} sections
                                started
                              </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                                {faculty.completedSections} completed
                              </p>
                            </td>
                        <td className="p-3">
                              <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${getFacultyStatusClasses(
                                  faculty.facultyEncodingStatus
                                )}`}
                              >
                                {faculty.facultyEncodingStatus}
                              </span>
                            </td>
                        <td className="p-3 text-sm text-slate-600">
                              {faculty.submittedSections} submitted,{" "}
                              {faculty.approvedSections} approved,{" "}
                              {faculty.forwardedSections} forwarded
                              {faculty.statusDetails.total > 0 ? (
                            <p className="mt-1 text-xs font-bold text-red-600">
                                  {faculty.statusDetails.total} student status alert
                                  {faculty.statusDetails.total === 1 ? "" : "s"}
                                </p>
                              ) : null}
                            </td>
                        <td className="p-3">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedFacultyId(isExpanded ? null : faculty.facultyId)
                                }
                            className="rounded-lg bg-[#003366] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#00264d]"
                              >
                                {isExpanded ? "Hide Sections" : "View Sections"}
                              </button>
                            </td>
                          </tr>

                          {isExpanded ? (
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <td colSpan="6" className="p-4">
                            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                              <table className="w-full text-left border-collapse">
                                    <thead>
                                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 uppercase tracking-wide">
                                    <th className="p-3">Section</th>
                                    <th className="p-3">Encoding</th>
                                    <th className="p-3">Student Status Details</th>
                                    <th className="p-3">Chairperson Review</th>
                                    <th className="p-3">Workflow State</th>
                                    <th className="p-3">Action</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {faculty.sections.map((section) => {
                                        const isActive =
                                          selectedReviewKey === section.reviewKey;

                                        return (
                                          <tr
                                            key={section.reviewKey}
                                        className={`border-b border-slate-100 last:border-b-0 ${
                                          isActive ? "bg-blue-50" : "bg-white hover:bg-slate-50"
                                            }`}
                                          >
                                        <td className="p-3">
                                              <p className="font-medium text-slate-800">
                                                {section.sectionName}
                                              </p>
                                          <p className="text-xs text-slate-500 mt-0.5">
                                                {section.subjectCode} |{" "}
                                                {section.schoolYear} |{" "}
                                                {section.semester}
                                              </p>
                                            </td>
                                        <td className="p-3">
                                              <p className="font-semibold text-slate-800">
                                                {section.progress}% complete
                                              </p>
                                          <p className="text-xs text-slate-500 mt-0.5">
                                                {section.encodedCount} of{" "}
                                                {section.totalStudents} students encoded
                                              </p>
                                            </td>
                                        <td className="p-3">
                                              {section.statusDetails.total > 0 ? (
                                                <div className="flex flex-wrap gap-2">
                                                  {STUDENT_STATUS_DETAILS.map((status) =>
                                                    section.statusDetails.counts[
                                                      status.key
                                                    ] > 0 ? (
                                                      <span
                                                        key={status.key}
                                                    className="inline-flex rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-xs font-bold text-red-600"
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
                                            <span className="text-xs text-slate-400 font-medium">
                                                  None
                                                </span>
                                              )}
                                            </td>
                                        <td className="p-3">
                                              <span
                                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${getReviewStatusClasses(
                                                  section.reviewStatus
                                                )}`}
                                              >
                                                {getReviewStatusLabel(
                                                  section.reviewStatus
                                                )}
                                              </span>
                                            </td>
                                        <td className="p-3 text-xs text-slate-600 font-medium">
                                              {getChairActionLabel(section.reviewStatus)}
                                            </td>
                                        <td className="p-3">
                                              <button
                                                type="button"
                                                onClick={() => onSelectSection(section)}
                                            className="rounded-lg border border-[#003366] px-3 py-1.5 text-xs font-bold text-[#003366] transition hover:bg-[#003366] hover:text-white"
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
                  <td colSpan="6" className="p-6 text-center text-slate-500">
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

export default StudentSectioning;