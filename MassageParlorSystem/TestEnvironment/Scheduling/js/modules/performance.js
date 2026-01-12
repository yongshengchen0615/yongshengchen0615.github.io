/**
 * performance.js（完整重構版）
 *
 * ✅ 改動：
 * 1) 明細查詢：改用 startKey/endKey 呼叫 GAS
 * 2) 前端 cache 重構：SummaryKey=techNo，DetailKey=techNo+start~end
 * 3) 維持 orderDateKey_ 純日期過濾策略
 * 4) ✅ 修正你現在 UI 用 YYYY/MM/DD 造成永遠 BAD_DATE → 顯示空
 */

import { dom } from "./dom.js";
import { config } from "./config.js";
import { state } from "./state.js";
import { withQuery, escapeHtml } from "./core.js";
import { showLoadingHint, hideLoadingHint } from "./uiHelpers.js";
import { normalizeTechNo } from "./myMasterStatus.js";

const PERF_FETCH_TIMEOUT_MS = 20000;
const PERF_TZ = "Asia/Taipei";

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
  summary: null,
  detail: null,
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
 * Cache keys
 * ========================= */

function makePerfSummaryKey_(techNo) {
  return `${String(techNo || "").trim()}:LATEST_SUMMARY`;
}
function makePerfDetailKey_(techNo, startKey, endKey) {
  return `${String(techNo || "").trim()}:${String(startKey || "").trim()}~${String(endKey || "").trim()}`;
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
    renderSummary_(null);
    if (m === "detail") renderDetailRows_([]);
    else renderDetailSummary_([]);
    return { ok: false, error: "NOT_MASTER" };
  }

  const r = m === "detail" ? (info && info.ok ? info : readRangeFromInputs_()) : { ok: true, techNo };
  if (m === "detail" && (!r || !r.ok)) {
    setBadge_(r && r.error === "MISSING_START" ? "請選擇開始日期" : "日期格式不正確", true);
    setMeta_("—");
    renderSummary_(null);
    renderDetailRows_([]);
    return { ok: false, error: r ? r.error : "BAD_RANGE" };
  }

  const summaryKey = makePerfSummaryKey_(techNo);
  const detailKey = m === "detail" ? makePerfDetailKey_(techNo, r.startKey, r.endKey) : "";

  const hasSummary = perfCache_.summaryKey === summaryKey && !!perfCache_.summary;
  const hasDetail = m === "detail" ? perfCache_.detailKey === detailKey && !!perfCache_.detail : false;

  if (m === "summary" && !hasSummary) await reloadAndCache_({ ok: true, techNo }, { showToast: true, fetchSummary: true, fetchDetail: false });
  if (m === "detail" && !hasDetail) await reloadAndCache_(r, { showToast: true, fetchSummary: false, fetchDetail: true });

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
    setMeta_(`師傅：${techNo} ｜ 日期：${r.startKey} ~ ${r.endKey}`);
    renderDetailHeader_("detail");
    renderSummary_(null);
    renderDetailRows_([]);
    return { ok: false, error: "CACHE_MISS_DETAIL" };
  }

  if (m === "summary") {
    renderDetailHeader_("summary");
    const c = perfCache_.summary;
    setMeta_((c && c.meta) || "—");
    setBadge_("已更新", false);

    if (dom.perfSummaryRowsEl) dom.perfSummaryRowsEl.innerHTML = c?.summaryHtml || summaryRowsHtml_(c?.summaryObj || null);

    if (c?.detailAggHtml) applyDetailTableHtml_(c.detailAggHtml, Number(c.detailAggCount || 0) || 0);
    else {
      const tmp = detailSummaryRowsHtml_(c?.detailAgg || []);
      applyDetailTableHtml_(tmp.html, tmp.count);
    }
    return { ok: true, rendered: "summary" };
  }

  renderDetailHeader_("detail");
  const c = perfCache_.detail;

  setMeta_((c && c.meta) || "—");
  setBadge_("已更新", false);

  if (dom.perfSummaryRowsEl) dom.perfSummaryRowsEl.innerHTML = c?.summaryHtml || summaryRowsHtml_(c?.summaryObj || null);

  if (c?.detailRowsHtml) applyDetailTableHtml_(c.detailRowsHtml, Number(c.detailRowsCount || 0) || 0);
  else {
    const tmp = detailRowsHtml_(c?.detailRows || []);
    applyDetailTableHtml_(tmp.html, tmp.count);
  }
  return { ok: true, rendered: "detail" };
}

/* =========================
 * Reload / cache
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

        const meta = [`師傅：${nr.techNo || techNo}`, `統計來源：GAS 最新可用日期 ${found.dateKey}`, nr.lastUpdatedAt ? `最後更新：${nr.lastUpdatedAt}` : ""]
          .filter(Boolean)
          .join(" ｜ ");

        return {
          meta,
          summaryObj: nr.summary || null,
          detailAgg: Array.isArray(nr.detail) ? nr.detail : [],
          latestReportDateKey: found.dateKey,
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

        return { meta, summaryObj: rr.summary, detailRows: filtered, maxDetailDateKey: maxKey };
      })()
    : Promise.resolve({ skipped: true });

  try {
    const [sumRes, detRes] = await Promise.allSettled([summaryP, detailP]);

    if (sumRes.status === "fulfilled") {
      const v = sumRes.value;
      if (!(v && v.skipped)) {
        const tmp = detailSummaryRowsHtml_(v.detailAgg || []);
        perfCache_.summary = {
          ...v,
          summaryHtml: summaryRowsHtml_(v.summaryObj || null),
          detailAggHtml: tmp.html,
          detailAggCount: tmp.count,
        };
      }
    }

    if (detRes.status === "fulfilled") {
      const v = detRes.value;
      if (!(v && v.skipped)) {
        const tmp = detailRowsHtml_(v.detailRows || []);
        perfCache_.detail = {
          ...v,
          summaryHtml: summaryRowsHtml_(v.summaryObj || null),
          detailRowsHtml: tmp.html,
          detailRowsCount: tmp.count,
        };
      }
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
 * Render helpers
 * ========================= */

function renderSummary_(summaryObj) {
  if (!dom.perfSummaryRowsEl) return;
  dom.perfSummaryRowsEl.innerHTML = summaryObj ? summaryRowsHtml_(summaryObj) : '<tr><td colspan="5" style="color:var(--text-sub);">查無總覽資料。</td></tr>';
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
 * Normalize responses
 * ========================= */

function normalizeReportResponse_(data) {
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

async function fetchReport_(techNo, dateKey) {
  if (!config.REPORT_API_URL) throw new Error("CONFIG_REPORT_API_URL_MISSING");
  const q = "mode=getReport_v1" + "&techNo=" + encodeURIComponent(techNo) + "&dateKey=" + encodeURIComponent(dateKey);
  const url = withQuery(config.REPORT_API_URL, q);
  return await fetchJsonWithTimeout_(url, PERF_FETCH_TIMEOUT_MS, "REPORT");
}

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
    encodeURIComponent(endKey);

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

  if (dom.perfSearchBtn) dom.perfSearchBtn.addEventListener("click", () => void renderFromCache_("summary"));
  if (dom.perfSearchSummaryBtn) dom.perfSearchSummaryBtn.addEventListener("click", () => void renderFromCache_("summary"));
  if (dom.perfSearchDetailBtn) dom.perfSearchDetailBtn.addEventListener("click", () => void renderFromCache_("detail"));
}

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
    else if (msg.includes("REPORT_TIMEOUT") || msg.includes("DETAIL_PERF_TIMEOUT")) setBadge_("查詢逾時，請稍後再試", true);
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
}
