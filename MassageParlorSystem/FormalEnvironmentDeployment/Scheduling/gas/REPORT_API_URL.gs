/**
 * REPORT_API_URL - GAS Web App
 * Upsert Report Receiver (Summary + Detail) + Query API (FINAL)
 *
 * POST  mode=upsertReport_v1
 * GET   mode=getReport_v1&techNo=07&dateKey=yyyy-MM-dd
 * GET   mode=getLatestSummary_v1&techNo=07              ✅ 新增：穩定版最新 Summary
 *
 * ✅ 不改前端介面：mode / 欄位命名維持
 * ✅ 每位師傅獨立 Sheet：
 *   - Summary: Report_Summary_<techNo>
 *   - Detail : Report_Detail_<techNo>
 *   - Index  : Report_DetailIndex_<techNo>
 *
 * ✅ 修正：
 * 1) Header 永遠以程式定義為準（重寫第 1 列）→ 防止欄位錯位
 * 2) nochange 不寫入縮水 cache → GET 命中快取仍有完整資料
 * 3) GET CacheService (TTL 60s)
 *
 * ✅ 新增：
 * 4) getLatestSummary_v1：不靠最後一列，掃 Summary 找最大 lastUpdatedAt（優先）/最大 dateKey（備援）
 */

const CONFIG = {
  TZ: "Asia/Taipei",
  SHEET_SUMMARY_PREFIX: "Report_Summary_",
  SHEET_DETAIL_PREFIX: "Report_Detail_",
  SHEET_DETAIL_INDEX_PREFIX: "Report_DetailIndex_",
  LOCK_WAIT_MS: 1500,
  CACHE_TTL_SEC: 60,

  // ✅ 強烈建議填入 Spreadsheet ID（Google Sheets URL 中 /d/<ID>/）
  SPREADSHEET_ID: "15n-sXYqLPaXn1MyYVu4bshJDt1xb6hYZD3LplPq5ocM",
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
  if (mode === "getReport_v1") return handleGetReport_(e);

  // ✅ 新增：最新 Summary（穩定）
  if (mode === "getLatestSummary_v1") return handleGetLatestSummaryReport_(e);

  return jsonOut_({
    ok: true,
    hint: "POST JSON with mode=upsertReport_v1, or GET with mode=getReport_v1&techNo=07&dateKey=yyyy-MM-dd",
    now: formatTs_(new Date()),
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) return jsonOut_({ ok: false, error: "LOCKED_TRY_LATER" });

  try {
    const payload = parseJson_(e);
    const mode = String(payload.mode || "").trim();
    if (mode !== "upsertReport_v1") return jsonOut_({ ok: false, error: "BAD_MODE", got: mode });

    const source = String(payload.source || "");
    const pageUrl = String(payload.pageUrl || "");
    const pageTitle = String(payload.pageTitle || "");
    const clientTsIso = String(payload.clientTsIso || "");
    const clientHash = String(payload.clientHash || "");
    const techNo = normalizeTechNo_(payload.techNo || "");
    const dateKey = String(payload.dateKey || "").trim() || Utilities.formatDate(new Date(), CONFIG.TZ, "yyyy-MM-dd");
    const summary = payload.summary || {};
    const detail = Array.isArray(payload.detail) ? payload.detail : [];

    if (!techNo) return jsonOut_({ ok: false, error: "MISSING_techNo" });
    if (!clientHash) return jsonOut_({ ok: false, error: "MISSING_clientHash" });
    if (!detail.length) return jsonOut_({ ok: false, error: "EMPTY_DETAIL" });

    const key = `${dateKey}_${techNo}`;
    const ss = openSpreadsheet_();
    const now = formatTs_(new Date());

    // Sheets (header normalized)
    const sumShName = sheetSummaryName_(techNo);
    const sumSh = ensureSheetStrict_(ss, sumShName, SUMMARY_HEADERS);

    const s1 = pickCard_(summary, "排班");
    const s2 = pickCard_(summary, "老點");
    const s3 = pickCard_(summary, "總計");

    const incoming = {
      key,
      dateKey,
      techNo,
      lastUpdatedAt: now,
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

    const upsertRes = upsertSummaryByKey_(sumSh, SUMMARY_HEADERS, incoming, key);

    // ✅ nochange：不要塞縮水 cache（避免 GET 命中快取回空資料）
    if (upsertRes.result === "nochange") {
      cacheDelReport_(techNo, dateKey);
      cacheDelLatestSummary_(techNo); // ✅ 新增：清 latest cache
      return jsonOut_({
        ok: true,
        result: "nochange",
        key,
        dateKey,
        techNo,
        lastUpdatedAt: upsertRes.lastUpdatedAt,
        updateCount: upsertRes.updateCount,
      });
    }

    // Detail + Index
    const detShName = sheetDetailName_(techNo);
    const idxShName = sheetDetailIndexName_(techNo);
    const detSh = ensureSheetStrict_(ss, detShName, DETAIL_HEADERS);
    const idxSh = ensureSheetStrict_(ss, idxShName, DETAIL_INDEX_HEADERS);

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

    const writeRes = upsertDetailByIndex_(detSh, idxSh, {
      key,
      dateKey,
      techNo,
      now,
      clientHash,
      rows,
    });

    cacheDelReport_(techNo, dateKey);
    cacheDelLatestSummary_(techNo); // ✅ 新增：清 latest cache

    return jsonOut_({
      ok: true,
      result: upsertRes.result,
      key,
      dateKey,
      techNo,
      lastUpdatedAt: now,
      updateCount: upsertRes.updateCount,
      detailReplaced: rows.length,
      detailWrite: writeRes,
      sheets: { summary: sumShName, detail: detShName, detailIndex: idxShName },
    });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.stack ? err.stack : err) });
  } finally {
    lock.releaseLock();
  }
}

