/**
 * GAS Web App - Upsert Report Receiver (Summary + Detail) + Query API
 *
 * ✅ doPost(mode=upsertReport_v1) 保留（不改前端）
 * ✅ doGet(mode=getReport_v1) 保留（不改前端）
 *
 * ✅ 改成「每位師傅獨立 Sheet」：
 * - Summary: Report_Summary_<techNo>
 * - Detail : Report_Detail_<techNo>
 *
 * ✅ 效能優化（不改前端）：
 * 1) Detail 不再全表掃描：新增每位師傅的 Index Sheet
 *    - DetailIndex: Report_DetailIndex_<techNo>
 *    - 存 key -> startRow / rowCount / clientHash
 *    - GET 時用 index 直接定點讀取 detail 區塊（O(k)）
 * 2) Upsert detail 不再 deleteRow 逐列刪（超慢）
 *    - 若舊區塊夠大：clear + 覆蓋 setValues
 *    - 否則：追加在表尾並更新 index
 * 3) Summary 查詢用 TextFinder（避免全表 getValues）
 * 4) GET：CacheService 快取（TTL 60 秒），命中直接回
 *
 * 部署：Deploy as web app（Anyone with the link / or your desired access）
 */

const CONFIG = {
  TZ: "Asia/Taipei",
  SHEET_SUMMARY_PREFIX: "Report_Summary_",
  SHEET_DETAIL_PREFIX: "Report_Detail_",
  SHEET_DETAIL_INDEX_PREFIX: "Report_DetailIndex_",
  LOCK_WAIT_MS: 1500,
  CACHE_TTL_SEC: 60,
};

const SUMMARY_HEADERS = [
  "key", // dateKey_techNo
  "dateKey",
  "techNo",
  "lastUpdatedAt", // 台北時間
  "updateCount",
  "source",
  "pageTitle",
  "pageUrl",
  "clientTsIso",
  "clientHash",

  "排班_單數",
  "排班_筆數",
  "排班_數量",
  "排班_金額",
  "老點_單數",
  "老點_筆數",
  "老點_數量",
  "老點_金額",
  "總計_單數",
  "總計_筆數",
  "總計_數量",
  "總計_金額",

  "detailCount",
];

const DETAIL_HEADERS = [
  "key",
  "dateKey",
  "techNo",
  "lastUpdatedAt",
  "source",
  "pageUrl",
  "clientTsIso",
  "clientHash",
  "服務項目",
  "總筆數",
  "總節數",
  "總計金額",
  "老點筆數",
  "老點節數",
  "老點金額",
  "排班筆數",
  "排班節數",
  "排班金額",
];

const DETAIL_INDEX_HEADERS = [
  "key",
  "dateKey",
  "techNo",
  "startRow", // Detail sheet 起始列（含資料列，不含 header）
  "rowCount", // 該 key 的資料列數
  "lastUpdatedAt", // 台北時間
  "clientHash",
];

