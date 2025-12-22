// =========================================================
// app.js (Dashboard - Edge Cache Reader + LIFF Gate + Personal Tools)
// ✅ Personal Tools FINAL LOGIC (per your spec)
// - personalStatusEnabled === "是"  -> 3 buttons ALL visible + usable
// - Click mapping (PersonalStatus row):
//   使用者管理 -> 使用者管理liff
//   休假設定   -> 休假設定連結
//   個人狀態   -> 個人狀態連結
// - If any link missing: still show buttons, but click will console.error (no silent hide)
//
// ✅ Color/Background FINAL
// - Apply colorIndex/colorMaster/colorStatus (ScriptCat tokens: text-Cxxxxxx text-opacity-60 ...)
// - Apply bgIndex/bgMaster/bgStatus (ScriptCat tokens: bg-Cxxxxxx bg-opacity-20, bg-[#RRGGBB]/15 ...)
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
 * ✅ Config.json 讀取（取代硬寫 URL / LIFF_ID）
 * ========================================================= */
const CONFIG_JSON_URL = "./config.json";

let EDGE_STATUS_URLS = [];
let FALLBACK_ORIGIN_CACHE_URL = "";
let AUTH_API_URL = "";
let LIFF_ID = "";

async function loadConfigJson_() {
  const resp = await fetch(CONFIG_JSON_URL, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("CONFIG_HTTP_" + resp.status);

  const cfg = await resp.json();

  const edges = Array.isArray(cfg.EDGE_STATUS_URLS) ? cfg.EDGE_STATUS_URLS : [];
  EDGE_STATUS_URLS = edges.map((u) => String(u || "").trim()).filter(Boolean);

  FALLBACK_ORIGIN_CACHE_URL = String(cfg.FALLBACK_ORIGIN_CACHE_URL || "").trim();
  AUTH_API_URL = String(cfg.AUTH_API_URL || "").trim();
  LIFF_ID = String(cfg.LIFF_ID || "").trim();

  if (!LIFF_ID) throw new Error("CONFIG_LIFF_ID_MISSING");
  if (!AUTH_API_URL) throw new Error("CONFIG_AUTH_API_URL_MISSING");
  if (!FALLBACK_ORIGIN_CACHE_URL) throw new Error("CONFIG_FALLBACK_ORIGIN_CACHE_URL_MISSING");
  if (!EDGE_STATUS_URLS.length) throw new Error("CONFIG_EDGE_STATUS_URLS_EMPTY");
}

/* =========================
 * Hash / URL utils
 * ========================= */
function hashToIndex_(str, mod) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return mod ? h % mod : 0;
}
function withQuery_(base, extraQuery) {
  const b = String(base || "").trim();
  const q = String(extraQuery || "").trim();
  if (!b) return "";
  if (!q) return b;
  return b + (b.includes("?") ? "&" : "?") + q.replace(/^\?/, "");
}

/* =========================================================
 * ✅ Edge Failover + Timeout + Sticky Reroute
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
function getStatusEdgeIndex_() {
  const uid = window.currentUserId || "anonymous";
  const baseIdx = EDGE_STATUS_URLS.length ? hashToIndex_(uid, EDGE_STATUS_URLS.length) : 0;
  const overrideIdx = getOverrideEdgeIndex_();
  if (typeof overrideIdx === "number" && overrideIdx >= 0 && overrideIdx < EDGE_STATUS_URLS.length) return overrideIdx;
  return baseIdx;
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

/**
 * ✅ 新策略：
 * 1) Edge: mode=sheet_all
 * 2) Origin fallback: mode=sheet_all
 */
async function fetchStatusAll() {
  const jitterBust = Date.now();

  const startIdx = getStatusEdgeIndex_();
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
      return { source: "edge", bodyRows: body, footRows: foot };
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
    bodyRows: Array.isArray(data.body) ? data.body : [],
    footRows: Array.isArray(data.foot) ? data.foot : [],
  };
}

/* =========================================================
 * DOM
 * ========================================================= */
const gateEl = document.getElementById("gate");
const appRootEl = document.getElementById("appRoot");

// ✅ Top Loading Hint DOM
const topLoadingEl = document.getElementById("topLoading");
const topLoadingTextEl = topLoadingEl ? topLoadingEl.querySelector(".top-loading-text") : null;

