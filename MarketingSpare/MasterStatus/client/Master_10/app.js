// ===== 1) Booking / DateTypes Web App URL =====
const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwp46vU_Vk_s05D_LTbjAnDfUI4cyEUgQETikt6aIInecfZCAb_RI_vXZUm89GbNhEDgQ/exec";

// ===== 2) 師傅狀態 Web App URL =====
const TECH_API_URL =
  "https://script.google.com/macros/s/AKfycbwXwpKPzQFuIWtZOJpeGU9aPbl3RR5bj9yVWjV7mfyYaABaxMetKn_3j_mdMJGN9Ok5Ug/exec";

// ===== 3) 使用者審核 / Users Web App URL =====
const AUTH_API_URL =
  "https://script.google.com/macros/s/AKfycbyBg3w57x-Yw4C6v-SQ9rQazx6n9_VZRDjPKvXJy8WNkv29KPbrd8gHKIu1DFjwstUg/exec";

// ===== 4) LIFF ID（改成你的實際 LIFF ID） =====
const LIFF_ID = "2008669658-CwYIitI1";

// 想看的師傅 masterId
const TARGET_MASTER_ID = "10";

/* ========= 類型定義 ========= */
const TYPE_META = {
  holiday:   { label: "技師休假日",          tagClass: "tag-holiday" },
  weeklyOff: { label: "六日無法預約",        tagClass: "tag-weeklyOff" },
  eventDay:  { label: "雙倍點數日",          tagClass: "tag-eventDay" },
  halfDay:   { label: "半天營業日（如營業到 13:00）", tagClass: "tag-halfDay" },
  blockedDay:{ label: "不可預約日",          tagClass: "tag-blockedDay" }
};

const TYPE_PRIORITY = ["holiday", "blockedDay", "halfDay", "eventDay", "weeklyOff"];

let current = new Date();
const dayEvents = new Map();       // "yyyy-MM-dd" -> [type...]
const weeklyOffSet = new Set();    // 0~6（來自 Config + DateTypes）

/* ========= DOM 綁定 ========= */
document.getElementById("prevBtn").onclick = () => {
  current.setMonth(current.getMonth() - 1);
  renderCalendar();
};
document.getElementById("nextBtn").onclick = () => {
  current.setMonth(current.getMonth() + 1);
  renderCalendar();
};
document.getElementById("techMasterId").textContent = TARGET_MASTER_ID;

/* ========== 顯示 App / 關閉 loading ========== */
function showApp() {
  document.getElementById("loadingOverlay").classList.add("hidden");
  document.getElementById("appContainer").style.display = "block";
}

/* ========== 小工具：標題、副標題、審核提示卡 ========== */
function setSubtitle(msg) {
  const el = document.querySelector(".subtitle");
  if (!el) return;
  el.textContent = msg || "";
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

/* ========= 月曆資料：bootstrap ========= */
function normalizeType(val) {
  return String(val || "").trim();
}

function preprocessDateTypes(rows) {
  dayEvents.clear();
  rows.forEach(r => {
    const typeKey = normalizeType(r.Type || r.DateType);
    const dateRaw = String(r.Date || "").trim();
    if (!typeKey) return;

    if (typeKey === "weeklyOff") {
      const w = parseInt(dateRaw, 10);
      if (!isNaN(w) && w >= 0 && w <= 6) {
        weeklyOffSet.add(w);
      }
    } else {
      if (!dateRaw) return;
      const key = dateRaw; // yyyy-MM-dd
      const arr = dayEvents.get(key) || [];
      arr.push(typeKey);
      dayEvents.set(key, arr);
    }
  });
}

async function loadData() {
  const res = await fetch(WEB_APP_URL + "?entity=bootstrap");
  if (!res.ok) throw new Error("bootstrap HTTP " + res.status);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "bootstrap error");

  const data = json.data || {};
  const config = data.config || {};

  // 解析 Config.weeklyOff：["0","6"] 之類
  weeklyOffSet.clear();
  let weeklyOffRaw = config.weeklyOff;
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

  const dtRows = Array.isArray(data.datetypes) ? data.datetypes : [];
  preprocessDateTypes(dtRows);
  renderCalendar();
}

