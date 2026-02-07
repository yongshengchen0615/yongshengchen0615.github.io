/****************************************************
 * ✅ Users + PersonalStatus + PerformanceAccess（最小完整最終版 / HARDENED + BATCH）- INTEGRATED
 *
 * ✅ PATCH (2026-02-04)
 * - updateUser / updateUsersBatch：若 payload 帶 displayName/name → 更新 Users.displayName
 *   並同步更新 PersonalStatus / PerformanceAccess 的 displayName（依 enabled）
 * - topup：applyTopupToUser_ 更新 Users.displayName 後，
 *   立即同步 PersonalStatus / PerformanceAccess（依 Users 欄位 enabled）
 *
 * ✅ 你這次要求的變更（重要）
 * - 改成：師傅編號(masterCode)=NetworkCapture.TechNo → 從 NetworkCapture 推導/取得 StoreId
 *
 * ✅ Cache
 * - TechNo → StoreId map：ScriptCache 5 分鐘
 ****************************************************/

/* =========================
 * CONFIG
 * ========================= */
var CONFIG = {
  TZ: "Asia/Taipei",

  DEFAULT_USAGE_DAYS: 7,
  DEFAULT_AUDIT: "待審核",
  DEFAULT_PUSH_ENABLED: "否",
  DEFAULT_PERSONAL_STATUS_ENABLED: "否",
  DEFAULT_SCHEDULE_ENABLED: "否",
  DEFAULT_PERFORMANCE_ENABLED: "否",

  SHEET_USERS: "Users",
  SHEET_PERSONAL_STATUS: "PersonalStatus",

  // ✅ PerformanceAccess sheet
  SHEET_PERFORMANCE_ACCESS: "PerformanceAccess",
  PERFORMANCE_ACCESS_HEADERS: ["userId", "displayName", "師傅編號", "StoreId"],

  // ✅ 改成：師傅編號 → StoreId 對照來源：NetworkCapture
  SHEET_NETWORK_CAPTURE: "NetworkCapture",

  // NetworkCapture 常見欄位名稱（自動容錯：不分大小寫）
  NC_COL_TECHNO: "TechNo",
  NC_COL_STOREID: "StoreId",
  NC_COL_REQUESTURL: "RequestUrl",
  NC_COL_RESPONSE: "Response",
  NC_COL_CAPTUREDAT: "CapturedAt",

  // 掃描 NetworkCapture 的最大列數（避免全表過大）
  NC_SCAN_MAX_ROWS: 5000,

  // batch 上限（避免 payload 過大、執行超時）
  BATCH_MAX_ITEMS: 200,

  /* =========================
   * ✅ TopUp（儲值）
   * ========================= */
  SHEET_TOPUP_LOG: "TopUpLog",
  TOPUP_API_URL_PROP: "TOPUP_API_URL",
  TOPUP_AMOUNT_TO_DAYS_JSON_PROP: "TOPUP_AMOUNT_TO_DAYS_JSON",
  TOPUP_AMOUNT_TO_DAYS_RATIO_PROP: "TOPUP_AMOUNT_TO_DAYS_RATIO",
  TOPUP_MAX_ADD_DAYS: 3660,

  // （可選）推播 API 防濫用：把 Script Properties 設定 PUSH_SECRET
  PUSH_SECRET_PROP: "PUSH_SECRET"
};

/* =========================
 * ENUM + RULES
 * ========================= */
var AUDIT_ENUM = ["待審核", "通過", "拒絕", "停用", "系統維護", "其他"];

function normalizeAudit_(v) {
  var s = String(v || "").trim();
  if (!s) return CONFIG.DEFAULT_AUDIT || "待審核";
  return AUDIT_ENUM.indexOf(s) >= 0 ? s : "其他";
}

function normalizeYesNo_(v, defaultNo) {
  var s = String(v || "").trim();
  if (s === "是" || s === "否") return s;
  return defaultNo === "是" ? "是" : "否";
}

/** 🔒 audit ≠ 通過 → pushEnabled 必為 否 */
function enforcePushByAudit_(audit, pushEnabled) {
  var a = normalizeAudit_(audit);
  if (a !== "通過") return "否";
  return String(pushEnabled || "").trim() === "是" ? "是" : "否";
}

function auditToStatus_(audit) {
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

/* =========================
 * Output helper
 * ========================= */
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/* =========================
 * Date helpers（到期計算）
 * ========================= */
var ONE_DAY_MS_ = 24 * 60 * 60 * 1000;

function dateKeyTpe_(d) {
  return Utilities.formatDate(new Date(d), CONFIG.TZ, "yyyy-MM-dd");
}
function startOfDayTpe_(d) {
  var key = dateKeyTpe_(d);
  var p = key.split("-");
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
}
function safeDayFromKeyTpe_(key) {
  var p = String(key || "").split("-");
  if (p.length !== 3) return null;
  var y = parseInt(p[0], 10);
  var m = parseInt(p[1], 10) - 1;
  var d = parseInt(p[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  var dt = new Date(y, m, d);
  dt.setHours(12, 0, 0, 0);
  return dt;
}
function parseDateLoose_(raw) {
  if (!raw) return null;
  raw = String(raw).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return safeDayFromKeyTpe_(raw);

  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    var dIso = new Date(raw);
    if (!isNaN(dIso.getTime())) {
      dIso.setHours(12, 0, 0, 0);
      return dIso;
    }
  }

  var d2 = new Date(raw);
  if (isNaN(d2.getTime())) return null;
  d2.setHours(12, 0, 0, 0);
  return d2;
}

function calcRemainingDaysByDate_(startDate, usageDaysRaw) {
  if (!startDate) return null;

  var usageDays = parseInt(usageDaysRaw, 10);
  if (isNaN(usageDays) || usageDays <= 0) return null;

  var startDay = startOfDayTpe_(startDate);
  var todayDay = startOfDayTpe_(new Date());

  // ✅ 對齊前端：最後可用日 = start + (usageDays - 1)
  var lastUsableDay = new Date(startDay.getTime() + (usageDays - 1) * ONE_DAY_MS_);
  return Math.floor((lastUsableDay.getTime() - todayDay.getTime()) / ONE_DAY_MS_);
}

/* =========================
 * Sheets (Users / PersonalStatus / PerformanceAccess)
 * ========================= */
function getOrCreateUserSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(CONFIG.SHEET_USERS);

  var expected = [
    "userId",
    "displayName",
    "審核狀態",
    "建立時間",
    "開始使用日期",
    "使用期限",
    "師傅編號",
    "是否師傅",
    "是否推播",
    "個人狀態開通",
    "排班表開通",
    "業績開通"
  ];

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_USERS);
    sheet.appendRow(expected);
    return sheet;
  }

  var r = sheet.getRange(1, 1, 1, expected.length);
  var header = r.getValues()[0];
  var needFix = false;
  for (var i = 0; i < expected.length; i++) {
    if (String(header[i] || "").trim() !== expected[i]) {
      needFix = true;
      break;
    }
  }
  if (needFix) r.setValues([expected]);

  return sheet;
}

/**
 * ✅ PersonalStatus 新版：5 欄
 * userId | displayName | 師傅編號 | 技師管理員liff | 個人看板liff
 */
function getOrCreatePersonalStatusSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(CONFIG.SHEET_PERSONAL_STATUS);

  var expected = ["userId", "displayName", "師傅編號", "技師管理員liff", "個人看板liff"];

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_PERSONAL_STATUS);
    sheet.appendRow(expected);
    return sheet;
  }

  var r = sheet.getRange(1, 1, 1, expected.length);
  var header = r.getValues()[0];
  var needFix = false;
  for (var i = 0; i < expected.length; i++) {
    if (String(header[i] || "").trim() !== expected[i]) {
      needFix = true;
      break;
    }
  }
  if (needFix) r.setValues([expected]);

  return sheet;
}

/**
 * ✅ PerformanceAccess（新版 4 欄）
 * userId | displayName | 師傅編號 | StoreId
 */
function getOrCreatePerformanceAccessSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(CONFIG.SHEET_PERFORMANCE_ACCESS);

  var expected = (CONFIG.PERFORMANCE_ACCESS_HEADERS || ["userId", "displayName", "師傅編號", "StoreId"]).slice();

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_PERFORMANCE_ACCESS);
    sheet.appendRow(expected);
    return sheet;
  }

  var r = sheet.getRange(1, 1, 1, expected.length);
  var header = r.getValues()[0];
  var needFix = false;
  for (var i = 0; i < expected.length; i++) {
    if (String(header[i] || "").trim() !== expected[i]) {
      needFix = true;
      break;
    }
  }
  if (needFix) r.setValues([expected]);

  return sheet;
}

/* =========================
 * NetworkCapture lookup (TechNo -> StoreId)
 * ========================= */

function getNetworkCaptureSheet_() {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(CONFIG.SHEET_NETWORK_CAPTURE);
}

function findHeaderIndex_(headerRow, name) {
  var target = String(name || "").trim().toLowerCase();
  for (var i = 0; i < headerRow.length; i++) {
    var h = String(headerRow[i] || "").trim().toLowerCase();
    if (h === target) return i;
  }
  return -1;
}

function findHeaderIndexAny_(headerRow, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var idx = findHeaderIndex_(headerRow, candidates[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

/** 從 RequestUrl 抽 storeId（支援常見 detail 路徑） */
function extractStoreIdFromRequestUrl_(url) {
  url = String(url || "").trim();
  if (!url) return "";

  var m = url.match(/\/detail\/(\d+)(?:\b|\/|\?|#|$)/i);
  if (m && m[1]) return String(m[1]).trim();

  var m2 = url.match(/\/detail\/(\d+)\//i);
  if (m2 && m2[1]) return String(m2[1]).trim();

  return "";
}

/** 從 Response 文字抽 TechNo（容錯多格式） */
function extractTechNoFromResponse_(respText) {
  var s = String(respText || "").trim();
  if (!s) return "";

  var m1 = s.match(/"TechNo"\s*:\s*"?(\d+)"?/i);
  if (m1 && m1[1]) return String(m1[1]).trim();

  var m2 = s.match(/"techno"\s*:\s*"?(\d+)"?/i);
  if (m2 && m2[1]) return String(m2[1]).trim();

  var m3 = s.match(/師傅號碼\s*[:：=]\s*(\d+)/i);
  if (m3 && m3[1]) return String(m3[1]).trim();

  var m4 = s.match(/\bTechNo\s*=\s*(\d+)\b/i);
  if (m4 && m4[1]) return String(m4[1]).trim();
  var m5 = s.match(/\btechno\s*=\s*(\d+)\b/i);
  if (m5 && m5[1]) return String(m5[1]).trim();

  return "";
}

/**
 * ✅ 從 NetworkCapture 建立 TechNo -> StoreId 的 map
 */
function buildTechNoToStoreIdMapFromNetworkCapture_() {
  var sheet = getNetworkCaptureSheet_();
  if (!sheet) return {};

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 2) return {};

  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  var techIdx = findHeaderIndexAny_(header, [
    CONFIG.NC_COL_TECHNO || "TechNo",
    "techno",
    "TechNO",
    "師傅編號",
    "師傅號碼",
    "MasterCode",
    "masterCode"
  ]);

  var storeIdx = findHeaderIndexAny_(header, [
    CONFIG.NC_COL_STOREID || "StoreId",
    "storeid",
    "StoreID",
    "Store",
    "StoreNo"
  ]);

  var reqIdx = findHeaderIndexAny_(header, [CONFIG.NC_COL_REQUESTURL || "RequestUrl", "requesturl", "url", "RequestURL"]);
  var respIdx = findHeaderIndexAny_(header, [CONFIG.NC_COL_RESPONSE || "Response", "response", "Body", "body"]);

  var scanMax = CONFIG.NC_SCAN_MAX_ROWS || 5000;
  var startRow = Math.max(2, lastRow - scanMax + 1);
  var numRows = lastRow - startRow + 1;

  var values = sheet.getRange(startRow, 1, numRows, lastCol).getValues();

  var map = {}; // techno -> storeId

  for (var i = 0; i < values.length; i++) {
    var row = values[i];

    var techNo = "";
    if (techIdx >= 0) techNo = String(row[techIdx] || "").trim();
    if (!techNo && respIdx >= 0) techNo = extractTechNoFromResponse_(row[respIdx]);
    if (!techNo) continue;

    var storeId = "";
    if (storeIdx >= 0) storeId = String(row[storeIdx] || "").trim();
    if (!storeId && reqIdx >= 0) storeId = extractStoreIdFromRequestUrl_(row[reqIdx]);
    if (!storeId) continue;

    map[techNo] = storeId;
  }

  return map;
}

/**
 * 用師傅編號(masterCode) = NetworkCapture.TechNo 查 StoreId
 */
function lookupStoreIdByTechNo_(masterCode) {
  var techNo = String(masterCode || "").trim();
  if (!techNo) return "";

  try {
    var cache = CacheService.getScriptCache();
    var key = "techno_storeid_map_from_networkcapture_v1";
    var cached = cache.get(key);
    var map = cached ? JSON.parse(cached) : null;

    if (!map) {
      map = buildTechNoToStoreIdMapFromNetworkCapture_();
      cache.put(key, JSON.stringify(map), 300);
    }

    return String(map[techNo] || "").trim();
  } catch (e) {
    var map2 = buildTechNoToStoreIdMapFromNetworkCapture_();
    return String(map2[techNo] || "").trim();
  }
}

/* =========================
 * Data access (memory-first)
 * ========================= */
function readUsersTable_() {
  var sheet = getOrCreateUserSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { sheet: sheet, values: [], rowMap: {} };

  var values = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  var rowMap = {};
  for (var i = 0; i < values.length; i++) {
    var uid = String(values[i][0] || "").trim();
    if (uid) rowMap[uid] = i;
  }
  return { sheet: sheet, values: values, rowMap: rowMap };
}

/* =========================
 * ✅ Fast user row lookup (CacheService + TextFinder)
 * - 只針對單一 userId 的 check/updateuser 走快路徑
 * - 避免每次都讀寫整張 Users 表
 * ========================= */

function cacheGet_(k) {
  try {
    return CacheService.getScriptCache().get(String(k || ""));
  } catch (e) {
    return null;
  }
}

function cachePut_(k, v, ttlSec) {
  try {
    CacheService.getScriptCache().put(String(k || ""), String(v || ""), Math.max(1, parseInt(ttlSec || 300, 10)));
  } catch (e) {}
}

function findUserRowIndexFast_(sheet, userId) {
  userId = String(userId || "").trim();
  if (!userId) return 0;

  var last = sheet.getLastRow();
  if (last < 2) return 0;

  var cacheKey = "USR_ROW|" + userId;
  var cached = cacheGet_(cacheKey);
  if (cached) {
    var r0 = parseInt(cached, 10);
    if (!isNaN(r0) && r0 >= 2 && r0 <= last) {
      try {
        var v0 = String(sheet.getRange(r0, 1).getValue() || "").trim();
        if (v0 === userId) return r0;
      } catch (e0) {
        // ignore and fallback
      }
    }
  }

  // TextFinder on column A (userId)
  try {
    var rg = sheet.getRange(2, 1, last - 1, 1);
    var cell = rg.createTextFinder(userId).matchEntireCell(true).findNext();
    if (cell) {
      var r = cell.getRow();
      cachePut_(cacheKey, String(r), 900);
      return r;
    }
  } catch (e1) {
    // ignore
  }

  // Fallback: scan IDs (slower)
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || "").trim() === userId) {
      var r2 = i + 2;
      cachePut_(cacheKey, String(r2), 900);
      return r2;
    }
  }
  return 0;
}

function readUserRowFast_(userId) {
  var sheet = getOrCreateUserSheet_();
  var rowIndex = findUserRowIndexFast_(sheet, userId);
  if (!rowIndex) return { sheet: sheet, rowIndex: 0, row: null };
  var row = sheet.getRange(rowIndex, 1, 1, 12).getValues()[0];
  return { sheet: sheet, rowIndex: rowIndex, row: row };
}

function writeUsersTable_(sheet, values) {
  if (!values || !values.length) return;
  sheet.getRange(2, 1, values.length, 12).setValues(values);
}

/* =========================
 * Expire rule (in-memory)
 * - 同步 audit & pushEnabled
 * ========================= */
function applyExpireRuleToValues_(values) {
  var changed = [];
  if (!values || !values.length) return changed;

  for (var i = 0; i < values.length; i++) {
    var userId = String(values[i][0] || "").trim();
    if (!userId) continue;

    var audit = normalizeAudit_(values[i][2]);
    if (audit !== "通過") continue;

    var startDate = values[i][4];
    var usageDaysRaw = values[i][5];
    if (!startDate) continue;

    var rd = calcRemainingDaysByDate_(startDate, usageDaysRaw);
    if (typeof rd === "number" && rd < 0) {
      values[i][8] = "否";
      changed.push(userId);
    }
  }
  return changed;
}

/* =========================
 * Generic find/delete helpers
 * ========================= */
function findRowIndexByUserId_(sheet, userId) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;

  userId = String(userId || "").trim();
  if (!userId) return 0;

  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || "").trim() === userId) return i + 2;
  }
  return 0;
}

