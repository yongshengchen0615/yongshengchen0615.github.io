/**
 * performance.js（✅ 最終可貼可覆蓋版）
 * - ✅ 改為吃「GAS syncStorePerf_v1」
 * - ✅ 移除 techNo / techId（只用 userId → StoreId 由 GAS 授權表決定）
 * - ✅ 三卡依區間即時變動（吃 GAS cards；無 cards 則用 rows fallback）
 * - ✅ 統計頁：節=數量（欄位：總節數/老點節數/排班節數）
 * - ✅ 圖表跨裝置可讀性強化 + touchstart/pointer Intervention 修正
 *
 * ✅ 本版關鍵修正（相對你貼的版本）
 * 1) POST body 改成「真正的 application/x-www-form-urlencoded」：不再用 header=urlencoded + body=JSON 字串（降低環境不一致風險）
 * 2) 圖表 bucket 判斷只吃「拉牌」欄（避免服務項目名稱誤判）
 * 3) 本月比率篩選先 normalize 訂單日期（避免 YYYY/MM/DD 字串比較失效）
 */

import { dom } from "./dom.js";
import { config } from "./config.js";
import { state } from "./state.js";
import { withQuery, escapeHtml, getQueryParam } from "./core.js";
import { holdLoadingHint } from "./uiHelpers.js";

const PERF_FETCH_TIMEOUT_MS = 25000;

// ✅ 日期區間上限：3 個月（以 93 天近似，避免 GAS 同步過久/逾時）
const PERF_MAX_RANGE_DAYS = 93;

/** ✅ 類別表數量口徑：固定用「數量」欄位（節=數量） */
const PERF_CARD_QTY_MODE = "qty"; // "qty" only

/** ✅ 圖表偏好 key */
const PERF_CHART_VIS_KEY = "perf_chart_vis_v1";
const PERF_CHART_MODE_KEY = "perf_chart_mode_v1";

let perfSelectedMode_ = "detail"; // "detail" | "summary"
let perfPrefetchInFlight_ = null;

const perfCache_ = {
  key: "", // `${userId}|${from}|${to}`
  lastUpdatedAt: "",
  detailRows: [], // 第一筆格式 rows
  cards: null, // GAS cards
  serviceSummary: [], // GAS service summary rows
};

let perfChartInstance_ = null;
let perfChartLastRows_ = null;
let perfChartLastDateKeys_ = null;
let perfChartResizeTimer_ = null;
let perfChartRO_ = null;
let perfChartLastLayout_ = null; // { isNarrow, shouldScroll, points }
let perfChartsDisabled_ = false;

let perfDetailUi_ = null;
let perfScrollLockPrev_ = null;

function isTouchLike_() {
  try {
    if (typeof window === "undefined") return false;
    return (
      (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) ||
      (typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 0)
    );
  } catch (_) {
    return false;
  }
}

function isIOSLike_() {
  try {
    const ua = String(navigator?.userAgent || "");
    const isIOS = /iP(hone|od|ad)/.test(ua);
    // iPadOS 13+ reports as Mac but has touch
    const isIPadOS = /Macintosh/.test(ua) && isTouchLike_();
    return isIOS || isIPadOS;
  } catch (_) {
    return false;
  }
}

// Chart.js loader (lazy)
const CHARTJS_SRC = "https://cdn.jsdelivr.net/npm/chart.js";
let chartJsReady_ = null;

function loadScriptOnce_(src) {
  if (!src) return Promise.reject(new Error("MISSING_SRC"));
  return new Promise((resolve, reject) => {
    try {
      const existing = document.querySelector(`script[data-src="${src}"]`);
      if (existing && window.Chart) return resolve(true);

      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.crossOrigin = "anonymous";
      s.setAttribute("data-src", src);
      s.onload = () => resolve(true);
      s.onerror = () => reject(new Error("SCRIPT_LOAD_FAILED"));
      document.head.appendChild(s);
    } catch (e) {
      reject(e);
    }
  });
}

async function ensureChartJs_() {
  // Respect config flag: if charts are disabled, short-circuit and return false
  try {
    if (config && (config.ENABLE_PERF_CHARTS === false || String(config.ENABLE_PERF_CHARTS).toLowerCase() === "false")) {
      return false;
    }
  } catch (_) {}

  if (window.Chart) return true;
  if (!chartJsReady_) {
    chartJsReady_ = loadScriptOnce_(CHARTJS_SRC)
      .then(() => {
        if (!window.Chart) throw new Error("CHARTJS_GLOBAL_MISSING");
        return true;
      })
      .catch((e) => {
        chartJsReady_ = null;
        throw e;
      });
  }
  return await chartJsReady_;
}

// drag-to-scroll state
const perfDragState_ = {
  enabled: false,
  pointerDown: false,
  dragging: false,
  startX: 0,
  startY: 0,
  startScrollLeft: 0,
  suppressClickUntil: 0,
  handlers: null,
};

/* =========================
 * Intl formatter（memoize）
 * ========================= */

const PERF_CURRENCY_FMT = (() => {
  try {
    return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
  } catch (_) {
    return null;
  }
})();

