// ================================
// 0) 你要改的兩個值
// ================================

// ✅ 你的 LIFF ID
const LIFF_ID = "2008669658-CwYIitI1";

// ✅ 管理員 Users 後台那支（審核 gate 用）
const ADMIN_API_URL =
  "https://script.google.com/macros/s/AKfycbyBg3w57x-Yw4C6v-SQ9rQazx6n9_VZRDjPKvXJy8WNkv29KPbrd8gHKIu1DFjwstUg/exec";

// ================================
// 1) 其他 API 設定（你原本那兩支）
// ================================
const TECH_API_URL =
  "https://script.google.com/macros/s/AKfycbwXwpKPzQFuIWtZOJpeGU9aPbl3RR5bj9yVWjV7mfyYaABaxMetKn_3j_mdMJGN9Ok5Ug/exec";

const BOOKING_API_URL =
  "https://script.google.com/macros/s/AKfycbyDLxx5tINOCerjzpH3_dhxBCDR_SGw-bLatqLpcLgbx01ds3UJ0nJPCy7rkDhimxYvVw/exec";

// 想顯示的師傅 ID
const TARGET_MASTER_ID = "10";

// ================================
// 2) Calendar UI Text
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
// 3) 小工具
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

// ================================
// 4) Gate UI（未通過審核 / 非 LIFF 環境）
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
      textEl.textContent =
        "此頁面需要透過 LIFF 取得使用者身份。請從 LINE 官方帳號的 LIFF 入口開啟。";
    return;
  }

  if (reason === "liff_login") {
    if (titleEl) titleEl.textContent = "需要登入";
    if (textEl) textEl.textContent = "正在導向登入，若未自動登入請重新開啟。";
    return;
  }

  if (reason === "check_failed") {
    if (titleEl) titleEl.textContent = "權限檢查失敗";
    if (textEl) textEl.textContent = "無法完成審核檢查，請稍後再試或聯絡管理員。";
    return;
  }

  if (titleEl) titleEl.textContent = "尚未通過審核";
  if (textEl)
    textEl.textContent =
      "目前未通過審核（新用戶會自動建立為「待審核」），請聯絡管理員開通權限。";
}

