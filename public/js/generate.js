const generateBtn = document.getElementById("generateBtn");
const finalizeBtn = document.getElementById("finalizeBtn");
const overrideBtn = document.getElementById("overrideBtn");
const logoutBtn = document.getElementById("logoutBtn");
const codeBox = document.getElementById("codeBox");
const statusEl = document.getElementById("status");

function setStatus(message, mode = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${mode}`.trim();
}

generateBtn.addEventListener("click", async () => {
  setStatus("Generating code...");
  try {
    const res = await fetch("/api/faculty/generate-code", { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.message || "Unable to generate code");
    }

    codeBox.textContent = data.code;
    window.localStorage.setItem("latestAttendanceCode", data.code);
    setStatus(`Valid until ${new Date(data.expiresAt).toLocaleTimeString()}`, "success");
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

    window.localStorage.removeItem("latestAttendanceCode");
    setStatus(`Finalized in block #${data.block.index}`, "success");
  } catch (err) {
    setStatus(err.message, "error");
  }
});

overrideBtn.addEventListener("click", async () => {
  const studentId = window.prompt("Enter student ID to override:");
  if (!studentId) {
    return;
  }
  const reason = window.prompt("Enter override reason:") || "Manual override";

  setStatus("Saving override...");
  try {
    const res = await fetch("/api/faculty/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id: studentId,
        reason,
        faculty_id: "FACULTY-1"
      })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.message || "Override failed");
    }
    setStatus(data.message, "success");
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
