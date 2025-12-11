// ==== 過濾 PanelScan 錯誤訊息（只動前端，不改腳本貓）====
(function () {
  const rawLog = console.log;

  console.log = function (...args) {
    try {
      const first = args[0];
      const msg = typeof first === "string" ? first : "";
      if (
        msg.includes("[PanelScan]") &&
        msg.includes("找不到 身體 / 腳底 panel")
      ) {
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
const LIFF_ID = "2008669658-jQqr9Ge4";

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

// ===== ScriptCat 顏色解析工具 =====

// 把 "#rrggbb" 轉成 { r, g, b }
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

// 從像是 "text-C333333 text-opacity-60" 這種字串裡，抓出顏色 + 透明度
function parseScriptCatColor(colorStr) {
  if (!colorStr) return { color: null, opacity: null };

  const tokens = String(colorStr)
    .split(/\s+/)
    .filter(Boolean);

  let hex = null;
  let opacity = null;

  tokens.forEach((t) => {
    // text-Cxxxxxx
    if (t.startsWith("text-C")) {
      let raw = t.slice("text-".length); // 例如 "C333333"
      if (/^C[0-9A-Fa-f]{6}$/.test(raw)) {
        raw = raw.slice(1); // "333333"
      }
      if (/^[0-9A-Fa-f]{6}$/.test(raw)) {
        hex = "#" + raw;
      }
    }

    // text-opacity-60 / text-opacity-0.6
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

// 套用 ScriptCat 顏色到某個 element 的文字顏色
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
function fmtRemaining(v) {
  if (v === "" || v === null || v === undefined) return "";

  const num = Number(v);
  if (Number.isNaN(num)) return "";

  if (num > 0) return `剩餘 ${num} 分鐘`;
  if (num < 0) return `超時 ${Math.abs(num)} 分鐘`;
  return "即將結束";
}

function fmtTimeCell(v) {
  if (!v) return "";

  if (typeof v === "number") {
    return fmtRemaining(v);
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

function deriveStatusClass(status, remaining) {
  const s = String(status || "");

  if (s.includes("工作")) {
    return "status-busy";
  }
  if (s.includes("預約")) {
    return "status-booked";
  }

  const n = Number(remaining);
  if (!Number.isNaN(n) && n <= 0) {
    return "status-free";
  }

  return "status-other";
}

// ===== 轉成畫面用 row =====
function mapRowsToDisplay(rows) {
  return rows.map((row) => {
    const remaining = row.remaining;
    return {
      sort: row.sort,
      masterId: row.masterId,
      status: row.status,
      appointment: row.appointment,

      colorIndex: row.colorIndex || "",
      colorMaster: row.colorMaster || "",
      colorStatus: row.colorStatus || "",

      remainingDisplay: fmtRemaining(remaining),
      statusClass: deriveStatusClass(row.status, remaining),
      timeDisplay: fmtTimeCell(row.appointment),
    };
  });
}

// ===== 渲染 =====
function render() {
  if (!tbodyRowsEl) return;

  const list = activePanel === "body" ? rawData.body : rawData.foot;
  const displayRows = mapRowsToDisplay(applyFilters(list));

  tbodyRowsEl.innerHTML = "";

  if (!displayRows.length) {
    if (emptyStateEl) emptyStateEl.style.display = "block";
  } else {
    if (emptyStateEl) emptyStateEl.style.display = "none";
  }

  displayRows.forEach((row) => {
    const tr = document.createElement("tr");

    // 順序欄位（colorIndex）
    const tdOrder = document.createElement("td");
    tdOrder.textContent = row.sort || "";
    tdOrder.className = "cell-order";
    if (row.colorIndex) {
      applyScriptCatColorToElement(tdOrder, row.colorIndex);
    }
    tr.appendChild(tdOrder);

    // 師傅欄位（colorMaster）
    const tdMaster = document.createElement("td");
    tdMaster.textContent = row.masterId || "";
    tdMaster.className = "cell-master";
    if (row.colorMaster) {
      applyScriptCatColorToElement(tdMaster, row.colorMaster);
    }
    tr.appendChild(tdMaster);

    // 狀態欄位（colorStatus + 主題 pill）
    const tdStatus = document.createElement("td");
    const statusSpan = document.createElement("span");

    statusSpan.className = "status-pill " + row.statusClass;
    if (row.colorStatus) {
      applyScriptCatColorToElement(statusSpan, row.colorStatus);
    }

    statusSpan.textContent = row.status || "";
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);

    // 預約欄位
    const tdAppointment = document.createElement("td");
    tdAppointment.textContent = row.appointment || "";
    tdAppointment.className = "cell-appointment";
    tr.appendChild(tdAppointment);

    // 剩餘時間欄位
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

// ===== 過濾器 =====
function applyFilters(list) {
  return list.filter((row) => {
    if (filterMaster) {
      const key = String(filterMaster).trim();
      if (!String(row.masterId || "").includes(key)) {
        return false;
      }
    }

    if (filterStatus === "all") return true;

    const status = String(row.status || "");
    const remainingDisplay = fmtRemaining(row.remaining || "");

    if (filterStatus === "busy") {
      return status.includes("工作") || status.includes("預約");
    }

    if (filterStatus === "free") {
      return (
        status.includes("空閒") ||
        status.includes("休息") ||
        remainingDisplay.includes("超時") ||
        remainingDisplay.includes("即將結束")
      );
    }

    return true;
  });
}

// ===== 抓 Status GAS（一次拿 body + foot）=====
async function fetchStatusAll() {
  const resp = await fetch(STATUS_API_URL, { method: "GET" });

  if (!resp.ok) {
    throw new Error("Status HTTP " + resp.status);
  }

  const data = await resp.json();
  console.log("[Status] raw from GAS:", data);

  if (data.ok === false) {
    throw new Error(data.error || "Status response not ok");
  }

  const bodyRows = Array.isArray(data.body) ? data.body : [];
  const footRows = Array.isArray(data.foot) ? data.foot : [];

  return { bodyRows, footRows };
}

async function refreshStatus() {
  if (loadingStateEl) loadingStateEl.style.display = "flex";
  if (errorStateEl) errorStateEl.style.display = "none";

  try {
    const { bodyRows, footRows } = await fetchStatusAll();

    rawData.body = bodyRows;
    rawData.foot = footRows;

    if (connectionStatusEl) {
      connectionStatusEl.textContent = "已連線";
    }

    if (lastUpdateEl) {
      const now = new Date();
      lastUpdateEl.textContent =
        "更新：" +
        now.getHours().toString().padStart(2, "0") +
        ":" +
        now.getMinutes().toString().padStart(2, "0");
    }

    render();
  } catch (err) {
    console.error("[Status] 取得狀態失敗：", err);
    if (connectionStatusEl) {
      connectionStatusEl.textContent = "異常";
    }
    if (errorStateEl) errorStateEl.style.display = "block";
  } finally {
    if (loadingStateEl) loadingStateEl.style.display = "none";
  }
}

// ===== 審核相關：方案 B =====
async function checkOrRegisterUser(userId, displayName) {
  const url =
    AUTH_API_URL + "?mode=check&userId=" + encodeURIComponent(userId);

  const resp = await fetch(url, { method: "GET" });
  if (!resp.ok) {
    throw new Error("Check HTTP " + resp.status);
  }

  const data = await resp.json();
  const status = (data && data.status) || "none";
  const audit = (data && data.audit) || "";

  if (status === "approved") {
    return { allowed: true, status: "approved", audit };
  }

  if (status === "pending") {
    return { allowed: false, status: "pending", audit };
  }

  showGate("此帳號目前沒有使用權限，已自動送出審核申請…");

  try {
    await registerUser(userId, displayName);
  } catch (e) {
    console.error("[Register] 寫入 AUTH GAS 失敗：", e);
    return { allowed: false, status: "error", audit: "" };
  }

  return { allowed: false, status: "pending", audit: "待審核" };
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
  console.log("[Auth] register result", data);
  return data;
}

// ===== 主題切換（亮 / 暗）=====
function setTheme(theme) {
  const root = document.documentElement;
  const finalTheme = theme === "light" ? "light" : "dark";

  root.setAttribute("data-theme", finalTheme);
  localStorage.setItem("dashboardTheme", finalTheme);

  if (themeToggleBtn) {
    themeToggleBtn.textContent =
      finalTheme === "dark" ? "🌙 深色" : "☀️ 淺色";
  }
}

(function initTheme() {
  const saved = localStorage.getItem("dashboardTheme") || "dark";
  setTheme(saved);
})();

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const current =
      document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    setTheme(next);
  });
}

// ===== LIFF 初始化與權限 Gate =====
async function initLiffAndGuard() {
  showGate("正在啟動 LIFF…");

  try {
    await liff.init({ liffId: LIFF_ID });

    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    showGate("正在取得使用者資訊…");

    const ctx = liff.getContext();
    const profile = await liff.getProfile();

    const userId = profile.userId || (ctx && ctx.userId) || "";
    const displayName = profile.displayName || "";

    if (!userId) {
      showGate("無法取得使用者 ID，請重新開啟 LIFF。", true);
      return;
    }

    showGate("正在確認使用權限…");

    const result = await checkOrRegisterUser(userId, displayName);

    if (result.allowed && result.status === "approved") {
      showGate("驗證通過，正在載入資料…");
      openApp();
      startApp();
      return;
    }

    if (result.status === "pending") {
      const auditText = result.audit || "待審核";

      let msg = "此帳號目前尚未通過審核。\n";
      msg += "目前審核狀態：「" + auditText + "」。\n\n";

      if (auditText === "拒絕" || auditText === "停用") {
        msg += "如需重新申請或有疑問，請聯絡店家確認原因。";
      } else {
        msg += "若你已經等待一段時間，請聯絡店家確認審核進度。";
      }

      showGate(msg);
      return;
    }

    if (result.status === "error") {
      showGate("⚠ 無法送出審核申請，請稍後再試。", true);
      return;
    }

    showGate("⚠ 無法確認使用權限，請稍後再試。", true);
  } catch (err) {
    console.error("[LIFF] 初始化或驗證失敗：", err);
    showGate("⚠ LIFF 初始化或權限驗證失敗，請稍後再試。", true);
  }
}

// ===== 事件綁定 =====
if (tabBodyBtn) {
  tabBodyBtn.addEventListener("click", () => setActivePanel("body"));
}
if (tabFootBtn) {
  tabFootBtn.addEventListener("click", () => setActivePanel("foot"));
}
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

// ===== 入口：window onload =====
window.addEventListener("load", () => {
  initLiffAndGuard();
});
