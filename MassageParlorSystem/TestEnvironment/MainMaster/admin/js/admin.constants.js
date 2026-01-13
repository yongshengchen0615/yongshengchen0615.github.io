/* ================================
 * Admin 審核管理台 - 常數
 *
 * 本檔只放「不會隨執行改變」的常數。
 * 以多檔切分時，必須最先載入。
 * ================================ */

/**
 * 審核狀態列舉：
 * - 後端若回傳不在此列舉內，會 normalize 為「其他」
 */
const AUDIT_ENUM = ["待審核", "通過", "拒絕", "停用", "系統維護", "其他"];

/**
 * 需要被 setLock_() 共同鎖定的控制項 id 清單。
 * - 鎖定時：避免使用者在儲存/載入中繼續操作造成狀態不同步。
 */
const LOCKABLE_IDS = [
  "reloadBtn",
  "themeToggle",
  "searchInput",
  "clearSearchBtn",
  "checkAll",
  "bulkClear",
  "bulkAudit",
  "bulkApply",
  "bulkDelete",
  "saveAllBtn",
];

/**
 * 技師 toggle 欄位清單（對應 AdminRow 上的欄位名稱）。
 * - 目的：集中管理可切換欄位，避免 typo。
 */
const TECH_TOGGLE_FIELDS = new Set([
  "pushFeatureEnabled",
  "techAudit",
  "techCreatedAt",
  "techStartDate",
  "techExpiryDate",
  "techMasterNo",
  "techIsMaster",
  "techPushEnabled",
  "techPersonalStatusEnabled",
  "techScheduleEnabled",
  "techPerformanceEnabled",
]);