const PERF_DATETIME_FMT = (() => {
  try {
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch (_) {
    return null;
  }
})();

function fmtMoney_(n) {
  const v = Number(n || 0) || 0;
  if (PERF_CURRENCY_FMT) return PERF_CURRENCY_FMT.format(v);
  return String(Math.round(v));
}

function fmtCurrencyFull_(n) {
  return `NT$${fmtMoney_(n)}`;
}

function fmtCurrencyTick_(n) {
  const v = Number(n || 0) || 0;
  const av = Math.abs(v);
  if (av >= 1000000) return `${Math.round((v / 1000000) * 10) / 10}M`;
  if (av >= 1000) return `${Math.round((v / 1000) * 10) / 10}K`;
  return fmtMoney_(v);
}

function perfLockScroll_() {
  try {
    const html = document.documentElement;
    if (!html) return;
    const body = document.body;
    if (!perfScrollLockPrev_) {
      perfScrollLockPrev_ = {
        htmlClass: html.className || "",
        htmlOverflow: html.style ? html.style.overflow : "",
        bodyOverflow: body && body.style ? body.style.overflow : "",
        bodyPosition: body && body.style ? body.style.position : "",
        bodyTop: body && body.style ? body.style.top : "",
        bodyLeft: body && body.style ? body.style.left : "",
        bodyRight: body && body.style ? body.style.right : "",
        bodyWidth: body && body.style ? body.style.width : "",
        scrollY: typeof window !== "undefined" ? (window.scrollY || window.pageYOffset || 0) : 0,
      };
    }
    html.classList.add("perf-modal-open");

    // iOS: overflow:hidden often breaks inner scroll; use body fixed technique
    if (isIOSLike_() && body && body.style) {
      const y = Number(perfScrollLockPrev_?.scrollY || 0) || 0;
      body.style.position = "fixed";
      body.style.top = `${-y}px`;
      body.style.left = "0";
      body.style.right = "0";
      body.style.width = "100%";
      return;
    }

    // Others: overflow hidden is OK
    try {
      html.style.overflow = "hidden";
    } catch (_) {}
    try {
      if (body && body.style) body.style.overflow = "hidden";
    } catch (_) {}
  } catch (_) {}
}

function perfUnlockScroll_() {
  try {
    const html = document.documentElement;
    if (!html) return;
    const hadModalClass = html.classList.contains("perf-modal-open");
    html.classList.remove("perf-modal-open");

    const body = document.body;
    const prev = perfScrollLockPrev_;
    if (prev) {
      // iOS fixed-body restore
      if (isIOSLike_() && body && body.style) {
        try {
          body.style.position = prev.bodyPosition || "";
          body.style.top = prev.bodyTop || "";
          body.style.left = prev.bodyLeft || "";
          body.style.right = prev.bodyRight || "";
          body.style.width = prev.bodyWidth || "";
        } catch (_) {}

        // Also restore any overflow styles (in case other code touched them)
        try {
          html.style.overflow = prev.htmlOverflow || "";
        } catch (_) {}
        try {
          if (body && body.style) body.style.overflow = prev.bodyOverflow || "";
        } catch (_) {}

        try {
          const y = Number(prev.scrollY || 0) || 0;
          window.scrollTo(0, y);
        } catch (_) {}

        perfScrollLockPrev_ = null;
        return;
      }

      try {
        html.style.overflow = prev.htmlOverflow || "";
      } catch (_) {}
      try {
        if (body && body.style) body.style.overflow = prev.bodyOverflow || "";
      } catch (_) {}
      perfScrollLockPrev_ = null;
    } else {
      try {
        html.style.overflow = "";
      } catch (_) {}
      try {
        if (body && body.style) body.style.overflow = "";
      } catch (_) {}

      // Defensive: if modal class existed but we lost prev state, ensure body isn't left fixed.
      if (hadModalClass && body && body.style && body.style.position === "fixed") {
        try {
          body.style.position = "";
          body.style.top = "";
          body.style.left = "";
          body.style.right = "";
          body.style.width = "";
        } catch (_) {}
      }
    }
  } catch (_) {}
}

function perfEnsureDetailUi_() {
  if (perfDetailUi_ && perfDetailUi_.overlayEl && perfDetailUi_.panelEl) return perfDetailUi_;

  const overlayEl = document.createElement("div");
  overlayEl.className = "perf-detail-overlay";
  overlayEl.setAttribute("aria-hidden", "true");

  const panelEl = document.createElement("div");
  panelEl.className = "perf-detail-panel";
  panelEl.setAttribute("role", "dialog");
  panelEl.setAttribute("aria-modal", "true");
  panelEl.setAttribute("aria-hidden", "true");

  panelEl.innerHTML = `
    <div class="perf-detail-panel-inner">
      <div class="perf-detail-handle" aria-hidden="true"></div>
      <div class="perf-detail-head">
        <div class="perf-detail-title" id="perfDetailTitle">—</div>
        <button class="perf-detail-close" type="button" aria-label="關閉">✕</button>
      </div>
      <div class="perf-detail-meta" id="perfDetailMeta">—</div>
      <div class="perf-detail-body" id="perfDetailBody"></div>
    </div>
  `;

  document.body.appendChild(overlayEl);
  document.body.appendChild(panelEl);

  const closeBtn = panelEl.querySelector(".perf-detail-close");
  const onKeydown = (ev) => {
    if (!ev) return;
    if (ev.key === "Escape") perfCloseDetail_();
  };

  overlayEl.addEventListener("click", () => perfCloseDetail_(), { passive: true });
  if (closeBtn) closeBtn.addEventListener("click", () => perfCloseDetail_(), { passive: true });
  document.addEventListener("keydown", onKeydown, { passive: true });

  perfDetailUi_ = { overlayEl, panelEl, closeBtn, onKeydown };
  return perfDetailUi_;
}

function perfCloseDetail_() {
  try {
    const ui = perfDetailUi_;
    if (ui) {
      ui.overlayEl.classList.remove("is-open");
      ui.overlayEl.setAttribute("aria-hidden", "true");
      ui.panelEl.classList.remove("is-open", "is-sheet", "is-popover");
      ui.panelEl.setAttribute("aria-hidden", "true");
      try {
        ui.panelEl.removeAttribute("style");
      } catch (_) {}
    }
  } catch (e) {
    console.error("perfCloseDetail_ error", e);
  } finally {
    perfUnlockScroll_();
  }
}

function perfOpenDetail_(payload) {
  try {
    const ui = perfEnsureDetailUi_();
    if (!ui) return;

    const dateLabel = String(payload?.dateLabel || "—");
    const metricsText = String(payload?.metricsText || "");
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const anchor = payload?.anchor || null; // { x, y }

    const titleEl = ui.panelEl.querySelector("#perfDetailTitle");
    const metaEl = ui.panelEl.querySelector("#perfDetailMeta");
    const bodyEl = ui.panelEl.querySelector("#perfDetailBody");
    if (titleEl) titleEl.textContent = dateLabel;
    if (metaEl) metaEl.textContent = metricsText || "—";

    if (bodyEl) {
      if (!rows.length) {
        bodyEl.innerHTML = `<div class="perf-detail-empty">查無明細（可切換日期區間或到『業績明細』表格檢查）。</div>`;
      } else {
        const sample = rows.slice(0, 40);
        const itemsHtml = sample
          .map((r) => {
            const id = String(r["訂單編號"] || r["序"] || r["訂單"] || "");
            const bucket = String(r["拉牌"] || "");
            const svc = String(r["服務項目"] || "");
            const money = String(r["小計"] ?? r["業績金額"] ?? "");
            return `
              <div class="perf-detail-item">
                <div class="perf-detail-item-top">
                  <div class="perf-detail-item-id">${escapeHtml(id || "—")}</div>
                  <div class="perf-detail-item-badge" data-bucket="${escapeHtml(bucket)}">${escapeHtml(bucket || "—")}</div>
                  <div class="perf-detail-item-money">${escapeHtml(money)}</div>
                </div>
                <div class="perf-detail-item-svc">${escapeHtml(svc || "—")}</div>
              </div>
            `;
          })
          .join("");

        const moreHtml = rows.length > sample.length ? `<div class="perf-detail-more">還有 ${rows.length - sample.length} 筆，請查看下方『業績明細』表格。</div>` : "";
        bodyEl.innerHTML = `<div class="perf-detail-list">${itemsHtml}</div>${moreHtml}`;
      }
    }

    const isMobile = window.matchMedia ? window.matchMedia("(max-width: 640px)").matches : !!perfChartLastLayout_?.isNarrow;

    ui.overlayEl.classList.add("is-open");
    ui.overlayEl.setAttribute("aria-hidden", "false");
    ui.panelEl.classList.add("is-open");
    ui.panelEl.setAttribute("aria-hidden", "false");

    if (isMobile) {
      ui.panelEl.classList.add("is-sheet");
      ui.panelEl.classList.remove("is-popover");
      perfLockScroll_();
      ui.panelEl.removeAttribute("style");
    } else {
      ui.panelEl.classList.add("is-popover");
      ui.panelEl.classList.remove("is-sheet");
      perfUnlockScroll_();

      const x = Number(anchor?.x);
      const y = Number(anchor?.y);
      const hasXY = Number.isFinite(x) && Number.isFinite(y);
      const baseLeft = hasXY ? x + 12 : Math.round(window.innerWidth * 0.6);
      const baseTop = hasXY ? y + 12 : Math.round(window.innerHeight * 0.18);
      ui.panelEl.style.left = `${Math.round(baseLeft)}px`;
      ui.panelEl.style.top = `${Math.round(baseTop)}px`;

      requestAnimationFrame(() => {
        try {
          const rect = ui.panelEl.getBoundingClientRect();
          const pad = 10;
          let left = rect.left;
          let top = rect.top;
          if (rect.right > window.innerWidth - pad) left -= rect.right - (window.innerWidth - pad);
          if (rect.bottom > window.innerHeight - pad) top -= rect.bottom - (window.innerHeight - pad);
          if (left < pad) left = pad;
          if (top < pad) top = pad;
          ui.panelEl.style.left = `${Math.round(left)}px`;
          ui.panelEl.style.top = `${Math.round(top)}px`;
        } catch (_) {}
      });
    }

    try {
      if (ui.closeBtn && ui.closeBtn.focus) ui.closeBtn.focus();
    } catch (_) {}
  } catch (e) {
    console.error("perfOpenDetail_ error", e);
  }
}

function parseToTimestampMs_(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number" && Number.isFinite(v)) {
    // Heuristic: 10-digit seconds vs 13-digit ms
    if (v > 0 && v < 1e12) return Math.round(v * 1000);
    return Math.round(v);
  }

  const s = String(v).trim();
  if (!s) return NaN;

  // Pure numeric timestamp
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return NaN;
    if (n > 0 && n < 1e12) return Math.round(n * 1000);
    return Math.round(n);
  }

  // Prefer parsing timezone-less date strings ourselves (avoid Date.parse engine differences)
  // Supports: YYYY/MM/DD HH:mm(:ss) or YYYY-MM-DD HH:mm(:ss) or with 'T'
  const isPlainLocalLike =
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/.test(s) &&
    !/[zZ]$/.test(s) &&
    !/([+\-]\d{2}:?\d{2})$/.test(s);

  if (isPlainLocalLike) {
    const m = s.match(
      /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
    );
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const hour = Number(m[4] || 0);
      const minute = Number(m[5] || 0);
      const second = Number(m[6] || 0);
      if (![year, month, day, hour, minute, second].every((x) => Number.isFinite(x))) return NaN;

      // Treat as Asia/Taipei wall-clock time (UTC+8)
      return Date.UTC(year, month - 1, day, hour - 8, minute, second);
    }
  }

  // ISO / RFC / Date.parse-able (includes Z / offset)
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) return ms;

  // Last resort: looser fallback parse
  const m2 = s.match(
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2}))(?::(\d{1,2}))?)?/
  );
  if (!m2) return NaN;

  const year2 = Number(m2[1]);
  const month2 = Number(m2[2]);
  const day2 = Number(m2[3]);
  const hour2 = Number(m2[4] || 0);
  const minute2 = Number(m2[5] || 0);
  const second2 = Number(m2[6] || 0);
  if (![year2, month2, day2, hour2, minute2, second2].every((x) => Number.isFinite(x))) return NaN;

  return Date.UTC(year2, month2 - 1, day2, hour2 - 8, minute2, second2);
}