function doGet(e) {
  const mode = String((e && e.parameter && e.parameter.mode) || "").trim();
  if (mode === "getReport_v1") {
    return handleGetReport_(e);
  }
  return jsonOut_({
    ok: true,
    hint: "POST JSON with mode=upsertReport_v1, or GET with mode=getReport_v1&techNo=07&dateKey=yyyy-MM-dd",
    now: formatTs_(new Date()),
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) {
    return jsonOut_({ ok: false, error: "LOCKED_TRY_LATER" });
  }

  try {
    const payload = parseJson_(e);
    const mode = String(payload.mode || "").trim();
    if (mode !== "upsertReport_v1") {
      return jsonOut_({ ok: false, error: "BAD_MODE", got: mode });
    }

    const source = String(payload.source || "");
    const pageUrl = String(payload.pageUrl || "");
    const pageTitle = String(payload.pageTitle || "");
    const clientTsIso = String(payload.clientTsIso || "");
    const clientHash = String(payload.clientHash || "");
    const techNoRaw = String(payload.techNo || "");
    const summary = payload.summary || {};
    const detail = Array.isArray(payload.detail) ? payload.detail : [];

    const techNo = normalizeTechNo_(techNoRaw);
    const dateKey =
      String(payload.dateKey || "") || Utilities.formatDate(new Date(), CONFIG.TZ, "yyyy-MM-dd");

    if (!techNo) return jsonOut_({ ok: false, error: "MISSING_techNo" });
    if (!clientHash) return jsonOut_({ ok: false, error: "MISSING_clientHash" });
    if (!detail.length) return jsonOut_({ ok: false, error: "EMPTY_DETAIL" });

    const key = `${dateKey}_${techNo}`;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const now = formatTs_(new Date());

    // ✅ 每位師傅獨立 Summary sheet
    const sumShName = sheetSummaryName_(techNo);
    const sumSh = ensureSheet_(ss, sumShName, SUMMARY_HEADERS);

    const s1 = pickCard_(summary, "排班");
    const s2 = pickCard_(summary, "老點");
    const s3 = pickCard_(summary, "總計");

    const incoming = {
      key,
      dateKey,
      techNo,
      lastUpdatedAt: now,
      // updateCount 由 upsert 計算
      source,
      pageTitle,
      pageUrl,
      clientTsIso,
      clientHash,

      "排班_單數": s1.單數,
      "排班_筆數": s1.筆數,
      "排班_數量": s1.數量,
      "排班_金額": s1.金額,
      "老點_單數": s2.單數,
      "老點_筆數": s2.筆數,
      "老點_數量": s2.數量,
      "老點_金額": s2.金額,
      "總計_單數": s3.單數,
      "總計_筆數": s3.筆數,
      "總計_數量": s3.數量,
      "總計_金額": s3.金額,

      detailCount: detail.length,
    };

    const upsertRes = upsertSummaryByKeyFast_(sumSh, SUMMARY_HEADERS, incoming, key);

    // ✅ Summary hash 沒變：直接回 nochange（detail 也不動）
    if (upsertRes.result === "nochange") {
      const outNoChange = {
        ok: true,
        result: "nochange",
        key,
        dateKey,
        techNo,
        lastUpdatedAt: upsertRes.lastUpdatedAt,
        updateCount: upsertRes.updateCount,
      };
      cacheSetReport_(techNo, dateKey, outNoChange, CONFIG.CACHE_TTL_SEC);
      return jsonOut_(outNoChange);
    }

    // ✅ 每位師傅獨立 Detail sheet + Index sheet
    const detShName = sheetDetailName_(techNo);
    const detSh = ensureSheet_(ss, detShName, DETAIL_HEADERS);

    const idxShName = sheetDetailIndexName_(techNo);
    const idxSh = ensureSheet_(ss, idxShName, DETAIL_INDEX_HEADERS);

    const rows = detail.map((r) => [
      key,
      dateKey,
      techNo,
      now,
      source,
      pageUrl,
      clientTsIso,
      clientHash,
      String(r["服務項目"] || ""),
      num_(r["總筆數"]),
      num_(r["總節數"]),
      num_(r["總計金額"]),
      num_(r["老點筆數"]),
      num_(r["老點節數"]),
      num_(r["老點金額"]),
      num_(r["排班筆數"]),
      num_(r["排班節數"]),
      num_(r["排班金額"]),
    ]);

    const writeRes = upsertDetailByIndex_(detSh, idxSh, key, dateKey, techNo, now, clientHash, rows);

    const out = {
      ok: true,
      result: upsertRes.result, // inserted / updated
      key,
      dateKey,
      techNo,
      lastUpdatedAt: now,
      updateCount: upsertRes.updateCount,
      detailReplaced: rows.length,
      detailWrite: writeRes,
      sheets: { summary: sumShName, detail: detShName, detailIndex: idxShName },
    };

    cacheDelReport_(techNo, dateKey);
    return jsonOut_(out);
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.stack ? err.stack : err) });
  } finally {
    lock.releaseLock();
  }
}

