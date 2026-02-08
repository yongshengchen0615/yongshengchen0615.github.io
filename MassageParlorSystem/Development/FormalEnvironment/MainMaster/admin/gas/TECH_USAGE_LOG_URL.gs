/**
 * Usage log GAS Web App（完整可貼覆蓋版）
 *
 * 功能：
 *  - GET/POST mode=log  ：寫入使用紀錄（appendRow）
 *  - GET      mode=list ：讀取最近 N 筆（支援 limit/offset 分頁，回 nextOffset）
 *  - POST     mode=deleteByName：依 name 刪除使用紀錄（需 key）
 *
 * 清理策略（重點）：
 *  - 保留 RETENTION_DAYS 天內的資料
 *  - 若「最舊資料日期」早於 cutoff（今天-RETENTION_DAYS），則開始刪除
 *  - 每次只刪「最舊的 DELETE_DAYS_PER_RUN 天」資料
 *  - 用 TRIM_MAX_DELETE_ROWS_PER_RUN 當保險：避免一次刪太多筆導致超時
 *
 * ✅新增：改名回填（userId -> name）
 *  - 只要 log 時 userId/name 存在，會掃描尾端資料
 *  - 找到同 userId 且 name != 最新 name 的列，批次更新 name
 *  - 有 MAX_SCAN_ROWS 與 MAX_UPDATES_PER_RUN 避免超時
 *
 * 欄位 HEADERS（固定順序，請不要任意改動）
 *  - serverTime, event, eventCn, userId, name, clientTs, clientIso, tz, href, detail
 */

// =========================
// Spreadsheet / Sheet 設定（請改為你的 ID / 名稱）
const SPREADSHEET_ID = "1EPRyg_egFNQ4pTdRXUJ5KwtcHdC_VaSiSbEQCLaaePw";
const SHEET_NAME = "usage_log";

// 欄位（固定）
const HEADERS = [
  "serverTime",
  "event",
  "eventCn",
  "userId",
  "name",
  "clientTs",
  "clientIso",
  "tz",
  "href",
  "detail",
];

// =========================
// 清理參數（請依需求調整）
// =========================
const RETENTION_DAYS = 10; // 保留最近 N 天（要 30 天請改 30）
const DELETE_DAYS_PER_RUN = 2; // 每次刪除最舊 N 天（例如 2）
const TRIM_TRIGGER_ROWS = 10000; // 超過這筆數才觸發清理檢查；0 = 每次都檢查
const TRIM_MAX_DELETE_ROWS_PER_RUN = 1000; // 保險閥：一次最多刪多少列；0 = 不限制

// =========================
// ✅ 改名回填參數（重點）
// =========================
const NAME_BACKFILL_ENABLE = true; // 是否啟用改名回填
const NAME_BACKFILL_MAX_SCAN_ROWS = 20000; // 最多掃描尾端多少資料列
const NAME_BACKFILL_MAX_UPDATES_PER_RUN = 500; // 一次最多更新幾筆 name（避免超時）

// =========================
// list 參數
// =========================
const LIST_DEFAULT_LIMIT = 1000;
const LIST_MAX_LIMIT = 10000;
const LIST_ALLOW_RETURN_ALL = false; // 若允許 all，注意效能

// =========================
// deleteByName 參數（管理功能）
// =========================
// ✅ 建議用 ScriptProperties 設定 ADMIN_KEY，比直接寫在程式碼更安全。
// - ScriptProperties key: ADMIN_KEY
// - 前端請在 config.json 設定 TECH_USAGE_LOG_ADMIN_KEY
const ADMIN_KEY = ""; // 留空 = 停用刪除功能

const DELETE_DEFAULT_LIMIT = 500;
const DELETE_MAX_LIMIT = 2000;

// =========================
// 工具函式
// =========================
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function clamp_(n, min, max) {
  n = Number(n);
  if (!isFinite(n)) return min;
  n = Math.floor(n);
  return Math.min(max, Math.max(min, n));
}

function getAdminKey_() {
  try {
    const k = PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
    if (k && String(k).trim()) return String(k).trim();
  } catch (e) {}
  return String(ADMIN_KEY || "").trim();
}