function fmtTaipeiDateTime_(input) {
  const ms = parseToTimestampMs_(input);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";

  if (PERF_DATETIME_FMT) {
    // zh-TW sometimes includes comma in some engines; normalize to a space
    return PERF_DATETIME_FMT.format(d).replace(/,\s*/g, " ").trim();
  }

  // Fallback (still local time; best-effort)
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* =========================
 * ✅ Robust parsing
 * ========================= */

function parseQty_(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;

  let s = String(v).trim();
  if (!s) return 0;

  // 全形轉半形（０-９．－）
  s = s
    .replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xff10))
    .replace(/．/g, ".")
    .replace(/－/g, "-");

  // 若只有逗號小數：1,5 -> 1.5
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");

  // 移除雜字（例如 "1.5節"）
  s = s.replace(/[^\d.\-]/g, "");

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseMoney_(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim().replace(/[^\d.\-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/* =========================
 * UserId resolve
 * ========================= */

function getUserId_() {
  // ✅ 依序嘗試：state / localStorage / query
  const candidates = [
    state?.user?.userId,
    state?.userId,
    state?.auth?.userId,
    state?.profile?.userId,
    (() => {
      try {
        return localStorage.getItem("userId") || localStorage.getItem("lineUserId") || "";
      } catch (_) {
        return "";
      }
    })(),
    (() => {
      try {
        return (typeof getQueryParam === "function" && (getQueryParam("userId") || getQueryParam("lineUserId"))) || "";
      } catch (_) {
        return "";
      }
    })(),
  ];

  for (const v of candidates) {
    const s = String(v || "").trim();
    if (s) return s;
  }
  return "";
}

/* =========================
 * Dates / range
 * ========================= */

function pad2_(n) {
  return String(n).padStart(2, "0");
}

function normalizeInputDateKey_(s) {
  const v = String(s || "").trim();
  if (!v) return "";
  const m = v.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!m) return "";
  return `${m[1]}-${pad2_(m[2])}-${pad2_(m[3])}`;
}

function localDateKeyToday_() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}
function localDateKeyMonthStart_() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function ensureDefaultDate_() {
  const today = localDateKeyToday_();
  const monthStart = localDateKeyMonthStart_();

  if (dom.perfDateStartInput && !dom.perfDateStartInput.value) dom.perfDateStartInput.value = monthStart;
  if (dom.perfDateEndInput && !dom.perfDateEndInput.value) dom.perfDateEndInput.value = today;

  if (dom.perfDateKeyInput && !dom.perfDateKeyInput.value) dom.perfDateKeyInput.value = today;
}

function parseDateKey_(key) {
  const v = String(key || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return { key: v, date: d };
}

function toDateKey_(d) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function normalizeRange_(startKey, endKey, maxDays) {
  const a = parseDateKey_(startKey);
  const b = parseDateKey_(endKey);
  if (!a || !b) return { ok: false, error: "BAD_DATE" };

  let start = a.date;
  let end = b.date;
  if (end.getTime() < start.getTime()) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  const out = [];
  const limit = Number(maxDays) > 0 ? Number(maxDays) : PERF_MAX_RANGE_DAYS;
  for (let i = 0; i < limit; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    if (d.getTime() > end.getTime()) break;
    out.push(toDateKey_(d));
  }

  if (out.length && out[out.length - 1] !== toDateKey_(end)) {
    return { ok: false, error: "RANGE_TOO_LONG", days: out.length };
  }

  return { ok: true, normalizedStart: toDateKey_(start), normalizedEnd: toDateKey_(end), dateKeys: out };
}

function readRangeFromInputs_() {
  const userId = getUserId_();

  const startRaw = String(dom.perfDateStartInput?.value || "").trim();
  const endRaw = String(dom.perfDateEndInput?.value || "").trim();

  const startKey = normalizeInputDateKey_(startRaw);
  const endKey = normalizeInputDateKey_(endRaw || startRaw);

  if (!userId) return { ok: false, error: "MISSING_USERID", userId: "", startKey, endKey };
  if (!startKey) return { ok: false, error: "MISSING_START", userId, startKey, endKey };

  const range = normalizeRange_(startKey, endKey, PERF_MAX_RANGE_DAYS);
  if (!range.ok) return { ok: false, error: range.error || "BAD_RANGE", userId, startKey, endKey };

  if (dom.perfDateStartInput && dom.perfDateStartInput.value !== range.normalizedStart) dom.perfDateStartInput.value = range.normalizedStart;
  if (dom.perfDateEndInput && dom.perfDateEndInput.value !== range.normalizedEnd) dom.perfDateEndInput.value = range.normalizedEnd;

  return { ok: true, userId, from: range.normalizedStart, to: range.normalizedEnd, dateKeys: range.dateKeys };
}

/* =========================
 * DOM helpers
 * ========================= */

function setBadge_(text, isError) {
  if (!dom.perfStatusEl) return;
  dom.perfStatusEl.textContent = String(text || "");
  dom.perfStatusEl.style.borderColor = isError ? "rgba(249, 115, 115, 0.65)" : "";
}
function setMeta_(text) {
  if (dom.perfMetaEl) dom.perfMetaEl.textContent = String(text || "—");
}
function showError_(show) {
  if (dom.perfErrorEl) dom.perfErrorEl.style.display = show ? "block" : "none";
}
function showEmpty_(show) {
  if (dom.perfEmptyEl) dom.perfEmptyEl.style.display = show ? "block" : "none";
}
function setDetailCount_(n) {
  if (dom.perfDetailCountEl) dom.perfDetailCountEl.textContent = `${Number(n) || 0} 筆`;
}

function renderDetailHeader_(mode) {
  if (!dom.perfDetailHeadRowEl) return;

  if (mode === "detail") {
    dom.perfDetailHeadRowEl.innerHTML =
      "<th>訂單日期</th><th>訂單編號</th><th>序</th><th>拉牌</th><th>服務項目</th>" +
      "<th>業績金額</th><th>抽成金額</th><th>數量</th><th>小計</th><th>分鐘</th>" +
      "<th>開工</th><th>完工</th><th>狀態</th>";
    return;
  }

  // ✅ 統計頁：節 = 數量（欄名仍叫節數）
  dom.perfDetailHeadRowEl.innerHTML =
    "<th>服務項目</th><th>總筆數</th><th>總節數</th><th>總計金額</th>" +
    "<th>老點筆數</th><th>老點節數</th><th>老點金額</th>" +
    "<th>排班筆數</th><th>排班節數</th><th>排班金額</th>";
}

/* =========================
 * HTML builders
 * ========================= */

function summaryNotLoadedHtml_() {
  return '<tr><td colspan="5" style="color:var(--text-sub);">尚未載入（請按手動重整）</td></tr>';
}

function summaryRowsHtml_(cards3) {
  if (!cards3) return '<tr><td colspan="5" style="color:var(--text-sub);">查無總覽資料。</td></tr>';

  const td = (v) => `<td>${escapeHtml(String(v ?? ""))}</td>`;
  const rows = [
    { label: "排班", card: cards3["排班"] || {} },
    { label: "老點", card: cards3["老點"] || {} },
    { label: "總計", card: cards3["總計"] || {} },
  ];

  return rows
    .map(
      ({ label, card }) =>
        `<tr>
          ${td(label)}
          ${td(card.單數 ?? 0)}
          ${td(card.筆數 ?? 0)}
          ${td(card.數量 ?? 0)}
          ${td(card.金額 ?? 0)}
        </tr>`
    )
    .join("");
}


function detailRowsHtml_(detailRows) {
  const list = Array.isArray(detailRows) ? detailRows : [];
  if (!list.length) return { html: "", count: 0 };
  const td = (v) => `<td>${escapeHtml(String(v ?? ""))}</td>`;
  return {
    count: list.length,
    html: list
      .map(
        (r) =>
          "<tr>" +
          td(String(r["訂單日期"] ?? "").replaceAll("-", "/")) +
          td(r["訂單編號"] || "") +
          td(r["序"] ?? "") +
          td(r["拉牌"] || "") +
          td(r["服務項目"] || "") +
          td(r["業績金額"] ?? 0) +
          td(r["抽成金額"] ?? 0) +
          td(r["數量"] ?? 0) +
          td(r["小計"] ?? 0) +
          td(r["分鐘"] ?? 0) +
          td(r["開工"] ?? "") +
          td(r["完工"] ?? "") +
          td(r["狀態"] || "") +
          "</tr>"
      )
      .join(""),
  };
}

function detailSummaryRowsHtml_(serviceSummaryRows) {
  const list = Array.isArray(serviceSummaryRows) ? serviceSummaryRows : [];
  if (!list.length) return { html: "", count: 0 };
  const headers = [
    "服務項目",
    "總筆數",
    "總節數",
    "總計金額",
    "老點筆數",
    "老點節數",
    "老點金額",
    "排班筆數",
    "排班節數",
    "排班金額",
  ];

  const td = (v) => `<td>${escapeHtml(String(v ?? ""))}</td>`;
  return {
    count: list.length,
    html: list
      .map((r) => "<tr>" + headers.map((h) => td(r[h] ?? 0)).join("") + "</tr>")
      .join(""),
  };
}

function applyDetailTableHtml_(html, count) {
  if (!dom.perfDetailRowsEl) return;
  setDetailCount_(count);
  if (!count) {
    dom.perfDetailRowsEl.innerHTML = "";
    showEmpty_(true);
    return;
  }
  showEmpty_(false);
  dom.perfDetailRowsEl.innerHTML = html;
}

/* =========================
 * Cards compute (fallback)
 * ========================= */

function buildCards3FromRows_(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const init = () => ({ 單數: 0, 筆數: 0, 數量: 0, 金額: 0, _orders: new Set() });

  const cards = {
    排班: init(),
    老點: init(),
    總計: init(),
  };

  function bucket_(r) {
    const b = String((r && r["拉牌"]) || "").trim();
    if (b === "老點") return "老點";
    return "排班"; // 女師傅/男師傅/其他 → 三卡視角都算排班
  }

  for (const r of list) {
    const orderNo = String(r["訂單編號"] || "").trim();
    const qty = PERF_CARD_QTY_MODE === "minutes" ? Number(r["分鐘"] ?? 0) || 0 : parseQty_(r["數量"]);
    const amount = parseMoney_(r["小計"] ?? r["業績金額"]);

    const b = bucket_(r);

    cards.總計.筆數 += 1;
    cards.總計.數量 += qty;
    cards.總計.金額 += amount;
    if (orderNo) cards.總計._orders.add(orderNo);

    cards[b].筆數 += 1;
    cards[b].數量 += qty;
    cards[b].金額 += amount;
    if (orderNo) cards[b]._orders.add(orderNo);
  }

  for (const k of ["排班", "老點", "總計"]) {
    cards[k].單數 = cards[k]._orders.size;
    delete cards[k]._orders;
  }
  return cards;
}

function pickCards3_(gasCards, rows) {
  // ✅ 若 GAS 有 cards：三卡的「排班」= 排班 + 女師傅 + 男師傅 + 其他
  if (gasCards && typeof gasCards === "object") {
    const hasAny =
      !!(gasCards["排班"] || gasCards["老點"] || gasCards["總計"] || gasCards["女師傅"] || gasCards["男師傅"] || gasCards["其他"]);

    if (hasAny) {
      const z = (o) => ({
        單數: Number(o?.單數 || 0) || 0,
        筆數: Number(o?.筆數 || 0) || 0,
        數量: Number(o?.數量 || 0) || 0,
        金額: Number(o?.金額 || 0) || 0,
      });

      const sched = z(gasCards["排班"]);
      const female = z(gasCards["女師傅"]);
      const male = z(gasCards["男師傅"]);
      const other = z(gasCards["其他"]);

      const mergedSched = {
        單數: sched.單數 + female.單數 + male.單數 + other.單數,
        筆數: sched.筆數 + female.筆數 + male.筆數 + other.筆數,
        數量: sched.數量 + female.數量 + male.數量 + other.數量,
        金額: sched.金額 + female.金額 + male.金額 + other.金額,
      };

      return {
        排班: mergedSched,
        老點: gasCards["老點"] || { 單數: 0, 筆數: 0, 數量: 0, 金額: 0 },
        總計: gasCards["總計"] || { 單數: 0, 筆數: 0, 數量: 0, 金額: 0 },
      };
    }
  }

  // fallback：用 rows 自算（三卡視角女/男/其他也算排班）
  return buildCards3FromRows_(rows);
}


/* =========================
 * Chart
 * ========================= */

let perfChartMode_ = "daily"; // "daily" | "cumu" | "ma7"
let perfChartVis_ = { amount: true, oldRate: true, schedRate: true };
let perfChartType_ = "line"; // "line" | "bar"

function loadPerfChartPrefs_() {
  try {
    const s = localStorage.getItem(PERF_CHART_VIS_KEY);
    if (s) {
      const obj = JSON.parse(s);
      perfChartVis_ = {
        amount: obj.amount !== false,
        oldRate: obj.oldRate !== false,
        schedRate: obj.schedRate !== false,
      };
    }
  } catch (_) {}
  try {
    const m = String(localStorage.getItem(PERF_CHART_MODE_KEY) || "").trim();
    if (m === "daily" || m === "cumu" || m === "ma7") perfChartMode_ = m;
  } catch (_) {}
  try {
    const t = String(localStorage.getItem(PERF_CHART_VIS_KEY + "_type") || "").trim();
    if (t === "line" || t === "bar") perfChartType_ = t;
  } catch (_) {}
}

function savePerfChartPrefs_() {
  try {
    localStorage.setItem(PERF_CHART_VIS_KEY, JSON.stringify(perfChartVis_));
  } catch (_) {}
  try {
    localStorage.setItem(PERF_CHART_MODE_KEY, String(perfChartMode_ || "daily"));
  } catch (_) {}
  try {
    localStorage.setItem(PERF_CHART_VIS_KEY + "_type", String(perfChartType_ || "line"));
  } catch (_) {}
}

function buildCumulative_(arr) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += Number(arr[i] || 0) || 0;
    out.push(sum);
  }
  return out;
}

