// ==== 過濾 PanelScan 錯誤訊息（只動前端，不改腳本貓）====
(function () {
  const rawLog = console.log;

  console.log = function (...args) {
    try {
      const first = args[0];
      const msg = typeof first === "string" ? first : "";
      if (msg.includes("[PanelScan]") && msg.includes("找不到 身體 / 腳底 panel")) {
        return;
      }
    } catch (e) {}
    rawLog.apply(console, args);
  };
})();

// ★ 換成你的 GAS Web App URL
// A：師傅狀態（身體 / 腳底）→ 面板 GAS
const STATUS_API_URL =
  "https://script.google.com/macros/s/AKfycbwXwpKPzQFuIWtZOJpeGU9aPbl3RR5bj9yVWjV7mfyYaABaxMetKn_3j_mdMJGN9Ok5Ug/exec";

// B：使用者權限（UUID + 名稱 + 審核）→ Users 認證 GAS
const AUTH_API_URL =
  "https://script.google.com/macros/s/AKfycbzYgHZiXNKR2EZ5GVAx99ExBuDYVFYOsKmwpxev_i2aivVOwStCG_rHIik6sMuZ4KCf/exec";

// ★ LINE LIFF ID
const LIFF_ID = "2008669658-6Et3vVqv";

// 授權畫面 & 主畫面容器
const gateEl = document.getElementById("gate");
const appRootEl = document.getElementById("appRoot");

// Dashboard 用資料
const rawData = {
  body: [],
  foot: [],
};

let activePanel = "body";
let filterMaster = "";
let filterStatus = "all";

// DOM
const connectionStatusEl = document.getElementById("connectionStatus");
const refreshBtn = document.getElementById("refreshBtn");
const tabBodyBtn = document.getElementById("tabBody");
const tabFootBtn = document.getElementById("tabFoot");
const filterMasterInput = document.getElementById("filterMaster");
const filterStatusSelect = document.getElementById("filterStatus");
const panelTitleEl = document.getElementById("panelTitle");
const lastUpdateEl = document.getElementById("lastUpdate");
const tbodyRowsEl = document.getElementById("tbodyRows");
const emptyStateEl = document.getElementById("emptyState");
const loadingStateEl = document.getElementById("loadingState");
const errorStateEl = document.getElementById("errorState");
const themeToggleBtn = document.getElementById("themeToggle");

// 🔔 使用者名稱 + 剩餘天數橫幅 DOM
const usageBannerEl = document.getElementById("usageBanner");
const usageBannerTextEl = document.getElementById("usageBannerText");

// ===== Gate 顯示工具 =====
function showGate(message, isError) {
  if (!gateEl) return;

  gateEl.classList.remove("gate-hidden");
  gateEl.innerHTML =
    '<div class="gate-message' +
    (isError ? " gate-message-error" : "") +
    '"><p>' +
    String(message || "").replace(/\n/g, "<br>") +
    "</p></div>";
}

function hideGate() {
  if (!gateEl) return;
  gateEl.classList.add("gate-hidden");
}

function openApp() {
  hideGate();
  if (!appRootEl) return;
  appRootEl.classList.remove("app-hidden");
}

// ===== 使用時間頂端橫幅 =====
function updateUsageBanner(displayName, remainingDays) {
  if (!usageBannerEl || !usageBannerTextEl) return;

  // 若沒有名稱也沒有天數，就隱藏
  if (!displayName && (remainingDays === null || remainingDays === undefined)) {
    usageBannerEl.style.display = "none";
    return;
  }

  let msg = "";

  if (displayName) {
    msg += `使用者：${displayName}  `;
  }

  if (typeof remainingDays === "number" && !Number.isNaN(remainingDays)) {
    if (remainingDays > 0) {
      msg += `｜剩餘使用天數：${remainingDays} 天`;
    } else if (remainingDays === 0) {
      msg += "｜今天為最後使用日";
    } else {
      msg += `｜使用期限已過期（${remainingDays} 天）`;
    }
  } else {
    msg += "｜剩餘使用天數：－";
  }

  usageBannerTextEl.textContent = msg;
  usageBannerEl.style.display = "flex";

  // 調整顏色狀態
  usageBannerEl.classList.remove("usage-banner-warning", "usage-banner-expired");
  if (typeof remainingDays === "number" && !Number.isNaN(remainingDays)) {
    if (remainingDays <= 0) {
      usageBannerEl.classList.add("usage-banner-expired");
    } else if (remainingDays <= 3) {
      usageBannerEl.classList.add("usage-banner-warning");
    }
  }
}

