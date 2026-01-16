/**
 * performance.js（完整可貼可覆蓋版 / ✅ 三卡依開始/結束日期即時變動 + ✅ 統計頁節=數量 + ✅ 圖表跨裝置可讀性強化 + ✅ touchstart Intervention 修正）
 *
 * ✅ 你這次要求的關鍵修正
 * 1)「類別｜單數｜筆數｜數量｜金額」必須跟開始/結束日期變動：改用 detail 快取 got.rows 計算（不再固定用 GAS latest Summary）
 * 2) 數量從 47 變 45 的問題：補強「數量」解析（parseQty_），避免字串格式導致 Number() 變 0 漏算
 * 3) 日期區間超出最新日：不再直接顯示全部，改成 endKey clamp 到 maxKey（仍可依日期變動）
 * 4) [Intervention] cancelable=false 警告：preventDefault 只在 ev.cancelable 為 true 時呼叫
 *
 * ⚠️ 注意
 * - 這份檔案假設你的 HTML 已存在 perfChart canvas / chart-wrapper（你先前已加）
 * - 若你已加「圖表顯示勾選/模式按鈕」的 HTML，本檔案會自動綁定；沒加也不會報錯
 */

import { dom } from "./dom.js";
import { config } from "./config.js";
import { state } from "./state.js";
import { withQuery, escapeHtml } from "./core.js";
import { showLoadingHint, hideLoadingHint } from "./uiHelpers.js";
import { normalizeTechNo } from "./myMasterStatus.js";

const PERF_FETCH_TIMEOUT_MS = 20000;
const PERF_TZ = "Asia/Taipei";

/** ✅ 開關：是否抓兩張 latest 並比較（建議 true） */
const PERF_COMPARE_LATEST_ENABLED = true;
/** ✅ debug：console.table/console.log */
const PERF_COMPARE_LATEST_DEBUG = true;

/**
 * ✅ 類別表（排班/老點/總計）數量口徑：固定用「數量」欄位
 * 你之前 auto 可能會改用分鐘，會造成數量不一致（尤其你要對齊 GAS 的「數量」）
 */
const PERF_CARD_QTY_MODE = "qty"; // 固定 "qty"

/* =========================
 * Intl formatter（memoize）
 * ========================= */

const PERF_TPE_TIME_FMT = (() => {
  try {
    if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: PERF_TZ,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    }
  } catch (_) {}
  return null;
})();

const PERF_TPE_DATE_PARTS_FMT = (() => {
  try {
    if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: PERF_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
  } catch (_) {}
  return null;
})();

const PERF_CURRENCY_FMT = (() => {
  try {
    return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
  } catch (_) {
    return null;
  }
})();

function fmtMoney_(n) {
  const v = Number(n || 0) || 0;
  if (PERF_CURRENCY_FMT) return PERF_CURRENCY_FMT.format(v);
  return String(Math.round(v));
}

/* =========================
 * ✅ Robust number parsing
 * ========================= */

