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

/* =========================================================
 * ✅ 分流設定：10 個 Edge GAS（Status 讀取分流）
 * ========================================================= */

// ★ 換成你的 Edge GAS Web App URL（/exec 結尾）
const EDGE_STATUS_URLS = [
  "https://script.google.com/macros/s/AKfycbyCS69SlJi7T_BYpk7rbyDl52PKGvLJHCrQeUGeQ78G-oxDui_kiAndm4cmXJLCixYZGQ/exec",
  "https://script.google.com/macros/s/AKfycbxZgErdlrmSbPPe6rA4HK4CmqZJmGMzIW4Eno8TTbRcnnM-s4DteRM2DPzl7PJBG34n-Q/exec",
  "https://script.google.com/macros/s/AKfycbxSypQ2Jx3VjyWw266dlWrX863SwPFC1l60FB9xvaLF1sUOEgqWWWIaj6k11ODXLUwdnw/exec",
  "https://script.google.com/macros/s/AKfycbw9vUkS4jC-PPJtQXu6FolZxYliIEKY3nGpbG7_qVUeAxS0bGadaN3pi9ekylZO_1DKR/exec",
  "https://script.google.com/macros/s/AKfycbxAb50G7pNHLrcNUr_56kIZMkFldQ26nmglSDIodGiLV8Ya6Ur9QMelN6eXXrOeamd8/exec",
  "https://script.google.com/macros/s/AKfycbxxg3AdVaqp3EGo-1ZpQzIshZ8_yqcvtlPtt51qoiTvfYr0xrovs44uqQjwajMACzju/exec",
];

// （可選）主站 fallback：走 cache_all（避免 Edge 偶發失敗）
const FALLBACK_ORIGIN_CACHE_URL =
  "https://script.google.com/macros/s/AKfycbwXwpKPzQFuIWtZOJpeGU9aPbl3RR5bj9yVWjV7mfyYaABaxMetKn_3j_mdMJGN9Ok5Ug/exec";

// 一致性 hash：同一 userId 永遠命中同一台 Edge
function hashToIndex_(str, mod) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return mod ? (h % mod) : 0;
}

// 取得目前使用者應該打的 Edge URL
function getStatusEdgeUrl_() {
  const uid = window.currentUserId || "";
  const idx = hashToIndex_(uid || "anonymous", EDGE_STATUS_URLS.length);
  return EDGE_STATUS_URLS[idx];
}

/* =========================================================
 * 原本你的設定
 * ========================================================= */

// ★ AUTH GAS Web App URL
const AUTH_API_URL =
  "https://script.google.com/macros/s/AKfycbzYgHZiXNKR2EZ5GVAx99ExBuDYVFYOsKmwpxev_i2aivVOwStCG_rHIik6sMuZ4KCf/exec";

const LIFF_ID = "2008669658-6Et3vVqv";

// 授權畫面 & 主畫面容器
const gateEl = document.getElementById("gate");
const appRootEl = document.getElementById("appRoot");

// ✅ Top Loading Hint DOM
const topLoadingEl = document.getElementById("topLoading");
const topLoadingTextEl = topLoadingEl ? topLoadingEl.querySelector(".top-loading-text") : null;

// Dashboard 用資料
const rawData = { body: [], foot: [] };

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

// ✅ Top Loading Hint 控制
function showLoadingHint(text) {
  if (!topLoadingEl) return;
  if (topLoadingTextEl) topLoadingTextEl.textContent = text || "資料載入中…";
  topLoadingEl.classList.remove("hidden");
}
function hideLoadingHint() {
  if (!topLoadingEl) return;
  topLoadingEl.classList.add("hidden");
}

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

  if (!displayName && (remainingDays === null || remainingDays === undefined)) {
    usageBannerEl.style.display = "none";
    return;
  }

  let msg = "";

  if (displayName) msg += `使用者：${displayName}  `;

  if (typeof remainingDays === "number" && !Number.isNaN(remainingDays)) {
    if (remainingDays > 0) msg += `｜剩餘使用天數：${remainingDays} 天`;
    else if (remainingDays === 0) msg += "｜今天為最後使用日";
    else msg += `｜使用期限已過期（${remainingDays} 天）`;
  } else {
    msg += "｜剩餘使用天數：－";
  }

  usageBannerTextEl.textContent = msg;
  usageBannerEl.style.display = "flex";

  usageBannerEl.classList.remove("usage-banner-warning", "usage-banner-expired");
  if (typeof remainingDays === "number" && !Number.isNaN(remainingDays)) {
    if (remainingDays <= 0) usageBannerEl.classList.add("usage-banner-expired");
    else if (remainingDays <= 3) usageBannerEl.classList.add("usage-banner-warning");
  }
}