function handleGetReport_(e) {
  try {
    const techNo = normalizeTechNo_((e && e.parameter && e.parameter.techNo) || "");
    const dateKey = String((e && e.parameter && e.parameter.dateKey) || "").trim() || Utilities.formatDate(new Date(), CONFIG.TZ, "yyyy-MM-dd");
    if (!techNo) return jsonOut_({ ok: false, error: "MISSING_techNo" });

    const cached = cacheGetReport_(techNo, dateKey);
    if (cached) return jsonOut_(cached);

    const key = `${dateKey}_${techNo}`;
    const ss = openSpreadsheet_();

    const sumSh = ensureSheetStrict_(ss, sheetSummaryName_(techNo), SUMMARY_HEADERS);
    const detSh = ensureSheetStrict_(ss, sheetDetailName_(techNo), DETAIL_HEADERS);
    const idxSh = ensureSheetStrict_(ss, sheetDetailIndexName_(techNo), DETAIL_INDEX_HEADERS);

    const summary = findRowObjectByKey_(sumSh, "key", key);
    const detail = findDetailObjectsByKeyViaIndex_(detSh, idxSh, key);

    const out = {
      ok: true,
      result: "ok",
      key,
      dateKey,
      techNo,
      lastUpdatedAt: summary ? String(summary.lastUpdatedAt || "") : "",
      updateCount: summary ? Number(summary.updateCount || 0) : 0,
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

/* =========================
 * ✅ NEW: Latest Summary (STABLE)
 * mode=getLatestSummary_v1&techNo=07
 * - 不靠最後一列
 * - 最大 lastUpdatedAt（優先）/最大 dateKey（備援）
 * - 全用 getDisplayValues()
 * ========================= */

function handleGetLatestSummaryReport_(e) {
  try {
    const techNo = normalizeTechNo_((e && e.parameter && e.parameter.techNo) || "");
    if (!techNo) return jsonOut_({ ok: false, error: "MISSING_techNo" });

    const cacheKey = cacheKeyLatestSummary_(techNo);
    const cached = cacheGetJson_(cacheKey);
    if (cached) return jsonOut_(cached);

    const ss = openSpreadsheet_();
    const sh = ensureSheetStrict_(ss, sheetSummaryName_(techNo), SUMMARY_HEADERS);
    const lastRow = sh.getLastRow();

    if (lastRow < 2) {
      const outEmpty = {
        ok: true,
        result: "empty",
        source: "REPORT",
        techNo,
        lastUpdatedAt: "",
        dateKey: "",
        summaryRow: null,
        cachedAt: formatTs_(new Date()),
      };
      cacheSetJson_(cacheKey, outEmpty, CONFIG.CACHE_TTL_SEC);
      return jsonOut_(outEmpty);
    }

    const headers = getHeaderRow_(sh);
    const idxLast = headers.indexOf("lastUpdatedAt");
    const idxDate = headers.indexOf("dateKey");
    if (idxLast < 0 && idxDate < 0) throw new Error("SUMMARY_HEADERS_MISSING_lastUpdatedAt_or_dateKey");

    const values = sh.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues();

    let bestRow = null;
    let bestLastMs = -1;
    let bestDateKey = "";

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (row.every((v) => String(v ?? "").trim() === "")) continue;

      const lastStr = idxLast >= 0 ? String(row[idxLast] || "").trim() : "";
      const lastMs = parseTpeTsToMs_(lastStr);

      const dateKey = idxDate >= 0 ? normalizeYmdKey_(row[idxDate]) : "";
      const usableDateKey = dateKey || "";

      if (lastMs > bestLastMs) {
        bestLastMs = lastMs;
        bestDateKey = usableDateKey;
        bestRow = row;
        continue;
      }

      if (bestLastMs <= 0 && lastMs <= 0) {
        if (usableDateKey && usableDateKey > bestDateKey) {
          bestDateKey = usableDateKey;
          bestRow = row;
        }
      }
    }

    if (!bestRow) {
      const outEmpty2 = {
        ok: true,
        result: "empty",
        source: "REPORT",
        techNo,
        lastUpdatedAt: "",
        dateKey: "",
        summaryRow: null,
        cachedAt: formatTs_(new Date()),
      };
      cacheSetJson_(cacheKey, outEmpty2, CONFIG.CACHE_TTL_SEC);
      return jsonOut_(outEmpty2);
    }

    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = bestRow[c];

    const out = {
      ok: true,
      result: "ok",
      source: "REPORT",
      techNo,
      lastUpdatedAt: String(obj.lastUpdatedAt || ""),
      dateKey: String(obj.dateKey || ""),
      summaryRow: obj,
      cachedAt: formatTs_(new Date()),
    };

    cacheSetJson_(cacheKey, out, CONFIG.CACHE_TTL_SEC);
    return jsonOut_(out);
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.stack ? err.stack : err) });
  }
}