/**
 * ✅ 強化數量解析：避免 "1.5 "、"１．５"、"1.5節" 這種格式導致 Number()=NaN → 0 漏算
 * 這就是你「47 → 45」最常見原因（漏掉 2 節左右）
 */
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
  // 金額通常是整數，但仍做保護
  if (v === null || v === undefined) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim().replace(/[^\d.\-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/* =========================
 * Module State
 * ========================= */

let perfSelectedMode_ = "detail"; // "detail" | "summary"
let perfPrefetchInFlight_ = null;

const perfCache_ = {
  summaryKey: "",
  detailKey: "",
  summary: null, // { meta, summaryObj, summaryHtml, source, lastUpdatedAt }
  detail: null, // { meta, techNo, allRows, maxKey, summaryObj, summaryHtml, lastUpdatedAt }
};

// Chart instance
let perfChartInstance_ = null;
// last rendered data for responsive redraws
let perfChartLastRows_ = null;
let perfChartLastDateKeys_ = null;
let perfChartResizeTimer_ = null;
// drag-to-scroll state
const perfDragState_ = {
  enabled: false,
  pointerDown: false,
  startX: 0,
  startScrollLeft: 0,
  handlers: null,
};

// ResizeObserver handle
let perfChartRO_ = null;

/* =========================
 * ✅ Chart: optional user toggles (if HTML exists)
 * ========================= */

const PERF_CHART_VIS_KEY = "perf_chart_vis_v1";
const PERF_CHART_MODE_KEY = "perf_chart_mode_v1";

let perfChartMode_ = "daily"; // "daily" | "cumu" | "ma7"
let perfChartVis_ = { amount: true, oldRate: true, schedRate: true };

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
}

function savePerfChartPrefs_() {
  try {
    localStorage.setItem(PERF_CHART_VIS_KEY, JSON.stringify(perfChartVis_));
  } catch (_) {}
  try {
    localStorage.setItem(PERF_CHART_MODE_KEY, String(perfChartMode_ || "daily"));
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

  // 不允許全部關閉
  if (!perfChartVis_.amount && !perfChartVis_.oldRate && !perfChartVis_.schedRate) {
    perfChartVis_.amount = true;
    if (ds[0]) ds[0].hidden = false;
  }

  try {
    perfChartInstance_.update("none");
  } catch (_) {}
}

/* =========================
 * Chart helpers
 * ========================= */

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

function updatePerfChart_(rows, dateKeys) {
  try {
    if (!dom.perfChartEl) return;
    const keys = Array.isArray(dateKeys) && dateKeys.length ? dateKeys.slice() : [];

    const metrics = {}; // { dateKey: { amount, totalCount, oldCount, schedCount } }
    const list = Array.isArray(rows) ? rows : [];

    function bucketOfRow(r) {
      const v1 = String((r && r["拉牌"]) || "").trim();
      const v2 = String((r && r["服務項目"]) || "").trim();
      const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
      const n1 = norm(v1);
      const n2 = norm(v2);
      const oldTokens = ["老", "老點", "old", "vip"];
      for (const t of oldTokens) {
        if (n1.indexOf(t) !== -1 || n2.indexOf(t) !== -1) return "老點";
      }
      return "排班";
    }

    for (const r of list) {
      const dkey = orderDateKey_(r["訂單日期"] || r["date"] || "");
      if (!dkey) continue;

      if (!metrics[dkey]) metrics[dkey] = { amount: 0, totalCount: 0, oldCount: 0, schedCount: 0 };

      const m = metrics[dkey];
      const amt = parseMoney_(r["小計"] ?? r["業績金額"] ?? r["金額"] ?? 0);
      m.amount += amt;
      m.totalCount += 1;

      const b = bucketOfRow(r);
      if (b === "老點") m.oldCount += 1;
      else if (b === "排班") m.schedCount += 1;
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

    // mode transform (amount only)
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

    if (typeof Chart === "undefined") return;

    const ctx = dom.perfChartEl.getContext("2d");

    perfChartLastRows_ = Array.isArray(rows) ? rows.slice() : [];
    perfChartLastDateKeys_ = Array.isArray(dateKeys) ? dateKeys.slice() : [];

    const wrapperEl = dom.perfChartEl?.closest?.(".chart-wrapper") || dom.perfChartEl?.parentElement;
    const containerWidth = (wrapperEl && wrapperEl.clientWidth) || window.innerWidth || 800;

    const points = labels.length || 1;
    const isNarrow = containerWidth < 420;
    const shouldScroll = points > (isNarrow ? 4 : 6);

    const pxPerPoint = isNarrow ? 64 : 72;
    const desiredWidth = shouldScroll ? Math.max(containerWidth, points * pxPerPoint) : containerWidth;
    const desiredHeight = isNarrow ? 190 : Math.max(200, Math.round(Math.min(320, desiredWidth / 3.2)));

    const baseFont = isNarrow ? 11 : 13;
    const ticksFont = isNarrow ? 10 : 12;

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    dom.perfChartEl.style.width = shouldScroll ? `${Math.round(desiredWidth)}px` : "100%";
    dom.perfChartEl.style.height = `${desiredHeight}px`;
    dom.perfChartEl.width = Math.round(desiredWidth * dpr);
    dom.perfChartEl.height = Math.round(desiredHeight * dpr);

    try {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } catch (_) {}

    try {
      enableCanvasDragScroll_(shouldScroll);
    } catch (_) {}

    const maxXTicks = isNarrow ? 5 : 7;

    perfChartInstance_ = new Chart(ctx, {
      data: {
        labels: labels.map((s) => String(s).replaceAll("-", "/")),
        datasets: [
          {
            type: amountAsLine ? "line" : "bar",
            label: amountLabel,
            data: amountData,
            borderWidth: amountAsLine ? 2 : 1,
            tension: amountAsLine ? 0.25 : 0,
            fill: false,
            pointRadius: amountAsLine ? (isNarrow ? 0 : 2) : 0,
            pointHitRadius: 10,
            yAxisID: "y",
          },
          {
            type: "line",
            label: "老點率 (%)",
            data: oldRateData,
            tension: 0.25,
            fill: false,
            yAxisID: "y1",
            pointRadius: isNarrow ? 0 : 2,
            pointHitRadius: 10,
          },
          {
            type: "line",
            label: "排班率 (%)",
            data: schedRateData,
            tension: 0.25,
            fill: false,
            yAxisID: "y1",
            pointRadius: isNarrow ? 0 : 2,
            pointHitRadius: 10,
          },
        ],
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        animation: false,
        normalized: true,
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 6, right: 10, bottom: 4, left: 6 } },
        plugins: {
          legend: {
            position: isNarrow ? "bottom" : "top",
            labels: {
              usePointStyle: true,
              boxWidth: 8,
              font: { size: baseFont },
              padding: isNarrow ? 10 : 14,
            },
          },
          tooltip: {
            bodyFont: { size: ticksFont },
            titleFont: { size: baseFont },
            callbacks: {
              title: (items) => {
                const t = items?.[0]?.label || "";
                return `日期：${t}`;
              },
              label: (ctx2) => {
                const label = ctx2.dataset?.label || "";
                const v = ctx2.parsed?.y;

                const idx = ctx2.dataIndex;
                const rawKey = labels[idx];
                const m = rawKey ? metrics[rawKey] : null;

                if (ctx2.dataset?.yAxisID === "y") {
                  const amt = fmtMoney_(v);
                  const total = m?.totalCount || 0;
                  const oldC = m?.oldCount || 0;
                  const schC = m?.schedCount || 0;
                  return [`${label}：${amt}`, `筆數：${total}（老點 ${oldC} / 排班 ${schC}）`];
                }
                return `${label}：${v ?? 0}%`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              autoSkip: true,
              maxTicksLimit: maxXTicks,
              maxRotation: 0,
              font: { size: ticksFont },
            },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { font: { size: ticksFont }, callback: (vv) => fmtMoney_(vv) },
            title: { display: !isNarrow, text: "金額", font: { size: baseFont } },
          },
          y1: {
            position: "right",
            beginAtZero: true,
            max: 100,
            ticks: { font: { size: ticksFont }, callback: (vv) => `${vv}%` },
            grid: { drawOnChartArea: false },
            title: { display: !isNarrow, text: "比率 (%)", font: { size: baseFont } },
          },
        },
      },
    });

    // ✅ 若你有做 checkbox toggle，這裡會套用；沒做也不影響
    try {
      applyChartVisibility_();
    } catch (_) {}
  } catch (e) {
    console.error("updatePerfChart_ error", e);
  }
}

// debounce helper for resize redraw
function schedulePerfChartRedraw_() {
  if (perfChartResizeTimer_) clearTimeout(perfChartResizeTimer_);
  perfChartResizeTimer_ = setTimeout(() => {
    try {
      if (perfChartLastRows_) updatePerfChart_(perfChartLastRows_, perfChartLastDateKeys_);
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

    // cleanup existing
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
      // touch handlers (may not exist)
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

    if (!enable) {
      perfDragState_.enabled = false;
      return;
    }

    const onPointerDown = (ev) => {
      try {
        perfDragState_.pointerDown = true;
        perfDragState_.startX = ev.clientX || (ev.touches && ev.touches[0] && ev.touches[0].clientX) || 0;
        perfDragState_.startScrollLeft = wrapper ? wrapper.scrollLeft : 0;
        if (ev.pointerId && canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId);

        // ✅ only if cancelable
        if (ev && ev.cancelable) ev.preventDefault();
      } catch (e) {}
    };

    const onPointerMove = (ev) => {
      if (!perfDragState_.pointerDown) return;
      try {
        const clientX = ev.clientX || (ev.touches && ev.touches[0] && ev.touches[0].clientX) || 0;
        const dx = clientX - perfDragState_.startX;
        if (wrapper) wrapper.scrollLeft = Math.round(perfDragState_.startScrollLeft - dx);

        // ✅ only if cancelable
        if (ev && ev.cancelable) ev.preventDefault();
      } catch (e) {}
    };

    const onPointerUp = (ev) => {
      perfDragState_.pointerDown = false;
      try {
        if (ev.pointerId && canvas.releasePointerCapture) canvas.releasePointerCapture(ev.pointerId);
      } catch (e) {}
    };

    const onTouchDown = (ev) => onPointerDown(ev);
    const onTouchMove = (ev) => onPointerMove(ev);
    const onTouchUp = (ev) => onPointerUp(ev);

    canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    canvas.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: true });

    // touch fallback (保留，但不會亂 preventDefault)
    canvas.addEventListener("touchstart", onTouchDown, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchUp, { passive: true });

    perfDragState_.handlers = {
      down: onPointerDown,
      move: onPointerMove,
      up: onPointerUp,
      tdown: onTouchDown,
      tmove: onTouchMove,
      tup: onTouchUp,
    };
    perfDragState_.enabled = true;
  } catch (err) {
    console.error("enableCanvasDragScroll_ error", err);
  }
}

/* =========================
 * Utils
 * ========================= */

function pad2_(n) {
  return String(n).padStart(2, "0");
}

/** ✅ 把 YYYY/MM/DD or YYYY-M-D 轉成 YYYY-MM-DD */
function normalizeInputDateKey_(s) {
  const v = String(s || "").trim();
  if (!v) return "";
  const m = v.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!m) return "";
  return `${m[1]}-${pad2_(m[2])}-${pad2_(m[3])}`;
}

/** 台北日期 key（timestamp 用） */
function toDateKeyTaipei_(v) {
  if (v === null || v === undefined) return "";

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return "";
    const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return `${m[1]}-${pad2_(m[2])}-${pad2_(m[3])}`;
  }

  const d = v instanceof Date ? v : new Date(String(v).trim());
  if (Number.isNaN(d.getTime())) return "";

  try {
    if (PERF_TPE_DATE_PARTS_FMT) {
      const parts = PERF_TPE_DATE_PARTS_FMT.formatToParts(d);
      let yyyy = "",
        mm = "",
        dd = "";
      for (const p of parts) {
        if (p.type === "year") yyyy = p.value;
        else if (p.type === "month") mm = p.value;
        else if (p.type === "day") dd = p.value;
      }
      if (yyyy && mm && dd) return `${yyyy}-${mm}-${dd}`;
    }
  } catch (_) {}

  const tzMs = d.getTime() + 8 * 60 * 60 * 1000;
  const t = new Date(tzMs);
  return `${t.getUTCFullYear()}-${pad2_(t.getUTCMonth() + 1)}-${pad2_(t.getUTCDate())}`;
}

