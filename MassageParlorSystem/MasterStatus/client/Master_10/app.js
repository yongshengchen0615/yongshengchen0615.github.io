// =========================================================
// app.js (Optimized)
// - 單次 listUsers
// - fetch timeout + retry
// - 輪詢不重疊
// - 日曆事件委派
// - 分層結構化
// =========================================================

/** ================================
 * 0) Runtime Config
 * ================================ */
const CONFIG_URL = "./config.json";
let APP_CONFIG = null;

/** ================================
 * 1) UI Text
 * ================================ */
const CALENDAR_UI_TEXT = {
  weeklyOff: { tooltip: "無法預約日" },
  dateTypes: {
    holiday: { tooltip: "休假日" },
    workday: { tooltipPrefix: "" },
    other: { tooltipPrefix: "" },
  },
  rule_workday_override_weeklyoff: true,
};

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

/** ================================
 * 2) DOM Cache
 * ================================ */
const DOM = {};
function $(id) {
  return document.getElementById(id);
}
function cacheDom_() {
  [
    "loadingOverlay",
    "accessDenied",
    "appContainer",
    "toast",
    "deniedTitle",
    "deniedText",
    "deniedAudit",
    "deniedName",
    "deniedDays",
    "themeToggleBtn",
    "techMasterId",
    "bizSummary",
    "calPrev",
    "calNext",
    "calMonthLabel",
    "calWeekdays",
    "calGrid",
    "bodyStatusText",
    "bodyAppointmentText",
    "bodyRemainingText",
    "footStatusText",
    "footAppointmentText",
    "footRemainingText",
  ].forEach((k) => (DOM[k] = $(k)));
}

/** ================================
 * 3) Small Utils
 * ================================ */
function normalizeDigits(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

function pickField_(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && String(obj[k]).trim() !== "") return String(obj[k]).trim();
  }
  return "";
}

function buildLabelWithPrefix(prefix, type) {
  const p = String(prefix || "").trim();
  const t = String(type || "").trim();
  if (!p) return t;
  if (!t) return p;
  if (p === t) return p;
  return `${p} ${t}`;
}

function toast(msg) {
  const t = DOM.toast;
  if (!t) return;
  const s = String(msg || "");
  if (!s) return;

  // 避免短時間同訊息刷屏
  if (toast._last === s && Date.now() - (toast._lastAt || 0) < 1200) return;
  toast._last = s;
  toast._lastAt = Date.now();

  t.textContent = s;
  t.style.display = "block";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => (t.style.display = "none"), 3500);
}

function hideLoading_() {
  const lo = DOM.loadingOverlay;
  if (!lo) return;
  lo.classList.add("hidden");
  lo.setAttribute("aria-busy", "false");
}

function showApp_() {
  hideLoading_();
  if (DOM.appContainer) DOM.appContainer.style.display = "block";
  if (DOM.accessDenied) DOM.accessDenied.style.display = "none";
}