/* =========================
 * Detail index upsert / query
 * ========================= */

function upsertDetailByIndex_(detSh, idxSh, input) {
  const { key, dateKey, techNo, now, clientHash, rows } = input;
  const headers = getHeaderRow_(idxSh);
  const keyIdx = headers.indexOf("key");
  const startIdx = headers.indexOf("startRow");
  const countIdx = headers.indexOf("rowCount");
  const lastIdx = headers.indexOf("lastUpdatedAt");
  const hashIdx = headers.indexOf("clientHash");
  const dateIdx = headers.indexOf("dateKey");
  const techIdx = headers.indexOf("techNo");

  if (keyIdx < 0 || startIdx < 0 || countIdx < 0) throw new Error("DETAIL_INDEX_HEADERS_INVALID");

  const foundCell = findKeyCell_(idxSh, keyIdx + 1, key);
  const newCount = rows.length;

  // 既有 index
  if (foundCell) {
    const r = foundCell.getRow();
    const rowVals = idxSh.getRange(r, 1, 1, headers.length).getValues()[0];

    const oldStart = parseInt(rowVals[startIdx], 10);
    const oldCount = parseInt(rowVals[countIdx], 10);

    // 夠大：覆蓋同區塊（最快，不膨脹）
    if (Number.isFinite(oldStart) && oldStart > 1 && Number.isFinite(oldCount) && oldCount >= newCount) {
      const width = DETAIL_HEADERS.length;
      detSh.getRange(oldStart, 1, oldCount, width).clearContent();
      detSh.getRange(oldStart, 1, newCount, width).setValues(rows);

      rowVals[keyIdx] = key;
      if (dateIdx >= 0) rowVals[dateIdx] = dateKey;
      if (techIdx >= 0) rowVals[techIdx] = techNo;
      rowVals[startIdx] = oldStart;
      rowVals[countIdx] = newCount;
      if (lastIdx >= 0) rowVals[lastIdx] = now;
      if (hashIdx >= 0) rowVals[hashIdx] = clientHash;

      idxSh.getRange(r, 1, 1, headers.length).setValues([rowVals]);
      return { mode: "overwrite", startRow: oldStart, rowCount: newCount };
    }

    // 不夠大：append 新區塊並更新 index（會膨脹，但避免慢刪列）
    const startRow = detSh.getLastRow() + 1;
    detSh.getRange(startRow, 1, newCount, DETAIL_HEADERS.length).setValues(rows);

    rowVals[keyIdx] = key;
    if (dateIdx >= 0) rowVals[dateIdx] = dateKey;
    if (techIdx >= 0) rowVals[techIdx] = techNo;
    rowVals[startIdx] = startRow;
    rowVals[countIdx] = newCount;
    if (lastIdx >= 0) rowVals[lastIdx] = now;
    if (hashIdx >= 0) rowVals[hashIdx] = clientHash;

    idxSh.getRange(r, 1, 1, headers.length).setValues([rowVals]);
    return { mode: "append_reindex", startRow, rowCount: newCount };
  }

  // 新 key：append
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
  idxSh.appendRow(DETAIL_INDEX_HEADERS.map((h) => (idxObj[h] !== undefined ? idxObj[h] : "")));
  return { mode: "append_new", startRow, rowCount: newCount };
}