function deleteRowByUserId_(sheet, userId) {
  var row = findRowIndexByUserId_(sheet, userId);
  if (row) {
    sheet.deleteRow(row);
    return true;
  }
  return false;
}

/* =========================
 * PersonalStatus helpers（新版 5 欄）
 * ========================= */
function findPersonalStatusRowIndex_(sheet, userId) {
  return findRowIndexByUserId_(sheet, userId);
}

/** ✅ 個人狀態開通=否 → 刪除整列 */
function deletePersonalStatusRowByUserId_(userId) {
  var ps = getOrCreatePersonalStatusSheet_();
  var row = findPersonalStatusRowIndex_(ps, userId);
  if (row) {
    ps.deleteRow(row);
    return true;
  }
  return false;
}

/**
 * upsert：維護 userId / displayName / 師傅編號，不動 liff（避免覆蓋）
 */
function upsertPersonalStatusRow_(userId, displayName, masterCode) {
  userId = String(userId || "").trim();
  displayName = String(displayName || "").trim();
  masterCode = String(masterCode || "").trim();
  if (!userId) return { ok: false, error: "Missing userId" };

  var sheet = getOrCreatePersonalStatusSheet_();
  var row = findPersonalStatusRowIndex_(sheet, userId);

  if (!row) {
    sheet.appendRow([userId, displayName, masterCode, "", ""]);
    return { ok: true, action: "inserted" };
  }

  if (displayName !== "") sheet.getRange(row, 2).setValue(displayName);
  if (masterCode !== "") sheet.getRange(row, 3).setValue(masterCode);
  return { ok: true, action: "updated" };
}

/* =========================
 * PerformanceAccess helpers（新版 4 欄）
 * ========================= */
function upsertPerformanceAccessRow_(userId, displayName, masterCode, storeId) {
  userId = String(userId || "").trim();
  displayName = String(displayName || "").trim();
  masterCode = String(masterCode || "").trim();
  storeId = String(storeId || "").trim();

  if (!userId) return { ok: false, error: "Missing userId" };

  var sheet = getOrCreatePerformanceAccessSheet_();
  var row = findRowIndexByUserId_(sheet, userId);

  if (!row) {
    sheet.appendRow([userId, displayName, masterCode, storeId]);
    return { ok: true, action: "inserted" };
  }

  if (displayName !== "") sheet.getRange(row, 2).setValue(displayName);
  if (masterCode !== "") sheet.getRange(row, 3).setValue(masterCode);
  if (storeId !== "") sheet.getRange(row, 4).setValue(storeId);

  return { ok: true, action: "updated" };
}

/* =========================
 * Sync rules
 * ========================= */
function syncPersonalStatusByEnabled_(userId, displayName, masterCode, enabledYesNo) {
  var enabled = String(enabledYesNo || "否").trim() === "是";
  if (enabled) {
    upsertPersonalStatusRow_(userId, displayName, masterCode);
    return { ok: true, action: "ensure" };
  } else {
    var deleted = deletePersonalStatusRowByUserId_(userId);
    return { ok: true, action: deleted ? "deleted" : "none" };
  }
}

/**
 * ✅ 業績開通=是：
 *   若前端沒給 storeId，則用 masterCode(師傅編號)=NetworkCapture.TechNo 去推導/查 StoreId 自動寫入
 */
function syncPerformanceAccessByEnabled_(userId, displayName, masterCode, enabledYesNo, storeId) {
  var enabled = String(enabledYesNo || "否").trim() === "是";

  if (enabled) {
    var sid = String(storeId || "").trim();
    if (!sid) {
      sid = lookupStoreIdByTechNo_(masterCode);
    }
    return upsertPerformanceAccessRow_(userId, displayName, masterCode, sid);
  } else {
    var sheet = getOrCreatePerformanceAccessSheet_();
    var deleted = deleteRowByUserId_(sheet, userId);
    return { ok: true, action: deleted ? "deleted" : "none" };
  }
}

/* =========================
 * ✅ check 核心邏輯：回傳純 object（避免 getContent/parse）
 * ========================= */
function buildCheckResult_(userId, displayNameCandidate) {
  userId = String(userId || "").trim();
  displayNameCandidate = String(displayNameCandidate || "").trim();
  if (!userId) {
    return {
      ok: true,
      userId: "",
      status: "none",
      audit: "",
      displayName: "",
      remainingDays: null,
      masterCode: "",
      isMaster: "否",
      pushEnabled: "否",
      personalStatusEnabled: "否",
      scheduleEnabled: "否",
      performanceEnabled: "否"
    };
  }

  var got = readUserRowFast_(userId);
  var sheet = got.sheet;
  var rowIndex = got.rowIndex;
  if (!rowIndex || !got.row) {
    return {
      ok: true,
      userId: userId,
      status: "none",
      audit: "",
      displayName: "",
      remainingDays: null,
      masterCode: "",
      isMaster: "否",
      pushEnabled: "否",
      personalStatusEnabled: "否",
      scheduleEnabled: "否",
      performanceEnabled: "否"
    };
  }

  var row = got.row;

  // ✅ 若 check 時前端有帶 displayName，且使用者已存在 → 只更新該列（避免全表寫回）
  if (displayNameCandidate) {
    var oldDn = String(row[1] || "").trim();
    if (oldDn !== displayNameCandidate) {
      row[1] = displayNameCandidate;
      try {
        sheet.getRange(rowIndex, 2).setValue(displayNameCandidate);
      } catch (eDnWrite) {}

      // best-effort: 同步衍生表 displayName（依 enabled）
      try {
        var masterCode2 = String(row[6] || "").trim();
        var psEnabled2 = normalizeYesNo_(row[9], "否");
        var perfEnabled2 = normalizeYesNo_(row[11], "否");
        syncPersonalStatusByEnabled_(userId, displayNameCandidate, masterCode2, psEnabled2);
        syncPerformanceAccessByEnabled_(userId, displayNameCandidate, masterCode2, perfEnabled2, "");
      } catch (eSyncName) {}

      // ✅ PATCH: Scheduling 使用者改名時，同步 TopUp Serials.UsedNote（節流，避免阻塞）
      try {
        var ck = "TOPUP_SYNC_DN|" + userId;
        if (!cacheGet_(ck)) {
          cachePut_(ck, "1", 6 * 60 * 60);
          syncTopupSerialUsedNoteName_(userId, displayNameCandidate);
        }
      } catch (eTopupSync) {}
    }
  }

  var displayName = String(row[1] || "").trim();
  var audit = normalizeAudit_(row[2]);
  var startDate = row[4];
  var usageDays = row[5];

  var masterCode = String(row[6] || "").trim();
  var pushEnabled = enforcePushByAudit_(audit, row[8]);
  var personalStatusEnabled = normalizeYesNo_(row[9], "否");
  var scheduleEnabled = normalizeYesNo_(row[10], "否");
  var performanceEnabled = normalizeYesNo_(row[11], "否");

  var remainingDays = calcRemainingDaysByDate_(startDate, usageDays);

  // ✅ 與舊版 expire rule 對齊：通過但已過期 → pushEnabled 強制為 否（必要時只更新單一欄位）
  if (audit === "通過" && typeof remainingDays === "number" && remainingDays < 0) {
    pushEnabled = "否";
    try {
      if (String(row[8] || "").trim() !== "否") sheet.getRange(rowIndex, 9).setValue("否");
    } catch (ePushWrite) {}
  }

  return {
    ok: true,
    userId: userId,
    status: auditToStatus_(audit),
    audit: audit,
    displayName: displayName,
    remainingDays: remainingDays,
    masterCode: masterCode,
    isMaster: masterCode ? "是" : "否",
    pushEnabled: pushEnabled,
    personalStatusEnabled: personalStatusEnabled,
    scheduleEnabled: scheduleEnabled,
    performanceEnabled: performanceEnabled
  };
}

