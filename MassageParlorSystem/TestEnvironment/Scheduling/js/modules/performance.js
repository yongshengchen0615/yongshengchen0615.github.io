/**
 * performance.js
 *
 * index.html 內的「師傅業績」區塊：
 * - 點擊「業績」按鈕顯示/隱藏 perfCard
 * - 依 state.myMaster.techNo + 日期(或日期區間) 呼叫 REPORT_API_URL(mode=getReport_v1)
 * - 渲染 Summary + Detail
 */

import { dom } from "./dom.js";
import { config } from "./config.js";
import { state } from "./state.js";
import { withQuery, escapeHtml } from "./core.js";
import { showLoadingHint, hideLoadingHint } from "./uiHelpers.js";
import { normalizeTechNo } from "./myMasterStatus.js";

const PERF_FETCH_TIMEOUT_MS = 20000;

const PERF_TZ = "Asia/Taipei";

// Intl formatter 建立成本很高；在 iOS/LINE WebView 反覆 new 會明顯變慢。
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
  } catch {}
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
  } catch {}
  return null;
})();

let perfRequestSeq_ = 0;
let lastAutoSearchAtMs_ = 0;

let perfSelectedMode_ = "detail"; // detail | summary
let perfPrefetchInFlight_ = null;

const perfCache_ = {
  key: "", // techNo:start~end
  summary: null, // { meta, summaryObj, detailAgg }
  detail: null, // { meta, summaryObj, detailRows }
};

function pad2_(n) {
  return String(n).padStart(2, "0");
}

function formatDateYmd_(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s) return "";

  // 已是 YYYY-MM-DD / YYYY/MM/DD：正規化成 YYYY/MM/DD
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}/${pad2_(m[2])}/${pad2_(m[3])}`;

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}/${pad2_(d.getMonth() + 1)}/${pad2_(d.getDate())}`;
  }

  return s;
}

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

  try {
    if (PERF_TPE_TIME_FMT) {
      const out = PERF_TPE_TIME_FMT.format(d);
      if (out) return out;
    }
  } catch {
    // fall through
  }

  // Fallback: Taiwan is UTC+8
  const tzMs = d.getTime() + 8 * 60 * 60 * 1000;
  const t = new Date(tzMs);
  return `${pad2_(t.getUTCHours())}:${pad2_(t.getUTCMinutes())}:${pad2_(t.getUTCSeconds())}`;
}

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

function hasCacheForKey_(cacheKey) {
  return perfCache_.key === cacheKey && !!(perfCache_.summary || perfCache_.detail);
}

function hasFullCacheForKey_(cacheKey) {
  return perfCache_.key === cacheKey && !!perfCache_.summary && !!perfCache_.detail;
}

function renderFromCache_(mode, info) {
  const m = mode === "summary" ? "summary" : "detail";
  perfSelectedMode_ = m;

  const r = info && info.ok ? info : readRangeFromInputs_();
  if (!r || !r.ok) {
    if (r && r.error === "NOT_MASTER") {
      setBadge_("你不是師傅（無法查詢）", true);
      setMeta_("—");
      renderSummary_(null);
      if (m === "detail") renderDetailRows_([]);
      else renderDetailSummary_([]);
      return { ok: false, error: r ? r.error : "BAD_RANGE" };
    }
    setBadge_("日期格式不正確", true);
    return { ok: false, error: r ? r.error : "BAD_RANGE" };
  }

  const cacheKey = makePerfCacheKey_(r.techNo, r.normalizedStart, r.normalizedEnd);
  if (!hasCacheForKey_(cacheKey)) {
    if (perfPrefetchInFlight_) {
      setBadge_("業績載入中…", false);
    } else {
      setBadge_("尚未載入（請按手動重整）", true);
    }
    setMeta_(`師傅：${r.techNo} ｜ 日期：${r.normalizedStart} ~ ${r.normalizedEnd}`);
    renderSummary_(null);
    if (m === "detail") renderDetailRows_([]);
    else renderDetailSummary_([]);
    return { ok: false, error: "CACHE_MISS" };
  }

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

  renderDetailHeader_("detail");
  const c = perfCache_.detail;
  setMeta_((c && c.meta) || "—");
  setBadge_("已更新", false);
  if (dom.perfSummaryRowsEl) dom.perfSummaryRowsEl.innerHTML = c && c.summaryHtml ? c.summaryHtml : summaryRowsHtml_(c ? c.summaryObj : null);
  if (c && c.detailRowsHtml) applyDetailTableHtml_(c.detailRowsHtml, Number(c.detailRowsCount || 0) || 0);
  else {
    const tmp = detailRowsHtml_(c ? c.detailRows : []);
    applyDetailTableHtml_(tmp.html, tmp.count);
  }
  return { ok: true, rendered: "detail" };
}

