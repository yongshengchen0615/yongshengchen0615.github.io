// ===== 師傅狀態 Web App URL =====
const TECH_API_URL =
  "https://script.google.com/macros/s/AKfycbwXwpKPzQFuIWtZOJpeGU9aPbl3RR5bj9yVWjV7mfyYaABaxMetKn_3j_mdMJGN9Ok5Ug/exec";

// 想顯示的師傅 ID
const TARGET_MASTER_ID = "10";

/* ========== 主題切換 ========== */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}

function initTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  applyTheme(saved);

  document.getElementById("themeToggleBtn").onclick = () => {
    const now = document.documentElement.getAttribute("data-theme");
    applyTheme(now === "dark" ? "light" : "dark");
  };
}

/* ========== Loading ========== */
function showApp() {
  document.getElementById("loadingOverlay").classList.add("hidden");
  document.getElementById("appContainer").style.display = "block";
}

/* ========== 工具 ========== */
function normalize(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

function classifyStatus(text) {
  if (!text) return "off";
  if (text.includes("工作")) return "busy";
  if (text.includes("上班") || text.includes("可預約")) return "idle";
  if (text.includes("休") || text.includes("下班")) return "off";
  return "idle";
}

function updateStatusUI(kind, data) {
  const statusEl = document.getElementById(kind + "StatusText");
  const apptEl = document.getElementById(kind + "AppointmentText");
  const remEl = document.getElementById(kind + "RemainingText");

  if (!data) {
    statusEl.innerHTML = `<span class="status-pill status-off">無資料</span>`;
    apptEl.innerText = "-";
    remEl.innerText = "-";
    return;
  }

  const bucket = classifyStatus(data.status);

  statusEl.innerHTML = `<span class="status-pill status-${bucket}">${data.status}</span>`;
  apptEl.innerText = data.appointment || "無預約";
  remEl.innerText = data.remaining || "-";
}

/* ========== 取得資料 ========== */
async function loadTechStatus() {
  const res = await fetch(TECH_API_URL);
  const json = await res.json();

  const target = normalize(TARGET_MASTER_ID);

  const body = json.body?.find(r => normalize(r.masterId) === target);
  const foot = json.foot?.find(r => normalize(r.masterId) === target);

  updateStatusUI("body", body);
  updateStatusUI("foot", foot);
}

/* ========== 初始化 ========== */
window.onload = () => {
  initTheme();

  document.getElementById("techMasterId").textContent = TARGET_MASTER_ID;

  loadTechStatus().then(() => {
    showApp();
    setInterval(loadTechStatus, 10000);
  });
};
