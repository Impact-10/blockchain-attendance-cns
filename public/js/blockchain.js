const blockGridEl = document.getElementById("blockGrid");
const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refreshBtn");
const logoutBtn = document.getElementById("logoutBtn");

function setStatus(message, mode = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${mode}`.trim();
}

function shortHash(value) {
  if (!value) {
    return "-";
  }
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function renderBlocks(chain) {
  blockGridEl.innerHTML = chain
    .map(
      (block) => `
        <article class="block-card">
          <h3>Block #${block.index}</h3>
          <p><strong>Timestamp:</strong> ${new Date(block.timestamp).toLocaleString()}</p>
          <p><strong>Merkle Root:</strong> <span class="mono merkle-highlight">${shortHash(block.merkle_root)}</span></p>
          <p><strong>Previous Hash:</strong> <span class="mono">${shortHash(block.previous_hash)}</span></p>
          <p><strong>Record Count:</strong> ${block.record_count || 0}</p>
        </article>
      `
    )
    .join("");
}

async function loadChain() {
  setStatus("Loading blockchain...");
  try {
    const response = await fetch("/api/blockchain");
    const data = await response.json();

    renderBlocks(data.chain || []);
    setStatus(data.chain_valid ? "Chain valid" : "Chain integrity failed", data.chain_valid ? "success" : "error");
  } catch (err) {
    setStatus(err.message, "error");
  }
}

refreshBtn.addEventListener("click", loadChain);
logoutBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "/login";
  }
});
loadChain();
setInterval(loadChain, 3000);
