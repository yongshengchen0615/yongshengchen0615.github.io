/**
 * uiHelpers.js
 *
 * UI 小工具：
 * - 顯示/隱藏 Gate
 * - 顯示/隱藏頂部載入提示
 * - 顯示主畫面
 * - 使用者剩餘天數橫幅
 */

import { dom } from "./dom.js";

/**
 * 顯示頂部載入提示（不影響版面，fixed toast）。
 * @param {string} [text] 顯示文字；未提供則使用預設文案。
 */
export function showLoadingHint(text) {
  if (!dom.topLoadingEl) return;
  if (dom.topLoadingTextEl) dom.topLoadingTextEl.textContent = text || "資料載入中…";
  dom.topLoadingEl.classList.remove("hidden");
}

/** 隱藏頂部載入提示。 */
export function hideLoadingHint() {
  if (!dom.topLoadingEl) return;
  dom.topLoadingEl.classList.add("hidden");
}

/**
 * 顯示 Gate（全螢幕遮罩訊息）。
 * @param {string} message 要顯示的訊息（支援換行）。
 * @param {boolean} [isError] 是否為錯誤樣式（紅框/強調）。
 */
export function showGate(message, isError) {
  if (!dom.gateEl) return;
  dom.gateEl.classList.remove("gate-hidden");
  dom.gateEl.style.pointerEvents = "auto";
  dom.gateEl.innerHTML =
    '<div class="gate-message' +
    (isError ? " gate-message-error" : "") +
    '"><p>' +
    String(message || "").replace(/\n/g, "<br>") +
    "</p></div>";
}

/** 隱藏 Gate（恢復可操作主畫面）。 */
export function hideGate() {
  if (!dom.gateEl) return;
  dom.gateEl.classList.add("gate-hidden");
  dom.gateEl.style.pointerEvents = "none";
}

/**
 * 顯示主畫面（通常在授權/檢查通過後呼叫）。
 * - 會先隱藏 Gate
 */
export function openApp() {
  hideGate();
  if (dom.appRootEl) dom.appRootEl.classList.remove("app-hidden");
}

/**
 * 更新「使用者/剩餘天數」橫幅。
 * @param {string} [displayName] 使用者顯示名稱（可空）。
 * @param {number|null|undefined} [remainingDays] 剩餘天數；可為負數表示已過期。
 */
export function updateUsageBanner(displayName, remainingDays) {
  if (!dom.usageBannerEl || !dom.usageBannerTextEl) return;

  if (!displayName && (remainingDays === null || remainingDays === undefined)) {
    dom.usageBannerEl.style.display = "none";
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

  dom.usageBannerTextEl.textContent = msg;
  dom.usageBannerEl.style.display = "flex";

  dom.usageBannerEl.classList.remove("usage-banner-warning", "usage-banner-expired");
  if (typeof remainingDays === "number" && !Number.isNaN(remainingDays)) {
    if (remainingDays <= 0) dom.usageBannerEl.classList.add("usage-banner-expired");
    else if (remainingDays <= 3) dom.usageBannerEl.classList.add("usage-banner-warning");
  }
}