function showDenied_(info = {}) {
  hideLoading_();

  if (DOM.accessDenied) DOM.accessDenied.style.display = "block";
  if (DOM.appContainer) DOM.appContainer.style.display = "none";

  const audit = info.audit != null ? String(info.audit) : "-";
  const name = info.displayName != null ? String(info.displayName) : "-";
  const days = info.remainingDays != null ? String(info.remainingDays) : "-";

  if (DOM.deniedAudit) DOM.deniedAudit.textContent = audit;
  if (DOM.deniedName) DOM.deniedName.textContent = name;
  if (DOM.deniedDays) DOM.deniedDays.textContent = days;

  const reason = String(info.denyReason || "not_approved");

  // 統一的標題/文案覆蓋
  const setDeniedText = (title, text) => {
    if (DOM.deniedTitle) DOM.deniedTitle.textContent = title;
    if (DOM.deniedText) DOM.deniedText.textContent = text;
  };

  if (reason === "not_in_liff") {
    setDeniedText("請在 LINE 內開啟", "此頁面需要透過 LIFF 取得使用者身份。請從 LINE 官方帳號的 LIFF 入口開啟。");
    return;
  }
  if (reason === "liff_login") {
    setDeniedText("需要登入", "正在導向登入，若未自動登入請重新開啟。");
    return;
  }
  if (reason === "check_failed") {
    setDeniedText("權限檢查失敗", "無法完成審核檢查，請稍後再試或聯絡管理員。");
    return;
  }
  if (reason === "target_not_found") {
    setDeniedText("找不到技師資料", "找不到此技師（Users 表沒有對應的「師傅編號」）。請確認 TARGET_MASTER_ID 與 Users 表的師傅編號一致。");
    return;
  }
  if (reason === "target_personal_disabled") {
    setDeniedText("此技師尚未開通", "此頁面需技師「個人狀態開通」= 是 才能使用。請聯絡管理員在 Users 後台將該技師設為「是」。");
    return;
  }
  if (reason === "personalstatus_failed") {
    setDeniedText("讀取設定失敗", "無法從 PersonalStatus 取得資料庫 URL，請聯絡管理員檢查設定。");
    return;
  }
  if (reason === "audit_block") {
    setDeniedText(String(info.denyTitle || "無法使用"), String(info.denyText || "你的審核狀態未通過，無法使用此頁面。"));
    return;
  }

  setDeniedText("尚未通過審核", "目前未通過審核（新用戶會自動建立為「待審核」），請聯絡管理員開通權限。");
}

/** ================================
 * 4) Theme
 * ================================ */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}
function initTheme_() {
  const saved = localStorage.getItem("theme") || "dark";
  applyTheme(saved);

  const btn = DOM.themeToggleBtn;
  if (btn) {
    btn.onclick = () => {
      const now = document.documentElement.getAttribute("data-theme");
      applyTheme(now === "dark" ? "light" : "dark");
    };
  }
}

/** ================================
 * 5) Fetch Layer (timeout + retry)
 * ================================ */
async function fetchText_(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 12000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson_(url, opts = {}) {
  const retries = opts.retries ?? 2;
  let lastErr = null;

  for (let i = 0; i <= retries; i++) {
    try {
      const { res, text } = await fetchText_(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 160)}`);

      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Non-JSON: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      lastErr = e;
      // 指數退避：250, 600, 1200...
      if (i < retries) await new Promise((r) => setTimeout(r, 250 * Math.pow(2, i) + Math.random() * 120));
    }
  }

  throw lastErr || new Error("fetchJson failed");
}

/** ================================
 * 6) Config Load
 * ================================ */
async function loadConfig_() {
  const url = `${CONFIG_URL}?v=${Date.now()}`;
  const { res, text } = await fetchText_(url, { cache: "no-store", method: "GET", timeoutMs: 12000 });
  if (!res.ok) throw new Error(`CONFIG fetch failed: ${res.status} ${text.slice(0, 160)}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("CONFIG non-JSON: " + text.slice(0, 200));
  }

  const required = ["LIFF_ID", "USER_MGMT_API_URL", "TECH_API_URL", "TARGET_MASTER_ID"];
  const missing = required.filter((k) => !json[k] || String(json[k]).trim() === "");
  if (missing.length) throw new Error("CONFIG missing: " + missing.join(", "));

  APP_CONFIG = {
    LIFF_ID: String(json.LIFF_ID).trim(),
    USER_MGMT_API_URL: String(json.USER_MGMT_API_URL).trim(),
    TECH_API_URL: String(json.TECH_API_URL).trim(),
    TARGET_MASTER_ID: String(json.TARGET_MASTER_ID).trim(),

    // hydrated by getPersonalStatus
    ADMIN_API_URL: "",
    BOOKING_API_URL: "",
  };

  return APP_CONFIG;
}

/** ================================
 * 7) LIFF Auth
 * ================================ */
async function getUserIdFromLiff_() {
  if (typeof liff === "undefined") {
    showDenied_({ denyReason: "not_in_liff" });
    return null;
  }

  await liff.init({ liffId: APP_CONFIG.LIFF_ID });

  if (!liff.isLoggedIn()) {
    showDenied_({ denyReason: "liff_login" });
    liff.login();
    return null;
  }

  const profile = await liff.getProfile();
  const userId = profile && profile.userId ? String(profile.userId) : "";
  if (!userId) {
    showDenied_({ denyReason: "not_in_liff" });
    return null;
  }

  return { userId, profile };
}

/** ================================
 * 8) USER_MGMT API
 * ================================ */
function buildUserMgmtUrl_(paramsObj) {
  const u = new URL(APP_CONFIG.USER_MGMT_API_URL);
  Object.entries(paramsObj || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  });
  u.searchParams.set("_cors", "1");
  return u.toString();
}

