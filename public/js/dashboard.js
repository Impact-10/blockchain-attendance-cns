const sessionCodeEl = document.getElementById("sessionCode");
const sessionExpiryEl = document.getElementById("sessionExpiry");
const sessionStatusEl = document.getElementById("sessionStatus");
const totalStudentsEl = document.getElementById("totalStudents");
const presentCountEl = document.getElementById("presentCount");
const absentCountEl = document.getElementById("absentCount");
const tableBodyEl = document.getElementById("studentTableBody");
const statusEl = document.getElementById("status");
const finalizeBtn = document.getElementById("finalizeBtn");
const useMyLocationBtn = document.getElementById("useMyLocationBtn");
const checkLocationBtn = document.getElementById("checkLocationBtn");
const clearPointsBtn = document.getElementById("clearPointsBtn");
const saveBoundaryBtn = document.getElementById("saveBoundaryBtn");
const cornerListEl = document.getElementById("cornerList");
const offsetValueEl = document.getElementById("offsetValue");
const sessionHistoryBodyEl = document.getElementById("sessionHistoryBody");
const currentMerklePreviewEl = document.getElementById("currentMerklePreview");
const liveLocationEl = document.getElementById("liveLocation");
const liveGeofenceStatusEl = document.getElementById("liveGeofenceStatus");
const logoutBtn = document.getElementById("logoutBtn");

let dashboardExpiresAt = null;
let geofencePoints = [];
let markers = [];
let polygonLayer = null;

const map = L.map("geofenceMap").setView([28.6130, 77.2096], 17);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

function setStatus(message, mode = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${mode}`.trim();
}

function normalizePoint(point) {
  return {
    lat: Number(point.lat),
    lng: Number(point.lng ?? point.lon)
  };
}

function renderCornerList() {
  if (!geofencePoints.length) {
    cornerListEl.innerHTML = '<div class="corner-item">No points selected</div>';
    return;
  }

  cornerListEl.innerHTML = geofencePoints
    .map(
      (point, index) => `
        <div class="corner-item">
          <strong>Corner ${index + 1}</strong>
          <span>Lat: ${point.lat.toFixed(6)}</span>
          <span>Lng: ${point.lng.toFixed(6)}</span>
        </div>
      `
    )
    .join("");
}

function redrawGeofence() {
  for (const marker of markers) {
    map.removeLayer(marker);
  }
  markers = [];

  if (polygonLayer) {
    map.removeLayer(polygonLayer);
    polygonLayer = null;
  }

  for (let index = 0; index < geofencePoints.length; index += 1) {
    const point = geofencePoints[index];
    const marker = L.marker([point.lat, point.lng], { draggable: true }).addTo(map);
    marker.on("dragend", (event) => {
      const dragged = event.target.getLatLng();
      geofencePoints[index] = {
        lat: Number(dragged.lat),
        lng: Number(dragged.lng)
      };
      redrawGeofence();
      setStatus("Boundary corner adjusted", "success");
    });
    markers.push(marker);
  }

  if (geofencePoints.length >= 3) {
    polygonLayer = L.polygon(
      geofencePoints.map((p) => [p.lat, p.lng]),
      {
        color: "#125fcd",
        fillColor: "#8ec2ff",
        fillOpacity: 0.3,
        weight: 2
      }
    ).addTo(map);
  }

  renderCornerList();
}

function generateAutoBoundary(lat, lng, offset) {
  return [
    { lat: lat + offset, lng: lng + offset },
    { lat: lat + offset, lng: lng - offset },
    { lat: lat - offset, lng: lng - offset },
    { lat: lat - offset, lng: lng + offset }
  ];
}

function getOffsetValue() {
  const offset = Number(offsetValueEl.value || "0.00010");
  if (!Number.isFinite(offset) || offset <= 0) {
    return 0.00010;
  }
  return Math.min(offset, 0.01);
}

function showLiveLocation(position) {
  const lat = Number(position.coords.latitude);
  const lng = Number(position.coords.longitude);
  const accuracy = Number(position.coords.accuracy);
  liveLocationEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)} (accuracy ${Math.round(accuracy)}m)`;
  return { lat, lng, accuracy };
}