function buildMA_(arr, win) {
  const w = Math.max(2, Number(win) || 7);
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    let s = 0,
      c = 0;
    for (let j = Math.max(0, i - w + 1); j <= i; j++) {
      s += Number(arr[j] || 0) || 0;
      c++;
    }
    out.push(c ? s / c : 0);
  }
  return out;
}

function applyChartVisibility_() {
  if (!perfChartInstance_) return;
  const ds = perfChartInstance_.data?.datasets || [];
  if (ds[0]) ds[0].hidden = !perfChartVis_.amount;
  if (ds[1]) ds[1].hidden = !perfChartVis_.oldRate;
  if (ds[2]) ds[2].hidden = !perfChartVis_.schedRate;

  if (!perfChartVis_.amount && !perfChartVis_.oldRate && !perfChartVis_.schedRate) {
    perfChartVis_.amount = true;
    if (ds[0]) ds[0].hidden = false;
  }
  try {
    perfChartInstance_.update("none");
  } catch (_) {}
}

function clearPerfChart_() {
  try {
    if (perfChartInstance_) {
      try {
        perfChartInstance_.destroy();
      } catch (_) {}
      perfChartInstance_ = null;
    }
    if (dom.perfChartEl && dom.perfChartEl.getContext) {
      const ctx = dom.perfChartEl.getContext("2d");
      try {
        ctx.clearRect(0, 0, dom.perfChartEl.width || 0, dom.perfChartEl.height || 0);
      } catch (_) {}
    }
  } catch (e) {
    console.error("clearPerfChart_ error", e);
  }
}

function schedulePerfChartRedraw_() {
  if (perfChartResizeTimer_) clearTimeout(perfChartResizeTimer_);
  perfChartResizeTimer_ = setTimeout(() => {
    try {
      if (perfChartLastRows_) {
        Promise.resolve(updatePerfChart_(perfChartLastRows_, perfChartLastDateKeys_)).catch((e) => {
          console.error("perf chart redraw error", e);
        });
      }
    } catch (e) {
      console.error("perf chart redraw error", e);
    }
  }, 140);
}

/**
 * ✅ Drag-to-scroll（修正 Intervention warning）
 * - 只在 ev.cancelable 時才 preventDefault
 */
function enableCanvasDragScroll_(enable) {
  try {
    const canvas = dom.perfChartEl;
    if (!canvas) return;
    const wrapper = canvas.closest && canvas.closest(".chart-wrapper") ? canvas.closest(".chart-wrapper") : canvas.parentElement;

    if (perfDragState_.handlers && canvas) {
      const h = perfDragState_.handlers;
      try {
        canvas.removeEventListener("pointerdown", h.down);
      } catch (_) {}
      try {
        canvas.removeEventListener("pointermove", h.move);
      } catch (_) {}
      try {
        window.removeEventListener("pointerup", h.up);
      } catch (_) {}
      try {
        canvas.removeEventListener("touchstart", h.tdown);
      } catch (_) {}
      try {
        canvas.removeEventListener("touchmove", h.tmove);
      } catch (_) {}
      try {
        window.removeEventListener("touchend", h.tup);
      } catch (_) {}
      perfDragState_.handlers = null;
    }

    // On touch devices, prefer native overflow scrolling.
    // Custom touchmove handlers (even cancelable) can cause noticeable jank.
    const allowCustomDrag = !!enable && !isTouchLike_();

    if (!allowCustomDrag) {
      perfDragState_.enabled = false;
      return;
    }

    let rafId = 0;
    let pendingScrollLeft = null;
    const flushScroll = () => {
      rafId = 0;
      if (pendingScrollLeft === null) return;
      try {
        if (wrapper) wrapper.scrollLeft = pendingScrollLeft;
      } catch (_) {}
      pendingScrollLeft = null;
    };
    const scheduleScroll = (nextLeft) => {
      pendingScrollLeft = nextLeft;
      if (rafId) return;
      rafId = requestAnimationFrame(flushScroll);
    };

    const onPointerDown = (ev) => {
      try {
        // Only enable drag-to-scroll for mouse. Touch/pen should use native scroll.
        if (ev && ev.pointerType && ev.pointerType !== "mouse") return;
        perfDragState_.pointerDown = true;
        perfDragState_.dragging = false;
        perfDragState_.startX = ev.clientX || (ev.touches && ev.touches[0] && ev.touches[0].clientX) || 0;
        perfDragState_.startY = ev.clientY || (ev.touches && ev.touches[0] && ev.touches[0].clientY) || 0;
        perfDragState_.startScrollLeft = wrapper ? wrapper.scrollLeft : 0;
        if (ev.pointerId && canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId);
      } catch (_) {}
    };

    const onPointerMove = (ev) => {
      if (!perfDragState_.pointerDown) return;
      try {
        if (ev && ev.pointerType && ev.pointerType !== "mouse") return;
        const clientX = ev.clientX || (ev.touches && ev.touches[0] && ev.touches[0].clientX) || 0;
        const clientY = ev.clientY || (ev.touches && ev.touches[0] && ev.touches[0].clientY) || 0;
        const dx = clientX - perfDragState_.startX;
        const dy = clientY - perfDragState_.startY;

        // 門檻：避免輕觸就觸發拖曳，導致點擊命中錯誤
        if (!perfDragState_.dragging) {
          const adx = Math.abs(dx);
          const ady = Math.abs(dy);
          if (adx >= 8 && adx > ady) perfDragState_.dragging = true;
          else return;
        }
        if (wrapper) scheduleScroll(Math.round(perfDragState_.startScrollLeft - dx));
      } catch (_) {}
    };

    const onPointerUp = (ev) => {
      const wasDragging = !!perfDragState_.dragging;
      perfDragState_.pointerDown = false;
      perfDragState_.dragging = false;
      if (wasDragging) perfDragState_.suppressClickUntil = Date.now() + 260;
      try {
        if (ev.pointerId && canvas.releasePointerCapture) canvas.releasePointerCapture(ev.pointerId);
      } catch (_) {}

      try {
        if (rafId) cancelAnimationFrame(rafId);
      } catch (_) {}
      rafId = 0;
      pendingScrollLeft = null;
    };

    canvas.addEventListener("pointerdown", onPointerDown, { passive: true });
    canvas.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });

    perfDragState_.handlers = { down: onPointerDown, move: onPointerMove, up: onPointerUp, tdown: null, tmove: null, tup: null };
    perfDragState_.enabled = true;
  } catch (err) {
    console.error("enableCanvasDragScroll_ error", err);
  }
}

