const form = document.getElementById("submitForm");
const statusEl = document.getElementById("status");
const countdownEl = document.getElementById("countdown");
const submitBtn = document.getElementById("submitBtn");
const loggedInStudentEl = document.getElementById("loggedInStudent");
const logoutBtn = document.getElementById("logoutBtn");

let sessionExpiresAt = null;
let sessionClosed = false;
let activeSessionId = null;
let loggedInStudentId = null;

const textEncoder = new TextEncoder();

function getOrCreateDeviceId() {
  const key = "attendanceDeviceId";
  const existing = window.localStorage.getItem(key);
  if (existing) {
    return existing;
  }

  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  const generated = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  window.localStorage.setItem(key, generated);
  return generated;
}

function setStatus(message, mode = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${mode}`.trim();
}

async function ensureStudentSession() {
  const response = await fetch("/api/auth/me");
  const data = await response.json();

  if (!response.ok || !data.ok || data.user?.role !== "student") {
    window.location.href = "/login";
    throw new Error("Unauthorized session.");
  }

  loggedInStudentId = data.user.id;
  loggedInStudentEl.textContent = loggedInStudentId;
}

function formatRemaining(ms) {
  if (ms <= 0) {
    return "00:00";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function syncSession() {
  try {
    const response = await fetch("/api/session-info");
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "Unable to load session");
    }

    activeSessionId = data.sessionId || null;
    sessionExpiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : null;
    sessionClosed = data.status !== "Active";
    if (sessionClosed) {
      submitBtn.disabled = true;
      countdownEl.textContent = "Closed";
      setStatus("Attendance Closed", "error");
    } else {
      submitBtn.disabled = false;
    }
  } catch (err) {
    setStatus(err.message, "error");
  }
}

function canonicalSubmissionPayload({ student_id, session_id, keyword, timestamp, nonce }) {
  return JSON.stringify({
    student_id,
    session_id,
    keyword,
    timestamp,
    nonce
  });
}

function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function derToPem(label, derBuffer) {
  const base64 = arrayBufferToBase64(derBuffer);
  const chunks = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${chunks.join("\n")}\n-----END ${label}-----`;
}

function pemToDer(pem) {
  const base64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return base64ToArrayBuffer(base64);
}

function generateNonceHex() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function getOrCreateStudentKeys(studentId) {
  const key = `studentKey::${studentId}`;
  const existing = window.localStorage.getItem(key);
  if (existing) {
    return JSON.parse(existing);
  }

  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256"
    },
    true,
    ["sign", "verify"]
  );

  const privateDer = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const publicDer = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
  const result = {
    privateKeyPem: derToPem("PRIVATE KEY", privateDer),
    publicKeyPem: derToPem("PUBLIC KEY", publicDer)
  };

  window.localStorage.setItem(key, JSON.stringify(result));
  return result;
}

async function signPayload(payload, privateKeyPem) {
  const privateKey = await window.crypto.subtle.importKey(
    "pkcs8",
    pemToDer(privateKeyPem),
    {
      name: "ECDSA",
      namedCurve: "P-256"
    },
    false,
    ["sign"]
  );

  const signature = await window.crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256"
    },
    privateKey,
    textEncoder.encode(payload)
  );

  return arrayBufferToBase64(signature);
}

function tickCountdown() {
  if (!sessionExpiresAt || sessionClosed) {
    return;
  }

  const remainingMs = sessionExpiresAt - Date.now();
  countdownEl.textContent = formatRemaining(remainingMs);
  if (remainingMs <= 0) {
    sessionClosed = true;
    submitBtn.disabled = true;
    setStatus("Attendance Closed", "error");
    countdownEl.textContent = "Closed";
  }
}

function geolocationErrorMessage(error) {
  if (!error || typeof error.code !== "number") {
    return "Unable to fetch location. Please try again.";
  }

  if (error.code === 1) {
    return "Location permission is denied for this site. Allow location access in browser settings.";
  }
  if (error.code === 2) {
    return "Location is temporarily unavailable. Move to open space and try again.";
  }
  return "Location request timed out. Please keep GPS/location ON and try again.";
}

function requestCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported in this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: Number(position.coords.accuracy)
        });
      },
      (error) => reject(error),
      options
    );
  });
}

async function getLocation() {
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const permission = await navigator.permissions.query({ name: "geolocation" });
      if (permission.state === "denied") {
        throw new Error("Location permission is denied for this site. Allow location access and retry.");
      }
    } catch {
      // Continue with geolocation API fallback if permission API is unavailable.
    }
  }

  try {
    return await requestCurrentPosition({
      enableHighAccuracy: true,
      timeout: 18000,
      maximumAge: 0
    });
  } catch (error) {
    if (error && error.code === 1) {
      throw new Error(geolocationErrorMessage(error));
    }

    try {
      return await requestCurrentPosition({
        enableHighAccuracy: false,
        timeout: 22000,
        maximumAge: 30000
      });
    } catch (retryError) {
      throw new Error(geolocationErrorMessage(retryError));
    }
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = document.getElementById("code").value.trim().toUpperCase();

  if (!loggedInStudentId || !code) {
    setStatus("Login session or code missing.", "error");
    return;
  }

  if (sessionClosed) {
    setStatus("Attendance Closed", "error");
    return;
  }

  if (!activeSessionId) {
    setStatus("No active session. Ask faculty to generate code.", "error");
    return;
  }

  if (!window.crypto || !window.crypto.subtle) {
    setStatus("Browser crypto is not available.", "error");
    return;
  }

  setStatus("Verifying attendance...");

  try {
    const timestamp = new Date().toISOString();
    const nonce = generateNonceHex();
    const payload = canonicalSubmissionPayload({
      student_id: loggedInStudentId,
      session_id: activeSessionId,
      keyword: code,
      timestamp,
      nonce
    });

    const keys = await getOrCreateStudentKeys(loggedInStudentId);
    const signature = await signPayload(payload, keys.privateKeyPem);
    const location = await getLocation();
    const deviceId = getOrCreateDeviceId();

    const response = await fetch("/api/student/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: activeSessionId,
        code,
        timestamp,
        nonce,
        signature,
        public_key: keys.publicKeyPem,
        device_id: deviceId,
        lat: location.lat,
        lon: location.lon,
        accuracy: location.accuracy
      })
    });

    const data = await response.json();
    const params = new URLSearchParams({
      status: data.ok ? "success" : "failure",
      message: data.message || "Submission complete",
      student_id: loggedInStudentId,
      time: new Date().toISOString()
    });

    window.location.href = `/result?${params.toString()}`;
  } catch (err) {
    const params = new URLSearchParams({
      status: "failure",
      message: err.message,
      student_id: loggedInStudentId || "-",
      time: new Date().toISOString()
    });
    window.location.href = `/result?${params.toString()}`;
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "/login";
  }
});

ensureStudentSession().then(syncSession);
setInterval(tickCountdown, 1000);
setInterval(syncSession, 5000);
