// =========================================================
// 師傅狀態 + 日曆（✅ endpoints 由 USER_MGMT_API_URL 讀 PersonalStatus 分發）
// 你要的分工：
// - USER_MGMT_API_URL：只負責從 PersonalStatus 取出 endpoints（ADMIN/BOOKING/TECH）
// - ADMIN_API_URL：讀取「使用者資料庫」(Users) → check/register/listUsers/update...
// - BOOKING_API_URL：讀取「相關日期資料庫」→ entity=bootstrap...
// - TECH_API_URL：讀取「技師狀態資料庫」→ body/foot...
//
// ✅ 相容舊版：如果 PersonalStatus 沒提供 techApiUrl，就 fallback 用 config.json 的 TECH_API_URL
// ✅ 相容舊版：如果 config.json 仍有 ADMIN_API_URL/BOOKING_API_URL/TECH_API_URL 也可 fallback
// =========================================================

// ================================
// 0) Runtime Config（from config.json）
// ================================
const CONFIG_URL = "./config.json";

// 只從 config 拿：LIFF_ID / USER_MGMT_API_URL / TARGET_MASTER_ID
// 其他 endpoint 由 PersonalStatus 取回（或 fallback 舊 config）
let APP_CONFIG = null;

// 由 USER_MGMT PersonalStatus 分發出來的 endpoints（或 fallback）
let ENDPOINTS = {
  ADMIN_API_URL: "",
  BOOKING_API_URL: "",
  TECH_API_URL: "",
};

