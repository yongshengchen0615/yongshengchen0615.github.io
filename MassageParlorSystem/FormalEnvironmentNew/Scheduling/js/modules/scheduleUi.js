/**
 * scheduleUi.js
 *
 * 排班表開通=否時：
 * - 隱藏 tabs/filters/table/refresh
 * - 只顯示「我的狀態」
 * - 若非師傅：顯示提示卡「你不是師傅，因此無法顯示我的狀態」
 */

import { dom } from "./dom.js";
import { state } from "./state.js";

let notMasterHintEl = null;

function ensureNotMasterHint() {
  if (notMasterHintEl && document.body.contains(notMasterHintEl)) return notMasterHintEl;

  notMasterHintEl = document.createElement("div");
  notMasterHintEl.id = "notMasterHint";
  notMasterHintEl.style.display = "none";
  notMasterHintEl.style.margin = "0 0 14px 0";
  notMasterHintEl.style.padding = "10px 14px";
  notMasterHintEl.style.borderRadius = "16px";
  notMasterHintEl.style.border = "1px solid rgba(148, 163, 184, 0.55)";
  notMasterHintEl.style.background = "rgba(15, 23, 42, 0.65)";
  notMasterHintEl.style.color = "var(--text-main)";
  notMasterHintEl.style.fontSize = "13px";
  notMasterHintEl.style.lineHeight = "1.6";
  notMasterHintEl.style.position = "relative";
  notMasterHintEl.style.overflow = "hidden";
  notMasterHintEl.innerHTML = `
    <div style="font-size:12px;color:var(--text-sub);font-weight:700;letter-spacing:.02em;margin-bottom:4px;">
      提示
    </div>
    <div>你不是師傅，因此無法顯示「我的狀態」。</div>
  `;

  const stripe = document.createElement("div");
  stripe.style.position = "absolute";
  stripe.style.left = "0";
  stripe.style.top = "0";
  stripe.style.bottom = "0";
  stripe.style.width = "6px";
  stripe.style.background = "rgba(148, 163, 184, 0.7)";
  notMasterHintEl.appendChild(stripe);

  const layout = document.querySelector(".layout");
  if (dom.myMasterStatusEl && dom.myMasterStatusEl.parentNode) {
    dom.myMasterStatusEl.parentNode.insertBefore(notMasterHintEl, dom.myMasterStatusEl);
  } else if (layout) {
    layout.insertBefore(notMasterHintEl, layout.firstChild);
  } else {
    document.body.insertBefore(notMasterHintEl, document.body.firstChild);
  }

  return notMasterHintEl;
}

export function showNotMasterHint(show) {
  const el = ensureNotMasterHint();
  el.style.display = show ? "block" : "none";
}

/**
 * 控制「排班表 UI 是否啟用」
 * - enabled=false：隱藏整段面板 UI，只顯示我的狀態
 */
export function applyScheduleUiMode(enabled) {
  state.scheduleUiEnabled = !!enabled;

  // 面板功能整段隱藏
  if (dom.toolbarEl) dom.toolbarEl.style.display = state.scheduleUiEnabled ? "" : "none";
  if (dom.mainEl) dom.mainEl.style.display = state.scheduleUiEnabled ? "" : "none";
  if (dom.cardTableEl) dom.cardTableEl.style.display = state.scheduleUiEnabled ? "" : "none";

  // 面板操作也隱藏（避免誤觸）
  if (dom.refreshBtn) dom.refreshBtn.style.display = state.scheduleUiEnabled ? "" : "none";
  if (dom.tabBodyBtn) dom.tabBodyBtn.style.display = state.scheduleUiEnabled ? "" : "none";
  if (dom.tabFootBtn) dom.tabFootBtn.style.display = state.scheduleUiEnabled ? "" : "none";
  if (dom.filterMasterWrapEl) dom.filterMasterWrapEl.style.display = state.scheduleUiEnabled ? "" : "none";
  if (dom.filterStatusWrapEl) dom.filterStatusWrapEl.style.display = state.scheduleUiEnabled ? "" : "none";

  // 只顯示我的狀態（非師傅仍會被 myMasterStatus 模組控制顯示/隱藏）
  if (dom.myMasterStatusEl) dom.myMasterStatusEl.style.display = "flex";

  // 狀態提示文字
  if (dom.connectionStatusEl) {
    dom.connectionStatusEl.textContent = state.scheduleUiEnabled ? "連線中…" : "排班表未開通（僅顯示我的狀態）";
  }

  // schedule=否：清掉表格（避免閃一下）
  if (!state.scheduleUiEnabled) {
    if (dom.tbodyRowsEl) dom.tbodyRowsEl.innerHTML = "";
    if (dom.emptyStateEl) dom.emptyStateEl.style.display = "none";
    if (dom.errorStateEl) dom.errorStateEl.style.display = "none";

    const isMaster = !!(state.myMaster && state.myMaster.isMaster && state.myMaster.techNo);
    showNotMasterHint(!isMaster);
  } else {
    showNotMasterHint(false);
  }
}
