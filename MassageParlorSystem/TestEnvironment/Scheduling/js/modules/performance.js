/**
 * performance.js（重構整合版｜已套用「Summary 不吃區間、Detail 依訂單日期過濾」）
 *
 * 功能：師傅業績（統計 / 明細）
 *
 * ✅ 需求整合（你要求的版本）
 * 1) 業績統計 Summary：
 *    - 不依開始/結束日期查詢
 *    - 直接讀取 GAS 現有「最新可用」資料（用探測法從今天往回找）
 *    - 快取 key 只跟 techNo 有關（不會因為日期改動而失效）
 *
 * 2) 業績明細 Detail：
 *    - 仍使用開始/結束日期（最多 31 天）組 rangeKey 向 GAS 查詢
 *    - 顯示時依 GAS row 的「訂單日期」欄位過濾
 *    - 若使用者選到超出資料最大日期（start 或 end > maxKey）=> 顯示所有明細
 *
 * ✅ 行為原則
 * - 切換「統計 / 明細」：只渲染快取；若缺資料則按需補抓該半邊
 * - 手動重整：強制抓 Summary + Detail
 * - 登入後預載：只預載 Summary
 */

import { dom } from "./dom.js";
import { config } from "./config.js";
import { state } from "./state.js";
import { withQuery, escapeHtml } from "./core.js";
import { showLoadingHint, hideLoadingHint } from "./uiHelpers.js";
import { normalizeTechNo } from "./myMasterStatus.js";

/* =========================
 * 常數
 * ========================= */

const PERF_FETCH_TIMEOUT_MS = 20000;
const PERF_TZ = "Asia/Taipei";

/* =========================
 * Intl formatter（memoize）
 * - 避免 iOS / LINE WebView 反覆 new 很慢
 * ========================= */

// 台北時間：HH:mm:ss
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

// 台北日期：用 formatToParts 組合 YYYY-MM-DD
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
 * 模組狀態（Module State）
 * ========================= */

let perfSelectedMode_ = "detail"; // "detail" | "summary"
let perfPrefetchInFlight_ = null; // Promise | null

/**
 * 快取（拆分 Summary / Detail 的 key）
 * - SummaryKey：只跟 techNo 有關（LATEST_SUMMARY）
 * - DetailKey ：techNo + start~end
 */
const perfCache_ = {
  summaryKey: "",
  detailKey: "",
  // summary: { meta, summaryObj, detailAgg, summaryHtml, detailAggHtml, detailAggCount, latestReportDateKey }
  summary: null,
  // detail : { meta, summaryObj, detailRows, summaryHtml, detailRowsHtml, detailRowsCount, maxDetailDateKey }
  detail: null,
};

/* =========================
 * 小工具（格式、日期）
 * ========================= */

function pad2_(n) {
  return String(n).padStart(2, "0");
}

