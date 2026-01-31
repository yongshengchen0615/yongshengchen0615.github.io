// =========================================================
// app.js (Dashboard - Edge Cache Reader + LIFF/No-LIFF Gate + Rules-driven Status)
// ✅ 修訂整合版（含你要的新增功能）
//   1) 排班表開通=否：不顯示 身體/腳底面板（tabs/filters/table/refresh），只顯示「我的狀態」
//   2) 排班表開通=否 且 非師傅：顯示提示卡「你不是師傅，因此無法顯示我的狀態」
//   3) Gate 規則：通過審核 + 未過期 → 可進入；排班表未開通不再擋（只影響 UI 顯示）
//   4) 既有：狀態顏色 token（bgStatus / colorStatus）、順序 bgIndex=bg-CCBCBCB 才上底色、表頭色吃 token
// =========================================================

// ==== 過濾 PanelScan 錯誤訊息（只動前端，不改腳本貓）====
(function () {
  const rawLog = console.log;
  console.log = function (...args) {
    try {
      const first = args[0];
      const msg = typeof first === "string" ? first : "";
      if (msg.includes("[PanelScan]") && msg.includes("找不到 身體 / 腳底 panel")) return;
    } catch (e) {}
    rawLog.apply(console, args);
  };
})();

/* =========================================================
 * Config.json
 * ========================================================= */
const CONFIG_JSON_URL = "./config.json";

let EDGE_STATUS_URLS = [];
let FALLBACK_ORIGIN_CACHE_URL = "";
let AUTH_API_URL = "";
let LIFF_ID = "";
let ENABLE_LINE_LOGIN = true;
let POLL_ALLOW_BACKGROUND_ = false;

