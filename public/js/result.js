const params = new URLSearchParams(window.location.search);
const status = params.get("status") || "failure";
const message = params.get("message") || "Unknown result";
const studentId = params.get("student_id") || "-";
const time = params.get("time");

const resultIconEl = document.getElementById("resultIcon");
const messageEl = document.getElementById("message");
const studentMetaEl = document.getElementById("studentMeta");
const timeMetaEl = document.getElementById("timeMeta");
const logoutBtn = document.getElementById("logoutBtn");

const isSuccess = status === "success";

resultIconEl.textContent = isSuccess ? "✓" : "✕";
resultIconEl.className = `result-icon ${isSuccess ? "ok" : "bad"}`;
messageEl.textContent = isSuccess ? "Attendance Verified" : message;
messageEl.style.color = isSuccess ? "#067647" : "#b42318";

studentMetaEl.textContent = studentId;
timeMetaEl.textContent = time ? new Date(time).toLocaleString() : new Date().toLocaleString();

logoutBtn.addEventListener("click", async () => {
	try {
		await fetch("/api/auth/logout", { method: "POST" });
	} finally {
		window.location.href = "/login";
	}
});
