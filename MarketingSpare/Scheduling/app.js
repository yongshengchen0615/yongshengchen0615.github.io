// ★ 換成你的 GAS 網址
const API_URL =
  "https://script.google.com/macros/s/AKfycbwXwpKPzQFuIWtZOJpeGU9aPbl3RR5bj9yVWjV7mfyYaABaxMetKn_3j_mdMJGN9Ok5Ug/exec";

const rawData = {
  body: [],
  foot: [],
};

let activePanel = "body";
let filterMaster = "";
let filterStatus = "all";

const infoTextEl = document.getElementById("infoText");
const bodyCountEl = document.getElementById("bodyCount");
const footCountEl = document.getElementById("footCount");
const visibleCountEl = document.getElementById("visibleCount");

const tabBodyBtn = document.getElementById("tabBody");
const tabFootBtn = document.getElementById("tabFoot");

const filterMasterEl = document.getElementById("filterMaster");
const filterStatusEl = document.getElementById("filterStatus");
const tbody = document.getElementById("dataTableBody");

const themeToggleBtn = document.getElementById("themeToggle");
const panelTitleEl = document.getElementById("panelTitle");

function toStatusTag(status, remaining) {
  const hasRemaining =
    remaining !== "" && remaining !== null && remaining !== undefined;
  if (hasRemaining) {
    return `<span class="tag tag-status-work status-remaining">工作中 (${remaining})</span>`;
  }
  if (!status) return "";

  if (status.includes("排班")) {
    return `<span class="tag tag-status-schedule">${status}</span>`;
  }
  if (status.includes("未到")) {
    return `<span class="tag tag-status-notyet">${status}</span>`;
  }
  if (status.includes("下班")) {
    return `<span class="tag tag-status-off">${status}</span>`;
  }
  if (status.includes("工作")) {
    return `<span class="tag tag-status-work">${status}</span>`;
  }
  return status;
}

function fmtRemaining(v) {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  if (n === 0) return "0";
  if (n > 0) return `+${n}`;
  return String(n);
}

// 預約時間只顯示 24 小時制 HH:mm
function fmtAppointment(v) {
  if (v === null || v === undefined) return "";

  // Date 物件（保險）
  if (Object.prototype.toString.call(v) === "[object Date]") {
    const d = v;
    if (isNaN(d.getTime())) return "";
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

  // 純時間字串 "HH:mm" / "H:m" / "HH:mm:ss"
  const pure = s.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
  if (pure) {
    const hh = pure[1].padStart(2, "0");
    const mm = pure[2].padStart(2, "0");
    if (hh === "00" && mm === "00") return "";
    return `${hh}:${mm}`;
  }

  // 其他含時間的字串，抓第一組 h:m
  const any = s.match(/(\d{1,2}):(\d{1,2})/);
  if (any) {
    const hh = any[1].padStart(2, "0");
    const mm = any[2].padStart(2, "0");
    if (hh === "00" && mm === "00") return "";
    return `${hh}:${mm}`;
  }

  return "";
}

// 從 text-CXXXXXX 類的 class 抽出 hex 色碼 (#XXXXXX)
function extractHexColor(colorClassString) {
  if (!colorClassString) return null;
  const parts = String(colorClassString).split(/\s+/);
  const textClass = parts.find((p) => p.startsWith("text-C"));
  if (!textClass) return null;

  const token = textClass.replace("text-", ""); // 例如 C333333 / CBC5C5C / CCBCBCB
  const hex = token.slice(-6); // 取最後 6 碼
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) return null;
  return "#" + hex;
}

// 暗色主題下將顏色提亮
function lightenForDarkTheme(hexColor, factor = 1.8) {
  if (!/^#?[0-9A-Fa-f]{6}$/.test(hexColor)) return hexColor;

  let hex = hexColor.replace("#", "");
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  r = Math.min(255, Math.floor(r * factor));
  g = Math.min(255, Math.floor(g * factor));
  b = Math.min(255, Math.floor(b * factor));

  return `rgb(${r},${g},${b})`;
}

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
    const remainingDisplay = fmtRemaining(row.remaining);

    if (filterStatus === "work") {
      // 有剩餘時間 或 狀態包含 "工作"
      return remainingDisplay !== "" || status.includes("工作");
    }

    return status.includes(filterStatus);
  });
}

