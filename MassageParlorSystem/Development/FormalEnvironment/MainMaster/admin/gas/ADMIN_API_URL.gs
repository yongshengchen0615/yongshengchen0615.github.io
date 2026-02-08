/**
 * =========================================================
 * Admin Auth GAS (FULL / Auto-Provision + Admin Dashboard APIs)
 * ✅ 新欄位追加在舊欄位後面
 * ✅ 新欄位預設內容全部："否"（字串）
 * ✅ adminUpsertAndCheck 會回傳 permissions（含推播功能開通 + tech 欄位）
 * =========================================================
 */

const ADMIN_CONFIG = {
  TZ: "Asia/Taipei",
  SHEET_ADMINS: "Admins",
  DEFAULT_AUDIT: "待審核",
  AUTO_SPREADSHEET_NAME: "AdminAuth_DB",
  AUDIT_ENUM: ["待審核", "通過", "拒絕", "停用", "系統維護", "其他"],
};

function doGet(e) {
  return jsonOut_({
    ok: true,
    ping: true,
    ts: now_(),
    spreadsheetId: getSpreadsheetId_() || "",
  });
}

function doPost(e) {
  try {
    const payload = parseBody_(e);
    const mode = String(payload.mode || "").trim();

    if (mode === "adminUpsertAndCheck") {
      const userId = String(payload.userId || "").trim();
      const displayName = String(payload.displayName || "").trim();
      if (!userId) return jsonOut_({ ok: false, error: "missing userId" });
      return jsonOut_(upsertAndCheck_(userId, displayName));
    }

    if (mode === "listAdmins") return jsonOut_(listAdmins_());

    if (mode === "updateAdminsBatch") {
      const items = Array.isArray(payload.items) ? payload.items : [];
      return jsonOut_(updateAdminsBatch_(items));
    }

    if (mode === "deleteAdmin") {
      const userId = String(payload.userId || "").trim();
      if (!userId) return jsonOut_({ ok: false, error: "missing userId" });
      return jsonOut_(deleteAdmin_(userId));
    }

    if (mode === "getSpreadsheetId") {
      const ss = getOrCreateSpreadsheet_();
      return jsonOut_({ ok: true, spreadsheetId: ss.getId() });
    }

    return jsonOut_({ ok: false, error: "unknown mode" });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

/* =========================
 * Core: adminUpsertAndCheck
 * ✅ 回傳 permissions（含推播功能開通 + tech 欄位）
 * ========================= */
function upsertAndCheck_(userId, displayName) {
  const ss = getOrCreateSpreadsheet_();
  const sh = getOrCreateAdminsSheet_(ss);

  const data = sh.getDataRange().getValues();
  const header = data[0] || [];
  const idx = indexMap_(header);

  const rowIndex = findRowByUserId_(data, idx, userId);
  const now = now_();
  const NO = "否";

  if (rowIndex === -1) {
    const audit = ADMIN_CONFIG.DEFAULT_AUDIT;

    // ✅ 先寫舊欄位，再寫新欄位（新欄位預設全否）
    sh.appendRow([
      userId,
      displayName,
      audit,
      now,
      now,

      NO, // 推播功能開通（新增：放在技師審核狀態前面）

      NO, // 技師審核狀態
      NO, // 技師建立時間
      NO, // 技師開始使用日期
      NO, // 技師使用期限
      NO, // 技師師傅編號
      NO, // 技師是否師傅
      NO, // 技師是否推播
      NO, // 技師個人狀態開通
      NO, // 技師預約查詢開通
      NO, // 技師排班表開通
      NO, // 技師業績開通
    ]);

    return {
      ok: true,
      audit,
      isNew: true,
      spreadsheetId: ss.getId(),

      // ✅ permissions
      pushFeatureEnabled: NO,
      techAudit: NO,
      techCreatedAt: NO,
      techStartDate: NO,
      techExpiryDate: NO,
      techMasterNo: NO,
      techIsMaster: NO,
      techPushEnabled: NO,
      techPersonalStatusEnabled: NO,
      techAppointmentQueryEnabled: NO,
      techScheduleEnabled: NO,
      techPerformanceEnabled: NO,
    };
  }

  const sheetRow = rowIndex + 1;
  const audit = normalizeAudit_(String(data[rowIndex][idx.audit] || ADMIN_CONFIG.DEFAULT_AUDIT));

  // 舊欄位更新
  if (idx.displayName !== -1) sh.getRange(sheetRow, idx.displayName + 1).setValue(displayName);
  if (idx.lastLogin !== -1) sh.getRange(sheetRow, idx.lastLogin + 1).setValue(now);

  // ✅ 讀 permissions（空白→否）
  const perms = readPerms_(data[rowIndex], idx);

  return {
    ok: true,
    audit,
    isNew: false,
    spreadsheetId: ss.getId(),
    ...perms,
  };
}

/* =========================
 * Dashboard: list / update / delete
 * ========================= */
function listAdmins_() {
  const ss = getOrCreateSpreadsheet_();
  const sh = getOrCreateAdminsSheet_(ss);

  const data = sh.getDataRange().getValues();
  const header = data[0] || [];
  const idx = indexMap_(header);

  const rows = [];
  for (let r = 1; r < data.length; r++) {
    const userId = String(data[r][idx.userId] || "").trim();
    if (!userId) continue;

    rows.push({
      userId,
      displayName: String(data[r][idx.displayName] || ""),

      // 舊欄位
      audit: normalizeAudit_(String(data[r][idx.audit] || ADMIN_CONFIG.DEFAULT_AUDIT)),
      createdAt: formatCellTime_(data[r][idx.createdAt]),
      lastLogin: formatCellTime_(data[r][idx.lastLogin]),

      // ✅ 新欄位（字串）
      pushFeatureEnabled: String(data[r][idx.pushFeatureEnabled] ?? ""),

      techAudit: String(data[r][idx.techAudit] ?? ""),
      techCreatedAt: String(data[r][idx.techCreatedAt] ?? ""),
      techStartDate: String(data[r][idx.techStartDate] ?? ""),
      techExpiryDate: String(data[r][idx.techExpiryDate] ?? ""),
      techMasterNo: String(data[r][idx.techMasterNo] ?? ""),
      techIsMaster: String(data[r][idx.techIsMaster] ?? ""),
      techPushEnabled: String(data[r][idx.techPushEnabled] ?? ""),
      techPersonalStatusEnabled: String(data[r][idx.techPersonalStatusEnabled] ?? ""),
      techAppointmentQueryEnabled: String(data[r][idx.techAppointmentQueryEnabled] ?? ""),
      techScheduleEnabled: String(data[r][idx.techScheduleEnabled] ?? ""),
      techPerformanceEnabled: String(data[r][idx.techPerformanceEnabled] ?? ""),
    });
  }

  return { ok: true, admins: rows, total: rows.length, spreadsheetId: ss.getId() };
}

function updateAdminsBatch_(items) {
  const ss = getOrCreateSpreadsheet_();
  const sh = getOrCreateAdminsSheet_(ss);

  const data = sh.getDataRange().getValues();
  const header = data[0] || [];
  const idx = indexMap_(header);

  const now = now_();
  const rowMap = new Map();
  for (let r = 1; r < data.length; r++) {
    const uid = String(data[r][idx.userId] || "").trim();
    if (uid) rowMap.set(uid, r);
  }

  let okCount = 0;
  const fail = [];

  items.forEach((it) => {
    try {
      const userId = String(it.userId || "").trim();
      if (!userId) throw new Error("missing userId");

      const displayName = String(it.displayName || "");
      const audit = normalizeAudit_(String(it.audit || ""));

      // ✅ 新欄位：沒傳就 "否"
      const pushFeatureEnabled = String(it.pushFeatureEnabled ?? "否");

      // tech 欄位：沒傳就 "否"
      const techAudit = String(it.techAudit ?? "否");
      const techCreatedAt = String(it.techCreatedAt ?? "否");
      const techStartDate = String(it.techStartDate ?? "否");
      const techExpiryDate = String(it.techExpiryDate ?? "否");
      const techMasterNo = String(it.techMasterNo ?? "否");
      const techIsMaster = String(it.techIsMaster ?? "否");
      const techPushEnabled = String(it.techPushEnabled ?? "否");
      const techPersonalStatusEnabled = String(it.techPersonalStatusEnabled ?? "否");
      const techAppointmentQueryEnabled = String(it.techAppointmentQueryEnabled ?? "否");
      const techScheduleEnabled = String(it.techScheduleEnabled ?? "否");
      const techPerformanceEnabled = String(it.techPerformanceEnabled ?? "否");

      let r = rowMap.get(userId);

      if (r == null) {
        sh.appendRow([
          userId,
          displayName,
          audit || ADMIN_CONFIG.DEFAULT_AUDIT,
          now,
          now,

          pushFeatureEnabled,

          techAudit,
          techCreatedAt,
          techStartDate,
          techExpiryDate,
          techMasterNo,
          techIsMaster,
          techPushEnabled,
          techPersonalStatusEnabled,
          techScheduleEnabled,
          techPerformanceEnabled,
        ]);
        okCount++;
        return;
      }

      const sheetRow = r + 1;

      // 舊欄位更新
      if (idx.audit !== -1) sh.getRange(sheetRow, idx.audit + 1).setValue(audit);
      if (displayName && idx.displayName !== -1) sh.getRange(sheetRow, idx.displayName + 1).setValue(displayName);
      if (idx.lastLogin !== -1) sh.getRange(sheetRow, idx.lastLogin + 1).setValue(now);

      // ✅ 新欄位更新
      if (idx.pushFeatureEnabled !== -1) sh.getRange(sheetRow, idx.pushFeatureEnabled + 1).setValue(pushFeatureEnabled);

      // tech 欄位更新
      if (idx.techAudit !== -1) sh.getRange(sheetRow, idx.techAudit + 1).setValue(techAudit);
      if (idx.techCreatedAt !== -1) sh.getRange(sheetRow, idx.techCreatedAt + 1).setValue(techCreatedAt);
      if (idx.techStartDate !== -1) sh.getRange(sheetRow, idx.techStartDate + 1).setValue(techStartDate);
      if (idx.techExpiryDate !== -1) sh.getRange(sheetRow, idx.techExpiryDate + 1).setValue(techExpiryDate);
      if (idx.techMasterNo !== -1) sh.getRange(sheetRow, idx.techMasterNo + 1).setValue(techMasterNo);
      if (idx.techIsMaster !== -1) sh.getRange(sheetRow, idx.techIsMaster + 1).setValue(techIsMaster);
      if (idx.techPushEnabled !== -1) sh.getRange(sheetRow, idx.techPushEnabled + 1).setValue(techPushEnabled);
      if (idx.techPersonalStatusEnabled !== -1)
        sh.getRange(sheetRow, idx.techPersonalStatusEnabled + 1).setValue(techPersonalStatusEnabled);
      if (idx.techAppointmentQueryEnabled !== -1)
        sh.getRange(sheetRow, idx.techAppointmentQueryEnabled + 1).setValue(techAppointmentQueryEnabled);
      if (idx.techScheduleEnabled !== -1) sh.getRange(sheetRow, idx.techScheduleEnabled + 1).setValue(techScheduleEnabled);
      if (idx.techPerformanceEnabled !== -1)
        sh.getRange(sheetRow, idx.techPerformanceEnabled + 1).setValue(techPerformanceEnabled);

      okCount++;
    } catch (e) {
      fail.push({ userId: String(it?.userId || ""), error: String(e) });
    }
  });

  return { ok: true, okCount, failCount: fail.length, fail };
}

function deleteAdmin_(userId) {
  const ss = getOrCreateSpreadsheet_();
  const sh = getOrCreateAdminsSheet_(ss);

  const data = sh.getDataRange().getValues();
  const header = data[0] || [];
  const idx = indexMap_(header);

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idx.userId] || "").trim() === userId) {
      sh.deleteRow(r + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "not found" };
}