/** ✅ 訂單日期：純日期，不做時區換算 */
function orderDateKey_(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (m) return `${m[1]}-${pad2_(m[2])}-${pad2_(m[3])}`;
  return toDateKeyTaipei_(s);
}

function formatDateYmd_(v) {
  const dk = orderDateKey_(v);
  return dk ? dk.replaceAll("-", "/") : String(v ?? "").trim();
}

function formatTimeTpeHms_(v) {
  if (v === null || v === undefined) return "";

  if (typeof v === "string") {
    const s0 = v.trim();
    if (!s0) return "";
    const m = s0.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) return `${pad2_(m[1])}:${m[2]}:${m[3] ? m[3] : "00"}`;
  }

  const d = v instanceof Date ? v : new Date(String(v).trim());
  if (Number.isNaN(d.getTime())) return String(v ?? "").trim();

  try {
    if (PERF_TPE_TIME_FMT) {
      const out = PERF_TPE_TIME_FMT.format(d);
      if (out) return out;
    }
  } catch (_) {}

  const tzMs = d.getTime() + 8 * 60 * 60 * 1000;
  const t = new Date(tzMs);
  return `${pad2_(t.getUTCHours())}:${pad2_(t.getUTCMinutes())}:${pad2_(t.getUTCSeconds())}`;
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

  // ✅ 統計頁：節 = 數量（欄名仍叫節數，對齊 GAS Report_Detail）
  dom.perfDetailHeadRowEl.innerHTML =
    "<th>服務項目</th><th>總筆數</th><th>總節數</th><th>總計金額</th>" +
    "<th>老點筆數</th><th>老點節數</th><th>老點金額</th>" +
    "<th>排班筆數</th><th>排班節數</th><th>排班金額</th>";
}

/* =========================
 * HTML builders
 * ========================= */

function summaryRowsHtml_(summaryObj) {
  if (!summaryObj) {
    return '<tr><td colspan="4" style="color:var(--text-sub);">查無總覽資料。</td></tr>';
  }

  const td = (v) => `<td>${escapeHtml(String(v ?? ""))}</td>`;

  const cards = [
    { label: "排班", card: summaryObj["排班"] || {} },
    { label: "老點", card: summaryObj["老點"] || {} },
    { label: "總計", card: summaryObj["總計"] || {} },
  ];

  return cards
    .map(
      ({ label, card }) =>
        `<tr>
          ${td(label)}
          ${td(card.單數 ?? 0)}
          ${td(card.筆數 ?? 0)}
          ${td(card.金額 ?? 0)}
        </tr>`
    )
    .join("");
}


function summaryNotLoadedHtml_() {
  return '<tr><td colspan="5" style="color:var(--text-sub);">尚未載入（請按手動重整）</td></tr>';
}

function detailSummaryRowsHtml_(detailRows) {
  const list = Array.isArray(detailRows) ? detailRows : [];
  if (!list.length) return { html: "", count: 0 };
  const td = (v) => `<td>${escapeHtml(String(v ?? ""))}</td>`;
  return {
    count: list.length,
    html: list
      .map(
        (r) =>
          "<tr>" +
          td(r["服務項目"] || "") +
          td(r["總筆數"] ?? 0) +
          td(r["總節數"] ?? 0) +
          td(r["總計金額"] ?? 0) +
          td(r["老點筆數"] ?? 0) +
          td(r["老點節數"] ?? 0) +
          td(r["老點金額"] ?? 0) +
          td(r["排班筆數"] ?? 0) +
          td(r["排班節數"] ?? 0) +
          td(r["排班金額"] ?? 0) +
          "</tr>"
      )
      .join(""),
  };
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
          td(formatDateYmd_(r["訂單日期"])) +
          td(r["訂單編號"] || "") +
          td(r["序"] ?? "") +
          td(r["拉牌"] || "") +
          td(r["服務項目"] || "") +
          td(r["業績金額"] ?? 0) +
          td(r["抽成金額"] ?? 0) +
          td(r["數量"] ?? 0) +
          td(r["小計"] ?? 0) +
          td(r["分鐘"] ?? 0) +
          td(formatTimeTpeHms_(r["開工"])) +
          td(formatTimeTpeHms_(r["完工"])) +
          td(r["狀態"] || "") +
          "</tr>"
      )
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

function renderDetailRows_(rows) {
  const tmp = detailRowsHtml_(Array.isArray(rows) ? rows : []);
  applyDetailTableHtml_(tmp.html, tmp.count);
}

/* =========================
 * Range / inputs
 * ========================= */

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
  const limit = Number(maxDays) > 0 ? Number(maxDays) : 31;
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