function updatePanelTitle(filteredLength) {
  if (!panelTitleEl) return;
  if (activePanel === "body") {
    panelTitleEl.textContent = `身體 Body 面板 · ${filteredLength} 位師傅`;
  } else {
    panelTitleEl.textContent = `腳底 Foot 面板 · ${filteredLength} 位師傅`;
  }
}

function render() {
  const list = rawData[activePanel] || [];

  bodyCountEl.textContent = rawData.body.length;
  footCountEl.textContent = rawData.foot.length;

  tbody.innerHTML = "";

  const filtered = applyFilters(
    list.slice().sort((a, b) => {
      const ia = Number(a.sort || a.index || 0);
      const ib = Number(b.sort || b.index || 0);
      return ia - ib;
    }),
  );

  visibleCountEl.textContent = `${filtered.length} 筆顯示中`;
  updatePanelTitle(filtered.length);

  const isDark = document.body.classList.contains("theme-dark");

  filtered.forEach((row) => {
    const tr = document.createElement("tr");

    const remainingDisplay = fmtRemaining(row.remaining);
    const statusHtml = toStatusTag(row.status, remainingDisplay);
    const appt = fmtAppointment(row.appointment);
    const apptDisplay = appt || "—";

    tr.innerHTML = `
      <td>${row.sort || row.index || ""}</td>
      <td>${row.masterId || ""}</td>
      <td>${statusHtml}</td>
      <td><span class="tag tag-appointment">${apptDisplay}</span></td>
    `;

    const tds = tr.querySelectorAll("td");

    // Index 顏色 → 順序欄
    const indexColor = extractHexColor(row.colorIndex);
    if (indexColor) {
      tds[0].style.color = isDark
        ? lightenForDarkTheme(indexColor)
        : indexColor;
    }

    // 師傅顏色 → 師傅欄
    const masterColor = extractHexColor(row.colorMaster);
    if (masterColor) {
      tds[1].style.color = isDark
        ? lightenForDarkTheme(masterColor)
        : masterColor;
    }

    // 狀態顏色 → 狀態欄（裡面的 tag）
    const statusColor = extractHexColor(row.colorStatus);
    if (statusColor) {
      const statusSpan = tds[2].querySelector(".tag") || tds[2];
      statusSpan.style.color = isDark
        ? lightenForDarkTheme(statusColor)
        : statusColor;
    }

    tbody.appendChild(tr);
  });
}

function setActivePanel(panel) {
  activePanel = panel;
  if (panel === "body") {
    tabBodyBtn.classList.add("active");
    tabFootBtn.classList.remove("active");
  } else {
    tabFootBtn.classList.add("active");
    tabBodyBtn.classList.remove("active");
  }
  render();
}

async function loadData() {
  infoTextEl.textContent = "從 GAS 載入資料中…";

  try {
    const resp = await fetch(API_URL, { method: "GET" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();

    rawData.body = Array.isArray(data.body) ? data.body : [];
    rawData.foot = Array.isArray(data.foot) ? data.foot : [];

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    infoTextEl.textContent = `已更新：${hh}:${mm}:${ss}`;

    render();
  } catch (err) {
    console.error("[Dashboard] 讀取 GAS 失敗：", err);
    infoTextEl.textContent = "⚠ 無法讀取 GAS（請檢查網址 / 權限）";
  }
}

// 主題切換
function applyTheme(theme) {
  document.body.classList.remove("theme-light", "theme-dark");
  document.body.classList.add(theme);
  localStorage.setItem("panelTheme", theme);

  if (theme === "theme-light") {
    themeToggleBtn.textContent = "🌙 暗色模式";
  } else {
    themeToggleBtn.textContent = "☀️ 亮色模式";
  }

  // 主題變更後重繪一次（讓顏色亮度跟著調整）
  render();
}

// 初始化主題
(function initTheme() {
  const saved = localStorage.getItem("panelTheme") || "theme-dark";
  applyTheme(saved);
})();

// 事件綁定
tabBodyBtn.addEventListener("click", () => setActivePanel("body"));
tabFootBtn.addEventListener("click", () => setActivePanel("foot"));

filterMasterEl.addEventListener("input", (e) => {
  filterMaster = e.target.value || "";
  render();
});

filterStatusEl.addEventListener("change", (e) => {
  filterStatus = e.target.value || "all";
  render();
});

themeToggleBtn.addEventListener("click", () => {
  const next = document.body.classList.contains("theme-dark")
    ? "theme-light"
    : "theme-dark";
  applyTheme(next);
});

// 啟動
loadData();
// 自動刷新（目前 20 秒，可依需求調整）
setInterval(loadData, 20000);
