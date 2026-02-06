/* ================================
 * Admin - 業績查詢（移植自 Scheduling/performance.js）
 * - 使用 GAS syncStorePerf_v1
 * - 使用 admin config.json 的 PERF_SYNC_API_URL
 * - 不依賴模組系統（全域函式）
 * ================================ */

// DOM cache (performance panel only)
const dom = {
  perfTechNoSelect: document.getElementById("perfTechNoSelect"),
  perfDateStartInput: document.getElementById("perfDateStart"),
  perfDateEndInput: document.getElementById("perfDateEnd"),
  perfChartEl: document.getElementById("perfChart"),

  perfDateKeyInput: document.getElementById("perfDateKey"),
  perfSearchBtn: document.getElementById("perfSearch"),
  perfSearchSummaryBtn: document.getElementById("perfSearchSummary"),
  perfSearchDetailBtn: document.getElementById("perfSearchDetail"),
  perfStatusEl: document.getElementById("perfStatus"),
  perfMetaEl: document.getElementById("perfMeta"),
  perfMonthRatesEl: document.getElementById("perfMonthRates"),
  perfSummaryRowsEl: document.getElementById("perfSummaryRows"),
  perfDetailHeadRowEl: document.getElementById("perfDetailHeadRow"),
  perfDetailRowsEl: document.getElementById("perfDetailRows"),
  perfEmptyEl: document.getElementById("perfEmpty"),
  perfErrorEl: document.getElementById("perfError"),
  perfDetailCountEl: document.getElementById("perfDetailCount"),
};

const PERF_FETCH_TIMEOUT_MS = 25000;
const PERF_MAX_RANGE_DAYS = 93;
const PERF_CARD_QTY_MODE = "qty";
const PERF_CHART_VIS_KEY = "admin_perf_chart_vis_v1";
const PERF_CHART_MODE_KEY = "admin_perf_chart_mode_v1";

let perfSelectedMode_ = "detail";
let perfPrefetchInFlight_ = null;
let perfSelectedTechNo_ = "";

const perfCache_ = {
  key: "",
  lastUpdatedAt: "",
  detailRows: [],
  cards: null,
  serviceSummary: [],
};

let perfChartInstance_ = null;
let perfChartLastRows_ = null;
let perfChartLastDateKeys_ = null;
let perfChartResizeTimer_ = null;
let perfChartRO_ = null;

const perfDragState_ = {
  enabled: false,
  pointerDown: false,
  startX: 0,
  startScrollLeft: 0,
  handlers: null,
};

const PERF_CURRENCY_FMT = (() => {
  try {
    return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
  } catch (_) {
    return null;
  }
})();

function perfEscapeHtml_(s) {
  if (typeof escapeHtml === "function") return escapeHtml(s);
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function perfGetQueryParam_(k) {
  try {
    const u = new URL(location.href);
    return u.searchParams.get(k) || "";
  } catch {
    return "";
  }
}

function perfWithQuery_(base, extraQuery) {
  const b = String(base || "").trim();
  const q = String(extraQuery || "").trim();
  if (!b) return "";
  if (!q) return b;
  return b + (b.includes("?") ? "&" : "?") + q.replace(/^\?/, "");
}

function perfGetSyncUrl_() {
  return typeof PERF_SYNC_API_URL === "string" ? PERF_SYNC_API_URL.trim() : "";
}

function perfGetApiBaseUrl_() {
  return typeof API_BASE_URL === "string" ? API_BASE_URL.trim() : "";
}

function showLoadingHint(text) {
  setBadge_(text || "同步中…", false);
}

function hideLoadingHint() {
  // no-op (admin 無頂部 toast)
}

function fmtMoney_(n) {
  const v = Number(n || 0) || 0;
  if (PERF_CURRENCY_FMT) return PERF_CURRENCY_FMT.format(v);
  return String(Math.round(v));
}

function parseQty_(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;

  let s = String(v).trim();
  if (!s) return 0;

  s = s.replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xff10)).replace(/．/g, ".").replace(/－/g, "-");
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
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

function getTechNo_() {
  if (perfSelectedTechNo_) return String(perfSelectedTechNo_ || "").trim();
  const v = String(dom.perfTechNoSelect?.value || "").trim();
  return v;
}