async function updatePerfChart_(rows, dateKeys) {
  try {
    if (!dom.perfChartEl) return;

    if (perfChartsDisabled_) {
      try {
        if (dom.perfChartEl) dom.perfChartEl.style.display = "none";
        if (dom.perfChartHintEl) dom.perfChartHintEl.textContent = "圖表功能已停用。";
      } catch (_) {}
      return;
    }

    // If config disables charts, show hint and skip rendering
    try {
      const chartsEnabled = !(config && (config.ENABLE_PERF_CHARTS === false || String(config.ENABLE_PERF_CHARTS).toLowerCase() === "false"));
      if (!chartsEnabled) {
        try {
          if (dom.perfChartEl) dom.perfChartEl.style.display = "none";
          if (dom.perfChartHintEl) dom.perfChartHintEl.textContent = "圖表功能已停用。";
        } catch (_) {}
        return;
      }
    } catch (_) {}

    try {
      const ok = await ensureChartJs_();
      if (!ok) {
        if (dom.perfChartHintEl) dom.perfChartHintEl.textContent = "圖表無法載入。";
        return;
      }
    } catch (e) {
      console.error("[Perf] Chart.js load failed:", e);
      return;
    }

    // ensure canvas visible when charts enabled
    try {
      if (dom.perfChartEl) dom.perfChartEl.style.display = "";
    } catch (_) {}

    const keys = Array.isArray(dateKeys) && dateKeys.length ? dateKeys.slice() : [];
    const list = Array.isArray(rows) ? rows : [];

    // metrics per date
    const metrics = {}; // { dateKey: { amount, totalCount, oldCount, schedCount } }

    // ✅ 修正：圖表桶判斷只吃「拉牌」欄（避免服務項目誤判）
    function bucketOfRow(r) {
      const v = String((r && r["拉牌"]) || "").trim();
      return v === "老點" ? "老點" : "排班";
    }

    function orderDateKey_(v) {
      const s = String(v ?? "").trim();
      if (!s) return "";
      const m = s.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
      if (m) return `${m[1]}-${pad2_(m[2])}-${pad2_(m[3])}`;
      return "";
    }

    for (const r of list) {
      const dkey = orderDateKey_(r["訂單日期"] || "");
      if (!dkey) continue;

      if (!metrics[dkey]) metrics[dkey] = { amount: 0, totalCount: 0, oldCount: 0, schedCount: 0 };

      const m = metrics[dkey];
      const amt = parseMoney_(r["小計"] ?? r["業績金額"] ?? 0);
      m.amount += amt;
      m.totalCount += 1;

      const b = bucketOfRow(r);
      if (b === "老點") m.oldCount += 1;
      else m.schedCount += 1;
    }

    const labels = (keys.length ? keys.slice() : Object.keys(metrics).sort()).map((s) => s);

    const dailyAmount = labels.map((k) => (metrics[k] ? metrics[k].amount : 0));
    const oldRateData = labels.map((k) => {
      const m = metrics[k];
      return m && m.totalCount ? Math.round((m.oldCount / m.totalCount) * 1000) / 10 : 0;
    });
    const schedRateData = labels.map((k) => {
      const m = metrics[k];
      return m && m.totalCount ? Math.round((m.schedCount / m.totalCount) * 1000) / 10 : 0;
    });

    let amountData = dailyAmount;
    let amountLabel = "業績";
    let amountAsLine = false;
    if (perfChartMode_ === "cumu") {
      amountData = buildCumulative_(dailyAmount);
      amountLabel = "累積業績";
      amountAsLine = true;
    } else if (perfChartMode_ === "ma7") {
      amountData = buildMA_(dailyAmount, 7);
      amountLabel = "7日均線";
      amountAsLine = true;
    }

    if (perfChartInstance_) {
      try {
        perfChartInstance_.destroy();
      } catch (_) {}
      perfChartInstance_ = null;
    }

    const ctx = dom.perfChartEl.getContext("2d");
    perfChartLastRows_ = list.slice();
    perfChartLastDateKeys_ = Array.isArray(dateKeys) ? dateKeys.slice() : [];

    const wrapperEl = dom.perfChartEl?.closest?.(".chart-wrapper") || dom.perfChartEl?.parentElement;
    const containerWidth = (wrapperEl && wrapperEl.clientWidth) || window.innerWidth || 800;

    const points = labels.length || 1;
    const isNarrow = containerWidth < 420;
    const shouldScroll = points > (isNarrow ? 4 : 6);

    perfChartLastLayout_ = { isNarrow: !!isNarrow, shouldScroll: !!shouldScroll, points };

    if (dom.perfChartHintEl) {
      dom.perfChartHintEl.textContent = shouldScroll
        ? "提示：可左右拖曳圖表，點選日期可看當日明細。"
        : "提示：點選日期可看當日明細。";
    }

    const pxPerPoint = isNarrow ? 64 : 72;
    const desiredWidth = shouldScroll ? Math.max(containerWidth, points * pxPerPoint) : containerWidth;
    const desiredHeight = isNarrow ? 190 : Math.max(200, Math.round(Math.min(320, desiredWidth / 3.2)));

      // 根據容器寬度動態計算字型大小，讓文字在手機/平板/桌面間自適應
      const baseFontRaw = isNarrow ? 13 : 15;
      const ticksFontRaw = isNarrow ? 12 : 14;
      // scale factor: 1 at 420px, grows on wider screens but capped to avoid excessively large text
      const scaleFactor = Math.max(0.9, Math.min(1.6, containerWidth / 420));
      const baseFont = Math.round(baseFontRaw * scaleFactor);
      const ticksFont = Math.round(ticksFontRaw * scaleFactor);
      const legendBoxWidth = Math.max(8, Math.round(8 * Math.min(1.4, scaleFactor)));
      const css = window.getComputedStyle ? window.getComputedStyle(document.documentElement) : null;
      const textColor = (() => {
        const v = (css && (css.getPropertyValue("--text-main") || css.getPropertyValue("--text")))
          ? (css.getPropertyValue("--text-main") || css.getPropertyValue("--text")).trim()
          : "";
        return v || "#111827";
      })();
      const subColorRaw = (css && css.getPropertyValue("--text-sub")) ? css.getPropertyValue("--text-sub").trim() : "#6b7280";
      const gridColor = (() => {
        try {
          if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(subColorRaw)) {
            const hex = subColorRaw.replace("#", "");
            const r = parseInt(hex.length === 3 ? hex[0] + hex[0] : hex.substring(0, 2), 16);
            const g = parseInt(hex.length === 3 ? hex[1] + hex[1] : hex.substring(2, 4), 16);
            const b = parseInt(hex.length === 3 ? hex[2] + hex[2] : hex.substring(4, 6), 16);
            return `rgba(${r},${g},${b},0.10)`;
          }
        } catch (_) {}
        return `${subColorRaw}33`;
      })();

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    // 重要：Canvas 事件座標計算依賴 DOM/CSS 尺寸一致。
    // 讓 Chart.js 自己做 retina scaling，不在這裡手動乘 DPR/ctx.setTransform。
    dom.perfChartEl.style.width = shouldScroll ? `${Math.round(desiredWidth)}px` : "100%";
    dom.perfChartEl.style.height = `${desiredHeight}px`;
    dom.perfChartEl.width = Math.round(shouldScroll ? desiredWidth : containerWidth);
    dom.perfChartEl.height = Math.round(desiredHeight);

    enableCanvasDragScroll_(shouldScroll);

    const maxXTicks = isNarrow ? 5 : 7;

    try {
      if (shouldScroll) {
        const minW = Math.max(containerWidth, labels.length * 48);
        dom.perfChartEl.style.minWidth = `${Math.round(minW)}px`;
      } else {
        dom.perfChartEl.style.minWidth = "";
      }
    } catch (_) {}

    // helper: open admin-style detail panel when user clicks a data point
    function showClickDetailPanel(idx) {
      try {
        const rawKey = labels[idx];
        const m = rawKey ? metrics[rawKey] : null;
        const dateLabel = rawKey ? String(rawKey).replaceAll("-", "/") : "—";

        const rowsForDate = list.filter((r) => {
          const dk = String(r['訂單日期'] || '').replaceAll('/', '-').slice(0, 10);
          return dk === rawKey;
        });

        const amount = m ? fmtMoney_(m.amount) : "0";
        const total = m ? (m.totalCount || 0) : 0;
        const oldC = m ? (m.oldCount || 0) : 0;
        const schC = m ? (m.schedCount || 0) : 0;

        const metricsText = `金額 ${amount}｜筆數 ${total}（老點 ${oldC} / 排班 ${schC}）`;

        perfOpenDetail_({
          dateLabel,
          metricsText,
          rows: rowsForDate,
          anchor: perfLastClickPos_,
        });
      } catch (e) {
        console.error("showClickDetailPanel error", e);
      }
    }

    // track last click position for desktop popover placement
    let perfLastClickPos_ = null;

    const touchLike = isTouchLike_();

    perfChartInstance_ = new Chart(ctx, {
      data: {
        labels: labels.map((s) => String(s).replaceAll("-", "/")),
        datasets: [
          (function(){
            const common = {
              label: amountLabel,
              data: amountData,
              yAxisID: "y",
            };
            if (perfChartType_ === 'bar') {
              return Object.assign({}, common, {
                type: 'bar',
                backgroundColor: 'rgba(6,182,212,0.16)',
                borderColor: '#06b6d4',
                borderWidth: 1,
                barThickness: 'flex',
                maxBarThickness: 48,
                categoryPercentage: 0.75,
                barPercentage: 0.9,
              });
            }
            return Object.assign({}, common, {
              type: 'line',
              borderWidth: Math.max(2, Math.round(2 * Math.min(1.6, Math.max(1, legendBoxWidth/8)))),
              tension: 0.25,
              fill: true,
              backgroundColor: 'rgba(6,182,212,0.12)',
              borderColor: '#06b6d4',
              pointRadius: 0,
              pointHitRadius: 10,
            });
          })(),
          (function(){
            const common = {
              data: oldRateData,
              label: "老點率 (%)",
              yAxisID: "y1",
            };
            if (perfChartType_ === 'bar') {
              return Object.assign({}, common, {
                type: 'bar',
                backgroundColor: '#f59e0b66',
                borderColor: '#f59e0b',
                borderWidth: 1,
                maxBarThickness: 36,
                barPercentage: 0.48,
                categoryPercentage: 0.6,
              });
            }
            return Object.assign({}, common, {
              type: 'line',
              tension: 0.25,
              fill: false,
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245,158,11,0.06)',
              pointRadius: isNarrow ? 0 : 2,
              pointHitRadius: 10,
            });
          })(),
          (function(){
            const common = {
              data: schedRateData,
              label: "排班率 (%)",
              yAxisID: "y1",
            };
            if (perfChartType_ === 'bar') {
              return Object.assign({}, common, {
                type: 'bar',
                backgroundColor: '#10b98166',
                borderColor: '#10b981',
                borderWidth: 1,
                maxBarThickness: 36,
                barPercentage: 0.48,
                categoryPercentage: 0.6,
              });
            }
            return Object.assign({}, common, {
              type: 'line',
              tension: 0.25,
              fill: false,
              borderColor: '#10b981',
              backgroundColor: 'rgba(16,185,129,0.06)',
              pointRadius: isNarrow ? 0 : 2,
              pointHitRadius: 10,
            });
          })(),
        ],
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        animation: false,
        normalized: true,
        devicePixelRatio: dpr,
        ...(touchLike ? { events: ["click"] } : {}),
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 6, right: 10, bottom: 4, left: 6 } },
        plugins: {
          legend: {
            position: isNarrow ? "bottom" : "top",
            labels: {
              usePointStyle: true,
              boxWidth: legendBoxWidth,
              font: { size: baseFont },
              padding: isNarrow ? 10 : 14,
              color: textColor,
            },
          },
          tooltip: {
            bodyFont: { size: ticksFont },
            titleFont: { size: baseFont },
            callbacks: {
              title: (items) => `日期：${items?.[0]?.label || ""}`,
              label: (ctx2) => {
                const label = ctx2.dataset?.label || "";
                const v = ctx2.parsed?.y;
                const idx = ctx2.dataIndex;
                const rawKey = labels[idx];
                const m = rawKey ? metrics[rawKey] : null;

                if (ctx2.dataset?.yAxisID === "y") {
                  const amt = fmtCurrencyFull_(v);
                  const total = m?.totalCount || 0;
                  const oldC = m?.oldCount || 0;
                  const schC = m?.schedCount || 0;
                  return [`${label}：${amt}`, `筆數：${total}（老點 ${oldC} / 排班 ${schC}）`];
                }
                const pv = Number(v ?? 0) || 0;
                return `${label}：${Math.round(pv * 10) / 10}%`;
              },
            },
          },
        },
        onClick: function (evt, activeEls) {
          try {
            if (perfDragState_ && perfDragState_.suppressClickUntil && Date.now() < perfDragState_.suppressClickUntil) return;

            try {
              const n = evt && (evt.native || evt.event || evt);
              const x = n && typeof n.x === "number" ? n.x : n && typeof n.clientX === "number" ? n.clientX : null;
              const y = n && typeof n.y === "number" ? n.y : n && typeof n.clientY === "number" ? n.clientY : null;
              if (typeof x === "number" && typeof y === "number") perfLastClickPos_ = { x, y };
              else perfLastClickPos_ = null;
            } catch (_) {
              perfLastClickPos_ = null;
            }

            if (!Array.isArray(activeEls) || !activeEls.length) return;
            const el = activeEls[0];
            const idx = el.index != null ? el.index : el._index;
            if (typeof idx === "number") showClickDetailPanel(idx);
          } catch (e) {
            console.warn("chart onClick error", e);
          }
        },
        scales: {
          x: {
            ticks: {
              autoSkip: true,
              maxTicksLimit: maxXTicks,
              maxRotation: 0,
              color: subColorRaw,
              font: { size: ticksFont },
              callback: function (val, idx) {
                try {
                  const raw = this.getLabelForValue(val) || this.chart.data.labels[idx];
                  const d = new Date(String(raw).replace(/\//g, "-"));
                  if (isNaN(d.getTime())) return String(raw);
                  return `${pad2_(d.getMonth() + 1)}-${pad2_(d.getDate())}`;
                } catch (e) {
                  return String(val);
                }
              },
            },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { color: subColorRaw, font: { size: ticksFont }, callback: (vv) => fmtCurrencyTick_(vv) },
            title: { display: !isNarrow, text: "金額", font: { size: baseFont } },
            grid: { color: gridColor },
          },
          y1: {
            position: "right",
            beginAtZero: true,
            max: 100,
            ticks: { color: subColorRaw, font: { size: ticksFont }, callback: (vv) => `${vv}%` },
            grid: { drawOnChartArea: false },
            title: { display: !isNarrow, text: "比率 (%)", font: { size: baseFont } },
          },
        },
      },
    });

    applyChartVisibility_();
  } catch (e) {
    console.error("updatePerfChart_ error", e);
  }
}