async function userMgmtGet_(paramsObj) {
  const url = buildUserMgmtUrl_(paramsObj);
  return await fetchJson_(url, { method: "GET", timeoutMs: 12000, retries: 2 });
}

function isUserNotFound_(checkJson) {
  if (!checkJson) return true;
  const status = String(checkJson.status || "").trim().toLowerCase();
  const audit = String(checkJson.audit || "").trim();
  const name = String(checkJson.displayName || "").trim();
  return status === "none" || (!audit && !name);
}

async function ensureUserExists_(userId, displayName) {
  const check1 = await userMgmtGet_({ mode: "check", userId });
  if (isUserNotFound_(check1)) {
    await userMgmtGet_({ mode: "register", userId, displayName: displayName || "" });
    return await userMgmtGet_({ mode: "check", userId });
  }
  return check1;
}

/** ================================
 * 9) Target Tech Gate (single listUsers)
 * ================================ */
async function getTargetTechContext_() {
  // 可選：小快取（避免重整狂打 listUsers）
  const cacheKey = "targetTechCtx:v1:" + normalizeDigits(APP_CONFIG.TARGET_MASTER_ID);
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try {
      const obj = JSON.parse(cached);
      // 90 秒內有效
      if (obj && Date.now() - (obj._ts || 0) < 90_000) return obj;
    } catch {}
  }

  const json = await userMgmtGet_({ mode: "listUsers" });
  const users = Array.isArray(json?.users) ? json.users : [];

  const target = normalizeDigits(APP_CONFIG.TARGET_MASTER_ID);
  const hit = users.find((u) => normalizeDigits(u.masterCode) === target);

  const ctx = {
    _ts: Date.now(),
    techRow: hit || null,
    ownerUserId: String(hit?.userId || "").trim(),
  };

  sessionStorage.setItem(cacheKey, JSON.stringify(ctx));
  return ctx;
}

/** ================================
 * 10) getPersonalStatus hydrate
 * ================================ */
async function hydrateUrlsFromPersonalStatus_(ownerUserId) {
  // 可選：小快取（避免同 session 反覆打）
  const cacheKey = "psUrls:v1:" + ownerUserId;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try {
      const obj = JSON.parse(cached);
      if (obj && obj.adminUrl && obj.bookingUrl && Date.now() - (obj._ts || 0) < 180_000) {
        APP_CONFIG.ADMIN_API_URL = obj.adminUrl;
        APP_CONFIG.BOOKING_API_URL = obj.bookingUrl;
        return;
      }
    } catch {}
  }

  const json = await userMgmtGet_({ mode: "getPersonalStatus", userId: ownerUserId });
  if (!json || json.ok !== true) throw new Error(String(json?.error || "getPersonalStatus failed"));

  const adminUrl = pickField_(json, ["databaseUrl", "使用者資料庫"]);
  const bookingUrl = pickField_(json, ["dateDatabaseUrl", "相關日期資料庫"]);

  if (!adminUrl) throw new Error("getPersonalStatus: missing 使用者資料庫(databaseUrl)");
  if (!bookingUrl) throw new Error("getPersonalStatus: missing 相關日期資料庫(dateDatabaseUrl)");

  APP_CONFIG.ADMIN_API_URL = adminUrl;
  APP_CONFIG.BOOKING_API_URL = bookingUrl;

  sessionStorage.setItem(cacheKey, JSON.stringify({ _ts: Date.now(), adminUrl, bookingUrl }));
}

/** ================================
 * 11) ADMIN_DB API
 * ================================ */
