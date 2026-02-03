import { dom } from "./dom.js";

export function showGate(message, isError) {
  if (!dom.gate) return;
  dom.gate.textContent = String(message || "");
  dom.gate.classList.remove("gate-hidden");
  if (isError) {
    try {
      dom.gate.style.background = "rgba(127, 29, 29, 0.92)";
    } catch (_) {}
  } else {
    try {
      dom.gate.style.background = "";
    } catch (_) {}
  }
}

export function hideGate() {
  dom.gate?.classList.add("gate-hidden");
}

export function showTopLoading(text) {
  if (dom.topLoadingText && text) dom.topLoadingText.textContent = String(text);
  dom.topLoading?.classList.remove("hidden");
}

export function hideTopLoading() {
  dom.topLoading?.classList.add("hidden");
}

export function setBadge(el, text) {
  if (!el) return;
  el.textContent = String(text || "—");
}

export function setLastUpdate(ms) {
  if (!dom.lastUpdate) return;
  const t = Number(ms) || Date.now();
  const d = new Date(t);
  const pad = (x) => String(x).padStart(2, "0");
  dom.lastUpdate.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

let toastTimer = null;
export function toast(message, kind) {
  const msg = String(message || "").trim();
  if (!msg) return;

  // 簡易：沿用 topLoading 作為 toast
  if (toastTimer) clearTimeout(toastTimer);
  showTopLoading(msg);

  try {
    const tl = dom.topLoading;
    if (tl) {
      tl.style.borderColor = kind === "err" ? "rgba(249,115,115,.55)" : "rgba(52,211,153,.45)";
    }
  } catch (_) {}

  toastTimer = setTimeout(() => {
    hideTopLoading();
    try {
      const tl = dom.topLoading;
      if (tl) tl.style.borderColor = "";
    } catch (_) {}
  }, kind === "err" ? 2400 : 1600);
}