async function loadConfigJson_() {
  const resp = await fetch(CONFIG_JSON_URL, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("CONFIG_HTTP_" + resp.status);

  const cfg = await resp.json();

  const edges = Array.isArray(cfg.EDGE_STATUS_URLS) ? cfg.EDGE_STATUS_URLS : [];
  EDGE_STATUS_URLS = edges.map((u) => String(u || "").trim()).filter(Boolean);

  FALLBACK_ORIGIN_CACHE_URL = String(cfg.FALLBACK_ORIGIN_CACHE_URL || "").trim();
  AUTH_API_URL = String(cfg.AUTH_API_URL || "").trim();
  LIFF_ID = String(cfg.LIFF_ID || "").trim();
  ENABLE_LINE_LOGIN = Boolean(cfg.ENABLE_LINE_LOGIN);

  // optional: allow background polling (best-effort)
  if (typeof cfg.POLL_ALLOW_BACKGROUND === "boolean") POLL_ALLOW_BACKGROUND_ = cfg.POLL_ALLOW_BACKGROUND;
  else if (typeof cfg.POLL_ALLOW_BACKGROUND === "string") POLL_ALLOW_BACKGROUND_ = cfg.POLL_ALLOW_BACKGROUND.trim() === "是";
  else if (typeof cfg.POLL_ALLOW_BACKGROUND === "number") POLL_ALLOW_BACKGROUND_ = cfg.POLL_ALLOW_BACKGROUND === 1;

  if (ENABLE_LINE_LOGIN && !LIFF_ID) throw new Error("CONFIG_LIFF_ID_MISSING");
  if (!AUTH_API_URL) throw new Error("CONFIG_AUTH_API_URL_MISSING");
  if (!FALLBACK_ORIGIN_CACHE_URL) throw new Error("CONFIG_FALLBACK_ORIGIN_CACHE_URL_MISSING");
  if (!EDGE_STATUS_URLS.length) throw new Error("CONFIG_EDGE_STATUS_URLS_EMPTY");
}

/* =========================
 * URL utils
 * ========================= */
function withQuery_(base, extraQuery) {
  const b = String(base || "").trim();
  const q = String(extraQuery || "").trim();
  if (!b) return "";
  if (!q) return b;
  return b + (b.includes("?") ? "&" : "?") + q.replace(/^\?/, "");
}
function getQueryParam_(k) {
  try {
    const u = new URL(location.href);
    return u.searchParams.get(k) || "";
  } catch {
    return "";
  }
}

/* =========================================================
 * Edge Failover + Timeout + Sticky Reroute
 * ========================================================= */
const STATUS_FETCH_TIMEOUT_MS = 8000;
const EDGE_TRY_MAX = 3;
const EDGE_FAIL_THRESHOLD = 2;
const EDGE_REROUTE_TTL_MS = 30 * 60 * 1000;

const EDGE_ROUTE_KEY = "edge_route_override_v1"; // { idx, exp }
const EDGE_FAIL_KEY = "edge_route_failcount_v1"; // { idx, n, t }

function readJsonLS_(k) {
  try {
    return JSON.parse(localStorage.getItem(k) || "null");
  } catch {
    return null;
  }
}
function writeJsonLS_(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}
function getOverrideEdgeIndex_() {
  const o = readJsonLS_(EDGE_ROUTE_KEY);
  if (!o || typeof o.idx !== "number") return null;
  if (typeof o.exp === "number" && Date.now() > o.exp) {
    localStorage.removeItem(EDGE_ROUTE_KEY);
    return null;
  }
  return o.idx;
}
function setOverrideEdgeIndex_(idx) {
  writeJsonLS_(EDGE_ROUTE_KEY, { idx, exp: Date.now() + EDGE_REROUTE_TTL_MS });
}
function bumpFailCount_(idx) {
  const s = readJsonLS_(EDGE_FAIL_KEY) || {};
  const sameIdx = s && s.idx === idx;
  const n = sameIdx ? Number(s.n || 0) + 1 : 1;
  writeJsonLS_(EDGE_FAIL_KEY, { idx, n, t: Date.now() });
  return n;
}
function resetFailCount_() {
  localStorage.removeItem(EDGE_FAIL_KEY);
}
function sanitizeEdgeUrls_() {
  const seen = new Set();
  EDGE_STATUS_URLS = (EDGE_STATUS_URLS || [])
    .map((u) => String(u || "").trim())
    .filter((u) => u && u.startsWith("https://script.google.com/macros/s/") && u.includes("/exec"))
    .filter((u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    });

  if (!EDGE_STATUS_URLS.length) console.warn("[EdgeURL] EDGE_STATUS_URLS empty; fallback only");
}
function getRandomEdgeIndex_() {
  const n = EDGE_STATUS_URLS.length || 0;
  if (!n) return 0;

  const overrideIdx = getOverrideEdgeIndex_();
  if (typeof overrideIdx === "number" && overrideIdx >= 0 && overrideIdx < n) return overrideIdx;

  return Math.floor(Math.random() * n);
}
function buildEdgeTryOrder_(startIdx) {
  const n = EDGE_STATUS_URLS.length;
  const order = [];
  for (let i = 0; i < n; i++) order.push((startIdx + i) % n);
  return order.slice(0, Math.min(EDGE_TRY_MAX, n));
}
async function fetchJsonWithTimeout_(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || STATUS_FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { method: "GET", cache: "no-store", signal: ctrl.signal });
    const text = await resp.text();

    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${text.slice(0, 160)}`);

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`NON_JSON ${text.slice(0, 160)}`);
    }

    if (json && json.ok === false) throw new Error(`NOT_OK ${json.err || json.error || "response not ok"}`);
    return json;
  } finally {
    clearTimeout(t);
  }
}

/* =========================================================
 * fetchStatusAll
 * ========================================================= */
async function fetchStatusAll() {
  const jitterBust = Date.now();

  const startIdx = getRandomEdgeIndex_();
  const tryEdgeIdxList = buildEdgeTryOrder_(startIdx);

  for (const idx of tryEdgeIdxList) {
    const edgeBase = EDGE_STATUS_URLS[idx];
    if (!edgeBase) continue;

    const url = withQuery_(edgeBase, "mode=sheet_all&v=" + encodeURIComponent(jitterBust));

    try {
      const data = await fetchJsonWithTimeout_(url, STATUS_FETCH_TIMEOUT_MS);

      const body = Array.isArray(data.body) ? data.body : [];
      const foot = Array.isArray(data.foot) ? data.foot : [];

      if (body.length === 0 && foot.length === 0) throw new Error("EDGE_SHEET_EMPTY");

      resetFailCount_();
      return { source: "edge", edgeIdx: idx, bodyRows: body, footRows: foot };
    } catch (e) {
      if (idx === startIdx) {
        const n = bumpFailCount_(idx);
        if (EDGE_STATUS_URLS.length > 1 && n >= EDGE_FAIL_THRESHOLD) {
          const nextIdx = (idx + 1) % EDGE_STATUS_URLS.length;
          setOverrideEdgeIndex_(nextIdx);
        }
      }
    }
  }

  const originUrl = withQuery_(FALLBACK_ORIGIN_CACHE_URL, "mode=sheet_all&v=" + encodeURIComponent(jitterBust));
  const data = await fetchJsonWithTimeout_(originUrl, STATUS_FETCH_TIMEOUT_MS + 4000);

  resetFailCount_();
  return {
    source: "origin",
    edgeIdx: null,
    bodyRows: Array.isArray(data.body) ? data.body : [],
    footRows: Array.isArray(data.foot) ? data.foot : [],
  };
}

/* =========================================================
 * DOM
 * ========================================================= */
const gateEl = document.getElementById("gate");
const appRootEl = document.getElementById("appRoot");

const topLoadingEl = document.getElementById("topLoading");
const topLoadingTextEl = topLoadingEl ? topLoadingEl.querySelector(".top-loading-text") : null;

const rawData = { body: [], foot: [] };
let activePanel = "body";
let filterMaster = "";
let filterStatus = "all";

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
const errorStateEl = document.getElementById("errorState");
const themeToggleBtn = document.getElementById("themeToggle");

const usageBannerEl = document.getElementById("usageBanner");
const usageBannerTextEl = usageBannerEl
  ? usageBannerEl.querySelector("#usageBannerText")
  : document.getElementById("usageBannerText");

const personalToolsEl = document.getElementById("personalTools");
const btnUserManageEl = document.getElementById("btnUserManage");
const btnPersonalStatusEl = document.getElementById("btnPersonalStatus");
// const btnVacationEl = document.getElementById("btnVacation"); // removed: 「複製技師休假與狀態連結」功能已取消

/* ✅ 個人師傅狀態 DOM */
const myMasterStatusEl = document.getElementById("myMasterStatus");
const myMasterStatusTextEl = document.getElementById("myMasterStatusText");

/* =========================================================
 * ✅ 排班表未開通：隱藏面板 UI，只留「我的狀態」
 * ========================================================= */
const toolbarEl = document.querySelector(".toolbar");
const mainEl = document.querySelector("main.main");
const cardTableEl = document.querySelector(".card.card-table");
const refreshBtnEl = document.getElementById("refreshBtn");
const tabBodyBtnEl = document.getElementById("tabBody");
const tabFootBtnEl = document.getElementById("tabFoot");
const filterMasterWrapEl = filterMasterInput ? filterMasterInput.closest(".filter") : null;
const filterStatusWrapEl = filterStatusSelect ? filterStatusSelect.closest(".filter") : null;

// 控制旗標（由 AUTH 回傳 scheduleEnabled 決定）
let scheduleUiEnabled_ = true;

/* =========================================================
 * ✅ schedule=否 且非師傅：提示卡（不改 HTML，動態插入）
 * ========================================================= */
let notMasterHintEl = null;

function ensureNotMasterHint_() {
  if (notMasterHintEl && document.body.contains(notMasterHintEl)) return notMasterHintEl;

  notMasterHintEl = document.createElement("div");
  notMasterHintEl.id = "notMasterHint";
  notMasterHintEl.style.display = "none";
  notMasterHintEl.style.margin = "0 0 14px 0";
  notMasterHintEl.style.padding = "10px 14px";
  notMasterHintEl.style.borderRadius = "16px";
  notMasterHintEl.style.border = "1px solid rgba(148, 163, 184, 0.55)";
  notMasterHintEl.style.background = "rgba(15, 23, 42, 0.65)";
  notMasterHintEl.style.color = "var(--text-main)";
  notMasterHintEl.style.fontSize = "13px";
  notMasterHintEl.style.lineHeight = "1.6";
  notMasterHintEl.style.position = "relative";
  notMasterHintEl.style.overflow = "hidden";
  notMasterHintEl.innerHTML = `
    <div style="font-size:12px;color:var(--text-sub);font-weight:700;letter-spacing:.02em;margin-bottom:4px;">
      提示
    </div>
    <div>你不是師傅，因此無法顯示「我的狀態」。</div>
  `;

  const stripe = document.createElement("div");
  stripe.style.position = "absolute";
  stripe.style.left = "0";
  stripe.style.top = "0";
  stripe.style.bottom = "0";
  stripe.style.width = "6px";
  stripe.style.background = "rgba(148, 163, 184, 0.7)";
  notMasterHintEl.appendChild(stripe);

  const layout = document.querySelector(".layout");
  if (myMasterStatusEl && myMasterStatusEl.parentNode) {
    myMasterStatusEl.parentNode.insertBefore(notMasterHintEl, myMasterStatusEl);
  } else if (layout) {
    layout.insertBefore(notMasterHintEl, layout.firstChild);
  } else {
    document.body.insertBefore(notMasterHintEl, document.body.firstChild);
  }

  return notMasterHintEl;
}

function showNotMasterHint_(show) {
  const el = ensureNotMasterHint_();
  el.style.display = show ? "block" : "none";
}

function applyScheduleUiMode_(enabled) {
  scheduleUiEnabled_ = !!enabled;

  // ✅ 面板功能整段隱藏
  if (toolbarEl) toolbarEl.style.display = scheduleUiEnabled_ ? "" : "none";
  if (mainEl) mainEl.style.display = scheduleUiEnabled_ ? "" : "none";
  if (cardTableEl) cardTableEl.style.display = scheduleUiEnabled_ ? "" : "none";

  // ✅ 面板操作也隱藏（避免誤觸）
  if (refreshBtnEl) refreshBtnEl.style.display = scheduleUiEnabled_ ? "" : "none";
  if (tabBodyBtnEl) tabBodyBtnEl.style.display = scheduleUiEnabled_ ? "" : "none";
  if (tabFootBtnEl) tabFootBtnEl.style.display = scheduleUiEnabled_ ? "" : "none";
  if (filterMasterWrapEl) filterMasterWrapEl.style.display = scheduleUiEnabled_ ? "" : "none";
  if (filterStatusWrapEl) filterStatusWrapEl.style.display = scheduleUiEnabled_ ? "" : "none";

  // ✅ 只顯示我的狀態（非師傅仍會被 updateMyMasterStatusUI_ 控制）
  if (myMasterStatusEl) myMasterStatusEl.style.display = "flex";

  // ✅ 狀態提示文字（可選）
  if (connectionStatusEl) {
    connectionStatusEl.textContent = scheduleUiEnabled_ ? "連線中…" : "排班表未開通（僅顯示我的狀態）";
  }

  // ✅ 清掉表格內容/狀態區（避免閃一下）
  if (!scheduleUiEnabled_) {
    if (tbodyRowsEl) tbodyRowsEl.innerHTML = "";
    if (emptyStateEl) emptyStateEl.style.display = "none";
    if (errorStateEl) errorStateEl.style.display = "none";
  }

  // ✅ schedule=否：師傅顯示我的狀態；非師傅顯示提示卡
  if (!scheduleUiEnabled_) {
    const isMaster = !!(myMasterState_ && myMasterState_.isMaster && myMasterState_.techNo);
    showNotMasterHint_(!isMaster);
  } else {
    showNotMasterHint_(false);
  }
}

/* =========================================================
 * ✅ 使用者（師傅）技師休假與狀態 - state
 * ========================================================= */
const myMasterState_ = {
  isMaster: false,
  techNo: "", // 例如 "07"
};

function pickAny_(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}
function parseIsMaster_(data) {
  const v = pickAny_(data, ["isMaster", "是否師傅", "isTech", "isTechnician", "tech", "master"]);
  if (v === true) return true;
  const s = String(v ?? "").trim();
  if (s === "是") return true;
  if (s === "true" || s === "1" || s.toLowerCase() === "yes" || s.toLowerCase() === "y") return true;
  return false;
}
function normalizeTechNo_(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/\d+/);
  if (!m) return "";
  const n = parseInt(m[0], 10);
  if (Number.isNaN(n)) return "";
  return String(n).padStart(2, "0");
}
/** ✅ 支援 GAS 回傳 masterCode */
function parseTechNo_(data) {
  const v = pickAny_(data, ["techNo", "師傅編號", "masterCode", "masterId", "masterNo", "tech", "師傅", "技師編號"]);
  return normalizeTechNo_(v);
}
function findRowByTechNo_(rows, techNo) {
  const t = normalizeTechNo_(techNo);
  if (!t) return null;
  const list = Array.isArray(rows) ? rows : [];
  for (const r of list) {
    const mid = normalizeTechNo_(r && r.masterId);
    if (mid && mid === t) return r;
  }
  return null;
}

/* =========================================================
 * Text normalize + status mapping
 * ========================================================= */
function normalizeText_(s) {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}
function fmtRemainingRaw(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}
function deriveStatusClass(status, remaining) {
  const s = normalizeText_(status || "");
  const n = Number(remaining);

  if (s.includes("排班")) return "status-shift";
  if (s.includes("工作")) return "status-busy";
  if (s.includes("預約")) return "status-booked";
  if (s.includes("空閒") || s.includes("待命") || s.includes("準備") || s.includes("備牌")) return "status-free";
  if (!Number.isNaN(n) && n < 0) return "status-busy";
  return "status-other";
}
function mapRowsToDisplay(rows) {
  return rows.map((row) => {
    const remaining = row.remaining === 0 || row.remaining ? row.remaining : "";
    return {
      sort: row.sort,
      index: row.index,
      _gasSeq: row._gasSeq,

      masterId: normalizeText_(row.masterId),
      status: normalizeText_(row.status),
      appointment: normalizeText_(row.appointment),

      colorIndex: row.colorIndex || "",
      colorMaster: row.colorMaster || "",
      colorStatus: row.colorStatus || "",

      colorAppointment: row.colorAppointment || row.colorAppt || row.colorBooking || "",
      colorRemaining: row.colorRemaining || row.colorRemain || row.colorTime || "",

      bgIndex: row.bgIndex || "",
      bgMaster: row.bgMaster || "",
      bgStatus: row.bgStatus || "",

      remainingDisplay: fmtRemainingRaw(remaining),
      statusClass: deriveStatusClass(row.status, remaining),
    };
  });
}

/* =========================================================
 * ✅ Shift rank helpers（排班順位：即使不是排班也顯示「若排班」）
 * ========================================================= */
function isShiftStatus_(statusText) {
  const s = normalizeText_(statusText || "");
  return s.includes("排班");
}
function sortRowsForDisplay_(rows) {
  const list = Array.isArray(rows) ? rows.slice() : [];

  const isAll = filterStatus === "all";
  const isShift = String(filterStatus || "").includes("排班");
  const useDisplayOrder = isAll || isShift;

  if (useDisplayOrder) {
    return list.sort((a, b) => {
      const na = Number(a.sort ?? a.index);
      const nb = Number(b.sort ?? b.index);
      const aKey = Number.isNaN(na) ? Number(a._gasSeq ?? 0) : na;
      const bKey = Number.isNaN(nb) ? Number(b._gasSeq ?? 0) : nb;
      if (aKey !== bKey) return aKey - bKey;
      return Number(a._gasSeq ?? 0) - Number(b._gasSeq ?? 0);
    });
  }

  return list.sort((a, b) => {
    const na = Number(a.sort);
    const nb = Number(b.sort);
    const aKey = Number.isNaN(na) ? Number(a._gasSeq ?? 0) : na;
    const bKey = Number.isNaN(nb) ? Number(b._gasSeq ?? 0) : nb;
    if (aKey !== bKey) return aKey - bKey;
    return Number(a._gasSeq ?? 0) - Number(b._gasSeq ?? 0);
  });
}
function getShiftRank_(panelRows, techNo) {
  const t = normalizeTechNo_(techNo);
  if (!t) return null;

  const sortedAll = sortRowsForDisplay_(panelRows || []);
  if (!sortedAll.length) return null;

  let myPos = -1;
  let myRow = null;
  for (let i = 0; i < sortedAll.length; i++) {
    const r = sortedAll[i];
    const mid = normalizeTechNo_(r && r.masterId);
    if (mid && mid === t) {
      myPos = i;
      myRow = r;
      break;
    }
  }
  if (myPos < 0) return null;

  const shiftPositions = [];
  for (let i = 0; i < sortedAll.length; i++) {
    const r = sortedAll[i];
    if (isShiftStatus_(r && r.status)) shiftPositions.push(i);
  }

  const shiftCount = shiftPositions.length;
  const meIsShiftNow = myRow && isShiftStatus_(myRow.status);

  const beforeMe = shiftPositions.filter((p) => p < myPos).length;
  const rank = beforeMe + 1;

  const total = shiftCount + (meIsShiftNow ? 0 : 1);

  return { rank, total, meIsShiftNow };
}

/* =========================================================
 * ✅ 我的狀態：badge 規則 + 版面渲染
 * ========================================================= */
function parseRemainingNumber_(row) {
  if (!row) return null;
  const v = row.remaining === 0 || row.remaining ? row.remaining : null;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n;
}
function classifyMyStatusClass_(statusText, remainingNum) {
  const s = normalizeText_(statusText || "");
  const n = typeof remainingNum === "number" ? remainingNum : Number.NaN;

  if (s.includes("排班")) return "status-shift";
  if (s.includes("工作")) return "status-busy";
  if (s.includes("預約")) return "status-booked";
  if (s.includes("空閒") || s.includes("待命") || s.includes("準備") || s.includes("備牌")) return "status-free";
  if (!Number.isNaN(n) && n < 0) return "status-busy";
  return "status-other";
}
function remBadgeClass_(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "";
  if (n < 0) return "is-expired";
  if (n <= 3) return "is-warn";
  return "";
}
function escapeHtml_(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function pickDominantRow_(bodyRow, footRow) {
  const candidates = [bodyRow, footRow].filter(Boolean);
  if (!candidates.length) return null;

  const score = (r) => {
    const s = normalizeText_(r.status || "");
    const n = parseRemainingNumber_(r);
    if (s.includes("排班")) return 5;
    if (s.includes("工作") || (!Number.isNaN(n) && n < 0)) return 4;
    if (s.includes("預約")) return 3;
    if (s.includes("空閒") || s.includes("待命") || s.includes("準備") || s.includes("備牌")) return 2;
    return 1;
  };

  let best = candidates[0];
  for (const c of candidates) if (score(c) > score(best)) best = c;
  return best;
}

/* =========================================================
 * ✅ GAS 顏色 token → 實際可用顏色
 * ========================================================= */
function clamp_(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function isLightTheme_() {
  return (document.documentElement.getAttribute("data-theme") || "dark") === "light";
}
function hexToRgb_(hex) {
  if (!hex) return null;
  let s = String(hex).replace("#", "").trim();
  if (s.length === 3) s = s.split("").map((ch) => ch + ch).join("");
  if (s.length !== 6) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return { r, g, b };
}
function normalizeHex6_(maybe) {
  if (!maybe) return null;
  let s = String(maybe).trim();

  const mBracket = s.match(/\[#([0-9a-fA-F]{6})\]/);
  if (mBracket) return "#" + mBracket[1];

  const mHash = s.match(/#([0-9a-fA-F]{6})/);
  if (mHash) return "#" + mHash[1];

  const mC = s.match(/(?:^|(?:text|bg)-)C?([0-9a-fA-F]{6})$/);
  if (mC) return "#" + mC[1];

  const mIn = s.match(/(?:text|bg)-C([0-9a-fA-F]{6})/);
  if (mIn) return "#" + mIn[1];

  return null;
}
function parseOpacityToken_(token) {
  if (!token) return null;
  const t = String(token).trim();

  let m = t.match(/(?:text-opacity-|bg-opacity-|opacity-)(\d{1,3})/);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isNaN(n)) return clamp_(n / 100, 0, 1);
  }

  m = t.match(/\/(\d{1,3})$/);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isNaN(n)) return clamp_(n / 100, 0, 1);
  }

  m = t.match(/^(0?\.\d+|1(?:\.0+)?)$/);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isNaN(n)) return clamp_(n, 0, 1);
  }

  return null;
}
function parseColorToken_(str) {
  if (!str) return { hex: null, opacity: null };
  const tokens = String(str).split(/\s+/).filter(Boolean);

  let hex = null;
  let opacity = null;

  for (const tk of tokens) {
    if (!hex) {
      const h = normalizeHex6_(tk);
      if (h) hex = h;
    }
    if (opacity == null) {
      const o = parseOpacityToken_(tk);
      if (o != null) opacity = o;
    }
  }

  if (!hex) {
    const h = normalizeHex6_(String(str));
    if (h) hex = h;
  }

  return { hex, opacity };
}
function applyPillFromTokens_(pillEl, bgToken, textToken) {
  if (!pillEl) return;

  pillEl.style.background = "";
  pillEl.style.border = "";
  pillEl.style.color = "";

  const bg = parseColorToken_(bgToken);
  if (bg.hex) {
    const rgb = hexToRgb_(bg.hex);
    if (rgb) {
      let aBg = bg.opacity;
      if (aBg == null) aBg = isLightTheme_() ? 0.10 : 0.16;
      aBg = clamp_(aBg, 0.03, 0.35);

      pillEl.style.background = `rgba(${rgb.r},${rgb.g},${rgb.b},${aBg})`;
      const aBd = clamp_(aBg + (isLightTheme_() ? 0.12 : 0.18), 0.12, 0.55);
      pillEl.style.border = `1px solid rgba(${rgb.r},${rgb.g},${rgb.b},${aBd})`;
    }
  }

  const fg = parseColorToken_(textToken);
  if (fg.hex) {
    const rgb = hexToRgb_(fg.hex);
    if (rgb) {
      const minAlpha = isLightTheme_() ? 0.85 : 0.70;
      let aText = fg.opacity == null ? 1 : fg.opacity;
      aText = clamp_(aText, minAlpha, 1);
      pillEl.style.color = aText < 1 ? `rgba(${rgb.r},${rgb.g},${rgb.b},${aText})` : fg.hex;
    }
  }

  if (!bg.hex && fg.hex) {
    const rgb = hexToRgb_(fg.hex);
    if (rgb) {
      const aBg = isLightTheme_() ? 0.08 : 0.14;
      pillEl.style.background = `rgba(${rgb.r},${rgb.g},${rgb.b},${aBg})`;
      const aBd = isLightTheme_() ? 0.22 : 0.32;
      pillEl.style.border = `1px solid rgba(${rgb.r},${rgb.g},${rgb.b},${aBd})`;
    }
  }
}
function tokenToStripe_(bgToken, textToken) {
  const bg = parseColorToken_(bgToken);
  if (bg.hex) {
    const rgb = hexToRgb_(bg.hex);
    if (rgb) return `rgba(${rgb.r},${rgb.g},${rgb.b},0.90)`;
  }
  const fg = parseColorToken_(textToken);
  if (fg.hex) {
    const rgb = hexToRgb_(fg.hex);
    if (rgb) return `rgba(${rgb.r},${rgb.g},${rgb.b},0.90)`;
  }
  return "";
}

/* =========================================================
 * ✅ 一般文字顏色：吃 GAS token
 * ========================================================= */
function applyTextColorFromToken_(el, token) {
  if (!el) return;
  el.style.color = "";

  const fg = parseColorToken_(token);
  if (!fg.hex) return;

  const rgb = hexToRgb_(fg.hex);
  if (!rgb) return;

  const minAlpha = isLightTheme_() ? 0.90 : 0.78;
  let aText = fg.opacity == null ? 1 : fg.opacity;
  aText = clamp_(aText, minAlpha, 1);

  el.style.color = aText < 1 ? `rgba(${rgb.r},${rgb.g},${rgb.b},${aText})` : fg.hex;
}

/* =========================================================
 * ✅ 強化版文字色（只給「順序」用）
 * ========================================================= */
function applyTextColorFromTokenStrong_(el, token) {
  if (!el) return;
  el.style.color = "";

  const fg = parseColorToken_(token);
  if (!fg.hex) return;

  const rgb = hexToRgb_(fg.hex);
  if (!rgb) return;

  const minAlpha = isLightTheme_() ? 0.97 : 0.94;
  let aText = fg.opacity == null ? 1 : fg.opacity;
  aText = clamp_(aText, minAlpha, 1);

  el.style.color = aText < 1 ? `rgba(${rgb.r},${rgb.g},${rgb.b},${aText})` : fg.hex;
  el.style.fontWeight = "900";
  el.style.textShadow = isLightTheme_()
    ? "0 1px 0 rgba(0,0,0,0.10)"
    : "0 1px 0 rgba(0,0,0,0.55), 0 0 10px rgba(255,255,255,0.10)";
}

/* =========================================================
 * ✅ 我的狀態 row：把 token 帶進 DOM
 * ========================================================= */
function makeMyPanelRowHTML_(label, row, shiftRankObj) {
  const statusText = row ? String(row.status || "").trim() || "—" : "—";
  const remNum = parseRemainingNumber_(row);
  const remText = remNum === null ? "—" : String(remNum);

  const stCls = "status-pill " + classifyMyStatusClass_(statusText, remNum);
  const remCls = "myms-rem " + remBadgeClass_(remNum);

  let rankText = "—";
  let rankCls = "myms-rank";
  if (shiftRankObj && typeof shiftRankObj.rank === "number") {
    rankText = `入牌順位：${shiftRankObj.rank}  排班人數：${shiftRankObj.total}`;
    if (shiftRankObj.rank <= 3) rankCls += " is-top3";
  }

  const bgStatus = row && row.bgStatus ? String(row.bgStatus) : "";
  const colorStatus = row && row.colorStatus ? String(row.colorStatus) : "";

  return `
    <div class="myms-row">
      <div class="myms-label">${escapeHtml_(label)}</div>
      <div class="myms-right">
        <span class="${stCls}"
              data-bgstatus="${escapeHtml_(bgStatus)}"
              data-colorstatus="${escapeHtml_(colorStatus)}">
          ${escapeHtml_(statusText)}
        </span>
        <span class="${remCls}">剩餘：${escapeHtml_(String(remText))}</span>
        <span class="${rankCls}">${escapeHtml_(rankText)}</span>
      </div>
    </div>
  `;
}

/* =========================================================
 * ✅ 我的狀態：套 token 顏色 + 左側色條 token
 * ========================================================= */
function updateMyMasterStatusUI_() {
  if (!myMasterStatusEl) return;

  // ✅ 非師傅：schedule=否 顯示提示卡；否則隱藏提示
  if (!myMasterState_.isMaster || !myMasterState_.techNo) {
    if (!scheduleUiEnabled_) showNotMasterHint_(true);
    else showNotMasterHint_(false);

    myMasterStatusEl.style.display = "none";
    return;
  }

  // ✅ 師傅：不顯示提示卡
  showNotMasterHint_(false);

  const bodyRow = findRowByTechNo_(rawData.body, myMasterState_.techNo);
  const footRow = findRowByTechNo_(rawData.foot, myMasterState_.techNo);

  const bodyShiftRank = getShiftRank_(rawData.body, myMasterState_.techNo);
  const footShiftRank = getShiftRank_(rawData.foot, myMasterState_.techNo);

  myMasterStatusEl.classList.remove("status-shift", "status-busy", "status-booked", "status-free", "status-other");
  myMasterStatusEl.classList.add("status-other");

  const host = myMasterStatusTextEl || myMasterStatusEl;

  host.innerHTML = `
    <div class="myms">
      <div class="myms-head">
        <div class="myms-tech">
          <span class="myms-tech-badge">師傅</span>
          <span> ${escapeHtml_(myMasterState_.techNo)} </span>
        </div>
      </div>

      ${makeMyPanelRowHTML_("身體", bodyRow, bodyShiftRank)}
      ${makeMyPanelRowHTML_("腳底", footRow, footShiftRank)}
    </div>
  `;

  const pills = host.querySelectorAll(".status-pill[data-bgstatus], .status-pill[data-colorstatus]");
  pills.forEach((pill) => {
    const bg = pill.getAttribute("data-bgstatus") || "";
    const fg = pill.getAttribute("data-colorstatus") || "";
    applyPillFromTokens_(pill, bg, fg);
  });

  const dominant = pickDominantRow_(bodyRow, footRow);
  if (dominant) {
    const stripe = tokenToStripe_(dominant.bgStatus, dominant.colorStatus);
    if (stripe) myMasterStatusEl.style.setProperty("--myStripe", stripe);
    else myMasterStatusEl.style.removeProperty("--myStripe");
  } else {
    myMasterStatusEl.style.removeProperty("--myStripe");
  }

  myMasterStatusEl.style.display = "flex";
}

/* =========================================================
 * Feature banner
 * ========================================================= */
let featureState = { pushEnabled: "否", personalStatusEnabled: "否", scheduleEnabled: "否", performanceEnabled: "否" };
function normalizeYesNo_(v) {
  return String(v || "").trim() === "是" ? "是" : "否";
}
function buildChip_(label, enabled) {
  const on = enabled === "是";
  const cls = on ? "feature-chip" : "feature-chip feature-chip-disabled";
  const badge = on ? "" : `<span class="feature-chip-badge">未開通</span>`;
  return `<span class="${cls}">${label}${badge}</span>`;
}
function renderFeatureBanner_() {
  const chipsEl = document.getElementById("featureChips");
  if (!chipsEl) return;

  const push = normalizeYesNo_(featureState.pushEnabled);
  const personal = normalizeYesNo_(featureState.personalStatusEnabled);
  const schedule = normalizeYesNo_(featureState.scheduleEnabled);
  const performance = normalizeYesNo_(featureState.performanceEnabled);

  chipsEl.innerHTML = [
    buildChip_("叫班提醒", push),
    buildChip_("排班表", schedule),
    buildChip_("技師休假與狀態", personal),
    buildChip_("業績", performance),
  ].join("");
}
function updateFeatureState_(data) {
  featureState.pushEnabled = normalizeYesNo_(data && data.pushEnabled);
  featureState.personalStatusEnabled = normalizeYesNo_(data && data.personalStatusEnabled);
  featureState.scheduleEnabled = normalizeYesNo_(data && data.scheduleEnabled);
  featureState.performanceEnabled = normalizeYesNo_(data && data.performanceEnabled);
  renderFeatureBanner_();
}

/* =========================================================
 * UI helpers
 * ========================================================= */
function showLoadingHint(text) {
  if (!topLoadingEl) return;
  if (topLoadingTextEl) topLoadingTextEl.textContent = text || "資料載入中…";
  topLoadingEl.classList.remove("hidden");
}
function hideLoadingHint() {
  if (!topLoadingEl) return;
  topLoadingEl.classList.add("hidden");
}
function showGate(message, isError) {
  if (!gateEl) return;
  gateEl.classList.remove("gate-hidden");
  gateEl.style.pointerEvents = "auto";
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
  gateEl.style.pointerEvents = "none";
}
function openApp() {
  hideGate();
  if (appRootEl) appRootEl.classList.remove("app-hidden");
}
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
 * Personal Tools
 * ========================================================= */
async function fetchPersonalStatusRow_(userId) {
  const url = withQuery_(AUTH_API_URL, "mode=getPersonalStatus&userId=" + encodeURIComponent(userId));
  const resp = await fetch(url, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("getPersonalStatus HTTP " + resp.status);
  return await resp.json();
}
function pickField_(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}
function showPersonalToolsFinal_(psRow) {
  if (!personalToolsEl || !btnUserManageEl || !btnPersonalStatusEl) return;

  personalToolsEl.style.display = "flex";
  btnUserManageEl.style.display = "inline-flex";
  btnPersonalStatusEl.style.display = "inline-flex";

  const adminLiff = pickField_(psRow, ["adminLiff", "manageLiff", "技師管理員liff"]);
  const personalBoardLiff = pickField_(psRow, ["personalBoardLiff", "personalLiff", "個人看板liff"]);

  btnUserManageEl.onclick = () => {
    if (!adminLiff) {
      alert("尚未設定『技師管理員』連結，請管理員至後台填入技師管理員liff。 ");
      return;
    }
    window.location.href = adminLiff;
  };
  btnPersonalStatusEl.onclick = () => {
    if (!personalBoardLiff) {
      alert("尚未設定『技師休假與狀態』連結，請管理員至後台填入個人看板liff。 ");
      return;
    }
    window.location.href = personalBoardLiff;
  };

  window.__personalLinks = { adminLiff, personalBoardLiff, psRow };
}
function hidePersonalTools_() {
  if (personalToolsEl) personalToolsEl.style.display = "none";
}

/* =========================================================
 * Filters
 * ========================================================= */
function rebuildStatusFilterOptions() {
  if (!filterStatusSelect) return;

  const statuses = new Set();
  ["body", "foot"].forEach((type) => {
    (rawData[type] || []).forEach((r) => {
      const s = normalizeText_(r.status);
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
      if (normalizeText_(row.status) !== normalizeText_(filterStatus)) return false;
    }

    return true;
  });
}

/* =========================================================
 * Panel diff
 * ========================================================= */
function rowSignature_(r) {
  if (!r) return "";
  return [
    r.masterId ?? "",
    r.index ?? "",
    r.sort ?? "",
    r.status ?? "",
    r.appointment ?? "",
    r.remaining ?? "",
    r.colorIndex ?? "",
    r.colorMaster ?? "",
    r.colorStatus ?? "",
    r.bgIndex ?? "",
    r.bgMaster ?? "",
    r.bgStatus ?? "",
    r.bgAppointment ?? "",
  ].join("|");
}
function buildStatusSet_(rows) {
  const s = new Set();
  (rows || []).forEach((r) => {
    const t = normalizeText_(r && r.status);
    if (t) s.add(t);
  });
  return s;
}
function setEquals_(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
function diffMergePanelRows_(prevRows, incomingRows) {
  const prev = Array.isArray(prevRows) ? prevRows : [];
  const nextIn = Array.isArray(incomingRows) ? incomingRows : [];

  const prevMap = new Map();
  prev.forEach((r) => {
    const id = String((r && r.masterId) || "").trim();
    if (id) prevMap.set(id, r);
  });

  let changed = false;
  const nextRows = [];

  for (const nr of nextIn) {
    const id = String((nr && nr.masterId) || "").trim();
    if (!id) continue;

    const old = prevMap.get(id);
    if (!old) {
      nextRows.push({ ...nr });
      changed = true;
      continue;
    }

    const oldSig = rowSignature_(old);
    const newSig = rowSignature_(nr);

    if (oldSig !== newSig) {
      Object.assign(old, nr);
      changed = true;
    }

    nextRows.push(old);
    prevMap.delete(id);
  }

  if (prevMap.size > 0) changed = true;

  const prevStatus = buildStatusSet_(prev);
  const nextStatus = buildStatusSet_(nextRows);
  const statusChanged = !setEquals_(prevStatus, nextStatus);

  return { changed, statusChanged, nextRows };
}

/* =========================================================
 * ✅ 表頭顏色：吃 GAS token
 * ========================================================= */
function applyTableHeaderColorsFromRows_(displayRows) {
  try {
    const table = tbodyRowsEl ? tbodyRowsEl.closest("table") : null;
    if (!table) return;

    const ths = table.querySelectorAll("thead th");
    if (!ths || ths.length < 5) return;

    const first = Array.isArray(displayRows) && displayRows.length ? displayRows[0] : null;

    if (!first) {
      ths.forEach((th) => {
        th.style.color = "";
        th.removeAttribute("data-colortoken");
      });
      return;
    }

    const tokens = [
      first.colorIndex || "",
      first.colorMaster || "",
      first.colorStatus || "",
      first.colorAppointment || "",
      first.colorRemaining || "",
    ];

    for (let i = 0; i < 5; i++) {
      const th = ths[i];
      const tk = tokens[i] || "";
      th.setAttribute("data-colortoken", tk);
      applyTextColorFromToken_(th, tk);
    }
  } catch (e) {}
}
function reapplyTableHeaderColorsFromDataset_() {
  try {
    const table = tbodyRowsEl ? tbodyRowsEl.closest("table") : null;
    if (!table) return;
    const ths = table.querySelectorAll("thead th[data-colortoken]");
    ths.forEach((th) => {
      const tk = th.getAttribute("data-colortoken") || "";
      applyTextColorFromToken_(th, tk);
    });
  } catch (e) {}
}

/* =========================================================
 * Incremental render
 * ========================================================= */
const rowDomMapByPanel_ = { body: new Map(), foot: new Map() };

function buildRowKey_(row) {
  return String((row && row.masterId) || "").trim();
}
function ensureRowDom_(panel, row) {
  const key = buildRowKey_(row);
  if (!key) return null;

  const map = rowDomMapByPanel_[panel];
  let tr = map.get(key);
  if (tr) return tr;

  tr = document.createElement("tr");

  const tdOrder = document.createElement("td");
  tdOrder.className = "cell-order";

  const tdMaster = document.createElement("td");
  tdMaster.className = "cell-master";

  const tdStatus = document.createElement("td");
  const tdAppointment = document.createElement("td");
  tdAppointment.className = "cell-appointment";

  const tdRemaining = document.createElement("td");

  tr.appendChild(tdOrder);
  tr.appendChild(tdMaster);
  tr.appendChild(tdStatus);
  tr.appendChild(tdAppointment);
  tr.appendChild(tdRemaining);

  map.set(key, tr);
  return tr;
}

/* =========================================================
 * ✅ 順序欄位：只允許 bgIndex=bg-CCBCBCB 才上底色
 * ========================================================= */
const ORDER_HL_BG_TOKEN = "bg-CCBCBCB";
function isOrderIndexHighlight_(bgIndexToken) {
  return String(bgIndexToken || "").trim() === ORDER_HL_BG_TOKEN;
}
function applyOrderIndexHighlight_(tdOrder, bgToken) {
  if (!tdOrder) return;

  const h = normalizeHex6_(bgToken);
  const rgb = hexToRgb_(h);
  if (!rgb) return;

  const aBg = isLightTheme_() ? 0.36 : 0.42;
  tdOrder.style.backgroundColor = `rgba(${rgb.r},${rgb.g},${rgb.b},${aBg})`;

  const aStripe = 0.92;
  tdOrder.style.borderLeft = `6px solid rgba(${rgb.r},${rgb.g},${rgb.b},${aStripe})`;

  const aBd = isLightTheme_() ? 0.60 : 0.62;
  tdOrder.style.outline = `1px solid rgba(${rgb.r},${rgb.g},${rgb.b},${aBd})`;
  tdOrder.style.outlineOffset = "-2px";

  tdOrder.style.boxShadow = isLightTheme_()
    ? "inset 0 0 0 999px rgba(255,255,255,0.14), 0 1px 10px rgba(0,0,0,0.08)"
    : "inset 0 0 0 999px rgba(0,0,0,0.10), 0 0 0 1px rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.35)";

  tdOrder.style.fontWeight = "900";
}

function patchRowDom_(tr, row, orderText) {
  const tds = tr.children;
  const tdOrder = tds[0];
  const tdMaster = tds[1];
  const tdStatus = tds[2];
  const tdAppointment = tds[3];
  const tdRemaining = tds[4];

  tdOrder.textContent = orderText;

  tdOrder.style.backgroundColor = "";
  tdOrder.style.borderLeft = "";
  tdOrder.style.outline = "";
  tdOrder.style.outlineOffset = "";
  tdOrder.style.boxShadow = "";
  tdOrder.style.fontWeight = "";
  tdOrder.style.textShadow = "";
  tdOrder.style.color = "";

  applyTextColorFromTokenStrong_(tdOrder, row.colorIndex);

  if (isOrderIndexHighlight_(row.bgIndex)) {
    applyOrderIndexHighlight_(tdOrder, row.bgIndex);
  }

  tdMaster.textContent = row.masterId || "";
  tdMaster.style.color = "";
  applyTextColorFromToken_(tdMaster, row.colorMaster);

  tdStatus.innerHTML = "";
  const statusSpan = document.createElement("span");
  statusSpan.className = "status-pill " + (row.statusClass || "");
  statusSpan.textContent = row.status || "";
  applyPillFromTokens_(statusSpan, row.bgStatus, row.colorStatus);
  tdStatus.appendChild(statusSpan);

  tdAppointment.textContent = row.appointment || "";
  tdAppointment.style.color = "";
  applyTextColorFromToken_(tdAppointment, row.colorAppointment);

  tdRemaining.innerHTML = "";
  const timeSpan = document.createElement("span");
  timeSpan.className = "time-badge";
  timeSpan.textContent = row.remainingDisplay || "";
  applyTextColorFromToken_(timeSpan, row.colorRemaining);
  tdRemaining.appendChild(timeSpan);
}

function renderIncremental_(panel) {
  if (!tbodyRowsEl) return;

  // ✅ 排班表未開通：不渲染面板（避免任何閃動/誤觸）
  if (!scheduleUiEnabled_) return;

  const list = panel === "body" ? rawData.body : rawData.foot;
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

  if (emptyStateEl) emptyStateEl.style.display = displayRows.length ? "none" : "block";
  if (panelTitleEl) panelTitleEl.textContent = panel === "body" ? "身體面板" : "腳底面板";

  applyTableHeaderColorsFromRows_(displayRows);

  const frag = document.createDocumentFragment();

  displayRows.forEach((row, idx) => {
    const showGasSortInOrderCol = !useDisplayOrder;
    const sortNum = Number(row.sort);
    const orderText = showGasSortInOrderCol && !Number.isNaN(sortNum) ? String(sortNum) : String(idx + 1);

    const tr = ensureRowDom_(panel, row);
    if (!tr) return;

    patchRowDom_(tr, row, orderText);
    frag.appendChild(tr);
  });

  tbodyRowsEl.replaceChildren(frag);
}

/* =========================================================
 * refresh: no overlap + empty snapshot guard
 * ========================================================= */
let refreshInFlight = false;

const EMPTY_ACCEPT_AFTER_N = 2;
const emptyStreak_ = { body: 0, foot: 0 };

function decideIncomingRows_(panel, incomingRows, prevRows, isManual) {
  const inc = Array.isArray(incomingRows) ? incomingRows : [];
  const prev = Array.isArray(prevRows) ? prevRows : [];

  if (isManual) {
    emptyStreak_[panel] = 0;
    return { rows: inc, accepted: true };
  }
  if (inc.length > 0) {
    emptyStreak_[panel] = 0;
    return { rows: inc, accepted: true };
  }
  if (prev.length === 0) {
    emptyStreak_[panel] = 0;
    return { rows: inc, accepted: true };
  }

  emptyStreak_[panel] = (emptyStreak_[panel] || 0) + 1;
  if (emptyStreak_[panel] >= EMPTY_ACCEPT_AFTER_N) {
    emptyStreak_[panel] = 0;
    return { rows: inc, accepted: true };
  }

  return { rows: prev, accepted: false };
}

async function refreshStatus(isManual = false) {
  if (document.hidden && !POLL_ALLOW_BACKGROUND_) return;
  if (refreshInFlight) return;

  refreshInFlight = true;

  if (isManual) showLoadingHint("同步資料中…");
  if (errorStateEl) errorStateEl.style.display = "none";

  try {
    const { source, edgeIdx, bodyRows, footRows } = await fetchStatusAll();

    const bodyDecision = decideIncomingRows_("body", bodyRows, rawData.body, isManual);
    const footDecision = decideIncomingRows_("foot", footRows, rawData.foot, isManual);

    const bodyDiff = diffMergePanelRows_(rawData.body, bodyDecision.rows);
    const footDiff = diffMergePanelRows_(rawData.foot, footDecision.rows);

    if (bodyDiff.changed) rawData.body = bodyDiff.nextRows.map((r, i) => ({ ...r, _gasSeq: i }));
    if (footDiff.changed) rawData.foot = footDiff.nextRows.map((r, i) => ({ ...r, _gasSeq: i }));

    if (bodyDiff.statusChanged || footDiff.statusChanged) rebuildStatusFilterOptions();

    const anyChanged = bodyDiff.changed || footDiff.changed;
    const activeChanged = activePanel === "body" ? bodyDiff.changed : footDiff.changed;

    if (connectionStatusEl) {
      if (!scheduleUiEnabled_) {
        connectionStatusEl.textContent = "排班表未開通（僅顯示我的狀態）";
      } else if (source === "edge" && typeof edgeIdx === "number") {
        connectionStatusEl.textContent = `已連線（分流 ${edgeIdx + 1}）`;
      } else {
        connectionStatusEl.textContent = "已連線（主站）";
      }
    }

    if (anyChanged && lastUpdateEl) {
      const now = new Date();
      lastUpdateEl.textContent =
        "更新：" + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    }

    if (scheduleUiEnabled_) {
      if (activeChanged) renderIncremental_(activePanel);
      else reapplyTableHeaderColorsFromDataset_();
    }

    // ✅ 永遠更新我的狀態（schedule=否 也要）
    updateMyMasterStatusUI_();
  } catch (err) {
    console.error("[Status] 取得狀態失敗：", err);
    if (connectionStatusEl) connectionStatusEl.textContent = "異常";
    if (errorStateEl && scheduleUiEnabled_) errorStateEl.style.display = "block";
  } finally {
    if (isManual) hideLoadingHint();
    refreshInFlight = false;
  }
}

/* =========================================================
 * AUTH + RULES (rules 驅動)
 * ========================================================= */
function normalizeBoolOn_(v) {
  if (v === true) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "on" || s === "true" || s === "1" || s === "是" || s === "y" || s === "yes";
}
function normalizeCheckResult_(data, displayNameFromClient) {
  const status = (data && data.status) || "none";
  const audit = (data && data.audit) || "";
  const serverDisplayName = (data && data.displayName) || "";
  const displayName = (serverDisplayName || displayNameFromClient || "").trim();

  const scheduleEnabled = (data && data.scheduleEnabled) || "否";
  const pushEnabled = (data && data.pushEnabled) || "否";
  const personalStatusEnabled = (data && data.personalStatusEnabled) || "否";

  let remainingDays = null;
  if (data && data.remainingDays !== undefined && data.remainingDays !== null) {
    const n = Number(data.remainingDays);
    if (!Number.isNaN(n)) remainingDays = n;
  }

  const flags = {
    maintenance: normalizeBoolOn_(data && (data.maintenance ?? data.systemMaintenance)),
    blocked: normalizeBoolOn_(data && (data.blocked ?? data.banned ?? data.disabled)),
    forceUpdate: normalizeBoolOn_(data && (data.forceUpdate ?? data.mustUpdate)),
  };

  const messages = {
    maintenanceMsg: (data && (data.maintenanceMsg || data.systemMaintenanceMsg)) || "",
    blockedMsg: (data && (data.blockedMsg || data.bannedMsg || data.disabledMsg)) || "",
    forceUpdateMsg: (data && (data.forceUpdateMsg || data.mustUpdateMsg)) || "",
  };

  const isMaster = parseIsMaster_(data || {});
  const techNo = parseTechNo_(data || {});

  return {
    status,
    audit,
    displayName,
    serverDisplayName,
    scheduleEnabled,
    pushEnabled,
    personalStatusEnabled,
    remainingDays,
    flags,
    messages,
    raw: data || {},
    justRegistered: false,
    isMaster,
    techNo,
  };
}

/**
 * ✅ Gate 規則（已修改）
 * - 只要 approved + 未過期 → allow
 * - scheduleEnabled=否 不再擋（只影響 UI 顯示）
 */
function decideGateAction_(r) {
  const hasRd = typeof r.remainingDays === "number" && !Number.isNaN(r.remainingDays);
  const notExpired = hasRd ? r.remainingDays >= 0 : false;
  const auditRaw_ = String(r.audit || "");
  const auditNorm_ = auditRaw_.replace(/[\s\u200B-\u200D\uFEFF]/g, "");
  const isAuditMaintenance_ = auditNorm_.includes("系統維護") || auditNorm_.includes("系统维护");

  const rules = [
    {
      id: "MAINTENANCE",
      when: () => r.flags.maintenance === true || isAuditMaintenance_,
      action: () => ({
        allow: false,
        message: isAuditMaintenance_
          ? "目前系統維護中\n不開放使用"
          : "🛠️ 系統維護中\n" + (String(r.messages.maintenanceMsg || "").trim() || "請稍後再試。"),
      }),
    },
    {
      id: "BLOCKED",
      when: () => r.flags.blocked === true,
      action: () => ({
        allow: false,
        message: "⛔ 帳號已停用/封鎖\n" + (String(r.messages.blockedMsg || "").trim() || "如需協助請聯絡管理員。"),
      }),
    },
    {
      id: "FORCE_UPDATE",
      when: () => r.flags.forceUpdate === true,
      action: () => ({
        allow: false,
        message: "⬆️ 需要更新\n" + (String(r.messages.forceUpdateMsg || "").trim() || "請更新至最新版本後再使用。"),
      }),
    },

    // ✅ 通過審核 + 未過期 → allow
    {
      id: "APPROVED_OK",
      when: () => r.status === "approved" && notExpired,
      action: () => ({ allow: true }),
    },

    // ✅ approved 但過期/未設定期限 → 擋
    {
      id: "APPROVED_BUT_LOCKED",
      when: () => r.status === "approved",
      action: () => {
        let msg = "此帳號已通過審核，但目前無法使用看板。\n\n";
        msg += "原因：使用期限已到期或未設定期限。\n";
        msg += "\n請聯絡管理員協助開通或延長使用期限。";
        return { allow: false, message: msg };
      },
    },

    {
      id: "PENDING",
      when: () => r.status === "pending",
      action: () => {
        if (isAuditMaintenance_) {
          return { allow: false, message: "目前系統維護中\n不開放使用" };
        }

        const auditText = r.audit || "待審核";
        let msg = "此帳號目前尚未通過審核。\n";
        msg += "目前審核狀態：「" + auditText + "」。\n\n";
        if (r.justRegistered) msg += "✅ 已自動送出審核申請。\n\n";
        msg +=
          auditText === "拒絕" || auditText === "停用"
            ? "如需重新申請或有疑問，請聯絡管理員。"
            : "若你已經等待一段時間，請聯絡管理員確認審核進度。";
        return { allow: false, message: msg };
      },
    },
  ];

  for (const rule of rules) {
    if (rule.when()) return { ruleId: rule.id, ...rule.action() };
  }

  return { ruleId: "UNKNOWN", allow: false, message: "⚠ 無法確認使用權限，請稍後再試。", isError: true };
}

async function checkOrRegisterUser(userId, displayNameFromClient) {
  const url = AUTH_API_URL + "?mode=check&userId=" + encodeURIComponent(userId);
  const resp = await fetch(url, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("Check HTTP " + resp.status);

  const data = await resp.json();
  let r = normalizeCheckResult_(data, displayNameFromClient);

  // ✅ 如果後端以 audit 告知「系統維護」，不要走自動註冊/審核 UI。
  {
    const auditNorm = String(r.audit || "").replace(/[\s\u200B-\u200D\uFEFF]/g, "");
    if (auditNorm.includes("系統維護") || auditNorm.includes("系统维护")) return r;
  }

  if (r.status === "approved" || r.status === "pending") return r;

  try {
    await registerUser(userId, r.displayName || displayNameFromClient || "");
    r.status = "pending";
    r.audit = r.audit || "待審核";
    r.justRegistered = true;
    return r;
  } catch (e) {
    console.error("[Register] 寫入 AUTH GAS 失敗：", e);
    r.status = "error";
    r.justRegistered = false;
    return r;
  }
}
async function registerUser(userId, displayName) {
  const url =
    AUTH_API_URL +
    "?mode=register" +
    "&userId=" +
    encodeURIComponent(userId) +
    "&displayName=" +
    encodeURIComponent(displayName || "");

  const resp = await fetch(url, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("Register HTTP " + resp.status);
  return await resp.json();
}

/* =========================================================
 * Theme
 * ========================================================= */
function setTheme(theme) {
  const root = document.documentElement;
  const finalTheme = theme === "light" ? "light" : "dark";
  root.setAttribute("data-theme", finalTheme);
  localStorage.setItem("dashboardTheme", finalTheme);
  if (themeToggleBtn) themeToggleBtn.textContent = finalTheme === "dark" ? "🌙 深色" : "☀️ 淺色";

  reapplyTableHeaderColorsFromDataset_();
  updateMyMasterStatusUI_();
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

/* =========================================================
 * ✅ No-LIFF Guard
 * ========================================================= */
async function initNoLiffAndGuard() {
  showGate("✅ 未啟用 LINE 登入\n正在確認使用權限…");

  try {
    const userId =
      String(getQueryParam_("userId") || "").trim() ||
      String(localStorage.getItem("devUserId") || "").trim() ||
      "dev_user";

    const displayName =
      String(getQueryParam_("name") || "").trim() ||
      String(localStorage.getItem("devDisplayName") || "").trim() ||
      "使用者";

    window.currentUserId = userId;
    window.currentDisplayName = displayName;

    const result = await checkOrRegisterUser(userId, displayName);

    updateFeatureState_(result);

    myMasterState_.isMaster = !!result.isMaster;
    myMasterState_.techNo = normalizeTechNo_(result.techNo || result.masterCode || "");

    // ✅ 排班表開通=否：只顯示我的狀態
    const scheduleOk = String(result.scheduleEnabled || "").trim() === "是";
    applyScheduleUiMode_(scheduleOk);

    // ✅ 業績開通=否：不顯示業績按鈕/區塊（若此版本沒有相關 DOM，則不影響）
    const performanceOk = String(result.performanceEnabled || "").trim() === "是";
    const perfBtn = document.getElementById("btnPerformance");
    if (perfBtn) perfBtn.style.display = performanceOk ? "" : "none";
    const perfCard = document.getElementById("perfCard");
    if (perfCard) perfCard.style.display = performanceOk ? "" : "none";

    // ✅ 立即同步提示（避免首次畫面沒出現）
    if (!scheduleOk) {
      const isMasterNow = !!(myMasterState_.isMaster && myMasterState_.techNo);
      showNotMasterHint_(!isMasterNow);
    } else {
      showNotMasterHint_(false);
    }

    const gate = decideGateAction_(result);
    if (!gate.allow) {
      hidePersonalTools_();
      if (myMasterStatusEl) myMasterStatusEl.style.display = "none";
      showNotMasterHint_(false);
      showGate(gate.message, gate.isError);
      return;
    }

    showGate("驗證通過，正在載入資料…");
    openApp();
    updateUsageBanner(result.displayName || displayName, result.remainingDays);

    updateMyMasterStatusUI_();

    const personalOk = String(result.personalStatusEnabled || "").trim() === "是";
    if (personalOk) {
      try {
        const ps = await fetchPersonalStatusRow_(userId);
        const psRow = (ps && (ps.data || ps.row || ps.payload) ? ps.data || ps.row || ps.payload : ps) || {};
        showPersonalToolsFinal_(psRow);
      } catch (e) {
        showPersonalToolsFinal_({});
        console.error("[PersonalTools] getPersonalStatus failed:", e);
      }
    } else {
      hidePersonalTools_();
    }

    startApp();
  } catch (err) {
    console.error("[NoLIFF] 驗證失敗：", err);
    hidePersonalTools_();
    if (myMasterStatusEl) myMasterStatusEl.style.display = "none";
    showNotMasterHint_(false);
    showGate("⚠ 權限驗證失敗，請稍後再試。", true);
  }
}

/* =========================================================
 * LIFF
 * ========================================================= */
async function initLiffAndGuard() {
  showGate("正在啟動 LIFF…");

  try {
    if (!window.liff) throw new Error("LIFF_SDK_MISSING");
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

    updateFeatureState_(result);

    myMasterState_.isMaster = !!result.isMaster;
    myMasterState_.techNo = normalizeTechNo_(result.techNo || result.masterCode || "");

    // ✅ 排班表開通=否：只顯示我的狀態
    const scheduleOk = String(result.scheduleEnabled || "").trim() === "是";
    applyScheduleUiMode_(scheduleOk);

    // ✅ 立即同步提示（避免首次畫面沒出現）
    if (!scheduleOk) {
      const isMasterNow = !!(myMasterState_.isMaster && myMasterState_.techNo);
      showNotMasterHint_(!isMasterNow);
    } else {
      showNotMasterHint_(false);
    }

    const gate = decideGateAction_(result);
    if (!gate.allow) {
      hidePersonalTools_();
      if (myMasterStatusEl) myMasterStatusEl.style.display = "none";
      showNotMasterHint_(false);
      showGate(gate.message, gate.isError);
      return;
    }

    showGate("驗證通過，正在載入資料…");
    openApp();
    updateUsageBanner(displayName || result.displayName || "", result.remainingDays);

    updateMyMasterStatusUI_();

    const personalOk = String(result.personalStatusEnabled || "").trim() === "是";
    if (personalOk) {
      try {
        const ps = await fetchPersonalStatusRow_(userId);
        const psRow = (ps && (ps.data || ps.row || ps.payload) ? ps.data || ps.row || ps.payload : ps) || {};
        showPersonalToolsFinal_(psRow);
      } catch (e) {
        showPersonalToolsFinal_({});
        console.error("[PersonalTools] getPersonalStatus failed:", e);
      }
    } else {
      hidePersonalTools_();
    }

    startApp();
  } catch (err) {
    console.error("[LIFF] 初始化或驗證失敗：", err);
    hidePersonalTools_();
    if (myMasterStatusEl) myMasterStatusEl.style.display = "none";
    showNotMasterHint_(false);
    showGate("⚠ LIFF 初始化或權限驗證失敗，請稍後再試。", true);
  }
}

/* =========================================================
 * Events
 * ========================================================= */
if (tabBodyBtn) tabBodyBtn.addEventListener("click", () => setActivePanel("body"));
if (tabFootBtn) tabFootBtn.addEventListener("click", () => setActivePanel("foot"));

if (filterMasterInput) {
  filterMasterInput.addEventListener("change", (e) => {
    filterMaster = e.target.value || "";
    renderIncremental_(activePanel);
    updateMyMasterStatusUI_();
  });
}
if (filterStatusSelect) {
  filterStatusSelect.addEventListener("change", (e) => {
    filterStatus = e.target.value || "all";
    renderIncremental_(activePanel);
    updateMyMasterStatusUI_();
  });
}

function setActivePanel(panel) {
  // ✅ 排班表未開通：不允許切換面板（因為面板 UI 已隱藏）
  if (!scheduleUiEnabled_) return;

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

  renderIncremental_(activePanel);
  updateMyMasterStatusUI_();
}

/* =========================================================
 * ✅ Adaptive Polling（降低 GAS 壓力）
 * ========================================================= */
let pollTimer = null;

const POLL = {
  BASE_MS: 3000,
  MAX_MS: 20000,
  FAIL_MAX_MS: 60000,
  STABLE_UP_AFTER: 3,
  CHANGED_BOOST_MS: 4500,
  JITTER_RATIO: 0.2,
};

const pollState_ = {
  successStreak: 0,
  failStreak: 0,
  nextMs: POLL.BASE_MS,
};

function withJitter_(ms, ratio) {
  const r = typeof ratio === "number" ? ratio : 0.15;
  const delta = ms * r;
  const j = (Math.random() * 2 - 1) * delta;
  return Math.max(800, Math.floor(ms + j));
}
function clearPoll_() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}
function scheduleNextPoll_(ms) {
  clearPoll_();
  const wait = withJitter_(ms, POLL.JITTER_RATIO);

  pollTimer = setTimeout(async () => {
    if (document.hidden && !POLL_ALLOW_BACKGROUND_) return;

    const res = await refreshStatusAdaptive_(false);
    const next = computeNextInterval_(res);
    scheduleNextPoll_(next);
  }, wait);
}
function computeNextInterval_(res) {
  const ok = !!(res && res.ok);
  const changed = !!(res && res.changed);

  if (!ok) {
    pollState_.failStreak += 1;
    pollState_.successStreak = 0;

    const backoff = Math.min(POLL.FAIL_MAX_MS, POLL.BASE_MS * Math.pow(2, pollState_.failStreak));
    pollState_.nextMs = Math.max(POLL.BASE_MS, backoff);
    return pollState_.nextMs;
  }

  pollState_.successStreak += 1;
  pollState_.failStreak = 0;

  if (changed) {
    pollState_.nextMs = Math.max(POLL.BASE_MS, Math.min(POLL.MAX_MS, POLL.CHANGED_BOOST_MS));
    return pollState_.nextMs;
  }

  if (pollState_.successStreak < POLL.STABLE_UP_AFTER) {
    pollState_.nextMs = Math.max(POLL.BASE_MS, pollState_.nextMs);
    return pollState_.nextMs;
  }

  const s = pollState_.successStreak;
  let target;
  if (s < 6) target = 5000;
  else if (s < 10) target = 8000;
  else if (s < 16) target = 12000;
  else target = POLL.MAX_MS;

  pollState_.nextMs = Math.min(POLL.MAX_MS, Math.max(POLL.BASE_MS, target));
  return pollState_.nextMs;
}
async function refreshStatusAdaptive_(isManual) {
  try {
    const beforeBody = rawData.body;
    const beforeFoot = rawData.foot;

    await refreshStatus(isManual);

    const changed = beforeBody !== rawData.body || beforeFoot !== rawData.foot;
    return { ok: true, changed };
  } catch (e) {
    return { ok: false, changed: false };
  }
}

/* =========================================================
 * App start
 * ========================================================= */
function startApp() {
  // ✅ 排班表未開通：不啟動身體/腳底面板，只輪詢更新 rawData + 我的狀態 / 提示
  if (!scheduleUiEnabled_) {
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        pollState_.successStreak = 0;
        pollState_.failStreak = 0;
        pollState_.nextMs = POLL.BASE_MS;

        const res = await refreshStatusAdaptive_(true);
        updateMyMasterStatusUI_();
        const next = computeNextInterval_(res);
        scheduleNextPoll_(next);
      });
    }

    refreshStatusAdaptive_(false).then((res) => {
      updateMyMasterStatusUI_();
      const next = computeNextInterval_(res);
      scheduleNextPoll_(next);
    });

    return;
  }

  // ✅ 排班表已開通：原本行為
  setActivePanel("body");

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      pollState_.successStreak = 0;
      pollState_.failStreak = 0;
      pollState_.nextMs = POLL.BASE_MS;

      const res = await refreshStatusAdaptive_(true);
      const next = computeNextInterval_(res);
      scheduleNextPoll_(next);
    });
  }

  refreshStatusAdaptive_(false).then((res) => {
    const next = computeNextInterval_(res);
    scheduleNextPoll_(next);
  });
}

document.addEventListener("visibilitychange", async () => {
  if (!document.hidden) {
    pollState_.successStreak = 0;
    pollState_.failStreak = 0;
    pollState_.nextMs = POLL.BASE_MS;

    const res = await refreshStatusAdaptive_(false);
    const next = computeNextInterval_(res);
    scheduleNextPoll_(next);
  }
});

/* =========================================================
 * Entry
 * ========================================================= */
window.addEventListener("load", async () => {
  try {
    await loadConfigJson_();
    sanitizeEdgeUrls_();
  } catch (e) {
    console.error("[Config] load failed:", e);
    showGate("⚠ 無法載入 config.json，請確認檔案存在且可被存取。", true);
    return;
  }

  if (ENABLE_LINE_LOGIN) initLiffAndGuard();
  else initNoLiffAndGuard();
});