/* =========================
 * Provision
 * ========================= */
function getOrCreateSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = String(props.getProperty("ADMIN_SPREADSHEET_ID") || "").trim();

  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (_) {
      props.deleteProperty("ADMIN_SPREADSHEET_ID");
      id = "";
    }
  }

  const ss = SpreadsheetApp.create(ADMIN_CONFIG.AUTO_SPREADSHEET_NAME);
  props.setProperty("ADMIN_SPREADSHEET_ID", ss.getId());
  return ss;
}

function getSpreadsheetId_() {
  return String(PropertiesService.getScriptProperties().getProperty("ADMIN_SPREADSHEET_ID") || "").trim();
}

function getOrCreateAdminsSheet_(ss) {
  let sh = ss.getSheetByName(ADMIN_CONFIG.SHEET_ADMINS);

  // 舊欄位在前，新欄位追加在後（✅ 推播功能開通 放在 技師審核狀態 前面）
  const expectedHeader = [
    "lineUserId",
    "lineDisplayName",
    "審核狀態",
    "建立時間",
    "最後登入",

    "推播功能開通",

    "技師審核狀態",
    "技師建立時間",
    "技師開始使用日期",
    "技師使用期限",
    "技師師傅編號",
    "技師是否師傅",
    "技師是否推播",
    "技師個人狀態開通",
    "技師預約查詢開通",
    "技師排班表開通",
    "技師業績開通",
  ];

  if (!sh) {
    sh = ss.insertSheet(ADMIN_CONFIG.SHEET_ADMINS);
    sh.appendRow(expectedHeader);
    return sh;
  }

  const lastCol = Math.max(expectedHeader.length, sh.getLastColumn() || 0);
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0] || [];

  // 缺欄位就補在最後，不清空資料
  const missing = expectedHeader.filter((h) => !header.includes(h));
  if (missing.length) {
    const currentCols = header.filter(Boolean).length || sh.getLastColumn();
    missing.forEach((h, i) => sh.getRange(1, currentCols + 1 + i).setValue(h));

    // 對新欄位：空白補 "否"
    const newHeader = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] || [];
    const idx2 = indexMap_(newHeader);
    const lastRow = sh.getLastRow();

    if (lastRow >= 2) {
      fillDefaultIfEmpty_(sh, idx2.pushFeatureEnabled, lastRow, "否");

      fillDefaultIfEmpty_(sh, idx2.techAudit, lastRow, "否");
      fillDefaultIfEmpty_(sh, idx2.techCreatedAt, lastRow, "否");
      fillDefaultIfEmpty_(sh, idx2.techStartDate, lastRow, "否");
      fillDefaultIfEmpty_(sh, idx2.techExpiryDate, lastRow, "否");
      fillDefaultIfEmpty_(sh, idx2.techMasterNo, lastRow, "否");
      fillDefaultIfEmpty_(sh, idx2.techIsMaster, lastRow, "否");
      fillDefaultIfEmpty_(sh, idx2.techPushEnabled, lastRow, "否");
      fillDefaultIfEmpty_(sh, idx2.techPersonalStatusEnabled, lastRow, "否");
      fillDefaultIfEmpty_(sh, idx2.techAppointmentQueryEnabled, lastRow, "否");
      fillDefaultIfEmpty_(sh, idx2.techScheduleEnabled, lastRow, "否");
      fillDefaultIfEmpty_(sh, idx2.techPerformanceEnabled, lastRow, "否");
    }
  }

  return sh;
}

