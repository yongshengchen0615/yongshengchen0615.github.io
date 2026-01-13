/**
 * performance.js（完整可貼版本 / ✅ 登入時預載到快取、進業績面板直接顯示、手動重整才更新）
 *
 * ✅ 行為規則（你要求的最終版）：
 * 1) 登入時（呼叫 prefetchPerformanceOnce）會「預載到快取」：
 *    - 只抓 Detail（明細），不更新 Summary（三卡）  ✅ 符合你原本規則
 *    - 這樣進入業績面板時可直接顯示明細 + 統計頁服務彙總（由明細快取計算）
 *
 * 2) 進入業績面板（onShowPerformance）：
 *    - 只 render 快取，不打 API
 *
 * 3) 只有按「手動重整」：
 *    - 才會抓最新 Summary（兩張 getLatestSummary_v1 比較挑選）
 *    - 並抓最新 Detail（startKey/endKey）
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

/* =========================
 * Module State
 * ========================= */

let perfSelectedMode_ = "detail"; // "detail" | "summary"
let perfPrefetchInFlight_ = null;

const perfCache_ = {
  summaryKey: "",
  detailKey: "",
  summary: null, // { meta, summaryObj, summaryHtml, source, lastUpdatedAt }
  detail: null, // { meta, summaryObj, summaryHtml, detailRows, detailRowsHtml, detailRowsCount }
};

/* =========================
 * Utils
 * ========================= */

function pad2_(n) {
  return String(n).padStart(2, "0");
}

/** ✅ 把 YYYY/MM/DD or YYYY-M-D 轉成 YYYY-MM-DD（前端 input 防呆） */
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

  dom.perfDetailHeadRowEl.innerHTML =
    "<th>服務項目</th><th>總筆數</th><th>總節數</th><th>總計金額</th>" +
    "<th>老點筆數</th><th>老點節數</th><th>老點金額</th>" +
    "<th>排班筆數</th><th>排班節數</th><th>排班金額</th>";
}

/* =========================
 * HTML builders
 * ========================= */