function handleGetReport_(e) {
  try {
    const techNo = normalizeTechNo_((e && e.parameter && e.parameter.techNo) || "");
    const dateKey =
      String((e && e.parameter && e.parameter.dateKey) || "").trim() ||
      Utilities.formatDate(new Date(), CONFIG.TZ, "yyyy-MM-dd");

    if (!techNo) return jsonOut_({ ok: false, error: "MISSING_techNo" });

    const cached = cacheGetReport_(techNo, dateKey);
    if (cached) return jsonOut_(cached);

    const key = `${dateKey}_${techNo}`;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const sumSh = getOrCreateSheetHeaderOnly_(ss, sheetSummaryName_(techNo), SUMMARY_HEADERS);
    const detSh = getOrCreateSheetHeaderOnly_(ss, sheetDetailName_(techNo), DETAIL_HEADERS);
    const idxSh = getOrCreateSheetHeaderOnly_(ss, sheetDetailIndexName_(techNo), DETAIL_INDEX_HEADERS);

    const summary = findRowObjectByKeyTextFinder_(sumSh, key);
    const detail = findDetailObjectsByKeyViaIndex_(detSh, idxSh, key);

    const lastUpdatedAt = summary ? String(summary.lastUpdatedAt || "") : "";
    const updateCount = summary ? Number(summary.updateCount || 0) : 0;

    const out = {
      ok: true,
      result: "ok",
      key,
      dateKey,
      techNo,
      lastUpdatedAt,
      updateCount,
      summaryRow: summary,
      detailRows: detail,
      sheets: {
        summary: sheetSummaryName_(techNo),
        detail: sheetDetailName_(techNo),
        detailIndex: sheetDetailIndexName_(techNo),
      },
      cachedAt: formatTs_(new Date()),
    };

    cacheSetReport_(techNo, dateKey, out, CONFIG.CACHE_TTL_SEC);
    return jsonOut_(out);
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.stack ? err.stack : err) });
  }
}

function findRowObjectByKeyTextFinder_(sh, key) {
  const lastCol = sh.getLastColumn();
  if (sh.getLastRow() < 2 || lastCol < 1) return null;

  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const keyIdx = headers.indexOf("key");
  if (keyIdx < 0) return null;

  const keyCol = keyIdx + 1;
  const found = sh
    .getRange(2, keyCol, Math.max(0, sh.getLastRow() - 1), 1)
    .createTextFinder(String(key))
    .matchEntireCell(true)
    .findNext();

  if (!found) return null;

  const r = found.getRow();
  const row = sh.getRange(r, 1, 1, lastCol).getValues()[0];
  const obj = {};
  for (let c = 0; c < headers.length; c++) obj[headers[c]] = row[c];
  return obj;
}

