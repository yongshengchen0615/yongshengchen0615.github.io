/**
 * performance.js
 *
 * index.html 內的「師傅業績」區塊：
 * - 點擊「業績」按鈕顯示/隱藏 perfCard
 * - 依 state.myMaster.techNo + dateKey 呼叫 REPORT_API_URL(mode=getReport_v1)
 * - 渲染 Summary + Detail
 */

import { dom } from "./dom.js";
import { config } from "./config.js";
import { state } from "./state.js";
import { withQuery, escapeHtml } from "./core.js";
import { showLoadingHint, hideLoadingHint } from "./uiHelpers.js";
import { normalizeTechNo } from "./myMasterStatus.js";

function localDateKeyToday_() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
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

function renderDetail_(detailRows) {
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

async function fetchReport_(techNo, dateKey) {
  if (!config.REPORT_API_URL) throw new Error("CONFIG_REPORT_API_URL_MISSING");

  const q =
    "mode=getReport_v1" +
    "&techNo=" +
    encodeURIComponent(techNo) +
    "&dateKey=" +
    encodeURIComponent(dateKey);

  const url = withQuery(config.REPORT_API_URL, q);
  const resp = await fetch(url, { method: "GET", cache: "no-store" });
  if (!resp.ok) throw new Error("REPORT_HTTP_" + resp.status);
  return await resp.json();
}

async function runSearch_() {
  showError_(false);

  const techNo = normalizeTechNo(state.myMaster && state.myMaster.techNo);
  const dateKey = String(dom.perfDateKeyInput && dom.perfDateKeyInput.value ? dom.perfDateKeyInput.value : "").trim();

  if (!techNo) {
    setBadge_("你不是師傅（無法查詢）", true);
    setMeta_("—");
    renderSummary_(null);
    renderDetail_([]);
    return;
  }

  if (!dateKey) {
    setBadge_("請選擇日期", true);
    return;
  }

  setBadge_("查詢中…", false);
  showLoadingHint("查詢業績中…");

  try {
    const raw = await fetchReport_(techNo, dateKey);
    const r = normalizeReportResponse_(raw);
    if (!r.ok) throw new Error(String(r.error || "BAD_RESPONSE"));

    const meta = [
      `師傅：${r.techNo || techNo}`,
      `日期：${r.dateKey || dateKey}`,
      r.lastUpdatedAt ? `最後更新：${r.lastUpdatedAt}` : "",
      r.updateCount ? `更新次數：${r.updateCount}` : "",
    ]
      .filter(Boolean)
      .join(" ｜ ");

    setMeta_(meta || "—");
    setBadge_("已更新", false);

    renderSummary_(r.summary);
    renderDetail_(r.detail);
  } catch (e) {
    console.error("[Performance] fetch failed:", e);

    const msg = String(e && e.message ? e.message : e);
    if (msg.includes("CONFIG_REPORT_API_URL_MISSING")) setBadge_("尚未設定 REPORT_API_URL", true);
    else if (msg.includes("GAS_HINT_ONLY")) setBadge_("GAS 未實作 getReport_v1（doGet 只回 hint）", true);
    else setBadge_("查詢失敗", true);

    showError_(true);
    setMeta_("—");
    renderSummary_(null);
    renderDetail_([]);
  } finally {
    hideLoadingHint();
  }
}

function ensureDefaultDate_() {
  if (!dom.perfDateKeyInput) return;
  if (dom.perfDateKeyInput.value) return;
  dom.perfDateKeyInput.value = localDateKeyToday_();
}

export function togglePerformanceCard() {
  // legacy: 由 viewSwitch 控制顯示/隱藏（保留函式避免舊版本殘留呼叫出錯）
}

export function initPerformanceUi() {
  ensureDefaultDate_();

  if (dom.perfSearchBtn) dom.perfSearchBtn.addEventListener("click", () => void runSearch_());
}

/**
 * 切換到「業績」視圖時呼叫：確保日期有值並自動查詢一次。
 */
export function onShowPerformance() {
  ensureDefaultDate_();
  void runSearch_();
}
