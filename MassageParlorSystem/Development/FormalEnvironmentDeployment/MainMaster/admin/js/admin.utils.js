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

/**
 * 嘗試解析各種時間格式並回傳 Date 或 null。
 * 支援：epoch 秒/毫秒、ISO、常見 yyyy-mm-dd / yyyy/mm/dd 與帶時間的字串。
 * 回傳值：Date 或 null
 */
function parseDateFlexible(s) {
  const str = String(s || "").trim();
  if (!str) return null;
  // pure digits epoch (10 或 13)
  const mDigits = str.match(/^\d{10,13}$/);
  if (mDigits) {
    const n = Number(str);
    const ms = str.length === 10 ? n * 1000 : n;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // try common date patterns first to avoid inconsistent Date parsing
  const m1 = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m1) {
    const Y = Number(m1[1]);
    const M = Number(m1[2]) - 1;
    const D = Number(m1[3]);
    const hh = Number(m1[4] || 0);
    const mm = Number(m1[5] || 0);
    const ss = Number(m1[6] || 0);
    const d = new Date(Y, M, D, hh, mm, ss);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // fallback to Date parse
  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) return d;
  return null;
}
