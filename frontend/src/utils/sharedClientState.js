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
  "facultyLoadResetAt",
  STUDENT_BATCHES_KEY,
  STUDENT_SUBMISSION_LOGS_KEY,
  "studentMasterlist",
  "studentSections",
  CHAIRPERSON_REVIEW_KEY,
  STUDENT_PUBLISHED_GRADES_KEY,
  "graduatingStudents",
  "irregularSubjectAssignments",
  "encodingPeriod",
  "STUDENT_BATCHES_KEY",
  "STUDENT_SUBMISSION_LOGS_KEY",
];

const RESET_SEASON_SHARED_KEYS = [
  STUDENT_BATCHES_KEY,
  "studentSections",
  CHAIRPERSON_REVIEW_KEY,
  "irregularSubjectAssignments",
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

export const pullSharedClientState = async (keys = SHARED_CLIENT_STATE_KEYS) => {
  const responses = await Promise.allSettled(
    keys.map(async (key) => ({
      key,
      response: await fetchSharedClientState(key),
    }))
  );

  const responseMap = new Map(
    responses
      .filter((result) => result.status === "fulfilled" && result.value?.key)
      .map((result) => [result.value.key, result.value.response])
  );

  const remoteFacultyLoadResetAt = responseMap.get("facultyLoadResetAt")?.value;
  const localFacultyLoadResetAt = parseLocalValue("facultyLoadResetAt");
  const remoteResetTimestamp = Date.parse(String(remoteFacultyLoadResetAt || ""));
  const localResetTimestamp = Date.parse(String(localFacultyLoadResetAt || ""));
  const hasRemoteResetToken =
    Number.isFinite(remoteResetTimestamp) &&
    (!Number.isFinite(localResetTimestamp) ||
      remoteResetTimestamp > localResetTimestamp);

  const updatedKeys = [];

  if (hasRemoteResetToken) {
    RESET_SEASON_SHARED_KEYS.forEach((key) => {
      localStorage.removeItem(key);
      updatedKeys.push(key);
    });
  }

  for (const key of keys) {
    const response = responseMap.get(key);
    const localValue = parseLocalValue(key);

    if (!response) continue;

    if (
      response?.value === null ||
      response?.value === undefined ||
      (!hasMeaningfulLocalValue(response.value) &&
        hasMeaningfulLocalValue(localValue))
    ) {
      if (
        hasMeaningfulLocalValue(localValue) &&
        !(hasRemoteResetToken && RESET_SEASON_SHARED_KEYS.includes(key))
      ) {
        await saveSharedClientState(key, localValue);
        updatedKeys.push(key);
      }
      continue;
    }

    storeLocalValue(key, response.value);
    updatedKeys.push(key);
  }

  if (updatedKeys.includes(STUDENT_BATCHES_KEY)) {
    const batches = parseLocalValue(STUDENT_BATCHES_KEY);
    if (Array.isArray(batches)) {
      syncSectionedStudentsToStorage(batches);
    }
  }

  if (updatedKeys.length) {
    window.dispatchEvent(
      new CustomEvent("blockgo:shared-client-state-changed", {
        detail: { keys: [...new Set(updatedKeys)] },
      })
    );
  }

  return [...new Set(updatedKeys)];
};
