// ===== 1) Booking / DateTypes Web App URL =====
const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwp46vU_Vk_s05D_LTbjAnDfUI4cyEUgQETikt6aIInecfZCAb_RI_vXZUm89GbNhEDgQ/exec";

// ===== 2) 師傅狀態 Web App URL =====
const TECH_API_URL =
  "https://script.google.com/macros/s/AKfycbwp46vU_Vk_s05D_LTbjAnDfUI4cyEUgQETikt6aIInecfZCAb_RI_vXZUm89GbNhEDgQ/exec";

// ===== 3) 使用者審核 / Users Web App URL =====
const AUTH_API_URL =
  "https://script.google.com/macros/s/AKfycbyBg3w57x-Yw4C6v-SQ9rQazx6n9_VZRDjPKvXJy8WNkv29KPbrd8gHKIu1DFjwstUg/exec";

// ===== 4) LIFF ID（改成你的實際 LIFF ID） =====
const LIFF_ID = "2008669658-CwYIitI1";

// 想看的師傅 masterId
const MASTER_ID = "07";

// 月曆狀態
let currentYear = 0;
let currentMonth = 0;

// 使用者狀態
let currentUser = { userId: "", displayName: "" };

/* ========== 工具：顯示/隱藏畫面 ========== */
function showApp() {
  document.getElementById("loadingOverlay").classList.add("hidden");
  document.getElementById("appContainer").style.display = "block";
}

/* ========== 小工具：標題、副標題、審核提示卡 ========== */
function setSubtitle(text) {
  const el = document.querySelector(".subtitle");
  if (el) el.textContent = text || "";
}

function showAuditNotice(type, msg) {
  const box = document.getElementById("auditNotice");
  if (!box) return;
  box.style.display = "block";
  box.className = "audit-notice " + (type || "");
  box.textContent = msg || "";
}

function hideAuditNotice() {
  const box = document.getElementById("auditNotice");
  if (!box) return;
  box.style.display = "none";
  box.className = "audit-notice";
  box.textContent = "";
}

function showProtectedContent() {
  const el = document.getElementById("protectedContent");
  if (el) el.style.display = "block";
}

function hideProtectedContent() {
  const el = document.getElementById("protectedContent");
  if (el) el.style.display = "none";
}

/* ========= 月曆資料：bootstrap ========= */
function normalizeType(val) {
  return String(val || "").trim().toLowerCase();
}

// 從 Data_* 回傳格式 → 統一成 [{ date:"YYYY-MM-DD", type:"rest|out|book|..." , title:"..." }]
function normalizeBookings(data) {
  const out = [];

  const rows = Array.isArray(data.rows) ? data.rows : [];
  rows.forEach(r => {
    const date = String(r.date || r.Date || "").trim();
    const type = normalizeType(r.type || r.Type || r.status || r.Status);
    const title = String(r.title || r.Title || r.note || r.Note || "").trim();

    if (!date) return;
    out.push({ date, type, title });
  });

  // weeklyOff: [0..6] 代表每週固定休
  // extra: optional
  return out;
}

function ymd(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* ========= API：通用 fetch ========= */
async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("JSON parse failed:", text);
    throw new Error("Invalid JSON response");
  }
}

/* ========= AUTH API ========= */
async function callAuthApi(mode, payload) {
  const m = String(mode || "").toLowerCase();
  // 你這支 GAS 同時支援 GET/POST；這裡用 GET 方便 CORS（你已有 preflight）
  const qs = new URLSearchParams({ mode: m, ...payload }).toString();
  const url = `${AUTH_API_URL}?${qs}`;
  return await fetchJson(url);
}

/* ========= Booking/DateTypes API ========= */
async function callBookingApi(mode, payload) {
  const m = String(mode || "").toLowerCase();
  const qs = new URLSearchParams({ mode: m, ...payload }).toString();
  const url = `${WEB_APP_URL}?${qs}`;
  return await fetchJson(url);
}

/* ========= TechStatus API ========= */
async function callTechApi(mode, payload) {
  const m = String(mode || "").toLowerCase();
  const qs = new URLSearchParams({ mode: m, ...payload }).toString();
  const url = `${TECH_API_URL}?${qs}`;
  return await fetchJson(url);
}

/* ========= 月曆 UI ========= */
function setMonthLabel(year, month) {
  const el = document.getElementById("monthLabel");
  if (!el) return;
  el.textContent = `${year} / ${month + 1}`;
}

