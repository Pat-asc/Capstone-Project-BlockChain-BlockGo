import React, { useEffect, useMemo, useState } from "react";
import {
  AVAILABLE_YEAR_LEVELS,
  STUDENT_BATCHES_KEY,
  YEAR_LEVEL_PREFIXES,
  downloadStudentCsvFile,
  getDisplaySectionName,
  getDefaultSectionName,
  getStudentMiddleName,
  parseStudentIdSpreadsheet,
  syncSectionedStudentsToStorage,
} from "../../utils/studentSectioningHelpers";
import { syncSectioningBatchesToBackend } from "../../utils/registrarSectioningBackendSync";
import { pushSectioningSharedState } from "../../utils/sharedClientState";

const GRADUATING_STUDENTS_KEY = "graduatingStudents";
const IRREGULAR_SUBJECTS_KEY = "irregularSubjectAssignments";
const TARGET_SEMESTER = "1st Semester";
const REMOVAL_REASONS = [
  "Duplicate student record",
  "Wrong program",
  "Not in final enrolled list",
  "Encoding error",
  "Other",
];

const getStoredArray = (key) => {
  const saved = localStorage.getItem(key);
  return saved ? JSON.parse(saved) : [];
};

const buildStudentName = (student) => {
  const firstAndMiddle = [
    student.firstName,
    getStudentMiddleName(student),
  ]
    .filter(Boolean)
    .join(" ");

  return [student.lastName, firstAndMiddle].filter(Boolean).join(", ");
};

const sectionMatchesYearLevel = (section = {}, yearLevel = "1st Year") => {
  const yearPrefix = YEAR_LEVEL_PREFIXES[yearLevel] || "";

  if (section.yearLevel) return section.yearLevel === yearLevel;
  return !!yearPrefix && section.sectionCode?.startsWith(`${yearPrefix}-`);
};

const getNextYearLevel = (yearLevel = "") =>
  ({
    "1st Year": "2nd Year",
    "2nd Year": "3rd Year",
    "3rd Year": "4th Year",
  })[yearLevel] || "";

const getNextSectionCode = (sectionCode = "", nextYearLevel = "") => {
  const nextPrefix = YEAR_LEVEL_PREFIXES[nextYearLevel];
  const sectionNumber = String(sectionCode).split("-")[1];
  return nextPrefix && sectionNumber ? `${nextPrefix}-${sectionNumber}` : "";
};

const getCurrentRolloverBatches = (batches = []) => {
  const latestByProgramYear = {};

  batches
    .filter(
      (batch) =>
        batch.status !== "Promoted" &&
        (batch.students || []).length > 0 &&
        (batch.sectionPlans || []).length > 0
    )
    .forEach((batch) => {
      const key = [batch.program, batch.batchYear].join("|");
      const current = latestByProgramYear[key];
      const batchTime = new Date(batch.lastSectionedAt || batch.submittedAt || 0).getTime();
      const currentTime = new Date(
        current?.lastSectionedAt || current?.submittedAt || 0
      ).getTime();

      if (!current || batchTime > currentTime) {
        latestByProgramYear[key] = batch;
      }
    });

  return Object.values(latestByProgramYear);
};

