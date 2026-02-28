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

let loadingHintHolds_ = 0;
// keyed holds: map key -> {count, el}
const loadingHintKeys_ = new Map();

function hideLoadingHintForce_() {
  if (!dom.topLoadingEl) return;
  dom.topLoadingEl.classList.add("hidden");
}

function removeSubByKey_(key) {
  try {
    const sel = `[data-top-loading-key="${String(key)}"]`;
    const el = document.querySelector(sel);
    if (el) el.remove();
  } catch (_) {}
}

function removeAllSubs_() {
  try {
    const subs = document.querySelectorAll('.top-loading-sub');
    subs.forEach((s) => s.remove());
  } catch (_) {}
}

function removeAnonSubs_() {
  try {
    const subs = document.querySelectorAll('.top-loading-sub');
    subs.forEach((s) => {
      const k = s.getAttribute && s.getAttribute('data-top-loading-key');
      if (!k || String(k).startsWith('sub-')) s.remove();
    });
  } catch (_) {}
}

function clampPercent_(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(100, p));
}

/**
 * 更新初始載入進度（0~100）。
 * @param {number} percent
 * @param {string} [text]
 */
export function setInitialLoadingProgress(percent, text) {
  const p = clampPercent_(percent);
  if (dom.initialLoadingTextEl && text) dom.initialLoadingTextEl.textContent = text;
  if (dom.initialLoadingBarEl) dom.initialLoadingBarEl.style.width = `${p}%`;
  if (dom.initialLoadingPercentEl) dom.initialLoadingPercentEl.textContent = `${Math.round(p)}%`;
  if (dom.initialLoadingProgressEl) dom.initialLoadingProgressEl.setAttribute("aria-valuenow", String(Math.round(p)));
}

/**
 * 初始載入遮罩：在第一次資料抓取前顯示，避免空白畫面。
 */
export function showInitialLoading(text) {
  if (!dom.initialLoadingEl) return;
  if (dom.initialLoadingTextEl) dom.initialLoadingTextEl.textContent = text || "資料載入中…";
  dom.initialLoadingEl.classList.remove("initial-loading-hidden");
}

/** 隱藏初始載入遮罩。 */
export function hideInitialLoading() {
  if (!dom.initialLoadingEl) return;
  dom.initialLoadingEl.classList.add("initial-loading-hidden");
}

/**
 * 顯示頂部載入提示（不影響版面，fixed toast）。
 * @param {string} [text] 顯示文字；未提供則使用預設文案。
 */
export function showLoadingHint(text) {
  if (!dom.topLoadingEl) return;
  const txt = text || "資料載入中…";
  // If primary toast is not visible, update it and show.
  if (dom.topLoadingEl.classList.contains('hidden')) {
    if (dom.topLoadingTextEl) dom.topLoadingTextEl.textContent = txt;
    dom.topLoadingEl.classList.remove("hidden");
    return;
  }

  // Primary already visible: create a generic secondary toast (no key).
  try {
    const parent = dom.topLoadingEl.parentNode || document.body;
    const existingSubs = parent.querySelectorAll('.top-loading-sub').length;
    const sub = document.createElement('div');
    sub.className = 'top-loading top-loading-sub';
    sub.setAttribute('data-top-loading-key', `sub-${Date.now()}-${existingSubs}`);
    // position it slightly lower than primary based on existing count
    const baseTop = 10; // matches CSS top for .top-loading
    const gap = 44;
    sub.style.position = 'fixed';
    sub.style.top = `${baseTop + (existingSubs + 1) * gap}px`;
    sub.style.left = '50%';
    sub.style.transform = 'translateX(-50%)';
    sub.style.zIndex = String(10000 - 1 - existingSubs); // slightly below primary stacking-wise
    sub.style.pointerEvents = 'none';
    sub.innerHTML = `<span class="top-loading-spinner" aria-hidden="true"></span><span class="top-loading-text">${String(txt)}</span>`;
    parent.appendChild(sub);
  } catch (_) {}
}

/** 隱藏頂部載入提示。 */
export function hideLoadingHint() {
  if (!dom.topLoadingEl) return;

  // Only hide primary (default) toast if no default holds remain.
  // Remove anonymous secondary toasts created via `showLoadingHint`.
  removeAnonSubs_();

  // Only hide primary (default) toast if no default holds remain.
  if ((loadingHintHolds_ | 0) > 0) return;
  hideLoadingHintForce_();
}

/**
 * Hold the top loading hint until the returned release() is called.
 * - Prevents other modules from hiding the toast prematurely.
 * - Safe to call release multiple times.
 * @param {string} [text]
 * @returns {() => void} release
 */
export function holdLoadingHint(text) {
  // Backward-compatible: accept optional key as second arg
  const args = Array.from(arguments || []);
  const msg = String(args[0] || text || "資料載入中…");
  const key = args[1] || null;

  if (!key) {
    loadingHintHolds_ = Math.max(0, (loadingHintHolds_ | 0) + 1);
    showLoadingHint(msg);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      loadingHintHolds_ = Math.max(0, (loadingHintHolds_ | 0) - 1);
      if ((loadingHintHolds_ | 0) === 0) hideLoadingHintForce_();
    };
  }

  // Keyed hold: create or increment.
  const existing = loadingHintKeys_.get(key) || { count: 0, el: null };
  existing.count = Math.max(0, existing.count + 1);
  loadingHintKeys_.set(key, existing);

  // create element if missing
  if (!existing.el) {
    try {
      const parent = dom.topLoadingEl ? dom.topLoadingEl.parentNode : document.body;
      const subsBefore = parent.querySelectorAll('.top-loading-sub').length;
      const sub = document.createElement('div');
      sub.className = 'top-loading top-loading-sub';
      sub.setAttribute('data-top-loading-key', String(key));
      sub.style.position = 'fixed';
      const baseTop = 10;
      const gap = 44;
      // If primary hidden, place at top; otherwise place below existing subs
      const primaryVisible = dom.topLoadingEl && !dom.topLoadingEl.classList.contains('hidden');
      const offsetIndex = primaryVisible ? subsBefore + 1 : 0;
      sub.style.top = `${baseTop + offsetIndex * gap}px`;
      sub.style.left = '50%';
      sub.style.transform = 'translateX(-50%)';
      sub.style.zIndex = String(10000 - 1 - offsetIndex);
      sub.style.pointerEvents = 'none';
      sub.innerHTML = `<span class="top-loading-spinner" aria-hidden="true"></span><span class="top-loading-text">${String(msg)}</span>`;
      parent.appendChild(sub);
      existing.el = sub;
      loadingHintKeys_.set(key, existing);
    } catch (_) {}
  } else {
    // update text if exists
    try {
      const txtEl = existing.el.querySelector('.top-loading-text');
      if (txtEl) txtEl.textContent = msg;
    } catch (_) {}
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const cur = loadingHintKeys_.get(key) || { count: 0, el: null };
    cur.count = Math.max(0, cur.count - 1);
    if (cur.count === 0) {
      // remove element
      try {
        if (cur.el) cur.el.remove();
      } catch (_) {}
      loadingHintKeys_.delete(key);
    } else {
      loadingHintKeys_.set(key, cur);
    }
  };
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