function requireAdminKey_(p) {
  const required = getAdminKey_();
  if (!required) {
    return { ok: false, error: "delete_disabled_missing_admin_key" };
  }
  const provided = String((p && (p.key || p.adminKey)) || "").trim();
  if (!provided || provided !== required) {
    return { ok: false, error: "unauthorized" };
  }
  return { ok: true };
}

/** 將輸入轉成 Date（支援 Date / 可解析字串 / 毫秒數），無法解析回 null */
function toDate_(v) {
  if (v instanceof Date) return v;
  if (v === null || v === undefined || String(v).trim() === "") return null;

  const s = String(v).trim();

  // 純數字 → 當成毫秒
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    const d = new Date(n);
    if (!isNaN(d.getTime())) return d;
  }

  // 嘗試一般解析（ISO / 其他）
  const d2 = new Date(s);
  if (!isNaN(d2.getTime())) return d2;

  return null;
}

/** 以腳本時區切日，輸出 yyyy-MM-dd 作為「一天」的 key */
function dayKey_(d, tz) {
  return Utilities.formatDate(d, tz || Session.getScriptTimeZone(), "yyyy-MM-dd");
}

/** cutoff：現在時間 - retentionDays（Date 物件） */
function cutoffDate_(retentionDays) {
  return new Date(Date.now() - Number(retentionDays) * 24 * 60 * 60 * 1000);
}

/** 確保 sheet 存在並包含 HEADERS（若為空表會寫入表頭；表頭不足會補齊） */
function ensureSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);

  // 若整張表是空的，寫入 headers
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    return sh;
  }

  // 讀第一列表頭，若不足就補齊（固定順序）
  const lastCol = Math.max(1, sh.getLastColumn());
  const headerRow = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);

  // 逐欄確保 1..HEADERS.length 都存在正確 header 名稱
  for (let i = 0; i < HEADERS.length; i++) {
    const cellVal = headerRow[i] !== undefined ? String(headerRow[i]).trim() : "";
    if (!cellVal) {
      sh.getRange(1, i + 1).setValue(HEADERS[i]);
    } else if (cellVal !== HEADERS[i]) {
      // 若順序已被改動，這裡不強制重排，避免破壞既有資料對應
      // 但至少確保該欄位名稱存在（在最後補上）
      if (headerRow.indexOf(HEADERS[i]) === -1) {
        sh.getRange(1, sh.getLastColumn() + 1).setValue(HEADERS[i]);
      }
    }
  }

  return sh;
}