function buildAdminDbUrl_(paramsObj) {
  if (!APP_CONFIG.ADMIN_API_URL) throw new Error("ADMIN_API_URL missing");
  const u = new URL(APP_CONFIG.ADMIN_API_URL);
  Object.entries(paramsObj || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  });
  u.searchParams.set("_cors", "1");
  return u.toString();
}

async function adminDbGet_(paramsObj) {
  const url = buildAdminDbUrl_(paramsObj);
  return await fetchJson_(url, { method: "GET", timeoutMs: 12000, retries: 2 });
}

function isAdminUserNotFound_(checkJson) {
  if (!checkJson) return true;
  const status = String(checkJson.status || "").trim().toLowerCase();
  const audit = String(checkJson.audit || "").trim();
  const name = String(checkJson.displayName || "").trim();
  return status === "none" || (!audit && !name);
}

async function adminDbRegisterDefault_(userId, displayName) {
  try {
    await adminDbGet_({ mode: "register", userId, displayName: displayName || "" });
  } catch (e) {
    // register 失敗不應阻塞：仍然顯示未設定
    console.error("[ADMIN_DB] register default failed", e);
  }
}

function auditBlockMessage_(auditRaw) {
  const a = String(auditRaw || "").trim();
  if (a === "通過") return null;

  if (!a || a === "-") {
    return {
      title: "審核狀態未設定",
      text: "你的審核狀態尚未設定，暫時無法使用此頁面。請聯絡管理員處理。",
    };
  }
  if (a === "待審核") {
    return {
      title: "尚未通過審核",
      text: "你的帳號目前為「待審核」，暫時無法使用。請聯絡管理員開通。",
    };
  }
  if (a === "拒絕") {
    return {
      title: "審核未通過",
      text: "你的帳號審核結果為「拒絕」，無法使用此頁面。請聯絡管理員確認原因。",
    };
  }
  if (a === "停用") {
    return {
      title: "帳號已停用",
      text: "你的帳號目前為「停用」，無法使用此頁面。請聯絡管理員協助。",
    };
  }
  return {
    title: "無法使用",
    text: `你的審核狀態為「${a}」，目前無法使用此頁面。請聯絡管理員。`,
  };
}

/** ================================
 * 12) Gate Orchestration
 * ================================ */
