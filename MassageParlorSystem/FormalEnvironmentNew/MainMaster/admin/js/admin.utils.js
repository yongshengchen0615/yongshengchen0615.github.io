/* ================================
 * Admin 審核管理台 - 工具函式
 * ================================ */

/**
 * querySelector 快捷。
 * - 既有程式大量使用 #id，因此維持此工具函式避免大改。
 * @param {string} sel
 */
function $(sel) {
  return document.querySelector(sel);
}

/**
 * 設定指定 id 的文字內容。
 * @param {string} id
 * @param {any} v
 */
function setText_(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(v ?? "-");
}

/**
 * HTML escape：避免將 userId / 名稱等內容直接插入 DOM 造成 XSS。
 * @param {any} s
 */
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * 顯示底部 toast。
 * @param {string} msg
 * @param {"ok"|"err"} type
 */
function toast(msg, type) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.classList.remove("show", "ok", "err");
  el.textContent = msg;
  el.classList.add(type === "err" ? "err" : "ok");
  requestAnimationFrame(() => el.classList.add("show"));
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

/**
 * debounce：避免短時間內重複觸發（例如搜尋輸入）。
 * @param {Function} fn
 * @param {number} wait
 */
function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/**
 * sleep：用於批次刪除時稍作間隔，降低後端負載/觸發限流風險。
 * @param {number} ms
 */
function sleep_(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