// =========================
// 管理：依 name 刪除紀錄（可分批）
// =========================
function deleteByName_(p) {
  const auth = requireAdminKey_(p);
  if (!auth.ok) return json_(auth);

  const name = String((p && p.name) || "").trim();
  if (!name) return json_({ ok: false, error: "missing_name" });

  const dryRun = String((p && (p.dryRun || p.dryrun)) || "") === "1";
  const limit = clamp_((p && p.limit) || DELETE_DEFAULT_LIMIT, 1, DELETE_MAX_LIMIT);

  const lock = LockService.getDocumentLock();
  lock.waitLock(28000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ensureSheet_(ss);
    const lastRow = sh.getLastRow();
    if (lastRow <= 1) return json_({ ok: true, dryRun: dryRun, name: name, matched: 0, deleted: 0, remaining: 0 });

    const nameCol = HEADERS.indexOf("name") + 1;
    if (nameCol <= 0) return json_({ ok: false, error: "headers_missing_name" });

    const dataStartRow = 2;
    const numRows = lastRow - 1;

    // 只讀 name 欄位，加速掃描
    const names = sh.getRange(dataStartRow, nameCol, numRows, 1).getValues();
    const matchedIdx = [];
    for (let i = 0; i < names.length; i++) {
      if (String(names[i][0] || "") === name) matchedIdx.push(i);
    }
    const matched = matchedIdx.length;
    if (dryRun) return json_({ ok: true, dryRun: true, name: name, matched: matched });
    if (!matched) return json_({ ok: true, name: name, matched: 0, deleted: 0, remaining: 0 });

    // 分批：只刪最後的 limit 筆（由底部往上），避免一次刪太多超時
    const toDeleteIdx = matchedIdx.slice(Math.max(0, matchedIdx.length - limit));
    const rows = toDeleteIdx.map((idx) => dataStartRow + idx);
    rows.sort((a, b) => b - a); // 由大到小

    let deleted = 0;
    let blockStart = rows[0];
    let blockEnd = rows[0];

    for (let j = 1; j < rows.length; j++) {
      const r = rows[j];
      if (r === blockEnd - 1) {
        blockEnd = r;
        continue;
      }
      const n = blockStart - blockEnd + 1;
      sh.deleteRows(blockEnd, n);
      deleted += n;
      blockStart = r;
      blockEnd = r;
    }
    // flush last block
    const n2 = blockStart - blockEnd + 1;
    sh.deleteRows(blockEnd, n2);
    deleted += n2;

    const remaining = Math.max(0, matched - deleted);
    return json_({ ok: true, name: name, matched: matched, deleted: deleted, remaining: remaining, limit: limit });
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

// =========================
// ✅ 改名回填核心：用 userId 找舊 name，更新為 newName
// - 從尾端往上掃（最新→最舊）
// - 只掃描尾端 MAX_SCAN_ROWS 筆
// - 一次最多更新 MAX_UPDATES_PER_RUN 筆
// =========================
function backfillUserNameByUserId_(sh, userId, newName) {
  if (!NAME_BACKFILL_ENABLE) return { enabled: false };

  userId = String(userId || "").trim();
  newName = String(newName || "").trim();
  if (!userId || !newName) {
    return { enabled: true, skipped: true, reason: "missing_userId_or_name" };
  }

  const lastRow = sh.getLastRow(); // 含 header
  const dataRows = Math.max(0, lastRow - 1);
  if (dataRows === 0) return { enabled: true, skipped: true, reason: "empty" };

  const scan = Math.min(NAME_BACKFILL_MAX_SCAN_ROWS, dataRows);
  const startRow = lastRow - scan + 1;

  const userIdCol = 4; // D
  const nameCol = 5; // E

  // 一次取兩欄（userId, name）
  const range = sh.getRange(startRow, userIdCol, scan, 2);
  const values = range.getValues(); // [[uid, name], ...] 對應 startRow..lastRow

  const rowsToUpdate = [];
  for (let i = values.length - 1; i >= 0; i--) {
    const uid = String(values[i][0] || "").trim();
    if (uid !== userId) continue;

    const oldName = String(values[i][1] || "").trim();
    if (oldName !== newName) {
      rowsToUpdate.push(startRow + i);
      if (rowsToUpdate.length >= NAME_BACKFILL_MAX_UPDATES_PER_RUN) break;
    }
  }

  if (rowsToUpdate.length === 0) {
    return { enabled: true, scanned: scan, updated: 0, note: "no_mismatch_found_in_scan_window" };
  }

  // 逐列更新（更新數已受上限保護）
  for (let i = 0; i < rowsToUpdate.length; i++) {
    sh.getRange(rowsToUpdate[i], nameCol).setValue(newName);
  }

  return {
    enabled: true,
    scanned: scan,
    updated: rowsToUpdate.length,
    updatedRowsSample: rowsToUpdate.slice(0, 20),
  };
}

// =========================
// 清理核心：若過期，刪「最舊 N 天」
// =========================
function trimOldestDaysIfExpired_(sh) {
  const lastRow = sh.getLastRow(); // 含 header
  const dataRows = Math.max(0, lastRow - 1);
  if (dataRows === 0) return { trimmed: false, reason: "empty" };

  if (TRIM_TRIGGER_ROWS > 0 && dataRows <= TRIM_TRIGGER_ROWS) {
    return { trimmed: false, reason: "below_trigger", dataRows };
  }

  const tz = Session.getScriptTimeZone() || "Asia/Taipei";
  const cutoff = cutoffDate_(RETENTION_DAYS);

  // 讀最舊一筆（第2列）的 serverTime（第1欄）
  const oldestVal = sh.getRange(2, 1, 1, 1).getValue();
  const oldestDate = toDate_(oldestVal);
  if (!oldestDate) return { trimmed: false, reason: "oldest_unparseable" };

  if (oldestDate >= cutoff) {
    return { trimmed: false, reason: "not_expired", oldest: oldestDate, cutoff };
  }

  // 從最舊開始掃，收集最舊 DELETE_DAYS_PER_RUN 天的列數
  const times = sh.getRange(2, 1, dataRows, 1).getValues();
  const daysToDelete = new Set();

  const oldestDay = dayKey_(oldestDate, tz);
  daysToDelete.add(oldestDay);

  let deleteCount = 0;
  for (let i = 0; i < times.length; i++) {
    const d = toDate_(times[i][0]);
    if (!d) break; // 遇不可解析就停止（保守）
    const dk = dayKey_(d, tz);

    if (!daysToDelete.has(dk)) {
      if (daysToDelete.size < DELETE_DAYS_PER_RUN) {
        daysToDelete.add(dk);
      } else {
        break;
      }
    }

    deleteCount++;
    if (TRIM_MAX_DELETE_ROWS_PER_RUN > 0 && deleteCount >= TRIM_MAX_DELETE_ROWS_PER_RUN) break;
  }

  if (deleteCount > 0) {
    sh.deleteRows(2, deleteCount);
    return {
      trimmed: true,
      deletedRows: deleteCount,
      deletedDays: Array.from(daysToDelete),
      cutoff,
    };
  }

  return { trimmed: false, reason: "nothing_to_delete", oldestDay, cutoff };
}

// =========================
// list：讀取最近 N 筆（支援 limit/offset）
// 返回：{ ok:true, rows:[{...}], nextOffset? }
// rows: newest-first
// =========================
function list_(p) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ensureSheet_(ss);

  const lastRow = sh.getLastRow();
  const dataRows = Math.max(0, lastRow - 1);
  if (dataRows === 0) return json_({ ok: true, rows: [] });

  // limit
  let limitParam = p && p.limit !== undefined && p.limit !== null ? String(p.limit).trim() : "";
  let limit;
  if (limitParam === "" || limitParam.toLowerCase() === "null") {
    limit = LIST_ALLOW_RETURN_ALL ? dataRows : Math.min(LIST_DEFAULT_LIMIT, dataRows);
  } else if (limitParam.toLowerCase() === "all") {
    limit = dataRows;
  } else {
    limit = clamp_(Number(limitParam), 1, LIST_MAX_LIMIT);
  }

  // offset：已跳過多少「最新」筆（從最新開始算）
  let offset = 0;
  if (p && p.offset !== undefined && p.offset !== null && String(p.offset).trim() !== "") {
    offset = Math.max(0, parseInt(String(p.offset), 10) || 0);
  }

  const available = dataRows - offset;
  if (available <= 0) return json_({ ok: true, rows: [] });

  const take = Math.min(limit, available);

  const endRow = lastRow - offset; // 此頁最後一筆（較新）
  const startRow = Math.max(2, endRow - take + 1);
  const numRows = endRow - startRow + 1;
  const numCols = Math.max(HEADERS.length, sh.getLastColumn());

  const values = sh.getRange(startRow, 1, numRows, numCols).getValues();

  // 輸出 newest-first
  const rows = values
    .map((r) => {
      const entry = {
        serverTime: String(r[0] ?? ""),
        event: String(r[1] ?? ""),
        eventCn: String(r[2] ?? ""),
        userId: String(r[3] ?? ""),
        name: String(r[4] ?? ""),
        clientTs: String(r[5] ?? ""),
        clientIso: String(r[6] ?? ""),
        tz: String(r[7] ?? ""),
        href: String(r[8] ?? ""),
        detail: String(r[9] ?? ""),
      };

      // 嘗試解析 detail
      try {
        const d = entry.detail || "";
        if (d && d.trim().startsWith("{")) entry.parsedDetail = JSON.parse(d);
        else entry.parsedDetail = null;
      } catch (e) {
        entry.parsedDetail = null;
      }

      return entry;
    })
    .reverse(); // newest-first

  const alreadyReturned = offset + take;
  const resp = { ok: true, rows };
  if (alreadyReturned < dataRows) resp.nextOffset = alreadyReturned;

  return json_(resp);
}

// =========================
// log：寫入一筆（appendRow）並觸發清理檢查 + 改名回填
// 允許參數：event, eventCn, userId, name, ts, tz, href, detail
//  - ts: client ms（若提供會嘗試轉 clientIso）
// =========================
function log_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // wait up to 10s

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ensureSheet_(ss);

    const now = new Date();

    // clientTs 可能為毫秒字串或 ISO
    const clientTsRaw = p.ts !== undefined && p.ts !== null ? String(p.ts) : "";
    let clientIso = "";
    if (clientTsRaw && /^\d+$/.test(String(clientTsRaw).trim())) {
      const n = Number(clientTsRaw);
      const d = new Date(n);
      if (!isNaN(d.getTime())) clientIso = d.toISOString();
    } else if (clientTsRaw) {
      const d2 = new Date(clientTsRaw);
      if (!isNaN(d2.getTime())) clientIso = d2.toISOString();
    }

    const userId = String(p.userId || "");
    const name = String(p.name || "");

    // ✅ 1) 改名回填（先做，避免 append 後又多出一筆舊 name）
    const nameBackfill = backfillUserNameByUserId_(sh, userId, name);

    // ✅ 2) 寫入欄位（與 HEADERS 對應）
    const row = [
      now, // serverTime
      String(p.event || ""),
      String(p.eventCn || ""),
      userId,
      name,
      String(clientTsRaw || ""),
      String(clientIso || ""),
      String(p.tz || ""),
      String(p.href || ""),
      String(p.detail || ""),
    ];

    sh.appendRow(row);

    // ✅ 3) 清理：若過期則刪最舊 N 天
    const trimInfo = trimOldestDaysIfExpired_(sh);

    return json_({
      ok: true,
      retentionDays: RETENTION_DAYS,
      deleteDaysPerRun: DELETE_DAYS_PER_RUN,
      nameBackfill,
      trimInfo,
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

// =========================
// Web App Entry：doGet / doPost
// =========================
function doGet(e) {
  const p = (e && e.parameter) || {};
  const mode = String(p.mode || "").toLowerCase();

  try {
    if (mode === "log") return log_(p);
    if (mode === "list") return list_(p);
    if (mode === "deletebyname" || mode === "delete_by_name") return deleteByName_(p);

    return json_({
      ok: true,
      modes: ["log", "list", "deleteByName"],
      retentionDays: RETENTION_DAYS,
      deleteDaysPerRun: DELETE_DAYS_PER_RUN,
      trimTriggerRows: TRIM_TRIGGER_ROWS,
      trimMaxDeleteRowsPerRun: TRIM_MAX_DELETE_ROWS_PER_RUN,
      nameBackfill: {
        enable: NAME_BACKFILL_ENABLE,
        maxScanRows: NAME_BACKFILL_MAX_SCAN_ROWS,
        maxUpdatesPerRun: NAME_BACKFILL_MAX_UPDATES_PER_RUN,
      },
      timezone: Session.getScriptTimeZone(),
      headers: HEADERS,
    });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  // 支援 JSON body：{ mode:"log", ... }
  let p = {};
  try {
    if (e && e.postData && e.postData.contents) {
      const ct = String(e.postData.type || "").toLowerCase();
      const raw = String(e.postData.contents || "");
      const rawTrim = raw.trim();

      // ✅ 為了避免瀏覽器 CORS preflight，前端會用 Content-Type: text/plain 傳 JSON。
      // 因此這裡除了 application/json，也接受「看起來像 JSON」的 payload。
      const looksLikeJson = rawTrim && (rawTrim[0] === "{" || rawTrim[0] === "[");
      if (ct.indexOf("application/json") >= 0 || looksLikeJson) {
        p = JSON.parse(rawTrim || "{}") || {};
      } else {
        // 非 JSON 就回退用 parameter（或自行擴充 urlencoded parser）
        p = (e && e.parameter) || {};
      }
    } else {
      p = (e && e.parameter) || {};
    }
  } catch (err) {
    return json_({ ok: false, error: "invalid_json_body", detail: String(err) });
  }

  const mode = String(p.mode || "").toLowerCase();
  try {
    if (mode === "log") return log_(p);
    if (mode === "list") return list_(p);
    if (mode === "deletebyname" || mode === "delete_by_name") return deleteByName_(p);
    return json_({ ok: false, error: "unknown_mode", mode });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}
