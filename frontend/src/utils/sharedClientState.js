import {
  fetchSharedClientState,
  saveSharedClientState,
} from "../services/api";
import {
  STUDENT_BATCHES_KEY,
  STUDENT_SUBMISSION_LOGS_KEY,
  syncSectionedStudentsToStorage,
} from "./studentSectioningHelpers";
import { CHAIRPERSON_REVIEW_KEY } from "./chairpersonHelpers";
import { STUDENT_PUBLISHED_GRADES_KEY } from "./publishedGradesHelpers";

export const SHARED_CLIENT_STATE_KEYS = [
  STUDENT_BATCHES_KEY,
  STUDENT_SUBMISSION_LOGS_KEY,
  "studentMasterlist",
  "studentSections",
  "registrarAssignments",
  CHAIRPERSON_REVIEW_KEY,
  STUDENT_PUBLISHED_GRADES_KEY,
  "graduatingStudents",
  "irregularSubjectAssignments",
  "encodingPeriod",
  "facultyLoadResetAt",
];

const parseLocalValue = (key) => {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const storeLocalValue = (key, value) => {
  if (value === null || value === undefined) return;
  localStorage.setItem(
    key,
    typeof value === "string" ? value : JSON.stringify(value)
  );
};

const hasMeaningfulLocalValue = (value) => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
};

export const pushSharedClientState = async (keys = SHARED_CLIENT_STATE_KEYS) => {
  await Promise.all(
    keys.map(async (key) => {
      const value = parseLocalValue(key);
      if (value === null || value === undefined) return null;
      return saveSharedClientState(key, value);
    })
  );
};

export const pushSectioningSharedState = () =>
  pushSharedClientState([
    STUDENT_BATCHES_KEY,
    STUDENT_SUBMISSION_LOGS_KEY,
    "studentMasterlist",
    "studentSections",
    "graduatingStudents",
    "irregularSubjectAssignments",
  ]).catch((error) => console.warn("Shared sectioning sync failed:", error));

export const pushAssignmentsSharedState = () =>
  pushSharedClientState(["registrarAssignments"]).catch((error) =>
    console.warn("Shared assignment sync failed:", error)
  );

export const clearAllSharedClientState = async () => {
  const emptyDefaults = {
    [STUDENT_BATCHES_KEY]: [],
    [STUDENT_SUBMISSION_LOGS_KEY]: [],
    studentMasterlist: [],
    studentSections: [],
    registrarAssignments: [],
    [CHAIRPERSON_REVIEW_KEY]: {},
    [STUDENT_PUBLISHED_GRADES_KEY]: {},
    graduatingStudents: [],
    irregularSubjectAssignments: [],
    chairpersonStudentBatches: [],
    chairpersonSubmissionLogs: [],
    studentMasterlist: [],
    studentSections: [],
    [STUDENT_BATCHES_KEY]: [],
    [STUDENT_SUBMISSION_LOGS_KEY]: [],
    encodingPeriod: {
      semester: "2nd Semester",
      startDate: "",
      endDate: "",
      term: "midterm",
    },
    facultyLoadResetAt: new Date().toISOString(),
  };

  await Promise.all(
    Object.entries(emptyDefaults).map(async ([key, value]) => {
      localStorage.setItem(key, JSON.stringify(value));
      try {
        await saveSharedClientState(key, value);
      } catch (error) {
        console.warn(`Failed to clear shared state for key: ${key}`, error);
      }
    })
  );

  window.dispatchEvent(
    new CustomEvent("blockgo:shared-client-state-changed", {
      detail: { keys: Object.keys(emptyDefaults) },
    })
  );

  window.dispatchEvent(
    new CustomEvent("blockgo:system-setting-changed", {
      detail: {
        key: "encoding_period",
        value: emptyDefaults.encodingPeriod,
      },
    })
  );
};

export const pullSharedClientState = async (keys = SHARED_CLIENT_STATE_KEYS) => {
  const results = await Promise.allSettled(
    keys.map(async (key) => {
      const response = await fetchSharedClientState(key);
      const localValue = parseLocalValue(key);

      // Only push local state back to server if the server has NO record for this key (value is null)
      // and the client DOES have a meaningful value. 
      // This prevents "merging" local data back into an intentionally cleared (empty) server state.
      if (
        (response?.value === null || response?.value === undefined) &&
        hasMeaningfulLocalValue(localValue)
      ) {
        await saveSharedClientState(key, localValue);
        return key;
      }

      // If server has a value (even if it's empty like [] or {}), we accept it.
      if (response?.value !== null && response?.value !== undefined) {
        storeLocalValue(key, response.value);
        return key;
      }

      return null;
    })
  );

  const updatedKeys = results
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value);

  if (updatedKeys.includes(STUDENT_BATCHES_KEY)) {
    const batches = parseLocalValue(STUDENT_BATCHES_KEY);
    if (Array.isArray(batches)) {
      syncSectionedStudentsToStorage(batches);
    }
  }

  if (updatedKeys.length) {
    window.dispatchEvent(
      new CustomEvent("blockgo:shared-client-state-changed", {
        detail: { keys: updatedKeys },
      })
    );
  }

  return updatedKeys;
};