function upsertDetailByIndex_(detSh, idxSh, key, dateKey, techNo, now, clientHash, rows) {
  const idxLastRow = idxSh.getLastRow();
  const idxLastCol = idxSh.getLastColumn();
  const headers = idxSh.getRange(1, 1, 1, idxLastCol).getValues()[0].map(String);

  const keyIdx = headers.indexOf("key");
  const startIdx = headers.indexOf("startRow");
  const countIdx = headers.indexOf("rowCount");
  const lastIdx = headers.indexOf("lastUpdatedAt");
  const hashIdx = headers.indexOf("clientHash");
  const dateIdx = headers.indexOf("dateKey");
  const techIdx = headers.indexOf("techNo");

  if (keyIdx < 0 || startIdx < 0 || countIdx < 0) {
    throw new Error("DETAIL_INDEX_HEADERS_INVALID");
  }

  let foundCell = null;
  if (idxLastRow >= 2) {
    foundCell = idxSh
      .getRange(2, keyIdx + 1, idxLastRow - 1, 1)
      .createTextFinder(String(key))
      .matchEntireCell(true)
      .findNext();
  }

  const newCount = rows.length;

  if (foundCell) {
    const r = foundCell.getRow();
    const rowVals = idxSh.getRange(r, 1, 1, idxLastCol).getValues()[0];

    const oldStart = parseInt(rowVals[startIdx], 10);
    const oldCount = parseInt(rowVals[countIdx], 10);

    if (
      Number.isFinite(oldStart) &&
      oldStart > 1 &&
      Number.isFinite(oldCount) &&
      oldCount >= newCount
    ) {
      const width = DETAIL_HEADERS.length;
      detSh.getRange(oldStart, 1, oldCount, width).clearContent();
      detSh.getRange(oldStart, 1, newCount, width).setValues(rows);

      idxSh
        .getRange(r, 1, 1, idxLastCol)
        .setValues([
          headers.map((h, i) => {
            if (i === keyIdx) return key;
            if (i === dateIdx) return dateKey;
            if (i === techIdx) return techNo;
            if (i === startIdx) return oldStart;
            if (i === countIdx) return newCount;
            if (i === lastIdx) return now;
            if (i === hashIdx) return clientHash;
            return rowVals[i];
          }),
        ]);

      return { mode: "overwrite", startRow: oldStart, rowCount: newCount };
    }

    const startRow = detSh.getLastRow() + 1;
    detSh.getRange(startRow, 1, newCount, DETAIL_HEADERS.length).setValues(rows);

    rowVals[startIdx] = startRow;
    rowVals[countIdx] = newCount;
    if (dateIdx >= 0) rowVals[dateIdx] = dateKey;
    if (techIdx >= 0) rowVals[techIdx] = techNo;
    if (lastIdx >= 0) rowVals[lastIdx] = now;
    if (hashIdx >= 0) rowVals[hashIdx] = clientHash;

    idxSh.getRange(r, 1, 1, idxLastCol).setValues([rowVals]);
    return { mode: "append_reindex", startRow, rowCount: newCount };
  }

  const startRow = detSh.getLastRow() + 1;
  detSh.getRange(startRow, 1, newCount, DETAIL_HEADERS.length).setValues(rows);

  const idxObj = {
    key,
    dateKey,
    techNo,
    startRow,
    rowCount: newCount,
    lastUpdatedAt: now,
    clientHash,
  };
  const idxRow = DETAIL_INDEX_HEADERS.map((h) => (idxObj[h] !== undefined ? idxObj[h] : ""));
  idxSh.appendRow(idxRow);

  return { mode: "append_new", startRow, rowCount: newCount };
}

function findDetailObjectsByKeyViaIndex_(detSh, idxSh, key) {
  const detLastCol = detSh.getLastColumn();
  if (detSh.getLastRow() < 2 || detLastCol < 1) return [];

  const detHeaders = detSh.getRange(1, 1, 1, detLastCol).getValues()[0].map(String);

  const idxLastRow = idxSh.getLastRow();
  const idxLastCol = idxSh.getLastColumn();
  if (idxLastRow < 2 || idxLastCol < 1) return [];

  const idxHeaders = idxSh.getRange(1, 1, 1, idxLastCol).getValues()[0].map(String);
  const keyIdx = idxHeaders.indexOf("key");
  const startIdx = idxHeaders.indexOf("startRow");
  const countIdx = idxHeaders.indexOf("rowCount");
  if (keyIdx < 0 || startIdx < 0 || countIdx < 0) return [];

  const found = idxSh
    .getRange(2, keyIdx + 1, idxLastRow - 1, 1)
    .createTextFinder(String(key))
    .matchEntireCell(true)
    .findNext();

  if (!found) return [];

  const r = found.getRow();
  const idxRow = idxSh.getRange(r, 1, 1, idxLastCol).getValues()[0];
  const startRow = parseInt(idxRow[startIdx], 10);
  const rowCount = parseInt(idxRow[countIdx], 10);

  if (!Number.isFinite(startRow) || startRow < 2) return [];
  if (!Number.isFinite(rowCount) || rowCount <= 0) return [];

  const values = detSh.getRange(startRow, 1, rowCount, detLastCol).getValues();

  const out = [];
  const kIdx = detHeaders.indexOf("key");
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (kIdx >= 0 && String(row[kIdx] || "") !== String(key)) continue;
    if (row.every((v) => String(v ?? "").trim() === "")) continue;

    const obj = {};
    for (let c = 0; c < detHeaders.length; c++) obj[detHeaders[c]] = row[c];
    out.push(obj);
  }
  return out;
}