async function checkAccessOrBlock_() {
  const auth = await getUserIdFromLiff_();
  if (!auth) return { allowed: false };

  const userId = String(auth.userId || "").trim();
  const displayName = String(auth.profile?.displayName || "").trim();

  // USER_MGMT：確保存在 + 通過
  let profileJson;
  try {
    profileJson = await ensureUserExists_(userId, displayName);
  } catch (e) {
    console.error(e);
    toast("權限檢查失敗：" + String(e.message || e));
    showDenied_({ denyReason: "check_failed" });
    return { allowed: false };
  }

  const allowed =
    profileJson && typeof profileJson.allowed === "boolean"
      ? profileJson.allowed
      : String(profileJson.audit || "").trim() === "通過";

  if (!allowed) {
    showDenied_(profileJson || { denyReason: "not_approved" });
    return { allowed: false };
  }

  // Target Tech：一次 listUsers 取得 techRow + ownerUserId
  let ctx;
  try {
    ctx = await getTargetTechContext_();
  } catch (e) {
    console.error(e);
    showDenied_({ denyReason: "check_failed" });
    return { allowed: false };
  }

  if (!ctx.techRow) {
    showDenied_({ denyReason: "target_not_found" });
    return { allowed: false };
  }

  const enabled = String(ctx.techRow.personalStatusEnabled || "").trim() === "是";
  if (!enabled) {
    showDenied_({
      denyReason: "target_personal_disabled",
      audit: ctx.techRow.audit || "-",
      displayName: ctx.techRow.displayName || "-",
      remainingDays: "-",
    });
    return { allowed: false };
  }

  if (!ctx.ownerUserId) {
    showDenied_({ denyReason: "target_not_found" });
    return { allowed: false };
  }

  // PersonalStatus：hydrate ADMIN/BOOKING URL
  try {
    await hydrateUrlsFromPersonalStatus_(ctx.ownerUserId);
  } catch (e) {
    console.error(e);
    toast("讀取 PersonalStatus 失敗：" + String(e.message || e));
    showDenied_({ denyReason: "personalstatus_failed" });
    return { allowed: false };
  }

  // ADMIN_DB：檢查登入者 audit（查不到就 register default → block）
  try {
    const c1 = await adminDbGet_({ mode: "check", userId });

    if (isAdminUserNotFound_(c1)) {
      await adminDbRegisterDefault_(userId, profileJson?.displayName || displayName);

      showDenied_({
        denyReason: "audit_block",
        audit: "-",
        displayName: profileJson?.displayName || displayName || "-",
        remainingDays: "-",
        denyTitle: "審核狀態未設定",
        denyText: "你的審核狀態尚未設定，暫時無法使用此頁面。請聯絡管理員處理。",
      });
      return { allowed: false };
    }

    const audit = String(c1?.audit || "").trim();
    const msg = auditBlockMessage_(audit);
    if (msg) {
      showDenied_({
        denyReason: "audit_block",
        audit: audit || "-",
        displayName: c1?.displayName || profileJson?.displayName || displayName || "-",
        remainingDays: c1?.remainingDays ?? "-",
        denyTitle: msg.title,
        denyText: msg.text,
      });
      return { allowed: false };
    }
  } catch (e) {
    console.error(e);
    showDenied_({
      denyReason: "audit_block",
      audit: "-",
      displayName: profileJson?.displayName || displayName || "-",
      remainingDays: "-",
      denyTitle: "審核狀態檢查失敗",
      denyText: "無法讀取你的審核狀態，暫時無法使用此頁面。請稍後再試或聯絡管理員。",
    });
    return { allowed: false };
  }

  return { allowed: true, userId, displayName: profileJson?.displayName || displayName, targetTech: ctx.techRow };
}

/** ================================
 * 13) Tech Status
 * ================================ */
function classifyStatus(text) {
  const t = String(text || "");
  if (!t) return "off";
  if (t.includes("工作")) return "busy";
  if (t.includes("上班") || t.includes("可預約")) return "idle";
  if (t.includes("休") || t.includes("下班")) return "off";
  return "idle";
}

function updateStatusUI_(kind, data) {
  const statusEl = DOM[kind + "StatusText"];
  const apptEl = DOM[kind + "AppointmentText"];
  const remEl = DOM[kind + "RemainingText"];
  if (!statusEl || !apptEl || !remEl) return;

  if (!data) {
    statusEl.innerHTML = `<span class="status-pill status-off">無資料</span>`;
    apptEl.textContent = "-";
    remEl.textContent = "-";
    return;
  }

  const status = String(data.status || "");
  const bucket = classifyStatus(status);

  // 減少不必要重繪：內容相同就不改
  const nextHtml = `<span class="status-pill status-${bucket}">${status}</span>`;
  if (statusEl._v !== nextHtml) {
    statusEl.innerHTML = nextHtml;
    statusEl._v = nextHtml;
  }

  const nextAppt = data.appointment || "無預約";
  if (apptEl._v !== nextAppt) {
    apptEl.textContent = nextAppt;
    apptEl._v = nextAppt;
  }

  const nextRem = data.remaining || "-";
  if (remEl._v !== nextRem) {
    remEl.textContent = nextRem;
    remEl._v = nextRem;
  }
}

let techPollInFlight = false;

async function loadTechStatus_() {
  const json = await fetchJson_(APP_CONFIG.TECH_API_URL, { method: "GET", timeoutMs: 12000, retries: 1 });
  const target = normalizeDigits(APP_CONFIG.TARGET_MASTER_ID);

  const body = json.body?.find((r) => normalizeDigits(r.masterId) === target) || null;
  const foot = json.foot?.find((r) => normalizeDigits(r.masterId) === target) || null;

  updateStatusUI_("body", body);
  updateStatusUI_("foot", foot);
}

