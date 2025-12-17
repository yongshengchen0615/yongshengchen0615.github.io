// ================================
// 1) API 設定：請填你的 GAS Web App
// ================================

// A) 師傅狀態 Web App URL（你原本那支）
const TECH_API_URL =
  "https://script.google.com/macros/s/AKfycbwXwpKPzQFuIWtZOJpeGU9aPbl3RR5bj9yVWjV7mfyYaABaxMetKn_3j_mdMJGN9Ok5Ug/exec";

// B) Booking CRUD（含 Config / DateTypes）那支
const BOOKING_API_URL =
  "https://script.google.com/macros/s/AKfycbyDLxx5tINOCerjzpH3_dhxBCDR_SGw-bLatqLpcLgbx01ds3UJ0nJPCy7rkDhimxYvVw/exec";

// 想顯示的師傅 ID
const TARGET_MASTER_ID = "10";

// ================================
// 2) Calendar UI Text（點選日期才顯示文字）
// ================================
const CALENDAR_UI_TEXT = {
  weeklyOff: {
    tooltip: "固定休假日",
  },
  dateTypes: {
    holiday: { tooltip: "休假日" },
    workday: { tooltipPrefix: "" }, // 例如你想顯示「補班」可加前綴
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

/**
 * ✅ 把 Config 的時間（可能是 Date / 1899-12-30 / "09:00" / 0.375 / "0.375"）統一轉成 "HH:mm"
 */
function formatTimeHHmm(val) {
  if (val == null || val === "") return "";

  const s = String(val).trim();

  // 1) 字串本來就是 HH:mm
  const m = s.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;

  // 2) ISO 8601 (UTC Z) => +8 (Asia/Taipei)
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

  // 3) number: Sheets time fraction (0~1)
  if (typeof val === "number" && isFinite(val) && val >= 0 && val < 1) {
    const totalMinutes = Math.round(val * 24 * 60);
    const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
    const mm = String(totalMinutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // 4) string number: "0.375"
  if (/^\d+(\.\d+)?$/.test(s)) {
    const num = Number(s);
    if (isFinite(num) && num >= 0 && num < 1) {
      const totalMinutes = Math.round(num * 24 * 60);
      const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
      const mm = String(totalMinutes % 60).padStart(2, "0");
      return `${hh}:${mm}`;
    }
  }

  // 5) fallback：一般 Date 字串（不帶 Z）
  const d2 = new Date(s);
  if (!isNaN(d2.getTime())) {
    const hh = String(d2.getHours()).padStart(2, "0");
    const mm = String(d2.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  return "";
}

// ================================
// 4) 主題切換
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
// 5) Loading
// ================================
function showApp() {
  const lo = $("loadingOverlay");
  const app = $("appContainer");
  if (lo) {
    lo.classList.add("hidden");
    lo.setAttribute("aria-busy", "false");
  }
  if (app) app.style.display = "block";
}

// ================================
// 6) 師傅狀態 UI
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
// 7) 日曆：整格底色 + 點擊 toast
// ================================
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

const calState = {
  startTime: "",
  endTime: "",
  weeklyOff: [],
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
};

// yyyy-MM-dd -> [{ type, bucket }]
const dtState = { byDate: new Map() };

// 點擊用：ymd -> { off, dtItems }
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

  // 前置空白
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

    // 補班覆蓋固定休：不灰底
    if (
      CALENDAR_UI_TEXT.rule_workday_override_weeklyoff === true &&
      dtItems.some((it) => it.bucket === "workday")
    ) {
      off = false;
    }

    calInfoByDate.set(ymd, { off, dtItems });

    // ===== 顏色優先級（只挑一個主狀態，避免混色）=====
    const hasHoliday = dtItems.some((it) => it.bucket === "holiday");
    const hasWorkday = dtItems.some((it) => it.bucket === "workday");
    const hasOther   = dtItems.some((it) => it.bucket === "other");
    const isWeeklyOff = off === true;

    let stateCls = "";
    if (hasHoliday) stateCls = "is-holiday";
    else if (hasWorkday) stateCls = "is-workday";
    else if (isWeeklyOff) stateCls = "is-weeklyoff";
    else if (hasOther) stateCls = "is-special";

    const cls = [
      "cal-cell",
      stateCls,
      isWeeklyOff ? "is-off" : "",
      isToday(y, m, d) ? "is-today" : "",
    ]
      .filter(Boolean)
      .join(" ");

    cells.push(`
      <div class="${cls}" data-ymd="${ymd}">
        <div class="cal-date">${d}</div>
      </div>
    `);
  }

  grid.innerHTML = cells.join("");

  // 點選日期：toast 顯示文字
  grid.querySelectorAll('.cal-cell[data-ymd]').forEach((cell) => {
    cell.onclick = () => {
      grid.querySelectorAll(".cal-cell.is-selected").forEach((c) => c.classList.remove("is-selected"));
      cell.classList.add("is-selected");

      const ymd = cell.getAttribute("data-ymd");
      const info = calInfoByDate.get(ymd);
      if (!info) return;

      const lines = [ymd];

      if (info.off) {
        lines.push(CALENDAR_UI_TEXT.weeklyOff.tooltip || "固定休假日");
      }

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
// 8) 初始化
// ================================
window.onload = async () => {
  initTheme();

  const mid = $("techMasterId");
  if (mid) mid.textContent = TARGET_MASTER_ID;

  bindCalendarNav();

  try {
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