async function reloadAndCache_(info, { showToast } = { showToast: true }) {
  const r = info && info.ok ? info : readRangeFromInputs_();
  if (!r || !r.ok) return { ok: false, error: (r && r.error) || "BAD_RANGE" };

  const cacheKey = makePerfCacheKey_(r.techNo, r.normalizedStart, r.normalizedEnd);
  perfCache_.key = cacheKey;
  perfCache_.summary = null;
  perfCache_.detail = null;

  if (showToast) hideLoadingHint();

const summaryP = (async () => {
  const keys = r.dateKeys;
  const lastKey = keys && keys.length ? keys[keys.length - 1] : r.normalizedEnd;

  if (showToast) showLoadingHint(`查詢業績統計中…（最新：${lastKey}）`);

  let nr = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await fetchReport_(r.techNo, lastKey);
    nr = normalizeReportResponse_(raw);
    if (nr.ok) break;

    lastErr = String(nr.error || "BAD_RESPONSE");
    if (lastErr === "LOCKED_TRY_LATER" && attempt < 2) {
      await sleep_(900 + attempt * 600);
      continue;
    }
    break;
  }
  if (!nr || !nr.ok) throw new Error(lastErr || "BAD_RESPONSE");

  // meta：仍顯示區間，但「統計」使用最新那天的資料
  const meta = [
    `師傅：${nr.techNo || r.techNo}`,
    `日期：${r.normalizedStart} ~ ${r.normalizedEnd}`,
    nr.lastUpdatedAt ? `最後更新：${nr.lastUpdatedAt}` : "",
    `統計基準：${lastKey}（最新）`,
  ].filter(Boolean).join(" ｜ ");

  const summaryObj = nr.summary || null;
  const detailAgg = Array.isArray(nr.detail) ? nr.detail : []; // 直接用當天的服務項目彙總（不跨日加總）
  return { meta, summaryObj, detailAgg };
})();

  const detailP = (async () => {
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

    return { meta, summaryObj: rr.summary, detailRows: filterDetailRowsByRange_(rr.detail, r.normalizedStart, r.normalizedEnd) };
  })();

  try {
    const [sumRes, detRes] = await Promise.allSettled([summaryP, detailP]);
    if (sumRes.status === "fulfilled") {
      const v = sumRes.value;
      perfCache_.summary = {
        ...v,
        summaryHtml: summaryRowsHtml_(v && v.summaryObj ? v.summaryObj : null),
        ...(v && v.detailAgg ? (() => {
          const tmp = detailSummaryRowsHtml_(v.detailAgg);
          return { detailAggHtml: tmp.html, detailAggCount: tmp.count };
        })() : { detailAggHtml: "", detailAggCount: 0 }),
      };
    }
    if (detRes.status === "fulfilled") {
      const v = detRes.value;
      const rows = v && v.detailRows ? v.detailRows : [];
      const tmp = detailRowsHtml_(rows);
      perfCache_.detail = {
        ...v,
        summaryHtml: summaryRowsHtml_(v && v.summaryObj ? v.summaryObj : null),
        detailRowsHtml: tmp.html,
        detailRowsCount: tmp.count,
      };
    }

    if (!perfCache_.summary && !perfCache_.detail) {
      const err = [sumRes, detRes]
        .map((x) => (x.status === "rejected" ? String(x.reason && x.reason.message ? x.reason.message : x.reason) : ""))
        .filter(Boolean)[0];
      throw new Error(err || "RELOAD_FAILED");
    }

    return { ok: true, cacheKey, partial: !(perfCache_.summary && perfCache_.detail) };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  } finally {
    if (showToast) hideLoadingHint();
  }
}