async function checkGeofenceForPoint(lat, lng, accuracy) {
  const response = await fetch("/api/geofence/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lat,
      lng,
      accuracy,
      coordinates: geofencePoints.length >= 3 ? geofencePoints : undefined
    })
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.message || "Unable to validate live position");
  }

  liveGeofenceStatusEl.textContent = data.allowed ? "YES" : "NO";
  liveGeofenceStatusEl.style.color = data.allowed ? "#067647" : "#b42318";
  return data.allowed;
}

async function persistBoundary() {
  if (geofencePoints.length !== 4) {
    throw new Error("Please select exactly 4 points before saving.");
  }

  const response = await fetch("/api/geofence/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: geofencePoints })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.message || "Unable to save boundary");
  }

  geofencePoints = (data.coordinates || []).map(normalizePoint).slice(0, 4);
  redrawGeofence();
}

async function loadGeofence() {
  try {
    const response = await fetch("/api/geofence");
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "Unable to load geofence");
    }

    geofencePoints = (data.coordinates || []).map(normalizePoint).slice(0, 4);
    redrawGeofence();

    if (geofencePoints.length) {
      map.fitBounds(geofencePoints.map((p) => [p.lat, p.lng]), { padding: [20, 20] });
    }
  } catch (err) {
    setStatus(err.message, "error");
  }
}

function statusBadge(status) {
  if (status === "verified") {
    return '<span class="badge badge-green">Verified</span>';
  }
  if (status === "override") {
    return '<span class="badge badge-yellow">Override</span>';
  }
  return '<span class="badge badge-red">Rejected</span>';
}

function renderStudents(students) {
  if (!students.length) {
    tableBodyEl.innerHTML = `
      <tr>
        <td colspan="3">No students yet. Submit attendance to build the list.</td>
      </tr>
    `;
    return;
  }

  tableBodyEl.innerHTML = students
    .map(
      (student) => `
        <tr>
          <td>${student.student_id}</td>
          <td>${statusBadge(student.status)}</td>
          <td>${student.timestamp ? new Date(student.timestamp).toLocaleString() : "-"}</td>
        </tr>
      `
    )
    .join("");
}

function historyBadge(status) {
  if (status === "finalized") {
    return '<span class="badge badge-green">Finalized</span>';
  }
  if (status === "active") {
    return '<span class="badge badge-blue">Active</span>';
  }
  return '<span class="badge badge-red">Closed</span>';
}

function shortHash(value) {
  if (!value) {
    return "-";
  }
  return `${value.slice(0, 14)}...${value.slice(-10)}`;
}

function renderCurrentMerkle(value) {
  currentMerklePreviewEl.textContent = value ? shortHash(value) : "Pending submissions required";
}

function renderSessionHistory(sessions) {
  if (!sessions.length) {
    sessionHistoryBodyEl.innerHTML = `
      <tr>
        <td colspan="7">No sessions yet. Generate a code to start one.</td>
      </tr>
    `;
    return;
  }

  sessionHistoryBodyEl.innerHTML = sessions
    .map(
      (session) => `
        <tr>
          <td>${session.id}</td>
          <td>${new Date(session.issuedAt).toLocaleString()}</td>
          <td>${historyBadge(session.status)}</td>
          <td>${session.presentCount}</td>
          <td>${session.recordCount}</td>
          <td>${session.overrideCount}</td>
          <td>${session.blockIndex ?? "-"}</td>
          <td class="mono">${shortHash(session.merkleRoot)}</td>
        </tr>
      `
    )
    .join("");
}