/* =========================
 * APIs
 * ========================= */

function handleCheck_(e) {
  var userId = String((e && e.parameter && e.parameter.userId) || "").trim();
  var displayName = String((e && e.parameter && (e.parameter.displayName || e.parameter.name)) || "").trim();
  return jsonOut_(buildCheckResult_(userId, displayName));
}

function handleRegister_(data) {
  var userId = String((data && data.userId) || "").trim();
  var displayName = String((data && data.displayName) || "").trim();
  if (!userId) return jsonOut_({ ok: false, userId: "", error: "Missing userId" });

  var db = readUsersTable_();
  var values = db.values;
  var idx = db.rowMap[userId];

  var now = new Date();
  var auditInit = normalizeAudit_(CONFIG.DEFAULT_AUDIT);

  if (typeof idx === "number") {
    var row = values[idx];

    if (displayName) row[1] = displayName;

    var auditNow = normalizeAudit_(row[2]);
    if (!String(row[2] || "").trim()) {
      auditNow = auditInit;
      row[2] = auditNow;
    }

    if (!row[3]) row[3] = now;

    if (!row[4]) row[4] = safeDayFromKeyTpe_(dateKeyTpe_(now)) || now;
    if (!row[5]) row[5] = CONFIG.DEFAULT_USAGE_DAYS;

    if (!String(row[9] || "").trim()) row[9] = CONFIG.DEFAULT_PERSONAL_STATUS_ENABLED;
    if (!String(row[10] || "").trim()) row[10] = CONFIG.DEFAULT_SCHEDULE_ENABLED;
    if (!String(row[11] || "").trim()) row[11] = CONFIG.DEFAULT_PERFORMANCE_ENABLED;

    row[8] = enforcePushByAudit_(auditNow, row[8]);

    var masterCode = String(row[6] || "").trim();

    syncPersonalStatusByEnabled_(
      userId,
      String(row[1] || "").trim(),
      masterCode,
      String(row[9] || "否")
    );

    syncPerformanceAccessByEnabled_(
      userId,
      String(row[1] || "").trim(),
      masterCode,
      String(row[11] || "否"),
      ""
    );
  } else {
    var newRow = [
      userId,
      displayName,
      auditInit,
      now,
      safeDayFromKeyTpe_(dateKeyTpe_(now)) || now,
      CONFIG.DEFAULT_USAGE_DAYS,
      "",
      "否",
      enforcePushByAudit_(auditInit, CONFIG.DEFAULT_PUSH_ENABLED),
      CONFIG.DEFAULT_PERSONAL_STATUS_ENABLED,
      CONFIG.DEFAULT_SCHEDULE_ENABLED,
      CONFIG.DEFAULT_PERFORMANCE_ENABLED
    ];
    values.push(newRow);

    syncPersonalStatusByEnabled_(userId, displayName, "", CONFIG.DEFAULT_PERSONAL_STATUS_ENABLED);
    syncPerformanceAccessByEnabled_(userId, displayName, "", CONFIG.DEFAULT_PERFORMANCE_ENABLED, "");
  }

  applyExpireRuleToValues_(values);
  writeUsersTable_(db.sheet, values);

  return jsonOut_({ ok: true, userId: userId });
}

function handleListUsers_() {
  var db = readUsersTable_();
  var values = db.values;

  applyExpireRuleToValues_(values);
  writeUsersTable_(db.sheet, values);

  var tz = CONFIG.TZ;

  var users = values.map(function (r) {
    var userId = String(r[0] || "").trim();
    var displayName = String(r[1] || "").trim();
    var audit = normalizeAudit_(r[2]);

    var createdAt = r[3];
    var startDate = r[4];
    var usageDays = r[5];

    var masterCode = String(r[6] || "").trim();
    var isMaster = masterCode ? "是" : "否";

    var pushEnabled = enforcePushByAudit_(audit, r[8]);
    var personalStatusEnabled = normalizeYesNo_(r[9], "否");
    var scheduleEnabled = normalizeYesNo_(r[10], "否");
    var performanceEnabled = normalizeYesNo_(r[11], "否");

    return {
      userId: userId,
      displayName: displayName,
      audit: audit,
      createdAt: createdAt ? Utilities.formatDate(new Date(createdAt), tz, "yyyy-MM-dd HH:mm:ss") : "",
      startDate: startDate ? Utilities.formatDate(new Date(startDate), tz, "yyyy-MM-dd") : "",
      usageDays: usageDays || "",
      masterCode: masterCode,
      isMaster: isMaster,
      pushEnabled: pushEnabled,
      personalStatusEnabled: personalStatusEnabled,
      scheduleEnabled: scheduleEnabled,
      performanceEnabled: performanceEnabled
    };
  });

  return jsonOut_({ ok: true, userId: "", users: users });
}

/* =========================================================
 * ✅ PATCH: updateUser 允許更新 displayName（並同步衍生表）
 * - 支援 data.displayName / data.name
 * ========================================================= */
