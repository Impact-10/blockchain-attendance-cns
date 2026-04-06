const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { loadState, saveState } = require("./src/data/store");
const {
  FACULTY_CREDENTIALS,
  STUDENT_ID_REGEX
} = require("./src/config/auth");
const {
  generateCode,
  submitAttendance,
  addOverrideAttendance,
  finalizeAttendance
} = require("./src/services/attendanceService");
const { verifyChain } = require("./src/modules/blockchain");
const { buildMerkleRootFromRecords } = require("./src/modules/merkle");
const {
  CLASSROOM_POLYGON,
  sanitizePolygon,
  orderPolygonClockwise,
  isLocationAllowed
} = require("./src/modules/policy");

const app = express();
const PORT = process.env.PORT || 3000;
let latestIssuedCode = null;
const AUTH_COOKIE = "attendance_auth";
const AUTH_TTL_MS = 1000 * 60 * 60 * 8;
const AUTH_SECRET = process.env.AUTH_SECRET || "attendance-demo-secret";

function parseCookies(cookieHeader) {
  const map = {};
  if (!cookieHeader) {
    return map;
  }

  for (const pair of String(cookieHeader).split(";")) {
    const [rawKey, ...rawValueParts] = pair.split("=");
    const key = String(rawKey || "").trim();
    if (!key) {
      continue;
    }
    map[key] = decodeURIComponent(rawValueParts.join("=").trim());
  }

  return map;
}

function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input) {
  const normalized = String(input)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function signAuthPayload(payloadBase64) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(payloadBase64).digest("hex");
}

