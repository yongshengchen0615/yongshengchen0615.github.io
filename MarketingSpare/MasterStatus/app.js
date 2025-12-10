// ===== 1) Booking / DateTypes Web App URL =====
const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwp46vU_Vk_s05D_LTbjAnDfUI4cyEUgQETikt6aIInecfZCAb_RI_vXZUm89GbNhEDgQ/exec";

// ===== 2) 身體 / 腳底 狀態 Web App URL =====
const TECH_API_URL =
  "https://script.google.com/macros/s/AKfycbwXwpKPzQFuIWtZOJpeGU9aPbl3RR5bj9yVWjV7mfyYaABaxMetKn_3j_mdMJGN9Ok5Ug/exec";

// 想看的師傅 masterId
const TARGET_MASTER_ID = "10";

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

/* ========== 月曆資料：bootstrap ========== */
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

// ========== 初始化：兩個 API 都載完才顯示畫面，之後每 10 秒自動刷新師傅狀態 ==========

window.addEventListener("load", () => {
  Promise.all([loadData(), loadTechStatus()])
    .then(() => {
      showApp();
      // 每 10 秒自動刷新師傅狀態（你目前設定的是 10000ms）
      setInterval(() => {
        loadTechStatus().catch(err => console.error("自動刷新師傅狀態失敗:", err));
      }, 10000);
    })
    .catch(err => {
      console.error("初始化錯誤:", err);
      alert("載入資料時發生錯誤，請稍後重試");
      showApp(); // 就算錯誤也把畫面打開
    });
});