// ================================
// 5) LIFF：取得 userId + displayName
// ================================
async function getUserIdFromLiff_() {
  if (typeof liff === "undefined") {
    showDenied_({ denyReason: "not_in_liff" });
    return null;
  }

  await liff.init({ liffId: LIFF_ID });

  if (!liff.isLoggedIn()) {
    showDenied_({ denyReason: "liff_login" });
    liff.login();
    return null; // login 會 redirect
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
// 6) 管理員 GAS：check + 若不存在則 register（預設待審核）
//    ✅ 加入 debug：避免回 HTML / 不是 JSON 時看不到原因
// ================================
async function adminGet_(paramsObj) {
  const u = new URL(ADMIN_API_URL);
  Object.entries(paramsObj || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  });
  u.searchParams.set("_cors", "1");

  const url = u.toString();
  console.log("[ADMIN_API] GET", url);

  const res = await fetch(url, { method: "GET" });
  const text = await res.text();

  console.log("[ADMIN_API] status", res.status);
  console.log("[ADMIN_API] raw", text.slice(0, 200));

  if (!res.ok) {
    throw new Error("ADMIN_API HTTP " + res.status + " " + text.slice(0, 120));
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("ADMIN_API non-JSON response: " + text.slice(0, 160));
  }
}

// 依你目前 GAS：找不到 user 時回 status:"none", audit:"", displayName:""
function isUserNotFound_(checkJson) {
  if (!checkJson) return true;
  const status = String(checkJson.status || "").trim().toLowerCase();
  const audit = String(checkJson.audit || "").trim();
  const name = String(checkJson.displayName || "").trim();
  return status === "none" || (!audit && !name);
}

async function ensureUserExists_(userId, displayName) {
  const check1 = await adminGet_({ mode: "check", userId });

  if (isUserNotFound_(check1)) {
    // ✅ 自動建立：handleRegister_ 會預設待審核
    await adminGet_({
      mode: "register",
      userId,
      displayName: displayName || "",
    });

    const check2 = await adminGet_({ mode: "check", userId });
    return check2;
  }

  return check1;
}

// ================================
// 7) 審核 Gate：通過審核才能進主畫面
// ================================
async function checkAccessOrBlock_() {
  const auth = await getUserIdFromLiff_();
  if (!auth) return { allowed: false };

  const userId = String(auth.userId || "").trim();
  const displayName = String(auth.profile?.displayName || "").trim();

  let json;
  try {
    // ✅ 若不存在就自動 register（待審核）
    json = await ensureUserExists_(userId, displayName);
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

  return { allowed: true, userId, profile: json };
}

// ================================
// 8) 主題切換
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
// 9) Loading
// ================================
function showApp() {
  hideLoading_();
  const app = $("appContainer");
  if (app) app.style.display = "block";
}

// ================================
// 10) 師傅狀態 UI
// ================================
function classifyStatus(text) {
  if (!text) return "off";
  if (text.includes("工作")) return "busy";
  if (text.includes("上班") || text.includes("可預約")) return "idle";
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

  const bucket = classifyStatus(String(data.status || ""));
  statusEl.innerHTML = `<span class="status-pill status-${bucket}">${String(
    data.status || ""
  )}</span>`;
  apptEl.textContent = data.appointment || "無預約";
  remEl.textContent = data.remaining || "-";
}

async function loadTechStatus() {
  const res = await fetch(TECH_API_URL, { method: "GET" });
  if (!res.ok) throw new Error("TECH_API fetch failed: " + res.status);

  const json = await res.json();
  const target = normalizeDigits(TARGET_MASTER_ID);

  const body = json.body?.find((r) => normalizeDigits(r.masterId) === target);
  const foot = json.foot?.find((r) => normalizeDigits(r.masterId) === target);

  updateStatusUI("body", body);
  updateStatusUI("foot", foot);
}

// ================================
// 11) 日曆：整格底色 + 點擊 toast
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

  if (/\d{4}-\d{2}-\d{2}T/.test(s) && /Z$/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const utcH = d.getUTCHours();
      const utcM = d.getUTCMinutes();
      const total = utcH * 60 + utcM + 8 * 60;
      const hh = String(Math.floor((total % 1440) / 60)).padStart(2, "0");
      const mm = String(total % 60).padStart(2, "0");
      return `${hh}:${mm}`;
    }
  }

  if (typeof val === "number" && isFinite(val) && val >= 0 && val < 1) {
    const totalMinutes = Math.round(val * 24 * 60);
    const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
    const mm = String(totalMinutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  if (/^\d+(\.\d+)?$/.test(s)) {
    const num = Number(s);
    if (isFinite(num) && num >= 0 && num < 1) {
      const totalMinutes = Math.round(num * 24 * 60);
      const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
      const mm = String(totalMinutes % 60).padStart(2, "0");
      return `${hh}:${mm}`;
    }
  }

  const d2 = new Date(s);
  if (!isNaN(d2.getTime())) {
    const hh = String(d2.getHours()).padStart(2, "0");
    const mm = String(d2.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  return "";
}

async function loadBizConfig() {
  const url = `${BOOKING_API_URL}?entity=bootstrap`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error("BOOKING_API fetch failed: " + res.status);

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "BOOKING_API error");

  const cfg = json.data?.config || {};
  const weeklyOff = json.data?.weeklyOff || [];
  const datetypes = json.data?.datetypes || [];

  calState.startTime = formatTimeHHmm(cfg.startTime);
  calState.endTime = formatTimeHHmm(cfg.endTime);
  calState.weeklyOff = Array.isArray(weeklyOff) ? weeklyOff : [];

  dtState.byDate = new Map();
  (Array.isArray(datetypes) ? datetypes : []).forEach((r) => {
    const date = String(r.Date || r.date || "").trim();
    const type = normTypeText(r.Type || r.DateType || r.type);
    if (!date || !type) return;

    const item = { type, bucket: typeToBucket(type) };
    if (!dtState.byDate.has(date)) dtState.byDate.set(date, []);
    dtState.byDate.get(date).push(item);
  });

  const summary = $("bizSummary");
  if (summary) {
    const timePart =
      calState.startTime && calState.endTime
        ? `預約時間：${calState.startTime} ~ ${calState.endTime}`
        : `預約時間：未設定`;
    summary.textContent = timePart;
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

    const cls = ["cal-cell", stateCls, isToday(y, m, d) ? "is-today" : ""]
      .filter(Boolean)
      .join(" ");

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
// 12) 初始化（✅ 先 LIFF → check → 若無則 register → 再 check → 通過才載入）
// ================================
window.onload = async () => {
  initTheme();

  const mid = $("techMasterId");
  if (mid) mid.textContent = TARGET_MASTER_ID;

  bindCalendarNav();

  try {
    const gate = await checkAccessOrBlock_();
    if (!gate.allowed) return;

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
  }
};