function formatRemaining(ms) {
  if (!ms || ms <= 0) {
    return "Closed";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderSession(session) {
  const cachedCode = window.localStorage.getItem("latestAttendanceCode");
  sessionCodeEl.textContent = session.code || cachedCode || "------";
  dashboardExpiresAt = session.expiresAt ? new Date(session.expiresAt).getTime() : null;
  if (!dashboardExpiresAt || session.status !== "Active") {
    sessionExpiryEl.textContent = "Closed";
  } else {
    sessionExpiryEl.textContent = formatRemaining(dashboardExpiresAt - Date.now());
  }
  sessionStatusEl.textContent = session.status;
  sessionStatusEl.className = `badge ${session.status === "Active" ? "badge-green" : "badge-red"}`;
}

function tickSessionCountdown() {
  if (!dashboardExpiresAt) {
    return;
  }
  const remaining = dashboardExpiresAt - Date.now();
  sessionExpiryEl.textContent = formatRemaining(remaining);
  if (remaining <= 0) {
    sessionStatusEl.textContent = "Closed";
    sessionStatusEl.className = "badge badge-red";
  }
}

async function refreshDashboard() {
  try {
    const response = await fetch("/api/dashboard-data");
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.message || "Unable to load dashboard");
    }

    renderSession(data.session);
    totalStudentsEl.textContent = String(data.stats.totalStudents);
    presentCountEl.textContent = String(data.stats.presentCount);
    absentCountEl.textContent = String(data.stats.absentCount);
    renderCurrentMerkle(data.currentMerklePreview);
    renderStudents(data.students);
    renderSessionHistory(data.sessionHistory || []);
    setStatus("Dashboard synced", "success");
  } catch (err) {
    setStatus(err.message, "error");
  }
}

map.on("click", (event) => {
  if (geofencePoints.length >= 4) {
    setStatus("Exactly 4 points allowed. Clear points to reset.", "error");
    return;
  }

  geofencePoints.push({
    lat: Number(event.latlng.lat),
    lng: Number(event.latlng.lng)
  });
  redrawGeofence();
  setStatus(`Point ${geofencePoints.length} selected`, "success");
});

clearPointsBtn.addEventListener("click", () => {
  geofencePoints = [];
  redrawGeofence();
  setStatus("Boundary points cleared", "success");
});

useMyLocationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus("Geolocation is not supported in this browser.", "error");
    return;
  }

  useMyLocationBtn.disabled = true;
  setStatus("Detecting your current location...");

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { lat, lng, accuracy } = showLiveLocation(position);
      const offset = getOffsetValue();

      geofencePoints = generateAutoBoundary(lat, lng, offset);
      redrawGeofence();
      map.fitBounds(geofencePoints.map((p) => [p.lat, p.lng]), { padding: [20, 20] });
      try {
        await persistBoundary();
        await checkGeofenceForPoint(lat, lng, accuracy);
      } catch (error) {
        setStatus(error.message, "error");
      }

      setStatus("Auto boundary generated from your current location", "success");
      useMyLocationBtn.disabled = false;
    },
    (error) => {
      const message = error && error.code === 1
        ? "Location permission denied for this browser session."
        : "Unable to fetch location. Retry in open sky area.";
      setStatus(message, "error");
      useMyLocationBtn.disabled = false;
    },
    {
      enableHighAccuracy: true,
      timeout: 10000
    }
  );
});

checkLocationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus("Geolocation is not supported in this browser.", "error");
    return;
  }

  checkLocationBtn.disabled = true;
  setStatus("Checking your live location against geofence...");

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { lat, lng, accuracy } = showLiveLocation(position);
      const allowed = await checkGeofenceForPoint(lat, lng, accuracy);
      setStatus(allowed ? "Your live location is inside geofence." : "Your live location is outside geofence.", allowed ? "success" : "error");
      checkLocationBtn.disabled = false;
    },
    (error) => {
      const message = error && error.code === 1
        ? "Location permission denied for this browser session."
        : "Unable to fetch current location.";
      setStatus(message, "error");
      checkLocationBtn.disabled = false;
    },
    {
      enableHighAccuracy: true,
      timeout: 15000
    }
  );
});

saveBoundaryBtn.addEventListener("click", async () => {
  setStatus("Saving classroom boundary...");
  try {
    await persistBoundary();
    setStatus("Boundary saved successfully", "success");
  } catch (err) {
    setStatus(err.message, "error");
  }
});

finalizeBtn.addEventListener("click", async () => {
  setStatus("Finalizing attendance...");
  try {
    const res = await fetch("/api/faculty/finalize", { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.message || "Finalize failed");
    }

    setStatus(`Finalized in block #${data.block.index}`, "success");
    await refreshDashboard();
  } catch (err) {
    setStatus(err.message, "error");
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "/login";
  }
});

refreshDashboard();
loadGeofence();
setInterval(refreshDashboard, 3000);
setInterval(tickSessionCountdown, 1000);