function renderCalendar() {
  const year = current.getFullYear();
  const month = current.getMonth();
  const monthLabel = document.getElementById("monthLabel");
  const body = document.getElementById("calendarBody");
  body.innerHTML = "";

  monthLabel.textContent = `${year} 年 ${month + 1} 月`;

  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let day = 1 - startWeekday;

  for (let r = 0; r < 6; r++) {
    const tr = document.createElement("tr");

    for (let c = 0; c < 7; c++) {
      const td = document.createElement("td");

      if (day > 0 && day <= daysInMonth) {
        const d = new Date(year, month, day);
        const weekday = d.getDay();
        const yyyy = year;
        const mm = String(month + 1).padStart(2, "0");
        const dd = String(day).padStart(2, "0");
        const key = `${yyyy}-${mm}-${dd}`;

        const dayTypeList = (dayEvents.get(key) || []).slice();
        if (weeklyOffSet.has(weekday)) {
          dayTypeList.push("weeklyOff");
        }

        const numSpan = document.createElement("div");
        numSpan.className = "day-num";
        numSpan.textContent = day;
        td.appendChild(numSpan);

        if (dayTypeList.length > 0) {
          td.classList.add("has-event");

          const mainType = pickMainType(dayTypeList);
          if (mainType) td.classList.add("type-" + mainType);

          const badgeRow = document.createElement("div");
          badgeRow.className = "badge-row";

          const uniqueTypes = Array.from(new Set(dayTypeList));
          uniqueTypes.forEach(t => {
            const meta = TYPE_META[t] || null;
            const tag = document.createElement("div");
            tag.className = "tag" + (meta ? (" " + meta.tagClass) : "");
            const dot = document.createElement("span");
            dot.className = "dot";
            const label = document.createElement("span");
            label.textContent = meta ? meta.label : t;
            tag.appendChild(dot);
            tag.appendChild(label);
            badgeRow.appendChild(tag);
          });

          td.appendChild(badgeRow);
          td.onclick = () => showPopup(key, uniqueTypes);
        } else {
          td.onclick = () => clearPopup();
        }
      } else {
        td.className = "empty";
      }

      tr.appendChild(td);
      day++;
    }

    body.appendChild(tr);
  }
}

function pickMainType(types) {
  const set = new Set(types);
  for (const t of TYPE_PRIORITY) {
    if (set.has(t)) return t;
  }
  return null;
}

function showPopup(dateStr, types) {
  const popup = document.getElementById("popup");
  popup.style.display = "block";

  const items = types.map(t => {
    const meta = TYPE_META[t];
    return `<li>${meta ? meta.label : t}</li>`;
  }).join("");

  popup.innerHTML = `
    <p class="popup-title">${dateStr}</p>
    <ul class="popup-list">
      ${items}
    </ul>
  `;
}

function clearPopup() {
  const popup = document.getElementById("popup");
  popup.style.display = "none";
  popup.innerHTML = "";
}

/* ========== 師傅狀態區 ========== */

function normalizeMasterId(v) {
  if (v === null || v === undefined) return "";
  let s = String(v).trim();
  if (!s) return "";
  s = s.replace(/[^\d]/g, "");
  if (!s) return "";
  const n = parseInt(s, 10);
  if (isNaN(n)) return "";
  return String(n);
}

function classifyStatus(statusText) {
  const s = String(statusText || "").trim();
  if (s.includes("工作中")) return "busy";
  if (s.includes("上班") || s.includes("可預約")) return "idle";
  if (s.includes("休") || s.includes("下班")) return "off";
  if (!s) return "off";
  return "idle";
}

// 剩餘時間：完全顯示表格回傳值，空就 "-"
function formatRemaining(rem) {
  if (rem === null || rem === undefined || rem === "") return "-";
  return String(rem);
}

function formatAppointment(appt) {
  const s = String(appt || "").trim();
  if (!s) return "無預約";
  return s; // 直接顯示 "15:00" 之類
}