// ===== ScriptCat 顏色解析工具 =====
function hexToRgb(hex) {
  if (!hex) return null;
  let s = hex.replace("#", "").trim();
  if (s.length === 3) {
    s = s
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (s.length !== 6) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return { r, g, b };
}

function parseScriptCatColor(colorStr) {
  if (!colorStr) return { color: null, opacity: null };

  const tokens = String(colorStr)
    .split(/\s+/)
    .filter(Boolean);

  let hex = null;
  let opacity = null;

  tokens.forEach((t) => {
    if (t.startsWith("text-C")) {
      let raw = t.slice("text-".length); // "C333333"
      if (/^C[0-9A-Fa-f]{6}$/.test(raw)) {
        raw = raw.slice(1); // "333333"
      }
      if (/^[0-9A-Fa-f]{6}$/.test(raw)) {
        hex = "#" + raw;
      }
    }

    if (t.startsWith("text-opacity-")) {
      const vRaw = t.slice("text-opacity-".length);
      let v = parseFloat(vRaw);
      if (!Number.isNaN(v)) {
        if (v > 1) v = v / 100;
        opacity = Math.max(0, Math.min(1, v));
      }
    }
  });

  return { color: hex, opacity };
}

function applyScriptCatColorToElement(el, colorStr) {
  if (!el || !colorStr) return;

  const info = parseScriptCatColor(colorStr);
  if (!info.color) return;

  const rgb = hexToRgb(info.color);
  if (!rgb) return;

  if (info.opacity != null && info.opacity < 1) {
    el.style.color = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${info.opacity})`;
  } else {
    el.style.color = info.color;
  }
}

// ===== 資料格式工具 =====
function fmtRemainingRaw(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function fmtTimeCell(v) {
  if (!v) return "";

  if (typeof v === "number") {
    return String(v);
  }

  if (v instanceof Date) {
    const d = v;
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    if (hh === "00" && mm === "00") return "";
    return `${hh}:${mm}`;
  }

  let s = String(v).trim();
  if (!s) return "";

  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const d = new Date(s);
    if (isNaN(d.getTime())) return "";
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    if (hh === "00" && mm === "00") return "";
    return `${hh}:${mm}`;
  }

  return s;
}

// 超時也歸類在「工作中」
function deriveStatusClass(status, remaining) {
  const s = String(status || "");
  const n = Number(remaining);

  if (s.includes("工作")) return "status-busy";
  if (s.includes("預約")) return "status-booked";
  if (!Number.isNaN(n) && n < 0) return "status-busy"; // 超時 → 視為工作中

  return "status-other";
}

// ===== 轉成畫面用 row =====
function mapRowsToDisplay(rows) {
  return rows.map((row) => {
    const remaining = row.remaining === 0 || row.remaining ? row.remaining : "";

    return {
      sort: row.sort,
      index: row.index,
      masterId: row.masterId,
      status: row.status,
      appointment: row.appointment,

      colorIndex: row.colorIndex || "",
      colorMaster: row.colorMaster || "",
      colorStatus: row.colorStatus || "",

      remainingDisplay: fmtRemainingRaw(remaining),
      statusClass: deriveStatusClass(row.status, remaining),
      timeDisplay: fmtTimeCell(row.appointment),
    };
  });
}

// ===== 重建「狀態篩選」選項：列出所有實際出現過的狀態 =====
function rebuildStatusFilterOptions() {
  if (!filterStatusSelect) return;

  const statuses = new Set();

  ["body", "foot"].forEach((type) => {
    const rows = rawData[type] || [];
    rows.forEach((r) => {
      const s = String(r.status || "").trim();
      if (s) statuses.add(s);
    });
  });

  const previous = filterStatusSelect.value || "all";

  filterStatusSelect.innerHTML = "";

  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "全部狀態";
  filterStatusSelect.appendChild(optAll);

  for (const s of statuses) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    filterStatusSelect.appendChild(opt);
  }

  if (previous !== "all" && statuses.has(previous)) {
    filterStatusSelect.value = previous;
  } else {
    filterStatusSelect.value = "all";
  }

  filterStatus = filterStatusSelect.value;
}

// ===== 渲染（包含：排序 + 動態順序編號）=====
function render() {
  if (!tbodyRowsEl) return;

  const list = activePanel === "body" ? rawData.body : rawData.foot;

  // 先依目前篩選條件過濾
  const filtered = applyFilters(list);

  // 再依「sort / index」排序
  const sorted = filtered.slice().sort((a, b) => {
    const aBase = a.sort ?? a.index ?? 0;
    const bBase = b.sort ?? b.index ?? 0;
    const na = Number(aBase);
    const nb = Number(bBase);

    if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
    if (Number.isNaN(na)) return 1;
    if (Number.isNaN(nb)) return -1;
    return na - nb;
  });

  // 轉成顯示用資料（此時順序已固定）
  const displayRows = mapRowsToDisplay(sorted);

  tbodyRowsEl.innerHTML = "";

  if (!displayRows.length) {
    if (emptyStateEl) emptyStateEl.style.display = "block";
  } else {
    if (emptyStateEl) emptyStateEl.style.display = "none";
  }

  displayRows.forEach((row, idx) => {
    const tr = document.createElement("tr");

    const tdOrder = document.createElement("td");
    tdOrder.textContent = String(idx + 1);
    tdOrder.className = "cell-order";
    if (row.colorIndex) applyScriptCatColorToElement(tdOrder, row.colorIndex);
    tr.appendChild(tdOrder);

    const tdMaster = document.createElement("td");
    tdMaster.textContent = row.masterId || "";
    tdMaster.className = "cell-master";
    if (row.colorMaster) applyScriptCatColorToElement(tdMaster, row.colorMaster);
    tr.appendChild(tdMaster);

    const tdStatus = document.createElement("td");
    const statusSpan = document.createElement("span");
    statusSpan.className = "status-pill " + row.statusClass;
    if (row.colorStatus) applyScriptCatColorToElement(statusSpan, row.colorStatus);
    statusSpan.textContent = row.status || "";
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);

    const tdAppointment = document.createElement("td");
    tdAppointment.textContent = row.appointment || "";
    tdAppointment.className = "cell-appointment";
    tr.appendChild(tdAppointment);

    const tdRemaining = document.createElement("td");
    const timeSpan = document.createElement("span");
    timeSpan.className = "time-badge";
    timeSpan.textContent = row.remainingDisplay || "";
    tdRemaining.appendChild(timeSpan);
    tr.appendChild(tdRemaining);

    tbodyRowsEl.appendChild(tr);
  });

  if (panelTitleEl) {
    panelTitleEl.textContent = activePanel === "body" ? "身體面板" : "腳底面板";
  }
}

// ===== 過濾器（師傅 / 狀態）=====
function applyFilters(list) {
  return list.filter((row) => {
    if (filterMaster) {
      const key = String(filterMaster).trim();
      if (!String(row.masterId || "").includes(key)) return false;
    }

    if (filterStatus && filterStatus !== "all") {
      const status = String(row.status || "");
      if (status !== filterStatus) return false;
    }

    return true;
  });
}

// ===== 抓 Status GAS（一次拿 body + foot）=====
async function fetchStatusAll() {
  console.time("[Perf] STATUS_API fetch");
  const resp = await fetch(STATUS_API_URL, { method: "GET" });

  if (!resp.ok) {
    console.timeEnd("[Perf] STATUS_API fetch");
    throw new Error("Status HTTP " + resp.status);
  }

  const data = await resp.json();
  console.timeEnd("[Perf] STATUS_API fetch");

  if (data.ok === false) throw new Error(data.error || "Status response not ok");

  const bodyRows = Array.isArray(data.body) ? data.body : [];
  const footRows = Array.isArray(data.foot) ? data.foot : [];

  return { bodyRows, footRows };
}

async function refreshStatus() {
  if (loadingStateEl) loadingStateEl.style.display = "flex";
  if (errorStateEl) errorStateEl.style.display = "none";

  try {
    console.time("[Perf] refreshStatus total");
    const { bodyRows, footRows } = await fetchStatusAll();

    rawData.body = bodyRows;
    rawData.foot = footRows;

    rebuildStatusFilterOptions();

    if (connectionStatusEl) connectionStatusEl.textContent = "已連線";

    if (lastUpdateEl) {
      const now = new Date();
      lastUpdateEl.textContent =
        "更新：" +
        String(now.getHours()).padStart(2, "0") +
        ":" +
        String(now.getMinutes()).padStart(2, "0");
    }

    render();
    console.timeEnd("[Perf] refreshStatus total");
  } catch (err) {
    console.error("[Status] 取得狀態失敗：", err);
    if (connectionStatusEl) connectionStatusEl.textContent = "異常";
    if (errorStateEl) errorStateEl.style.display = "block";
    console.timeEnd("[Perf] refreshStatus total");
  } finally {
    if (loadingStateEl) loadingStateEl.style.display = "none";
  }
}

/* =========================
 * ✅ 使用者更名同步（以 GAS 為準判斷 LINE 是否改名）
 * ========================= */

// 規則：
// - 以 GAS 回傳的 displayName 當作舊名
// - 以 LIFF profile.displayName 當作新名
// - 若新名存在且與舊名不同 → 呼叫 register 更新（GAS 端已是「改名才更新」）
async function syncDisplayNameIfChanged_(userId, liffName, gasName) {
  const newName = String(liffName || "").trim();
  const oldName = String(gasName || "").trim();

  if (!userId) return false;
  if (!newName) return false;

  // GAS 沒名字 or 不同 → 更新
  if (!oldName || oldName !== newName) {
    try {
      await registerUser(userId, newName);
      console.log("[NameSync] updated:", { oldName, newName });
      return true;
    } catch (e) {
      console.warn("[NameSync] update failed:", e);
      return false;
    }
  }
  return false;
}

// ===== 審核相關 =====
async function checkOrRegisterUser(userId, displayNameFromLiff) {
  const url = AUTH_API_URL + "?mode=check&userId=" + encodeURIComponent(userId);

  const resp = await fetch(url, { method: "GET" });
  if (!resp.ok) throw new Error("Check HTTP " + resp.status);

  const data = await resp.json();
  const status = (data && data.status) || "none";
  const audit = (data && data.audit) || "";

  // ✅ GAS 上的名字（舊名）
  const serverDisplayName = (data && data.displayName) || "";

  // remainingDays
  let remainingDays = null;
  if (data && data.remainingDays !== undefined && data.remainingDays !== null) {
    const n = Number(data.remainingDays);
    if (!Number.isNaN(n)) remainingDays = n;
  }

  const finalDisplayName = serverDisplayName || displayNameFromLiff || "";

  if (status === "approved") {
    return {
      allowed: true,
      status: "approved",
      audit,
      remainingDays,
      displayName: finalDisplayName,
      serverDisplayName, // ✅帶出去做比對
    };
  }

  if (status === "pending") {
    return {
      allowed: false,
      status: "pending",
      audit,
      remainingDays,
      displayName: finalDisplayName,
      serverDisplayName, // ✅帶出去做比對
    };
  }

  // none：自動送出審核
  showGate("此帳號目前沒有使用權限，已自動送出審核申請…");

  try {
    await registerUser(userId, finalDisplayName);
  } catch (e) {
    console.error("[Register] 寫入 AUTH GAS 失敗：", e);
    return {
      allowed: false,
      status: "error",
      audit: "",
      remainingDays: null,
      displayName: finalDisplayName,
      serverDisplayName,
    };
  }

  return {
    allowed: false,
    status: "pending",
    audit: "待審核",
    remainingDays: null,
    displayName: finalDisplayName,
    serverDisplayName,
  };
}

async function registerUser(userId, displayName) {
  const url =
    AUTH_API_URL +
    "?mode=register" +
    "&userId=" +
    encodeURIComponent(userId) +
    "&displayName=" +
    encodeURIComponent(displayName || "");

  const resp = await fetch(url, { method: "GET" });

  if (!resp.ok) {
    console.error("[Auth] register HTTP error", resp.status, resp.statusText);
    throw new Error("Register HTTP " + resp.status);
  }

  const data = await resp.json();
  return data;
}

// ===== 主題切換（亮 / 暗）=====
function setTheme(theme) {
  const root = document.documentElement;
  const finalTheme = theme === "light" ? "light" : "dark";

  root.setAttribute("data-theme", finalTheme);
  localStorage.setItem("dashboardTheme", finalTheme);

  if (themeToggleBtn) {
    themeToggleBtn.textContent = finalTheme === "dark" ? "🌙 深色" : "☀️ 淺色";
  }
}

(function initTheme() {
  const saved = localStorage.getItem("dashboardTheme") || "dark";
  setTheme(saved);
})();

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    setTheme(next);
  });
}

// ===== LIFF 初始化與權限 Gate =====
async function initLiffAndGuard() {
  console.time("[Perf] LIFF+Auth");
  showGate("正在啟動 LIFF…");

  try {
    console.time("[Perf] liff.init");
    await liff.init({ liffId: LIFF_ID });
    console.timeEnd("[Perf] liff.init");

    if (!liff.isLoggedIn()) {
      liff.login();
      console.timeEnd("[Perf] LIFF+Auth");
      return;
    }

    showGate("正在取得使用者資訊…");
    console.time("[Perf] liff.getProfile");
    const ctx = liff.getContext();
    const profile = await liff.getProfile();
    console.timeEnd("[Perf] liff.getProfile");

    const userId = profile.userId || (ctx && ctx.userId) || "";
    const displayName = profile.displayName || "";

    window.currentUserId = userId;
    window.currentDisplayName = displayName;

    if (!userId) {
      showGate("無法取得使用者 ID，請重新開啟 LIFF。", true);
      console.timeEnd("[Perf] LIFF+Auth");
      return;
    }

    showGate("正在確認使用權限…");
    console.time("[Perf] checkOrRegisterUser");
    const result = await checkOrRegisterUser(userId, displayName);
    console.timeEnd("[Perf] checkOrRegisterUser");

    // ✅ 更名同步（以 GAS 為準：GAS 舊名 vs LIFF 新名）
    await syncDisplayNameIfChanged_(userId, displayName, result.serverDisplayName);

    // ✅ 畫面顯示以「最新 LINE 名」為優先（同步後 GAS 也會更新）
    const finalDisplayName = (displayName || result.displayName || "").trim();
    window.currentDisplayName = finalDisplayName;

    if (result.allowed && result.status === "approved") {
      showGate("驗證通過，正在載入資料…");
      openApp();

      updateUsageBanner(finalDisplayName, result.remainingDays);

      console.time("[Perf] first refreshStatus");
      startApp();
      console.timeEnd("[Perf] first refreshStatus");
      console.timeEnd("[Perf] LIFF+Auth");
      return;
    }

    if (result.status === "pending") {
      const auditText = result.audit || "待審核";

      let msg = "此帳號目前尚未通過審核。\n";
      msg += "目前審核狀態：「" + auditText + "」。\n\n";

      if (auditText === "拒絕" || auditText === "停用") {
        msg += "如需重新申請或有疑問，請聯絡管理員。";
      } else {
        msg += "若你已經等待一段時間，請聯絡管理員確認審核進度。";
      }

      showGate(msg);
      console.timeEnd("[Perf] LIFF+Auth");
      return;
    }

    if (result.status === "error") {
      showGate("⚠ 無法送出審核申請，請稍後再試。", true);
      console.timeEnd("[Perf] LIFF+Auth");
      return;
    }

    showGate("⚠ 無法確認使用權限，請稍後再試。", true);
    console.timeEnd("[Perf] LIFF+Auth");
  } catch (err) {
    console.error("[LIFF] 初始化或驗證失敗：", err);
    showGate("⚠ LIFF 初始化或權限驗證失敗，請稍後再試。", true);
    console.timeEnd("[Perf] LIFF+Auth");
  }
}

// ===== 事件綁定 =====
if (tabBodyBtn) tabBodyBtn.addEventListener("click", () => setActivePanel("body"));
if (tabFootBtn) tabFootBtn.addEventListener("click", () => setActivePanel("foot"));

if (filterMasterInput) {
  filterMasterInput.addEventListener("input", (e) => {
    filterMaster = e.target.value || "";
    render();
  });
}

if (filterStatusSelect) {
  filterStatusSelect.addEventListener("change", (e) => {
    filterStatus = e.target.value || "all";
    render();
  });
}

if (refreshBtn) {
  refreshBtn.addEventListener("click", () => {
    refreshStatus();
  });
}

// ===== Panel 切換 =====
function setActivePanel(panel) {
  activePanel = panel;

  if (!tabBodyBtn || !tabFootBtn) return;

  if (panel === "body") {
    tabBodyBtn.classList.add("tab-active");
    tabFootBtn.classList.remove("tab-active");
  } else {
    tabFootBtn.classList.add("tab-active");
    tabBodyBtn.classList.remove("tab-active");
  }

  render();
}

// ===== App 啟動 =====
function startApp() {
  setActivePanel("body");
  refreshStatus();

  setInterval(() => {
    refreshStatus();
  }, 30 * 1000);
}

// ===== 入口 =====
window.addEventListener("load", () => {
  initLiffAndGuard();
});
