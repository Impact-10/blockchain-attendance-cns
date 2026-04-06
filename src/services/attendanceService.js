const {
  sha256,
  generateAttendanceCode,
  generateNonce,
  normalizeCode,
  canonicalPayload,
  canonicalSubmissionPayload,
  generateStudentKeyPair,
  signHash,
  verifyHash,
  verifySignedPayload
} = require("../modules/crypto");
const { buildMerkleRootFromRecords } = require("../modules/merkle");
const { appendBlock } = require("../modules/blockchain");
const {
  isLocationAllowed,
  normalizeIp,
  isHighCgpaStudent,
  isIpAllowedForHighCgpa
} = require("../modules/policy");

function getOrCreateStudentKeys(state, studentId) {
  if (!state.studentKeys[studentId]) {
    state.studentKeys[studentId] = generateStudentKeyPair();
  }
  return state.studentKeys[studentId];
}

function getOrCreateFacultyKeys(state) {
  if (!state.facultyKeys.default) {
    state.facultyKeys.default = generateStudentKeyPair();
  }
  return state.facultyKeys.default;
}

function registerStudent(state, studentId) {
  if (!studentId) {
    return;
  }
  if (!Array.isArray(state.studentRegistry)) {
    state.studentRegistry = [];
  }
}

function getActiveSession(state) {
  if (!state.activeSessionId || !Array.isArray(state.sessions)) {
    return null;
  }
  return state.sessions.find((session) => session.id === state.activeSessionId) || null;
}

function generateCode(state, validitySeconds = 90) {
  const code = generateAttendanceCode(6);
  const now = Date.now();
  const expiresAt = new Date(now + validitySeconds * 1000).toISOString();

  if (!Array.isArray(state.sessions)) {
    state.sessions = [];
  }

  const previousSession = getActiveSession(state);
  if (previousSession && previousSession.status === "active") {
    previousSession.status = "closed";
    previousSession.closedAt = new Date(now).toISOString();
  }

  const session = {
    id: `S-${now}`,
    issuedAt: new Date(now).toISOString(),
    expiresAt,
    status: "active",
    codeHash: sha256(code),
    records: [],
    deviceBindings: {}
  };

  state.currentCodeHash = sha256(code);
  state.currentCodeIssuedAt = new Date(now).toISOString();
  state.currentCodeExpiresAt = expiresAt;
  state.activeSessionId = session.id;
  state.pendingRecords = [];
  state.sessions.push(session);

  return {
    code,
    expiresAt: state.currentCodeExpiresAt
  };
}

function isCodeValid(state, code) {
  const normalized = normalizeCode(code);
  if (!state.currentCodeHash || !state.currentCodeExpiresAt || !normalized) {
    return false;
  }

  const notExpired = Date.now() <= new Date(state.currentCodeExpiresAt).getTime();
  const hashMatches = sha256(normalized) === state.currentCodeHash;
  return notExpired && hashMatches;
}

function buildAttendanceRecord({ studentId, timestamp, hash, signature, locationVerified, type }) {
  return {
    student_id: studentId,
    timestamp,
    hash,
    signature,
    location_verified: locationVerified,
    record_type: type
  };
}