function updateStatusUI(kind, row) {
  const statusEl = document.getElementById(kind + "StatusText");
  const apptEl   = document.getElementById(kind + "AppointmentText");
  const remEl    = document.getElementById(kind + "RemainingText");
  if (!statusEl || !apptEl || !remEl) return;

  statusEl.className = "tech-value";

  if (!row) {
    statusEl.innerHTML = `<span class="status-pill status-off">無資料</span>`;
    apptEl.textContent = "-";
    remEl.textContent   = "-";
    return;
  }

  const rawStatus = row.status || "";
  const bucket = classifyStatus(rawStatus);
  let pillClass = "status-off";
  if (bucket === "busy") pillClass = "status-busy";
  else if (bucket === "idle") pillClass = "status-idle";

  statusEl.innerHTML = `<span class="status-pill ${pillClass}">${rawStatus || "未知"}</span>`;
  apptEl.textContent = formatAppointment(row.appointment);
  remEl.textContent  = formatRemaining(row.remaining);
}

async function loadTechStatus() {
  const res = await fetch(TECH_API_URL);
  if (!res.ok) throw new Error("tech HTTP " + res.status);
  const json = await res.json();

  const bodyList = Array.isArray(json.body) ? json.body : [];
  const footList = Array.isArray(json.foot) ? json.foot : [];
  const targetKey = normalizeMasterId(TARGET_MASTER_ID);

  const pickByMaster = (arr) =>
    arr.find(r => normalizeMasterId(r.masterId) === targetKey) || null;

  const bodyRow = pickByMaster(bodyList);
  const footRow = pickByMaster(footList);

  updateStatusUI("body", bodyRow);
  updateStatusUI("foot", footRow);
}

/* ========== 審核相關：對接 Users GAS ========= */

function getCurrentUser() {
  return {
    userId: window.AUTH_USER_ID || "",
    displayName: window.AUTH_DISPLAY_NAME || ""
  };
}

async function callAuthApi(mode, payload) {
  if (!AUTH_API_URL) throw new Error("尚未設定 AUTH_API_URL");

  if (mode === "check") {
    const url = new URL(AUTH_API_URL);
    url.searchParams.set("mode", "check");
    url.searchParams.set("userId", payload.userId);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error("auth check HTTP " + res.status);
    return res.json();
  }

  if (mode === "register") {
    const res = await fetch(AUTH_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "register",
        userId: payload.userId,
        displayName: payload.displayName || ""
      })
    });
    if (!res.ok) throw new Error("auth register HTTP " + res.status);
    return res.json();
  }

  throw new Error("unsupported auth mode: " + mode);
}

/**
 * 確認使用者是否「已通過審核」
 * - approved  ：允許進入頁面
 * - none      ：自動幫他註冊，提示「已送出申請」
 * - pending   ：提示「審核中」
 */
async function ensureApprovedUser() {
  const { userId, displayName } = getCurrentUser();

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

  if (check.status === "approved") {
    const label = check.audit || "通過";
    setSubtitle(`您好，${displayName || "貴賓"}，審核狀態：${label}`);
    showAuditNotice(
      "audit-approved",
      "✔ 審核已通過，您可以使用全部功能。"
    );
    return; // ✅ 允許繼續
  }

  if (check.status === "none") {
    // 第一次進來 → 幫他註冊 + 提示審核中
    await callAuthApi("register", { userId, displayName });
    setSubtitle("已送出加入申請，審核中。審核通過前無法使用此頁面。");
    showAuditNotice(
      "audit-pending",
      "⏳ 已送出申請，請等待管理員審核。"
    );
    throw new Error("pending");
  }

  // 其餘狀態（pending / 拒絕 / 停用 …）
  const auditText = check.audit || "待審核";

  if (auditText === "待審核") {
    showAuditNotice(
      "audit-pending",
      "⏳ 您的帳號正在審核中，審核通過前暫時無法使用此頁面。"
    );
  } else {
    showAuditNotice(
      "audit-rejected",
      `❗ 審核狀態：${auditText}，目前無法使用此頁面，請聯絡管理員。`
    );
  }

  setSubtitle(`審核狀態：${auditText}（尚未通過，暫時無法使用此頁面）`);
  throw new Error("pending");
}

/* ========== LIFF 初始化 + 審核 + 資料載入 ========= */

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
    window.AUTH_USER_ID = profile.userId;
    window.AUTH_DISPLAY_NAME = profile.displayName || "";

    setSubtitle(`歡迎，${window.AUTH_DISPLAY_NAME}，正在檢查審核狀態…`);

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

/* ========== 入口：window load 時啟動 LIFF ========= */

window.addEventListener("load", () => {
  initLiffAndGuard();
});