async function loadConfig_() {
  const res = await fetch(`${CONFIG_URL}?v=${Date.now()}`, {
    cache: "no-store",
    method: "GET",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`CONFIG fetch failed: ${res.status} ${text.slice(0, 160)}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error("CONFIG non-JSON: " + text.slice(0, 200));
  }

  const required = ["LIFF_ID", "USER_MGMT_API_URL", "TARGET_MASTER_ID"];
  const missing = required.filter((k) => !json[k] || String(json[k]).trim() === "");
  if (missing.length) throw new Error("CONFIG missing: " + missing.join(", "));

  APP_CONFIG = Object.freeze({
    LIFF_ID: String(json.LIFF_ID).trim(),
    USER_MGMT_API_URL: String(json.USER_MGMT_API_URL).trim(),
    TARGET_MASTER_ID: String(json.TARGET_MASTER_ID).trim(),

    // ✅ 舊版相容：若你 config 還留著這些，當 PersonalStatus 沒提供時可 fallback
    ADMIN_FALLBACK: String(json.ADMIN_API_URL || "").trim(),
    BOOKING_FALLBACK: String(json.BOOKING_API_URL || "").trim(),
    TECH_FALLBACK: String(json.TECH_API_URL || "").trim(),
  });

  console.log("[CONFIG] loaded", APP_CONFIG);
  return APP_CONFIG;
}

// ================================
// 1) Calendar UI Text
// ================================
const CALENDAR_UI_TEXT = {
  weeklyOff: { tooltip: "固定休假日" },
  dateTypes: {
    holiday: { tooltip: "休假日" },
    workday: { tooltipPrefix: "" },
    other: { tooltipPrefix: "" },
  },
  rule_workday_override_weeklyoff: true,
};

// ================================
// 2) 小工具
// ================================
function $(id) {
  return document.getElementById(id);
}

function toast(msg) {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => (t.style.display = "none"), 3500);
}

function normalizeDigits(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

function normalizeWeeklyOffArray_(arr) {
  // weeklyOff 可能是 [0,1,2] 或 ["0","1","2"] → 統一成 number[]
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6);
}

// ================================
// 3) Gate UI
// ================================
function hideLoading_() {
  const lo = $("loadingOverlay");
  if (lo) {
    lo.classList.add("hidden");
    lo.setAttribute("aria-busy", "false");
  }
}

function showDenied_(info) {
  hideLoading_();

  const denied = $("accessDenied");
  if (denied) denied.style.display = "block";

  const app = $("appContainer");
  if (app) app.style.display = "none";

  const titleEl = $("deniedTitle");
  const textEl = $("deniedText");
  const auditEl = $("deniedAudit");
  const nameEl = $("deniedName");
  const daysEl = $("deniedDays");

  const audit = info && info.audit ? String(info.audit) : "-";
  const name = info && info.displayName ? String(info.displayName) : "-";
  const days = info && info.remainingDays != null ? String(info.remainingDays) : "-";

  if (auditEl) auditEl.textContent = audit;
  if (nameEl) nameEl.textContent = name;
  if (daysEl) daysEl.textContent = days;

  const reason = info && info.denyReason ? String(info.denyReason) : "not_approved";

  if (reason === "not_in_liff") {
    if (titleEl) titleEl.textContent = "請在 LINE 內開啟";
    if (textEl)
      textEl.textContent = "此頁面需要透過 LIFF 取得使用者身份。請從 LINE 官方帳號的 LIFF 入口開啟。";
    return;
  }

  if (reason === "liff_login") {
    if (titleEl) titleEl.textContent = "需要登入";
    if (textEl) textEl.textContent = "正在導向登入，若未自動登入請重新開啟。";
    return;
  }

  if (reason === "endpoints_missing") {
    if (titleEl) titleEl.textContent = "系統尚未設定";
    if (textEl)
      textEl.textContent =
        "PersonalStatus 尚未配置 endpoint（ADMIN/BOOKING/TECH）。請管理員到 PersonalStatus 表填入對應欄位。";
    return;
  }

  if (reason === "endpoint_fetch_failed") {
    if (titleEl) titleEl.textContent = "讀取設定失敗";
    if (textEl) textEl.textContent = "無法從 PersonalStatus 讀取 endpoint，請稍後再試或聯絡管理員。";
    return;
  }

  if (reason === "check_failed") {
    if (titleEl) titleEl.textContent = "權限檢查失敗";
    if (textEl) textEl.textContent = "無法完成審核檢查，請稍後再試或聯絡管理員。";
    return;
  }

  if (reason === "target_not_found") {
    if (titleEl) titleEl.textContent = "找不到技師資料";
    if (textEl)
      textEl.textContent =
        "找不到此技師（Users 表沒有對應的「師傅編號」）。請確認 TARGET_MASTER_ID 與 Users 表的師傅編號一致。";
    return;
  }

  if (reason === "target_personal_disabled") {
    if (titleEl) titleEl.textContent = "此技師尚未開通";
    if (textEl)
      textEl.textContent =
        "此頁面需技師「個人狀態開通」= 是 才能使用。請聯絡管理員在 Users 後台將該技師設為「是」。";
    return;
  }

  if (reason === "target_check_failed") {
    if (titleEl) titleEl.textContent = "技師狀態檢查失敗";
    if (textEl) textEl.textContent = "無法讀取技師的開通狀態，請稍後再試或聯絡管理員。";
    return;
  }

  if (titleEl) titleEl.textContent = "尚未通過審核";
  if (textEl)
    textEl.textContent =
      "目前未通過審核（新用戶會自動建立為「待審核」），請聯絡管理員開通權限。";
}

// ================================
// 4) LIFF：取得 userId + displayName
// ================================
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

// ================================
// 5) USER_MGMT（PersonalStatus 分發用）GET helper
// ================================
async function userMgmtGet_(paramsObj) {
  const u = new URL(APP_CONFIG.USER_MGMT_API_URL);
  Object.entries(paramsObj || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  });
  u.searchParams.set("_cors", "1");

  const url = u.toString();
  console.log("[USER_MGMT] GET", url);

  const res = await fetch(url, { method: "GET" });
  const text = await res.text();

  console.log("[USER_MGMT] status", res.status);
  console.log("[USER_MGMT] raw", text.slice(0, 200));

  if (!res.ok) throw new Error("USER_MGMT HTTP " + res.status + " " + text.slice(0, 160));

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("USER_MGMT non-JSON response: " + text.slice(0, 200));
  }
}

/**
 * 從 PersonalStatus 取得 endpoints
 * 兼容兩種後端回傳：
 * - 新版（建議）：mode=getEndpoints → { ok, adminApiUrl, bookingApiUrl, techApiUrl }
 * - 你目前 GAS 已有：mode=getUserManageLink → { ok, databaseUrl, dateDatabaseUrl, personalStatusLink... }
 */
async function fetchEndpointsFromPersonalStatus_(userId) {
  // 1) 優先嘗試新版 getEndpoints
  try {
    const j = await userMgmtGet_({ mode: "getEndpoints", userId });
    if (j && j.ok) {
      const admin = String(j.adminApiUrl || "").trim();
      const booking = String(j.bookingApiUrl || "").trim();
      const tech = String(j.techApiUrl || "").trim();
      return { admin, booking, tech, source: "getEndpoints" };
    }
  } catch (e) {
    // 不存在就忽略（兼容舊版），不要直接 fail
    console.warn("[ENDPOINTS] getEndpoints not available, fallback to getUserManageLink");
  }

  // 2) fallback：你現有 GAS 的 getUserManageLink
  const j2 = await userMgmtGet_({ mode: "getUserManageLink", userId });
  if (!j2 || !j2.ok) return { admin: "", booking: "", tech: "", source: "none", raw: j2 };

  const admin = String(j2.databaseUrl || "").trim(); // C: 使用者資料庫
  const booking = String(j2.dateDatabaseUrl || "").trim(); // E: 相關日期資料庫
  // tech：舊版沒有 → 留空（之後用 config fallback）
  const tech = String(j2.techApiUrl || "").trim(); // 若你未來加欄位也可吃到
  return { admin, booking, tech, source: "getUserManageLink", raw: j2 };
}

function resolveEndpoints_(ps, config) {
  const admin = (ps.admin || "").trim() || (config.ADMIN_FALLBACK || "").trim();
  const booking = (ps.booking || "").trim() || (config.BOOKING_FALLBACK || "").trim();
  const tech = (ps.tech || "").trim() || (config.TECH_FALLBACK || "").trim();

  ENDPOINTS = {
    ADMIN_API_URL: admin,
    BOOKING_API_URL: booking,
    TECH_API_URL: tech,
  };

  console.log("[ENDPOINTS] resolved", ENDPOINTS);

  // 你提出的規則：ADMIN 讀 Users、BOOKING 讀日期DB、TECH 讀狀態
  // 所以至少 ADMIN + BOOKING 要存在；TECH 若未提供，你仍可先用舊 config fallback
  const must = ["ADMIN_API_URL", "BOOKING_API_URL"];
  const missing = must.filter((k) => !ENDPOINTS[k] || String(ENDPOINTS[k]).trim() === "");
  return { ok: missing.length === 0, missing };
}

// ================================
// 6) ADMIN（Users 資料庫）GET helper
// ================================
async function adminGet_(paramsObj) {
  const u = new URL(ENDPOINTS.ADMIN_API_URL);
  Object.entries(paramsObj || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  });
  u.searchParams.set("_cors", "1");

  const url = u.toString();
  console.log("[ADMIN] GET", url);

  const res = await fetch(url, { method: "GET" });
  const text = await res.text();

  console.log("[ADMIN] status", res.status);
  console.log("[ADMIN] raw", text.slice(0, 200));

  if (!res.ok) throw new Error("ADMIN HTTP " + res.status + " " + text.slice(0, 160));

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("ADMIN non-JSON response: " + text.slice(0, 200));
  }
}

// 依你 GAS：找不到 user 時回 status:"none", audit:"", displayName:""
function isUserNotFound_(checkJson) {
  if (!checkJson) return true;
  const status = String(checkJson.status || "").trim().toLowerCase();
  const audit = String(checkJson.audit || "").trim();
  const name = String(checkJson.displayName || "").trim();
  return status === "none" || (!audit && !name);
}

async function ensureUserExistsOnAdmin_(userId, displayName) {
  const check1 = await adminGet_({ mode: "check", userId });

  if (isUserNotFound_(check1)) {
    await adminGet_({ mode: "register", userId, displayName: displayName || "" });
    const check2 = await adminGet_({ mode: "check", userId });
    return check2;
  }

  return check1;
}

// ================================
// 7) ✅ 目標技師 Gate：TARGET_MASTER_ID 的「個人狀態開通」必須為 是
// ================================
async function fetchTargetTechRowFromAdmin_() {
  const json = await adminGet_({ mode: "listUsers" });
  const users = Array.isArray(json?.users) ? json.users : [];

  const target = normalizeDigits(APP_CONFIG.TARGET_MASTER_ID);
  const hit = users.find((u) => normalizeDigits(u.masterCode) === target);

  return hit || null;
}

async function checkTargetTechEnabledOrBlock_() {
  let techRow = null;

  try {
    techRow = await fetchTargetTechRowFromAdmin_();
  } catch (e) {
    console.error(e);
    showDenied_({ denyReason: "target_check_failed" });
    return { ok: false };
  }

  if (!techRow) {
    showDenied_({ denyReason: "target_not_found" });
    return { ok: false };
  }

  const enabled = String(techRow.personalStatusEnabled || "").trim() === "是";
  if (!enabled) {
    showDenied_({
      denyReason: "target_personal_disabled",
      audit: techRow.audit || "-",
      displayName: techRow.displayName || "-",
      remainingDays: "-",
    });
    return { ok: false };
  }

  return { ok: true, techRow };
}

// ================================
// 8) Gate：使用者通過審核 + 目標技師開通
// ================================
async function checkAccessOrBlock_() {
  const auth = await getUserIdFromLiff_();
  if (!auth) return { allowed: false };

  const userId = String(auth.userId || "").trim();
  const displayName = String(auth.profile?.displayName || "").trim();

  // 先從 PersonalStatus 取得 endpoints（你要的分工核心）
  let ps;
  try {
    ps = await fetchEndpointsFromPersonalStatus_(userId);
  } catch (e) {
    console.error(e);
    toast("讀取 endpoint 失敗：" + String(e.message || e));
    showDenied_({ denyReason: "endpoint_fetch_failed" });
    return { allowed: false };
  }

  const r = resolveEndpoints_(ps, APP_CONFIG);
  if (!r.ok) {
    console.warn("[ENDPOINTS] missing:", r.missing);
    showDenied_({ denyReason: "endpoints_missing" });
    return { allowed: false };
  }

  // 再走 ADMIN 的 check/register（Users 資料庫）
  let json;
  try {
    json = await ensureUserExistsOnAdmin_(userId, displayName);
  } catch (e) {
    console.error(e);
    toast("權限檢查失敗：" + String(e.message || e));
    showDenied_({ denyReason: "check_failed" });
    return { allowed: false };
  }

  const allowed =
    json && typeof json.allowed === "boolean"
      ? json.allowed
      : String(json.audit || "").trim() === "通過";

  if (!allowed) {
    showDenied_(json || { denyReason: "not_approved" });
    return { allowed: false };
  }

  // 目標技師 Gate（從 ADMIN listUsers）
  const techGate = await checkTargetTechEnabledOrBlock_();
  if (!techGate.ok) return { allowed: false };

  return { allowed: true, userId, profile: json, targetTech: techGate.techRow };
}

// ================================
// 9) 主題切換
// ================================
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}

function initTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  applyTheme(saved);

  const btn = $("themeToggleBtn");
  if (btn) {
    btn.onclick = () => {
      const now = document.documentElement.getAttribute("data-theme");
      applyTheme(now === "dark" ? "light" : "dark");
    };
  }
}

// ================================
// 10) Loading
// ================================
function showApp() {
  hideLoading_();
  const app = $("appContainer");
  if (app) app.style.display = "block";
}

// ================================
// 11) 師傅狀態（TECH_API_URL）
// ================================
function classifyStatus(text) {
  if (!text) return "off";

  // ✅ 建議：把你後端常見狀態納入（可自行調整映射）
  if (text.includes("工作")) return "busy";
  if (text.includes("準備")) return "idle";
  if (text.includes("備牌")) return "idle";
  if (text.includes("上班") || text.includes("可預約")) return "idle";
  if (text.includes("外出")) return "off";
  if (text.includes("排班")) return "off";
  if (text.includes("未到")) return "off";
  if (text.includes("休") || text.includes("下班")) return "off";

  return "idle";
}

function updateStatusUI(kind, data) {
  const statusEl = $(kind + "StatusText");
  const apptEl = $(kind + "AppointmentText");
  const remEl = $(kind + "RemainingText");
  if (!statusEl || !apptEl || !remEl) return;

  if (!data) {
    statusEl.innerHTML = `<span class="status-pill status-off">無資料</span>`;
    apptEl.textContent = "-";
    remEl.textContent = "-";
    return;
  }

  const statusText = String(data.status || "");
  const bucket = classifyStatus(statusText);

  statusEl.innerHTML = `<span class="status-pill status-${bucket}" aria-label="狀態：${statusText}">${statusText}</span>`;
  apptEl.textContent = data.appointment || "無預約";
  remEl.textContent = data.remaining || "-";
}

async function loadTechStatus() {
  if (!ENDPOINTS.TECH_API_URL) throw new Error("TECH_API_URL missing");

  const res = await fetch(ENDPOINTS.TECH_API_URL, { method: "GET" });
  if (!res.ok) throw new Error("TECH_API fetch failed: " + res.status);

  const json = await res.json();
  const target = normalizeDigits(APP_CONFIG.TARGET_MASTER_ID);

  const body = json.body?.find((r) => normalizeDigits(r.masterId) === target);
  const foot = json.foot?.find((r) => normalizeDigits(r.masterId) === target);

  updateStatusUI("body", body);
  updateStatusUI("foot", foot);
}

// ================================
// 12) 日曆（BOOKING_API_URL → 相關日期資料庫）
// ================================
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

const calState = {
  startTime: "",
  endTime: "",
  weeklyOff: [],
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
};

const dtState = { byDate: new Map() };
const calInfoByDate = new Map();

function normTypeText(t) {
  return String(t || "").trim();
}

function typeToBucket(type) {
  const s = String(type || "").toLowerCase();
  if (s.includes("假") || s.includes("holiday") || s.includes("休")) return "holiday";
  if (s.includes("補班") || s.includes("work") || s.includes("上班")) return "workday";
  return "other";
}

function buildLabelWithPrefix(prefix, type) {
  const p = String(prefix || "").trim();
  const t = String(type || "").trim();
  if (!p) return t;
  if (!t) return p;
  if (p === t) return p;
  return `${p} ${t}`;
}

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

function isYmd_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

async function loadBizConfig() {
  if (!ENDPOINTS.BOOKING_API_URL) throw new Error("BOOKING_API_URL missing");

  const url = `${ENDPOINTS.BOOKING_API_URL}?entity=bootstrap`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error("BOOKING_API fetch failed: " + res.status);

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "BOOKING_API error");

  const cfg = json.data?.config || {};
  const weeklyOffRaw = json.data?.weeklyOff || [];
  const datetypes = json.data?.datetypes || [];

  calState.startTime = formatTimeHHmm(cfg.startTime);
  calState.endTime = formatTimeHHmm(cfg.endTime);

  // ✅ 型別統一（很重要）
  calState.weeklyOff = normalizeWeeklyOffArray_(weeklyOffRaw);

  dtState.byDate = new Map();
  (Array.isArray(datetypes) ? datetypes : []).forEach((r) => {
    const date = String(r.Date || r.date || "").trim();
    const type = normTypeText(r.Type || r.DateType || r.type);

    // ✅ 契約防呆：日期格式不正確就略過
    if (!isYmd_(date)) return;
    if (!type) return;

    const item = { type, bucket: typeToBucket(type) };
    if (!dtState.byDate.has(date)) dtState.byDate.set(date, []);
    dtState.byDate.get(date).push(item);
  });

  const summary = $("bizSummary");
  if (summary) {
    summary.textContent =
      calState.startTime && calState.endTime
        ? `預約時間：${calState.startTime} ~ ${calState.endTime}`
        : `預約時間：未設定`;
  }

  renderCalendar();
}

function renderWeekdays() {
  const el = $("calWeekdays");
  if (!el) return;
  el.innerHTML = WEEKDAY_LABELS.map((w) => `<div>${w}</div>`).join("");
}

function renderCalendar() {
  renderWeekdays();

  const grid = $("calGrid");
  const label = $("calMonthLabel");
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
  const isToday = (yy, mm, dd) =>
    yy === today.getFullYear() && mm === today.getMonth() && dd === today.getDate();

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(y, m, d);
    const dow = dateObj.getDay();

    let off = calState.weeklyOff.includes(dow);

    const ymd = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dtItems = dtState.byDate.get(ymd) || [];

    if (
      CALENDAR_UI_TEXT.rule_workday_override_weeklyoff === true &&
      dtItems.some((it) => it.bucket === "workday")
    ) {
      off = false;
    }

    calInfoByDate.set(ymd, { off, dtItems });

    const hasHoliday = dtItems.some((it) => it.bucket === "holiday");
    const hasWorkday = dtItems.some((it) => it.bucket === "workday");
    const hasOther = dtItems.some((it) => it.bucket === "other");
    const isWeeklyOff = off === true;

    let stateCls = "";
    if (hasHoliday) stateCls = "is-holiday";
    else if (hasWorkday) stateCls = "is-workday";
    else if (isWeeklyOff) stateCls = "is-weeklyoff";
    else if (hasOther) stateCls = "is-special";

    const cls = ["cal-cell", stateCls, isToday(y, m, d) ? "is-today" : ""].filter(Boolean).join(" ");

    cells.push(`
      <div class="${cls}" data-ymd="${ymd}">
        <div class="cal-date">${d}</div>
      </div>
    `);
  }

  grid.innerHTML = cells.join("");

  grid.querySelectorAll(".cal-cell[data-ymd]").forEach((cell) => {
    cell.onclick = () => {
      grid.querySelectorAll(".cal-cell.is-selected").forEach((c) => c.classList.remove("is-selected"));
      cell.classList.add("is-selected");

      const ymd = cell.getAttribute("data-ymd");
      const info = calInfoByDate.get(ymd);
      if (!info) return;

      const lines = [ymd];

      if (info.off) lines.push(CALENDAR_UI_TEXT.weeklyOff.tooltip || "固定休假日");

      (info.dtItems || []).forEach((it) => {
        if (it.bucket === "holiday") {
          lines.push(CALENDAR_UI_TEXT.dateTypes.holiday.tooltip || "休假日");
          return;
        }
        const cfg = CALENDAR_UI_TEXT.dateTypes[it.bucket] || CALENDAR_UI_TEXT.dateTypes.other;
        const tip = buildLabelWithPrefix(cfg.tooltipPrefix, it.type);
        if (tip) lines.push(tip);
      });

      if (lines.length === 1) lines.push("無特殊設定");
      toast(lines.join("｜"));
    };
  });
}

function bindCalendarNav() {
  const prev = $("calPrev");
  const next = $("calNext");

  if (prev)
    prev.onclick = () => {
      calState.viewMonth--;
      if (calState.viewMonth < 0) {
        calState.viewMonth = 11;
        calState.viewYear--;
      }
      renderCalendar();
    };

  if (next)
    next.onclick = () => {
      calState.viewMonth++;
      if (calState.viewMonth > 11) {
        calState.viewMonth = 0;
        calState.viewYear++;
      }
      renderCalendar();
    };
}

// ================================
// 13) 初始化
// ================================
window.onload = async () => {
  initTheme();
  bindCalendarNav();

  try {
    await loadConfig_();

    const mid = $("techMasterId");
    if (mid) mid.textContent = APP_CONFIG.TARGET_MASTER_ID;

    // Gate（內含：先抓 endpoints → 再走 ADMIN check/register → 再做 target tech gate）
    const gate = await checkAccessOrBlock_();
    if (!gate.allowed) return;

    // 進入後：TECH + BOOKING 同時載入
    await Promise.all([loadTechStatus(), loadBizConfig()]);
    showApp();

    setInterval(async () => {
      try {
        await loadTechStatus();
      } catch (e) {
        toast("師傅狀態更新失敗：" + String(e.message || e));
      }
    }, 10000);
  } catch (err) {
    showApp();
    toast("初始化失敗：" + String(err.message || err));
    console.error(err);
  }
};