function fillDefaultIfEmpty_(sh, colIndex0, lastRow, defVal) {
  if (colIndex0 === -1) return;
  const col = colIndex0 + 1;
  const range = sh.getRange(2, col, Math.max(0, lastRow - 1), 1);
  const vals = range.getValues();
  let changed = false;
  for (let i = 0; i < vals.length; i++) {
    const v = String(vals[i][0] ?? "").trim();
    if (!v) {
      vals[i][0] = defVal;
      changed = true;
    }
  }
  if (changed) range.setValues(vals);
}

/* =========================
 * Header Index Map
 * ========================= */
function indexMap_(header) {
  const map = {
    userId: header.indexOf("lineUserId"),
    displayName: header.indexOf("lineDisplayName"),
    audit: header.indexOf("審核狀態"),
    createdAt: header.indexOf("建立時間"),
    lastLogin: header.indexOf("最後登入"),

    // ✅ 新欄位（在舊欄位後面）
    pushFeatureEnabled: header.indexOf("推播功能開通"),

    // tech 欄位（在新欄位後面）
    techAudit: header.indexOf("技師審核狀態"),
    techCreatedAt: header.indexOf("技師建立時間"),
    techStartDate: header.indexOf("技師開始使用日期"),
    techExpiryDate: header.indexOf("技師使用期限"),
    techMasterNo: header.indexOf("技師師傅編號"),
    techIsMaster: header.indexOf("技師是否師傅"),
    techPushEnabled: header.indexOf("技師是否推播"),
    techPersonalStatusEnabled: header.indexOf("技師個人狀態開通"),
    techAppointmentQueryEnabled: header.indexOf("技師預約查詢開通"),
    techScheduleEnabled: header.indexOf("技師排班表開通"),
    techPerformanceEnabled: header.indexOf("技師業績開通"),
  };

  if (map.userId === -1) throw new Error("Admins sheet missing header: lineUserId");
  if (map.audit === -1) throw new Error("Admins sheet missing header: 審核狀態");
  return map;
}