function handleUpdateUser_(data) {
  var userId = String((data && data.userId) || "").trim();
  if (!userId) return jsonOut_({ ok: false, userId: "", error: "Missing userId" });

  var got = readUserRowFast_(userId);
  if (!got.rowIndex || !got.row) return jsonOut_({ ok: false, userId: userId, error: "User not found" });

  var sheet = got.sheet;
  var rowIndex = got.rowIndex;
  var row = got.row;

  var oldDisplayName = String(row[1] || "").trim();

  // ✅ PATCH: 若 payload 帶 displayName/name → 更新 Users.displayName
  var newDisplayName = String((data && (data.displayName || data.name)) || "").trim();
  if (newDisplayName) row[1] = newDisplayName;

  var audit = normalizeAudit_((data && data.audit) || row[2]);
  var startDateRaw = String((data && data.startDate) || "").trim();
  var usageDaysRaw = String((data && data.usageDays) || "").trim();
  var masterCode = String((data && data.masterCode) || "").trim();

  var pushEnabled = enforcePushByAudit_(audit, data && data.pushEnabled);

  var personalStatusEnabled = normalizeYesNo_(data && data.personalStatusEnabled, "否");
  var scheduleEnabled = normalizeYesNo_(data && data.scheduleEnabled, "否");
  var performanceEnabled = normalizeYesNo_(data && data.performanceEnabled, "否");

  row[2] = audit;

  if (startDateRaw) {
    var d = parseDateLoose_(startDateRaw);
    row[4] = d ? d : "";
  } else {
    row[4] = "";
  }

  if (usageDaysRaw) {
    var n = parseInt(usageDaysRaw, 10);
    row[5] = !isNaN(n) && n > 0 ? n : "";
  } else {
    row[5] = "";
  }

  row[6] = masterCode;
  row[7] = masterCode ? "是" : "否";

  row[8] = pushEnabled;
  row[9] = personalStatusEnabled;
  row[10] = scheduleEnabled;
  row[11] = performanceEnabled;

  // ✅ PATCH: 同步衍生表時，用更新後的 row[1]
  var dn = String(row[1] || "").trim();

  // ✅ 可選：跳過衍生表同步（TopUp 不同步時只加天數）
  var skipSyncRaw = String((data && (data.skipSync || data.skip_sync || data.noSync || data.nosync)) || "").trim();
  var skipSync = skipSyncRaw === "1" || skipSyncRaw === "true" || skipSyncRaw === "TRUE" || skipSyncRaw === "是";

  if (!skipSync) {
    syncPersonalStatusByEnabled_(
      userId,
      dn,
      String(row[6] || "").trim(),
      personalStatusEnabled
    );

    var storeId = String((data && (data.storeId || data.StoreId)) || "").trim();
    syncPerformanceAccessByEnabled_(
      userId,
      dn,
      String(row[6] || "").trim(),
      performanceEnabled,
      storeId
    );
  }

  // ✅ 與舊版 expire rule 對齊：僅針對此 user 計算/強制 pushEnabled
  try {
    var rd2 = calcRemainingDaysByDate_(row[4], row[5]);
    if (String(row[2] || "").trim() === "通過" && typeof rd2 === "number" && rd2 < 0) row[8] = "否";
  } catch (eExp) {}

  // 只寫回該列（避免整張 Users setValues）
  sheet.getRange(rowIndex, 1, 1, 12).setValues([row]);

  // ✅ PATCH: 若有更新 displayName，則同步 TopUp Serials.UsedNote
  try {
    var dnAfter = String(row[1] || "").trim();
    if (newDisplayName && dnAfter && dnAfter !== oldDisplayName) {
      var ck2 = "TOPUP_SYNC_DN|" + userId;
      if (!cacheGet_(ck2)) {
        cachePut_(ck2, "1", 6 * 60 * 60);
        syncTopupSerialUsedNoteName_(userId, dnAfter);
      }
    }
  } catch (eTopupSync2) {}

  return jsonOut_({ ok: true, userId: userId });
}

/* =========================================================
 * ✅ PATCH: updateUsersBatch 允許更新 displayName（並同步衍生表）
 * - items[k].displayName / items[k].name
 * ========================================================= */
function handleUpdateUsersBatch_(data) {
  var items = data && data.items ? data.items : null;

  if (typeof items === "string") {
    try { items = JSON.parse(items); } catch (e) {}
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return jsonOut_({ ok: false, userId: "", error: "Missing items" });
  }
  if (items.length > (CONFIG.BATCH_MAX_ITEMS || 200)) {
    return jsonOut_({ ok: false, userId: "", error: "Too many items" });
  }

  var db = readUsersTable_();
  var values = db.values;
  var rowMap = db.rowMap;

  if (!values.length) return jsonOut_({ ok: false, userId: "", error: "No users" });

  var okCount = 0;
  var fail = [];
  var updatedUserIds = [];

  for (var k = 0; k < items.length; k++) {
    try {
      var it = items[k] || {};
      var userId = String(it.userId || "").trim();
      if (!userId) throw new Error("Missing userId");

      var idx = rowMap[userId];
      if (typeof idx !== "number") throw new Error("User not found");

      var row = values[idx];

      var oldDn = String(row[1] || "").trim();

      // ✅ PATCH: 若 payload 帶 displayName/name → 更新 Users.displayName
      var dnNew = String((it.displayName || it.name) || "").trim();
      if (dnNew) row[1] = dnNew;

      var audit = normalizeAudit_(it.audit);
      var startDateRaw = String(it.startDate || "").trim();
      var usageDaysRaw = String(it.usageDays || "").trim();
      var masterCode = String(it.masterCode || "").trim();

      var pushEnabled = enforcePushByAudit_(audit, it.pushEnabled);

      var personalStatusEnabled = normalizeYesNo_(it.personalStatusEnabled, "否");
      var scheduleEnabled = normalizeYesNo_(it.scheduleEnabled, "否");
      var performanceEnabled = normalizeYesNo_(it.performanceEnabled, "否");

      row[2] = audit;

      if (startDateRaw) {
        var d = parseDateLoose_(startDateRaw);
        row[4] = d ? d : "";
      } else {
        row[4] = "";
      }

      if (usageDaysRaw) {
        var n = parseInt(usageDaysRaw, 10);
        row[5] = !isNaN(n) && n > 0 ? n : "";
      } else {
        row[5] = "";
      }

      row[6] = masterCode;
      row[7] = masterCode ? "是" : "否";

      row[8] = pushEnabled;
      row[9] = personalStatusEnabled;
      row[10] = scheduleEnabled;
      row[11] = performanceEnabled;

      // ✅ PATCH: 同步衍生表時用更新後的 row[1]
      var dn = String(row[1] || "").trim();

      syncPersonalStatusByEnabled_(
        userId,
        dn,
        String(row[6] || "").trim(),
        personalStatusEnabled
      );

      var storeId = String((it && (it.storeId || it.StoreId)) || "").trim();
      syncPerformanceAccessByEnabled_(
        userId,
        dn,
        String(row[6] || "").trim(),
        performanceEnabled,
        storeId
      );

      okCount++;
      updatedUserIds.push(userId);

      // ✅ PATCH: 若有更新 displayName，則同步 TopUp Serials.UsedNote
      try {
        var dnAfter = String(row[1] || "").trim();
        if (dnNew && dnAfter && dnAfter !== oldDn) syncTopupSerialUsedNoteName_(userId, dnAfter);
      } catch (eTopupSync3) {}
    } catch (err) {
      fail.push({
        index: k,
        userId: (items[k] && items[k].userId) || "",
        error: String(err)
      });
    }
  }

  applyExpireRuleToValues_(values);
  writeUsersTable_(db.sheet, values);

  return jsonOut_({
    ok: fail.length === 0,
    userId: "",
    okCount: okCount,
    failCount: fail.length,
    updatedUserIds: updatedUserIds,
    fail: fail
  });
}

function handleDeleteUser_(data) {
  var userId = String((data && data.userId) || "").trim();
  if (!userId) return jsonOut_({ ok: false, userId: "", error: "Missing userId" });

  var sheet = getOrCreateUserSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return jsonOut_({ ok: false, userId: userId, error: "No users" });

  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  var row = 0;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || "").trim() === userId) {
      row = i + 2;
      break;
    }
  }
  if (!row) return jsonOut_({ ok: false, userId: userId, error: "User not found" });

  sheet.deleteRow(row);

  deletePersonalStatusRowByUserId_(userId);
  deleteRowByUserId_(getOrCreatePerformanceAccessSheet_(), userId);

  return jsonOut_({ ok: true, userId: userId, deleted: true });
}

/**
 * ✅ getPersonalStatus（mode 名稱保留）
 */
function handleGetPersonalStatus_(e) {
  var userId = String((e && e.parameter && e.parameter.userId) || "").trim();
  if (!userId) return jsonOut_({ ok: false, userId: "", error: "Missing userId" });

  var check = buildCheckResult_(userId);
  var audit = normalizeAudit_(check.audit);

  if (audit !== "通過") return jsonOut_({ ok: false, userId: userId, error: "Not approved" });
  if (String(check.personalStatusEnabled || "否") !== "是")
    return jsonOut_({ ok: false, userId: userId, error: "PersonalStatus disabled" });

  var ps = getOrCreatePersonalStatusSheet_();
  var row = findPersonalStatusRowIndex_(ps, userId);
  if (!row) return jsonOut_({ ok: false, userId: userId, error: "PersonalStatus row not found" });

  var adminLiff = String(ps.getRange(row, 4).getValue() || "").trim();
  var personalBoardLiff = String(ps.getRange(row, 5).getValue() || "").trim();

  return jsonOut_({
    ok: true,
    userId: userId,
    adminLiff: adminLiff,
    personalBoardLiff: personalBoardLiff
  });
}