function submitAttendance(state, {
  studentId,
  sessionId,
  code,
  timestamp,
  nonce,
  signature,
  publicKey,
  deviceId,
  lat,
  lon,
  accuracy,
  clientIp
}) {
  const safeStudentId = String(studentId || "").trim().toUpperCase();
  const safeSessionId = String(sessionId || "").trim();
  const normalizedCode = normalizeCode(code);
  const safeTimestamp = String(timestamp || "").trim();
  const safeNonce = String(nonce || "").trim();
  const safeSignature = String(signature || "").trim();
  const submittedPublicKey = String(publicKey || "").trim();
  const safeDeviceId = String(deviceId || "").trim();
  const latitude = Number(lat);
  const longitude = Number(lon);
  const locationAccuracy = Number(accuracy);
  const ip = normalizeIp(clientIp);

  if (!safeStudentId || !safeSessionId || !normalizedCode || !safeTimestamp || !safeNonce || !safeSignature || !safeDeviceId) {
    return { ok: false, message: "Missing signed submission data." };
  }

  const activeSession = getActiveSession(state);
  if (!activeSession || activeSession.status !== "active") {
    return { ok: false, message: "No active attendance session." };
  }

  if (activeSession.id !== safeSessionId) {
    return { ok: false, message: "Session mismatch. Refresh and try again." };
  }

  if (!isCodeValid(state, normalizedCode)) {
    return { ok: false, message: "Invalid or expired attendance code." };
  }

  const isRegisteredStudent = Array.isArray(state.studentRegistry)
    && state.studentRegistry.includes(safeStudentId);
  if (!isRegisteredStudent) {
    return { ok: false, message: "Student ID is not in the registered roster." };
  }

  const signedPayload = canonicalSubmissionPayload({
    student_id: safeStudentId,
    session_id: safeSessionId,
    keyword: normalizedCode,
    timestamp: safeTimestamp,
    nonce: safeNonce
  });

  if (!state.studentPublicKeys || typeof state.studentPublicKeys !== "object") {
    state.studentPublicKeys = {};
  }

  const registeredPublicKey = state.studentPublicKeys[safeStudentId];
  let effectivePublicKey = registeredPublicKey;

  if (!effectivePublicKey && submittedPublicKey) {
    const submittedKeyValid = verifySignedPayload(signedPayload, safeSignature, submittedPublicKey);
    if (!submittedKeyValid) {
      return { ok: false, message: "Digital signature verification failed." };
    }

    state.studentPublicKeys[safeStudentId] = submittedPublicKey;
    effectivePublicKey = submittedPublicKey;
  }

  if (effectivePublicKey && submittedPublicKey && submittedPublicKey !== effectivePublicKey) {
    const submittedKeyValid = verifySignedPayload(signedPayload, safeSignature, submittedPublicKey);
    if (!submittedKeyValid) {
      return { ok: false, message: "Digital signature verification failed." };
    }

    state.studentPublicKeys[safeStudentId] = submittedPublicKey;
    effectivePublicKey = submittedPublicKey;
  }

  if (!effectivePublicKey) {
    return { ok: false, message: "Public key not registered for this student ID." };
  }

  const signatureValid = verifySignedPayload(signedPayload, safeSignature, effectivePublicKey);
  if (!signatureValid) {
    return { ok: false, message: "Digital signature verification failed." };
  }

  if (state.usedNonces.includes(safeNonce)) {
    return { ok: false, message: "Replay attack detected (nonce reused)." };
  }

  if (!activeSession.deviceBindings || typeof activeSession.deviceBindings !== "object") {
    activeSession.deviceBindings = {};
  }

  const boundStudent = activeSession.deviceBindings[safeDeviceId];
  if (boundStudent && boundStudent !== safeStudentId) {
    return { ok: false, message: "This device is already used by another student in this session." };
  }

  const anotherDeviceUsedByStudent = Object.entries(activeSession.deviceBindings)
    .some(([existingDeviceId, existingStudentId]) => existingStudentId === safeStudentId && existingDeviceId !== safeDeviceId);
  if (anotherDeviceUsedByStudent) {
    return { ok: false, message: "Student is already bound to another device in this session." };
  }

  const alreadySubmitted = activeSession.records.some((record) => record.student_id === safeStudentId);
  if (alreadySubmitted) {
    return { ok: false, message: "Student already submitted for this session." };
  }

  if (!isLocationAllowed(latitude, longitude, state.classroomBoundary, { accuracyMeters: locationAccuracy })) {
    return { ok: false, message: "You are outside the classroom geofence." };
  }

  if (isHighCgpaStudent(state, safeStudentId) && !isIpAllowedForHighCgpa(state, ip)) {
    return { ok: false, message: "High-CGPA policy failed for this network." };
  }

  const acceptedAt = new Date().toISOString();

  const payload = canonicalPayload({
    student_id: safeStudentId,
    keyword: normalizedCode,
    timestamp: safeTimestamp,
    nonce: safeNonce,
    location: { lat: latitude, lon: longitude }
  });

  const payloadHash = sha256(payload);

  state.usedNonces.push(safeNonce);
  activeSession.deviceBindings[safeDeviceId] = safeStudentId;
  const record = buildAttendanceRecord({
    studentId: safeStudentId,
    timestamp: acceptedAt,
    hash: payloadHash,
    signature: safeSignature,
    locationVerified: true,
    type: "regular"
  });

  state.pendingRecords.push(record);
  activeSession.records.push(record);

  return { ok: true, message: "Attendance marked successfully." };
}

