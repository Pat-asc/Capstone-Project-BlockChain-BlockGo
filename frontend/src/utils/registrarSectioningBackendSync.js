import {
  batchEnrollStudentsToSection,
  createSection,
  fetchDepartmentSections,
} from "../services/api";
import {
  YEAR_LEVEL_PREFIXES,
  buildCsvContent,
  getStudentMiddleName,
} from "./studentSectioningHelpers";

const yearLevelNumberFrom = (value = "", sectionCode = "") => {
  const text = String(value || "").trim();
  const directNumber = text.match(/[1-4]/)?.[0];
  if (directNumber) return directNumber;

  const labelEntry = Object.entries(YEAR_LEVEL_PREFIXES).find(
    ([label]) => label === value
  );
  if (labelEntry) return labelEntry[1];

  return String(sectionCode || "").match(/[1-4]/)?.[0] || "";
};

const sectionNumberFrom = (sectionCode = "") => {
  const parts = String(sectionCode || "").split("-");
  if (parts[1]) return parts[1].replace(/\D/g, "");
  return String(sectionCode || "").match(/\d+$/)?.[0] || "";
};

const normalizeSectionValue = (value = "") =>
  String(value || "").trim().replace(/\D/g, "");

const buildFullName = (student = {}) =>
  [
    student.firstName,
    getStudentMiddleName(student),
    student.lastName,
  ]
    .filter(Boolean)
    .join(" ") ||
  student.fullname ||
  student.name ||
  `Student ${student.studentId || ""}`.trim();

const buildEnrollmentFile = (students = [], sectionCode = "section") => {
  const rows = students.map((student) => [
    student.studentId || "",
    student.email || student.studentEmail || "",
    buildFullName(student),
    "",
  ]);
  const csv = buildCsvContent([
    ["student_id", "email", "full_name", "dob"],
    ...rows,
  ]);

  return new File([csv], `${sectionCode}-students.csv`, {
    type: "text/csv;charset=utf-8;",
  });
};

const findBackendSection = (sections = [], department = "", yearLevel = "", sectionNum = "") =>
  sections.find(
    (section) =>
      String(section.department || "") === String(department || "") &&
      normalizeSectionValue(section.yearLevel) === normalizeSectionValue(yearLevel) &&
      normalizeSectionValue(section.sectionNum) === normalizeSectionValue(sectionNum)
  );

const getDepartmentSections = async (department) => {
  const response = await fetchDepartmentSections(department);
  return response.data || response.sections || [];
};

export const syncSectioningBatchToBackend = async (batch = {}) => {
  const department = batch.program || "";
  const sectionPlans = batch.sectionPlans || [];

  if (!department || !sectionPlans.length) {
    return { sectionsSynced: 0, studentsSynced: 0 };
  }

  let backendSections = await getDepartmentSections(department);
  let sectionsSynced = 0;
  let studentsSynced = 0;

  for (const section of sectionPlans) {
    const yearLevel = yearLevelNumberFrom(section.yearLevel, section.sectionCode);
    const sectionNum = sectionNumberFrom(section.sectionCode);
    if (!yearLevel || !sectionNum) continue;

    let backendSection = findBackendSection(
      backendSections,
      department,
      yearLevel,
      sectionNum
    );

    if (!backendSection) {
      try {
        const created = await createSection({
          department,
          yearLevel,
          sectionNum,
        });
        sectionsSynced += 1;
        backendSection = {
          id: created.id,
          department,
          yearLevel,
          sectionNum,
        };
        backendSections = [...backendSections, backendSection];
      } catch (error) {
        backendSections = await getDepartmentSections(department);
        backendSection = findBackendSection(
          backendSections,
          department,
          yearLevel,
          sectionNum
        );
        if (!backendSection) throw error;
      }
    }

    const sectionStudents = (batch.students || []).filter(
      (student) =>
        student.sectionCode === section.sectionCode &&
        normalizeSectionValue(
          yearLevelNumberFrom(student.yearLevel || section.yearLevel, section.sectionCode)
        ) === normalizeSectionValue(yearLevel)
    );

    if (!backendSection?.id || !sectionStudents.length) continue;

    const enrollmentFile = buildEnrollmentFile(sectionStudents, section.sectionCode);
    await batchEnrollStudentsToSection(enrollmentFile, backendSection.id);
    studentsSynced += sectionStudents.length;
  }

  return { sectionsSynced, studentsSynced };
};

export const syncSectioningBatchesToBackend = async (batches = []) => {
  let sectionsSynced = 0;
  let studentsSynced = 0;

  for (const batch of batches) {
    const result = await syncSectioningBatchToBackend(batch);
    sectionsSynced += result.sectionsSynced;
    studentsSynced += result.studentsSynced;
  }

  return { sectionsSynced, studentsSynced };
};
