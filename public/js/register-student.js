const form = document.getElementById("registerForm");
const statusEl = document.getElementById("status");
const listBodyEl = document.getElementById("studentListBody");
const generateKeyBtn = document.getElementById("generateKeyBtn");
const studentIdInput = document.getElementById("studentId");
const publicKeyInput = document.getElementById("publicKey");
const logoutBtn = document.getElementById("logoutBtn");
const STUDENT_ID_REGEX = /^\d{2}[A-Z]{3}\d{4}$/;

function setStatus(message, mode = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${mode}`.trim();
}

function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function derToPem(label, derBuffer) {
  const base64 = arrayBufferToBase64(derBuffer);
  const chunks = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${chunks.join("\n")}\n-----END ${label}-----`;
}

async function generateAndStoreStudentKeys(studentId) {
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
  const keyData = {
    privateKeyPem: derToPem("PRIVATE KEY", privateDer),
    publicKeyPem: derToPem("PUBLIC KEY", publicDer)
  };

  window.localStorage.setItem(`studentKey::${studentId}`, JSON.stringify(keyData));
  return keyData;
}

function renderStudents(students) {
  if (!students.length) {
    listBodyEl.innerHTML = `
      <tr>
        <td colspan="3">No students registered yet.</td>
      </tr>
    `;
    return;
  }

  listBodyEl.innerHTML = students
    .map(
      (student) => `
        <tr>
          <td>${student.student_id}</td>
          <td>${student.has_public_key ? '<span class="badge badge-green">Registered</span>' : '<span class="badge badge-red">Missing</span>'}</td>
          <td>
            <button
              type="button"
              class="ghost student-delete-btn"
              data-student-id="${student.student_id}"
            >Delete</button>
          </td>
        </tr>
      `
    )
    .join("");
}

async function deleteStudent(studentId) {
  const confirmed = window.confirm(`Delete ${studentId} from registered roster and key registry?`);
  if (!confirmed) {
    return;
  }

  setStatus(`Deleting ${studentId}...`);
  try {
    const response = await fetch(`/api/students/${encodeURIComponent(studentId)}`, {
      method: "DELETE"
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.message || "Delete failed");
    }

    window.localStorage.removeItem(`studentKey::${studentId}`);
    setStatus(data.message, "success");
    await loadStudents();
  } catch (err) {
    setStatus(err.message, "error");
  }
}

async function loadStudents() {
  try {
    const response = await fetch("/api/students");
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "Unable to load students");
    }
    renderStudents(data.students || []);
  } catch (err) {
    setStatus(err.message, "error");
  }
}

generateKeyBtn.addEventListener("click", async () => {
  const studentId = studentIdInput.value.trim().toUpperCase();

  if (!studentId) {
    setStatus("Enter Student ID before generating keypair.", "error");
    return;
  }

  if (!STUDENT_ID_REGEX.test(studentId)) {
    setStatus("Student ID format must be 2 digits + 3 uppercase letters + 4 digits (example: 23BCE1999).", "error");
    return;
  }

  if (!window.crypto || !window.crypto.subtle) {
    setStatus("Browser crypto is not available.", "error");
    return;
  }

  generateKeyBtn.disabled = true;
  setStatus("Generating keypair...");

  try {
    const keys = await generateAndStoreStudentKeys(studentId);
    publicKeyInput.value = keys.publicKeyPem;
    setStatus("Keypair generated. Public key is auto-filled.", "success");
  } catch {
    setStatus("Unable to generate keypair.", "error");
  } finally {
    generateKeyBtn.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const studentId = studentIdInput.value.trim().toUpperCase();
  const publicKey = publicKeyInput.value.trim();

  if (!studentId || !publicKey) {
    setStatus("Student ID and public key are required.", "error");
    return;
  }

  if (!STUDENT_ID_REGEX.test(studentId)) {
    setStatus("Student ID format must be 2 digits + 3 uppercase letters + 4 digits (example: 23BCE1999).", "error");
    return;
  }

  setStatus("Registering student key...");

  try {
    const response = await fetch("/api/students/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id: studentId,
        public_key: publicKey
      })
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.message || "Registration failed");
    }

    setStatus(data.message, "success");
    form.reset();
    await loadStudents();
  } catch (err) {
    setStatus(err.message, "error");
  }
});

listBodyEl.addEventListener("click", async (event) => {
  const button = event.target.closest(".student-delete-btn");
  if (!button) {
    return;
  }

  const studentId = button.getAttribute("data-student-id");
  if (!studentId) {
    return;
  }

  await deleteStudent(studentId);
});

logoutBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "/login";
  }
});

loadStudents();