/** 日期顯示：YYYY/MM/DD（僅顯示用） */
function formatDateYmd_(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s) return "";

  // ✅ 1) ISO datetime（含 T）/ 含時區資訊：一律用台北時區算日期，避免 -1 天
  if (s.includes("T") || /Z$|[+\-]\d{2}:?\d{2}$/.test(s)) {
    const dk = toDateKeyTaipei_(s); // "YYYY-MM-DD"
    if (dk) return dk.replaceAll("-", "/");
    return s;
  }

  // ✅ 2) 已是 YYYY-MM-DD / YYYY/MM/DD：正規化成 YYYY/MM/DD
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}/${pad2_(m[2])}/${pad2_(m[3])}`;

  // ✅ 3) 其他格式：才嘗試 new Date（保守）
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const dk = toDateKeyTaipei_(d);
    return dk ? dk.replaceAll("-", "/") : `${d.getFullYear()}/${pad2_(d.getMonth() + 1)}/${pad2_(d.getDate())}`;
  }

  return s;
}

/** 時間顯示：台北 HH:mm:ss（僅顯示用） */
function formatTimeTpeHms_(v) {
  if (v === null || v === undefined) return "";

  // 純時間字串：補零 + 補秒
  if (typeof v === "string") {
    const s0 = v.trim();
    if (!s0) return "";
    const m = s0.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) return `${pad2_(m[1])}:${m[2]}:${m[3] ? m[3] : "00"}`;
  }

  const d = v instanceof Date ? v : new Date(String(v).trim());
  if (Number.isNaN(d.getTime())) return String(v ?? "").trim();

  // 優先用 Intl（已 memoize）
  try {
    if (PERF_TPE_TIME_FMT) {
      const out = PERF_TPE_TIME_FMT.format(d);
      if (out) return out;
    }
  } catch (_) {}

  // fallback：台灣固定 UTC+8
  const tzMs = d.getTime() + 8 * 60 * 60 * 1000;
  const t = new Date(tzMs);
  return `${pad2_(t.getUTCHours())}:${pad2_(t.getUTCMinutes())}:${pad2_(t.getUTCSeconds())}`;
}

/**
 * 台北日期 key：YYYY-MM-DD（用於比較 / 過濾）
 */
function toDateKeyTaipei_(v) {
  if (v === null || v === undefined) return "";

  // Fast path：YYYY-MM-DD / YYYY/MM/DD
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return "";
    const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) {
      const mm = String(m[2]).padStart(2, "0");
      const dd = String(m[3]).padStart(2, "0");
      return `${m[1]}-${mm}-${dd}`;
    }
  }

  const d = v instanceof Date ? v : new Date(String(v).trim());
  if (Number.isNaN(d.getTime())) return "";

  // 用 Intl（台北時區）
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

  // fallback：台灣固定 UTC+8
  const tzMs = d.getTime() + 8 * 60 * 60 * 1000;
  const t = new Date(tzMs);
  const yyyy = String(t.getUTCFullYear());
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/* =========================
 * DOM helpers（只管畫面）
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

/** 依模式更新明細表頭 */
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
 * HTML 產生（效能：一次 innerHTML）
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
 * 日期區間（input 解析 + dateKeys）
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

function parseDateKey_(s) {
  const v = String(s || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return { key: v, date: d };
}

function toDateKey_(d) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/** 產出日期 keys（最多 maxDays 天） */
function buildDateKeys_(startKey, endKey, maxDays) {
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

  // 若 end-start 超過限制，out 會提早結束
  if (out.length && out[out.length - 1] !== toDateKey_(end)) {
    return { ok: false, error: "RANGE_TOO_LONG", days: out.length };
  }

  return { ok: true, keys: out, normalizedStart: toDateKey_(start), normalizedEnd: toDateKey_(end) };
}

function ensureDefaultDate_() {
  const today = localDateKeyToday_();
  const monthStart = localDateKeyMonthStart_();

  if (dom.perfDateStartInput && !dom.perfDateStartInput.value) dom.perfDateStartInput.value = monthStart;
  if (dom.perfDateEndInput && !dom.perfDateEndInput.value) dom.perfDateEndInput.value = today;

  // 舊版單日 input（若仍存在就填今天）
  if (dom.perfDateKeyInput && !dom.perfDateKeyInput.value) dom.perfDateKeyInput.value = today;
}

/** 從畫面 input 讀取區間（並正規化） */
function readRangeFromInputs_() {
  const techNo = normalizeTechNo(state.myMaster && state.myMaster.techNo);
  const startKey = String(dom.perfDateStartInput && dom.perfDateStartInput.value ? dom.perfDateStartInput.value : "").trim();
  const endKeyRaw = String(dom.perfDateEndInput && dom.perfDateEndInput.value ? dom.perfDateEndInput.value : "").trim();
  const endKey = endKeyRaw || startKey;

  if (!techNo) return { ok: false, error: "NOT_MASTER", techNo: "", startKey, endKey };
  if (!startKey) return { ok: false, error: "MISSING_START", techNo, startKey, endKey };

  const range = buildDateKeys_(startKey, endKey, 31);
  if (!range.ok) return { ok: false, error: range.error || "BAD_RANGE", techNo, startKey, endKey };

  // 使用者輸入反了：同步回 input
  if (dom.perfDateStartInput && range.normalizedStart && dom.perfDateStartInput.value !== range.normalizedStart) {
    dom.perfDateStartInput.value = range.normalizedStart;
  }
  if (dom.perfDateEndInput && range.normalizedEnd && dom.perfDateEndInput.value !== range.normalizedEnd) {
    dom.perfDateEndInput.value = range.normalizedEnd;
  }

  return {
    ok: true,
    techNo,
    normalizedStart: range.normalizedStart,
    normalizedEnd: range.normalizedEnd,
    dateKeys: range.keys,
    rangeKey: `${range.normalizedStart}~${range.normalizedEnd}`,
  };
}

/* =========================
 * 明細過濾（依 GAS 訂單日期，含「超出範圍顯示全部」）
 * ========================= */

/** 快速取出 row 的日期 key（YYYY-MM-DD） */
function fastDateKeyFromRow_(r) {
  const raw = String(r && r["訂單日期"] ? r["訂單日期"] : "").trim();
  if (!raw) return "";

  // ISO datetime / 有時區：用台北時區換算
  if (raw.includes("T") || /Z$|[+\-]\d{2}:?\d{2}$/.test(raw)) {
    return toDateKeyTaipei_(raw);
  }

  // Fast path：YYYY-MM-DD / YYYY/MM/DD
  const m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;

  return toDateKeyTaipei_(raw);
}

/** 找出明細資料最新日期（YYYY-MM-DD） */
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
 * 區間過濾明細
 * ✅ 規則：若使用者選到最新日期之後（start 或 end > maxKey），直接回傳全部 rows
 */
function filterDetailRowsByRange_(detailRows, startKey, endKey, knownMaxKey) {
  const rows = Array.isArray(detailRows) ? detailRows : [];
  const s = String(startKey || "").trim();
  const e = String(endKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return rows;

  const maxKey = knownMaxKey || getMaxDetailDateKey_(rows);
  if (maxKey) {
    if (e > maxKey || s > maxKey) return rows; // ✅ 超出範圍 => 顯示全部
  }

  return rows.filter((r) => {
    const dk = fastDateKeyFromRow_(r);
    if (!dk) return true; // 保守：解析失敗不過濾
    return dk >= s && dk <= e;
  });
}

/* =========================
 * Cache key helpers（Summary/Detail 分離）
 * ========================= */

function makePerfSummaryKey_(techNo) {
  return `${String(techNo || "").trim()}:LATEST_SUMMARY`;
}

function makePerfDetailKey_(techNo, startKey, endKey) {
  return `${String(techNo || "").trim()}:${String(startKey || "").trim()}~${String(endKey || "").trim()}`;
}

/* =========================
 * 渲染（只用快取；缺什麼補什麼）
 * ========================= */

async function renderFromCache_(mode, info) {
  const m = mode === "summary" ? "summary" : "detail";
  perfSelectedMode_ = m;

  // Summary 不吃日期：只需要 techNo
  const techNo = normalizeTechNo(state.myMaster && state.myMaster.techNo);
  if (!techNo) {
    setBadge_("你不是師傅（無法查詢）", true);
    setMeta_("—");
    renderSummary_(null);
    if (m === "detail") renderDetailRows_([]);
    else renderDetailSummary_([]);
    return { ok: false, error: "NOT_MASTER" };
  }

  // Detail 才需要日期區間
  const r = m === "detail" ? (info && info.ok ? info : readRangeFromInputs_()) : { ok: true, techNo };
  if (m === "detail" && (!r || !r.ok)) {
    if (r && r.error === "NOT_MASTER") setBadge_("你不是師傅（無法查詢）", true);
    else setBadge_("日期格式不正確", true);
    setMeta_("—");
    renderSummary_(null);
    if (m === "detail") renderDetailRows_([]);
    else renderDetailSummary_([]);
    return { ok: false, error: r ? r.error : "BAD_RANGE" };
  }

  const summaryKey = makePerfSummaryKey_(techNo);
  const detailKey = m === "detail" ? makePerfDetailKey_(r.techNo, r.normalizedStart, r.normalizedEnd) : "";

  const hasSummary = perfCache_.summaryKey === summaryKey && !!perfCache_.summary;
  const hasDetail = m === "detail" ? perfCache_.detailKey === detailKey && !!perfCache_.detail : false;

  // ✅ 按需補抓：缺什麼補什麼（Summary/Detail 分離）
  if (m === "summary" && !hasSummary) {
    await reloadAndCache_({ ok: true, techNo }, { showToast: true, fetchSummary: true, fetchDetail: false });
  }
  if (m === "detail" && !hasDetail) {
    await reloadAndCache_(r, { showToast: true, fetchSummary: false, fetchDetail: true });
  }

  // 仍無快取：顯示提示
  const nowHasSummary = perfCache_.summaryKey === summaryKey && !!perfCache_.summary;
  const nowHasDetail = m === "detail" ? perfCache_.detailKey === detailKey && !!perfCache_.detail : false;

  if (m === "summary" && !nowHasSummary) {
    setBadge_(perfPrefetchInFlight_ ? "業績載入中…" : "尚未載入（請按手動重整）", !perfPrefetchInFlight_);
    setMeta_(`師傅：${techNo} ｜ 統計：讀取 GAS 最新`);
    renderDetailHeader_("summary");
    renderSummary_(null);
    renderDetailSummary_([]);
    return { ok: false, error: "CACHE_MISS_SUMMARY" };
  }

  if (m === "detail" && !nowHasDetail) {
    setBadge_(perfPrefetchInFlight_ ? "業績載入中…" : "尚未載入（請按手動重整）", !perfPrefetchInFlight_);
    setMeta_(`師傅：${r.techNo} ｜ 日期：${r.normalizedStart} ~ ${r.normalizedEnd}`);
    renderDetailHeader_("detail");
    renderSummary_(null);
    renderDetailRows_([]);
    return { ok: false, error: "CACHE_MISS_DETAIL" };
  }

  // 真正渲染
  if (m === "summary") {
    renderDetailHeader_("summary");
    const c = perfCache_.summary;

    setMeta_((c && c.meta) || "—");
    setBadge_("已更新", false);

    if (dom.perfSummaryRowsEl) dom.perfSummaryRowsEl.innerHTML = c && c.summaryHtml ? c.summaryHtml : summaryRowsHtml_(c ? c.summaryObj : null);

    if (c && c.detailAggHtml) applyDetailTableHtml_(c.detailAggHtml, Number(c.detailAggCount || 0) || 0);
    else {
      const tmp = detailSummaryRowsHtml_(c ? c.detailAgg : []);
      applyDetailTableHtml_(tmp.html, tmp.count);
    }
    return { ok: true, rendered: "summary" };
  }

  // detail
  renderDetailHeader_("detail");
  const c = perfCache_.detail;

  setMeta_((c && c.meta) || "—");
  setBadge_("已更新", false);

  // 明細模式：summary table 仍顯示（若有）
  if (dom.perfSummaryRowsEl) dom.perfSummaryRowsEl.innerHTML = c && c.summaryHtml ? c.summaryHtml : summaryRowsHtml_(c ? c.summaryObj : null);

  if (c && c.detailRowsHtml) applyDetailTableHtml_(c.detailRowsHtml, Number(c.detailRowsCount || 0) || 0);
  else {
    const tmp = detailRowsHtml_(c ? c.detailRows : []);
    applyDetailTableHtml_(tmp.html, tmp.count);
  }
  return { ok: true, rendered: "detail" };
}

/* =========================
 * 重新抓資料（支援只抓一半；Summary/Detail key 分離）
 * ========================= */

function sleep_(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function dateKeyMinusDays_(dateKey, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "";
  const d = new Date(dateKey + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() - (Number(days) || 0));
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/**
 * 找到「GAS 現有最新統計」的 dateKey
 * - 從今天開始往回找
 * - 找到第一個 ok:true 且不是 hint-only 的回應就停
 */
async function findLatestReportDateKey_(techNo, maxBackDays = 62) {
  let dk = localDateKeyToday_();
  const limit = Math.max(1, Number(maxBackDays) || 62);

  for (let i = 0; i < limit; i++) {
    const raw = await fetchReport_(techNo, dk);
    const nr = normalizeReportResponse_(raw);
    if (nr && nr.ok) return { ok: true, dateKey: dk, normalized: nr };
    dk = dateKeyMinusDays_(dk, 1);
    if (!dk) break;
  }
  return { ok: false, error: "NO_AVAILABLE_REPORT_IN_RANGE" };
}

/**
 * reloadAndCache_
 * - fetchSummary=true：讀 GAS 最新可用統計（不吃區間）
 * - fetchDetail=true ：讀區間明細（rangeKey）
 */
async function reloadAndCache_(info, { showToast = true, fetchSummary = true, fetchDetail = true } = {}) {
  // 取得 techNo
  const techNo = normalizeTechNo((info && info.techNo) || (state.myMaster && state.myMaster.techNo));
  if (!techNo) return { ok: false, error: "NOT_MASTER" };

  // Detail 才需要區間
  const r = fetchDetail ? (info && info.ok ? info : readRangeFromInputs_()) : { ok: true, techNo };

  if (fetchDetail && (!r || !r.ok)) return { ok: false, error: (r && r.error) || "BAD_RANGE" };

  const summaryKey = makePerfSummaryKey_(techNo);
  const detailKey = fetchDetail ? makePerfDetailKey_(r.techNo, r.normalizedStart, r.normalizedEnd) : "";

  // 只清要抓的那半邊；key 不同也要清
  if (fetchSummary && perfCache_.summaryKey !== summaryKey) perfCache_.summary = null;
  if (fetchDetail && perfCache_.detailKey !== detailKey) perfCache_.detail = null;

  // 更新 key
  perfCache_.summaryKey = summaryKey;
  if (fetchDetail) perfCache_.detailKey = detailKey;

  if (showToast) hideLoadingHint();

  // --- Summary（讀 GAS 最新可用）---
  const summaryP = fetchSummary
    ? (async () => {
        if (showToast) showLoadingHint(`查詢業績統計中…（讀取 GAS 最新）`);

        let found = null;
        let lastErr = "";

        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await findLatestReportDateKey_(techNo, 62);
          if (res && res.ok) {
            found = res;
            break;
          }
          lastErr = String(res && res.error ? res.error : "FIND_LATEST_FAILED");
          await sleep_(500 + attempt * 300);
        }

        if (!found || !found.ok) throw new Error(lastErr || "FIND_LATEST_FAILED");

        const nr = found.normalized;

        const meta = [
          `師傅：${nr.techNo || techNo}`,
          `統計來源：GAS 最新可用日期 ${found.dateKey}`,
          nr.lastUpdatedAt ? `最後更新：${nr.lastUpdatedAt}` : "",
        ]
          .filter(Boolean)
          .join(" ｜ ");

        const summaryObj = nr.summary || null;
        const detailAgg = Array.isArray(nr.detail) ? nr.detail : [];

        return { meta, summaryObj, detailAgg, latestReportDateKey: found.dateKey };
      })()
    : Promise.resolve({ skipped: true });

  // --- Detail（區間）---
  const detailP = fetchDetail
    ? (async () => {
        let rr = null;
        let lastErr = "";

        for (let attempt = 0; attempt < 3; attempt++) {
          if (showToast) showLoadingHint(`查詢業績明細中…（${attempt + 1}/3）`);
          const raw = await fetchDetailPerf_(r.techNo, r.rangeKey);
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

        const meta = [
          `師傅：${rr.techNo || r.techNo}`,
          `日期：${r.normalizedStart} ~ ${r.normalizedEnd}`,
          rr.lastUpdatedAt ? `最後更新：${rr.lastUpdatedAt}` : "",
        ]
          .filter(Boolean)
          .join(" ｜ ");

        const rows = Array.isArray(rr.detail) ? rr.detail : [];
        const maxKey = getMaxDetailDateKey_(rows);
        const filtered = filterDetailRowsByRange_(rows, r.normalizedStart, r.normalizedEnd, maxKey);

        return { meta, summaryObj: rr.summary, detailRows: filtered, maxDetailDateKey: maxKey };
      })()
    : Promise.resolve({ skipped: true });

  try {
    const [sumRes, detRes] = await Promise.allSettled([summaryP, detailP]);

    // 寫入 summary cache（含預先產生 HTML）
    if (sumRes.status === "fulfilled") {
      const v = sumRes.value;
      if (!(v && v.skipped)) {
        perfCache_.summary = {
          ...v,
          summaryHtml: summaryRowsHtml_(v && v.summaryObj ? v.summaryObj : null),
          ...(v && v.detailAgg
            ? (() => {
                const tmp = detailSummaryRowsHtml_(v.detailAgg);
                return { detailAggHtml: tmp.html, detailAggCount: tmp.count };
              })()
            : { detailAggHtml: "", detailAggCount: 0 }),
        };
      }
    }

    // 寫入 detail cache（含預先產生 HTML）
    if (detRes.status === "fulfilled") {
      const v = detRes.value;
      if (!(v && v.skipped)) {
        const rows = v && v.detailRows ? v.detailRows : [];
        const tmp = detailRowsHtml_(rows);
        perfCache_.detail = {
          ...v,
          summaryHtml: summaryRowsHtml_(v && v.summaryObj ? v.summaryObj : null),
          detailRowsHtml: tmp.html,
          detailRowsCount: tmp.count,
        };
      }
    }

    // 兩邊都失敗才算失敗（允許 partial）
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
 * 渲染入口（把資料丟到 DOM）
 * ========================= */

function renderSummary_(summaryObj) {
  if (!dom.perfSummaryRowsEl) return;

  if (!summaryObj) {
    dom.perfSummaryRowsEl.innerHTML = '<tr><td colspan="5" style="color:var(--text-sub);">查無總覽資料。</td></tr>';
    return;
  }
  dom.perfSummaryRowsEl.innerHTML = summaryRowsHtml_(summaryObj);
}

function renderDetailSummary_(detailRows) {
  const tmp = detailSummaryRowsHtml_(detailRows || []);
  applyDetailTableHtml_(tmp.html, tmp.count);
}

function renderDetailRows_(detailRows) {
  const tmp = detailRowsHtml_(detailRows || []);
  applyDetailTableHtml_(tmp.html, tmp.count);
}

/* =========================
 * Response Normalize（統一 GAS 回傳格式）
 * ========================= */

function normalizeReportResponse_(data) {
  if (!data || data.ok !== true) return { ok: false, error: (data && data.error) || "UNKNOWN" };

  // GAS 只回 hint（沒有資料）→ 轉成明確錯誤
  {
    const hasRows = data.summaryRow || data.summary || data.detailRows || data.detail;
    const hint = String(data.hint || "");
    if (!hasRows && hint) return { ok: false, error: "GAS_HINT_ONLY" };
  }

  const dateKey = String(data.dateKey || data.date || "");
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
    summaryObj = {
      排班: coerceCard("排班"),
      老點: coerceCard("老點"),
      總計: coerceCard("總計"),
    };
  }

  return {
    ok: true,
    dateKey,
    techNo,
    lastUpdatedAt,
    updateCount,
    summary: summaryObj,
    detail: Array.isArray(detailRows) ? detailRows : [],
  };
}

function normalizeDetailPerfResponse_(data) {
  if (!data || data.ok !== true) return { ok: false, error: (data && data.error) || "UNKNOWN" };

  {
    const hasRows = data.summaryRow || data.summary || data.detailRows || data.detail;
    const hint = String(data.hint || "");
    if (!hasRows && hint) return { ok: false, error: "GAS_HINT_ONLY" };
  }

  const rangeKey = String(data.rangeKey || "");
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
    summaryObj = {
      排班: coerceCard("排班"),
      老點: coerceCard("老點"),
      總計: coerceCard("總計"),
    };
  }

  return {
    ok: true,
    rangeKey,
    techNo,
    lastUpdatedAt,
    updateCount,
    summary: summaryObj,
    detail: Array.isArray(detailRows) ? detailRows : [],
  };
}

/* =========================
 * Fetch（帶 timeout）
 * ========================= */

async function fetchReport_(techNo, dateKey) {
  if (!config.REPORT_API_URL) throw new Error("CONFIG_REPORT_API_URL_MISSING");
  const q = "mode=getReport_v1" + "&techNo=" + encodeURIComponent(techNo) + "&dateKey=" + encodeURIComponent(dateKey);
  const url = withQuery(config.REPORT_API_URL, q);
  return await fetchJsonWithTimeout_(url, PERF_FETCH_TIMEOUT_MS, "REPORT");
}

async function fetchDetailPerf_(techNo, rangeKey) {
  const baseUrl = config.DETAIL_PERF_API_URL || config.REPORT_API_URL;
  if (!baseUrl) throw new Error("CONFIG_DETAIL_PERF_API_URL_MISSING");
  const q = "mode=getDetailPerf_v1" + "&techNo=" + encodeURIComponent(techNo) + "&rangeKey=" + encodeURIComponent(rangeKey);
  const url = withQuery(baseUrl, q);
  return await fetchJsonWithTimeout_(url, PERF_FETCH_TIMEOUT_MS, "DETAIL_PERF");
}

async function fetchJsonWithTimeout_(url, timeoutMs, tag) {
  const ms = Number(timeoutMs);
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : PERF_FETCH_TIMEOUT_MS;

  // 舊環境沒有 AbortController：退化但可用
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
  // legacy：由 viewSwitch 控制顯示/隱藏（保留函式避免舊版本殘留呼叫出錯）
}

/**
 * 初始化業績 UI（只綁事件 + 填預設日期）
 * - 不會自動打 API
 */
export function initPerformanceUi() {
  ensureDefaultDate_();

  // legacy：舊版只有一顆查詢（改為讀快取）
  if (dom.perfSearchBtn) dom.perfSearchBtn.addEventListener("click", () => void renderFromCache_("summary"));

  // v2：統計 / 明細（切換只渲染快取；缺資料會按需補抓）
  if (dom.perfSearchSummaryBtn) dom.perfSearchSummaryBtn.addEventListener("click", () => void renderFromCache_("summary"));
  if (dom.perfSearchDetailBtn) dom.perfSearchDetailBtn.addEventListener("click", () => void renderFromCache_("detail"));
}

/**
 * 登入後預載一次業績資料（若功能開通且為師傅）
 * ✅ 加速：只預載 Summary（不抓 Detail）
 */
export async function prefetchPerformanceOnce() {
  try {
    if (String(state.feature && state.feature.performanceEnabled) !== "是") return { ok: false, skipped: "FEATURE_OFF" };

    ensureDefaultDate_();

    const techNo = normalizeTechNo(state.myMaster && state.myMaster.techNo);
    if (!techNo) return { ok: false, skipped: "NOT_MASTER" };

    const summaryKey = makePerfSummaryKey_(techNo);
    if (perfCache_.summaryKey === summaryKey && perfCache_.summary) return { ok: true, cached: true };

    perfPrefetchInFlight_ = reloadAndCache_({ ok: true, techNo }, { showToast: false, fetchSummary: true, fetchDetail: false });
    const out = await perfPrefetchInFlight_;
    return out && out.ok ? { ok: true, prefetched: true } : out;
  } catch (e) {
    console.error("[Performance] prefetch failed:", e);
    return { ok: false, error: String(e && e.message ? e.message : e) };
  } finally {
    perfPrefetchInFlight_ = null;
  }
}

/**
 * 手動重整：強制抓 Summary + Detail
 */
export async function manualRefreshPerformance({ showToast } = { showToast: true }) {
  if (String(state.feature && state.feature.performanceEnabled) !== "是") return { ok: false, skipped: "FEATURE_OFF" };
  ensureDefaultDate_();

  const info = readRangeFromInputs_();
  if (!info.ok) {
    if (info.error === "NOT_MASTER") {
      setBadge_("你不是師傅（無法查詢）", true);
      return { ok: false, error: info.error };
    }
    if (info.error === "MISSING_START") {
      setBadge_("請選擇開始日期", true);
      return { ok: false, error: info.error };
    }
    if (info.error === "RANGE_TOO_LONG") {
      setBadge_("日期區間過長（最多 31 天）", true);
      return { ok: false, error: info.error };
    }
    setBadge_("日期格式不正確", true);
    return { ok: false, error: info.error || "BAD_RANGE" };
  }

  setBadge_("同步中…", false);

  const res = await reloadAndCache_(info, { showToast: !!showToast, fetchSummary: true, fetchDetail: true });
  if (!res || !res.ok) {
    const msg = String(res && res.error ? res.error : "RELOAD_FAILED");
    if (msg.includes("CONFIG_REPORT_API_URL_MISSING")) setBadge_("尚未設定 REPORT_API_URL", true);
    else if (msg.includes("CONFIG_DETAIL_PERF_API_URL_MISSING")) setBadge_("尚未設定 DETAIL_PERF_API_URL", true);
    else if (msg.includes("LOCKED_TRY_LATER")) setBadge_("系統忙碌，請稍後再試", true);
    else if (msg.includes("REPORT_TIMEOUT") || msg.includes("DETAIL_PERF_TIMEOUT")) setBadge_("查詢逾時，請稍後再試", true);
    else setBadge_("同步失敗", true);
    return res;
  }

  showError_(false);
  return await renderFromCache_(perfSelectedMode_, info);
}

/**
 * 切換到「業績」視圖時呼叫：
 * - 填預設日期
 * - 直接從快取渲染（缺資料會按需補抓）
 */
export function onShowPerformance() {
  ensureDefaultDate_();
  showError_(false);

  void renderFromCache_(perfSelectedMode_);

  // 清除可能殘留的 toast
  hideLoadingHint();
}