/** ✅ 從 UI 讀區間：先 normalizeInputDateKey_ 再驗證 */
function readRangeFromInputs_() {
  const techNo = normalizeTechNo(state.myMaster && state.myMaster.techNo);

  const startRaw = String(dom.perfDateStartInput?.value || "").trim();
  const endRaw = String(dom.perfDateEndInput?.value || "").trim();

  const startKey = normalizeInputDateKey_(startRaw);
  const endKey = normalizeInputDateKey_(endRaw || startRaw);

  if (!techNo) return { ok: false, error: "NOT_MASTER", techNo: "", startKey, endKey };
  if (!startKey) return { ok: false, error: "MISSING_START", techNo, startKey, endKey };

  const range = normalizeRange_(startKey, endKey, 31);
  if (!range.ok) return { ok: false, error: range.error || "BAD_RANGE", techNo, startKey, endKey };

  if (dom.perfDateStartInput && dom.perfDateStartInput.value !== range.normalizedStart) dom.perfDateStartInput.value = range.normalizedStart;
  if (dom.perfDateEndInput && dom.perfDateEndInput.value !== range.normalizedEnd) dom.perfDateEndInput.value = range.normalizedEnd;

  return { ok: true, techNo, startKey: range.normalizedStart, endKey: range.normalizedEnd, dateKeys: range.dateKeys };
}

/* =========================
 * Detail filter (order date)
 * ========================= */

function fastDateKeyFromRow_(r) {
  return orderDateKey_(r && r["訂單日期"]);
}

function getMaxDetailDateKey_(detailRows) {
  const rows = Array.isArray(detailRows) ? detailRows : [];
  let maxKey = "";
  for (let i = 0; i < rows.length; i++) {
    const dk = fastDateKeyFromRow_(rows[i]);
    if (dk && dk > maxKey) maxKey = dk;
  }
  return maxKey;
}

/**
 * ✅ 規則（已修正）
 * - startKey > maxKey：顯示全部（避免空畫面）
 * - endKey > maxKey：把 endKey clamp 到 maxKey（不要直接顯示全部，才能依日期變動）
 */
