/* ================================
 * Admin 審核管理台 - 全域狀態
 *
 * 本檔集中放「會隨執行改變」的狀態與快取。
 * ================================ */

/**
 * @typedef {Object} Me
 * @property {string} userId - 目前登入者 LINE userId
 * @property {string} displayName - 目前登入者顯示名稱
 * @property {string} audit - 目前登入者審核狀態（由 AUTH 回傳）
 */

/**
 * @typedef {Object} AdminRow
 * @property {string} userId
 * @property {string} displayName
 * @property {string} audit
 * @property {string} createdAt
 * @property {string} lastLogin
 *
 * // 技師欄位：此版本以「是/否」字串呈現，來源不一定真的是 boolean
 * @property {string} techAudit
 * @property {string} techCreatedAt
 * @property {string} techStartDate
 * @property {string} techExpiryDate
 * @property {string} techMasterNo
 * @property {string} techIsMaster
 * @property {string} techPushEnabled
 * @property {string} techPersonalStatusEnabled
 * @property {string} techScheduleEnabled
 */

// 由 config.json 載入
let ADMIN_API_URL = "";
let AUTH_API_URL = "";
let LIFF_ID = "";
let API_BASE_URL = "";

/** @type {AdminRow[]} */
let allAdmins = [];
/** @type {AdminRow[]} */
let filtered = [];

/**
 * 勾選狀態（僅用 userId 表示）。
 * - 渲染時會依此決定每列 checkbox 是否勾選，以及是否顯示批次操作 bar。
 */
const selectedIds = new Set();

/**
 * originalMap：每個 userId 初始快照（snapshot_ 結果）
 * - 用於與最新快照比較，判斷是否為 dirty（有未儲存變更）。
 */
const originalMap = new Map();

/**
 * dirtyMap：目前 dirty 的 userId 集合（用 Map 模擬 Set，保持原本程式碼風格）
 * - key: userId
 * - value: true
 */
const dirtyMap = new Map();

/**
 * savingAll：全域鎖，避免在批次儲存中繼續操作。
 * - UI 會被鎖定（按鈕/輸入/篩選 chips），table 內元件也會 disable。
 */
let savingAll = false;

// toast 計時器
let toastTimer = null;

/** @type {Me} */
let me = { userId: "", displayName: "", audit: "" };