// Dashboard data
const rawData = { body: [], foot: [] };
let activePanel = "body";
let filterMaster = "";
let filterStatus = "all";

// DOM
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
const loadingStateEl = document.getElementById("loadingState");
const errorStateEl = document.getElementById("errorState");
const themeToggleBtn = document.getElementById("themeToggle");

// 🔔 Usage banner
const usageBannerEl = document.getElementById("usageBanner");
const usageBannerTextEl = document.getElementById("usageBannerText");

// ✅ Personal Tools DOM
const personalToolsEl = document.getElementById("personalTools");
const btnUserManageEl = document.getElementById("btnUserManage");
const btnPersonalStatusEl = document.getElementById("btnPersonalStatus");
const btnVacationEl = document.getElementById("btnVacation");

/* =========================================================
 * ✅ Feature banner
 * ========================================================= */
let featureState = { pushEnabled: "否", personalStatusEnabled: "否", scheduleEnabled: "否" };

function normalizeYesNo_(v) {
  return String(v || "").trim() === "是" ? "是" : "否";
}
function ensureFeatureBanner_() {
  return document.getElementById("featureBanner") || null;
}
function buildChip_(label, enabled) {
  const on = enabled === "是";
  const cls = on ? "feature-chip" : "feature-chip feature-chip-disabled";
  const badge = on ? "" : `<span class="feature-chip-badge">未開通</span>`;
  return `<span class="${cls}">${label}${badge}</span>`;
}
function renderFeatureBanner_() {
  const banner = ensureFeatureBanner_();
  if (!banner) return;
  const chipsEl = document.getElementById("featureChips");
  if (!chipsEl) return;

  const push = normalizeYesNo_(featureState.pushEnabled);
  const personal = normalizeYesNo_(featureState.personalStatusEnabled);
  const schedule = normalizeYesNo_(featureState.scheduleEnabled);

  chipsEl.innerHTML = [buildChip_("叫班提醒", push), buildChip_("個人狀態", personal), buildChip_("排班表", schedule)].join("");
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
  // ✅ 保險：避免透明 gate 擋點
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
 * ✅ Personal Tools FINAL (per your spec)
 * ========================================================= */
async function fetchPersonalStatusRow_(userId) {
  const url = withQuery_(AUTH_API_URL, "mode=getPersonalStatus&userId=" + encodeURIComponent(userId));
  const resp = await fetch(url, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("getPersonalStatus HTTP " + resp.status);
  return await resp.json();
}

// 安全取欄位：先吃中文鍵，再吃英文鍵（避免 GAS 回傳欄位不齊時直接掛）
function pickField_(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function showPersonalToolsFinal_(psRow) {
  if (!personalToolsEl || !btnUserManageEl || !btnVacationEl || !btnPersonalStatusEl) return;

  // ✅ 只要 personalStatusEnabled=是，三顆「必定顯示」
  personalToolsEl.style.display = "flex";
  btnUserManageEl.style.display = "inline-flex";
  btnVacationEl.style.display = "inline-flex";
  btnPersonalStatusEl.style.display = "inline-flex";

  // ✅ 依你的欄位名稱取值（並做英文相容）
  const manage = pickField_(psRow, ["使用者管理liff", "manageLiff", "userManageLiff", "userManageLink"]);
  const vacation = pickField_(psRow, ["休假設定連結", "vacationLink"]);
  const personal = pickField_(psRow, ["個人狀態連結", "personalStatusLink"]);

  // ✅ 點擊：直接跳對應連結（若缺就明確噴錯，不做隱藏）
  btnUserManageEl.onclick = () => {
    if (!manage) return console.error("PersonalStatus 缺少欄位：使用者管理liff", psRow);
    window.location.href = manage;
  };
  btnVacationEl.onclick = () => {
    if (!vacation) return console.error("PersonalStatus 缺少欄位：休假設定連結", psRow);
    window.location.href = vacation;
  };
  btnPersonalStatusEl.onclick = () => {
    if (!personal) return console.error("PersonalStatus 缺少欄位：個人狀態連結", psRow);
    window.location.href = personal;
  };

  // Debug 快速檢查
  window.__personalLinks = { manage, vacation, personal, psRow };
}
function hidePersonalTools_() {
  if (personalToolsEl) personalToolsEl.style.display = "none";
}

/* =========================================================
 * ✅ 每日首次：由使用者傳訊息給官方帳號（只改前端）
 * ========================================================= */
const DAILY_USER_MSG_KEY = "daily_user_first_msg_v1";

function getTodayTaipei_() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year")?.value || "0000";
  const m = parts.find((p) => p.type === "month")?.value || "00";
  const d = parts.find((p) => p.type === "day")?.value || "00";
  return `${y}-${m}-${d}`;
}

async function sendDailyFirstMessageFromUser_() {
  try {
    if (!window.liff) return;
    if (!liff.isInClient()) return;

    const today = getTodayTaipei_();
    const last = localStorage.getItem(DAILY_USER_MSG_KEY) || "";
    if (last === today) return;

    const name = String(window.currentDisplayName || "").trim();
    const text = name ? `【每日首次開啟】${name} 已進入看板（${today}）` : `【每日首次開啟】使用者已進入看板（${today}）`;

    await liff.sendMessages([{ type: "text", text }]);
    localStorage.setItem(DAILY_USER_MSG_KEY, today);
  } catch (e) {
    console.warn("[DailyUserMessage] send failed:", e);
  }
}

/* =========================================================
 * ✅ 顏色/背景：ScriptCat token 解析 + 可讀性套用
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

// ✅ BG token: bg-Cxxxxxx bg-opacity-20 / bg-[#RRGGBB]/15 / #RRGGBB
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

function applyReadableBgColor_(el, bgStr) {
  if (!el || !bgStr) return false;

  const { hex, opacity } = parseScriptCatBgV2_(bgStr);
  if (!hex) return false;

  const rgb = hexToRgb(hex);
  if (!rgb) return false;

  let a = opacity;
  if (a == null) a = isLightTheme_() ? 0.10 : 0.16;
  a = clamp_(a, 0.03, 0.35);

  el.style.backgroundColor = `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
  return true;
}

// 兼容你原本 order cell 特規：改成通用 bg 套用
function applyBgIndexToOrderCell_(el, bgIndexToken) {
  return applyReadableBgColor_(el, bgIndexToken);
}

/* =========================================================
 * ✅ 字串清洗 + 狀態映射
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
 * Filter options
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
      if (row.status !== filterStatus) return false;
    }

    return true;
  });
}

/* =========================================================
 * ✅ Panel Diff
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
 * ✅ Incremental render
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

function patchRowDom_(tr, row, orderText) {
  const tds = tr.children;
  const tdOrder = tds[0];
  const tdMaster = tds[1];
  const tdStatus = tds[2];
  const tdAppointment = tds[3];
  const tdRemaining = tds[4];

  // --- order cell ---
  tdOrder.textContent = orderText;
  tdOrder.style.backgroundColor = "";
  tdOrder.style.color = "";
  if (row.bgIndex) applyBgIndexToOrderCell_(tdOrder, row.bgIndex);
  if (row.colorIndex) applyReadableTextColor_(tdOrder, row.colorIndex);

  // --- master cell ---
  tdMaster.textContent = row.masterId || "";
  tdMaster.style.backgroundColor = "";
  tdMaster.style.color = "";
  if (row.bgMaster) applyReadableBgColor_(tdMaster, row.bgMaster);
  if (row.colorMaster) applyReadableTextColor_(tdMaster, row.colorMaster);

  // --- status cell ---
  tdStatus.innerHTML = "";
  const statusSpan = document.createElement("span");
  statusSpan.className = "status-pill " + (row.statusClass || "");
  statusSpan.textContent = row.status || "";
  statusSpan.style.background = "";
  statusSpan.style.border = "";
  statusSpan.style.color = "";
  if (row.bgStatus) applyReadableBgColor_(statusSpan, row.bgStatus);
  if (row.colorStatus) applyReadablePillColor_(statusSpan, row.colorStatus);
  tdStatus.appendChild(statusSpan);

  // --- appointment ---
  tdAppointment.textContent = row.appointment || "";

  // --- remaining ---
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
 * ✅ refresh：輪詢不重疊 + 空快照保護
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
  if (document.hidden) return;
  if (refreshInFlight) return;

  refreshInFlight = true;

  if (isManual) showLoadingHint("同步資料中…");
  if (errorStateEl) errorStateEl.style.display = "none";

  try {
    const { source, bodyRows, footRows } = await fetchStatusAll();

    const bodyDecision = decideIncomingRows_("body", bodyRows, rawData.body, isManual);
    const footDecision = decideIncomingRows_("foot", footRows, rawData.foot, isManual);

    const bodyDiff = diffMergePanelRows_(rawData.body, bodyDecision.rows);
    const footDiff = diffMergePanelRows_(rawData.foot, footDecision.rows);

    if (bodyDiff.changed) rawData.body = bodyDiff.nextRows.map((r, i) => ({ ...r, _gasSeq: i }));
    if (footDiff.changed) rawData.foot = footDiff.nextRows.map((r, i) => ({ ...r, _gasSeq: i }));

    if (bodyDiff.statusChanged || footDiff.statusChanged) rebuildStatusFilterOptions();

    const anyChanged = bodyDiff.changed || footDiff.changed;
    const activeChanged = activePanel === "body" ? bodyDiff.changed : footDiff.changed;

    if (connectionStatusEl) connectionStatusEl.textContent = source === "edge" ? "已連線（分流）" : "已連線（主站）";

    if (anyChanged && lastUpdateEl) {
      const now = new Date();
      lastUpdateEl.textContent =
        "更新：" + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    }

    if (activeChanged) renderIncremental_(activePanel);
  } catch (err) {
    console.error("[Status] 取得狀態失敗：", err);
    if (connectionStatusEl) connectionStatusEl.textContent = "異常";
    if (errorStateEl) errorStateEl.style.display = "block";
  } finally {
    if (isManual) hideLoadingHint();
    refreshInFlight = false;
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshStatus(false);
});

/* =========================
 * ✅ 使用者更名同步（以 GAS 為準）
 * ========================= */
async function syncDisplayNameIfChanged_(userId, liffName, gasName) {
  const newName = String(liffName || "").trim();
  const oldName = String(gasName || "").trim();
  if (!userId || !newName) return false;

  if (!oldName || oldName !== newName) {
    try {
      await registerUser(userId, newName);
      return true;
    } catch (e) {
      console.warn("[NameSync] update failed:", e);
      return false;
    }
  }
  return false;
}

// ===== 審核相關 =====
async function checkOrRegisterUser(userId, displayNameFromLiff) {
  const url = AUTH_API_URL + "?mode=check&userId=" + encodeURIComponent(userId);
  const resp = await fetch(url, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("Check HTTP " + resp.status);

  const data = await resp.json();
  const status = (data && data.status) || "none";
  const audit = (data && data.audit) || "";
  const serverDisplayName = (data && data.displayName) || "";
  const scheduleEnabled = (data && data.scheduleEnabled) || "否";
  const pushEnabled = (data && data.pushEnabled) || "否";
  const personalStatusEnabled = (data && data.personalStatusEnabled) || "否";

  let remainingDays = null;
  if (data && data.remainingDays !== undefined && data.remainingDays !== null) {
    const n = Number(data.remainingDays);
    if (!Number.isNaN(n)) remainingDays = n;
  }

  const finalDisplayName = serverDisplayName || displayNameFromLiff || "";

  if (status === "approved") {
    return {
      allowed: true,
      status: "approved",
      audit,
      remainingDays,
      displayName: finalDisplayName,
      serverDisplayName,
      scheduleEnabled,
      pushEnabled,
      personalStatusEnabled,
    };
  }

  if (status === "pending") {
    return {
      allowed: false,
      status: "pending",
      audit,
      remainingDays,
      displayName: finalDisplayName,
      serverDisplayName,
      scheduleEnabled,
      pushEnabled,
      personalStatusEnabled,
    };
  }

  showGate("此帳號目前沒有使用權限，已自動送出審核申請…");

  try {
    await registerUser(userId, finalDisplayName);
  } catch (e) {
    console.error("[Register] 寫入 AUTH GAS 失敗：", e);
    return {
      allowed: false,
      status: "error",
      audit: "",
      remainingDays: null,
      displayName: finalDisplayName,
      serverDisplayName,
      scheduleEnabled,
      pushEnabled,
      personalStatusEnabled,
    };
  }

  return {
    allowed: false,
    status: "pending",
    audit: "待審核",
    remainingDays: null,
    displayName: finalDisplayName,
    serverDisplayName,
    scheduleEnabled,
    pushEnabled,
    personalStatusEnabled,
  };
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

// ===== 主題切換（亮 / 暗）=====
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
 * ✅ LIFF 初始化與權限 Gate
 * ========================================================= */
async function initLiffAndGuard() {
  showGate("正在啟動 LIFF…");

  try {
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
    await syncDisplayNameIfChanged_(userId, displayName, result.serverDisplayName);

    const finalDisplayName = (displayName || result.displayName || "").trim();
    window.currentDisplayName = finalDisplayName;

    updateFeatureState_(result);

    const scheduleOk = String(result.scheduleEnabled || "").trim() === "是";
    const rd = result.remainingDays;
    const hasRd = typeof rd === "number" && !Number.isNaN(rd);
    const notExpired = hasRd ? rd >= 0 : false;

    if (result.allowed && result.status === "approved" && scheduleOk && notExpired) {
      showGate("驗證通過，正在載入資料…");
      openApp();
      updateUsageBanner(finalDisplayName, result.remainingDays);

      // ✅ FINAL PERSONAL TOOLS LOGIC:
      // personalStatusEnabled=是 -> 顯示三顆並使用 PersonalStatus 欄位連結
      const personalOk = String(result.personalStatusEnabled || "").trim() === "是";
      if (personalOk) {
        try {
          const ps = await fetchPersonalStatusRow_(userId);

          // 兼容：有些人會包在 data/row/payload
          const psRow =
            (ps && (ps.data || ps.row || ps.payload) ? ps.data || ps.row || ps.payload : ps) || {};

          showPersonalToolsFinal_(psRow);
        } catch (e) {
          // 依你的規格：開通了就必須能看到三顆
          showPersonalToolsFinal_({});
          console.error("[PersonalTools] getPersonalStatus failed:", e);
        }
      } else {
        hidePersonalTools_();
      }

      await sendDailyFirstMessageFromUser_();
      startApp();
      return;
    }

    // 非可用狀態：隱藏個人工具
    hidePersonalTools_();

    if (result.status === "approved") {
      let msg = "此帳號已通過審核，但目前無法使用看板。\n\n";
      if (!scheduleOk) msg += "原因：尚未開通「排班表」。\n";
      if (!notExpired) msg += "原因：使用期限已到期或未設定期限。\n";
      msg += "\n請聯絡管理員協助開通或延長使用期限。";
      showGate(msg);
      return;
    }

    if (result.status === "pending") {
      const auditText = result.audit || "待審核";
      let msg = "此帳號目前尚未通過審核。\n";
      msg += "目前審核狀態：「" + auditText + "」。\n\n";
      msg +=
        auditText === "拒絕" || auditText === "停用"
          ? "如需重新申請或有疑問，請聯絡管理員。"
          : "若你已經等待一段時間，請聯絡管理員確認審核進度。";
      showGate(msg);
      return;
    }

    showGate("⚠ 無法確認使用權限，請稍後再試。", true);
  } catch (err) {
    console.error("[LIFF] 初始化或驗證失敗：", err);
    hidePersonalTools_();
    showGate("⚠ LIFF 初始化或權限驗證失敗，請稍後再試。", true);
  }
}

/* =========================
 * Events
 * ========================= */
if (tabBodyBtn) tabBodyBtn.addEventListener("click", () => setActivePanel("body"));
if (tabFootBtn) tabFootBtn.addEventListener("click", () => setActivePanel("foot"));

if (filterMasterInput) {
  filterMasterInput.addEventListener("input", (e) => {
    filterMaster = e.target.value || "";
    renderIncremental_(activePanel);
  });
}
if (filterStatusSelect) {
  filterStatusSelect.addEventListener("change", (e) => {
    filterStatus = e.target.value || "all";
    renderIncremental_(activePanel);
  });
}
if (refreshBtn) refreshBtn.addEventListener("click", () => refreshStatus(true));

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
}

/* =========================
 * App start
 * ========================= */
let pollTimer = null;

function startApp() {
  setActivePanel("body");
  refreshStatus(false);

  const intervalMs = 3 * 1000;
  const jitter = Math.floor(Math.random() * 3000);

  if (pollTimer) clearInterval(pollTimer);

  setTimeout(() => {
    pollTimer = setInterval(() => refreshStatus(false), intervalMs);
  }, jitter);
}

/* =========================================================
 * ✅ Entry
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

  initLiffAndGuard();
});