function normalizeTechNo_(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/\d+/);
  if (!m) return "";
  const n = parseInt(m[0], 10);
  if (Number.isNaN(n)) return "";
  return String(n).padStart(2, "0");
}

function sheetSummaryName_(techNo) {
  return CONFIG.SHEET_SUMMARY_PREFIX + String(techNo);
}
function sheetDetailName_(techNo) {
  return CONFIG.SHEET_DETAIL_PREFIX + String(techNo);
}
function sheetDetailIndexName_(techNo) {
  return CONFIG.SHEET_DETAIL_INDEX_PREFIX + String(techNo);
}

function parseJson_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : "";
  if (!raw) throw new Error("EMPTY_BODY");
  return JSON.parse(raw);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function formatTs_(d) {
  return Utilities.formatDate(d, CONFIG.TZ, "yyyy/MM/dd HH:mm:ss");
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    return sh;
  }

  const lastCol = Math.max(1, sh.getLastColumn());
  const row1 = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const missing = headers.filter((h) => !row1.includes(h));
  if (missing.length) {
    sh.getRange(1, row1.length + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}

function getOrCreateSheetHeaderOnly_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  return sh;
}

function pickCard_(summary, key) {
  const card = summary && summary[key] ? summary[key] : {};
  return {
    單數: num_(card["單數"]),
    筆數: num_(card["筆數"]),
    數量: num_(card["數量"]),
    金額: num_(card["金額"]),
  };
}

function num_(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Summary Upsert（clientHash 相同 => nochange），使用 TextFinder 快速定位列
function upsertSummaryByKeyFast_(sh, headers, incoming, key) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const keyIdx = headers.indexOf("key");
  const hashIdx = headers.indexOf("clientHash");
  const countIdx = headers.indexOf("updateCount");
  const lastIdx = headers.indexOf("lastUpdatedAt");

  if (keyIdx < 0 || hashIdx < 0 || countIdx < 0 || lastIdx < 0) {
    throw new Error("SUMMARY_HEADERS_INVALID");
  }

  let found = null;
  if (lastRow >= 2) {
    found = sh
      .getRange(2, keyIdx + 1, lastRow - 1, 1)
      .createTextFinder(String(key))
      .matchEntireCell(true)
      .findNext();
  }

  if (found) {
    const r = found.getRow();
    const row = sh.getRange(r, 1, 1, lastCol).getValues()[0];

    const existingHash = String(row[hashIdx] || "");
    const existingCount = Number(row[countIdx] || 0);
    const existingLast = String(row[lastIdx] || "");

    if (existingHash === String(incoming.clientHash)) {
      return { result: "nochange", updateCount: existingCount, lastUpdatedAt: existingLast };
    }

    const newCount = existingCount + 1;
    incoming.updateCount = newCount;

    const newRow = headers.map((h) => (incoming[h] !== undefined ? incoming[h] : ""));
    sh.getRange(r, 1, 1, newRow.length).setValues([newRow]);

    return { result: "updated", updateCount: newCount, lastUpdatedAt: incoming.lastUpdatedAt };
  }

  incoming.updateCount = 1;
  const newRow = headers.map((h) => (incoming[h] !== undefined ? incoming[h] : ""));
  sh.appendRow(newRow);
  return { result: "inserted", updateCount: 1, lastUpdatedAt: incoming.lastUpdatedAt };
}

function cacheKeyReport_(techNo, dateKey) {
  return `report_v1:${techNo}:${dateKey}`;
}
function cacheGetReport_(techNo, dateKey) {
  const c = CacheService.getScriptCache();
  const raw = c.get(cacheKeyReport_(techNo, dateKey));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}
function cacheSetReport_(techNo, dateKey, obj, ttlSec) {
  const c = CacheService.getScriptCache();
  c.put(cacheKeyReport_(techNo, dateKey), JSON.stringify(obj), ttlSec || CONFIG.CACHE_TTL_SEC);
}
function cacheDelReport_(techNo, dateKey) {
  const c = CacheService.getScriptCache();
  c.remove(cacheKeyReport_(techNo, dateKey));
}