function findDetailObjectsByKeyViaIndex_(detSh, idxSh, key) {
  if (detSh.getLastRow() < 2) return [];
  if (idxSh.getLastRow() < 2) return [];

  const detHeaders = getHeaderRow_(detSh);
  const idxHeaders = getHeaderRow_(idxSh);

  const keyIdx = idxHeaders.indexOf("key");
  const startIdx = idxHeaders.indexOf("startRow");
  const countIdx = idxHeaders.indexOf("rowCount");
  if (keyIdx < 0 || startIdx < 0 || countIdx < 0) return [];

  const found = findKeyCell_(idxSh, keyIdx + 1, key);
  if (!found) return [];

  const r = found.getRow();
  const idxRow = idxSh.getRange(r, 1, 1, idxHeaders.length).getValues()[0];
  const startRow = parseInt(idxRow[startIdx], 10);
  const rowCount = parseInt(idxRow[countIdx], 10);
  if (!Number.isFinite(startRow) || startRow < 2) return [];
  if (!Number.isFinite(rowCount) || rowCount <= 0) return [];

  const values = detSh.getRange(startRow, 1, rowCount, detHeaders.length).getValues();
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

/* =========================
 * Summary upsert / query
 * ========================= */

function upsertSummaryByKey_(sh, headers, incoming, key) {
  const keyIdx = headers.indexOf("key");
  const hashIdx = headers.indexOf("clientHash");
  const countIdx = headers.indexOf("updateCount");
  const lastIdx = headers.indexOf("lastUpdatedAt");
  if (keyIdx < 0 || hashIdx < 0 || countIdx < 0 || lastIdx < 0) throw new Error("SUMMARY_HEADERS_INVALID");

  const found = findKeyCell_(sh, keyIdx + 1, key);
  const lastCol = headers.length;

  if (found) {
    const r = found.getRow();
    const row = sh.getRange(r, 1, 1, lastCol).getValues()[0];

    const existingHash = String(row[hashIdx] || "");
    const existingCount = Number(row[countIdx] || 0) || 0;
    const existingLast = String(row[lastIdx] || "");

    if (existingHash === String(incoming.clientHash)) {
      return { result: "nochange", updateCount: existingCount, lastUpdatedAt: existingLast };
    }

    incoming.updateCount = existingCount + 1;
    const newRow = headers.map((h) => (incoming[h] !== undefined ? incoming[h] : ""));
    sh.getRange(r, 1, 1, lastCol).setValues([newRow]);
    return { result: "updated", updateCount: incoming.updateCount, lastUpdatedAt: incoming.lastUpdatedAt };
  }

  incoming.updateCount = 1;
  const newRow = headers.map((h) => (incoming[h] !== undefined ? incoming[h] : ""));
  sh.appendRow(newRow);
  return { result: "inserted", updateCount: 1, lastUpdatedAt: incoming.lastUpdatedAt };
}

function findRowObjectByKey_(sh, keyHeaderName, key) {
  if (sh.getLastRow() < 2) return null;

  const headers = getHeaderRow_(sh);
  const keyIdx = headers.indexOf(String(keyHeaderName));
  if (keyIdx < 0) return null;

  const found = findKeyCell_(sh, keyIdx + 1, key);
  if (!found) return null;

  const r = found.getRow();
  const row = sh.getRange(r, 1, 1, headers.length).getValues()[0];
  const obj = {};
  for (let c = 0; c < headers.length; c++) obj[headers[c]] = row[c];
  return obj;
}

/* =========================
 * Sheet / header utilities (STRICT)
 * ========================= */

function ensureSheetStrict_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  // 確保至少有 headers.length 欄
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }

  // 第 1 列永遠重寫成 headers（避免任何錯位）
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);

  // 若 sheet 完全空（沒有資料列），確保有 header 即可
  return sh;
}

