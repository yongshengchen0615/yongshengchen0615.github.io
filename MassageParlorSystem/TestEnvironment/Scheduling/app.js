// =========================================================
// app.js (Dashboard - Edge Cache Reader + LIFF/No-LIFF Gate + Rules-driven Status)
// ✅ 本版包含：降低 GAS 壓力（自適應輪詢 + 退避重試 + jitter 去同步 + 前景回來立即抓）
// ✅ 方案A已套用：支援後端回傳 masterCode → 正確顯示「我的狀態」
// ✅ NEW：不管是否排班，都顯示「若現在切到排班，我會排第幾」
// ✅ NEW：剩餘 < 0 或 <= 3 → badge 警告色；排班排名 <= 3 → rank badge 發光
// ✅ FIX：我的狀態 status-pill 顏色與面板一致（吃 bgStatus/colorStatus）
// ✅ FIX：面板排班狀態支援 status-shift
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
const btnVacationEl = document.getElementById("btnVacation");

/* ✅ 個人師傅狀態 DOM */
const myMasterStatusEl = document.getElementById("myMasterStatus");
const myMasterStatusTextEl = document.getElementById("myMasterStatusText");

/* =========================================================
 * ✅ 使用者（師傅）個人狀態 - state
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

/** ✅ 方案A 핵심：支援 GAS 回傳 masterCode */
function parseTechNo_(data) {
  const v = pickAny_(data, [
    "techNo",
    "師傅編號",
    "masterCode",
    "masterId",
    "masterNo",
    "tech",
    "師傅",
    "技師編號",
  ]);
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
 * ✅ Shift rank helpers
 * ========================================================= */
function normalizeText_(s) {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}

// 判斷是否為排班狀態
function isShiftStatus_(statusText) {
  const s = normalizeText_(statusText || "");
  return s.includes("排班");
}

// 取「表格目前使用的排序策略」：跟 renderIncremental_ 對齊
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

// ✅ 算「假想排班順位」
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

function remBadgeClass_(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return "";
  if (n < 0) return "is-expired";
  if (n <= 3) return "is-warn";
  return "";
}

/* =========================================================
 * ✅ 顏色 token 解析（你原本的整套：保留）
 * ========================================================= */
function isLightTheme_() {
  return (document.documentElement.getAttribute("data-theme") || "dark") === "light";
}
function clamp_(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function hexToRgb(hex) {
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

  const mBracket = s.match(/text-\[#([0-9a-fA-F]{6})\]/);
  if (mBracket) return "#" + mBracket[1];

  const mHash = s.match(/#([0-9a-fA-F]{6})/);
  if (mHash) return "#" + mHash[1];

  const mC = s.match(/(?:^|text-)(?:C)?([0-9a-fA-F]{6})$/);
  if (mC) return "#" + mC[1];

  const mIn = s.match(/text-C([0-9a-fA-F]{6})/);
  if (mIn) return "#" + mIn[1];

  return null;
}
function parseOpacityToken_(token) {
  if (!token) return null;
  const t = String(token).trim();

  let m = t.match(/(?:text-opacity-|opacity-)(\d{1,3})/);
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
function parseScriptCatColorV2_(colorStr) {
  if (!colorStr) return { hex: null, opacity: null };
  const tokens = String(colorStr).split(/\s+/).filter(Boolean);

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
    const h = normalizeHex6_(String(colorStr));
    if (h) hex = h;
  }

  return { hex, opacity };
}
function parseScriptCatBgV2_(bgStr) {
  if (!bgStr) return { hex: null, opacity: null };
  const tokens = String(bgStr).split(/\s+/).filter(Boolean);

  let hex = null;
  let opacity = null;

  for (const tk of tokens) {
    if (!hex) {
      const mBracket = tk.match(/bg-\[#([0-9a-fA-F]{6})\]/);
      if (mBracket) hex = "#" + mBracket[1];

      const mC = tk.match(/(?:^|bg-)(?:C)?([0-9a-fA-F]{6})$/);
      if (!hex && mC) hex = "#" + mC[1];

      const mHash = tk.match(/#([0-9a-fA-F]{6})/);
      if (!hex && mHash) hex = "#" + mHash[1];
    }

    if (opacity == null) {
      let m = tk.match(/(?:bg-opacity-|opacity-)(\d{1,3})/);
      if (m) {
        const n = Number(m[1]);
        if (!Number.isNaN(n)) opacity = clamp_(n / 100, 0, 1);
      }
      if (opacity == null) {
        m = tk.match(/\/(\d{1,3})$/);
        if (m) {
          const n = Number(m[1]);
          if (!Number.isNaN(n)) opacity = clamp_(n / 100, 0, 1);
        }
      }
    }
  }

  return { hex, opacity };
}

/* ✅ 你原本表格用的三個 apply：保留 */
function applyReadablePillColor_(pillEl, colorStr) {
  if (!pillEl || !colorStr) return false;
  const { hex, opacity } = parseScriptCatColorV2_(colorStr);
  if (!hex) return false;

  const rgb = hexToRgb(hex);
  if (!rgb) return false;

  const minAlpha = isLightTheme_() ? 0.85 : 0.7;
  let aText = opacity == null ? 1 : opacity;
  aText = clamp_(aText, minAlpha, 1);
  pillEl.style.color = aText < 1 ? `rgba(${rgb.r},${rgb.g},${rgb.b},${aText})` : hex;

  const aBg = isLightTheme_() ? 0.1 : 0.16;
  pillEl.style.background = `rgba(${rgb.r},${rgb.g},${rgb.b},${aBg})`;

  const aBd = isLightTheme_() ? 0.25 : 0.35;
  pillEl.style.border = `1px solid rgba(${rgb.r},${rgb.g},${rgb.b},${aBd})`;

  return true;
}
function applyReadablePillTextOnly_(pillEl, colorStr) {
  if (!pillEl || !colorStr) return false;

  const { hex, opacity } = parseScriptCatColorV2_(colorStr);
  if (!hex) return false;

  const rgb = hexToRgb(hex);
  if (!rgb) return false;

  const minAlpha = isLightTheme_() ? 0.85 : 0.7;
  let aText = opacity == null ? 1 : opacity;
  aText = clamp_(aText, minAlpha, 1);

  pillEl.style.color = aText < 1 ? `rgba(${rgb.r},${rgb.g},${rgb.b},${aText})` : hex;
  return true;
}
function applyReadablePillBgFromBgToken_(pillEl, bgStr) {
  if (!pillEl || !bgStr) return false;

  const { hex, opacity } = parseScriptCatBgV2_(bgStr);
  if (!hex) return false;

  const rgb = hexToRgb(hex);
  if (!rgb) return false;

  let aBg = opacity;
  if (aBg == null) aBg = isLightTheme_() ? 0.1 : 0.16;
  aBg = clamp_(aBg, 0.03, 0.35);

  pillEl.style.background = `rgba(${rgb.r},${rgb.g},${rgb.b},${aBg})`;

  const aBd = clamp_(aBg + (isLightTheme_() ? 0.12 : 0.18), 0.12, 0.55);
  pillEl.style.border = `1px solid rgba(${rgb.r},${rgb.g},${rgb.b},${aBd})`;

  return true;
}

/* =========================================================
 * ✅ NEW：我的狀態吃 token（跟表格同邏輯）
 * ========================================================= */
function buildStatusPillInlineStyle_(row) {
  if (!row) return "";

  const styles = [];
  const isLight = isLightTheme_();

  // 1) bgStatus → 背景 + 邊框
  if (row.bgStatus) {
    const { hex, opacity } = parseScriptCatBgV2_(row.bgStatus);
    if (hex) {
      const rgb = hexToRgb(hex);
      if (rgb) {
        let aBg = opacity;
        if (aBg == null) aBg = isLight ? 0.1 : 0.16;
        aBg = clamp_(aBg, 0.03, 0.35);

        styles.push(`background: rgba(${rgb.r},${rgb.g},${rgb.b},${aBg})`);

        const aBd = clamp_(aBg + (isLight ? 0.12 : 0.18), 0.12, 0.55);
        styles.push(`border: 1px solid rgba(${rgb.r},${rgb.g},${rgb.b},${aBd})`);
      }
    }
  }

  // 2) colorStatus → 文字色（若無 bgStatus，則用 colorStatus 同時生成背景/邊框）
  if (row.colorStatus) {
    const { hex, opacity } = parseScriptCatColorV2_(row.colorStatus);
    if (hex) {
      const rgb = hexToRgb(hex);
      if (rgb) {
        const minAlpha = isLight ? 0.85 : 0.7;
        let aText = opacity == null ? 1 : opacity;
        aText = clamp_(aText, minAlpha, 1);

        styles.push(`color: ${aText < 1 ? `rgba(${rgb.r},${rgb.g},${rgb.b},${aText})` : hex}`);

        if (!row.bgStatus) {
          const aBg = isLight ? 0.1 : 0.16;
          styles.push(`background: rgba(${rgb.r},${rgb.g},${rgb.b},${aBg})`);

          const aBd = isLight ? 0.25 : 0.35;
          styles.push(`border: 1px solid rgba(${rgb.r},${rgb.g},${rgb.b},${aBd})`);
        }
      }
    }
  }

  return styles.join(";");
}

/* =========================================================
 * Text normalize + status mapping（修訂：支援排班）
 * ========================================================= */
function fmtRemainingRaw(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

/* ✅ 唯一狀態分類（表格 + 我的狀態 共用） */
function deriveStatusClass(status, remaining) {
  const s = normalizeText_(status || "");
  const n = Number(remaining);

  if (s.includes("排班")) return "status-shift"; // ✅ NEW
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

      bgIndex: row.bgIndex || "",
      bgMaster: row.bgMaster || "",
      bgStatus: row.bgStatus || "",

      remainingDisplay: fmtRemainingRaw(remaining),
      statusClass: deriveStatusClass(row.status, remaining),
    };
  });
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

function applyReadableTextColor_(el, colorStr) {
  if (!el || !colorStr) return false;
  const { hex, opacity } = parseScriptCatColorV2_(colorStr);
  if (!hex) return false;

  const rgb = hexToRgb(hex);
  if (!rgb) return false;

  const minAlpha = isLightTheme_() ? 0.8 : 0.65;
  let a = opacity == null ? 1 : opacity;
  a = clamp_(a, minAlpha, 1);

  el.style.color = a < 1 ? `rgba(${rgb.r},${rgb.g},${rgb.b},${a})` : hex;
  return true;
}

function applyReadableBgColor_(el, bgStr) {
  if (!el || !bgStr) return false;

  const { hex, opacity } = parseScriptCatBgV2_(bgStr);
  if (!hex) return false;

  const rgb = hexToRgb(hex);
  if (!rgb) return false;

  let a = opacity;
  if (a == null) a = isLightTheme_() ? 0.1 : 0.16;
  a = clamp_(a, 0.03, 0.35);

  el.style.backgroundColor = `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
  return true;
}

function isOrderBgCcbcBcB_(bgToken) {
  const s = String(bgToken || "").trim();
  if (!s) return false;
  return s.includes("CCBCBCB");
}

function applyOrderHighlightBg_(el, bgStr) {
  if (!el || !bgStr) return false;

  const { hex } = parseScriptCatBgV2_(bgStr);
  if (!hex) return false;

  const rgb = hexToRgb(hex);
  if (!rgb) return false;

  const bgAlpha = isLightTheme_() ? 0.28 : 0.38;
  el.style.backgroundColor = `rgba(${rgb.r},${rgb.g},${rgb.b},${bgAlpha})`;
  el.style.borderLeft = `4px solid rgba(${rgb.r},${rgb.g},${rgb.b},0.85)`;
  el.style.fontWeight = "600";
  return true;
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
  tdOrder.style.color = "";
  tdOrder.style.borderLeft = "";
  tdOrder.style.fontWeight = "";

  if (isOrderBgCcbcBcB_(row.bgIndex)) {
    applyOrderHighlightBg_(tdOrder, row.bgIndex);
  }
  if (row.colorIndex) applyReadableTextColor_(tdOrder, row.colorIndex);

  tdMaster.textContent = row.masterId || "";
  tdMaster.style.backgroundColor = "";
  tdMaster.style.color = "";
  if (row.bgMaster) applyReadableBgColor_(tdMaster, row.bgMaster);
  if (row.colorMaster) applyReadableTextColor_(tdMaster, row.colorMaster);

  tdStatus.innerHTML = "";
  const statusSpan = document.createElement("span");
  statusSpan.className = "status-pill " + (row.statusClass || "");
  statusSpan.textContent = row.status || "";

  statusSpan.style.background = "";
  statusSpan.style.border = "";
  statusSpan.style.color = "";

  // ✅ 表格：吃 token（原本就有）
  if (row.bgStatus) applyReadablePillBgFromBgToken_(statusSpan, row.bgStatus);
  if (row.colorStatus) applyReadablePillTextOnly_(statusSpan, row.colorStatus);
  if (!row.bgStatus && row.colorStatus) applyReadablePillColor_(statusSpan, row.colorStatus);

  tdStatus.appendChild(statusSpan);

  tdAppointment.textContent = row.appointment || "";

  tdRemaining.innerHTML = "";
  const timeSpan = document.createElement("span");
  timeSpan.className = "time-badge";
  timeSpan.textContent = row.remainingDisplay || "";
  tdRemaining.appendChild(timeSpan);
}

function renderIncremental_(panel) {
  if (!tbodyRowsEl) return;

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

function escapeHtml_(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* =========================================================
 * ✅ 我的狀態：用表格同一套顏色規則（token + fallback）
 * ========================================================= */
function makeMyPanelRowHTML_(label, row, shiftRankObj) {
  const statusText = row ? String(row.status || "").trim() || "—" : "—";
  const remNum = parseRemainingNumber_(row);
  const remText = remNum === null ? "—" : String(remNum);

  // ✅ class：同一套 deriveStatusClass（包含排班）
  const stCls = "status-pill " + deriveStatusClass(statusText, remNum);

  // ✅ style：同一套 token 規則（bgStatus/colorStatus）
  const stStyle = buildStatusPillInlineStyle_(row);

  const remCls = "myms-rem " + remBadgeClass_(remNum);

  let rankText = "—";
  let rankCls = "myms-rank";
  if (shiftRankObj && typeof shiftRankObj.rank === "number") {
    const prefix = shiftRankObj.meIsShiftNow ? "排班" : "若排班";
    rankText = `${prefix}：第 ${shiftRankObj.rank} / ${shiftRankObj.total}`;
    if (shiftRankObj.rank <= 3) rankCls += " is-top3";
  }

  return `
    <div class="myms-row">
      <div class="myms-label">${label}</div>
      <div class="myms-right">
        <span class="${stCls}" style="${stStyle}">${escapeHtml_(statusText)}</span>
        <span class="${remCls}">剩餘：${escapeHtml_(String(remText))}</span>
        <span class="${rankCls}">${escapeHtml_(rankText)}</span>
      </div>
    </div>
  `;
}

function pickDominantMyStatus_(bodyRow, footRow) {
  const candidates = [
    { row: bodyRow },
    { row: footRow },
  ].filter((x) => x.row);

  if (!candidates.length) return "status-other";

  const score = (r) => {
    const s = normalizeText_(r.status || "");
    const n = parseRemainingNumber_(r);
    if (s.includes("排班")) return 5;
    if (s.includes("工作") || (!Number.isNaN(n) && n < 0)) return 4;
    if (s.includes("預約")) return 3;
    if (s.includes("空閒") || s.includes("待命") || s.includes("準備") || s.includes("備牌")) return 2;
    return 1;
  };

  let best = candidates[0].row;
  for (const c of candidates) {
    if (score(c.row) > score(best)) best = c.row;
  }

  // ✅ 直接回傳 status-xxx（跟 my-master-status::before 對齊）
  const cls = deriveStatusClass(best.status, parseRemainingNumber_(best));
  return cls;
}

function updateMyMasterStatusUI_() {
  if (!myMasterStatusEl) return;

  if (!myMasterState_.isMaster || !myMasterState_.techNo) {
    myMasterStatusEl.style.display = "none";
    return;
  }

  const bodyRow = findRowByTechNo_(rawData.body, myMasterState_.techNo);
  const footRow = findRowByTechNo_(rawData.foot, myMasterState_.techNo);

  const bodyShiftRank = getShiftRank_(rawData.body, myMasterState_.techNo);
  const footShiftRank = getShiftRank_(rawData.foot, myMasterState_.techNo);

  // 左色條狀態：用 status-xxx
  const dominant = pickDominantMyStatus_(bodyRow, footRow);
  myMasterStatusEl.classList.remove("status-shift","status-busy","status-booked","status-free","status-other");
  myMasterStatusEl.classList.add(dominant);

  const host = myMasterStatusTextEl || myMasterStatusEl;

  const html = `
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

  host.innerHTML = html;
  myMasterStatusEl.style.display = "flex";
}

/* =========================================================
 * Feature banner（原樣保留）
 * ========================================================= */
let featureState = { pushEnabled: "否", personalStatusEnabled: "否", scheduleEnabled: "否" };

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

  chipsEl.innerHTML = [buildChip_("叫班提醒", push), buildChip_("個人狀態", personal), buildChip_("排班表", schedule)].join(
    ""
  );
}
function updateFeatureState_(data) {
  featureState.pushEnabled = normalizeYesNo_(data && data.pushEnabled);
  featureState.personalStatusEnabled = normalizeYesNo_(data && data.personalStatusEnabled);
  featureState.scheduleEnabled = normalizeYesNo_(data && data.scheduleEnabled);
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
 * 你原本後半段（AUTH/LIFF/輪詢/事件）不動：
 * ✅ 但要保留 refreshStatus() 最後呼叫 updateMyMasterStatusUI_()
 * ✅ 以及 filterStatus change 時呼叫 updateMyMasterStatusUI_()
 * ========================================================= */

/* =========================================================
 * refreshStatus（保留你原版，只確保最後 updateMyMasterStatusUI_()）
 * ========================================================= */
async function refreshStatus(isManual = false) {
  if (document.hidden) return;
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
      if (source === "edge" && typeof edgeIdx === "number") connectionStatusEl.textContent = `已連線（分流 ${edgeIdx + 1}）`;
      else connectionStatusEl.textContent = "已連線（主站）";
    }

    if (anyChanged && lastUpdateEl) {
      const now = new Date();
      lastUpdateEl.textContent =
        "更新：" + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    }

    if (activeChanged) renderIncremental_(activePanel);

    // ✅ 每次 refresh 後更新「我的狀態」（含 token 顏色一致）
    updateMyMasterStatusUI_();
  } catch (err) {
    console.error("[Status] 取得狀態失敗：", err);
    if (connectionStatusEl) connectionStatusEl.textContent = "異常";
    if (errorStateEl) errorStateEl.style.display = "block";
  } finally {
    if (isManual) hideLoadingHint();
    refreshInFlight = false;
  }
}

/* =========================================================
 * Theme（保留原版）
 * ========================================================= */
function setTheme(theme) {
  const root = document.documentElement;
  const finalTheme = theme === "light" ? "light" : "dark";
  root.setAttribute("data-theme", finalTheme);
  localStorage.setItem("dashboardTheme", finalTheme);
  if (themeToggleBtn) themeToggleBtn.textContent = finalTheme === "dark" ? "🌙 深色" : "☀️ 淺色";
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
 * Tabs / Filters events（保留 + 確保更新我的狀態）
 * ========================================================= */
if (tabBodyBtn) tabBodyBtn.addEventListener("click", () => setActivePanel("body"));
if (tabFootBtn) tabFootBtn.addEventListener("click", () => setActivePanel("foot"));

if (filterMasterInput) {
  filterMasterInput.addEventListener("input", (e) => {
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
 * ✅ 下面 AUTH/LIFF/輪詢 你原本的完整程式碼請照舊保留
 * 因為你貼的版本很長、而且這段與顏色一致無直接關係。
 *
 * ✅ 你只要確保：
 * 1) init 最後會 startApp()
 * 2) refreshStatus() 有被呼叫
 * 3) updateMyMasterStatusUI_() 會在 refresh後執行
 * ========================================================= */

/* =========================================================
 * Entry（保留原版的 loadConfigJson_/initLiffAndGuard/initNoLiffAndGuard）
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

  // 你原本的 initLiffAndGuard / initNoLiffAndGuard 請保持
  if (ENABLE_LINE_LOGIN) initLiffAndGuard();
  else initNoLiffAndGuard();
});