function addOverrideAttendance(state, { studentId, reason, facultyId, clientIp }) {
  const safeStudentId = String(studentId || "").trim().toUpperCase();
  const safeFacultyId = String(facultyId || "FACULTY").trim().toUpperCase();
  const safeReason = String(reason || "Manual override").trim();
  const ip = normalizeIp(clientIp);

  if (!safeStudentId) {
    return { ok: false, message: "Student ID is required for override." };
  }

  const isRegisteredStudent = Array.isArray(state.studentRegistry)
    && state.studentRegistry.includes(safeStudentId);
  if (!isRegisteredStudent) {
    return { ok: false, message: "Student ID is not in the registered roster." };
  }

  const activeSession = getActiveSession(state);
  if (!activeSession || activeSession.status !== "active") {
    return { ok: false, message: "No active attendance session." };
  }

  const timestamp = new Date().toISOString();
  const nonce = generateNonce();
  const payload = canonicalPayload({
    student_id: safeStudentId,
    keyword: `OVERRIDE:${safeReason}`,
    timestamp,
    nonce,
    location: { lat: 0, lon: 0 }
  });

  const payloadHash = sha256(payload);
  const facultyKeys = getOrCreateFacultyKeys(state);
  const signature = signHash(payloadHash, facultyKeys.privateKey);
  const verified = verifyHash(payloadHash, signature, facultyKeys.publicKey);

  if (!verified) {
    return { ok: false, message: "Override signature verification failed." };
  }

  const record = buildAttendanceRecord({
    studentId: safeStudentId,
    timestamp,
    hash: payloadHash,
    signature,
    locationVerified: false,
    type: "override"
  });

  state.pendingRecords.push(record);
  activeSession.records.push(record);
  state.overrideLogs.push({
    student_id: safeStudentId,
    faculty_id: safeFacultyId,
    reason: safeReason,
    timestamp,
    ip,
    hash: payloadHash
  });

  return { ok: true, message: "Override recorded and immutably logged." };
}

function finalizeAttendance(state) {
  if (!state.pendingRecords.length) {
    return { ok: false, message: "No valid attendance records to finalize." };
  }

  const activeSession = getActiveSession(state);
  if (!activeSession || activeSession.status !== "active") {
    return { ok: false, message: "No active attendance session." };
  }

  const merkleRoot = buildMerkleRootFromRecords(state.pendingRecords);
  const block = appendBlock(state.blockchain, merkleRoot);

  state.finalizedRecords.push(
    ...state.pendingRecords.map((record) => ({
      ...record,
      block_index: block.index
    }))
  );

  state.pendingRecords = [];
  activeSession.status = "finalized";
  activeSession.finalizedAt = new Date().toISOString();
  activeSession.blockIndex = block.index;
  state.currentCodeHash = null;
  state.currentCodeExpiresAt = null;
  state.currentCodeIssuedAt = null;
  state.activeSessionId = null;

  return {
    ok: true,
    message: "Attendance finalized and block appended.",
    block
  };
}

module.exports = {
  generateCode,
  submitAttendance,
  addOverrideAttendance,
  finalizeAttendance
};
