// ==== 過濾 PanelScan 錯誤訊息（只動前端，不改腳本貓）====
(function () {
  const rawLog = console.log;

  console.log = function (...args) {
    try {
      // 把第一個參數轉成字串檢查
      const first = args[0];
      const msg = typeof first === "string" ? first : "";

      // 如果是 PanelScan 找不到 panel 的那句，就直接略過
      if (
        msg.includes("[PanelScan]") &&
        msg.includes("找不到 身體 / 腳底 panel")
      ) {
        return;
      }
    } catch (e) {
      // 防禦性：什麼事都不要讓 console.log 本身拋錯
    }

    // 其餘 log 正常印出
    rawLog.apply(console, args);
  };
})();

// ★ 換成你的 GAS Web App URL
// A：師傅狀態（身體 / 腳底）
const STATUS_API_URL =
  "https://script.google.com/macros/s/AKfycbwXwpKPzQFuIWtZOJpeGU9aPbl3RR5bj9yVWjV7mfyYaABaxMetKn_3j_mdMJGN9Ok5Ug/exec";

// B：使用者權限（UUID + 名稱 + 審核）
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

  // 如果是純數字，就當成「剩餘分鐘」顯示在右邊
  if (typeof v === "number") {
    return fmtRemaining(v);
  }

  // 如果是 Date 物件
  if (v instanceof Date) {
    const d = v;
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    if (hh === "00" && mm === "00") return "";
    return `${hh}:${mm}`;
  }

  let s = String(v).trim();
  if (!s) return "";

  // ISO 8601（"2025-01-01T07:00:00.000Z"）
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const d = new Date(s);
    if (isNaN(d.getTime())) return "";
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    if (hh === "00" && mm === "00") return "";
    return `${hh}:${mm}`;
  }

  // 其他字串就原樣顯示
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

  // 如果是「空閒 / 休息 / 未上班」之類
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

    const tdOrder = document.createElement("td");
    tdOrder.textContent = row.sort || "";
    tr.appendChild(tdOrder);

    const tdMaster = document.createElement("td");
    tdMaster.textContent = row.masterId || "";
    tr.appendChild(tdMaster);

    const tdStatus = document.createElement("td");
    const statusSpan = document.createElement("span");
    statusSpan.className = "status-pill " + row.statusClass;
    statusSpan.textContent = row.status || "";
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);

    const tdAppointment = document.createElement("td");
    tdAppointment.textContent = row.appointment || "";
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

// ===== 過濾器 =====
function applyFilters(list) {
  return list.filter((row) => {
    // 搜尋師傅
    if (filterMaster) {
      const key = String(filterMaster).trim();
      if (!String(row.masterId || "").includes(key)) {
        return false;
      }
    }

    // 狀態過濾
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

// ===== 抓 Status GAS =====
async function fetchStatus(panelType) {
  const url = STATUS_API_URL + "?type=" + encodeURIComponent(panelType);

  const resp = await fetch(url, { method: "GET" });
  if (!resp.ok) {
    throw new Error("Status HTTP " + resp.status);
  }

  const data = await resp.json();
  // 預期格式：{ ok: true, rows: [...] }
  if (!data || !data.ok) {
    throw new Error("Status response not ok");
  }
  return data.rows || [];
}

async function refreshStatus() {
  if (loadingStateEl) loadingStateEl.style.display = "flex";
  if (errorStateEl) errorStateEl.style.display = "none";

  try {
    const [bodyRows, footRows] = await Promise.all([
      fetchStatus("body"),
      fetchStatus("foot"),
    ]);

    rawData.body = Array.isArray(bodyRows) ? bodyRows : [];
    rawData.foot = Array.isArray(footRows) ? footRows : [];

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
    AUTH_API_URL +
    "?mode=check&userId=" +
    encodeURIComponent(userId);

  const resp = await fetch(url, { method: "GET" });
  if (!resp.ok) {
    throw new Error("Check HTTP " + resp.status);
  }

  // 預期 GAS 回傳：
  // { status: "approved" | "pending" | "none", audit?: "待審核" | "拒絕" | "停用" | ... }
  const data = await resp.json();
  const status = (data && data.status) || "none";
  const audit = (data && data.audit) || "";

  if (status === "approved") {
    return { allowed: true, status: "approved", audit };
  }

  if (status === "pending") {
    return { allowed: false, status: "pending", audit };
  }

  // status === "none" → 幫他註冊
  showGate("此帳號目前沒有使用權限，已自動送出審核申請…");

  try {
    await registerUser(userId, displayName);
  } catch (e) {
    console.error("[Register] 寫入 AUTH GAS 失敗：", e);
    return { allowed: false, status: "error", audit: "" };
  }

  // 新註冊的一律視為待審核
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

  // 可視需要：定時刷新
  setInterval(() => {
    refreshStatus();
  }, 30 * 1000);
}

// ===== 入口：window onload =====
window.addEventListener("load", () => {
  initLiffAndGuard();
});
