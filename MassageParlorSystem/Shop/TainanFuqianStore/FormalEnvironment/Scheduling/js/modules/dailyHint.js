/**
 * dailyHint.js
 *
 * 開啟時的左右滑動提示動畫（無文字提示 / 無遮罩）。
 * - 只在 UI 已可操作時呼叫（例如：初次載入完成後）。
 * - 提示會在短時間後自動消失；使用者一旦開始互動（滑動/點擊/滾輪）會立即停止。
 */

import { dom } from "./dom.js";

function prefersReducedMotion_() {
  try {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function isHorizontallyScrollable_(el) {
  if (!el) return false;
  return el.scrollWidth - el.clientWidth > 12;
}

function addSwipeHintClass_(el) {
  if (!el) return;
  if (!isHorizontallyScrollable_(el)) return;
  el.classList.add("swipe-hint");

  const stop = () => {
    el.classList.remove("swipe-hint");
    cleanup();
  };

  const cleanup = () => {
    el.removeEventListener("scroll", stop);
    el.removeEventListener("wheel", stop);
    el.removeEventListener("touchstart", stop);
    el.removeEventListener("pointerdown", stop);
  };

  el.addEventListener("scroll", stop, { passive: true, once: true });
  el.addEventListener("wheel", stop, { passive: true, once: true });
  el.addEventListener("touchstart", stop, { passive: true, once: true });
  el.addEventListener("pointerdown", stop, { passive: true, once: true });
}

function dismissOnFirstGlobalClick_(targets) {
  const list = (targets || []).filter(Boolean);
  if (!list.length) return;

  const dismiss = () => {
    for (const el of list) {
      try {
        el.classList.remove("swipe-hint");
      } catch {
        // ignore
      }
    }
  };

  // ✅ 使用者第一次點擊/觸控畫面就關閉提示（不阻擋原點擊行為）
  document.addEventListener("click", dismiss, { capture: true, once: true });
  document.addEventListener("touchstart", dismiss, { capture: true, passive: true, once: true });
  document.addEventListener("pointerdown", dismiss, { capture: true, passive: true, once: true });
}

/**
 * 開啟時對可水平滑動區塊加上提示動畫。
 * @returns {boolean} 是否有套用提示（至少一個區塊可滑動）
 */
export function maybeShowDailyFirstOpenHint() {
  const headerRight = dom.appHeaderRightEl || document.querySelector(".app-header-right");
  const featureChips = dom.featureChipsEl || document.getElementById("featureChips");

  const a = isHorizontallyScrollable_(headerRight);
  const b = isHorizontallyScrollable_(featureChips);
  if (!a && !b) return false;

  // ✅ 滑動提示動畫（箭頭 + 小幅 nudge）
  addSwipeHintClass_(headerRight);
  addSwipeHintClass_(featureChips);

  // ✅ 點擊畫面任意處就關閉（不需要提示時間）
  dismissOnFirstGlobalClick_([headerRight, featureChips]);

  return true;
}