function startTechPolling_() {
  const tick = async () => {
    if (document.hidden) return; // 背景不輪詢，省資源

    if (techPollInFlight) return;
    techPollInFlight = true;

    try {
      await loadTechStatus_();
    } catch (e) {
      console.error(e);
      toast("師傅狀態更新失敗：" + String(e.message || e));
    } finally {
      techPollInFlight = false;
    }
  };

  // 先跑一次
  tick();

  // 用 setInterval + inFlight guard（不重疊）
  setInterval(tick, 10000);

  // 回到前景時立刻更新一次
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  });
}

/** ================================
 * 14) Calendar
 * ================================ */
const calState = {
  startTime: "",
  endTime: "",
  weeklyOff: [],
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
};

// dtState: Map<ymd, { hasHoliday, hasWorkday, others: string[] }>
let dtState = new Map();
const calInfoByDate = new Map();

function formatTimeHHmm(val) {
  if (val == null || val === "") return "";
  const s = String(val).trim();

  const m = s.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;

  const d2 = new Date(s);
  if (!isNaN(d2.getTime())) {
    const hh = String(d2.getHours()).padStart(2, "0");
    const mm = String(d2.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  return "";
}

function typeToBucket(type) {
  const s = String(type || "").toLowerCase();
  if (s.includes("假") || s.includes("holiday") || s.includes("休")) return "holiday";
  if (s.includes("補班") || s.includes("work") || s.includes("上班")) return "workday";
  return "other";
}

function renderWeekdays_() {
  const el = DOM.calWeekdays;
  if (!el) return;
  el.innerHTML = WEEKDAY_LABELS.map((w) => `<div>${w}</div>`).join("");
}

function renderCalendar_() {
  renderWeekdays_();

  const grid = DOM.calGrid;
  const label = DOM.calMonthLabel;
  if (!grid || !label) return;

  const y = calState.viewYear;
  const m = calState.viewMonth;

  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const firstDow = first.getDay();
  const daysInMonth = last.getDate();

  label.textContent = `${y}-${String(m + 1).padStart(2, "0")}`;

  calInfoByDate.clear();
  const cells = [];

  for (let i = 0; i < firstDow; i++) {
    cells.push(`<div class="cal-cell" style="visibility:hidden"></div>`);
  }

  const today = new Date();
  const isToday = (yy, mm, dd) => yy === today.getFullYear() && mm === today.getMonth() && dd === today.getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(y, m, d);
    const dow = dateObj.getDay();

    const ymd = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dt = dtState.get(ymd) || { hasHoliday: false, hasWorkday: false, others: [] };

    let off = calState.weeklyOff.includes(dow);

    if (CALENDAR_UI_TEXT.rule_workday_override_weeklyoff === true && dt.hasWorkday) {
      off = false;
    }

    calInfoByDate.set(ymd, { off, dt });

    let stateCls = "";
    if (dt.hasHoliday) stateCls = "is-holiday";
    else if (dt.hasWorkday) stateCls = "is-workday";
    else if (off) stateCls = "is-weeklyoff";
    else if (dt.others.length) stateCls = "is-special";

    const cls = ["cal-cell", stateCls, isToday(y, m, d) ? "is-today" : ""].filter(Boolean).join(" ");

    cells.push(`
      <div class="${cls}" data-ymd="${ymd}">
        <div class="cal-date">${d}</div>
      </div>
    `);
  }

  grid.innerHTML = cells.join("");
}

function bindCalendarNav_() {
  if (DOM.calPrev)
    DOM.calPrev.onclick = () => {
      calState.viewMonth--;
      if (calState.viewMonth < 0) {
        calState.viewMonth = 11;
        calState.viewYear--;
      }
      renderCalendar_();
    };

  if (DOM.calNext)
    DOM.calNext.onclick = () => {
      calState.viewMonth++;
      if (calState.viewMonth > 11) {
        calState.viewMonth = 0;
        calState.viewYear++;
      }
      renderCalendar_();
    };

  // 事件委派：只綁一次 click
  if (DOM.calGrid) {
    DOM.calGrid.addEventListener("click", (e) => {
      const cell = e.target?.closest?.(".cal-cell[data-ymd]");
      if (!cell) return;

      DOM.calGrid.querySelectorAll(".cal-cell.is-selected").forEach((c) => c.classList.remove("is-selected"));
      cell.classList.add("is-selected");

      const ymd = cell.getAttribute("data-ymd");
      const info = calInfoByDate.get(ymd);
      if (!info) return;

      const lines = [ymd];

      if (info.off) lines.push(CALENDAR_UI_TEXT.weeklyOff.tooltip || "固定休假日");

      if (info.dt.hasHoliday) lines.push(CALENDAR_UI_TEXT.dateTypes.holiday.tooltip || "休假日");
      if (info.dt.hasWorkday) {
        const cfg = CALENDAR_UI_TEXT.dateTypes.workday || CALENDAR_UI_TEXT.dateTypes.other;
        const tip = buildLabelWithPrefix(cfg.tooltipPrefix, "補班");
        if (tip) lines.push(tip);
      }
      (info.dt.others || []).forEach((t) => {
        const cfg = CALENDAR_UI_TEXT.dateTypes.other || CALENDAR_UI_TEXT.dateTypes.other;
        const tip = buildLabelWithPrefix(cfg.tooltipPrefix, t);
        if (tip) lines.push(tip);
      });

      if (lines.length === 1) lines.push("可預約日");
      toast(lines.join("｜"));
    });
  }
}

async function loadBizConfig_() {
  if (!APP_CONFIG.BOOKING_API_URL) throw new Error("BOOKING_API_URL missing (not hydrated)");

  const url = `${APP_CONFIG.BOOKING_API_URL}?entity=bootstrap`;
  const json = await fetchJson_(url, { method: "GET", timeoutMs: 12000, retries: 2 });

  if (!json.ok) throw new Error(json.error || "BOOKING_API error");

  const cfg = json.data?.config || {};
  const weeklyOff = json.data?.weeklyOff || [];
  const datetypes = json.data?.datetypes || [];

  calState.startTime = formatTimeHHmm(cfg.startTime);
  calState.endTime = formatTimeHHmm(cfg.endTime);
  calState.weeklyOff = Array.isArray(weeklyOff) ? weeklyOff : [];

  dtState = new Map();
  (Array.isArray(datetypes) ? datetypes : []).forEach((r) => {
    const date = String(r.Date || r.date || "").trim();
    const type = String(r.Type || r.DateType || r.type || "").trim();
    if (!date || !type) return;

    const bucket = typeToBucket(type);
    const cur = dtState.get(date) || { hasHoliday: false, hasWorkday: false, others: [] };

    if (bucket === "holiday") cur.hasHoliday = true;
    else if (bucket === "workday") cur.hasWorkday = true;
    else cur.others.push(type);

    dtState.set(date, cur);
  });

  if (DOM.bizSummary) {
    DOM.bizSummary.textContent =
      calState.startTime && calState.endTime
        ? `預約時間：${calState.startTime} ~ ${calState.endTime}`
        : `預約時間：未設定`;
  }

  renderCalendar_();
}

/** ================================
 * 15) Bootstrap
 * ================================ */
async function bootstrap_() {
  cacheDom_();
  initTheme_();
  bindCalendarNav_();

  await loadConfig_();

  if (DOM.techMasterId) DOM.techMasterId.textContent = APP_CONFIG.TARGET_MASTER_ID;

  const gate = await checkAccessOrBlock_();
  if (!gate.allowed) return;

  // 進入主畫面：先顯示 UI（loading overlay hidden）
  showApp_();

  // 並行載入：狀態 + 日曆
  try {
    await Promise.all([loadTechStatus_(), loadBizConfig_()]);
  } catch (e) {
    console.error(e);
    toast("初始化資料載入失敗：" + String(e.message || e));
  }

  // 開始輪詢師傅狀態（不重疊）
  startTechPolling_();
}

window.onload = () => {
  bootstrap_().catch((err) => {
    console.error(err);
    toast("初始化失敗：" + String(err.message || err));
    showDenied_({ denyReason: "check_failed" });
  });
};