/**
 * ✅ getUserManageLink（mode 名稱保留）
 */
function handleGetUserManageLink_(e) {
  var userId = String((e && e.parameter && e.parameter.userId) || "").trim();
  if (!userId) return jsonOut_({ ok: false, userId: "", error: "Missing userId" });

  var check = buildCheckResult_(userId);
  var audit = normalizeAudit_(check.audit);
  if (audit !== "通過") return jsonOut_({ ok: false, userId: userId, error: "Not approved" });

  var ps = getOrCreatePersonalStatusSheet_();
  var row = findPersonalStatusRowIndex_(ps, userId);
  if (!row) return jsonOut_({ ok: false, userId: userId, error: "PersonalStatus row not found" });

  var adminLiff = String(ps.getRange(row, 4).getValue() || "").trim();
  var personalBoardLiff = String(ps.getRange(row, 5).getValue() || "").trim();

  return jsonOut_({ ok: true, userId: userId, adminLiff: adminLiff, personalBoardLiff: personalBoardLiff });
}

/**
 * ✅ updatePersonalStatusLinks（mode 名稱保留）
 */
function handleUpdatePersonalStatusLinks_(data) {
  var userId = String((data && data.userId) || "").trim();
  if (!userId) return jsonOut_({ ok: false, userId: "", error: "Missing userId" });

  var adminLiff = String((data && (data.adminLiff || data.manageLiff || data["技師管理員liff"])) || "").trim();
  var personalBoardLiff = String(
    (data && (data.personalBoardLiff || data.personalLiff || data["個人看板liff"])) || ""
  ).trim();

  var ps = getOrCreatePersonalStatusSheet_();
  var row = findPersonalStatusRowIndex_(ps, userId);
  if (!row) {
    ps.appendRow([userId, "", "", "", ""]);
    row = ps.getLastRow();
  }

  if (adminLiff !== "") ps.getRange(row, 4).setValue(adminLiff);
  if (personalBoardLiff !== "") ps.getRange(row, 5).setValue(personalBoardLiff);

  return jsonOut_({ ok: true, userId: userId });
}

function handleSyncPersonalStatusRow_(data) {
  var userId = String((data && data.userId) || "").trim();
  var displayName = String((data && data.displayName) || "").trim();
  var masterCode = String((data && (data.masterCode || data["師傅編號"])) || "").trim();
  if (!userId) return jsonOut_({ ok: false, userId: "", error: "Missing userId" });

  var r = upsertPersonalStatusRow_(userId, displayName, masterCode);
  r.userId = userId;
  return jsonOut_(r);
}

/* =========================
 * ✅ PushMessage API
 * ========================= */

function handlePushMessage_(data) {
  try {
    var secretExpected = PropertiesService.getScriptProperties().getProperty(CONFIG.PUSH_SECRET_PROP);
    if (secretExpected) {
      var secretGot = String((data && data.secret) || "").trim();
      if (!secretGot || secretGot !== String(secretExpected).trim()) {
        return jsonOut_({ ok: false, userId: "", error: "Invalid secret" });
      }
    }

    var token = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_ACCESS_TOKEN");
    if (!token) return jsonOut_({ ok: false, userId: "", error: "Missing LINE_CHANNEL_ACCESS_TOKEN" });

    var userIds = [];
    if (data && Array.isArray(data.userIds)) userIds = data.userIds;
    else if (data && data.userIds) userIds = data.userIds;
    else if (data && data.userId) userIds = [data.userId];

    if (typeof userIds === "string") {
      userIds = userIds.split(/[\s,]+/).filter(function (x) {
        return String(x || "").trim();
      });
    }

    if (!Array.isArray(userIds) || userIds.length === 0)
      return jsonOut_({ ok: false, userId: "", error: "Missing userIds" });

    var seen = {};
    userIds = userIds
      .map(function (x) {
        return String(x || "").trim();
      })
      .filter(function (x) {
        return x && !seen[x] && (seen[x] = true);
      });

    if (userIds.length === 0) return jsonOut_({ ok: false, userId: "", error: "Missing userIds" });

    var message = String((data && data.message) || "").trim();
    if (!message) return jsonOut_({ ok: false, userId: "", error: "Missing message" });

    var includeDisplayName = String((data && data.includeDisplayName) || "否").trim() === "是";

    var nameMap = {};
    if (includeDisplayName) nameMap = getDisplayNameMapFromUsers_(userIds);

    var okCount = 0;
    var fail = [];

    if (!includeDisplayName && userIds.length > 1) {
      var chunks = chunk_(userIds, 450);
      for (var i = 0; i < chunks.length; i++) {
        var ids = chunks[i];
        var r = lineMulticast_(token, ids, message);
        if (r.ok) okCount += ids.length;
        else {
          for (var j = 0; j < ids.length; j++) {
            var uid = String(ids[j] || "").trim();
            if (!uid) continue;
            var rr = linePush_(token, uid, message);
            if (rr.ok) okCount++;
            else fail.push({ userId: uid, error: rr.error || "push_failed" });
          }
        }
      }
    } else {
      for (var k = 0; k < userIds.length; k++) {
        var uid2 = String(userIds[k] || "").trim();
        if (!uid2) continue;

        var prefix = "";
        if (includeDisplayName) {
          var dn = String(nameMap[uid2] || "").trim();
          if (dn) prefix = dn + "：";
        }

        var text = prefix ? prefix + message : message;

        var r2 = linePush_(token, uid2, text);
        if (r2.ok) okCount++;
        else fail.push({ userId: uid2, error: r2.error || "push_failed" });
      }
    }

    return jsonOut_({
      ok: fail.length === 0,
      userId: "",
      okCount: okCount,
      failCount: fail.length,
      fail: fail
    });
  } catch (e) {
    return jsonOut_({ ok: false, userId: "", error: String(e) });
  }
}

function getDisplayNameMapFromUsers_(userIds) {
  var db = readUsersTable_();
  var values = db.values || [];

  var need = {};
  for (var i = 0; i < userIds.length; i++) {
    var uid = String(userIds[i] || "").trim();
    if (uid) need[uid] = true;
  }

  var map = {};
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var id = String(row[0] || "").trim();
    if (!id || !need[id]) continue;
    map[id] = String(row[1] || "").trim();
  }
  return map;
}