function RegistrarSectionsCreated() {
  const [batches, setBatches] = useState(() => getStoredArray(STUDENT_BATCHES_KEY));
  const [graduatingStudents, setGraduatingStudents] = useState(() =>
    getStoredArray(GRADUATING_STUDENTS_KEY)
  );
  const [irregularAssignments, setIrregularAssignments] = useState(() =>
    getStoredArray(IRREGULAR_SUBJECTS_KEY)
  );
  const [activeDepartment, setActiveDepartment] = useState("");
  const [activeYearLevel, setActiveYearLevel] = useState("1st Year");
  const [selectedBatchKey, setSelectedBatchKey] = useState("");
  const [selectedSectionCode, setSelectedSectionCode] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [studentForm, setStudentForm] = useState({
    studentId: "",
    sex: "",
    lastName: "",
    firstName: "",
    middleName: "",
  });
  const [isEditingRoster, setIsEditingRoster] = useState(false);
  const [editingStudents, setEditingStudents] = useState({});
  const [promotionSummary, setPromotionSummary] = useState(null);
  const [changedDepartments, setChangedDepartments] = useState(() => new Set());

  const persistBatches = (nextBatches) => {
    setBatches(nextBatches);
    localStorage.setItem(STUDENT_BATCHES_KEY, JSON.stringify(nextBatches));
    syncSectionedStudentsToStorage(nextBatches);
    pushSectioningSharedState();
  };

  useEffect(() => {
    const handleSharedStateChanged = (event) => {
      const keys = event.detail?.keys || [];
      if (!keys.includes(STUDENT_BATCHES_KEY)) return;

      try {
        const saved = localStorage.getItem(STUDENT_BATCHES_KEY);
        setBatches(saved ? JSON.parse(saved) : []);
      } catch (error) {
        console.warn("Failed to refresh created sections from shared state.", error);
      }
    };

    window.addEventListener(
      "blockgo:shared-client-state-changed",
      handleSharedStateChanged
    );

    return () =>
      window.removeEventListener(
        "blockgo:shared-client-state-changed",
        handleSharedStateChanged
      );
  }, []);

  const markDepartmentChanged = (department) => {
    if (!department) return;
    setChangedDepartments((current) => {
      const nextDepartments = new Set(current);
      nextDepartments.add(department);
      return nextDepartments;
    });
  };

  const handleApplyDepartmentChanges = async () => {
    if (!selectedDepartment) return;

    localStorage.setItem(STUDENT_BATCHES_KEY, JSON.stringify(batches));
    syncSectionedStudentsToStorage(batches);
    pushSectioningSharedState();
    try {
      await syncSectioningBatchesToBackend(
        batches.filter((batch) => batch.program === selectedDepartment)
      );
      setChangedDepartments((current) => {
        const nextDepartments = new Set(current);
        nextDepartments.delete(selectedDepartment);
        return nextDepartments;
      });
      alert(`${selectedDepartment} section changes applied and synced.`);
    } catch (error) {
      alert(
        `Changes were saved locally, but backend sync failed: ${error.message || "Please try applying again."}`
      );
    }
  };

  const sectionedBatches = useMemo(
    () =>
      batches.filter(
        (batch) =>
          (batch.sectionPlans || []).length > 0 &&
          batch.status !== "Promoted"
      ),
    [batches]
  );

  const departments = useMemo(
    () => [...new Set(sectionedBatches.map((batch) => batch.program))].sort(),
    [sectionedBatches]
  );

  const selectedDepartment = activeDepartment || departments[0] || "";
  const departmentBatches = sectionedBatches.filter(
    (batch) => batch.program === selectedDepartment
  );
  const selectedBatch =
    departmentBatches.find((batch) => batch.key === selectedBatchKey) ||
    departmentBatches.find((batch) =>
      (batch.sectionPlans || []).some((section) =>
        sectionMatchesYearLevel(section, activeYearLevel)
      )
    ) ||
    departmentBatches[0] ||
    null;
  const yearSections = (selectedBatch?.sectionPlans || []).filter((section) =>
    sectionMatchesYearLevel(section, activeYearLevel)
  );
  const selectedSection =
    yearSections.find((section) => section.sectionCode === selectedSectionCode) ||
    yearSections[0] ||
    null;
  const sectionStudents = selectedSection
    ? (selectedBatch?.students || [])
        .filter(
          (student) =>
            student.sectionCode === selectedSection.sectionCode &&
            (student.yearLevel || activeYearLevel) === activeYearLevel
        )
        .sort((left, right) => buildStudentName(left).localeCompare(buildStudentName(right)))
    : [];
  const removedStudents = (selectedBatch?.removedStudents || []).filter(
    (student) =>
      !activeYearLevel ||
      student.yearLevel === activeYearLevel ||
      student.removedFromSectionCode?.startsWith(
        `${YEAR_LEVEL_PREFIXES[activeYearLevel]}-`
      )
  );
  const activeYearSectionCount = departmentBatches.reduce(
    (total, batch) =>
      total +
      (batch.sectionPlans || []).filter((section) =>
        sectionMatchesYearLevel(section, activeYearLevel)
      ).length,
    0
  );
  const hasActiveDepartmentChanges = changedDepartments.has(selectedDepartment);

  const updateSelectedBatch = (updater) => {
    if (!selectedBatch) return;
    persistBatches(
      batches.map((batch) => (batch.key === selectedBatch.key ? updater(batch) : batch))
    );
    markDepartmentChanged(selectedBatch.program);
  };

  const handleMoveStudent = (studentId, sectionCode) => {
    const targetSection = (selectedBatch?.sectionPlans || []).find(
      (section) => section.sectionCode === sectionCode
    );

    updateSelectedBatch((batch) => ({
      ...batch,
      students: (batch.students || []).map((student) =>
        student.studentId === studentId
          ? {
              ...student,
              yearLevel: targetSection?.yearLevel || activeYearLevel,
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

  const buildEditableRoster = () =>
    Object.fromEntries(
      sectionStudents.map((student) => [
        student.studentId,
        {
          studentId: student.studentId || "",
          sex: student.sex || "",
          lastName: student.lastName || "",
          firstName: student.firstName || "",
          middleName: getStudentMiddleName(student) || "",
          sectionCode: student.sectionCode || "",
        },
      ])
    );

  const handleStartRosterEdit = () => {
    if (!selectedSection) return;
    setEditingStudents(buildEditableRoster());
    setIsEditingRoster(true);
  };

  const handleCancelRosterEdit = () => {
    setIsEditingRoster(false);
    setEditingStudents({});
  };

  const handleRosterFieldChange = (studentId, field, value) => {
    setEditingStudents((current) => ({
      ...current,
      [studentId]: {
        ...(current[studentId] || {}),
        [field]: value,
      },
    }));
  };

  const handleSaveRosterEdit = () => {
    if (!selectedBatch || !selectedSection) return;

    const drafts = Object.values(editingStudents);
    if (!drafts.length) {
      handleCancelRosterEdit();
      return;
    }

    const seenStudentIds = new Set();
    for (const draft of drafts) {
      const trimmedStudentId = String(draft.studentId || "").trim();
      const trimmedLastName = String(draft.lastName || "").trim();
      const trimmedFirstName = String(draft.firstName || "").trim();
      const trimmedMiddleName = String(draft.middleName || "").trim();

      if (
        !trimmedStudentId ||
        !draft.sex ||
        !trimmedLastName ||
        !trimmedFirstName ||
        !trimmedMiddleName
      ) {
        alert("Complete student ID, sex, and name fields before saving.");
        return;
      }

      const normalizedStudentId = trimmedStudentId.toLowerCase();
      if (seenStudentIds.has(normalizedStudentId)) {
        alert("Duplicate student IDs found in the edited roster.");
        return;
      }
      seenStudentIds.add(normalizedStudentId);
    }

    updateSelectedBatch((batch) => {
      const selectedSectionStudentIds = new Set(
        (sectionStudents || []).map((student) => student.studentId)
      );

      return {
        ...batch,
        students: (batch.students || []).map((student) => {
          if (!selectedSectionStudentIds.has(student.studentId)) return student;

          const draft = editingStudents[student.studentId];
          if (!draft) return student;

          return {
            ...student,
            studentId: String(draft.studentId || "").trim(),
            sex: draft.sex,
            lastName: String(draft.lastName || "").trim(),
            firstName: String(draft.firstName || "").trim(),
            middleName: String(draft.middleName || "").trim(),
            middleInitial: String(draft.middleName || "").trim(),
            sectionCode: draft.sectionCode || student.sectionCode || "",
            sectionName:
              (yearSections.find((section) => section.sectionCode === draft.sectionCode)
                ?.sectionName) ||
              student.sectionName,
          };
        }),
        lastSectionedAt: new Date().toISOString(),
      };
    });

    handleCancelRosterEdit();
  };

  const handleDeleteSection = () => {
    if (!selectedBatch || !selectedSection) return;

    const sectionName =
      selectedSection.sectionName ||
      getDefaultSectionName(selectedBatch.program, selectedSection.sectionCode);
    const confirmed = window.confirm(
      `Delete ${sectionName}? This will remove the section and all students assigned to it.`
    );

    if (!confirmed) return;

    updateSelectedBatch((batch) => ({
      ...batch,
      sectionPlans: (batch.sectionPlans || []).filter(
        (section) => section.sectionCode !== selectedSection.sectionCode
      ),
      students: (batch.students || []).filter(
        (student) => student.sectionCode !== selectedSection.sectionCode
      ),
      removedStudents: (batch.removedStudents || []).filter(
        (student) =>
          student.removedFromSectionCode !== selectedSection.sectionCode
      ),
      lastSectionedAt: new Date().toISOString(),
    }));
    setSelectedSectionCode("");
    setPendingRemoval(null);
  };

  const handleExportSectionCsv = () => {
    if (!selectedBatch || !selectedSection) return;

    const sectionName =
      selectedSection.sectionName ||
      getDefaultSectionName(selectedBatch.program, selectedSection.sectionCode);

    if (!sectionStudents.length) {
      alert("No students are assigned to this section yet.");
      return;
    }

    downloadStudentCsvFile(
      sectionStudents,
      `${sectionName}-${selectedBatch.batchYear}.csv`
    );
  };

  const handleImportSectionCsv = () => {
    if (!selectedBatch || !selectedSection) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";

    input.onchange = (event) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith(".csv")) {
        alert("Please upload a CSV file.");
        return;
      }

      const reader = new FileReader();

      reader.onload = (readerEvent) => {
        const text = readerEvent.target?.result;
        const parsedStudents = parseStudentIdSpreadsheet(text || "");

        if (!parsedStudents.length) {
          alert(
            "The section CSV must contain Student ID, Sex, Last Name, First Name, and Middle Name columns with valid rows."
          );
          return;
        }

        const sectionYearLevel = selectedSection.yearLevel || activeYearLevel;
        const sectionName =
          selectedSection.sectionName ||
          getDefaultSectionName(selectedBatch.program, selectedSection.sectionCode);
        const existingSectionCount = (selectedBatch.students || []).filter(
          (student) =>
            student.sectionCode === selectedSection.sectionCode &&
            (student.yearLevel || sectionYearLevel) === sectionYearLevel
        ).length;
        const confirmed =
          existingSectionCount === 0 ||
          window.confirm(
            `Replace ${existingSectionCount} existing student${existingSectionCount === 1 ? "" : "s"} in ${sectionName}?`
          );

        if (!confirmed) return;

        const importedStudentIds = new Set(
          parsedStudents.map((student) => student.studentId.toLowerCase())
        );
        const importedStudents = parsedStudents.map((student) => ({
          ...student,
          yearLevel: sectionYearLevel,
          sectionCode: selectedSection.sectionCode,
          sectionName,
        }));

        updateSelectedBatch((batch) => ({
          ...batch,
          students: [
            ...(batch.students || []).filter((student) => {
              const sameTargetSection =
                student.sectionCode === selectedSection.sectionCode &&
                (student.yearLevel || sectionYearLevel) === sectionYearLevel;
              const duplicateImportedStudent = importedStudentIds.has(
                String(student.studentId || "").toLowerCase()
              );

              return !sameTargetSection && !duplicateImportedStudent;
            }),
            ...importedStudents,
          ],
          lastSectionedAt: new Date().toISOString(),
        }));
        alert(
          `${importedStudents.length} student${importedStudents.length === 1 ? "" : "s"} imported into ${sectionName}.`
        );
      };

      reader.readAsText(file);
    };

    input.click();
  };

  const handleConfirmRemoveStudent = () => {
    if (!pendingRemoval?.reason) {
      alert("Please choose a removal reason.");
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

      const restoredSectionExists = (batch.sectionPlans || []).some(
        (section) => section.sectionCode === removedStudent.removedFromSectionCode
      );

      return {
        ...batch,
        students: [
          ...(batch.students || []),
          {
            studentId: removedStudent.studentId,
            sex: removedStudent.sex || "",
            lastName: removedStudent.lastName || "",
            firstName: removedStudent.firstName || "",
            middleName: getStudentMiddleName(removedStudent),
            middleInitial: removedStudent.middleInitial || getStudentMiddleName(removedStudent),
            yearLevel: restoredSectionExists
              ? removedStudent.yearLevel || activeYearLevel
              : activeYearLevel,
            sectionCode: restoredSectionExists
              ? removedStudent.removedFromSectionCode
              : selectedSection?.sectionCode || "",
            sectionName: restoredSectionExists
              ? removedStudent.removedFromSectionName
              : selectedSection?.sectionName || "",
          },
        ],
        removedStudents: (batch.removedStudents || []).filter(
          (student) => student.studentId !== studentId
        ),
        lastSectionedAt: new Date().toISOString(),
      };
    });
  };

  const handleAddStudent = () => {
    if (!selectedBatch || !selectedSection) return;
    const studentId = studentForm.studentId.trim();

    if (
      !studentId ||
      !studentForm.sex ||
      !studentForm.lastName.trim() ||
      !studentForm.firstName.trim() ||
      !studentForm.middleName.trim()
    ) {
      alert("Complete all student fields before adding.");
      return;
    }

    const duplicate = (selectedBatch.students || []).some(
      (student) => student.studentId.toLowerCase() === studentId.toLowerCase()
    );
    if (duplicate) {
      alert("This student ID already exists in the roster.");
      return;
    }

    updateSelectedBatch((batch) => ({
      ...batch,
      students: [
        ...(batch.students || []),
        {
          studentId,
          sex: studentForm.sex,
          lastName: studentForm.lastName.trim(),
          firstName: studentForm.firstName.trim(),
          middleName: studentForm.middleName.trim(),
          middleInitial: studentForm.middleName.trim(),
          yearLevel: selectedSection.yearLevel || activeYearLevel,
          sectionCode: selectedSection.sectionCode,
          sectionName:
            selectedSection.sectionName ||
            getDefaultSectionName(batch.program, selectedSection.sectionCode),
        },
      ],
      lastSectionedAt: new Date().toISOString(),
    }));
    setStudentForm({
      studentId: "",
      sex: "",
      lastName: "",
      firstName: "",
      middleName: "",
    });
  };

  const handlePromoteStudents = () => {
    const rolloverBatches = getCurrentRolloverBatches(batches);
    if (!rolloverBatches.length) {
      alert("No saved section lists are ready for promotion.");
      return;
    }

    const confirmed = window.confirm(
      "Advance all sections across departments to the next academic year?"
    );
    if (!confirmed) return;

    const allPromotedStudents = [];
    const allGraduatingReviewList = [];
    const targetBatches = [];

    rolloverBatches.forEach((sourceBatch) => {
      const promotedStudents = [];
      const promotedSectionsByCode = new Map();
      const graduatingReviewList = [];

      (sourceBatch.students || []).forEach((student) => {
        const nextYearLevel = getNextYearLevel(student.yearLevel);
        const currentSectionCode = student.sectionCode || "";

        if (!nextYearLevel) {
          graduatingReviewList.push({
            ...student,
            program: sourceBatch.program,
            sourceBatchKey: sourceBatch.key,
            sourceSchoolYear: sourceBatch.batchYear,
            originBatchYear: sourceBatch.batchYear,
            originYearLevel: student.yearLevel,
            originSectionCode: student.sectionCode || "",
            originSectionName: student.sectionName || "",
            targetSchoolYear: sourceBatch.batchYear,
            targetSemester: TARGET_SEMESTER,
            status: "Incomplete",
            studentType: student.studentType || "Regular",
            irregularSubjects: student.irregularSubjects || [],
            reviewedAt: "",
          });
          return;
        }

        const nextSectionCode = getNextSectionCode(currentSectionCode, nextYearLevel);
        const nextSectionName = nextSectionCode
          ? getDefaultSectionName(sourceBatch.program, nextSectionCode)
          : "";

        if (nextSectionCode && !promotedSectionsByCode.has(nextSectionCode)) {
          promotedSectionsByCode.set(nextSectionCode, {
            id: `${sourceBatch.batchYear}-${TARGET_SEMESTER}-${nextSectionCode}`,
            sectionCode: nextSectionCode,
            sectionName: nextSectionName,
            yearLevel: nextYearLevel,
          });
        }

        promotedStudents.push({
          ...student,
          yearLevel: nextYearLevel,
          sectionCode: nextSectionCode,
          sectionName: nextSectionName,
          semester: TARGET_SEMESTER,
          originBatchYear: sourceBatch.batchYear,
          promotedFromBatchKey: sourceBatch.key,
          promotedAt: new Date().toISOString(),
        });
      });

      allPromotedStudents.push(...promotedStudents);
      allGraduatingReviewList.push(...graduatingReviewList);
      if (!promotedStudents.length) return;

      const createdAt = new Date().toISOString();
      targetBatches.push({
        id: Number(`${createdAt.replace(/\D/g, "").slice(0, 13)}${targetBatches.length}`),
        key: [sourceBatch.program, sourceBatch.batchYear, TARGET_SEMESTER, "promotion"].join("|"),
        program: sourceBatch.program,
        batchYear: sourceBatch.batchYear,
        semester: TARGET_SEMESTER,
        submittedTo: `${sourceBatch.program} Chairperson`,
        fileName: "Academic year promoted section list",
        submittedAt: createdAt,
        status: "Sectioning",
        students: promotedStudents,
        sectionPlans: Array.from(promotedSectionsByCode.values()),
        removedStudents: [],
        promotedFromBatchKey: sourceBatch.key,
        lastSectionedAt: createdAt,
      });
    });

    const targetBatchKeys = new Set(targetBatches.map((batch) => batch.key));
    const sourceBatchKeys = new Set(rolloverBatches.map((batch) => batch.key));
    const promotedToBySourceKey = Object.fromEntries(
      targetBatches.map((batch) => [batch.promotedFromBatchKey, batch.key])
    );
    const nextBatches = [
      ...batches.filter(
        (batch) => !targetBatchKeys.has(batch.key) && !sourceBatchKeys.has(batch.key)
      ),
      ...batches
        .filter((batch) => sourceBatchKeys.has(batch.key))
        .map((batch) => ({
          ...batch,
          status: "Promoted",
          promotedAt: new Date().toISOString(),
          promotedToBatchKey: promotedToBySourceKey[batch.key] || "",
        })),
      ...targetBatches,
    ];
    const nextGraduatingStudents = [...graduatingStudents, ...allGraduatingReviewList];
    const promotedStudentLookup = new Map(
      targetBatches.flatMap((batch) =>
        (batch.students || []).map((student) => [student.studentId, { batch, student }])
      )
    );
    const nextIrregularAssignments = irregularAssignments.map((assignment) => {
      const promotedRecord = promotedStudentLookup.get(assignment.studentId);
      if (!promotedRecord) return assignment;

      return {
        ...assignment,
        batchKey: promotedRecord.batch.key,
        mainBatchYear: promotedRecord.batch.batchYear,
        mainYearLevel: promotedRecord.student.yearLevel,
        mainSection: promotedRecord.student.sectionName || "",
        mainSectionCode: promotedRecord.student.sectionCode || "",
      };
    });

    persistBatches(nextBatches);
    setGraduatingStudents(nextGraduatingStudents);
    setIrregularAssignments(nextIrregularAssignments);
    localStorage.setItem(GRADUATING_STUDENTS_KEY, JSON.stringify(nextGraduatingStudents));
    localStorage.setItem(IRREGULAR_SUBJECTS_KEY, JSON.stringify(nextIrregularAssignments));
    setPromotionSummary({
      promoted: allPromotedStudents.length,
      sections: targetBatches.reduce(
        (total, batch) => total + (batch.sectionPlans || []).length,
        0
      ),
      graduating: allGraduatingReviewList.length,
      batches: rolloverBatches.length,
    });
    alert(`${allPromotedStudents.length} students promoted successfully.`);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-xl font-bold text-[#003366]">
              Year Level Progression
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasActiveDepartmentChanges ? (
              <button
                type="button"
                onClick={handleApplyDepartmentChanges}
                className="rounded-xl border border-emerald-400 px-5 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
              >
                Apply Changes
              </button>
            ) : null}
            <button
              type="button"
              onClick={handlePromoteStudents}
              className="rounded-xl bg-[#003366] px-5 py-3 text-sm font-semibold text-white hover:bg-[#00264d]"
            >
              Promote Academic Year
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h3 className="text-xl font-bold text-[#003366]">Sections Created</h3>
          </div>
        </div>

        {departments.length ? (
          <div className="mt-6 grid grid-cols-1 gap-5 2xl:grid-cols-[240px_1fr]">
            <aside className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-bold text-[#003366]">Departments</p>
              <div className="mt-3 space-y-3">
                <select
                  value={selectedDepartment}
                  onChange={(event) => {
                    setActiveDepartment(event.target.value);
                    setSelectedBatchKey("");
                    setSelectedSectionCode("");
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-[#003366]"
                >
                  {departments.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>

                {selectedDepartment ? (
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <p className="truncate text-sm font-bold text-slate-800">
                      {selectedDepartment}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {sectionedBatches
                        .filter((batch) => batch.program === selectedDepartment)
                        .reduce(
                          (total, batch) => total + (batch.sectionPlans || []).length,
                          0
                        )}{" "}
                      section
                      {sectionedBatches
                        .filter((batch) => batch.program === selectedDepartment)
                        .reduce(
                          (total, batch) => total + (batch.sectionPlans || []).length,
                          0
                        ) === 1
                        ? ""
                        : "s"}
                    </p>
                    {changedDepartments.has(selectedDepartment) ? (
                      <span className="mt-2 inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                        Changes pending
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </aside>

            <div className="space-y-5">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="bg-gradient-to-r from-[#003366] via-[#0a4b8f] to-[#0e7490] px-5 py-4 text-white">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                        Department Overview
                      </p>
                      <p className="mt-1 text-lg font-bold">
                        {selectedDepartment || "Choose a department"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-800">Year Level View</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative min-w-[240px]">
                      <select
                        value={activeYearLevel}
                        onChange={(event) => {
                          setActiveYearLevel(event.target.value);
                          setSelectedBatchKey("");
                          setSelectedSectionCode("");
                        }}
                        className="w-full appearance-none rounded-xl border border-slate-300 bg-white px-4 py-3 pr-10 text-sm font-semibold text-slate-700 outline-none focus:border-[#003366]"
                      >
                        {AVAILABLE_YEAR_LEVELS.map((yearLevel) => {
                          const yearCount = departmentBatches.reduce(
                            (total, batch) =>
                              total +
                              (batch.sectionPlans || []).filter((section) =>
                                sectionMatchesYearLevel(section, yearLevel)
                              ).length,
                            0
                          );

                          return (
                            <option key={yearLevel} value={yearLevel}>
                              {yearLevel} ({yearCount})
                            </option>
                          );
                        })}
                      </select>
                      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-slate-400">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="h-4 w-4"
                        >
                          <path
                            fillRule="evenodd"
                            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </span>
                    </div>
                    <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
                      {activeYearSectionCount} section
                      {activeYearSectionCount === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[220px_1fr]">
                <aside className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-bold text-[#003366]">Sections</p>
                  <div className="mt-3 space-y-3">
                    {departmentBatches.map((batch) => {
                      const batchSections = (batch.sectionPlans || []).filter(
                        (section) =>
                          sectionMatchesYearLevel(section, activeYearLevel)
                      );
                      if (!batchSections.length) return null;

                      return (
                        <div key={batch.key} className="rounded-xl bg-slate-50 p-3">
                          <p className="text-xs font-bold uppercase text-slate-500">
                            Batch {batch.batchYear}
                          </p>
                          <div className="mt-2 space-y-2">
                            {batchSections.map((section) => {
                              const sectionStudentCount = (batch.students || []).filter(
                                (student) =>
                                  student.sectionCode === section.sectionCode &&
                                  (student.yearLevel || activeYearLevel) ===
                                    activeYearLevel
                              ).length;
                              const isSelected =
                                selectedBatch?.key === batch.key &&
                                selectedSection?.sectionCode === section.sectionCode;

                              return (
                                <button
                                  key={section.sectionCode}
                                  type="button"
                                  onClick={() => {
                                    setSelectedBatchKey(batch.key);
                                    setSelectedSectionCode(section.sectionCode);
                                  }}
                                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                                    isSelected
                                      ? "border-[#003366] bg-[#003366] text-white"
                                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                                  }`}
                                  title={
                                    getDisplaySectionName(
                                      section.sectionName,
                                      getDefaultSectionName(
                                        batch.program,
                                        section.sectionCode
                                      )
                                    )
                                  }
                                >
                                  <span className="block truncate font-semibold">
                                    {getDisplaySectionName(
                                      section.sectionName,
                                      getDefaultSectionName(
                                        batch.program,
                                        section.sectionCode
                                      )
                                    )}
                                  </span>
                                  <span
                                    className={`mt-1 block text-xs ${
                                      isSelected ? "text-white/80" : "text-slate-500"
                                    }`}
                                  >
                                    {section.sectionCode} | {sectionStudentCount} student
                                    {sectionStudentCount === 1 ? "" : "s"}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {!activeYearSectionCount ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-500">
                        No sections for this year level.
                      </div>
                    ) : null}
                  </div>
                </aside>

                <main className="space-y-5">
                  <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-row flex-wrap items-start justify-between gap-3">
                      <div>
                        <h4 className="text-lg font-bold text-[#003366]">
                          {selectedSection
                            ? getDisplaySectionName(
                                selectedSection.sectionName,
                                getDefaultSectionName(
                                  selectedBatch.program,
                                  selectedSection.sectionCode
                                )
                              )
                            : "Select a section"}
                        </h4>
                        <p className="mt-1 text-sm text-slate-500">
                          {selectedSection
                            ? `${sectionStudents.length} student${
                                sectionStudents.length === 1 ? "" : "s"
                              } enrolled`
                            : "Choose a section from the left panel."}
                        </p>
                      </div>
                      {selectedSection ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {isEditingRoster ? (
                            <div className="flex flex-nowrap items-center gap-2">
                              <button
                                type="button"
                                onClick={handleSaveRosterEdit}
                                className="whitespace-nowrap rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                              >
                                Save Changes
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelRosterEdit}
                                className="whitespace-nowrap rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                Cancel Edit
                              </button>
                            </div>
                          ) : null}
                          <button
                            type="button"
                            onClick={handleExportSectionCsv}
                            disabled={isEditingRoster}
                            className="whitespace-nowrap rounded-lg border border-[#003366] px-4 py-2 text-sm font-semibold text-[#003366] hover:bg-[#003366] hover:text-white disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                          >
                            Export CSV
                          </button>
                          <button
                            type="button"
                            onClick={handleImportSectionCsv}
                            disabled={isEditingRoster}
                            className="whitespace-nowrap rounded-lg border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-transparent"
                          >
                            Import CSV
                          </button>
                          <button
                            type="button"
                            onClick={handleDeleteSection}
                            disabled={isEditingRoster}
                            className="whitespace-nowrap rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-transparent"
                          >
                            Delete Section
                          </button>
                          {!isEditingRoster ? (
                            <button
                              type="button"
                              onClick={handleStartRosterEdit}
                              className="whitespace-nowrap rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
                            >
                              Edit Students
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {isEditingRoster ? (
                      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        Edit mode is on. You can update student ID, full name, sex, and section placement before saving.
                      </div>
                    ) : null}

                    {pendingRemoval ? (
                      <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
                        <p className="text-sm font-semibold text-red-700">
                          Remove {pendingRemoval.studentName}
                        </p>
                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr_auto_auto]">
                          <select
                            value={pendingRemoval.reason}
                            onChange={(event) =>
                              setPendingRemoval((current) => ({
                                ...current,
                                reason: event.target.value,
                              }))
                            }
                            className="rounded-xl border border-red-200 bg-white px-4 py-3 text-sm outline-none focus:border-red-500"
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
                            onClick={() => setPendingRemoval(null)}
                            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleConfirmRemoveStudent}
                            className="rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white"
                          >
                            Confirm Remove
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 overflow-x-auto">
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
                          {sectionStudents.length ? (
                            sectionStudents.map((student) => {
                              const draft = editingStudents[student.studentId] || {
                                studentId: student.studentId || "",
                                sex: student.sex || "",
                                lastName: student.lastName || "",
                                firstName: student.firstName || "",
                                middleName: getStudentMiddleName(student) || "",
                                sectionCode: student.sectionCode || "",
                              };

                              return (
                                <tr key={student.studentId} className="border-b align-top">
                                  <td className="px-4 py-3 font-semibold text-slate-800">
                                    {isEditingRoster ? (
                                      <input
                                        type="text"
                                        value={draft.studentId}
                                        onChange={(event) =>
                                          handleRosterFieldChange(student.studentId, "studentId", event.target.value)
                                        }
                                        className="w-full min-w-28 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#003366]"
                                      />
                                    ) : (
                                      student.studentId
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-slate-700">
                                    {isEditingRoster ? (
                                      <div className="grid gap-2">
                                        <input
                                          type="text"
                                          value={draft.lastName}
                                          onChange={(event) =>
                                            handleRosterFieldChange(student.studentId, "lastName", event.target.value)
                                          }
                                          placeholder="Last name"
                                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#003366]"
                                        />
                                        <input
                                          type="text"
                                          value={draft.firstName}
                                          onChange={(event) =>
                                            handleRosterFieldChange(student.studentId, "firstName", event.target.value)
                                          }
                                          placeholder="First name"
                                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#003366]"
                                        />
                                        <input
                                          type="text"
                                          value={draft.middleName}
                                          onChange={(event) =>
                                            handleRosterFieldChange(student.studentId, "middleName", event.target.value)
                                          }
                                          placeholder="Middle name"
                                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#003366]"
                                        />
                                      </div>
                                    ) : (
                                      <p className="font-semibold text-slate-800">
                                        {buildStudentName(student)}
                                      </p>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-slate-600">
                                    {isEditingRoster ? (
                                      <select
                                        value={draft.sex}
                                        onChange={(event) =>
                                          handleRosterFieldChange(student.studentId, "sex", event.target.value)
                                        }
                                        className="w-full min-w-28 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#003366]"
                                      >
                                        <option value="">Sex</option>
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                      </select>
                                    ) : (
                                      student.sex || "--"
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    <select
                                      value={isEditingRoster ? draft.sectionCode : student.sectionCode || ""}
                                      onChange={(event) =>
                                        isEditingRoster
                                          ? handleRosterFieldChange(student.studentId, "sectionCode", event.target.value)
                                          : handleMoveStudent(
                                              student.studentId,
                                              event.target.value
                                            )
                                      }
                                      className="w-full min-w-44 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#003366]"
                                    >
                                      {yearSections.map((section) => (
                                        <option
                                          key={section.sectionCode}
                                          value={section.sectionCode}
                                        >
                                          {section.sectionName ||
                                            getDisplaySectionName(
                                              section.sectionName,
                                              getDefaultSectionName(
                                                selectedBatch.program,
                                                section.sectionCode
                                              )
                                            )}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-4 py-3">
                                    {isEditingRoster ? (
                                      <span className="text-sm font-medium text-slate-400">
                                        Editing
                                      </span>
                                    ) : (
                                      <div className="flex flex-wrap gap-2">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setPendingRemoval({
                                              studentId: student.studentId,
                                              studentName: buildStudentName(student),
                                              reason: REMOVAL_REASONS[0],
                                              note: "",
                                            })
                                          }
                                          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan="5" className="py-8 text-center text-slate-500">
                                {selectedSection
                                  ? "No students found in this section."
                                  : "Select a section to view students."}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {selectedSection ? (
                    <section className="rounded-xl border border-slate-200 bg-white p-4">
                      <h4 className="text-lg font-bold text-[#003366]">Add Student</h4>
                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                        <input
                          type="text"
                          value={studentForm.studentId}
                          onChange={(event) =>
                            setStudentForm((current) => ({
                              ...current,
                              studentId: event.target.value,
                            }))
                          }
                          placeholder="Student ID"
                          className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
                        />
                        <select
                          value={studentForm.sex}
                          onChange={(event) =>
                            setStudentForm((current) => ({
                              ...current,
                              sex: event.target.value,
                            }))
                          }
                          className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
                        >
                          <option value="">Sex</option>
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                        </select>
                        {[
                          ["lastName", "Last name"],
                          ["firstName", "First name"],
                          ["middleName", "Middle name"],
                        ].map(([field, placeholder]) => (
                          <input
                            key={field}
                            type="text"
                            value={studentForm[field]}
                            onChange={(event) =>
                              setStudentForm((current) => ({
                                ...current,
                                [field]: event.target.value,
                              }))
                            }
                            placeholder={placeholder}
                            className="rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#003366]"
                          />
                        ))}
                        <button
                          type="button"
                          onClick={handleAddStudent}
                          className="rounded-xl bg-[#003366] px-5 py-3 text-sm font-semibold text-white hover:bg-[#00264d]"
                        >
                          Add Student
                        </button>
                      </div>
                    </section>
                  ) : null}

                  <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <h4 className="text-lg font-bold text-[#003366]">
                      Removed Students
                    </h4>
                    <div className="mt-4 overflow-x-auto">
                      <table className="min-w-full">
                        <thead>
                          <tr className="bg-slate-800 text-white">
                            <th className="px-4 py-3 text-left text-sm">Student</th>
                            <th className="px-4 py-3 text-left text-sm">
                              Removed From
                            </th>
                            <th className="px-4 py-3 text-left text-sm">Reason</th>
                            <th className="px-4 py-3 text-left text-sm">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {removedStudents.length ? (
                            removedStudents.map((student) => (
                              <tr
                                key={`${student.studentId}-${student.removedAt}`}
                                className="border-b"
                              >
                                <td className="px-4 py-3">
                                  <p className="font-semibold text-slate-800">
                                    {student.studentId}
                                  </p>
                                  <p className="text-sm text-slate-500">
                                    {buildStudentName(student)}
                                  </p>
                                </td>
                                <td className="px-4 py-3 text-slate-700">
                                  {student.removedFromSectionName || "--"}
                                </td>
                                <td className="px-4 py-3 text-slate-700">
                                  {student.removalReason}
                                  {student.removalNote ? (
                                    <p className="mt-1 text-xs text-slate-500">
                                      {student.removalNote}
                                    </p>
                                  ) : null}
                                </td>
                                <td className="px-4 py-3">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleRestoreStudent(student.studentId)
                                    }
                                    className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                                  >
                                    Restore
                                  </button>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan="4" className="py-8 text-center text-slate-500">
                                No removed students for this year.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </main>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
            No registrar-created sections yet.
          </div>
        )}
      </section>
    </div>
  );
}

export default RegistrarSectionsCreated;