function sleep_(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function beginPerfRequest_(text) {
  perfRequestSeq_++;
  const seq = perfRequestSeq_;
  showLoadingHint(text);
  return seq;
}

function endPerfRequest_(seq) {
  // 只允許最後一次查詢關掉 toast（避免舊請求覆蓋新請求的顯示狀態）
  if (seq === perfRequestSeq_) hideLoadingHint();
}

function makePerfCacheKey_(techNo, startKey, endKey) {
  return `${String(techNo || "").trim()}:${String(startKey || "").trim()}~${String(endKey || "").trim()}`;
}

function readRangeFromInputs_() {
  const techNo = normalizeTechNo(state.myMaster && state.myMaster.techNo);
  const startKey = String(dom.perfDateStartInput && dom.perfDateStartInput.value ? dom.perfDateStartInput.value : "").trim();
  const endKeyRaw = String(dom.perfDateEndInput && dom.perfDateEndInput.value ? dom.perfDateEndInput.value : "").trim();
  const endKey = endKeyRaw || startKey;

  if (!techNo) return { ok: false, error: "NOT_MASTER", techNo: "", startKey, endKey };
  if (!startKey) return { ok: false, error: "MISSING_START", techNo, startKey, endKey };

  const range = buildDateKeys_(startKey, endKey, 31);
  if (!range.ok) return { ok: false, error: range.error || "BAD_RANGE", techNo, startKey, endKey };

  // 若使用者輸入反了，自動同步回輸入框
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

function localDateKeyToday_() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function localDateKeyMonthStart_() {
  const now = new Date();
  // 用本地日期組出當月 1 號（避免 UTC offset 導致月份/日期偏移）
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function parseDateKey_(s) {
  const v = String(s || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  // 使用本地 00:00 避免跨時區偏移
  const d = new Date(v + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return { key: v, date: d };
}

function toDateKey_(d) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function buildDateKeys_(startKey, endKey, maxDays) {
  const a = parseDateKey_(startKey);
  const b = parseDateKey_(endKey);
  if (!a || !b) return { ok: false, error: "BAD_DATE" };

  let start = a.date;
  let end = b.date;
  if (end.getTime() < start.getTime()) {
    // 使用者輸入反了：自動交換（也會同步回輸入框）
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

  // 若 end-start 超出限制，out 會提早結束
  if (out.length && out[out.length - 1] !== toDateKey_(end)) {
    return { ok: false, error: "RANGE_TOO_LONG", days: out.length };
  }

  return { ok: true, keys: out, normalizedStart: toDateKey_(start), normalizedEnd: toDateKey_(end) };
}

function toDateKeyTaipei_(v) {
  if (v === null || v === undefined) return "";

  // Fast path: YYYY-MM-DD or YYYY/MM/DD
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

  try {
    if (PERF_TPE_DATE_PARTS_FMT) {
      const parts = PERF_TPE_DATE_PARTS_FMT.formatToParts(d);
      let yyyy = "";
      let mm = "";
      let dd = "";
      for (const p of parts) {
        if (p.type === "year") yyyy = p.value;
        else if (p.type === "month") mm = p.value;
        else if (p.type === "day") dd = p.value;
      }
      if (yyyy && mm && dd) return `${yyyy}-${mm}-${dd}`;
    }
  } catch {
    // fall through
  }

  // Fallback: Taiwan is UTC+8 (no DST)
  const tzMs = d.getTime() + 8 * 60 * 60 * 1000;
  const t = new Date(tzMs);
  const yyyy = String(t.getUTCFullYear());
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function filterDetailRowsByRange_(detailRows, startKey, endKey) {
  const rows = Array.isArray(detailRows) ? detailRows : [];
  const s = String(startKey || "").trim();
  const e = String(endKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return rows;

  return rows.filter((r) => {
    const dk = toDateKeyTaipei_(r && r["訂單日期"]);
    // 若無法辨識日期：保守不過濾，避免誤刪資料
    if (!dk) return true;
    return dk >= s && dk <= e;
  });
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
  if (dom.perfDetailCountEl) dom.perfDetailCountEl.textContent = `${Number(n) || 0} 筆`;
}

function renderDetailHeader_(mode) {
  if (!dom.perfDetailHeadRowEl) return;

  if (mode === "detail") {
    dom.perfDetailHeadRowEl.innerHTML =
      "<th>訂單日期</th>" +
      "<th>訂單編號</th>" +
      "<th>序</th>" +
      "<th>拉牌</th>" +
      "<th>服務項目</th>" +
      "<th>業績金額</th>" +
      "<th>抽成金額</th>" +
      "<th>數量</th>" +
      "<th>小計</th>" +
      "<th>分鐘</th>" +
      "<th>開工</th>" +
      "<th>完工</th>" +
      "<th>狀態</th>";
    return;
  }

  // default: summary detail (服務項目彙總)
  dom.perfDetailHeadRowEl.innerHTML =
    "<th>服務項目</th>" +
    "<th>總筆數</th>" +
    "<th>總節數</th>" +
    "<th>總計金額</th>" +
    "<th>老點筆數</th>" +
    "<th>老點節數</th>" +
    "<th>老點金額</th>" +
    "<th>排班筆數</th>" +
    "<th>排班節數</th>" +
    "<th>排班金額</th>";
}

function renderSummary_(summaryObj) {
  if (!dom.perfSummaryRowsEl) return;

  if (!summaryObj) {
    dom.perfSummaryRowsEl.innerHTML = '<tr><td colspan="5" style="color:var(--text-sub);">查無總覽資料。</td></tr>';
    return;
  }

  const td = (v) => `<td>${escapeHtml(String(v ?? ""))}</td>`;

  const cards = [
    { label: "排班", card: summaryObj["排班"] || {} },
    { label: "老點", card: summaryObj["老點"] || {} },
    { label: "總計", card: summaryObj["總計"] || {} },
  ];

  dom.perfSummaryRowsEl.innerHTML = cards
    .map(({ label, card }) => {
      return `<tr>${td(label)}${td(card.單數 ?? 0)}${td(card.筆數 ?? 0)}${td(card.數量 ?? 0)}${td(card.金額 ?? 0)}</tr>`;
    })
    .join("");
}

function renderDetailSummary_(detailRows) {
  if (!dom.perfDetailRowsEl) return;

  const list = Array.isArray(detailRows) ? detailRows : [];
  setDetailCount_(list.length);

  if (!list.length) {
    dom.perfDetailRowsEl.innerHTML = "";
    showEmpty_(true);
    return;
  }

  showEmpty_(false);

  const td = (v) => `<td>${escapeHtml(String(v ?? ""))}</td>`;
  dom.perfDetailRowsEl.innerHTML = list
    .map((r) => {
      return (
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
      );
    })
    .join("");
}

function renderDetailRows_(detailRows) {
  if (!dom.perfDetailRowsEl) return;

  const list = Array.isArray(detailRows) ? detailRows : [];
  setDetailCount_(list.length);

  if (!list.length) {
    dom.perfDetailRowsEl.innerHTML = "";
    showEmpty_(true);
    return;
  }

  showEmpty_(false);

  const pad2 = (n) => String(n).padStart(2, "0");

  const formatDateYmd_ = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v).trim();
    if (!s) return "";

    // 已是 YYYY-MM-DD / YYYY/MM/DD：直接正規化成 YYYY/MM/DD
    const m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
    if (m) return `${m[1]}/${m[2]}/${m[3]}`;

    // ISO 或可 parse 的日期
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
    }

    return s;
  };

  const formatTimeHm_ = (v) => {
    if (v === null || v === undefined) return "";

    // 1) 若是純時間字串：正規化成 HH:mm:ss（補零 + 補秒）
    if (typeof v === "string") {
      const s0 = v.trim();
      if (!s0) return "";
      const m = s0.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (m) return `${pad2(m[1])}:${m[2]}:${m[3] ? m[3] : "00"}`;
    }

    // 2) ISO/Date：換算成台北時間並輸出 HH:mm:ss
    const d = v instanceof Date ? v : new Date(String(v).trim());
    if (Number.isNaN(d.getTime())) return String(v ?? "").trim();

    // 盡量用 Intl 做時區格式化（快很多：formatter 已 memoize）；不支援時用固定 UTC+8 回退
    try {
      if (PERF_TPE_TIME_FMT) {
        const out = PERF_TPE_TIME_FMT.format(d);
        if (out) return out;
      }
    } catch {
      // fall through
    }

    const tzMs = d.getTime() + 8 * 60 * 60 * 1000;
    const t = new Date(tzMs);
    return `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}:${pad2(t.getUTCSeconds())}`;
  };

  const td = (v) => `<td>${escapeHtml(String(v ?? ""))}</td>`;
  dom.perfDetailRowsEl.innerHTML = list
    .map((r) => {
      return (
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
        td(formatTimeHm_(r["開工"])) +
        td(formatTimeHm_(r["完工"])) +
        td(r["狀態"] || "") +
        "</tr>"
      );
    })
    .join("");
}

function normalizeReportResponse_(data) {
  if (!data || data.ok !== true) return { ok: false, error: (data && data.error) || "UNKNOWN" };

  // ✅ 常見狀況：GAS doGet 只回 hint/now，但沒有實作 getReport_v1 查詢。
  // 這種情況前端會顯示「查無資料」但其實是 API 沒做，這裡轉成明確錯誤。
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

  // summary：支援 nested 或 flat 欄位
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

async function fetchReport_(techNo, dateKey) {
  if (!config.REPORT_API_URL) throw new Error("CONFIG_REPORT_API_URL_MISSING");

  const q =
    "mode=getReport_v1" +
    "&techNo=" +
    encodeURIComponent(techNo) +
    "&dateKey=" +
    encodeURIComponent(dateKey);

  const url = withQuery(config.REPORT_API_URL, q);
  return await fetchJsonWithTimeout_(url, PERF_FETCH_TIMEOUT_MS, "REPORT");
}

async function fetchDetailPerf_(techNo, rangeKey) {
  const baseUrl = config.DETAIL_PERF_API_URL || config.REPORT_API_URL;
  if (!baseUrl) throw new Error("CONFIG_DETAIL_PERF_API_URL_MISSING");

  const q =
    "mode=getDetailPerf_v1" +
    "&techNo=" +
    encodeURIComponent(techNo) +
    "&rangeKey=" +
    encodeURIComponent(rangeKey);

  const url = withQuery(baseUrl, q);
  return await fetchJsonWithTimeout_(url, PERF_FETCH_TIMEOUT_MS, "DETAIL_PERF");
}

async function fetchJsonWithTimeout_(url, timeoutMs, tag) {
  const ms = Number(timeoutMs);
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 20000;

  // AbortController 在舊環境可能不存在（best-effort）
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
    if (e && (e.name === "AbortError" || String(e).includes("AbortError"))) {
      throw new Error(`${tag}_TIMEOUT`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function sumNumber_(a, b) {
  const na = Number(a ?? 0);
  const nb = Number(b ?? 0);
  return (Number.isNaN(na) ? 0 : na) + (Number.isNaN(nb) ? 0 : nb);
}

function aggregateSummary_(items) {
  const rows = Array.isArray(items) ? items : [];
  const initCard = () => ({ 單數: 0, 筆數: 0, 數量: 0, 金額: 0 });
  const out = { 排班: initCard(), 老點: initCard(), 總計: initCard() };

  for (const it of rows) {
    const s = it && it.summary ? it.summary : null;
    if (!s) continue;
    for (const k of ["排班", "老點", "總計"]) {
      const card = s[k] || {};
      out[k].單數 = sumNumber_(out[k].單數, card.單數);
      out[k].筆數 = sumNumber_(out[k].筆數, card.筆數);
      out[k].數量 = sumNumber_(out[k].數量, card.數量);
      out[k].金額 = sumNumber_(out[k].金額, card.金額);
    }
  }

  return out;
}

function aggregateDetail_(items) {
  const rows = Array.isArray(items) ? items : [];
  const map = new Map();
  const keys = [
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

  for (const it of rows) {
    const detail = Array.isArray(it && it.detail) ? it.detail : [];
    for (const r of detail) {
      const name = String((r && r["服務項目"]) || "").trim();
      if (!name) continue;
      const acc = map.get(name) || { "服務項目": name };
      for (const k of keys) acc[k] = sumNumber_(acc[k], r && r[k]);
      map.set(name, acc);
    }
  }

  // 穩定排序：依服務項目文字
  return Array.from(map.values()).sort((a, b) => String(a["服務項目"]).localeCompare(String(b["服務項目"]), "zh-Hant"));
}

async function runSearch_() {
  // legacy alias (保留函式名，避免外部殘留引用)
  return await runSearchSummary_();
}

async function runSearchSummary_() {
  showError_(false);
  return renderFromCache_("summary");
}

async function runSearchDetail_() {
  showError_(false);
  return renderFromCache_("detail");
}

function ensureDefaultDate_() {
  const today = localDateKeyToday_();
  const monthStart = localDateKeyMonthStart_();

  // 新版：日期區間（開始=當月1號；結束=今日）
  if (dom.perfDateStartInput && !dom.perfDateStartInput.value) dom.perfDateStartInput.value = monthStart;
  if (dom.perfDateEndInput && !dom.perfDateEndInput.value) dom.perfDateEndInput.value = today;

  // 舊版：單日
  if (dom.perfDateKeyInput && !dom.perfDateKeyInput.value) dom.perfDateKeyInput.value = today;
}

export function togglePerformanceCard() {
  // legacy: 由 viewSwitch 控制顯示/隱藏（保留函式避免舊版本殘留呼叫出錯）
}

export function initPerformanceUi() {
  ensureDefaultDate_();

  // legacy: 舊版只有一顆查詢（改為讀快取）
  if (dom.perfSearchBtn) dom.perfSearchBtn.addEventListener("click", () => void renderFromCache_("summary"));

  // v2: 統計 / 明細（只讀快取；重新載入由「手動重整」觸發）
  if (dom.perfSearchSummaryBtn) dom.perfSearchSummaryBtn.addEventListener("click", () => void renderFromCache_("summary"));
  if (dom.perfSearchDetailBtn) dom.perfSearchDetailBtn.addEventListener("click", () => void renderFromCache_("detail"));
}

/**
 * 登入後預載一次業績資料（若功能開通且為師傅）。
 * - 會同時預載「統計」與「明細」並快取
 * - 預設渲染為明細（訂單列表），避免使用者還要再點按鈕
 */
export async function prefetchPerformanceOnce() {
  try {
    // feature off → no-op
    if (String(state.feature && state.feature.performanceEnabled) !== "是") return { ok: false, skipped: "FEATURE_OFF" };

    ensureDefaultDate_();
    const info = readRangeFromInputs_();
    if (!info.ok) return { ok: false, skipped: info.error || "BAD_RANGE" };

    const cacheKey = makePerfCacheKey_(info.techNo, info.normalizedStart, info.normalizedEnd);
    if (hasFullCacheForKey_(cacheKey)) {
      // 已有完整快取：不打 API（登入時預載只需確保快取存在）
      return { ok: true, cached: true };
    }

    perfPrefetchInFlight_ = reloadAndCache_(info, { showToast: false });
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
  const res = await reloadAndCache_(info, { showToast: !!showToast });
  if (!res || !res.ok) {
    const msg = String(res && res.error ? res.error : "RELOAD_FAILED");
    if (msg.includes("CONFIG_REPORT_API_URL_MISSING")) setBadge_("尚未設定 REPORT_API_URL", true);
    else if (msg.includes("CONFIG_DETAIL_PERF_API_URL_MISSING")) setBadge_("尚未設定 DETAIL_PERF_API_URL", true);
    else if (msg.includes("LOCKED_TRY_LATER")) setBadge_("系統忙碌，請稍後再試", true);
    else if (msg.includes("REPORT_TIMEOUT") || msg.includes("DETAIL_PERF_TIMEOUT")) setBadge_("查詢逾時，請稍後再試", true);
    else setBadge_("同步失敗", true);
    return res;
  }

  // 同步完成後：只渲染快取（依使用者最後選的明細/統計）
  showError_(false);
  return renderFromCache_(perfSelectedMode_, info);
}

/**
 * 切換到「業績」視圖時呼叫：
 * - 補預設日期
 * - 直接從快取渲染（不打 API）
 *   讓切換到業績面板時可以立刻看到「統計/明細」
 */
export function onShowPerformance() {
  ensureDefaultDate_();

  // 進入業績頁時，先隱藏錯誤提示，並用快取渲染最後選擇的模式。
  showError_(false);
  try {
    renderFromCache_(perfSelectedMode_);
  } catch {}

  // 進入業績頁時，若之前有殘留 toast，先關掉
  hideLoadingHint();
}