/* =========================
 * Fetch (POST syncStorePerf_v1)
 * ========================= */

async function fetchPerfSync_(userId, from, to, includeDetail = true) {
  if (!config.PERF_SYNC_API_URL) throw new Error("CONFIG_PERF_SYNC_API_URL_MISSING");

  const url = withQuery(config.PERF_SYNC_API_URL, `_ts=${encodeURIComponent(String(Date.now()))}`);

  const payload = {
    mode: "syncStorePerf_v1",
    userId,
    from,
    to,
    includeDetail: !!includeDetail,
  };

  const resp = await fetchFormPostWithTimeout_(url, payload, PERF_FETCH_TIMEOUT_MS, "PERF_SYNC");
  return resp;
}

/**
 * ✅ 最重要修正：真正送 x-www-form-urlencoded（避免 header/body 不一致）
 */
async function fetchFormPostWithTimeout_(url, bodyObj, timeoutMs, tag) {
  const ms = Number(timeoutMs);
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : PERF_FETCH_TIMEOUT_MS;

  const form = new URLSearchParams();
  Object.keys(bodyObj || {}).forEach((k) => {
    const v = bodyObj[k];
    if (v === undefined || v === null) return;
    form.set(k, typeof v === "boolean" ? (v ? "true" : "false") : String(v));
  });

  if (typeof AbortController === "undefined") {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      cache: "no-store",
    });
    if (!resp.ok) throw new Error(`${tag}_HTTP_${resp.status}`);
    return await resp.json();
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), safeMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`${tag}_HTTP_${resp.status}`);
    return await resp.json();
  } catch (e) {
    if (e && (e.name === "AbortError" || String(e).includes("AbortError"))) throw new Error(`${tag}_TIMEOUT`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* =========================
 * Cache + render
 * ========================= */

function makeCacheKey_(userId, from, to) {
  return `${String(userId || "").trim()}|${String(from || "").trim()}|${String(to || "").trim()}`;
}

function renderSummaryTable_(cards3) {
  if (!dom.perfSummaryRowsEl) return;
  dom.perfSummaryRowsEl.innerHTML = summaryRowsHtml_(cards3);
  const tbl = dom.perfSummaryRowsEl?.closest("table");
  if (tbl) tbl.classList.add("perf-summary-table");
}

function renderDetailTable_(rows) {
  renderDetailHeader_("detail");
  const tmp = detailRowsHtml_(rows);
  applyDetailTableHtml_(tmp.html, tmp.count);
}

function renderServiceSummaryTable_(serviceSummary, baseRowsForChart, dateKeys, opts) {
  renderDetailHeader_("summary");
  const tmp = detailSummaryRowsHtml_(serviceSummary);
  applyDetailTableHtml_(tmp.html, tmp.count);

  if (Array.isArray(baseRowsForChart) && baseRowsForChart.length) {
    try {
      const p = updatePerfChart_(baseRowsForChart, dateKeys);
      if (opts && opts.awaitChart) return p;
      Promise.resolve(p).catch(() => {});
    } catch (_) {
      // ignore
    }
  } else {
    clearPerfChart_();
  }

  return null;
}

function computeMonthRates_(rows) {
  const cards3 = buildCards3FromRows_(rows);
  const totalRows = Number(cards3?.總計?.筆數 || 0) || 0;
  const oldRows = Number(cards3?.老點?.筆數 || 0) || 0;
  const schedRows = Number(cards3?.排班?.筆數 || 0) || 0;

  const totalSingles = Number(cards3?.總計?.單數 || 0) || 0;
  const oldSingles = Number(cards3?.老點?.單數 || 0) || 0;
  const schedSingles = Number(cards3?.排班?.單數 || 0) || 0;

  const oldRateRows = totalRows ? Math.round((oldRows / totalRows) * 1000) / 10 : 0;
  const schedRateRows = totalRows ? Math.round((schedRows / totalRows) * 1000) / 10 : 0;

  const oldRateSingles = totalSingles ? Math.round((oldSingles / totalSingles) * 1000) / 10 : 0;
  const schedRateSingles = totalSingles ? Math.round((schedSingles / totalSingles) * 1000) / 10 : 0;

  return { oldRateRows, schedRateRows, oldRateSingles, schedRateSingles };
}

function renderMonthRates_(monthRows) {
  if (!dom.perfMonthRatesEl) return;
  if (!Array.isArray(monthRows) || !monthRows.length) {
    dom.perfMonthRatesEl.textContent = "本月：資料不足";
    return;
  }
  const r = computeMonthRates_(monthRows);
  dom.perfMonthRatesEl.innerHTML =
    `本月（單數）：老點率 ${r.oldRateSingles}% ｜ 排班率 ${r.schedRateSingles}%` +
    `<br/>` +
    `本月（筆數）：老點率 ${r.oldRateRows}% ｜ 排班率 ${r.schedRateRows}%`;
}

async function renderFromCache_(mode, info, opts) {
  const m = mode === "summary" ? "summary" : "detail";
  perfSelectedMode_ = m;

  const awaitChart = !!(opts && opts.awaitChart);

  const r = info && info.ok ? info : readRangeFromInputs_();
  if (!r || !r.ok) {
    showError_(true);
    if (r && r.error === "MISSING_USERID") setBadge_("缺少 userId（未登入/未取得 profile）", true);
    else if (r && r.error === "MISSING_START") setBadge_("請選擇開始日期", true);
    else if (r && r.error === "RANGE_TOO_LONG") setBadge_("日期區間過長（最多 93 天 / 約 3 個月）", true);
    else setBadge_("日期格式不正確", true);

    setMeta_("最後更新：—");
    if (dom.perfSummaryRowsEl) dom.perfSummaryRowsEl.innerHTML = summaryNotLoadedHtml_();
    renderDetailHeader_(m === "detail" ? "detail" : "summary");
    applyDetailTableHtml_("", 0);
    clearPerfChart_();
    return { ok: false, error: r ? r.error : "BAD_RANGE" };
  }

  const key = makeCacheKey_(r.userId, r.from, r.to);
  const hasCache = perfCache_.key === key && Array.isArray(perfCache_.detailRows) && perfCache_.detailRows.length > 0;

  if (!hasCache) {
    setBadge_("尚未載入（請按手動重整）", true);
    setMeta_("最後更新：—");
    if (dom.perfSummaryRowsEl) dom.perfSummaryRowsEl.innerHTML = summaryNotLoadedHtml_();
    renderDetailHeader_(m === "detail" ? "detail" : "summary");
    applyDetailTableHtml_("", 0);
    clearPerfChart_();
    showError_(false);
    return { ok: false, error: "NOT_LOADED" };
  }

  showError_(false);
  setBadge_("已載入", false);
  {
    const last = fmtTaipeiDateTime_(perfCache_.lastUpdatedAt);
    setMeta_(last ? `最後更新：${last}` : "最後更新：—");
  }

  const rows = perfCache_.detailRows || [];
  const cards3 = pickCards3_(perfCache_.cards, rows);
  renderSummaryTable_(cards3);

  // ✅ 本月比率（修正：先 normalize 訂單日期，避免 YYYY/MM/DD 比較失效）
  try {
    const monthStart = localDateKeyMonthStart_();
    const today = localDateKeyToday_();
    const monthRows = rows.filter((x) => {
      const raw = String(x["訂單日期"] || "");
      const dk = normalizeInputDateKey_(raw) || String(raw).slice(0, 10);
      return dk >= monthStart && dk <= today;
    });
    renderMonthRates_(monthRows);
  } catch (_) {}

  if (m === "summary") {
    const p = renderServiceSummaryTable_(perfCache_.serviceSummary || [], rows, r.dateKeys, { awaitChart });
    if (awaitChart && p && typeof p.then === "function") {
      try {
        await p;
      } catch (_) {}
    }
    return { ok: true, rendered: "summary", cached: true, chartAwaited: awaitChart };
  }

  renderDetailTable_(rows);
  let chartPromise = null;
  try {
    chartPromise = updatePerfChart_(rows, r.dateKeys);
    if (!awaitChart) Promise.resolve(chartPromise).catch(() => {});
  } catch (_) {
    chartPromise = null;
  }
  if (awaitChart && chartPromise && typeof chartPromise.then === "function") {
    try {
      await chartPromise;
    } catch (_) {}
  }
  return { ok: true, rendered: "detail", cached: true, chartAwaited: awaitChart };
}

/* =========================
 * Reload (manual refresh)
 * ========================= */

async function reloadAndCache_(info) {
  const r = info && info.ok ? info : readRangeFromInputs_();
  if (!r || !r.ok) return { ok: false, error: r ? r.error : "BAD_RANGE" };

  const userId = r.userId;
  const from = r.from;
  const to = r.to;

  const key = makeCacheKey_(userId, from, to);

  try {
    const raw = await fetchPerfSync_(userId, from, to, true);

    if (!raw || raw.ok !== true) {
      const err = String(raw && raw.error ? raw.error : "SYNC_FAILED");
      return { ok: false, error: err, raw };
    }

    const detail = raw.detail || {};
    const rows = Array.isArray(detail.rows) ? detail.rows : [];
    const cards = detail.cards || null;
    const serviceSummary = Array.isArray(detail.serviceSummary) ? detail.serviceSummary : [];

    perfCache_.key = key;
    perfCache_.lastUpdatedAt = String(raw.lastUpdatedAt || detail.lastUpdatedAt || "");
    perfCache_.detailRows = rows;
    perfCache_.cards = cards;
    perfCache_.serviceSummary = serviceSummary;

    return { ok: true, key, rowsCount: rows.length, serviceSummaryCount: serviceSummary.length, lastUpdatedAt: perfCache_.lastUpdatedAt };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/* =========================
 * Public exports
 * ========================= */

export function togglePerformanceCard() {
  // 保留擴充點
}

// ====== 期別工具函式：每月 1~15 為上半月、16~月底為下半月 ======
function lastDayOfMonth_(year, month) {
  // month: 1-12
  try {
    return new Date(year, month, 0).getDate();
  } catch (_) {
    return 31;
  }
}

function periodIndexForDate_(d) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1-12
  const day = d.getDate();
  const half = day <= 15 ? 1 : 2;
  return y * 24 + (m - 1) * 2 + (half - 1);
}

function rangeForPeriodIndex_(idx) {
  // idx -> {startKey, endKey}
  const year = Math.floor(idx / 24);
  let rem = idx % 24;
  if (rem < 0) {
    // handle negative modulo
    const borrow = Math.ceil(Math.abs(rem) / 24);
    return rangeForPeriodIndex_(idx + borrow * 24);
  }
  const month = Math.floor(rem / 2) + 1; // 1-12
  const half = (rem % 2) + 1; // 1 or 2
  const pad = (n) => String(n).padStart(2, "0");
  if (half === 1) {
    return { startKey: `${year}-${pad(month)}-01`, endKey: `${year}-${pad(month)}-15` };
  }
  const last = lastDayOfMonth_(year, month);
  return { startKey: `${year}-${pad(month)}-16`, endKey: `${year}-${pad(month)}-${pad(last)}` };
}

async function applyPeriodIndex_(idx) {
  const r = rangeForPeriodIndex_(idx);
  if (dom.perfDateStartInput) dom.perfDateStartInput.value = r.startKey;
  if (dom.perfDateEndInput) dom.perfDateEndInput.value = r.endKey;
  try {
    await manualRefreshPerformance({ showToast: true });
  } catch (_) {}
}

export function initPerformanceUi() {
  ensureDefaultDate_();

  try {
    loadPerfChartPrefs_();
  } catch (_) {}

  // Respect config flag: disable all chart UI and rendering when false
  try {
    if (config && (config.ENABLE_PERF_CHARTS === false || String(config.ENABLE_PERF_CHARTS).toLowerCase() === "false")) {
      perfChartsDisabled_ = true;
      try {
        const hideSel = [
          '.chart-toolbar',
          '.chart-toggle',
          '.chart-wrapper',
          '#perfChart',
          '#perfChartHint',
          '#perfChartModeDaily',
          '#perfChartModeCumu',
          '#perfChartModeMA7',
          '#perfChartModeBar',
          '#perfChartReset',
          '#perfChartToggleAmount',
          '#perfChartToggleOldRate',
          '#perfChartToggleSchedRate'
        ].join(',');
        const els = document.querySelectorAll(hideSel);
        for (const el of els) {
          try { el.style && (el.style.display = 'none'); } catch (_) {}
        }
        if (dom.perfChartHintEl) dom.perfChartHintEl.textContent = "圖表功能已停用。";
      } catch (_) {}

      // destroy any existing chart instance
      try {
        if (perfChartInstance_) {
          try { perfChartInstance_.destroy(); } catch (_) {}
          perfChartInstance_ = null;
        }
      } catch (_) {}
    }
  } catch (_) {}

  if (dom.perfSearchBtn) dom.perfSearchBtn.addEventListener("click", () => void renderFromCache_("summary"));
  if (dom.perfSearchSummaryBtn) dom.perfSearchSummaryBtn.addEventListener("click", () => void renderFromCache_("summary"));
  if (dom.perfSearchDetailBtn) dom.perfSearchDetailBtn.addEventListener("click", () => void renderFromCache_("detail"));

  const onDateInputsChanged = () => {
    // ✅ 日期改了：只切畫面（不自動同步）
    void renderFromCache_(perfSelectedMode_, readRangeFromInputs_());
  };

  if (dom.perfDateStartInput) {
    dom.perfDateStartInput.addEventListener("change", onDateInputsChanged);
    dom.perfDateStartInput.addEventListener("input", onDateInputsChanged);
  }
  if (dom.perfDateEndInput) {
    dom.perfDateEndInput.addEventListener("change", onDateInputsChanged);
    dom.perfDateEndInput.addEventListener("input", onDateInputsChanged);
  }

  // 期別按鈕（上期 / 本期）事件綁定
  try {
    const btnPrev = document.getElementById("perfPeriodPrev");
    const btnThis = document.getElementById("perfPeriodThis");
    const todayIdx = periodIndexForDate_(new Date());
    if (btnPrev)
      btnPrev.addEventListener("click", () => {
        void applyPeriodIndex_(todayIdx - 1);
        try {
          btnPrev.classList && btnPrev.classList.add("is-active");
          btnThis && btnThis.classList && btnThis.classList.remove("is-active");
        } catch (_) {}
      });
    if (btnThis)
      btnThis.addEventListener("click", () => {
        void applyPeriodIndex_(todayIdx);
        try {
          btnThis.classList && btnThis.classList.add("is-active");
          btnPrev && btnPrev.classList && btnPrev.classList.remove("is-active");
        } catch (_) {}
      });
    // default active
    try {
      if (btnThis) btnThis.classList.add("is-active");
    } catch (_) {}
    // 本月按鈕
    const btnMonth = document.getElementById("perfPeriodMonth");
    if (btnMonth)
      btnMonth.addEventListener("click", async () => {
        try {
          const now = new Date();
          const y = now.getFullYear();
          const m = now.getMonth() + 1;
          const pad = (n) => String(n).padStart(2, "0");
          const startKey = `${y}-${pad(m)}-01`;
          const last = lastDayOfMonth_(y, m);
          const endKey = `${y}-${pad(m)}-${pad(last)}`;
          if (dom.perfDateStartInput) dom.perfDateStartInput.value = startKey;
          if (dom.perfDateEndInput) dom.perfDateEndInput.value = endKey;
          try { btnMonth.classList && btnMonth.classList.add('is-active'); } catch(_){}
          try { btnPrev && btnPrev.classList && btnPrev.classList.remove('is-active'); } catch(_){}
          try { btnThis && btnThis.classList && btnThis.classList.remove('is-active'); } catch(_){}
          await manualRefreshPerformance({ showToast: true });
        } catch (_) {}
      });
    // 上個月按鈕
    const btnLastMonth = document.getElementById("perfPeriodLastMonth");
    if (btnLastMonth)
      btnLastMonth.addEventListener("click", async () => {
        try {
          const now = new Date();
          let y = now.getFullYear();
          let m = now.getMonth() + 1;
          m = m - 1;
          if (m === 0) {
            m = 12;
            y = y - 1;
          }
          const pad = (n) => String(n).padStart(2, "0");
          const startKey = `${y}-${pad(m)}-01`;
          const last = lastDayOfMonth_(y, m);
          const endKey = `${y}-${pad(m)}-${pad(last)}`;
          if (dom.perfDateStartInput) dom.perfDateStartInput.value = startKey;
          if (dom.perfDateEndInput) dom.perfDateEndInput.value = endKey;
          try { btnLastMonth.classList && btnLastMonth.classList.add('is-active'); } catch(_){}
          try { btnMonth && btnMonth.classList && btnMonth.classList.remove('is-active'); } catch(_){}
          try { btnPrev && btnPrev.classList && btnPrev.classList.remove('is-active'); } catch(_){}
          try { btnThis && btnThis.classList && btnThis.classList.remove('is-active'); } catch(_){}
          await manualRefreshPerformance({ showToast: true });
        } catch (_) {}
      });
  } catch (_) {}

  // ✅ optional chart mode buttons
  try {
    const btnDaily = document.getElementById("perfChartModeDaily");
    const btnCumu = document.getElementById("perfChartModeCumu");
    const btnMA7 = document.getElementById("perfChartModeMA7");
    const btnBar = document.getElementById("perfChartModeBar");
    const btnReset = document.getElementById("perfChartReset");

    const setActive = () => {
      const all = [btnDaily, btnCumu, btnMA7].filter(Boolean);
      for (const b of all) b.classList.remove("is-active");
      const map = { daily: btnDaily, cumu: btnCumu, ma7: btnMA7 };
      const active = map[perfChartMode_];
      if (active) active.classList.add("is-active");
      if (btnBar) {
        if (perfChartType_ === 'bar') btnBar.classList.add('is-active');
        else btnBar.classList.remove('is-active');
      }
    };

    const applyMode = (mode) => {
      if (mode !== "daily" && mode !== "cumu" && mode !== "ma7") return;
      perfChartMode_ = mode;
      savePerfChartPrefs_();
      setActive();
      schedulePerfChartRedraw_();
    };

    btnDaily && btnDaily.addEventListener("click", () => applyMode("daily"));
    btnCumu && btnCumu.addEventListener("click", () => applyMode("cumu"));
    btnMA7 && btnMA7.addEventListener("click", () => applyMode("ma7"));
    if (btnBar) {
      btnBar.addEventListener('click', () => {
        perfChartType_ = perfChartType_ === 'bar' ? 'line' : 'bar';
        savePerfChartPrefs_();
        setActive();
        schedulePerfChartRedraw_();
      });
    }

    btnReset &&
      btnReset.addEventListener("click", () => {
        perfChartMode_ = "daily";
        perfChartVis_ = { amount: true, oldRate: true, schedRate: true };
        savePerfChartPrefs_();
        setActive();

        const elAmount = document.getElementById("perfChartToggleAmount");
        const elOld = document.getElementById("perfChartToggleOldRate");
        const elSched = document.getElementById("perfChartToggleSchedRate");
        if (elAmount) elAmount.checked = true;
        if (elOld) elOld.checked = true;
        if (elSched) elSched.checked = true;

        schedulePerfChartRedraw_();
        applyChartVisibility_();
      });

    setActive();
  } catch (_) {}

  // ✅ optional chart toggles
  try {
    const elAmount = document.getElementById("perfChartToggleAmount");
    const elOld = document.getElementById("perfChartToggleOldRate");
    const elSched = document.getElementById("perfChartToggleSchedRate");

    if (elAmount) elAmount.checked = !!perfChartVis_.amount;
    if (elOld) elOld.checked = !!perfChartVis_.oldRate;
    if (elSched) elSched.checked = !!perfChartVis_.schedRate;

    const onToggle = () => {
      perfChartVis_.amount = elAmount ? !!elAmount.checked : perfChartVis_.amount;
      perfChartVis_.oldRate = elOld ? !!elOld.checked : perfChartVis_.oldRate;
      perfChartVis_.schedRate = elSched ? !!elSched.checked : perfChartVis_.schedRate;

      if (!perfChartVis_.amount && !perfChartVis_.oldRate && !perfChartVis_.schedRate) {
        perfChartVis_.amount = true;
        if (elAmount) elAmount.checked = true;
      }

      savePerfChartPrefs_();
      applyChartVisibility_();
    };

    elAmount && elAmount.addEventListener("change", onToggle);
    elOld && elOld.addEventListener("change", onToggle);
    elSched && elSched.addEventListener("change", onToggle);
  } catch (_) {}

  // window resize fallback
  try {
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("resize", () => schedulePerfChartRedraw_());
    }
  } catch (_) {}

  // Ensure chart wrapper accepts native touch scrolling on mobile
  try {
    const wrapper = dom.perfChartEl ? dom.perfChartEl.closest(".chart-wrapper") : null;
    if (wrapper) {
      wrapper.style.overflowX = wrapper.style.overflowX || "auto";
      wrapper.style.webkitOverflowScrolling = wrapper.style.webkitOverflowScrolling || "touch";
      try {
        if (dom.perfChartEl) dom.perfChartEl.style.touchAction = dom.perfChartEl.style.touchAction || "pan-x";
      } catch (_) {}
    }
  } catch (e) {
    console.error("perf wrapper touch setup error", e);
  }

  // ✅ ResizeObserver
  try {
    const wrapper = dom.perfChartEl ? dom.perfChartEl.closest(".chart-wrapper") : null;
    if (wrapper && "ResizeObserver" in window) {
      if (perfChartRO_) {
        try {
          perfChartRO_.disconnect();
        } catch (_) {}
      }
      perfChartRO_ = new ResizeObserver(() => schedulePerfChartRedraw_());
      perfChartRO_.observe(wrapper);
    }
  } catch (_) {}
}

/**
 * ✅ 登入時預載：用「當月 1號 ~ 今天」打一筆 sync，快取就有資料可切換
 */
export async function prefetchPerformanceOnce() {
  if (String(state?.feature?.performanceEnabled || "") === "否") {
    return { ok: false, skipped: "FEATURE_OFF" };
  }

  if (perfPrefetchInFlight_) return perfPrefetchInFlight_;

  perfPrefetchInFlight_ = (async () => {
    ensureDefaultDate_();

    const userId = getUserId_();
    if (!userId) return { ok: false, skipped: "MISSING_USERID" };

    const from = localDateKeyMonthStart_();
    const to = localDateKeyToday_();
    const dateKeys = normalizeRange_(from, to, PERF_MAX_RANGE_DAYS).dateKeys;

    const info = { ok: true, userId, from, to, dateKeys };
    const res = await reloadAndCache_(info);

    if (res && res.ok) await renderFromCache_(perfSelectedMode_, info);

    return { ok: !!(res && res.ok), ...res, prefetched: "SYNC_STORE_PERF" };
  })();

  try {
    return await perfPrefetchInFlight_;
  } finally {
    perfPrefetchInFlight_ = null;
  }
}

/**
 * ✅ 唯一會抓最新資料的入口（手動重整）
 */
export async function manualRefreshPerformance({ showToast } = { showToast: true }) {
  if (String(state?.feature?.performanceEnabled || "") === "否") return { ok: false, skipped: "FEATURE_OFF" };

  ensureDefaultDate_();
  showError_(false);

  const info = readRangeFromInputs_();
  if (!info.ok) {
    if (info.error === "MISSING_USERID") setBadge_("缺少 userId（未登入/未取得 profile）", true);
    else if (info.error === "MISSING_START") setBadge_("請選擇開始日期", true);
    else if (info.error === "RANGE_TOO_LONG") setBadge_("日期區間過長（最多 93 天 / 約 3 個月）", true);
    else setBadge_("日期格式不正確", true);
    return { ok: false, error: info.error || "BAD_RANGE" };
  }

  setBadge_("同步中…", false);

  const needToast = !!showToast;
  const releaseLoading = needToast ? holdLoadingHint("同步資料中…") : null;

  try {
    const res = await reloadAndCache_(info);
    if (!res || !res.ok) {
      const msg = String(res && res.error ? res.error : "SYNC_FAILED");
      if (msg.includes("CONFIG_PERF_SYNC_API_URL_MISSING")) setBadge_("尚未設定 PERF_SYNC_API_URL", true);
      else if (msg.includes("FEATURE_OFF")) setBadge_("未開通業績功能", true);
      else if (msg.includes("USER_NOT_FOUND")) setBadge_("未授權（PerformanceAccess 查無 userId）", true);
      else if (msg.includes("TIMEOUT")) setBadge_("查詢逾時，請稍後再試", true);
      else setBadge_("同步失敗", true);
      showError_(true);
      return res;
    }

    // ✅ 需要 toast 時：等到圖表也 render 完（Chart.js lazy load 完成）才隱藏
    return await renderFromCache_(perfSelectedMode_, info, { awaitChart: needToast });
  } finally {
    if (releaseLoading) releaseLoading();
  }
}

export function onShowPerformance() {
  ensureDefaultDate_();
  showError_(false);
  const releaseLoading = holdLoadingHint("同步資料中…");
  (async () => {
    try {
      await renderFromCache_(perfSelectedMode_, null, { awaitChart: true });
    } finally {
      releaseLoading();
    }
  })();

  try {
    schedulePerfChartRedraw_();
  } catch (_) {}
}