function filterDetailRowsByRange_(detailRows, startKey, endKey, knownMaxKey) {
  const rows = Array.isArray(detailRows) ? detailRows : [];
  let s = String(startKey || "").trim();
  let e = String(endKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return rows;

  const maxKey = knownMaxKey || getMaxDetailDateKey_(rows);

  if (maxKey && s > maxKey) return rows; // 選到全未來 → 顯示全部避免空

  if (maxKey && e > maxKey) e = maxKey; // ✅ clamp end

  return rows.filter((r) => {
    const dk = fastDateKeyFromRow_(r);
    if (!dk) return true;
    return dk >= s && dk <= e;
  });
}

/* =========================
 * ✅ Service Summary (from detail cache) - 統計頁表格用
 * ✅ 本版：節 = 數量（對齊 GAS Report_Detail）
 * ========================= */

function buildServiceSummaryFromDetail_(detailRows) {
  const rows = Array.isArray(detailRows) ? detailRows : [];
  const map = new Map();

  function bucket_(r) {
    const v1 = String((r && r["拉牌"]) || "").trim();
    const v2 = String((r && r["服務項目"]) || "").trim();

    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
    const n1 = norm(v1);
    const n2 = norm(v2);

    const oldTokens = ["老", "老點", "old", "vip"];
    for (const t of oldTokens) {
      if (n1.indexOf(t) !== -1 || n2.indexOf(t) !== -1) return "老點";
    }
    return "排班";
  }

  for (const r of rows) {
    const name = String((r && r["服務項目"]) || "").trim() || "（未命名）";
    const b = bucket_(r);

    // ✅ 節 = 數量（允許小數 1.5）— 用 parseQty_ 避免漏算
    const qty = parseQty_(r && r["數量"]);
    const amount = parseMoney_(r && (r["小計"] ?? r["業績金額"]));

    if (!map.has(name)) {
      map.set(name, {
        "服務項目": name,
        "總筆數": 0,
        "總節數": 0,
        "總計金額": 0,
        "老點筆數": 0,
        "老點節數": 0,
        "老點金額": 0,
        "排班筆數": 0,
        "排班節數": 0,
        "排班金額": 0,
      });
    }

    const o = map.get(name);

    o["總筆數"] += 1;
    o["總節數"] += qty;
    o["總計金額"] += amount;

    if (b === "老點") {
      o["老點筆數"] += 1;
      o["老點節數"] += qty;
      o["老點金額"] += amount;
    } else {
      o["排班筆數"] += 1;
      o["排班節數"] += qty;
      o["排班金額"] += amount;
    }
  }

  return Array.from(map.values()).sort((a, b) => (Number(b["總計金額"]) || 0) - (Number(a["總計金額"]) || 0));
}

/* =========================
 * ✅ 類別表（排班/老點/總計）：由 detail cache 計算（依開始/結束日期）
 * ========================= */

function buildCardsFromDetailCache_(detailRows) {
  const rows = Array.isArray(detailRows) ? detailRows : [];

  const initCard = () => ({ 單數: 0, 筆數: 0, 數量: 0, 金額: 0, _orders: new Set() });

  const cards = {
    排班: initCard(),
    老點: initCard(),
    總計: initCard(),
  };

  function bucket_(r) {
    const v1 = String((r && r["拉牌"]) || "").trim();
    const v2 = String((r && r["服務項目"]) || "").trim();
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
    const n1 = norm(v1);
    const n2 = norm(v2);
    const oldTokens = ["老", "老點", "old", "vip"];
    for (const t of oldTokens) {
      if (n1.indexOf(t) !== -1 || n2.indexOf(t) !== -1) return "老點";
    }
    return "排班";
  }

  function getQty_(r) {
    // 固定 qty
    if (PERF_CARD_QTY_MODE === "minutes") return Number((r && r["分鐘"]) ?? 0) || 0;
    return parseQty_(r && r["數量"]);
  }

  for (const r of rows) {
    const b = bucket_(r);

    const orderNo = String((r && r["訂單編號"]) || "").trim();
    const qty = getQty_(r);
    const amount = parseMoney_(r && (r["小計"] ?? r["業績金額"]));

    // 總計
    cards.總計.筆數 += 1;
    cards.總計.數量 += qty;
    cards.總計.金額 += amount;
    if (orderNo) cards.總計._orders.add(orderNo);

    // 分類（排班/老點）
    const c = cards[b];
    c.筆數 += 1;
    c.數量 += qty;
    c.金額 += amount;
    if (orderNo) c._orders.add(orderNo);
  }

  // 單數：訂單編號去重
  for (const k of ["排班", "老點", "總計"]) {
    const c = cards[k];
    c.單數 = c._orders.size;
    delete c._orders;
  }

  // ✅ 數量保留 0.5 / 1.5 的小數，不要硬 round
  return cards;
}

/* =========================
 * Cache keys
 * ========================= */

function makePerfSummaryKey_(techNo) {
  return `${String(techNo || "").trim()}:LATEST_SUMMARY`;
}

/** ✅ Detail 快取 key 不綁 range：同一師傅只有一份 allRows 原料快取 */
function makePerfDetailKey_(techNo) {
  return `${String(techNo || "").trim()}:DETAIL_CACHE`;
}

/* =========================
 * ✅ Cache read helpers（依開始/結束日期取 rows）
 * ========================= */

function getCachedAllRows_(techNo) {
  const detailKey = makePerfDetailKey_(techNo);
  const ok =
    perfCache_.detailKey === detailKey &&
    !!perfCache_.detail &&
    perfCache_.detail.techNo === techNo &&
    Array.isArray(perfCache_.detail.allRows) &&
    perfCache_.detail.allRows.length > 0;
  return ok ? perfCache_.detail : null;
}

/** ✅ 以快取 allRows 依 start/end 取出「要顯示」的 rows */
function getRowsForRangeFromCache_(techNo, startKey, endKey) {
  const c = getCachedAllRows_(techNo);
  if (!c) return { ok: false, allRows: [], rows: [], maxKey: "", lastUpdatedAt: "" };

  const allRows = c.allRows || [];
  const maxKey = c.maxKey || getMaxDetailDateKey_(allRows);
  const rows = filterDetailRowsByRange_(allRows, startKey, endKey, maxKey);

  return { ok: true, allRows, rows, maxKey, lastUpdatedAt: c.lastUpdatedAt || "" };
}

/* =========================
 * ✅ 三卡：GAS Summary 可用判斷（保留：仍可顯示「最後更新」來源）
 * ========================= */

function hasGasCards_(summaryObj) {
  if (!summaryObj || typeof summaryObj !== "object") return false;
  const cats = ["排班", "老點", "總計"];
  for (const c of cats) {
    const card = summaryObj[c];
    if (!card || typeof card !== "object") return false;
    if (card.單數 !== undefined || card.筆數 !== undefined || card.數量 !== undefined || card.金額 !== undefined) return true;
  }
  return false;
}

/* =========================
 * ✅ Latest Summary Compare / Choose（保留抓取與 debug）
 * ========================= */

function hasSummaryData_(x) {
  if (!x || !x.ok || x.empty) return false;
  const s = x.summaryObj;
  if (!s || typeof s !== "object") return false;
  return !!(s["排班"] || s["老點"] || s["總計"]);
}

function parseTpeLastUpdatedMs_(s) {
  const v = String(s || "").trim();
  const m = v.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function compareLatest_(a, b) {
  const out = [];
  const sa = (a && a.summaryObj) || null;
  const sb = (b && b.summaryObj) || null;
  if (!sa || !sb) return out;

  const cats = ["排班", "老點", "總計"];
  const fields = ["單數", "筆數", "數量", "金額"];
  for (const c of cats) {
    const ca = sa[c] || {};
    const cb = sb[c] || {};
    for (const f of fields) {
      const va = Number(ca[f] ?? 0) || 0;
      const vb = Number(cb[f] ?? 0) || 0;
      if (va !== vb) out.push({ category: c, field: f, report: va, detailPerf: vb });
    }
  }
  return out;
}

async function fetchLatestSummaryReport_(techNo) {
  if (!config.REPORT_API_URL) throw new Error("CONFIG_REPORT_API_URL_MISSING");

  const q =
    "mode=getLatestSummary_v1" +
    "&techNo=" +
    encodeURIComponent(techNo) +
    "&_ts=" +
    encodeURIComponent(String(Date.now()));

  const url = withQuery(config.REPORT_API_URL, q);
  const raw = await fetchJsonWithTimeout_(url, PERF_FETCH_TIMEOUT_MS, "REPORT_LATEST");

  const ok = !!(raw && raw.ok === true);
  const empty = ok && String(raw.result || "") === "empty";
  const summaryRow = (raw && raw.summaryRow) || null;

  return {
    ok,
    empty,
    source: "REPORT",
    techNo: normalizeTechNo(raw && raw.techNo ? raw.techNo : techNo),
    lastUpdatedAt: String((raw && raw.lastUpdatedAt) || ""),
    dateKey: String((raw && raw.dateKey) || ""),
    summaryObj: normalizeSummaryRowToCards_(summaryRow),
    raw,
  };
}

async function fetchLatestSummaryDetailPerf_(techNo) {
  const baseUrl = config.DETAIL_PERF_API_URL || config.REPORT_API_URL;
  if (!baseUrl) throw new Error("CONFIG_DETAIL_PERF_API_URL_MISSING");

  const q =
    "mode=getLatestSummary_v1" +
    "&techNo=" +
    encodeURIComponent(techNo) +
    "&_ts=" +
    encodeURIComponent(String(Date.now()));

  const url = withQuery(baseUrl, q);
  const raw = await fetchJsonWithTimeout_(url, PERF_FETCH_TIMEOUT_MS, "DETAIL_LATEST");

  const ok = !!(raw && raw.ok === true);
  const empty = ok && String(raw.result || "") === "empty";
  const summaryRow = (raw && raw.summaryRow) || null;

  return {
    ok,
    empty,
    source: "DETAIL_PERF",
    techNo: normalizeTechNo(raw && raw.techNo ? raw.techNo : techNo),
    lastUpdatedAt: String((raw && raw.lastUpdatedAt) || ""),
    rangeKey: String((raw && raw.rangeKey) || ""),
    summaryObj: normalizeSummaryRowToCards_(summaryRow),
    raw,
  };
}

function normalizeSummaryRowToCards_(summaryRow) {
  if (!summaryRow || typeof summaryRow !== "object") return null;
  if (summaryRow["排班"] && summaryRow["老點"] && summaryRow["總計"]) return summaryRow;

  const hasAny =
    summaryRow["排班_單數"] !== undefined ||
    summaryRow["老點_單數"] !== undefined ||
    summaryRow["總計_單數"] !== undefined ||
    summaryRow["總計_金額"] !== undefined;

  if (!hasAny) return null;

  const coerceCard = (prefix) => ({
    單數: Number(summaryRow[`${prefix}_單數`] ?? 0) || 0,
    筆數: Number(summaryRow[`${prefix}_筆數`] ?? 0) || 0,
    數量: Number(summaryRow[`${prefix}_數量`] ?? 0) || 0,
    金額: Number(summaryRow[`${prefix}_金額`] ?? 0) || 0,
  });

  return {
    排班: coerceCard("排班"),
    老點: coerceCard("老點"),
    總計: coerceCard("總計"),
  };
}

async function fetchAndCompareLatestSummaries_(techNo) {
  const [a, b] = await Promise.allSettled([fetchLatestSummaryReport_(techNo), fetchLatestSummaryDetailPerf_(techNo)]);
  const reportLatest = a.status === "fulfilled" ? a.value : { ok: false, error: String(a.reason || "REPORT_LATEST_FAILED") };
  const detailLatest = b.status === "fulfilled" ? b.value : { ok: false, error: String(b.reason || "DETAIL_LATEST_FAILED") };

  const reportHas = hasSummaryData_(reportLatest);
  const detailHas = hasSummaryData_(detailLatest);

  let chosen = null;
  let chosenSource = "";

  if (reportHas && detailHas) {
    const rm = parseTpeLastUpdatedMs_(reportLatest.lastUpdatedAt);
    const dm = parseTpeLastUpdatedMs_(detailLatest.lastUpdatedAt);
    const pickReport = rm >= dm;
    chosen = pickReport ? reportLatest : detailLatest;
    chosenSource = pickReport ? "REPORT" : "DETAIL_PERF";
  } else if (reportHas) {
    chosen = reportLatest;
    chosenSource = "REPORT";
  } else if (detailHas) {
    chosen = detailLatest;
    chosenSource = "DETAIL_PERF";
  }

  let diffs = [];
  if (PERF_COMPARE_LATEST_ENABLED && reportHas && detailHas) diffs = compareLatest_(reportLatest, detailLatest);

  if (PERF_COMPARE_LATEST_DEBUG) {
    console.table([
      {
        techNo,
        REPORT_ok: !!reportLatest.ok,
        REPORT_empty: !!reportLatest.empty,
        REPORT_lastUpdatedAt: reportLatest.lastUpdatedAt || "",
        REPORT_dateKey: reportLatest.dateKey || "",
        REPORT_hasData: reportHas,
        DETAIL_ok: !!detailLatest.ok,
        DETAIL_empty: !!detailLatest.empty,
        DETAIL_lastUpdatedAt: detailLatest.lastUpdatedAt || "",
        DETAIL_rangeKey: detailLatest.rangeKey || "",
        DETAIL_hasData: detailHas,
        CHOSEN: chosenSource || "NONE",
        DIFFS: diffs.length,
      },
    ]);
    if (diffs.length) console.log("[Performance] Latest Summary DIFFS:", diffs);
  }

  return { reportLatest, detailLatest, diffs, chosen, chosenSource, reportHas, detailHas };
}

/* =========================
 * Render from cache
 * ========================= */

async function renderFromCache_(mode, info) {
  const m = mode === "summary" ? "summary" : "detail";
  perfSelectedMode_ = m;

  const techNo = normalizeTechNo(state.myMaster && state.myMaster.techNo);
  if (!techNo) {
    setBadge_("你不是師傅（無法查詢）", true);
    setMeta_("—");
    if (dom.perfSummaryRowsEl) dom.perfSummaryRowsEl.innerHTML = summaryNotLoadedHtml_();

    const tbl = dom.perfSummaryRowsEl?.closest("table");
if (tbl) tbl.classList.add("perf-summary-table");
    if (m === "detail") {
      renderDetailHeader_("detail");
      renderDetailRows_([]);
    } else {
      renderDetailHeader_("summary");
      applyDetailTableHtml_("", 0);
    }
    return { ok: false, error: "NOT_MASTER" };
  }

  const r = info && info.ok ? info : readRangeFromInputs_();
  if (!r || !r.ok) {
    setBadge_(r && r.error === "MISSING_START" ? "請選擇開始日期" : "日期格式不正確", true);
    setMeta_("—");
    if (dom.perfSummaryRowsEl) dom.perfSummaryRowsEl.innerHTML = summaryNotLoadedHtml_();

    if (m === "detail") {
      renderDetailHeader_("detail");
      renderDetailRows_([]);
    } else {
      renderDetailHeader_("summary");
      applyDetailTableHtml_("", 0);
    }
    return { ok: false, error: r ? r.error : "BAD_RANGE" };
  }

  const got = getRowsForRangeFromCache_(techNo, r.startKey, r.endKey);
  const hasCache = !!got.ok;

  // ✅ Meta：優先 Summary，再 Detail
  const gasLast = perfCache_.summary && perfCache_.summary.lastUpdatedAt ? String(perfCache_.summary.lastUpdatedAt) : "";
  const detLast = hasCache && got.lastUpdatedAt ? String(got.lastUpdatedAt) : "";
  if (gasLast) setMeta_(`最後更新：${gasLast}（Summary）`);
  else if (detLast) setMeta_(`最後更新：${detLast}（Detail）`);
  else setMeta_("最後更新：—");

  // 顯示「當月」老點率 / 排班率（用 detail cache 計算；三卡類別表已改用 got.rows）
  try {
    const monthStart = localDateKeyMonthStart_();
    const monthEnd = localDateKeyToday_();
    const monthGot = getRowsForRangeFromCache_(techNo, monthStart, monthEnd);
    if (dom.perfMonthRatesEl) {
      if (monthGot && monthGot.ok && Array.isArray(monthGot.rows) && monthGot.rows.length) {
        const monthCards = buildCardsFromDetailCache_(monthGot.rows);

        const totalRows = monthCards && monthCards.總計 ? Number(monthCards.總計.筆數 || 0) : 0;
        const oldRows = monthCards && monthCards.老點 ? Number(monthCards.老點.筆數 || 0) : 0;
        const schedRows = monthCards && monthCards.排班 ? Number(monthCards.排班.筆數 || 0) : 0;
        const oldRateRows = totalRows ? Math.round((oldRows / totalRows) * 1000) / 10 : 0;
        const schedRateRows = totalRows ? Math.round((schedRows / totalRows) * 1000) / 10 : 0;

        const totalSingles = monthCards && monthCards.總計 ? Number(monthCards.總計.單數 || 0) : 0;
        const oldSingles = monthCards && monthCards.老點 ? Number(monthCards.老點.單數 || 0) : 0;
        const schedSingles = monthCards && monthCards.排班 ? Number(monthCards.排班.單數 || 0) : 0;
        const oldRateSingles = totalSingles ? Math.round((oldSingles / totalSingles) * 1000) / 10 : 0;
        const schedRateSingles = totalSingles ? Math.round((schedSingles / totalSingles) * 1000) / 10 : 0;

        dom.perfMonthRatesEl.innerHTML =
          `本月（單數）：老點率 ${oldRateSingles}% ｜ 排班率 ${schedRateSingles}%` +
          `<br/>` +
          `本月（筆數）：老點率 ${oldRateRows}% ｜ 排班率 ${schedRateRows}%`;
      } else {
        dom.perfMonthRatesEl.textContent = "本月：資料不足";
      }
    }
  } catch (e) {
    console.error("render month rates error", e);
  }

  // ✅✅✅ 類別表：依「開始/結束日期」變動（用 got.rows 計算）
  if (dom.perfSummaryRowsEl) {
    if (hasCache && Array.isArray(got.rows) && got.rows.length) {
      const rangeCards = buildCardsFromDetailCache_(got.rows);
      dom.perfSummaryRowsEl.innerHTML = summaryRowsHtml_(rangeCards);
    } else {
      dom.perfSummaryRowsEl.innerHTML = hasCache
        ? '<tr><td colspan="5" style="color:var(--text-sub);">此區間無資料。</td></tr>'
        : summaryNotLoadedHtml_();
    }
  }

  if (!hasCache) setBadge_("明細尚未載入（等待登入預載 / 或按手動重整）", true);
  else setBadge_("已載入（快取依日期即時切換）", false);

  if (m === "summary") {
    renderDetailHeader_("summary");
    const baseForSummary = hasCache ? got.rows : [];
    if (baseForSummary.length) {
      const summaryRows = buildServiceSummaryFromDetail_(baseForSummary);
      const tmp = detailSummaryRowsHtml_(summaryRows);
      applyDetailTableHtml_(tmp.html, tmp.count);
      try {
        updatePerfChart_(baseForSummary, r.dateKeys);
      } catch (_) {}
    } else {
      applyDetailTableHtml_("", 0);
      clearPerfChart_();
    }
    return { ok: true, rendered: "summary", cached: hasCache };
  }

  // detail mode
  renderDetailHeader_("detail");
  if (hasCache) {
    const tmp = detailRowsHtml_(got.rows);
    applyDetailTableHtml_(tmp.html, tmp.count);
    try {
      updatePerfChart_(got.rows, r.dateKeys);
    } catch (_) {}
    return { ok: true, rendered: "detail", cached: true };
  }

  renderDetailRows_([]);
  clearPerfChart_();
  return { ok: false, rendered: "detail", cached: false };
}

/* =========================
 * Reload / cache（手動重整才抓）
 * ========================= */

function sleep_(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function reloadAndCache_(info, { showToast = true, fetchSummary = true, fetchDetail = true } = {}) {
  const techNo = normalizeTechNo((info && info.techNo) || (state.myMaster && state.myMaster.techNo));
  if (!techNo) return { ok: false, error: "NOT_MASTER" };

  const r = fetchDetail ? (info && info.ok ? info : readRangeFromInputs_()) : { ok: true, techNo };
  if (fetchDetail && (!r || !r.ok)) return { ok: false, error: (r && r.error) || "BAD_RANGE" };

  const summaryKey = makePerfSummaryKey_(techNo);
  const detailKey = makePerfDetailKey_(techNo);

  if (fetchSummary && perfCache_.summaryKey !== summaryKey) perfCache_.summary = null;
  if (fetchDetail && perfCache_.detailKey !== detailKey) perfCache_.detail = null;

  perfCache_.summaryKey = summaryKey;
  perfCache_.detailKey = detailKey;

  if (showToast) hideLoadingHint();

  const summaryP = fetchSummary
    ? (async () => {
        if (showToast) showLoadingHint(`查詢業績統計中…（兩張 GAS 最新 Summary）`);

        let cmp = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            cmp = await fetchAndCompareLatestSummaries_(techNo);
            break;
          } catch (e) {
            if (attempt === 0) await sleep_(400);
            else throw e;
          }
        }

        const chosen = cmp && cmp.chosen ? cmp.chosen : null;
        const summaryObj = chosen ? chosen.summaryObj || null : null;

        return {
          meta: `最後更新：${chosen && chosen.lastUpdatedAt ? chosen.lastUpdatedAt : "—"}`,
          summaryObj,
          summaryHtml: summaryRowsHtml_(summaryObj),
          source: chosen ? chosen.source : "NONE",
          lastUpdatedAt: chosen && chosen.lastUpdatedAt ? String(chosen.lastUpdatedAt) : "",
        };
      })()
    : Promise.resolve({ skipped: true });

  const detailP = fetchDetail
    ? (async () => {
        let rr = null;
        let lastErr = "";

        for (let attempt = 0; attempt < 3; attempt++) {
          if (showToast) showLoadingHint(`查詢業績明細中…（${attempt + 1}/3）`);
          const raw = await fetchDetailPerf_(techNo, r.startKey, r.endKey);
          rr = normalizeDetailPerfResponse_(raw);
          if (rr.ok) break;

          lastErr = String(rr.error || "BAD_RESPONSE");
          if (lastErr === "LOCKED_TRY_LATER" && attempt < 2) {
            await sleep_(900 + attempt * 600);
            continue;
          }
          break;
        }

        if (!rr || !rr.ok) throw new Error(lastErr || "BAD_RESPONSE");

        const rowsAll = Array.isArray(rr.detail) ? rr.detail : [];
        const maxKey = getMaxDetailDateKey_(rowsAll);

        return {
          meta: `最後更新：${rr.lastUpdatedAt ? rr.lastUpdatedAt : "—"}`,
          techNo,
          lastUpdatedAt: rr.lastUpdatedAt || "",
          summaryObj: rr.summary || null,
          summaryHtml: summaryRowsHtml_(rr.summary || null),
          allRows: rowsAll,
          maxKey,
        };
      })()
    : Promise.resolve({ skipped: true });

  try {
    const [sumRes, detRes] = await Promise.allSettled([summaryP, detailP]);

    if (sumRes.status === "fulfilled") {
      const v = sumRes.value;
      if (!(v && v.skipped)) {
        perfCache_.summary = {
          meta: v.meta,
          summaryObj: v.summaryObj || null,
          summaryHtml: v.summaryHtml || summaryRowsHtml_(v.summaryObj || null),
          source: v.source || "",
          lastUpdatedAt: v.lastUpdatedAt || "",
        };
      }
    }

    if (detRes.status === "fulfilled") {
      const v = detRes.value;
      if (!(v && v.skipped)) perfCache_.detail = v;
    }

    if (!perfCache_.summary && !perfCache_.detail) {
      const err = [sumRes, detRes]
        .map((x) => (x.status === "rejected" ? String(x.reason && x.reason.message ? x.reason.message : x.reason) : ""))
        .filter(Boolean)[0];
      throw new Error(err || "RELOAD_FAILED");
    }

    return {
      ok: true,
      summaryKey: perfCache_.summaryKey,
      detailKey: perfCache_.detailKey,
      partial: !(perfCache_.summary && (fetchDetail ? perfCache_.detail : true)),
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  } finally {
    if (showToast) hideLoadingHint();
  }
}

/* =========================
 * Normalize responses
 * ========================= */

function normalizeDetailPerfResponse_(data) {
  if (!data || data.ok !== true) return { ok: false, error: (data && data.error) || "UNKNOWN" };

  const hasRows = data.summaryRow || data.summary || data.detailRows || data.detail;
  const hint = String(data.hint || "");
  if (!hasRows && hint) return { ok: false, error: "GAS_HINT_ONLY" };

  const techNo = normalizeTechNo(data.techNo || data.masterId || data.tech || "");
  const lastUpdatedAt = String(data.lastUpdatedAt || data.updatedAt || "");
  const updateCount = Number(data.updateCount || 0) || 0;

  const summaryRow = data.summaryRow || data.summary || null;
  const detailRows = data.detailRows || data.detail || [];

  const coerceCard = (prefix) => ({
    單數: Number((summaryRow && summaryRow[`${prefix}_單數`]) ?? 0) || 0,
    筆數: Number((summaryRow && summaryRow[`${prefix}_筆數`]) ?? 0) || 0,
    數量: Number((summaryRow && summaryRow[`${prefix}_數量`]) ?? 0) || 0,
    金額: Number((summaryRow && summaryRow[`${prefix}_金額`]) ?? 0) || 0,
  });

  let summaryObj = summaryRow;

  if (summaryRow && !summaryRow["排班"] && (summaryRow["排班_單數"] !== undefined || summaryRow["總計_金額"] !== undefined)) {
    summaryObj = { 排班: coerceCard("排班"), 老點: coerceCard("老點"), 總計: coerceCard("總計") };
  }

  return {
    ok: true,
    techNo,
    lastUpdatedAt,
    updateCount,
    summary: summaryObj,
    detail: Array.isArray(detailRows) ? detailRows : [],
  };
}

/* =========================
 * Fetch
 * ========================= */

async function fetchDetailPerf_(techNo, startKey, endKey) {
  const baseUrl = config.DETAIL_PERF_API_URL || config.REPORT_API_URL;
  if (!baseUrl) throw new Error("CONFIG_DETAIL_PERF_API_URL_MISSING");

  const q =
    "mode=getDetailPerf_v1" +
    "&techNo=" +
    encodeURIComponent(techNo) +
    "&startKey=" +
    encodeURIComponent(startKey) +
    "&endKey=" +
    encodeURIComponent(endKey) +
    "&_ts=" +
    encodeURIComponent(String(Date.now()));

  const url = withQuery(baseUrl, q);
  return await fetchJsonWithTimeout_(url, PERF_FETCH_TIMEOUT_MS, "DETAIL_PERF");
}

async function fetchJsonWithTimeout_(url, timeoutMs, tag) {
  const ms = Number(timeoutMs);
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : PERF_FETCH_TIMEOUT_MS;

  if (typeof AbortController === "undefined") {
    const resp = await fetch(url, { method: "GET", cache: "no-store" });
    if (!resp.ok) throw new Error(`${tag}_HTTP_${resp.status}`);
    return await resp.json();
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), safeMs);
  try {
    const resp = await fetch(url, { method: "GET", cache: "no-store", signal: ctrl.signal });
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
 * Public Exports
 * ========================= */

export function togglePerformanceCard() {
  // 由外部控制 perfCard 顯示/隱藏（你原本若有實作，可自行補回）
}

export function initPerformanceUi() {
  ensureDefaultDate_();

  // ✅ chart prefs (optional)
  try {
    loadPerfChartPrefs_();
  } catch (_) {}

  if (dom.perfSearchBtn) dom.perfSearchBtn.addEventListener("click", () => void renderFromCache_("summary"));
  if (dom.perfSearchSummaryBtn) dom.perfSearchSummaryBtn.addEventListener("click", () => void renderFromCache_("summary"));
  if (dom.perfSearchDetailBtn) dom.perfSearchDetailBtn.addEventListener("click", () => void renderFromCache_("detail"));

  const onDateInputsChanged = () => {
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

  // ✅ optional chart mode buttons (if exists)
  try {
    const btnDaily = document.getElementById("perfChartModeDaily");
    const btnCumu = document.getElementById("perfChartModeCumu");
    const btnMA7 = document.getElementById("perfChartModeMA7");
    const btnReset = document.getElementById("perfChartReset");

    const setActive = () => {
      const all = [btnDaily, btnCumu, btnMA7].filter(Boolean);
      for (const b of all) b.classList.remove("is-active");
      const map = { daily: btnDaily, cumu: btnCumu, ma7: btnMA7 };
      const active = map[perfChartMode_];
      if (active) active.classList.add("is-active");
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

  // ✅ optional chart toggles (if exists)
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

      // not allow all off
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
      window.addEventListener("resize", () => {
        try {
          schedulePerfChartRedraw_();
        } catch (e) {
          console.error("perf resize handler error", e);
        }
      });
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

  // ✅ ResizeObserver：perfCard 顯示/容器寬度變動也會觸發重畫
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
 * ✅ 登入時預載：同時預載「最新 Summary + Detail」到快取
 */
export async function prefetchPerformanceOnce() {
  if (String(state.feature && state.feature.performanceEnabled) !== "是") {
    return { ok: false, skipped: "FEATURE_OFF" };
  }

  if (perfPrefetchInFlight_) return perfPrefetchInFlight_;

  perfPrefetchInFlight_ = (async () => {
    ensureDefaultDate_();

    const info = readRangeFromInputs_();
    if (!info.ok) return { ok: false, skipped: info.error || "BAD_RANGE" };

    const res = await reloadAndCache_(info, {
      showToast: false,
      fetchSummary: true,
      fetchDetail: true,
    });

    return { ok: !!(res && res.ok), ...res, prefetched: "SUMMARY_AND_DETAIL" };
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
  if (String(state.feature && state.feature.performanceEnabled) !== "是") return { ok: false, skipped: "FEATURE_OFF" };
  ensureDefaultDate_();

  const info = readRangeFromInputs_();
  if (!info.ok) {
    if (info.error === "NOT_MASTER") setBadge_("你不是師傅（無法查詢）", true);
    else if (info.error === "MISSING_START") setBadge_("請選擇開始日期", true);
    else if (info.error === "RANGE_TOO_LONG") setBadge_("日期區間過長（最多 31 天）", true);
    else setBadge_("日期格式不正確", true);
    return { ok: false, error: info.error || "BAD_RANGE" };
  }

  setBadge_("同步中…", false);

  const res = await reloadAndCache_(info, { showToast: !!showToast, fetchSummary: true, fetchDetail: true });
  if (!res || !res.ok) {
    const msg = String(res && res.error ? res.error : "RELOAD_FAILED");
    if (msg.includes("CONFIG_REPORT_API_URL_MISSING")) setBadge_("尚未設定 REPORT_API_URL", true);
    else if (msg.includes("CONFIG_DETAIL_PERF_API_URL_MISSING")) setBadge_("尚未設定 DETAIL_PERF_API_URL", true);
    else if (msg.includes("LOCKED_TRY_LATER")) setBadge_("系統忙碌，請稍後再試", true);
    else if (msg.includes("TIMEOUT")) setBadge_("查詢逾時，請稍後再試", true);
    else setBadge_("同步失敗", true);
    return res;
  }

  showError_(false);
  return await renderFromCache_(perfSelectedMode_, info);
}

export function onShowPerformance() {
  ensureDefaultDate_();
  showError_(false);
  void renderFromCache_(perfSelectedMode_);
  hideLoadingHint();

  // perfCard 剛顯示時補一次重畫
  try {
    schedulePerfChartRedraw_();
  } catch (_) {}
}