/* =========================================================
 * ✅ 每日首次：由使用者傳訊息給官方帳號（只改前端）
 * - 同裝置每天一次（localStorage）
 * - 必須在 LINE App 內 (liff.isInClient) 才能 sendMessages
 * ========================================================= */
const DAILY_USER_MSG_KEY = "daily_user_first_msg_v1";

function getTodayTaipei_() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year")?.value || "0000";
  const m = parts.find((p) => p.type === "month")?.value || "00";
  const d = parts.find((p) => p.type === "day")?.value || "00";
  return `${y}-${m}-${d}`;
}

async function sendDailyFirstMessageFromUser_() {
  try {
    if (!window.liff) return;
    if (!liff.isInClient()) return; // 外部瀏覽器不送（避免 throw）

    const today = getTodayTaipei_();
    const last = localStorage.getItem(DAILY_USER_MSG_KEY) || "";
    if (last === today) return;

    const name = String(window.currentDisplayName || "").trim();
    const text = name
      ? `【每日首次開啟】${name} 已進入看板（${today}）`
      : `【每日首次開啟】使用者已進入看板（${today}）`;

    await liff.sendMessages([{ type: "text", text }]);

    // ✅ 成功才記錄
    localStorage.setItem(DAILY_USER_MSG_KEY, today);
  } catch (e) {
    console.warn("[DailyUserMessage] send failed:", e);
  }
}

// ===== ScriptCat 顏色解析工具 =====
function hexToRgb(hex) {
  if (!hex) return null;
  let s = hex.replace("#", "").trim();
  if (s.length === 3) s = s.split("").map((ch) => ch + ch).join("");
  if (s.length !== 6) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return { r, g, b };
}