function clearCalendar() {
  const tbody = document.getElementById("calendarBody");
  if (tbody) tbody.innerHTML = "";
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function renderCalendar(bookings, weeklyOffSet) {
  clearCalendar();

  const tbody = document.getElementById("calendarBody");
  if (!tbody) return;

  const first = new Date(currentYear, currentMonth, 1);
  const last = new Date(currentYear, currentMonth + 1, 0);
  const startDay = first.getDay();
  const daysInMonth = last.getDate();

  const today = new Date();

  // bookings map by date
  const byDate = new Map();
  bookings.forEach(b => {
    if (!byDate.has(b.date)) byDate.set(b.date, []);
    byDate.get(b.date).push(b);
  });

  let dayNum = 1;
  for (let week = 0; week < 6; week++) {
    const tr = document.createElement("tr");

    for (let dow = 0; dow < 7; dow++) {
      const td = document.createElement("td");

      const cellIndex = week * 7 + dow;
      if (cellIndex < startDay || dayNum > daysInMonth) {
        td.innerHTML = "&nbsp;";
        tr.appendChild(td);
        continue;
      }

      const d = new Date(currentYear, currentMonth, dayNum);
      const dateStr = ymd(d);

      // date number
      const dateNumEl = document.createElement("div");
      dateNumEl.className = "date-num";
      dateNumEl.textContent = String(dayNum);
      td.appendChild(dateNumEl);

      // tags
      const tagsWrap = document.createElement("div");
      tagsWrap.className = "tags";

      // weekly off
      if (weeklyOffSet && weeklyOffSet.has(dow)) {
        const tag = document.createElement("span");
        tag.className = "tag rest";
        tag.textContent = "固定休";
        tagsWrap.appendChild(tag);
      }

      const items = byDate.get(dateStr) || [];
      items.forEach(item => {
        const t = normalizeType(item.type);
        const tag = document.createElement("span");
        tag.className = "tag " + (t === "rest" ? "rest" : t === "out" ? "out" : "book");
        tag.textContent = item.title || (t === "rest" ? "休息" : t === "out" ? "外出" : "預約");
        tagsWrap.appendChild(tag);
      });

      if (tagsWrap.childNodes.length) td.appendChild(tagsWrap);

      // today
      if (isSameDay(d, today)) td.classList.add("is-today");

      // click popup
      td.addEventListener("click", () => {
        const popup = document.getElementById("popup");
        if (!popup) return;

        const all = [];

        if (weeklyOffSet && weeklyOffSet.has(dow)) {
          all.push("固定休");
        }

        items.forEach(item => {
          const t = normalizeType(item.type);
          const label = item.title || (t === "rest" ? "休息" : t === "out" ? "外出" : "預約");
          all.push(label);
        });

        if (!all.length) {
          popup.style.display = "block";
          popup.textContent = `${dateStr}：無資料`;
          return;
        }

        popup.style.display = "block";
        popup.textContent = `${dateStr}：${all.join("、")}`;
      });

      tr.appendChild(td);
      dayNum++;
    }

    tbody.appendChild(tr);
    if (dayNum > daysInMonth) break;
  }
}

/* ========= 取 Booking 資料 ========= */
async function loadData() {
  setSubtitle("載入月曆資料中…");

  // 你原本的 GAS 可能回傳 { ok:true, datetypes:[], weeklyOff:[] } 或 { rows:[] }
  const data = await callBookingApi("datetypes", { masterId: MASTER_ID });

  const weeklyOffSet = new Set();
  let weeklyOffRaw = data.weeklyOff;

  if (typeof weeklyOffRaw === "string") {
    try {
      const parsed = JSON.parse(weeklyOffRaw);
      if (Array.isArray(parsed)) weeklyOffRaw = parsed;
    } catch (_) {}
  }
  if (Array.isArray(weeklyOffRaw)) {
    weeklyOffRaw.forEach(v => {
      const num = Number(v);
      if (!isNaN(num) && num >= 0 && num <= 6) {
        weeklyOffSet.add(num);
      }
    });
  }

  const dtRows = Array.isArray(data.datetypes)
    ? data.datetypes.map(r => ({
        date: String(r.date || r.Date || "").trim(),
        type: normalizeType(r.type || r.Type),
        title: String(r.title || r.Title || "").trim()
      }))
    : normalizeBookings(data);

  setMonthLabel(currentYear, currentMonth);
  renderCalendar(dtRows, weeklyOffSet);

  setSubtitle("月曆資料已更新");
}

/* ========= 取 Tech Status ========= */
function fmtRemaining(n) {
  if (n === null || n === undefined || n === "") return "-";
  const v = Number(n);
  if (isNaN(v)) return String(n);
  return v + " 分";
}

async function loadTechStatus() {
  const data = await callTechApi("check", { masterId: MASTER_ID });

  const techIdEl = document.getElementById("techMasterId");
  if (techIdEl) techIdEl.textContent = MASTER_ID;

  // body
  const bodyStatusText = document.getElementById("bodyStatusText");
  const bodyAppointmentText = document.getElementById("bodyAppointmentText");
  const bodyRemainingText = document.getElementById("bodyRemainingText");

  if (bodyStatusText) bodyStatusText.textContent = data.bodyStatus || "-";
  if (bodyAppointmentText) bodyAppointmentText.textContent = data.bodyAppointment || "-";
  if (bodyRemainingText) bodyRemainingText.textContent = fmtRemaining(data.bodyRemaining);

  // foot
  const footStatusText = document.getElementById("footStatusText");
  const footAppointmentText = document.getElementById("footAppointmentText");
  const footRemainingText = document.getElementById("footRemainingText");

  if (footStatusText) footStatusText.textContent = data.footStatus || "-";
  if (footAppointmentText) footAppointmentText.textContent = data.footAppointment || "-";
  if (footRemainingText) footRemainingText.textContent = fmtRemaining(data.footRemaining);
}

/* ========= LIFF ========= */
function getCurrentUser() {
  return currentUser || { userId: "", displayName: "" };
}

async function ensureApprovedUser() {
  const { userId, displayName } = getCurrentUser();

  // 預設先鎖住功能區，只有「通過」才放行
  hideProtectedContent();

  if (!userId) {
    setSubtitle("尚未取得使用者身分，請重新開啟此 LIFF。");
    showAuditNotice(
      "audit-rejected",
      "❗ 無法取得使用者資料，請關閉畫面後重新從 LINE 開啟。"
    );
    throw new Error("no_userId");
  }

  setSubtitle("正在檢查審核狀態…");
  hideAuditNotice();

  const check = await callAuthApi("check", { userId });
  // { status: "none" | "pending" | "approved", audit: "通過/待審核/拒絕/停用..." }

  const auditText = String(check.audit || "").trim();
  const isApproved = auditText === "通過" || check.status === "approved";

  if (isApproved) {
    const label = auditText || "通過";
    setSubtitle(`您好，${displayName || "貴賓"}，審核狀態：${label}`);
    showAuditNotice("audit-approved", "✔ 審核已通過，您可以使用全部功能。");
    showProtectedContent(); // ✅ 放行功能區
    return;
  }

  if (check.status === "none") {
    // 第一次進來 → 幫他註冊 + 提示審核中
    await callAuthApi("register", { userId, displayName });

    setSubtitle("已送出加入申請，審核中。審核通過前無法使用此頁面。");
    showAuditNotice("audit-pending", "⏳ 已送出申請，請等待管理員審核。");
    throw new Error("pending");
  }

  // 其餘狀態（pending / 拒絕 / 停用 …）
  const text = auditText || "待審核";

  if (text === "待審核") {
    showAuditNotice(
      "audit-pending",
      "⏳ 您的帳號正在審核中，審核通過前暫時無法使用此頁面。"
    );
  } else {
    showAuditNotice(
      "audit-rejected",
      `❗ 審核狀態：${text}，目前無法使用此頁面，請聯絡管理員。`
    );
  }

  setSubtitle(`審核狀態：${text}（尚未通過，暫時無法使用此頁面）`);
  throw new Error("pending");
}

async function initLiffAndGuard() {
  try {
    if (!LIFF_ID || LIFF_ID === "YOUR_LIFF_ID_HERE") {
      throw new Error("請先設定 LIFF_ID");
    }

    // 1) 初始化 LIFF
    await liff.init({ liffId: LIFF_ID });

    // 2) 未登入就導到 LINE Login
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href });
      return; // login 之後頁面會重載
    }

    // 3) 拿使用者資料
    const profile = await liff.getProfile();
    currentUser = {
      userId: profile.userId || "",
      displayName: profile.displayName || ""
    };

    // 4) 檢查審核
    await ensureApprovedUser();

    // 5) 只有通過審核才載入資料
    await Promise.all([loadData(), loadTechStatus()]);

    // 6) 顯示畫面 & 啟動狀態輪詢
    showApp();
    setInterval(() => {
      loadTechStatus().catch(err =>
        console.error("自動刷新師傅狀態失敗:", err)
      );
    }, 10000);
  } catch (err) {
    console.error("[Init] LIFF / auth 流程錯誤:", err);

    const msg = String(err && err.message) || "";

    // 審核中 / 無 user
    if (msg.includes("pending") || msg.includes("no_userId")) {
      document.getElementById("loadingOverlay").classList.add("hidden");
      document.getElementById("appContainer").style.display = "block";
      return;
    }

    // LIFF ID 未設定
    if (msg.includes("請先設定 LIFF_ID")) {
      setSubtitle("系統尚未設定 LIFF ID，請聯絡管理員。");
      showAuditNotice(
        "audit-rejected",
        "❗ LIFF 設定不完整，請通知系統管理員。"
      );
      document.getElementById("loadingOverlay").classList.add("hidden");
      document.getElementById("appContainer").style.display = "block";
      return;
    }

    alert("登入或載入資料時發生錯誤，請稍後重試。");
    showApp();
  }
}

/* ========= 初始化：預設月份 + 按鈕 ========= */
function initCalendarState() {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();
  setMonthLabel(currentYear, currentMonth);
}

document.addEventListener("DOMContentLoaded", () => {
  initCalendarState();

  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");

  if (prevBtn) {
    prevBtn.addEventListener("click", async () => {
      currentMonth--;
      if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
      }
      await loadData();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", async () => {
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
      await loadData();
    });
  }

  initLiffAndGuard();
});