function linePush_(token, userId, text) {
  try {
    var url = "https://api.line.me/v2/bot/message/push";
    var payload = {
      to: userId,
      messages: [{ type: "text", text: String(text || "") }]
    };

    var res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return { ok: true };
    return { ok: false, error: "HTTP_" + code + " " + res.getContentText() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function lineMulticast_(token, userIds, text) {
  try {
    var url = "https://api.line.me/v2/bot/message/multicast";
    var payload = {
      to: userIds,
      messages: [{ type: "text", text: String(text || "") }]
    };

    var res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return { ok: true };
    return { ok: false, error: "HTTP_" + code + " " + res.getContentText() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function chunk_(arr, size) {
  var out = [];
  for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =========================
 * ✅ TopUp（儲值）
 * ========================= */

function getTopupApiUrl_() {
  var key = CONFIG.TOPUP_API_URL_PROP || "TOPUP_API_URL";
  var url = PropertiesService.getScriptProperties().getProperty(key);
  url = String(url || "").trim();
  if (!url) throw new Error("TOPUP_API_URL_NOT_SET");
  return url;
}

function parseJsonSafe_(text) {
  try {
    return JSON.parse(String(text || "") || "{}");
  } catch (e) {
    return null;
  }
}

function mapTopupAmountToDays_(amount) {
  var n = Number(amount);
  if (!isFinite(n) || n <= 0) return 0;

  var sp = PropertiesService.getScriptProperties();

  var mapKey = CONFIG.TOPUP_AMOUNT_TO_DAYS_JSON_PROP || "TOPUP_AMOUNT_TO_DAYS_JSON";
  var mapRaw = String(sp.getProperty(mapKey) || "").trim();
  if (mapRaw) {
    var m = parseJsonSafe_(mapRaw);
    if (m && (m[String(n)] !== undefined || m[String(Math.round(n))] !== undefined)) {
      var v = m[String(n)];
      if (v === undefined) v = m[String(Math.round(n))];
      var dn = parseInt(v, 10);
      if (!isNaN(dn) && dn > 0) return dn;
    }
  }

  var ratioKey = CONFIG.TOPUP_AMOUNT_TO_DAYS_RATIO_PROP || "TOPUP_AMOUNT_TO_DAYS_RATIO";
  var ratioRaw = String(sp.getProperty(ratioKey) || "").trim();
  if (ratioRaw) {
    var ratio = Number(ratioRaw);
    if (isFinite(ratio) && ratio > 0) {
      var dn2 = Math.round(n * ratio);
      if (dn2 > 0) return dn2;
    }
  }

  return Math.round(n);
}

function getOrCreateTopupLogSheet_() {
  var ss = SpreadsheetApp.getActive();
  var name = String(CONFIG.SHEET_TOPUP_LOG || "TopUpLog").trim() || "TopUpLog";
  var sheet = ss.getSheetByName(name);

  var expected = [
    "AtMs",
    "userId",
    "displayName",
    "serial",
    "amount",
    "daysAdded",
    "oldRemainingDays",
    "newRemainingDays",
    "detailJson"
  ];

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(expected);
    try {
      sheet.setFrozenRows(1);
    } catch (e) {}
    return sheet;
  }

  try {
    var header = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
    for (var i = 0; i < expected.length; i++) {
      if (!String(header[i] || "").trim()) sheet.getRange(1, i + 1).setValue(expected[i]);
    }
  } catch (e2) {}

  return sheet;
}

function safeJsonStringify_(o) {
  try {
    return JSON.stringify(o);
  } catch (e) {
    return "{}";
  }
}

function redeemSerialViaTopup_(serial, userId, displayName) {
  serial = String(serial || "").trim();
  userId = String(userId || "").trim();
  displayName = String(displayName || "").trim();
  if (!serial) throw new Error("SERIAL_REQUIRED");
  if (!userId) throw new Error("USER_ID_REQUIRED");

  var url = getTopupApiUrl_();
  var payload = {
    mode: "serials_redeem_public",
    serial: serial,
    userId: userId,
    displayName: displayName,
    note: "Scheduling topupRedeem_v1"
  };

  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "text/plain; charset=utf-8",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var text = res.getContentText();
  var obj = parseJsonSafe_(text);

  if (code < 200 || code >= 300) {
    var err = new Error("TOPUP_HTTP_" + code);
    err.details = { http: code, body: String(text || "").slice(0, 300) };
    throw err;
  }

  if (!obj || obj.ok !== true) {
    var err2 = new Error(String((obj && obj.error) || "TOPUP_REDEEM_FAILED"));
    err2.details = {
      sent: { mode: "serials_redeem_public", serial: serial, userId: userId, displayName: displayName },
      topup: obj || null
    };
    if (obj && obj.details) err2.details.topupDetails = obj.details;
    throw err2;
  }

  return obj;
}

// ✅ Sync TopUp Serials.UsedNote name for Scheduling users
// Best-effort: failure should not break Scheduling flows.
function syncTopupSerialUsedNoteName_(userId, displayName) {
  userId = String(userId || "").trim();
  displayName = String(displayName || "").trim();
  if (!userId || !displayName) return { ok: true, skipped: true };

  var url = "";
  try {
    url = getTopupApiUrl_();
  } catch (e) {
    return { ok: true, skipped: true, reason: "TOPUP_API_URL_NOT_SET" };
  }

  try {
    var payload = {
      mode: "serials_sync_used_note_public",
      userId: userId,
      displayName: displayName,
      note: "Scheduling syncUsedNote_v1"
    };

    var res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "text/plain; charset=utf-8",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var obj = parseJsonSafe_(res.getContentText());
    if (obj && obj.ok === true) return obj;
    return { ok: false, error: String((obj && obj.error) || "TOPUP_SYNC_FAILED") };
  } catch (e2) {
    return { ok: false, error: String(e2 && e2.message ? e2.message : e2) };
  }
}

/* =========================================================
 * ✅ TopUp feature flags helpers
 * - TopUp WebApp 可能回傳 tri-state：true/false/null(未設定)
 * - syncEnabled：missing/null → default true（向下相容）
 * ========================================================= */
function pickTopupFlagTri_(obj, key) {
  if (!obj) return null;
  var v = obj[key];
  if ((v === undefined || v === null || v === "") && obj.features && typeof obj.features === "object") {
    v = obj.features[key];
  }
  if (v === undefined || v === null || v === "") return null;

  if (v === true || v === 1 || v === "1") return true;
  if (v === false || v === 0 || v === "0") return false;

  var s = String(v || "").trim();
  if (!s) return null;
  if (s === "是") return true;
  if (s === "否") return false;
  var sl = s.toLowerCase();
  if (sl === "true" || sl === "y" || sl === "yes" || sl === "on") return true;
  if (sl === "false" || sl === "n" || sl === "no" || sl === "off") return false;
  return null;
}

function normalizeTopupSyncEnabled_(obj) {
  var tri = pickTopupFlagTri_(obj, "syncEnabled");
  // Backward compatible default: treat missing as enabled
  if (tri === null) return true;
  return !!tri;
}

/* =========================================================
 * ✅ PATCH: TopUp 後同步衍生表（PersonalStatus / PerformanceAccess）
 * - 依 Users row[9]/row[11] 是否開通
 * - displayName 更新後，以 Users 為唯一真相同步出去
 * ========================================================= */
function applyTopupToUser_(userId, displayName, daysAdded, meta) {
  userId = String(userId || "").trim();
  displayName = String(displayName || "").trim();

  var dn = parseInt(daysAdded, 10);
  // ✅ allow dn=0: feature sync only (no extra days)
  if (isNaN(dn) || dn < 0) throw new Error("DAYS_ADDED_INVALID");
  var maxDays = parseInt(CONFIG.TOPUP_MAX_ADD_DAYS || 3660, 10);
  if (!isNaN(maxDays) && maxDays > 0) dn = Math.min(dn, maxDays);

  var topup = meta && meta.topup ? meta.topup : null;
  var syncEnabled = normalizeTopupSyncEnabled_(topup);

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var db = readUsersTable_();
    var values = db.values;
    var idx = db.rowMap[userId];

    var now = new Date();
    var today = safeDayFromKeyTpe_(dateKeyTpe_(now)) || now;

    if (typeof idx !== "number") {
      var auditInit = normalizeAudit_(CONFIG.DEFAULT_AUDIT);

      // dn=0 且新用戶：避免「功能同步序號」意外給到預設天數 → 建立為長期過期狀態
      var initStart = today;
      var initUsage = CONFIG.DEFAULT_USAGE_DAYS;
      if (dn === 0) {
        initStart = new Date(today.getTime() - 9999 * ONE_DAY_MS_);
        initUsage = 1;
      }

      var newRow = [
        userId,
        displayName,
        auditInit,
        now,
        initStart,
        initUsage,
        "",
        "否",
        enforcePushByAudit_(auditInit, CONFIG.DEFAULT_PUSH_ENABLED),
        CONFIG.DEFAULT_PERSONAL_STATUS_ENABLED,
        CONFIG.DEFAULT_SCHEDULE_ENABLED,
        CONFIG.DEFAULT_PERFORMANCE_ENABLED
      ];
      values.push(newRow);
      idx = values.length - 1;
    }

    var row = values[idx];

    // ✅ 若有帶 displayName → 更新 Users.displayName
    if (displayName) row[1] = displayName;

    // ✅ 若 TopUp 序號有帶功能旗標，且 syncEnabled=TRUE → 同步寫回 Users 功能欄位
    // - tri-state：null 表示「不覆寫」
    if (syncEnabled) {
      var pushTri = pickTopupFlagTri_(topup, "pushEnabled");
      var psTri = pickTopupFlagTri_(topup, "personalStatusEnabled");
      var schedTri = pickTopupFlagTri_(topup, "scheduleEnabled");
      var perfTri = pickTopupFlagTri_(topup, "performanceEnabled");

      if (psTri !== null) row[9] = psTri ? "是" : "否";
      if (schedTri !== null) row[10] = schedTri ? "是" : "否";
      if (perfTri !== null) row[11] = perfTri ? "是" : "否";

      if (pushTri !== null) row[8] = pushTri ? "是" : "否";
    }

    var oldRemaining = calcRemainingDaysByDate_(row[4], row[5]);
    var baseRemaining = 0;
    if (typeof oldRemaining === "number" && !isNaN(oldRemaining)) baseRemaining = Math.max(0, oldRemaining);

    // dn=0：不改到期（僅同步功能/名稱）
    if (dn > 0) {
      var newRemaining = baseRemaining + dn;
      row[4] = today;
      row[5] = Math.max(1, Math.round(newRemaining + 1));
    }

    // ✅ 永遠維持 push 強制規則
    row[8] = enforcePushByAudit_(normalizeAudit_(row[2]), row[8]);

    writeUsersTable_(db.sheet, values);

    var newRemaining2 = calcRemainingDaysByDate_(row[4], row[5]);

    // ✅ PATCH: TopUp 後同步衍生表（名稱一致化）
    try {
      var uid = String(row[0] || "").trim();
      var dnFinal = String(row[1] || "").trim();
      var masterCode = String(row[6] || "").trim();
      var psEnabled = String(row[9] || "否").trim();
      var perfEnabled = String(row[11] || "否").trim();

      // TopUp 序號 syncEnabled=FALSE → 不觸發衍生表同步（與前端 skipSync 對齊）
      if (syncEnabled) {
        syncPersonalStatusByEnabled_(uid, dnFinal, masterCode, psEnabled);
        syncPerformanceAccessByEnabled_(uid, dnFinal, masterCode, perfEnabled, "");
      }
    } catch (eSync) {
      // best-effort：不同步也不影響儲值成功
    }

    // ✅ PATCH: TopUp 後同步 TopUp Serials.UsedNote（Scheduling 使用者名稱一致化）
    try {
      syncTopupSerialUsedNoteName_(String(row[0] || "").trim(), String(row[1] || "").trim());
    } catch (eTopupSync4) {}

    try {
      var sh = getOrCreateTopupLogSheet_();
      sh.appendRow([
        Date.now(),
        userId,
        String(row[1] || "").trim(),
        String((meta && meta.serial) || ""),
        Number((meta && meta.amount) || 0),
        dn,
        oldRemaining === null || oldRemaining === undefined ? "" : oldRemaining,
        newRemaining2 === null || newRemaining2 === undefined ? "" : newRemaining2,
        safeJsonStringify_(meta || {})
      ]);
    } catch (e) {}

    return {
      ok: true,
      oldRemainingDays: oldRemaining,
      newRemainingDays: newRemaining2,
      daysAdded: dn
    };
  } finally {
    lock.releaseLock();
  }
}

function handleTopupRedeem_(data) {
  var userId = String((data && data.userId) || "").trim();
  var displayName = String((data && data.displayName) || "").trim();
  var serial = String((data && data.serial) || "").trim();
  if (!userId) return jsonOut_({ ok: false, userId: "", error: "Missing userId" });
  if (!serial) return jsonOut_({ ok: false, userId: userId, error: "Missing serial" });

  try {
    var topupRes = redeemSerialViaTopup_(serial, userId, displayName);

    var amount = Number(topupRes.amount);
    var daysAdded = mapTopupAmountToDays_(amount);
    // ✅ allow daysAdded=0: feature sync only (no extra days)
    if (!isFinite(daysAdded) || daysAdded < 0) {
      var e1 = new Error("TOPUP_AMOUNT_NOT_SUPPORTED");
      e1.details = { amount: amount, daysAdded: daysAdded };
      throw e1;
    }

    var applied = applyTopupToUser_(userId, displayName, daysAdded, {
      serial: serial,
      amount: amount,
      daysAdded: daysAdded,
      topup: topupRes
    });

    var r = buildCheckResult_(userId);
    r.topup = {
      serial: serial,
      amount: amount,
      daysAdded: applied.daysAdded,
      oldRemainingDays: applied.oldRemainingDays,
      newRemainingDays: applied.newRemainingDays
    };
    return jsonOut_(r);
  } catch (e) {
    var out = { ok: false, userId: userId, error: String(e && e.message ? e.message : e) };
    if (e && e.details) out.details = e.details;
    return jsonOut_(out);
  }
}

/* =========================
 * doGet / doPost
 * ========================= */
function doGet(e) {
  if (e && e.parameter && e.parameter._cors === "preflight") {
    return jsonOut_({ ok: true, userId: "", preflight: true });
  }

  var mode = String((e && e.parameter && e.parameter.mode) || "").toLowerCase();

  if (mode === "check") return handleCheck_(e);
  if (mode === "register") return handleRegister_(e.parameter);
  if (mode === "listusers") return handleListUsers_();

  if (mode === "updateuser") return handleUpdateUser_(e.parameter);
  if (mode === "updateusersbatch") return handleUpdateUsersBatch_(e.parameter);
  if (mode === "deleteuser") return handleDeleteUser_(e.parameter);

  if (mode === "getpersonalstatus") return handleGetPersonalStatus_(e);
  if (mode === "getusermanagelink") return handleGetUserManageLink_(e);
  if (mode === "updatepersonalstatuslinks") return handleUpdatePersonalStatusLinks_(e.parameter);
  if (mode === "syncpersonalstatusrow") return handleSyncPersonalStatusRow_(e.parameter);

  if (mode === "pushmessage") return handlePushMessage_(e.parameter);

  return jsonOut_({
    ok: false,
    userId: String((e && e.parameter && e.parameter.userId) || "").trim(),
    error: "invalid_mode"
  });
}

function doPost(e) {
  if (
    e.postData &&
    e.postData.type &&
    e.postData.type.indexOf("text/plain") === 0 &&
    e.postData.contents === "_cors_preflight_"
  ) {
    return jsonOut_({ ok: true, userId: "", preflight: true });
  }

  var data = {};
  var mode = "";
  var raw = "";
  var ctype = "";

  try {
    ctype = e.postData && e.postData.type ? String(e.postData.type) : "";
    raw = e.postData && typeof e.postData.contents === "string" ? e.postData.contents : "";

    if (ctype.indexOf("application/json") === 0) {
      data = JSON.parse(raw || "{}");
      mode = String(data.mode || "").toLowerCase();
    } else if (raw && raw.trim().charAt(0) === "{") {
      data = JSON.parse(raw);
      mode = String(data.mode || "").toLowerCase();
    } else {
      data = e.parameter || {};
      mode = String(data.mode || "").toLowerCase();
    }
  } catch (err) {
    return jsonOut_({ ok: false, userId: "", error: "Invalid JSON" });
  }

  if (mode === "check") return handleCheck_({ parameter: data });
  if (mode === "register") return handleRegister_(data);
  if (mode === "listusers") return handleListUsers_();

  if (mode === "updateuser") return handleUpdateUser_(data);
  if (mode === "updateusersbatch") return handleUpdateUsersBatch_(data);
  if (mode === "deleteuser") return handleDeleteUser_(data);

  if (mode === "getpersonalstatus") return handleGetPersonalStatus_({ parameter: data });
  if (mode === "getusermanagelink") return handleGetUserManageLink_({ parameter: data });
  if (mode === "updatepersonalstatuslinks") return handleUpdatePersonalStatusLinks_(data);
  if (mode === "syncpersonalstatusrow") return handleSyncPersonalStatusRow_(data);

  if (mode === "pushmessage") return handlePushMessage_(data);

  if (mode === "topupredeem_v1") return handleTopupRedeem_(data);

  return jsonOut_({ ok: false, userId: String((data && data.userId) || "").trim(), error: "invalid_mode" });
}
