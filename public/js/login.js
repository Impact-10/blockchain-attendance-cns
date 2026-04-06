const form = document.getElementById("loginForm");
const statusEl = document.getElementById("status");
const loginBtn = document.getElementById("loginBtn");

function setStatus(message, mode = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${mode}`.trim();
}

async function checkExistingSession() {
  try {
    const response = await fetch("/api/auth/me");
    const data = await response.json();
    if (!response.ok || !data.ok) {
      return;
    }

    const redirectTo = data.user?.role === "faculty" ? "/generate" : "/submit";
    window.location.href = redirectTo;
  } catch {
    // Ignore and show login form.
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.getElementById("loginId").value.trim();
  const password = document.getElementById("loginPassword").value.trim();

  if (!id || !password) {
    setStatus("ID and password are required.", "error");
    return;
  }

  loginBtn.disabled = true;
  setStatus("Signing in...");

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "Login failed");
    }

    window.location.href = data.redirectTo || "/";
  } catch (err) {
    setStatus(err.message, "error");
    loginBtn.disabled = false;
  }
});

checkExistingSession();