function createAuthToken(payload) {
  const payloadBase64 = toBase64Url(JSON.stringify({
    ...payload,
    exp: Date.now() + AUTH_TTL_MS
  }));
  const signature = signAuthPayload(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

function verifyAuthToken(token) {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [payloadBase64, providedSignature] = token.split(".");
  const expectedSignature = signAuthPayload(payloadBase64);
  if (!providedSignature || providedSignature.length !== expectedSignature.length) {
    return null;
  }
  const sigOk = crypto.timingSafeEqual(
    Buffer.from(providedSignature || "", "utf8"),
    Buffer.from(expectedSignature, "utf8")
  );

  if (!sigOk) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadBase64));
    if (!payload.exp || Date.now() > payload.exp) {
      return null;
    }
    if (!payload.role || !payload.id) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function setAuthCookie(res, token) {
  res.setHeader("Set-Cookie", `${AUTH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(AUTH_TTL_MS / 1000)}`);
}

function clearAuthCookie(res) {
  res.setHeader("Set-Cookie", `${AUTH_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function getAuthFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[AUTH_COOKIE];
  return verifyAuthToken(token);
}

function requireRoleApi(...allowedRoles) {
  return (req, res, next) => {
    if (!req.auth || !allowedRoles.includes(req.auth.role)) {
      return res.status(401).json({ ok: false, message: "Unauthorized. Please login." });
    }
    return next();
  };
}

function requireFacultyPage(req, res, next) {
  if (!req.auth) {
    return res.redirect("/login");
  }
  if (req.auth.role !== "faculty") {
    return res.redirect("/submit");
  }
  return next();
}

function requireStudentPage(req, res, next) {
  if (!req.auth) {
    return res.redirect("/login");
  }
  if (req.auth.role !== "student") {
    return res.redirect("/generate");
  }
  return next();
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  req.auth = getAuthFromRequest(req);
  next();
});

app.use((req, res, next) => {
  if (req.path.endsWith(".html")) {
    return res.status(404).json({ ok: false, message: "Not found" });
  }
  return next();
});

app.use(express.static(path.join(__dirname, "public"), { index: false }));

app.get("/", (req, res) => {
  if (!req.auth) {
    return res.redirect("/login");
  }

  return res.redirect(req.auth.role === "faculty" ? "/generate" : "/submit");
});

app.get("/login", (req, res) => {
  if (req.auth) {
    return res.redirect(req.auth.role === "faculty" ? "/generate" : "/submit");
  }

  return res.sendFile(path.join(__dirname, "public/login.html"));
});

app.post("/api/auth/login", (req, res) => {
  const userId = String(req.body.id || "").trim().toUpperCase();
  const password = String(req.body.password || "").trim();

  if (!userId || !password) {
    return res.status(400).json({ ok: false, message: "ID and password are required." });
  }

  if (userId.toLowerCase() === FACULTY_CREDENTIALS.id && password === FACULTY_CREDENTIALS.password) {
    const token = createAuthToken({ role: "faculty", id: FACULTY_CREDENTIALS.id });
    setAuthCookie(res, token);
    return res.json({ ok: true, role: "faculty", id: FACULTY_CREDENTIALS.id, redirectTo: "/generate" });
  }

  const state = loadState();
  const isValidStudentFormat = STUDENT_ID_REGEX.test(userId);
  const expectedPassword = userId.slice(-4);
  const isRegistered = Array.isArray(state.studentRegistry) && state.studentRegistry.includes(userId);
  const hasPublicKey = Boolean(state.studentPublicKeys && state.studentPublicKeys[userId]);

  if (isValidStudentFormat && isRegistered && hasPublicKey && password === expectedPassword) {
    const token = createAuthToken({ role: "student", id: userId });
    setAuthCookie(res, token);
    return res.json({ ok: true, role: "student", id: userId, redirectTo: "/submit" });
  }

  return res.status(401).json({ ok: false, message: "Invalid ID or password." });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.auth) {
    return res.status(401).json({ ok: false, message: "Not logged in." });
  }

  const state = loadState();
  const allowedStudents = (Array.isArray(state.studentRegistry) ? state.studentRegistry : []).map((studentId) => ({ id: studentId }));
  return res.json({
    ok: true,
    user: {
      id: req.auth.id,
      role: req.auth.role
    },
    allowedStudents
  });
});

app.post("/api/auth/logout", (req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

app.get("/generate", requireFacultyPage, (req, res) => {
  res.sendFile(path.join(__dirname, "public/generate.html"));
});

app.get("/submit", requireStudentPage, (req, res) => {
  res.sendFile(path.join(__dirname, "public/submit.html"));
});

app.get("/result", requireStudentPage, (req, res) => {
  res.sendFile(path.join(__dirname, "public/result.html"));
});

app.get("/blockchain", requireFacultyPage, (req, res) => {
  res.sendFile(path.join(__dirname, "public/blockchain.html"));
});

app.get("/dashboard", requireFacultyPage, (req, res) => {
  res.sendFile(path.join(__dirname, "public/dashboard.html"));
});

app.get("/register-student", requireFacultyPage, (req, res) => {
  res.sendFile(path.join(__dirname, "public/register-student.html"));
});

app.post("/api/faculty/generate-code", requireRoleApi("faculty"), (req, res) => {
  const state = loadState();
  const result = generateCode(state, 90);
  latestIssuedCode = result.code;
  saveState(state);
  res.json({ ok: true, ...result });
});

app.post("/api/student/submit", requireRoleApi("student"), (req, res) => {
  const state = loadState();
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";

  const result = submitAttendance(state, {
    studentId: req.auth.id,
    sessionId: req.body.session_id,
    code: req.body.code,
    timestamp: req.body.timestamp,
    nonce: req.body.nonce,
    signature: req.body.signature,
    publicKey: req.body.public_key,
    deviceId: req.body.device_id,
    lat: req.body.lat,
    lon: req.body.lon,
    accuracy: req.body.accuracy,
    clientIp: ip
  });

  if (result.ok) {
    saveState(state);
    return res.json(result);
  }

  return res.status(400).json(result);
});

app.post("/api/faculty/override", requireRoleApi("faculty"), (req, res) => {
  const state = loadState();
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";

  const result = addOverrideAttendance(state, {
    studentId: req.body.student_id,
    reason: req.body.reason,
    facultyId: req.body.faculty_id,
    clientIp: ip
  });

  if (result.ok) {
    saveState(state);
    return res.json(result);
  }

  return res.status(400).json(result);
});

app.post("/api/faculty/finalize", requireRoleApi("faculty"), (req, res) => {
  const state = loadState();
  const result = finalizeAttendance(state);

  if (result.ok) {
    latestIssuedCode = null;
    saveState(state);
    return res.json(result);
  }

  return res.status(400).json(result);
});

app.get("/api/blockchain", requireRoleApi("faculty"), (req, res) => {
  const state = loadState();
  const blockRecordCounts = {};
  for (const record of state.finalizedRecords) {
    const key = String(record.block_index);
    blockRecordCounts[key] = (blockRecordCounts[key] || 0) + 1;
  }

  const chain = state.blockchain.map((block) => ({
    ...block,
    record_count: blockRecordCounts[String(block.index)] || 0
  }));

  res.json({
    ok: true,
    chain_valid: verifyChain(chain),
    pending_count: state.pendingRecords.length,
    finalized_count: state.finalizedRecords.length,
    chain
  });
});

app.get("/api/session-info", requireRoleApi("student"), (req, res) => {
  const state = loadState();
  const expiresAt = state.currentCodeExpiresAt;
  const isActive = Boolean(
    state.currentCodeHash
      && expiresAt
      && Date.now() <= new Date(expiresAt).getTime()
  );

  res.json({
    ok: true,
    sessionId: state.activeSessionId,
    code: isActive ? latestIssuedCode : null,
    expiresAt,
    status: isActive ? "Active" : "Closed"
  });
});

app.get("/api/dashboard-data", requireRoleApi("faculty"), (req, res) => {
  const state = loadState();
  const expiresAt = state.currentCodeExpiresAt;
  const isActive = Boolean(
    state.currentCodeHash
      && expiresAt
      && Date.now() <= new Date(expiresAt).getTime()
  );

  const activeSession = Array.isArray(state.sessions)
    ? state.sessions.find((session) => session.id === state.activeSessionId)
    : null;

  const currentSessionRecords = activeSession?.records || [];
  const latestByStudent = new Map();

  for (const record of currentSessionRecords) {
    const existing = latestByStudent.get(record.student_id);
    if (!existing || new Date(record.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
      latestByStudent.set(record.student_id, record);
    }
  }

  const rosterFromRegistry = Array.isArray(state.studentRegistry)
    ? state.studentRegistry
    : [];
  const roster = rosterFromRegistry.length
    ? rosterFromRegistry
    : [...new Set(currentSessionRecords.map((record) => record.student_id))];

  const students = roster.map((studentId) => {
    const record = latestByStudent.get(studentId);
    if (!record) {
      return {
        student_id: studentId,
        status: "rejected",
        timestamp: null
      };
    }

    return {
      student_id: studentId,
      status: record.record_type === "override" ? "override" : "verified",
      timestamp: record.timestamp
    };
  });

  const presentCount = students.filter((s) => s.status !== "rejected").length;
  const blockByIndex = new Map((state.blockchain || []).map((block) => [block.index, block]));
  const currentMerklePreview = currentSessionRecords.length
    ? buildMerkleRootFromRecords(currentSessionRecords)
    : null;
  const sessionHistory = (Array.isArray(state.sessions) ? state.sessions : [])
    .slice()
    .reverse()
    .map((session) => {
      const uniqueStudents = new Set(session.records.map((record) => record.student_id));
      const overrideCount = session.records.filter((record) => record.record_type === "override").length;

      return {
        id: session.id,
        issuedAt: session.issuedAt,
        status: session.status,
        expiresAt: session.expiresAt,
        presentCount: uniqueStudents.size,
        recordCount: session.records.length,
        overrideCount,
        blockIndex: session.blockIndex ?? null,
        merkleRoot: session.blockIndex != null
          ? (blockByIndex.get(session.blockIndex)?.merkle_root || null)
          : null
      };
    });

  res.json({
    ok: true,
    session: {
      sessionId: state.activeSessionId,
      code: isActive ? latestIssuedCode : null,
      expiresAt,
      status: isActive ? "Active" : "Closed"
    },
    stats: {
      totalStudents: roster.length,
      presentCount,
      absentCount: roster.length - presentCount
    },
    currentMerklePreview,
    students,
    sessionHistory,
    geofence: sanitizePolygon(state.classroomBoundary).length === 4
      ? sanitizePolygon(state.classroomBoundary)
      : CLASSROOM_POLYGON
  });
});

app.get("/api/geofence", requireRoleApi("faculty"), (req, res) => {
  const state = loadState();
  const boundary = sanitizePolygon(state.classroomBoundary).length === 4
    ? sanitizePolygon(state.classroomBoundary)
    : CLASSROOM_POLYGON;

  res.json({
    ok: true,
    coordinates: boundary
  });
});

app.post("/api/geofence/check", requireRoleApi("faculty"), (req, res) => {
  const state = loadState();
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng ?? req.body.lon);
  const accuracy = Number(req.body.accuracy);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ ok: false, message: "Valid latitude and longitude are required." });
  }

  const boundary = sanitizePolygon(state.classroomBoundary).length === 4
    ? sanitizePolygon(state.classroomBoundary)
    : CLASSROOM_POLYGON;

  const allowed = isLocationAllowed(lat, lng, boundary, { accuracyMeters: accuracy });
  return res.json({
    ok: true,
    allowed,
    accuracy: Number.isFinite(accuracy) ? accuracy : null
  });
});

app.get("/api/students", requireRoleApi("faculty"), (req, res) => {
  const state = loadState();
  const registry = Array.isArray(state.studentRegistry) ? state.studentRegistry : [];
  const students = registry.map((studentId) => ({
    student_id: studentId,
    has_public_key: Boolean(state.studentPublicKeys?.[studentId])
  }));

  res.json({
    ok: true,
    students
  });
});

app.post("/api/students/register", requireRoleApi("faculty"), (req, res) => {
  const state = loadState();
  const studentId = String(req.body.student_id || "").trim().toUpperCase();
  const publicKeyPem = String(req.body.public_key || "").trim();

  if (!studentId || !publicKeyPem) {
    return res.status(400).json({ ok: false, message: "Student ID and public key are required." });
  }

  if (!STUDENT_ID_REGEX.test(studentId)) {
    return res.status(400).json({ ok: false, message: "Student ID must match format: 2 digits + 3 uppercase letters + 4 digits (example: 23BCE1999)." });
  }

  try {
    crypto.createPublicKey(publicKeyPem);
  } catch {
    return res.status(400).json({ ok: false, message: "Invalid public key PEM format." });
  }

  if (!Array.isArray(state.studentRegistry)) {
    state.studentRegistry = [];
  }
  if (!state.studentPublicKeys || typeof state.studentPublicKeys !== "object") {
    state.studentPublicKeys = {};
  }

  if (state.studentPublicKeys[studentId]) {
    return res.status(400).json({ ok: false, message: "Student ID already registered." });
  }

  if (!state.studentRegistry.includes(studentId)) {
    state.studentRegistry.push(studentId);
  }
  state.studentPublicKeys[studentId] = publicKeyPem;
  saveState(state);

  return res.json({ ok: true, message: "Student public key registered successfully." });
});

app.delete("/api/students/:studentId", requireRoleApi("faculty"), (req, res) => {
  const state = loadState();
  const studentId = String(req.params.studentId || "").trim().toUpperCase();

  if (!STUDENT_ID_REGEX.test(studentId)) {
    return res.status(400).json({ ok: false, message: "Invalid student ID format." });
  }

  const registryBefore = Array.isArray(state.studentRegistry) ? state.studentRegistry.length : 0;

  if (!Array.isArray(state.studentRegistry)) {
    state.studentRegistry = [];
  }
  state.studentRegistry = state.studentRegistry.filter((id) => id !== studentId);

  if (state.studentPublicKeys && typeof state.studentPublicKeys === "object") {
    delete state.studentPublicKeys[studentId];
  }

  if (state.studentKeys && typeof state.studentKeys === "object") {
    delete state.studentKeys[studentId];
  }

  if (Array.isArray(state.highCgpaStudents)) {
    state.highCgpaStudents = state.highCgpaStudents.filter((id) => id !== studentId);
  }

  const removed = registryBefore !== state.studentRegistry.length;
  if (!removed) {
    return res.status(404).json({ ok: false, message: "Student not found in registered roster." });
  }

  saveState(state);
  return res.json({ ok: true, message: `Removed ${studentId} from roster and key registry.` });
});

app.post("/api/geofence/save", requireRoleApi("faculty"), (req, res) => {
  const state = loadState();
  const boundary = orderPolygonClockwise(req.body.coordinates);

  if (boundary.length !== 4) {
    return res.status(400).json({
      ok: false,
      message: "Exactly 4 valid boundary points are required."
    });
  }

  state.classroomBoundary = boundary;
  saveState(state);

  return res.json({
    ok: true,
    message: "Classroom boundary saved.",
    coordinates: boundary
  });
});

app.listen(PORT, () => {
  console.log(`Attendance system running at http://localhost:${PORT}`);
});
