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
// 2) Calendar Display Text Config（所有日曆標記文字只改這裡）
// ================================
const CALENDAR_UI_TEXT = {
  weeklyOff: {
    tag: "固定休",
    tooltip: "固定休假日",
  },

  // ✅ holiday 跟 weeklyOff 一樣：只靠 tag/tooltip
  // 其他 bucket 維持 prefix + type
  dateTypes: {
    holiday: { tag: "休假", tooltip: "休假日" },
    workday: { tagPrefix: "補班", tooltipPrefix: "" },
    other: { tagPrefix: "", tooltipPrefix: "" },
  },

  tooltip: { bullet: "• " },
  tagLimit: 2,

  // DateTypes 有 workday 時，覆蓋 weeklyOff（不灰底）
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

function safeAttrText(s) {
  return String(s || "").replace(/"/g, "&quot;");
}

/**
 * ✅ 把 Config 的時間（可能是 Date / 1899-12-30 / "09:00" / 0.375 / "0.375"）統一轉成 "HH:mm"
 */
function formatTimeHHmm(val) {
  if (val == null || val === "") return "";

  // 1) 字串本來就是 HH:mm
  const s = String(val).trim();
  const m = s.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;

  // 2) ✅ ISO 8601 (UTC Z) => 轉 Asia/Taipei (+08:00)
  //    例如 "1899-12-30T02:00:00.000Z" -> 10:00
  if (/\d{4}-\d{2}-\d{2}T/.test(s) && /Z$/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      // 用 UTC 取時分，再 +8 小時（台北）
      const utcH = d.getUTCHours();
      const utcM = d.getUTCMinutes();
      const total = utcH * 60 + utcM + 8 * 60; // +08:00
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
// 7) 營業設定（日曆） + DateTypes + WeeklyOff Tag
// ================================
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

const calState = {
  startTime: "",
  endTime: "",
  weeklyOff: [],
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
};

// DateTypes index: yyyy-MM-dd -> [{ type, bucket }]
const dtState = { byDate: new Map() };

function normTypeText(t) {
  return String(t || "").trim();
}

function typeToBucket(type) {
  const s = String(type || "").toLowerCase();
  if (s.includes("假") || s.includes("holiday") || s.includes("休")) return "holiday";
  if (s.includes("補班") || s.includes("work") || s.includes("上班")) return "workday";
  return "other";
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

  // ===== DEBUG: 檢查 startTime / endTime 真實型態 =====
  console.group("[DEBUG] Config startTime / endTime");
  console.log("raw cfg.startTime =", cfg.startTime);
  console.log("typeof cfg.startTime =", typeof cfg.startTime);
  console.log("instanceof Date =", cfg.startTime instanceof Date);

  console.log("raw cfg.endTime =", cfg.endTime);
  console.log("typeof cfg.endTime =", typeof cfg.endTime);
  console.log("instanceof Date =", cfg.endTime instanceof Date);

  console.log("formatTimeHHmm(startTime) =", formatTimeHHmm(cfg.startTime));
  console.log("formatTimeHHmm(endTime)   =", formatTimeHHmm(cfg.endTime));
  console.groupEnd();
  // ================================================

  // ✅ 修正：時間格式只取 HH:mm
  calState.startTime = formatTimeHHmm(cfg.startTime);
  calState.endTime = formatTimeHHmm(cfg.endTime);
  calState.weeklyOff = Array.isArray(weeklyOff) ? weeklyOff : [];

  // ✅ DateTypes 索引
  dtState.byDate = new Map();
  (Array.isArray(datetypes) ? datetypes : []).forEach((r) => {
    const date = String(r.Date || r.date || "").trim(); // yyyy-MM-dd
    const type = normTypeText(r.Type || r.DateType || r.type);
    if (!date || !type) return;

    const item = { type, bucket: typeToBucket(type) };
    if (!dtState.byDate.has(date)) dtState.byDate.set(date, []);
    dtState.byDate.get(date).push(item);
  });

  // ✅ 上方摘要：只顯示營業時間
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

function bucketToTagClass(bucket) {
  if (bucket === "holiday") return "holiday";
  if (bucket === "workday") return "workday";
  return "other";
}

function buildLabelWithPrefix(prefix, type) {
  const p = String(prefix || "").trim();
  const t = String(type || "").trim();
  const lt = t.toLowerCase();

  const isGeneric = !t || lt === "holiday" || lt === "workday" || lt === "other";
  if (!p) return t;
  if (isGeneric) return p;
  if (p === t) return p;
  return `${p} ${t}`;
}

function getHolidayTagText() {
  const h = CALENDAR_UI_TEXT.dateTypes?.holiday || {};
  return String(h.tag || "").trim();
}
function getHolidayTooltipText() {
  const h = CALENDAR_UI_TEXT.dateTypes?.holiday || {};
  return String(h.tooltip || "").trim();
}

function buildCalendarTagsAndTooltip({ off, dtItems }) {
  const ui = CALENDAR_UI_TEXT;

  const tags = [];
  const tooltipLines = [];

  if (off) {
    tags.push({ text: ui.weeklyOff.tag, cls: "weeklyoff" });
    tooltipLines.push(ui.tooltip.bullet + ui.weeklyOff.tooltip);
  }

  dtItems.forEach((it) => {
    const bucket = it.bucket;
    const cls = bucketToTagClass(bucket);

    if (bucket === "holiday") {
      const tagText = getHolidayTagText();
      const tipText = getHolidayTooltipText();

      if (tagText) tags.push({ text: tagText, cls });
      if (tipText) tooltipLines.push(ui.tooltip.bullet + tipText);
      return;
    }

    const cfg = ui.dateTypes[bucket] || ui.dateTypes.other;
    const tagText = buildLabelWithPrefix(cfg.tagPrefix, it.type);
    const tipText = buildLabelWithPrefix(cfg.tooltipPrefix, it.type);

    if (tagText) tags.push({ text: tagText, cls });
    if (tipText) tooltipLines.push(ui.tooltip.bullet + tipText);
  });

  if (!tags.length) return { tagsHtml: "", tooltipAttr: "" };

  const limit = Math.max(0, Number(ui.tagLimit || 0)) || 2;
  const show = tags.slice(0, limit);
  const rest = tags.length - show.length;

  const tagHtml = show
    .map(
      (t) =>
        `<span class="cal-tag ${t.cls}" title="${safeAttrText(t.text)}">${t.text}</span>`
    )
    .join("");

  const more = rest > 0 ? `<span class="cal-tag other">+${rest}</span>` : "";
  const tagsHtml = `<div class="cal-tags">${tagHtml}${more}</div>`;

  const tooltipAttr = tooltipLines.length
    ? ` data-tooltip="${safeAttrText(tooltipLines.join("\n"))}"`
    : "";

  return { tagsHtml, tooltipAttr };
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

    const { tagsHtml, tooltipAttr } = buildCalendarTagsAndTooltip({ off, dtItems });

    const cls = ["cal-cell", off ? "is-off" : "", isToday(y, m, d) ? "is-today" : ""]
      .filter(Boolean)
      .join(" ");

    cells.push(`
      <div class="${cls}" data-ymd="${ymd}"${tooltipAttr}>
        ${tagsHtml}
        <div class="cal-date">${d}</div>
      </div>
    `);
  }

  grid.innerHTML = cells.join("");
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