async function loadTechNoOptions_() {
  if (!dom.perfTechNoSelect) return { ok: false, error: "NO_SELECT" };
  const apiBase = perfGetApiBaseUrl_();
  if (!apiBase) return { ok: false, error: "MISSING_API_BASE_URL" };

  try {
    const url = new URL(apiBase);
    url.searchParams.set("mode", "listTechNos");
    url.searchParams.set("_ts", String(Date.now()));

    const res = await fetch(url.toString(), { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!data || data.ok !== true) throw new Error(data?.error || "listTechNos failed");

    const list = Array.isArray(data.techNos) ? data.techNos : [];
    const options = [
      { value: "", text: "請選擇" },
      ...list.map((v) => ({ value: String(v), text: String(v) })),
    ];

    dom.perfTechNoSelect.innerHTML = options
      .map((o) => `<option value="${perfEscapeHtml_(o.value)}">${perfEscapeHtml_(o.text)}</option>`)
      .join("");

    return { ok: true, count: list.length };
  } catch (e) {
    console.warn("loadTechNoOptions_ failed", e);
    return { ok: false, error: String(e?.message || e) };
  }
}

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

  // 參照 Scheduling：不持久化日期，空值時填入「本月 1 號 ~ 今天」
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
  const techNo = getTechNo_();

  const startRaw = String(dom.perfDateStartInput?.value || "").trim();
  const endRaw = String(dom.perfDateEndInput?.value || "").trim();

  const startKey = normalizeInputDateKey_(startRaw);
  const endKey = normalizeInputDateKey_(endRaw || startRaw);

  if (!techNo) return { ok: false, error: "MISSING_TECHNO", techNo: "", startKey, endKey };
  if (!startKey) return { ok: false, error: "MISSING_START", techNo, startKey, endKey };

  const range = normalizeRange_(startKey, endKey, PERF_MAX_RANGE_DAYS);
  if (!range.ok) return { ok: false, error: range.error || "BAD_RANGE", techNo, startKey, endKey };

  if (dom.perfDateStartInput && dom.perfDateStartInput.value !== range.normalizedStart) dom.perfDateStartInput.value = range.normalizedStart;
  if (dom.perfDateEndInput && dom.perfDateEndInput.value !== range.normalizedEnd) dom.perfDateEndInput.value = range.normalizedEnd;

  return { ok: true, techNo, from: range.normalizedStart, to: range.normalizedEnd, dateKeys: range.dateKeys };
}

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
  if (dom.perfDetailCountEl) dom.perfDetailCountEl.textContent = `${Number(n || 0)} 筆`;
}

function summaryNotLoadedHtml_() {
  return `<tr><td colspan="5" style="color:var(--text-sub);">請先查詢。</td></tr>`;
}

function summaryRowsHtml_(cards3) {
  if (!cards3) return `<tr><td colspan="5" style="color:var(--text-sub);">請先查詢。</td></tr>`;

  const get = (k) => cards3[k] || { 單數: 0, 筆數: 0, 數量: 0, 金額: 0 };
  const total = get("總計");
  const old = get("老點");
  const sched = get("排班");

  const rows = [
    ["排班", sched.單數, sched.筆數, sched.數量, sched.金額],
    ["老點", old.單數, old.筆數, old.數量, old.金額],
    ["總計", total.單數, total.筆數, total.數量, total.金額],
  ];

  return rows
    .map(
      (r) => `
      <tr>
        <td>${perfEscapeHtml_(r[0])}</td>
        <td>${fmtMoney_(r[1])}</td>
        <td>${fmtMoney_(r[2])}</td>
        <td>${fmtMoney_(r[3])}</td>
        <td>${fmtMoney_(r[4])}</td>
      </tr>
    `
    )
    .join("");
}