function getHeaderRow_(sh) {
  const lastCol = Math.max(1, sh.getLastColumn(), sh.getMaxColumns());
  const row = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  // 只取到第一個空欄前（避免 maxColumns 很大）
  let end = row.length;
  for (let i = 0; i < row.length; i++) {
    if (!String(row[i] || "").trim()) {
      end = i;
      break;
    }
  }
  return row.slice(0, Math.max(1, end));
}

function findKeyCell_(sh, keyCol, key) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  return sh
    .getRange(2, keyCol, lastRow - 1, 1)
    .createTextFinder(String(key))
    .matchEntireCell(true)
    .findNext();
}

/* =========================
 * Naming / parsing / misc
 * ========================= */

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

/* =========================
 * Cache
 * ========================= */

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

/* =========================
 * ✅ NEW: Cache for latest summary
 * ========================= */

function cacheKeyLatestSummary_(techNo) {
  return `report_latest_summary_v1:${techNo}`;
}
function cacheDelLatestSummary_(techNo) {
  const c = CacheService.getScriptCache();
  c.remove(cacheKeyLatestSummary_(techNo));
}
function cacheGetJson_(key) {
  const c = CacheService.getScriptCache();
  const raw = c.get(String(key));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function cacheSetJson_(key, obj, ttlSec) {
  const c = CacheService.getScriptCache();
  c.put(String(key), JSON.stringify(obj), Number(ttlSec) || CONFIG.CACHE_TTL_SEC);
}

/* =========================
 * ✅ NEW: timestamp/date helpers
 * ========================= */

function parseTpeTsToMs_(s) {
  const v = String(s || "").trim();
  const m = v.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function normalizeYmdKey_(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!m) return "";
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

/* =========================
 * Spreadsheet open
 * ========================= */

function openSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("MISSING_SPREADSHEET: set CONFIG.SPREADSHEET_ID or use container-bound script");
  return ss;
}