function summaryRowsHtml_(summaryObj) {
  if (!summaryObj) return '<tr><td colspan="5" style="color:var(--text-sub);">查無總覽資料。</td></tr>';
  const td = (v) => `<td>${escapeHtml(String(v ?? ""))}</td>`;
  const cards = [
    { label: "排班", card: summaryObj["排班"] || {} },
    { label: "老點", card: summaryObj["老點"] || {} },
    { label: "總計", card: summaryObj["總計"] || {} },
  ];
  return cards
    .map(({ label, card }) => `<tr>${td(label)}${td(card.單數 ?? 0)}${td(card.筆數 ?? 0)}${td(card.數量 ?? 0)}${td(card.金額 ?? 0)}</tr>`)
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
      .map((r) =>
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
      .map((r) =>
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

/** ✅ 從 UI 讀區間：先 normalizeInputDateKey_ 再驗證（修正 2026/01/01 類型） */
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

function filterDetailRowsByRange_(detailRows, startKey, endKey, knownMaxKey) {
  const rows = Array.isArray(detailRows) ? detailRows : [];
  const s = String(startKey || "").trim();
  const e = String(endKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return rows;

  const maxKey = knownMaxKey || getMaxDetailDateKey_(rows);
  if (maxKey) {
    if (e > maxKey || s > maxKey) return rows; // 超出最新日 → 顯示全部（你的規則）
  }

  return rows.filter((r) => {
    const dk = fastDateKeyFromRow_(r);
    if (!dk) return true;
    return dk >= s && dk <= e;
  });
}

/* =========================
 * ✅ Service Summary (from detail cache)
 * ========================= */

function buildServiceSummaryFromDetail_(detailRows) {
  const rows = Array.isArray(detailRows) ? detailRows : [];
  const map = new Map();

  function bucket_(r) {
    const v = String((r && r["拉牌"]) || "").trim();
    if (v.includes("老")) return "老點";
    if (v.includes("排")) return "排班";
    return "其他";
  }

  for (const r of rows) {
    const name = String((r && r["服務項目"]) || "").trim() || "（未命名）";
    const b = bucket_(r);

    const minutes = Number((r && r["分鐘"]) ?? 0) || 0;
    const amount = Number((r && (r["小計"] ?? r["業績金額"])) ?? 0) || 0;

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
    o["總節數"] += minutes;
    o["總計金額"] += amount;

    if (b === "老點") {
      o["老點筆數"] += 1;
      o["老點節數"] += minutes;
      o["老點金額"] += amount;
    } else if (b === "排班") {
      o["排班筆數"] += 1;
      o["排班節數"] += minutes;
      o["排班金額"] += amount;
    }
  }

  return Array.from(map.values()).sort((a, b) => (Number(b["總計金額"]) || 0) - (Number(a["總計金額"]) || 0));
}

/* =========================
 * Cache keys
 * ========================= */

function makePerfSummaryKey_(techNo) {
  return `${String(techNo || "").trim()}:LATEST_SUMMARY`;
}
function makePerfDetailKey_(techNo, startKey, endKey) {
  return `${String(techNo || "").trim()}:${String(startKey || "").trim()}~${String(endKey || "").trim()}`;
}

/* =========================
 * ✅ Latest Summary Compare / Choose
 * ========================= */

/** Summary 是否「有資料」：只要能轉出卡片就算有 */
function hasSummaryData_(x) {
  if (!x || !x.ok || x.empty) return false;
  const s = x.summaryObj;
  if (!s || typeof s !== "object") return false;
  return !!(s["排班"] || s["老點"] || s["總計"]);
}

/** 解析 lastUpdatedAt（yyyy/MM/dd HH:mm:ss）為 ms；失敗回 0 */
function parseTpeLastUpdatedMs_(s) {
  const v = String(s || "").trim();
  const m = v.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** 比較兩張 summary（只比 3 張卡的四個欄位） */
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

/* =========================
 * ✅ Latest Summary Fetch (ALWAYS HIT NETWORK)
 * ========================= */

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

/** 把 GAS summaryRow 轉成 {排班:{...}, 老點:{...}, 總計:{...}} */
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

/** 同時抓兩張 latest summary，選「有資料且較新」那張；兩張都有才 diff */
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

    if (perfCache_.summary && dom.perfSummaryRowsEl) dom.perfSummaryRowsEl.innerHTML = perfCache_.summary.summaryHtml || summaryRowsHtml_(perfCache_.summary.summaryObj || null);
    else if (dom.perfSummaryRowsEl) dom.perfSummaryRowsEl.innerHTML = summaryNotLoadedHtml_();

    if (m === "detail") {
      renderDetailHeader_("detail");
      renderDetailRows_([]);
    } else {
      renderDetailHeader_("summary");
      applyDetailTableHtml_("", 0);
    }
    return { ok: false, error: "NOT_MASTER" };
  }

  const r = m === "detail" ? (info && info.ok ? info : readRangeFromInputs_()) : { ok: true, techNo };
  if (m === "detail" && (!r || !r.ok)) {
    setBadge_(r && r.error === "MISSING_START" ? "請選擇開始日期" : "日期格式不正確", true);
    setMeta_("—");

    if (perfCache_.summary && dom.perfSummaryRowsEl) dom.perfSummaryRowsEl.innerHTML = perfCache_.summary.summaryHtml || summaryRowsHtml_(perfCache_.summary.summaryObj || null);
    else if (dom.perfSummaryRowsEl) dom.perfSummaryRowsEl.innerHTML = summaryNotLoadedHtml_();

    renderDetailHeader_("detail");
    renderDetailRows_([]);
    return { ok: false, error: r ? r.error : "BAD_RANGE" };
  }

  const summaryKey = makePerfSummaryKey_(techNo);
  const detailKey = m === "detail" ? makePerfDetailKey_(techNo, r.startKey, r.endKey) : "";

  const hasSummary = perfCache_.summaryKey === summaryKey && !!perfCache_.summary;
  const hasDetail = m === "detail" ? perfCache_.detailKey === detailKey && !!perfCache_.detail : false;

  if (dom.perfSummaryRowsEl) {
    if (hasSummary) dom.perfSummaryRowsEl.innerHTML = perfCache_.summary.summaryHtml || summaryRowsHtml_(perfCache_.summary.summaryObj || null);
    else dom.perfSummaryRowsEl.innerHTML = summaryNotLoadedHtml_();
  }

  if (m === "summary") {
    renderDetailHeader_("summary");

    if (hasSummary) {
      const c = perfCache_.summary;
      setMeta_(c.meta || `師傅：${techNo} ｜ 統計：快取`);
      setBadge_("已載入（快取）", false);
    } else {
      setMeta_(`師傅：${techNo} ｜ 統計：尚未載入`);
      setBadge_("已載入（明細快取）", false);
    }

    // ✅ 統計頁表格：由明細快取計算服務彙總（不打 API）
    const baseDetail = perfCache_.detail && Array.isArray(perfCache_.detail.detailRows) ? perfCache_.detail.detailRows : [];
    if (baseDetail.length) {
      const summaryRows = buildServiceSummaryFromDetail_(baseDetail);
      const tmp = detailSummaryRowsHtml_(summaryRows);
      applyDetailTableHtml_(tmp.html, tmp.count);
    } else {
      applyDetailTableHtml_("", 0);
    }

    return { ok: true, rendered: "summary", cached: true };
  }

  renderDetailHeader_("detail");

  if (hasDetail) {
    const c = perfCache_.detail;
    setMeta_(c.meta || `師傅：${techNo} ｜ 日期：${r.startKey} ~ ${r.endKey} ｜ 快取`);
    setBadge_("已載入（快取）", false);

    if (c.detailRowsHtml) applyDetailTableHtml_(c.detailRowsHtml, Number(c.detailRowsCount || 0) || 0);
    else {
      const tmp = detailRowsHtml_(c.detailRows || []);
      applyDetailTableHtml_(tmp.html, tmp.count);
    }
    return { ok: true, rendered: "detail", cached: true };
  }

  setMeta_(`師傅：${techNo} ｜ 日期：${r.startKey} ~ ${r.endKey}`);
  setBadge_("明細尚未載入（等待登入預載 / 或按手動重整）", true);
  renderDetailRows_([]);
  return { ok: false, rendered: "detail", cached: false };
}

/* =========================
 * Reload / cache
 * - 手動重整才會呼叫（抓最新 Summary+Detail）
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
  const detailKey = fetchDetail ? makePerfDetailKey_(techNo, r.startKey, r.endKey) : "";

  if (fetchSummary && perfCache_.summaryKey !== summaryKey) perfCache_.summary = null;
  if (fetchDetail && perfCache_.detailKey !== detailKey) perfCache_.detail = null;

  perfCache_.summaryKey = summaryKey;
  if (fetchDetail) perfCache_.detailKey = detailKey;

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
        const reportHas = !!(cmp && cmp.reportHas);
        const detailHas = !!(cmp && cmp.detailHas);

        const summaryObj = chosen ? chosen.summaryObj || null : null;

        const compareHint =
          PERF_COMPARE_LATEST_ENABLED && reportHas && detailHas
            ? cmp.diffs.length
              ? `｜⚠ Summary不一致(${cmp.diffs.length})`
              : `｜✓ Summary一致`
            : "";

        const src = chosen ? `${cmp.chosenSource}(getLatestSummary_v1)` : "無（兩張皆無資料）";
        const dateLabel = chosen
          ? chosen.source === "REPORT"
            ? (chosen.dateKey ? `日期 ${chosen.dateKey}` : "")
            : (chosen.rangeKey ? `區間 ${chosen.rangeKey}` : "")
          : "";

        const meta = [
          `師傅：${(chosen && chosen.techNo) || techNo}`,
          `統計來源：${src}${dateLabel ? " " + dateLabel : ""}`,
          chosen && chosen.lastUpdatedAt ? `最後更新：${chosen.lastUpdatedAt}` : "",
          compareHint,
        ]
          .filter(Boolean)
          .join(" ｜ ");

        return {
          meta,
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

        const meta = [`師傅：${rr.techNo || techNo}`, `日期：${r.startKey} ~ ${r.endKey}`, rr.lastUpdatedAt ? `最後更新：${rr.lastUpdatedAt}` : ""]
          .filter(Boolean)
          .join(" ｜ ");

        const rowsAll = Array.isArray(rr.detail) ? rr.detail : [];
        const maxKey = getMaxDetailDateKey_(rowsAll);
        const filtered = filterDetailRowsByRange_(rowsAll, r.startKey, r.endKey, maxKey);

        const tmp = detailRowsHtml_(filtered);

        return {
          meta,
          summaryObj: rr.summary || null,
          summaryHtml: summaryRowsHtml_(rr.summary || null),
          detailRows: filtered,
          detailRowsHtml: tmp.html,
          detailRowsCount: tmp.count,
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

    return { ok: true, summaryKey: perfCache_.summaryKey, detailKey: perfCache_.detailKey, partial: !(perfCache_.summary && (fetchDetail ? perfCache_.detail : true)) };
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

  return { ok: true, techNo, lastUpdatedAt, updateCount, summary: summaryObj, detail: Array.isArray(detailRows) ? detailRows : [] };
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
    encodeURIComponent(String(Date.now())); // ✅ 避免快取

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

export function togglePerformanceCard() {}

export function initPerformanceUi() {
  ensureDefaultDate_();

  // ✅ 切換只 render 快取，不抓資料
  if (dom.perfSearchBtn) dom.perfSearchBtn.addEventListener("click", () => void renderFromCache_("summary"));
  if (dom.perfSearchSummaryBtn) dom.perfSearchSummaryBtn.addEventListener("click", () => void renderFromCache_("summary"));
  if (dom.perfSearchDetailBtn) dom.perfSearchDetailBtn.addEventListener("click", () => void renderFromCache_("detail"));
}

/**
 * ✅ 登入時預載：同時預載「最新 Summary + Detail」到快取
 * - 不顯示 toast
 * - 進入業績面板只 render 快取，不打 API
 */
export async function prefetchPerformanceOnce() {
  if (String(state.feature && state.feature.performanceEnabled) !== "是") {
    return { ok: false, skipped: "FEATURE_OFF" };
  }

  // 防重入（避免登入流程多次觸發）
  if (perfPrefetchInFlight_) return perfPrefetchInFlight_;

  perfPrefetchInFlight_ = (async () => {
    ensureDefaultDate_();

    const info = readRangeFromInputs_();
    if (!info.ok) return { ok: false, skipped: info.error || "BAD_RANGE" };

    // ✅ 關鍵：登入就把最新 Summary + Detail 塞進快取
    const res = await reloadAndCache_(info, {
      showToast: false,
      fetchSummary: true, // ✅ 讓三卡（類別/單數/筆數/數量/金額）登入就有最新
      fetchDetail: true,  // ✅ 明細也預載，進頁就能顯示
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

  // ✅ 手動重整：抓最新 Summary + Detail
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

  // ✅ 進頁只 render 快取（不打 API）
  void renderFromCache_(perfSelectedMode_);

  hideLoadingHint();
}
