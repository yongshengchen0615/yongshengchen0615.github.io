/* ============================================
 * 00_state.js
 * - 全域狀態（變數/常數）集中管理
 * - 目的：讓其他檔案只要引用這些全域名稱即可
 *
 * 注意：本專案採用「多個 defer script + 全域函式」模式
 *       為了不改行為，這裡維持與原 app.js 相同的全域變數名稱。
 * ============================================ */

/** Users API（既有 GAS Web App /exec） */
let API_BASE_URL = "";

/** 管理員門禁 API（獨立 GAS Web App /exec） */
let ADMIN_API_URL = "";

/** LIFF ID（LINE Developers 後台取得） */
let LIFF_ID = "";

/** 審核狀態可用枚舉（UI 會依此產生選單與 badge） */
const AUDIT_ENUM = ["待審核", "通過", "拒絕", "停用", "系統維護", "其他"];

/** 欄位分頁枚舉（僅在「全部 tech 權限都為是」時顯示 Tabs） */
const VIEW_ENUM = ["all", "usage", "master", "features"];

/** 目前分頁（localStorage users_view 會優先） */
let currentView = localStorage.getItem("users_view") || "usage";

/** 後端抓回的完整 users 清單 */
let allUsers = [];

/** 套用搜尋/篩選後的 users 清單（實際渲染來源） */
let filteredUsers = [];

/** 目前排序欄位 key（對應 th[data-sort]） */
let sortKey = "createdAt";

/** 目前排序方向（asc/desc） */
let sortDir = "desc";

/** 目前被勾選的 userId 集合（bulk 操作用） */
const selectedIds = new Set();

/** 原始快照：userId -> JSON 字串（用來判斷 dirty） */
const originalMap = new Map();

/** dirty 記錄：userId -> true（代表該列有未儲存變更） */
const dirtyMap = new Map();

/** Toast 的計時器 id（避免多個 toast 疊在一起） */
let toastTimer = null;

/** 是否正在執行「儲存全部變更」 */
let savingAll = false;

/** 管理員 tech 權限（由 ADMIN_API_URL 回傳）
 * 例如：{ techAudit: "是"|"否", techStartDate: "是"|"否", ... }
 */
let adminPerms = null;

/** 推播狀態：避免重複送出 */
let pushingNow = false;

/** 管理員 profile（LIFF 取得） */
let adminProfile = null; // { userId, displayName }

/** 欄位權限對應到 table nth-child 欄位 index
 * - key: 後端回傳的 tech 權限欄位
 * - value: 需要隱藏的欄位 index（th + td）
 */
const PERM_TO_COLS = {
  techAudit: [9],
  techCreatedAt: [5],
  techStartDate: [6],
  techExpiryDate: [7, 8], // ✅ 期限 + 使用狀態一起控
  techMasterNo: [10],
  techIsMaster: [11],
  techPushEnabled: [12],
  techPersonalStatusEnabled: [13],
  techScheduleEnabled: [14],
};

/** Bulk 欄位權限對應
 * - key: DOM control id（bulkAudit/bulkPush/...）
 * - value: adminPerms 欄位 key（techAudit/techPushEnabled/...）
 */
const BULK_PERM_MAP = {
  bulkAudit: "techAudit",
  bulkPush: "techPushEnabled",
  bulkPersonalStatus: "techPersonalStatusEnabled",
  bulkScheduleEnabled: "techScheduleEnabled",
  bulkUsageDays: "techExpiryDate",
};
