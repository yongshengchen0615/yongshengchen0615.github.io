import { dom } from "./dom.js";

function clampPercent_(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return 0;
  return Math.max(0, Math.min(100, p));
}

export function setInitialLoadingProgress(percent, text) {
  const p = clampPercent_(percent);
  if (dom.initialLoadingTextEl && text) dom.initialLoadingTextEl.textContent = text;
  if (dom.initialLoadingBarEl) dom.initialLoadingBarEl.style.width = `${p}%`;
  if (dom.initialLoadingPercentEl) dom.initialLoadingPercentEl.textContent = `${Math.round(p)}%`;
  if (dom.initialLoadingProgressEl) dom.initialLoadingProgressEl.setAttribute("aria-valuenow", String(Math.round(p)));
}

export function showInitialLoading(text) {
  if (!dom.initialLoadingEl) return;
  if (dom.initialLoadingTextEl) dom.initialLoadingTextEl.textContent = text || "";
  dom.initialLoadingEl.classList.remove("initial-loading-hidden");
}

export function hideInitialLoading() {
  if (!dom.initialLoadingEl) return;
  dom.initialLoadingEl.classList.add("initial-loading-hidden");
}

export function showLoadingHint(text) {
  if (!dom.topLoadingEl) return;
  if (dom.topLoadingTextEl) dom.topLoadingTextEl.textContent = text || "";
  dom.topLoadingEl.classList.remove("hidden");
}

export function hideLoadingHint() {
  if (!dom.topLoadingEl) return;
  dom.topLoadingEl.classList.add("hidden");
}

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

export function hideGate() {
  if (!dom.gateEl) return;
  dom.gateEl.classList.add("gate-hidden");
  dom.gateEl.style.pointerEvents = "none";
}

export function openApp() {
  hideGate();
  if (dom.appRootEl) dom.appRootEl.classList.remove("app-hidden");
}

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