function parseScriptCatColor(colorStr) {
  if (!colorStr) return { color: null, opacity: null };

  const tokens = String(colorStr).split(/\s+/).filter(Boolean);
  let hex = null;
  let opacity = null;

  tokens.forEach((t) => {
    if (t.startsWith("text-C")) {
      let raw = t.slice("text-".length);
      if (/^C[0-9A-Fa-f]{6}$/.test(raw)) raw = raw.slice(1);
      if (/^[0-9A-Fa-f]{6}$/.test(raw)) hex = "#" + raw;
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

function deriveStatusClass(status, remaining) {
  const s = String(status || "");
  const n = Number(remaining);

  if (s.includes("工作")) return "status-busy";
  if (s.includes("預約")) return "status-booked";
  if (!Number.isNaN(n) && n < 0) return "status-busy";

  return "status-other";
}

// ===== 轉成畫面用 row =====
function mapRowsToDisplay(rows) {
  return rows.map((row) => {
    const remaining = row.remaining === 0 || row.remaining ? row.remaining : "";

    return {
      sort: row.sort,
      index: row.index,
      _gasSeq: row._gasSeq,
      masterId: row.masterId,
      status: row.status,
      appointment: row.appointment,

      colorIndex: row.colorIndex || "",
      colorMaster: row.colorMaster || "",
      colorStatus: row.colorStatus || "",

      remainingDisplay: fmtRemainingRaw(remaining),
      statusClass: deriveStatusClass(row.status, remaining),
    };
  });
}

// ===== 重建「狀態篩選」選項 =====
function rebuildStatusFilterOptions() {
  if (!filterStatusSelect) return;

  const statuses = new Set();
  ["body", "foot"].forEach((type) => {
    (rawData[type] || []).forEach((r) => {
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

  filterStatusSelect.value = previous !== "all" && statuses.has(previous) ? previous : "all";
  filterStatus = filterStatusSelect.value;
}

// ===== 渲染（包含：排序 + 第一欄顯示）=====
function render() {
  if (!tbodyRowsEl) return;

  const list = activePanel === "body" ? rawData.body : rawData.foot;

  const filtered = applyFilters(list);

  const isAll = filterStatus === "all";
  const isShift = String(filterStatus || "").includes("排班");
  const useDisplayOrder = isAll || isShift;

  let finalRows;

  if (useDisplayOrder) {
    finalRows = filtered.slice().sort((a, b) => {
      const na = Number(a.sort ?? a.index);
      const nb = Number(b.sort ?? b.index);

      const aKey = Number.isNaN(na) ? Number(a._gasSeq ?? 0) : na;
      const bKey = Number.isNaN(nb) ? Number(b._gasSeq ?? 0) : nb;

      if (aKey !== bKey) return aKey - bKey;
      return Number(a._gasSeq ?? 0) - Number(b._gasSeq ?? 0);
    });
  } else {
    finalRows = filtered.slice().sort((a, b) => {
      const na = Number(a.sort);
      const nb = Number(b.sort);

      const aKey = Number.isNaN(na) ? Number(a._gasSeq ?? 0) : na;
      const bKey = Number.isNaN(nb) ? Number(b._gasSeq ?? 0) : nb;

      if (aKey !== bKey) return aKey - bKey;
      return Number(a._gasSeq ?? 0) - Number(b._gasSeq ?? 0);
    });
  }

  const displayRows = mapRowsToDisplay(finalRows);

  tbodyRowsEl.innerHTML = "";
  if (emptyStateEl) emptyStateEl.style.display = displayRows.length ? "none" : "block";

  displayRows.forEach((row, idx) => {
    const tr = document.createElement("tr");

    const showGasSortInOrderCol = !useDisplayOrder;
    const sortNum = Number(row.sort);
    const orderText =
      showGasSortInOrderCol && !Number.isNaN(sortNum) ? String(sortNum) : String(idx + 1);

    const tdOrder = document.createElement("td");
    tdOrder.textContent = orderText;
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

  if (panelTitleEl) panelTitleEl.textContent = activePanel === "body" ? "身體面板" : "腳底面板";
}

// ===== 過濾器（師傅 / 狀態）=====
function applyFilters(list) {
  return list.filter((row) => {
    if (filterMaster) {
      const key = String(filterMaster).trim();
      const master = String(row.masterId || "").trim();

      if (/^\d+$/.test(key)) {
        if (parseInt(master, 10) !== parseInt(key, 10)) return false;
      } else {
        if (!master.includes(key)) return false;
      }
    }

    if (filterStatus && filterStatus !== "all") {
      if (row.status !== filterStatus) return false;
    }

    return true;
  });
}

/* =========================================================
 * ✅ 分流後的 Status 取得（一次拿 body + foot）
 * - 優先打 Edge?mode=all
 * - 失敗 fallback 打主站 cache_all
 * ========================================================= */

async function fetchStatusAll() {
  const edgeBase = getStatusEdgeUrl_();
  const jitterBust = Date.now();

  const tryUrls = [
    `${edgeBase}?mode=all&v=${encodeURIComponent(jitterBust)}`,
    `${FALLBACK_ORIGIN_CACHE_URL}&v=${encodeURIComponent(jitterBust)}`,
  ];

  let lastErr = null;

  for (const url of tryUrls) {
    try {
      const resp = await fetch(url, { method: "GET", cache: "no-store" });
      if (!resp.ok) throw new Error("Status HTTP " + resp.status);

      const data = await resp.json();
      if (data && data.ok === false) throw new Error(data.error || "Status response not ok");

      const bodyRows = Array.isArray(data.body) ? data.body : [];
      const footRows = Array.isArray(data.foot) ? data.foot : [];
      return { bodyRows, footRows };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("fetchStatusAll failed");
}

async function refreshStatus() {
  // ✅ 改成上方 toast，不影響版面排列
  showLoadingHint("同步資料中…");
  if (errorStateEl) errorStateEl.style.display = "none";

  try {
    const { bodyRows, footRows } = await fetchStatusAll();

    rawData.body = bodyRows.map((r, i) => ({ ...r, _gasSeq: i }));
    rawData.foot = footRows.map((r, i) => ({ ...r, _gasSeq: i }));

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
  } catch (err) {
    console.error("[Status] 取得狀態失敗：", err);
    if (connectionStatusEl) connectionStatusEl.textContent = "異常";
    if (errorStateEl) errorStateEl.style.display = "block";
  } finally {
    hideLoadingHint();
  }
}

/* =========================
 * ✅ 使用者更名同步（以 GAS 為準判斷 LINE 是否改名）
 * ========================= */
async function syncDisplayNameIfChanged_(userId, liffName, gasName) {
  const newName = String(liffName || "").trim();
  const oldName = String(gasName || "").trim();

  if (!userId || !newName) return false;

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
  const serverDisplayName = (data && data.displayName) || "";

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
      serverDisplayName,
    };
  }

  if (status === "pending") {
    return {
      allowed: false,
      status: "pending",
      audit,
      remainingDays,
      displayName: finalDisplayName,
      serverDisplayName,
    };
  }

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
  if (!resp.ok) throw new Error("Register HTTP " + resp.status);

  return await resp.json();
}

// ===== 主題切換（亮 / 暗）=====
function setTheme(theme) {
  const root = document.documentElement;
  const finalTheme = theme === "light" ? "light" : "dark";

  root.setAttribute("data-theme", finalTheme);
  localStorage.setItem("dashboardTheme", finalTheme);

  if (themeToggleBtn) themeToggleBtn.textContent = finalTheme === "dark" ? "🌙 深色" : "☀️ 淺色";
}

(function initTheme() {
  const saved = localStorage.getItem("dashboardTheme") || "dark";
  setTheme(saved);
})();

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(current === "dark" ? "light" : "dark");
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

    window.currentUserId = userId;
    window.currentDisplayName = displayName;

    if (!userId) {
      showGate("無法取得使用者 ID，請重新開啟 LIFF。", true);
      return;
    }

    showGate("正在確認使用權限…");
    const result = await checkOrRegisterUser(userId, displayName);
    await syncDisplayNameIfChanged_(userId, displayName, result.serverDisplayName);

    const finalDisplayName = (displayName || result.displayName || "").trim();
    window.currentDisplayName = finalDisplayName;

    if (result.allowed && result.status === "approved") {
      showGate("驗證通過，正在載入資料…");
      openApp();
      updateUsageBanner(finalDisplayName, result.remainingDays);

      // ✅ 每天首次：由使用者在 OA 聊天室送出訊息（只改前端）
      await sendDailyFirstMessageFromUser_();

      startApp();
      return;
    }

    if (result.status === "pending") {
      const auditText = result.audit || "待審核";
      let msg = "此帳號目前尚未通過審核。\n";
      msg += "目前審核狀態：「" + auditText + "」。\n\n";
      msg +=
        auditText === "拒絕" || auditText === "停用"
          ? "如需重新申請或有疑問，請聯絡管理員。"
          : "若你已經等待一段時間，請聯絡管理員確認審核進度。";
      showGate(msg);
      return;
    }

    showGate("⚠ 無法確認使用權限，請稍後再試。", true);
  } catch (err) {
    console.error("[LIFF] 初始化或驗證失敗：", err);
    showGate("⚠ LIFF 初始化或權限驗證失敗，請稍後再試。", true);
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

if (refreshBtn) refreshBtn.addEventListener("click", refreshStatus);

// ===== Panel 切換 =====
function setActivePanel(panel) {
  activePanel = panel;

  if (tabBodyBtn && tabFootBtn) {
    if (panel === "body") {
      tabBodyBtn.classList.add("tab-active");
      tabFootBtn.classList.remove("tab-active");
    } else {
      tabFootBtn.classList.add("tab-active");
      tabBodyBtn.classList.remove("tab-active");
    }
  }

  render();
}

// ===== App 啟動 =====
function startApp() {
  setActivePanel("body");
  refreshStatus();

  // ✅ 你要每人 10 秒讀取一次：改成 10 秒（你目前是 5 秒）
  const intervalMs = 5 * 1000;

  // ✅ jitter：避免同秒齊發尖峰（你目前是 0~3 秒）
  const jitter = Math.floor(Math.random() * 3000);

  setTimeout(() => {
    setInterval(refreshStatus, intervalMs);
  }, jitter);
}

// ===== 入口 =====
window.addEventListener("load", () => {
  initLiffAndGuard();
});
