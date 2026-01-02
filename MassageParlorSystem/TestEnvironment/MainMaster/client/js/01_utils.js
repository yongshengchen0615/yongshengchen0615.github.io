/* ============================================
 * 01_utils.js
 * - 通用工具（DOM、字串、時間、toast、審核/期限顯示）
 * - 規則：不改行為，只把共用邏輯集中
 * ============================================ */

/**
 * 取得 DOM 節點
 * @param {string} id - 元素 id
 * @returns {HTMLElement|null} - 找不到回傳 null
 */
function byId_(id) {
  return document.getElementById(id);
}

/**
 * 批次設定 disabled
 * @param {string[]} ids - 元素 id 陣列
 * @param {boolean} disabled - 是否停用
 */
function setDisabledByIds_(ids, disabled) {
  ids.forEach((id) => {
    const el = byId_(id);
    if (el) el.disabled = disabled;
  });
}

/**
 * 將值寫進文字節點
 * @param {string} id - 元素 id
 * @param {*} v - 要顯示的值（會轉字串）
 */
function setText_(id, v) {
  const el = byId_(id);
  if (el) el.textContent = String(v ?? "-");
}

/**
 * HTML escape（避免 XSS / 避免表格破版）
 * @param {*} s - 任意輸入
 * @returns {string} - 安全字串
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
 * debounce：用於搜尋輸入，避免每個 keypress 都觸發渲染
 * @param {Function} fn - 要延後執行的函式
 * @param {number} wait - 延遲毫秒
 * @returns {Function} - 包裝後的函式
 */
function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/**
 * sleep：用於批次刪除時稍微降速，避免後端爆量
 * @param {number} ms - 延遲毫秒
 * @returns {Promise<void>}
 */
function sleep_(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 將日期/時間字串轉成 timestamp
 * @param {*} v - 可能是 "2025-01-01"、"2025-01-01 12:00:00" 等
 * @returns {number} - timestamp（無效回 0）
 */
function toTime_(v) {
  if (!v) return 0;
  const s = String(v).trim();
  if (!s) return 0;
  const d = new Date(s.includes(" ") ? s.replace(" ", "T") : s);
  const t = d.getTime();
  return isNaN(t) ? 0 : t;
}

/**
 * 正規化審核狀態
 * @param {*} v - 來源值（可能是空值/未知字串）
 * @returns {string} - 確保回傳在 AUDIT_ENUM 內
 */
function normalizeAudit_(v) {
  const s = String(v || "").trim();
  if (!s) return "待審核";
  return AUDIT_ENUM.includes(s) ? s : "其他";
}

/**
 * toast 訊息
 * @param {string} msg - 顯示文字
 * @param {"ok"|"err"} type - 類型（影響樣式）
 */
function toast(msg, type) {
  const el = byId_("toast");
  if (!el) return;

  el.classList.remove("show", "ok", "err");
  el.textContent = msg;
  el.classList.add(type === "err" ? "err" : "ok");

  requestAnimationFrame(() => el.classList.add("show"));

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

/**
 * 產生審核下拉選項
 * @param {string} value - 該 option 的值
 * @param {string} current - 目前選取值
 * @returns {string} - option HTML
 */
function auditOption(value, current) {
  const sel = value === current ? "selected" : "";
  return `<option value="${value}" ${sel}>${value}</option>`;
}

/**
 * 審核 badge class
 * @param {*} audit - 原始 audit
 * @returns {string} - CSS class
 */
function auditClass_(audit) {
  switch (normalizeAudit_(audit)) {
    case "通過":
      return "approved";
    case "待審核":
      return "pending";
    case "拒絕":
      return "rejected";
    case "停用":
      return "disabled";
    case "系統維護":
      return "maintenance";
    default:
      return "other";
  }
}

/**
 * 取得使用期限顯示資訊（pill）
 * @param {Object} u - user 物件
 * @param {string} u.startDate - 開始使用日（YYYY-MM-DD）
 * @param {string|number} u.usageDays - 使用天數
 * @returns {{cls:string,text:string}} - cls: active/expired/unset
 */
function getExpiryInfo(u) {
  if (!u.startDate || !u.usageDays) return { cls: "unset", text: "未設定" };

  const start = new Date(String(u.startDate) + "T00:00:00");
  if (isNaN(start.getTime())) return { cls: "unset", text: "未設定" };

  const usage = Number(u.usageDays);
  if (!Number.isFinite(usage) || usage <= 0) return { cls: "unset", text: "未設定" };

  const last = new Date(start.getTime() + (usage - 1) * 86400000);
  last.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diff = Math.floor((last - today) / 86400000);

  if (diff < 0) return { cls: "expired", text: `已過期（超 ${Math.abs(diff)} 天）` };
  return { cls: "active", text: `使用中（剩 ${diff} 天）` };
}

/**
 * 取得「到期剩餘天數」作為排序用數值
 * @param {Object} u - user 物件
 * @returns {number} - 越小越接近到期；無法計算時回傳很大的數
 */
function getExpiryDiff_(u) {
  if (!u.startDate || !u.usageDays) return 999999;

  const start = new Date(String(u.startDate) + "T00:00:00");
  if (isNaN(start.getTime())) return 999999;

  const usage = Number(u.usageDays);
  if (!Number.isFinite(usage) || usage <= 0) return 999999;

  const last = new Date(start.getTime() + (usage - 1) * 86400000);
  last.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Math.floor((last - today) / 86400000);
}