function detailRowsHtml_(detailRows) {
  const list = Array.isArray(detailRows) ? detailRows : [];
  if (!list.length) return { html: "", count: 0 };
  const headers = [
    "訂單日期",
    "訂單編號",
    "序",
    "拉牌",
    "服務項目",
    "業績金額",
    "抽成金額",
    "數量",
    "小計",
    "分鐘",
    "開工",
    "完工",
    "狀態",
  ];

  const td = (label, v) => `<td data-label="${perfEscapeHtml_(label)}">${perfEscapeHtml_(String(v ?? ""))}</td>`;
  return {
    count: list.length,
    html: list
      .map((r) => {
        const dateText = String(r["訂單日期"] ?? "").replace(/-/g, "/");
        return (
          "<tr>" +
          td(headers[0], dateText) +
          td(headers[1], r["訂單編號"] || "") +
          td(headers[2], r["序"] ?? "") +
          td(headers[3], r["拉牌"] || "") +
          td(headers[4], r["服務項目"] || "") +
          td(headers[5], r["業績金額"] ?? 0) +
          td(headers[6], r["抽成金額"] ?? 0) +
          td(headers[7], r["數量"] ?? 0) +
          td(headers[8], r["小計"] ?? 0) +
          td(headers[9], r["分鐘"] ?? 0) +
          td(headers[10], r["開工"] ?? "") +
          td(headers[11], r["完工"] ?? "") +
          td(headers[12], r["狀態"] || "") +
          "</tr>"
        );
      })
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

  const td = (label, v) => `<td data-label="${perfEscapeHtml_(label)}">${perfEscapeHtml_(String(v ?? ""))}</td>`;
  return {
    count: list.length,
    html: list
      .map((r) => "<tr>" + headers.map((h) => td(h, r[h] ?? 0)).join("") + "</tr>")
      .join(""),
  };
}

function applyDetailTableHtml_(html, count) {
  if (!dom.perfDetailRowsEl) return;
  dom.perfDetailRowsEl.innerHTML = html || "";
  setDetailCount_(count || 0);
  showEmpty_(!html);
}

function renderDetailHeader_(mode) {
  if (!dom.perfDetailHeadRowEl) return;
  if (mode === "summary") {
    dom.perfDetailHeadRowEl.innerHTML = `
      <th>服務項目</th>
      <th>總筆數</th>
      <th>總節數</th>
      <th>總計金額</th>
      <th>老點筆數</th>
      <th>老點節數</th>
      <th>老點金額</th>
      <th>排班筆數</th>
      <th>排班節數</th>
      <th>排班金額</th>
    `;
  } else {
    dom.perfDetailHeadRowEl.innerHTML = `
      <th>訂單日期</th>
      <th>訂單編號</th>
      <th>序</th>
      <th>拉牌</th>
      <th>服務項目</th>
      <th>業績金額</th>
      <th>抽成金額</th>
      <th>數量</th>
      <th>小計</th>
      <th>分鐘</th>
      <th>開工</th>
      <th>完工</th>
      <th>狀態</th>
    `;
  }
}

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
    if (!r) continue;
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
        單數: parseQty_(o?.單數 || 0),
        筆數: parseQty_(o?.筆數 || 0),
        數量: parseQty_(o?.數量 || 0),
        金額: parseMoney_(o?.金額 || 0),
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

function applyDetailTableHtmlFrom_(rows, mode) {
  try {
    const table = dom.perfDetailHeadRowEl?.closest("table");
    if (table) {
      const isSummary = mode === "summary";
      table.classList.toggle("perf-detail-table--summary", isSummary);
      table.classList.toggle("perf-detail-table--detail", !isSummary);
    }
  } catch (_) {}
  renderDetailHeader_(mode);
  const tmp = mode === "summary" ? detailSummaryRowsHtml_(rows) : detailRowsHtml_(rows);
  applyDetailTableHtml_(tmp.html, tmp.count);
}

function renderSummaryTable_(cards3) {
  if (!dom.perfSummaryRowsEl) return;
  dom.perfSummaryRowsEl.innerHTML = summaryRowsHtml_(cards3);
  const tbl = dom.perfSummaryRowsEl?.closest("table");
  if (tbl) tbl.classList.add("perf-summary-table");
}

function renderDetailTable_(rows) {
  applyDetailTableHtmlFrom_(rows, "detail");
}

function renderServiceSummaryTable_(serviceSummary, baseRowsForChart, dateKeys) {
  applyDetailTableHtmlFrom_(serviceSummary, "summary");

  if (Array.isArray(baseRowsForChart) && baseRowsForChart.length) {
    try {
      updatePerfChart_(baseRowsForChart, dateKeys);
    } catch (_) {}
  } else {
    clearPerfChart_();
  }
}

function computeMonthRates_(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const looksLikeDetail = list.some((r) => r && (r["訂單編號"] || r["拉牌"] || r["服務項目"]));

  let totalRows = 0;
  let oldRows = 0;
  let schedRows = 0;
  let totalSingles = 0;
  let oldSingles = 0;
  let schedSingles = 0;

  if (looksLikeDetail) {
    const allOrders = new Set();
    const oldOrders = new Set();
    const schedOrders = new Set();

    for (const r of list) {
      if (!r) continue;
      const pull = String(r["拉牌"] || "").trim();
      const orderNo = String(r["訂單編號"] || "").trim();
      const isOld = pull === "老點";

      totalRows += 1;
      if (isOld) oldRows += 1;
      else schedRows += 1; // Scheduling: 非老點一律視為排班

      if (orderNo) {
        allOrders.add(orderNo);
        if (isOld) oldOrders.add(orderNo);
        else schedOrders.add(orderNo);
      }
    }

    totalSingles = allOrders.size;
    oldSingles = oldOrders.size;
    schedSingles = schedOrders.size;
  } else {
    const cards3 = buildCards3FromRows_(list);
    totalRows = Number(cards3?.總計?.筆數 || 0) || 0;
    oldRows = Number(cards3?.老點?.筆數 || 0) || 0;
    schedRows = Number(cards3?.排班?.筆數 || 0) || 0;

    totalSingles = Number(cards3?.總計?.單數 || 0) || 0;
    oldSingles = Number(cards3?.老點?.單數 || 0) || 0;
    schedSingles = Number(cards3?.排班?.單數 || 0) || 0;
  }

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

/* =========================
 * Chart
 * ========================= */
let perfChartMode_ = "daily";
let perfChartVis_ = { amount: true, oldRate: true, schedRate: true };
let perfChartType_ = "line";

function loadPerfChartPrefs_() {
  try {
    const s = localStorage.getItem(PERF_CHART_VIS_KEY);
    if (s) {
      const o = JSON.parse(s);
      perfChartVis_ = {
        // 參照 Scheduling：undefined 視為 true（避免舊版/缺欄位偏好導致全部被關閉）
        amount: o && typeof o === "object" ? o.amount !== false : true,
        oldRate: o && typeof o === "object" ? o.oldRate !== false : true,
        schedRate: o && typeof o === "object" ? o.schedRate !== false : true,
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
    localStorage.setItem(PERF_CHART_MODE_KEY, perfChartMode_);
    localStorage.setItem(PERF_CHART_VIS_KEY + "_type", perfChartType_);
  } catch (_) {}
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
  } catch (_) {
    perfChartInstance_.update();
  }
}

function clearPerfChart_() {
  if (perfChartInstance_) {
    try {
      perfChartInstance_.destroy();
    } catch (_) {}
  }
  perfChartInstance_ = null;
}

function schedulePerfChartRedraw_() {
  if (!perfChartLastRows_ || !perfChartLastDateKeys_) return;
  if (perfChartResizeTimer_) clearTimeout(perfChartResizeTimer_);
  perfChartResizeTimer_ = setTimeout(() => {
    try {
      updatePerfChart_(perfChartLastRows_, perfChartLastDateKeys_);
    } catch (_) {}
  }, 140);
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

/**
 * ✅ Drag-to-scroll（對齊 Scheduling，修正 Intervention warning）
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
        if (ev && ev.cancelable) ev.preventDefault();
      } catch (_) {}
    };

    const onPointerMove = (ev) => {
      if (!perfDragState_.pointerDown) return;
      try {
        const clientX = ev.clientX || (ev.touches && ev.touches[0] && ev.touches[0].clientX) || 0;
        const dx = clientX - perfDragState_.startX;
        if (wrapper) wrapper.scrollLeft = Math.round(perfDragState_.startScrollLeft - dx);
        if (ev && ev.cancelable) ev.preventDefault();
      } catch (_) {}
    };

    const onPointerUp = (ev) => {
      perfDragState_.pointerDown = false;
      try {
        if (ev.pointerId && canvas.releasePointerCapture) canvas.releasePointerCapture(ev.pointerId);
      } catch (_) {}
    };

    const onTouchDown = (ev) => onPointerDown(ev);
    const onTouchMove = (ev) => onPointerMove(ev);
    const onTouchUp = (ev) => onPointerUp(ev);

    canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    canvas.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: true });

    canvas.addEventListener("touchstart", onTouchDown, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchUp, { passive: true });

    perfDragState_.handlers = { down: onPointerDown, move: onPointerMove, up: onPointerUp, tdown: onTouchDown, tmove: onTouchMove, tup: onTouchUp };
    perfDragState_.enabled = true;
  } catch (err) {
    console.error("enableCanvasDragScroll_ error", err);
  }
}

function updatePerfChart_(rows, dateKeys) {
  try {
    if (!dom.perfChartEl) return;
    if (typeof Chart === "undefined") return;

    const keys = Array.isArray(dateKeys) && dateKeys.length ? dateKeys.slice() : [];
    const list = Array.isArray(rows) ? rows : [];

    const metrics = {}; // { dateKey: { amount, totalCount, oldCount, schedCount } }

    // ✅ 對齊 Scheduling：桶判斷只吃「拉牌」欄
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
    if (perfChartMode_ === "cumu") {
      amountData = buildCumulative_(dailyAmount);
      amountLabel = "累積業績";
    } else if (perfChartMode_ === "ma7") {
      amountData = buildMA_(dailyAmount, 7);
      amountLabel = "7日均線";
    }

    clearPerfChart_();

    const ctx = dom.perfChartEl.getContext("2d");
    if (!ctx) return;
    perfChartLastRows_ = list.slice();
    perfChartLastDateKeys_ = Array.isArray(dateKeys) ? dateKeys.slice() : [];

    const wrapperEl = dom.perfChartEl?.closest?.(".chart-wrapper") || dom.perfChartEl?.parentElement;
    const containerWidth = (wrapperEl && wrapperEl.clientWidth) || window.innerWidth || 800;

    const points = labels.length || 1;
    const isNarrow = containerWidth < 420;
    const shouldScroll = points > (isNarrow ? 4 : 6);

    const pxPerPoint = isNarrow ? 64 : 72;
    const desiredWidth = shouldScroll ? Math.max(containerWidth, points * pxPerPoint) : containerWidth;
    const desiredHeight = isNarrow ? 190 : Math.max(200, Math.round(Math.min(320, desiredWidth / 3.2)));

    const baseFontRaw = isNarrow ? 13 : 15;
    const ticksFontRaw = isNarrow ? 12 : 14;
    const scaleFactor = Math.max(0.9, Math.min(1.6, containerWidth / 420));
    const baseFont = Math.round(baseFontRaw * scaleFactor);
    const ticksFont = Math.round(ticksFontRaw * scaleFactor);
    const legendBoxWidth = Math.max(8, Math.round(8 * Math.min(1.4, scaleFactor)));

    const css = window.getComputedStyle ? window.getComputedStyle(document.documentElement) : null;
    const textColor = (() => {
      const v = (css && (css.getPropertyValue("--text-main") || css.getPropertyValue("--text"))) ? (css.getPropertyValue("--text-main") || css.getPropertyValue("--text")).trim() : "";
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
    dom.perfChartEl.style.width = shouldScroll ? `${Math.round(desiredWidth)}px` : "100%";
    dom.perfChartEl.style.height = `${desiredHeight}px`;
    dom.perfChartEl.width = Math.round(desiredWidth * dpr);
    dom.perfChartEl.height = Math.round(desiredHeight * dpr);

    try {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } catch (_) {}

    enableCanvasDragScroll_(shouldScroll);

    const maxXTicks = isNarrow ? 5 : 7;

    try {
      const minW = Math.max(600, labels.length * 40);
      dom.perfChartEl.style.minWidth = `${minW}px`;
    } catch (_) {}

    function showClickDetailPanel(idx) {
      try {
        const w = dom.perfChartEl?.closest?.(".chart-wrapper") || dom.perfChartEl?.parentElement;
        if (!w) return;
        const old = w.querySelector(".perf-click-panel");
        if (old) old.remove();

        const rawKey = labels[idx];
        const m = rawKey ? metrics[rawKey] : null;
        const dateLabel = rawKey ? String(rawKey).replaceAll("-", "/") : "—";

        const panel = document.createElement("div");
        panel.className = "perf-click-panel";
        panel.setAttribute("role", "dialog");

        const rowsForDate = list.filter((r) => {
          const dk = String(r["訂單日期"] || "").replaceAll("/", "-").slice(0, 10);
          return dk === rawKey;
        });

        const amount = m ? fmtMoney_(m.amount) : "0";
        const total = m ? (m.totalCount || 0) : 0;
        const oldC = m ? (m.oldCount || 0) : 0;
        const schC = m ? (m.schedCount || 0) : 0;

        let html = `<div class="perf-click-panel-inner"><div class="perf-click-panel-head"><strong>${perfEscapeHtml_(dateLabel)}</strong><button class="perf-click-panel-close" aria-label="關閉">✕</button></div>`;
        html += `<div class="perf-click-panel-body">`;
        html += `<div class="perf-click-metrics">金額：<strong>${perfEscapeHtml_(String(amount))}</strong>，筆數：<strong>${total}</strong>（老點 ${oldC} / 排班 ${schC}）</div>`;
        if (rowsForDate && rowsForDate.length) {
          html += '<div class="perf-click-list"><table class="status-table small"><thead><tr><th>編號</th><th>拉牌</th><th>服務項目</th><th>小計</th></tr></thead><tbody>';
          const sample = rowsForDate.slice(0, 20);
          for (let i = 0; i < sample.length; i++) {
            const r = sample[i];
            html += `<tr><td>${perfEscapeHtml_(String(r["訂單編號"] || r["序"] || ""))}</td><td>${perfEscapeHtml_(String(r["拉牌"] || ""))}</td><td>${perfEscapeHtml_(String(r["服務項目"] || ""))}</td><td>${perfEscapeHtml_(String(r["小計"] ?? r["業績金額"] ?? ""))}</td></tr>`;
          }
          if (rowsForDate.length > sample.length) html += `<tr><td colspan="4">還有 ${rowsForDate.length - sample.length} 筆，請查明細</td></tr>`;
          html += "</tbody></table></div>";
        } else {
          html += '<div class="perf-click-empty">查無明細</div>';
        }
        html += "</div></div>";
        panel.innerHTML = html;

        w.appendChild(panel);

        const btn = panel.querySelector(".perf-click-panel-close");
        if (btn) btn.addEventListener("click", () => panel.remove());

        const onDocClick = (ev) => {
          if (!panel.contains(ev.target)) {
            panel.remove();
            document.removeEventListener("pointerdown", onDocClick);
          }
        };
        setTimeout(() => document.addEventListener("pointerdown", onDocClick), 50);
      } catch (e) {
        console.error("showClickDetailPanel error", e);
      }
    }

    perfChartInstance_ = new Chart(ctx, {
      data: {
        labels: labels.map((s) => String(s).replaceAll("-", "/")),
        datasets: [
          (function () {
            const common = {
              label: amountLabel,
              data: amountData,
              yAxisID: "y",
            };
            if (perfChartType_ === "bar") {
              return Object.assign({}, common, {
                type: "bar",
                backgroundColor: "rgba(6,182,212,0.16)",
                borderColor: "#06b6d4",
                borderWidth: 1,
                barThickness: "flex",
                maxBarThickness: 48,
                categoryPercentage: 0.75,
                barPercentage: 0.9,
              });
            }
            return Object.assign({}, common, {
              type: "line",
              borderWidth: Math.max(2, Math.round(2 * Math.min(1.6, Math.max(1, legendBoxWidth / 8)))),
              tension: 0.25,
              fill: true,
              backgroundColor: "rgba(6,182,212,0.12)",
              borderColor: "#06b6d4",
              pointRadius: 0,
              pointHitRadius: 10,
            });
          })(),
          (function () {
            const common = {
              data: oldRateData,
              label: "老點率 (%)",
              yAxisID: "y1",
            };
            if (perfChartType_ === "bar") {
              return Object.assign({}, common, {
                type: "bar",
                backgroundColor: "#f59e0b66",
                borderColor: "#f59e0b",
                borderWidth: 1,
                maxBarThickness: 36,
                barPercentage: 0.48,
                categoryPercentage: 0.6,
              });
            }
            return Object.assign({}, common, {
              type: "line",
              tension: 0.25,
              fill: false,
              borderColor: "#f59e0b",
              backgroundColor: "rgba(245,158,11,0.06)",
              pointRadius: isNarrow ? 0 : 2,
              pointHitRadius: 10,
            });
          })(),
          (function () {
            const common = {
              data: schedRateData,
              label: "排班率 (%)",
              yAxisID: "y1",
            };
            if (perfChartType_ === "bar") {
              return Object.assign({}, common, {
                type: "bar",
                backgroundColor: "#10b98166",
                borderColor: "#10b981",
                borderWidth: 1,
                maxBarThickness: 36,
                barPercentage: 0.48,
                categoryPercentage: 0.6,
              });
            }
            return Object.assign({}, common, {
              type: "line",
              tension: 0.25,
              fill: false,
              borderColor: "#10b981",
              backgroundColor: "rgba(16,185,129,0.06)",
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
        onClick: function (evt, activeEls) {
          try {
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
            ticks: { color: subColorRaw, font: { size: ticksFont }, callback: (vv) => fmtMoney_(vv) },
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
async function fetchPerfSync_(techNo, from, to, includeDetail = true) {
  const perfUrl = perfGetSyncUrl_();
  if (!perfUrl) throw new Error("CONFIG_PERF_SYNC_API_URL_MISSING");

  const url = perfWithQuery_(perfUrl, `_ts=${encodeURIComponent(String(Date.now()))}`);

  const payload = {
    mode: "syncStorePerf_v1",
    techNo,
    from,
    to,
    includeDetail: !!includeDetail,
    bypassAccess: true,
  };

  const resp = await fetchFormPostWithTimeout_(url, payload, PERF_FETCH_TIMEOUT_MS, "PERF_SYNC");
  return resp;
}

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

function makeCacheKey_(techNo, from, to) {
  return `${String(techNo || "").trim()}|${String(from || "").trim()}|${String(to || "").trim()}`;
}

async function renderFromCache_(mode, info) {
  const m = mode === "summary" ? "summary" : "detail";
  perfSelectedMode_ = m;

  const r = info && info.ok ? info : readRangeFromInputs_();
  if (!r || !r.ok) {
    showError_(true);
    if (r && r.error === "MISSING_TECHNO") setBadge_("請選擇師傅編號", true);
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

  const key = makeCacheKey_(r.techNo, r.from, r.to);
  if (perfCache_.key !== key) {
    setBadge_("尚未載入（請按『業績統計/業績明細』）", true);
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
  setMeta_(perfCache_.lastUpdatedAt ? `最後更新：${perfCache_.lastUpdatedAt}` : "最後更新：—");

  const rows = perfCache_.detailRows || [];
  const cards3 = pickCards3_(perfCache_.cards, rows);
  renderSummaryTable_(cards3);

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
    renderServiceSummaryTable_(perfCache_.serviceSummary || [], rows, r.dateKeys);
    return { ok: true, rendered: "summary", cached: true };
  }

  renderDetailTable_(rows);
  try {
    updatePerfChart_(rows, r.dateKeys);
  } catch (_) {}
  return { ok: true, rendered: "detail", cached: true };
}

async function reloadAndCache_(info, { showToast = true } = {}) {
  const r = info && info.ok ? info : readRangeFromInputs_();
  if (!r || !r.ok) return { ok: false, error: r ? r.error : "BAD_RANGE" };

  const techNo = r.techNo;
  const from = r.from;
  const to = r.to;

  const key = makeCacheKey_(techNo, from, to);

  if (showToast) showLoadingHint("同步業績中…");

  if (perfPrefetchInFlight_ && perfPrefetchInFlight_.key === key) {
    try {
      return await perfPrefetchInFlight_.promise;
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }

  const task = (async () => {
    const raw = await fetchPerfSync_(techNo, from, to, true);

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
  })();

  perfPrefetchInFlight_ = { key, promise: task };
  try {
    return await task;
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  } finally {
    if (perfPrefetchInFlight_ && perfPrefetchInFlight_.key === key) perfPrefetchInFlight_ = null;
    if (showToast) hideLoadingHint();
  }
}

async function manualRefreshPerformance_({ showToast, force = false, mode } = { showToast: true }) {
  ensureDefaultDate_();
  showError_(false);

  if (mode === "summary" || mode === "detail") perfSelectedMode_ = mode;

  const info = readRangeFromInputs_();
  if (!info.ok) {
    if (info.error === "MISSING_TECHNO") setBadge_("請選擇師傅編號", true);
    else if (info.error === "MISSING_START") setBadge_("請選擇開始日期", true);
    else if (info.error === "RANGE_TOO_LONG") setBadge_("日期區間過長（最多 93 天 / 約 3 個月）", true);
    else setBadge_("日期格式不正確", true);
    return { ok: false, error: info.error || "BAD_RANGE" };
  }

  const key = makeCacheKey_(info.techNo, info.from, info.to);
  const hasCache = perfCache_.key === key && Array.isArray(perfCache_.detailRows) && perfCache_.detailRows.length > 0;
  if (!force && hasCache) {
    setBadge_("已載入", false);
    return await renderFromCache_(perfSelectedMode_, info);
  }

  setBadge_("同步中…", false);

  const res = await reloadAndCache_(info, { showToast: !!showToast });
  if (!res || !res.ok) {
    const msg = String(res && res.error ? res.error : "SYNC_FAILED");
    if (msg.includes("CONFIG_PERF_SYNC_API_URL_MISSING")) setBadge_("尚未設定 PERF_SYNC_API_URL", true);
    else if (msg.includes("MISSING_TECHNO")) setBadge_("請選擇師傅編號", true);
    else if (msg.includes("TECHNO_NOT_FOUND") || msg.includes("STOREID_NOT_FOUND")) setBadge_("NetworkCapture 查無對應 StoreId", true);
    else if (msg.includes("TIMEOUT")) setBadge_("查詢逾時，請稍後再試", true);
    else setBadge_("同步失敗", true);
    showError_(true);
    return res;
  }

  return await renderFromCache_(perfSelectedMode_, info);
}

function onShowPerformance() {
  ensureDefaultDate_();
  showError_(false);
  void renderFromCache_(perfSelectedMode_);
  hideLoadingHint();

  try {
    schedulePerfChartRedraw_();
  } catch (_) {}
}

function initPerformanceUi() {
  ensureDefaultDate_();
  // TechNo dropdown
  loadTechNoOptions_();

  if (dom.perfTechNoSelect) {
    dom.perfTechNoSelect.addEventListener("change", (e) => {
      perfSelectedTechNo_ = String(e?.target?.value || "").trim();
      void renderFromCache_(perfSelectedMode_, readRangeFromInputs_());
    });
  }

  try {
    loadPerfChartPrefs_();
  } catch (_) {}

  if (dom.perfSearchBtn) dom.perfSearchBtn.addEventListener("click", (e) => void manualRefreshPerformance_({ showToast: true, force: !!(e && (e.shiftKey || e.altKey || e.metaKey)), mode: perfSelectedMode_ }));
  if (dom.perfSearchSummaryBtn) dom.perfSearchSummaryBtn.addEventListener("click", (e) => void manualRefreshPerformance_({ showToast: true, force: !!(e && (e.shiftKey || e.altKey || e.metaKey)), mode: "summary" }));
  if (dom.perfSearchDetailBtn) dom.perfSearchDetailBtn.addEventListener("click", (e) => void manualRefreshPerformance_({ showToast: true, force: !!(e && (e.shiftKey || e.altKey || e.metaKey)), mode: "detail" }));

  const onDateInputsChanged = () => {
    if (!getTechNo_()) return; // 參照 Scheduling：日期改了只切畫面，不強制同步/顯示錯誤
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
        if (perfChartType_ === "bar") btnBar.classList.add("is-active");
        else btnBar.classList.remove("is-active");
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
      btnBar.addEventListener("click", () => {
        perfChartType_ = perfChartType_ === "bar" ? "line" : "bar";
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

  try {
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("resize", () => schedulePerfChartRedraw_());
    }
  } catch (_) {}

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

  try {
    window.dispatchEvent(new CustomEvent("admin:rendered", { detail: "performance" }));
  } catch (_) {}
}

// expose to admin.js
window.initPerformanceUi = initPerformanceUi;
window.onShowPerformance = onShowPerformance;
window.manualRefreshPerformance_ = manualRefreshPerformance_;
