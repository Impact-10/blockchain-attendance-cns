const fs = require("fs");
const path = require("path");
const { createGenesisBlock } = require("../modules/blockchain");
const { CLASSROOM_POLYGON } = require("../modules/policy");
const { ALLOWED_STUDENT_IDS } = require("../config/auth");

const DATA_FILE = path.join(__dirname, "../../data/state.json");
const DEFAULT_STUDENT_REGISTRY = [...ALLOWED_STUDENT_IDS];

function defaultState() {
  return {
    currentCodeHash: null,
    currentCodeExpiresAt: null,
    currentCodeIssuedAt: null,
    activeSessionId: null,
    sessions: [],
    studentRegistry: [...DEFAULT_STUDENT_REGISTRY],
    pendingRecords: [],
    finalizedRecords: [],
    usedNonces: [],
    blockchain: [createGenesisBlock()],
    overrideLogs: [],
    studentKeys: {},
    studentPublicKeys: {},
    facultyKeys: {},
    classroomBoundary: CLASSROOM_POLYGON,
    highCgpaStudents: ["S9001", "S9002"],
    highCgpaAllowedIps: ["127.0.0.1", "::1"]
  };
}

function ensureDataFile() {
  if (!fs.existsSync(path.dirname(DATA_FILE))) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultState(), null, 2), "utf8");
  }
}

function loadState() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw);
  const state = {
    ...defaultState(),
    ...parsed
  };

  if (!Array.isArray(state.studentRegistry)) {
    state.studentRegistry = [...DEFAULT_STUDENT_REGISTRY];
  }

  const allowedStudentSet = new Set(ALLOWED_STUDENT_IDS);
  state.studentRegistry = ALLOWED_STUDENT_IDS
    .filter((studentId) => state.studentRegistry.includes(studentId) || DEFAULT_STUDENT_REGISTRY.includes(studentId));

  if (state.studentPublicKeys && typeof state.studentPublicKeys === "object") {
    state.studentPublicKeys = Object.fromEntries(
      Object.entries(state.studentPublicKeys).filter(([studentId]) => allowedStudentSet.has(studentId))
    );
  }

  if (!state.studentPublicKeys || typeof state.studentPublicKeys !== "object") {
    state.studentPublicKeys = {};
  }

  if (state.studentKeys && typeof state.studentKeys === "object") {
    for (const [studentId, keyPair] of Object.entries(state.studentKeys)) {
      if (keyPair && keyPair.publicKey && !state.studentPublicKeys[studentId]) {
        state.studentPublicKeys[studentId] = keyPair.publicKey;
      }
    }
  }

  if (Array.isArray(state.highCgpaStudents)) {
    state.highCgpaStudents = state.highCgpaStudents.filter((studentId) => allowedStudentSet.has(studentId));
  } else {
    state.highCgpaStudents = [];
  }

  if ((!Array.isArray(state.sessions) || state.sessions.length === 0)
    && (state.pendingRecords.length || state.finalizedRecords.length)) {
    const mergedRecords = [...state.finalizedRecords, ...state.pendingRecords];
    state.sessions = [{
      id: "LEGACY-SESSION",
      issuedAt: mergedRecords[0]?.timestamp || new Date().toISOString(),
      expiresAt: mergedRecords[mergedRecords.length - 1]?.timestamp || new Date().toISOString(),
      status: "closed",
      codeHash: "legacy",
      records: mergedRecords
    }];
    state.activeSessionId = null;
  }

  return state;
}

function saveState(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

module.exports = {
  loadState,
  saveState
};