function findRowByUserId_(data, idx, userId) {
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idx.userId] || "").trim() === userId) return r;
  }
  return -1;
}

/* =========================
 * ✅ Permissions Reader
 * 空白/不存在 → "否"
 * ========================= */
function readPerms_(row, idx) {
  const get = (k) => {
    const col = idx[k];
    if (col === -1) return "否";
    const v = String(row[col] ?? "").trim();
    return v || "否";
  };

  return {
    pushFeatureEnabled: get("pushFeatureEnabled"),

    techAudit: get("techAudit"),
    techCreatedAt: get("techCreatedAt"),
    techStartDate: get("techStartDate"),
    techExpiryDate: get("techExpiryDate"),
    techMasterNo: get("techMasterNo"),
    techIsMaster: get("techIsMaster"),
    techPushEnabled: get("techPushEnabled"),
    techPersonalStatusEnabled: get("techPersonalStatusEnabled"),
    techAppointmentQueryEnabled: get("techAppointmentQueryEnabled"),
    techScheduleEnabled: get("techScheduleEnabled"),
    techPerformanceEnabled: get("techPerformanceEnabled"),
  };
}

function normalizeAudit_(v) {
  const s = String(v || "").trim();
  if (!s) return ADMIN_CONFIG.DEFAULT_AUDIT;
  return ADMIN_CONFIG.AUDIT_ENUM.includes(s) ? s : "其他";
}

/* =========================
 * Utils
 * ========================= */
function parseBody_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : "";
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function now_() {
  return Utilities.formatDate(new Date(), ADMIN_CONFIG.TZ, "yyyy/MM/dd HH:mm:ss");
}

function formatCellTime_(v) {
  if (!v) return "";
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, ADMIN_CONFIG.TZ, "yyyy/MM/dd HH:mm:ss");
  }
  return String(v);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
