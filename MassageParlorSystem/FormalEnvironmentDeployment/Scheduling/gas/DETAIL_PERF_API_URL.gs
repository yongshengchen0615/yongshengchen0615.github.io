/**
 * DETAIL_PERF_API_URL - GAS Web App
 * P_DETAIL Performance Receiver + Query API (INTEGRATED: rangeKey + startKey/endKey)
 *
 * POST  mode=upsertDetailPerf_v1               (維持不變：仍以 rangeKey + techNo 存檔)
 *
 * GET   mode=getDetailPerf_v1&techNo=07&rangeKey=2026-01-01~2026-01-11           (舊介面相容)
 * GET   mode=getDetailPerf_v1&techNo=07&startKey=2026-01-01&endKey=2026-01-11    (新介面：前端改用這個)
 * GET   mode=getLatestSummary_v1&techNo=07                                     ✅ 新增：穩定版最新 Summary
 *
 * ✅ 整合重點
 * - 新介面 startKey/endKey：掃 Index 找重疊 blocks → 合併 rows → 去重 → 訂單日期裁切
 * - legacy rangeKey：精準命中 key 取回整包
 *
 * ✅ 日期安全
 * - Detail/Summary 讀取一律使用 getDisplayValues()，避免 Date 物件 + timezone 漂移
 * - 訂單日期解析只抓 YYYY-MM-DD / YYYY/MM/DD，不做時區換算
 *
 * ✅ 新增：
 * - getLatestSummary_v1：不靠最後一列，掃 Summary 找最大 lastUpdatedAt（優先）/最大 rangeKey endKey（備援）
 */

const CONFIG = {
  TZ: "Asia/Taipei",
  SHEET_SUMMARY_PREFIX: "DetailPerf_Summary_",
  SHEET_DETAIL_PREFIX: "DetailPerf_Rows_",
  SHEET_INDEX_PREFIX: "DetailPerf_Index_",
  LOCK_WAIT_MS: 1500,
  CACHE_TTL_SEC: 60,

  SPREADSHEET_ID: "1vwZMyHVldysvOphFbMoKnWVkVWc3n43Cuqm2WN77-fk",

  INDEX_SCAN_MAX: 5000,
  MAX_RETURN_ROWS: 6000,
};

const SUMMARY_HEADERS = [
  "key",
  "rangeKey",
  "techNo",
  "lastUpdatedAt",
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
  "rangeKey",
  "techNo",
  "lastUpdatedAt",
  "source",
  "pageUrl",
  "clientTsIso",
  "clientHash",
  "訂單日期",
  "訂單編號",
  "序",
  "拉牌",
  "服務項目",
  "業績金額",
  "抽成金額",
  "數量",
  "小計",
  "分鐘",
  "開工",
  "完工",
  "狀態",
];

const INDEX_HEADERS = ["key", "rangeKey", "techNo", "startRow", "rowCount", "lastUpdatedAt", "clientHash"];

/* =========================
 * Entry
 * ========================= */

function doGet(e) {
  const mode = String((e && e.parameter && e.parameter.mode) || "").trim();
  if (mode === "getDetailPerf_v1") return handleGetDetailPerf_(e);

  // ✅ 新增：最新 Summary（穩定）
  if (mode === "getLatestSummary_v1") return handleGetLatestSummaryDetailPerf_(e);

  return jsonOut_({
    ok: true,
    hint:
      "POST JSON mode=upsertDetailPerf_v1, or GET mode=getDetailPerf_v1&techNo=07&startKey=2026-01-01&endKey=2026-01-11 (or legacy &rangeKey=2026-01-01~2026-01-11)",
    now: formatTs_(new Date()),
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) return jsonOut_({ ok: false, error: "LOCKED_TRY_LATER" });

  try {
    const payload = parseJson_(e);
    const mode = String(payload.mode || "").trim();
    if (mode !== "upsertDetailPerf_v1") return jsonOut_({ ok: false, error: "BAD_MODE", got: mode });

    const source = String(payload.source || "");
    const pageUrl = String(payload.pageUrl || "");
    const pageTitle = String(payload.pageTitle || "");
    const clientTsIso = String(payload.clientTsIso || "");
    const clientHash = String(payload.clientHash || "");
    const techNo = normalizeTechNo_(payload.techNo || "");
    const rangeKey = normalizeRangeKey_(payload.rangeKey || "");
    const summary = payload.summary || {};
    const detail = Array.isArray(payload.detail) ? payload.detail : [];

    if (!techNo) return jsonOut_({ ok: false, error: "MISSING_techNo" });
    if (!rangeKey) return jsonOut_({ ok: false, error: "MISSING_rangeKey" });
    if (!clientHash) return jsonOut_({ ok: false, error: "MISSING_clientHash" });
    if (!detail.length) return jsonOut_({ ok: false, error: "EMPTY_DETAIL" });

    const key = `${rangeKey}_${techNo}`;
    const ss = openSpreadsheet_();
    const now = formatTs_(new Date());

    const sumShName = sheetSummaryName_(techNo);
    const sumSh = ensureSheetStrict_(ss, sumShName, SUMMARY_HEADERS);

    const s1 = pickCard_(summary, "排班");
    const s2 = pickCard_(summary, "老點");
    const s3 = pickCard_(summary, "總計");

    const incoming = {
      key,
      rangeKey,
      techNo,
      lastUpdatedAt: now,
      updateCount: 0,
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

    // ✅ nochange：不要 cache 縮水 payload
    if (upsertRes.result === "nochange") {
      cacheDel_(techNo, rangeKey);
      const se = rangeKeyToStartEnd_(rangeKey);
      cacheDelRange_(techNo, se);
      cacheDelLatestSummary_(techNo); // ✅ 新增：清 latest cache
      return jsonOut_({
        ok: true,
        result: "nochange",
        key,
        rangeKey,
        techNo,
        lastUpdatedAt: upsertRes.lastUpdatedAt,
        updateCount: upsertRes.updateCount,
      });
    }

    const detShName = sheetDetailName_(techNo);
    const idxShName = sheetIndexName_(techNo);
    const detSh = ensureSheetStrict_(ss, detShName, DETAIL_HEADERS);
    const idxSh = ensureSheetStrict_(ss, idxShName, INDEX_HEADERS);

    // ✅ 文字格式鎖住避免被轉 Date
    enforceTextCols_(detSh, DETAIL_HEADERS, ["訂單日期", "開工", "完工"]);

    const rows = detail.map((r) => [
      key,
      rangeKey,
      techNo,
      now,
      source,
      pageUrl,
      clientTsIso,
      clientHash,

      String(r["訂單日期"] || ""),
      String(r["訂單編號"] || ""),
      num_(r["序"]),
      String(r["拉牌"] || ""),
      String(r["服務項目"] || ""),
      num_(r["業績金額"]),
      num_(r["抽成金額"]),
      num_(r["數量"]),
      num_(r["小計"]),
      num_(r["分鐘"]),
      String(r["開工"] || ""),
      String(r["完工"] || ""),
      String(r["狀態"] || ""),
    ]);

    const writeRes = upsertDetailByIndex_(detSh, idxSh, { key, rangeKey, techNo, now, clientHash, rows });

    // ✅ 清快取
    cacheDel_(techNo, rangeKey);
    cacheDelRange_(techNo, rangeKeyToStartEnd_(rangeKey));
    cacheDelLatestSummary_(techNo); // ✅ 新增：清 latest cache

    return jsonOut_({
      ok: true,
      result: upsertRes.result,
      key,
      rangeKey,
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

/* =========================
 * ✅ NEW: Latest Summary (STABLE)
 * mode=getLatestSummary_v1&techNo=07
 * - 不靠最後一列
 * - 最大 lastUpdatedAt（優先）/最大 rangeKey endKey（備援）
 * - 全用 getDisplayValues()
 * ========================= */

function handleGetLatestSummaryDetailPerf_(e) {
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
        source: "DETAIL_PERF",
        techNo,
        lastUpdatedAt: "",
        rangeKey: "",
        summaryRow: null,
        cachedAt: formatTs_(new Date()),
      };
      cacheSetJson_(cacheKey, outEmpty, CONFIG.CACHE_TTL_SEC);
      return jsonOut_(outEmpty);
    }

    const headers = getHeaderRow_(sh);
    const idxLast = headers.indexOf("lastUpdatedAt");
    const idxRange = headers.indexOf("rangeKey");
    if (idxLast < 0 && idxRange < 0) throw new Error("SUMMARY_HEADERS_MISSING_lastUpdatedAt_or_rangeKey");

    const values = sh.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues();

    let bestRow = null;
    let bestLastMs = -1;
    let bestEndKey = "";

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (row.every((v) => String(v ?? "").trim() === "")) continue;

      const lastStr = idxLast >= 0 ? String(row[idxLast] || "").trim() : "";
      const lastMs = parseTpeTsToMs_(lastStr);

      const rangeKey = idxRange >= 0 ? normalizeRangeKey_(row[idxRange]) : "";
      const endKey = rangeKey ? rangeKeyEndKey_(rangeKey) : "";
      const usableEndKey = endKey || "";

      if (lastMs > bestLastMs) {
        bestLastMs = lastMs;
        bestEndKey = usableEndKey;
        bestRow = row;
        continue;
      }

      if (bestLastMs <= 0 && lastMs <= 0) {
        if (usableEndKey && usableEndKey > bestEndKey) {
          bestEndKey = usableEndKey;
          bestRow = row;
        }
      }
    }

    if (!bestRow) {
      const outEmpty2 = {
        ok: true,
        result: "empty",
        source: "DETAIL_PERF",
        techNo,
        lastUpdatedAt: "",
        rangeKey: "",
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
      source: "DETAIL_PERF",
      techNo,
      lastUpdatedAt: String(obj.lastUpdatedAt || ""),
      rangeKey: String(obj.rangeKey || ""),
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
 * GET - Integrated
 * ========================= */

function handleGetDetailPerf_(e) {
  try {
    const techNo = normalizeTechNo_((e && e.parameter && e.parameter.techNo) || "");
    if (!techNo) return jsonOut_({ ok: false, error: "MISSING_techNo" });

    const rawStartKey = String((e && e.parameter && e.parameter.startKey) || "").trim();
    const rawEndKey = String((e && e.parameter && e.parameter.endKey) || "").trim();
    const rawRangeKey = String((e && e.parameter && e.parameter.rangeKey) || "").trim();

    // ✅ 修正：start/end 優先（避免 rangeKey 搶先導致 miss）
    if (rawStartKey || rawEndKey) {
      const startKey = normalizeDateKey_(rawStartKey);
      const endKey = normalizeDateKey_(rawEndKey || rawStartKey);
      if (!startKey) return jsonOut_({ ok: false, error: "MISSING_startKey" });
      if (!endKey) return jsonOut_({ ok: false, error: "MISSING_endKey" });

      const se = normalizeStartEnd_(startKey, endKey);
      const qStart = se.startKey;
      const qEnd = se.endKey;
      const queryRangeKey = `${qStart}~${qEnd}`;

      const cachedRange = cacheGetRange_(techNo, qStart, qEnd);
      if (cachedRange) return jsonOut_(cachedRange);

      const ss = openSpreadsheet_();
      const sumSh = ensureSheetStrict_(ss, sheetSummaryName_(techNo), SUMMARY_HEADERS);
      const detSh = ensureSheetStrict_(ss, sheetDetailName_(techNo), DETAIL_HEADERS);
      const idxSh = ensureSheetStrict_(ss, sheetIndexName_(techNo), INDEX_HEADERS);

      const blocks = scanIndexOverlappingBlocks_Display_(idxSh, qStart, qEnd);

      if (!blocks.length) {
        const outEmpty = {
          ok: true,
          result: "ok",
          key: "",
          rangeKey: queryRangeKey,
          techNo,
          startKey: qStart,
          endKey: qEnd,
          lastUpdatedAt: "",
          updateCount: 0,
          summaryRow: null,
          detailRows: [],
          blocksHit: 0,
          cachedAt: formatTs_(new Date()),
        };
        cacheSetRange_(techNo, qStart, qEnd, outEmpty, CONFIG.CACHE_TTL_SEC);
        return jsonOut_(outEmpty);
      }

      const merged = mergeDetailRowsFromBlocks_Display_(detSh, blocks);
      const deduped = dedupeDetailRows_(merged);
      const filtered = filterRowsByOrderDateRange_(deduped, qStart, qEnd);

      const pickedSummaryKey = pickBestSummaryKeyFromBlocks_(blocks, qStart, qEnd);
      const summaryRow = pickedSummaryKey ? findRowObjectByKey_Display_(sumSh, "key", pickedSummaryKey) : null;

      const out = {
        ok: true,
        result: "ok",
        key: pickedSummaryKey || "",
        rangeKey: queryRangeKey,
        techNo,
        startKey: qStart,
        endKey: qEnd,
        lastUpdatedAt: summaryRow ? String(summaryRow.lastUpdatedAt || "") : "",
        updateCount: summaryRow ? Number(summaryRow.updateCount || 0) : 0,
        summaryRow,
        detailRows: limited_(filtered, CONFIG.MAX_RETURN_ROWS),
        blocksHit: blocks.length,
        blocks: blocks.map((b) => ({ key: b.key, rangeKey: b.rangeKey, startRow: b.startRow, rowCount: b.rowCount })),
        cachedAt: formatTs_(new Date()),
      };

      cacheSetRange_(techNo, qStart, qEnd, out, CONFIG.CACHE_TTL_SEC);
      return jsonOut_(out);
    }

    // ---- legacy: rangeKey ----
    if (rawRangeKey) {
      const rangeKey = normalizeRangeKey_(rawRangeKey);
      if (!rangeKey) return jsonOut_({ ok: false, error: "MISSING_rangeKey" });

      const cached = cacheGet_(techNo, rangeKey);
      if (cached) return jsonOut_(cached);

      const key = `${rangeKey}_${techNo}`;
      const ss = openSpreadsheet_();

      const sumSh = ensureSheetStrict_(ss, sheetSummaryName_(techNo), SUMMARY_HEADERS);
      const detSh = ensureSheetStrict_(ss, sheetDetailName_(techNo), DETAIL_HEADERS);
      const idxSh = ensureSheetStrict_(ss, sheetIndexName_(techNo), INDEX_HEADERS);

      const summary = findRowObjectByKey_Display_(sumSh, "key", key);
      const detail = findDetailObjectsByKeyViaIndex_Display_(detSh, idxSh, key);

      const out = {
        ok: true,
        result: "ok",
        key,
        rangeKey,
        techNo,
        lastUpdatedAt: summary ? String(summary.lastUpdatedAt || "") : "",
        updateCount: summary ? Number(summary.updateCount || 0) : 0,
        summaryRow: summary,
        detailRows: detail,
        sheets: {
          summary: sheetSummaryName_(techNo),
          detail: sheetDetailName_(techNo),
          detailIndex: sheetIndexName_(techNo),
        },
        cachedAt: formatTs_(new Date()),
      };

      cacheSet_(techNo, rangeKey, out, CONFIG.CACHE_TTL_SEC);
      return jsonOut_(out);
    }

    return jsonOut_({ ok: false, error: "MISSING_rangeKey_or_startKey" });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.stack ? err.stack : err) });
  }
}

/* =========================
 * Index scan / merge (Display)
 * ========================= */

function scanIndexOverlappingBlocks_Display_(idxSh, qStart, qEnd) {
  const lastRow = idxSh.getLastRow();
  if (lastRow < 2) return [];

  const headers = getHeaderRow_(idxSh);
  const keyIdx = headers.indexOf("key");
  const rangeIdx = headers.indexOf("rangeKey");
  const startRowIdx = headers.indexOf("startRow");
  const rowCountIdx = headers.indexOf("rowCount");
  if (keyIdx < 0 || rangeIdx < 0 || startRowIdx < 0 || rowCountIdx < 0) return [];

  const n = Math.min(CONFIG.INDEX_SCAN_MAX, lastRow - 1);
  const values = idxSh.getRange(2, 1, n, headers.length).getDisplayValues();

  const blocks = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const key = String(row[keyIdx] || "").trim();
    const rangeKey = normalizeRangeKey_(row[rangeIdx] || "");
    const startRow = parseInt(String(row[startRowIdx] || ""), 10);
    const rowCount = parseInt(String(row[rowCountIdx] || ""), 10);

    if (!key || !rangeKey) continue;
    if (!Number.isFinite(startRow) || startRow < 2) continue;
    if (!Number.isFinite(rowCount) || rowCount <= 0) continue;

    const se = rangeKeyToStartEnd_(rangeKey);
    if (!se) continue;

    if (rangesOverlap_(qStart, qEnd, se.startKey, se.endKey)) {
      blocks.push({ key, rangeKey, startKey: se.startKey, endKey: se.endKey, startRow, rowCount });
    }
  }

  blocks.sort((a, b) => (a.startKey + a.endKey).localeCompare(b.startKey + b.endKey));
  return blocks;
}

function mergeDetailRowsFromBlocks_Display_(detSh, blocks) {
  if (!detSh || !blocks || !blocks.length) return [];
  const detHeaders = getHeaderRow_(detSh);
  const kIdx = detHeaders.indexOf("key");
  if (kIdx < 0) return [];

  const out = [];
  for (const b of blocks) {
    const values = detSh.getRange(b.startRow, 1, b.rowCount, detHeaders.length).getDisplayValues();
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (String(row[kIdx] || "") !== String(b.key)) continue;
      if (row.every((v) => String(v ?? "").trim() === "")) continue;

      const obj = {};
      for (let c = 0; c < detHeaders.length; c++) obj[detHeaders[c]] = row[c];
      out.push(obj);
    }
  }
  return out;
}

/* =========================
 * Detail filter / dedupe
 * ========================= */

function orderDateKeyFromAny_(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

function filterRowsByOrderDateRange_(rows, qStart, qEnd) {
  const out = [];
  for (const r of rows) {
    const dk = orderDateKeyFromAny_(r && r["訂單日期"]);
    if (!dk) {
      out.push(r);
      continue;
    }
    if (dk >= qStart && dk <= qEnd) out.push(r);
  }
  return out;
}

function dedupeDetailRows_(rows) {
  const seen = {};
  const out = [];
  for (const r of rows) {
    const k = [
      orderDateKeyFromAny_(r && r["訂單日期"]),
      String(r && r["訂單編號"] ? r["訂單編號"] : ""),
      String(r && r["序"] !== undefined ? r["序"] : ""),
      String(r && r["服務項目"] ? r["服務項目"] : ""),
      String(r && r["小計"] !== undefined ? r["小計"] : ""),
    ].join("|");

    if (seen[k]) continue;
    seen[k] = true;
    out.push(r);
  }
  return out;
}

function limited_(arr, maxN) {
  const n = Number(maxN) || 0;
  if (!n || n <= 0) return arr;
  return arr.length <= n ? arr : arr.slice(0, n);
}

/* =========================
 * Pick summary (best superset)
 * ========================= */

function pickBestSummaryKeyFromBlocks_(blocks, qStart, qEnd) {
  const supers = [];
  for (const b of blocks) {
    if (b.startKey <= qStart && b.endKey >= qEnd) supers.push(b);
  }
  if (!supers.length) return "";

  supers.sort((a, b) => dateDiffDays_(a.startKey, a.endKey) - dateDiffDays_(b.startKey, b.endKey));
  return supers[0].key;
}

/* =========================
 * Detail index upsert / query (rangeKey)
 * ========================= */

function upsertDetailByIndex_(detSh, idxSh, input) {
  const { key, rangeKey, techNo, now, clientHash, rows } = input;

  const headers = getHeaderRow_(idxSh);
  const keyIdx = headers.indexOf("key");
  const startIdx = headers.indexOf("startRow");
  const countIdx = headers.indexOf("rowCount");
  const lastIdx = headers.indexOf("lastUpdatedAt");
  const hashIdx = headers.indexOf("clientHash");
  const rangeIdx = headers.indexOf("rangeKey");
  const techIdx = headers.indexOf("techNo");

  if (keyIdx < 0 || startIdx < 0 || countIdx < 0) throw new Error("INDEX_HEADERS_INVALID");

  const foundCell = findKeyCell_(idxSh, keyIdx + 1, key);
  const newCount = rows.length;

  if (foundCell) {
    const r = foundCell.getRow();
    const rowVals = idxSh.getRange(r, 1, 1, headers.length).getValues()[0];

    const oldStart = parseInt(rowVals[startIdx], 10);
    const oldCount = parseInt(rowVals[countIdx], 10);

    if (Number.isFinite(oldStart) && oldStart > 1 && Number.isFinite(oldCount) && oldCount >= newCount) {
      detSh.getRange(oldStart, 1, oldCount, DETAIL_HEADERS.length).clearContent();
      detSh.getRange(oldStart, 1, newCount, DETAIL_HEADERS.length).setValues(rows);

      rowVals[keyIdx] = key;
      if (rangeIdx >= 0) rowVals[rangeIdx] = rangeKey;
      if (techIdx >= 0) rowVals[techIdx] = techNo;
      rowVals[startIdx] = oldStart;
      rowVals[countIdx] = newCount;
      if (lastIdx >= 0) rowVals[lastIdx] = now;
      if (hashIdx >= 0) rowVals[hashIdx] = clientHash;

      idxSh.getRange(r, 1, 1, headers.length).setValues([rowVals]);
      return { mode: "overwrite", startRow: oldStart, rowCount: newCount };
    }

    const startRow = detSh.getLastRow() + 1;
    detSh.getRange(startRow, 1, newCount, DETAIL_HEADERS.length).setValues(rows);

    rowVals[keyIdx] = key;
    if (rangeIdx >= 0) rowVals[rangeIdx] = rangeKey;
    if (techIdx >= 0) rowVals[techIdx] = techNo;
    rowVals[startIdx] = startRow;
    rowVals[countIdx] = newCount;
    if (lastIdx >= 0) rowVals[lastIdx] = now;
    if (hashIdx >= 0) rowVals[hashIdx] = clientHash;

    idxSh.getRange(r, 1, 1, headers.length).setValues([rowVals]);
    return { mode: "append_reindex", startRow, rowCount: newCount };
  }

  const startRow = detSh.getLastRow() + 1;
  detSh.getRange(startRow, 1, newCount, DETAIL_HEADERS.length).setValues(rows);

  const idxObj = { key, rangeKey, techNo, startRow, rowCount: newCount, lastUpdatedAt: now, clientHash };
  idxSh.appendRow(INDEX_HEADERS.map((h) => (idxObj[h] !== undefined ? idxObj[h] : "")));
  return { mode: "append_new", startRow, rowCount: newCount };
}

function findDetailObjectsByKeyViaIndex_Display_(detSh, idxSh, key) {
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

  const values = detSh.getRange(startRow, 1, rowCount, detHeaders.length).getDisplayValues();
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

function findRowObjectByKey_Display_(sh, keyHeaderName, key) {
  if (sh.getLastRow() < 2) return null;

  const headers = getHeaderRow_(sh);
  const keyIdx = headers.indexOf(String(keyHeaderName));
  if (keyIdx < 0) return null;

  const found = findKeyCell_(sh, keyIdx + 1, key);
  if (!found) return null;

  const r = found.getRow();
  const row = sh.getRange(r, 1, 1, headers.length).getDisplayValues()[0];
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

  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }

  sh.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (String(name).indexOf(CONFIG.SHEET_DETAIL_PREFIX) === 0) {
    enforceTextCols_(sh, headers, ["訂單日期", "開工", "完工"]);
  }
  return sh;
}

function enforceTextCols_(sh, headers, colNames) {
  const names = Array.isArray(colNames) ? colNames : [];
  if (!names.length) return;

  for (const nm of names) {
    const idx = headers.indexOf(nm);
    if (idx >= 0) {
      sh.getRange(2, idx + 1, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat("@");
    }
  }
}

function getHeaderRow_(sh) {
  const lastCol = Math.max(1, sh.getLastColumn(), sh.getMaxColumns());
  const row = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
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
  return sh.getRange(2, keyCol, lastRow - 1, 1).createTextFinder(String(key)).matchEntireCell(true).findNext();
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

function normalizeDateKey_(d) {
  const s = String(d ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!m) return "";
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

function normalizeRangeKey_(rk) {
  const s = String(rk ?? "").trim();
  if (!s) return "";

  const parts = s.split("~").map((x) => String(x || "").trim());
  if (parts.length !== 2) return s.replace(/\//g, "-");

  const norm = (d) => normalizeDateKey_(d) || String(d || "").replace(/\//g, "-");
  return `${norm(parts[0])}~${norm(parts[1])}`;
}

function rangeKeyToStartEnd_(rangeKey) {
  const rk = normalizeRangeKey_(rangeKey);
  const parts = rk.split("~");
  if (parts.length !== 2) return null;
  const a = normalizeDateKey_(parts[0]);
  const b = normalizeDateKey_(parts[1]);
  if (!a || !b) return null;
  return normalizeStartEnd_(a, b);
}

function normalizeStartEnd_(startKey, endKey) {
  const a = String(startKey || "").trim();
  const b = String(endKey || "").trim();
  if (!a || !b) return { startKey: a, endKey: b };
  if (b < a) return { startKey: b, endKey: a };
  return { startKey: a, endKey: b };
}

function rangesOverlap_(aStart, aEnd, bStart, bEnd) {
  const s = aStart > bStart ? aStart : bStart;
  const e = aEnd < bEnd ? aEnd : bEnd;
  return s <= e;
}

function dateDiffDays_(startKey, endKey) {
  const a = new Date(String(startKey) + "T00:00:00Z");
  const b = new Date(String(endKey) + "T00:00:00Z");
  const ms = b.getTime() - a.getTime();
  if (!Number.isFinite(ms)) return 999999;
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

function sheetSummaryName_(techNo) {
  return CONFIG.SHEET_SUMMARY_PREFIX + String(techNo);
}
function sheetDetailName_(techNo) {
  return CONFIG.SHEET_DETAIL_PREFIX + String(techNo);
}
function sheetIndexName_(techNo) {
  return CONFIG.SHEET_INDEX_PREFIX + String(techNo);
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
 * ✅ NEW helpers for latest summary
 * ========================= */

function parseTpeTsToMs_(s) {
  const v = String(s || "").trim();
  const m = v.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function rangeKeyEndKey_(rangeKey) {
  const rk = normalizeRangeKey_(rangeKey);
  const parts = rk.split("~");
  if (parts.length !== 2) return "";
  return normalizeDateKey_(parts[1]) || "";
}

/* =========================
 * Cache (rangeKey + start/end)
 * ========================= */

function cacheKey_(techNo, rangeKey) {
  return `detailperf_v1:${techNo}:${rangeKey}`;
}
function cacheKeyRange_(techNo, startKey, endKey) {
  return `detailperf_v1_range:${techNo}:${startKey}~${endKey}`;
}

function cacheGet_(techNo, rangeKey) {
  const c = CacheService.getScriptCache();
  const raw = c.get(cacheKey_(techNo, rangeKey));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function cacheSet_(techNo, rangeKey, obj, ttlSec) {
  const c = CacheService.getScriptCache();
  c.put(cacheKey_(techNo, rangeKey), JSON.stringify(obj), ttlSec || CONFIG.CACHE_TTL_SEC);
}
function cacheDel_(techNo, rangeKey) {
  const c = CacheService.getScriptCache();
  c.remove(cacheKey_(techNo, rangeKey));
}

function cacheGetRange_(techNo, startKey, endKey) {
  const c = CacheService.getScriptCache();
  const raw = c.get(cacheKeyRange_(techNo, startKey, endKey));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function cacheSetRange_(techNo, startKey, endKey, obj, ttlSec) {
  const c = CacheService.getScriptCache();
  c.put(cacheKeyRange_(techNo, startKey, endKey), JSON.stringify(obj), ttlSec || CONFIG.CACHE_TTL_SEC);
}
function cacheDelRange_(techNo, se) {
  if (!se || !se.startKey || !se.endKey) return;
  const c = CacheService.getScriptCache();
  c.remove(cacheKeyRange_(techNo, se.startKey, se.endKey));
}

/* =========================
 * ✅ NEW: cache for latest summary
 * ========================= */

function cacheKeyLatestSummary_(techNo) {
  return `detailperf_latest_summary_v1:${techNo}`;
}
function cacheDelLatestSummary_(techNo) {
  const c = CacheService.getScriptCache();
  c.remove(cacheKeyLatestSummary_(techNo));
}
function cacheGetJson_(key) {
  const c = CacheService.getScriptCache();
  const raw = c.get(String(key));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function cacheSetJson_(key, obj, ttlSec) {
  const c = CacheService.getScriptCache();
  c.put(String(key), JSON.stringify(obj), Number(ttlSec) || CONFIG.CACHE_TTL_SEC);
}

/* =========================
 * Spreadsheet open
 * ========================= */

function openSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("MISSING_SPREADSHEET: set CONFIG.SPREADSHEET_ID or use container-bound script");
  return ss;
}

/**
 * GAS Web App - P_DETAIL Performance Receiver + Query API
 *
 * POST  mode=upsertDetailPerf_v1
 * GET   mode=getDetailPerf_v1&techNo=07&rangeKey=2026-01-01~2026-01-11
 *
 * ✅ 每位師傅獨立 Sheet：
 * - Summary: DetailPerf_Summary_<techNo>
 * - Detail : DetailPerf_Rows_<techNo>
 *
 * ✅ 追加效能優化（不改前端）：
 * - DetailIndex: DetailPerf_Index_<techNo>
 *   存 key(rangeKey_techNo) -> startRow/rowCount/clientHash
 * - Upsert detail：優先覆蓋既有區塊（clear+setValues），否則追加並更新 index
 * - GET：CacheService 快取（TTL 60 秒）
 */

const CONFIG = {
  TZ: "Asia/Taipei",
  SHEET_SUMMARY_PREFIX: "DetailPerf_Summary_",
  SHEET_DETAIL_PREFIX: "DetailPerf_Rows_",
  SHEET_INDEX_PREFIX: "DetailPerf_Index_",
  LOCK_WAIT_MS: 1500,
  CACHE_TTL_SEC: 60,
};

const SUMMARY_HEADERS = [
  "key", // rangeKey_techNo
  "rangeKey",
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
  "rangeKey",
  "techNo",
  "lastUpdatedAt",
  "source",
  "pageUrl",
  "clientTsIso",
  "clientHash",

  "訂單日期",
  "訂單編號",
  "序",
  "拉牌",
  "服務項目",
  "業績金額",
  "抽成金額",
  "數量",
  "小計",
  "分鐘",
  "開工",
  "完工",
  "狀態",
];

const INDEX_HEADERS = [
  "key",
  "rangeKey",
  "techNo",
  "startRow",
  "rowCount",
  "lastUpdatedAt",
  "clientHash",
];

function doGet(e) {
  const mode = String((e && e.parameter && e.parameter.mode) || "").trim();

  if (mode === "getDetailPerf_v1") {
    return handleGetDetailPerf_(e);
  }

  return jsonOut_({
    ok: true,
    hint:
      "POST JSON with mode=upsertDetailPerf_v1, or GET mode=getDetailPerf_v1&techNo=07&rangeKey=2026-01-01~2026-01-11",
    now: formatTs_(new Date()),
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) {
    return jsonOut_({ ok: false, error: "LOCKED_TRY_LATER" });
  }

    // 嘗試以寫入後的 detail 重新計算 Summary（保證 Summary 與實際儲存的 detail 一致）
    let recomputedSummary = null;
    try {
      const se = rangeKeyToStartEnd_(rangeKey) || { startKey: "", endKey: "" };
      const block = { key, rangeKey, startRow: writeRes && writeRes.startRow ? writeRes.startRow : null, rowCount: writeRes && writeRes.rowCount ? writeRes.rowCount : rows.length };

      // 如果 writeRes 沒提供 startRow，仍嘗試掃 index 找出對應 block
      let blocksForMerge = [];
      if (block.startRow && block.rowCount) {
        blocksForMerge = [block];
      } else {
        // 從 index 找出這個 key 的記錄（fallback）
        const idxHeaders = getHeaderRow_(idxSh);
        const keyIdx = idxHeaders.indexOf('key');
        const found = findKeyCell_(idxSh, keyIdx + 1, key);
        if (found) {
          const r = found.getRow();
          const idxRow = idxSh.getRange(r, 1, 1, idxHeaders.length).getValues()[0];
          const startIdx = idxHeaders.indexOf('startRow');
          const countIdx = idxHeaders.indexOf('rowCount');
          const s = parseInt(idxRow[startIdx] || 0, 10) || null;
          const c = parseInt(idxRow[countIdx] || 0, 10) || rows.length;
          if (s && s > 1) blocksForMerge = [{ key, rangeKey, startRow: s, rowCount: c }];
        }
      }

      // fallback: if no blocksForMerge found, still try to merge by scanning overlapping blocks
      if (!blocksForMerge.length) {
        const allBlocks = scanIndexOverlappingBlocks_Display_(idxSh, se.startKey, se.endKey);
        blocksForMerge = allBlocks.filter(b => b.key === key);
      }

      const merged = mergeDetailRowsFromBlocks_Display_(detSh, blocksForMerge.length ? blocksForMerge : [{ key, rangeKey, startRow: writeRes && writeRes.startRow ? writeRes.startRow : 0, rowCount: rows.length }]);
      const deduped = dedupeDetailRows_(merged);
      const finalRows = filterRowsByOrderDateRange_(deduped, se.startKey, se.endKey);

      // 計算 summary（採用與前端一致的分類口徑：非老點即為排班；單數定義為筆數）
      const calc = { 排班: { 單數: 0, 筆數: 0, 數量: 0, 金額: 0 }, 老點: { 單數: 0, 筆數: 0, 數量: 0, 金額: 0 }, 總計: { 單數: 0, 筆數: 0, 數量: 0, 金額: 0 } };
      const isOld = function (r) {
        const s = String((r['拉牌'] || '') + ' ' + (r['服務項目'] || '')).toLowerCase();
        return /老|老點|old|vip/.test(s);
      };

      for (const r of finalRows) {
        const qty = num_(r['數量']);
        const amt = num_(r['小計'] !== undefined ? r['小計'] : (r['業績金額'] !== undefined ? r['業績金額'] : 0));
        calc.總計.筆數 += 1; calc.總計.數量 += qty; calc.總計.金額 += amt;
        const cat = isOld(r) ? '老點' : '排班';
        calc[cat].筆數 += 1; calc[cat].數量 += qty; calc[cat].金額 += amt;
      }
      for (const k of ['排班', '老點', '總計']) calc[k].單數 = calc[k].筆數;

      recomputedSummary = calc;

      // 覆寫 Summary sheet（使用 recomputed 值覆蓋剛剛寫入的 incoming）
      const recomputedIncoming = Object.assign({}, incoming, {
        '排班_單數': calc.排班.單數,
        '排班_筆數': calc.排班.筆數,
        '排班_數量': calc.排班.數量,
        '排班_金額': calc.排班.金額,
        '老點_單數': calc.老點.單數,
        '老點_筆數': calc.老點.筆數,
        '老點_數量': calc.老點.數量,
        '老點_金額': calc.老點.金額,
        '總計_單數': calc.總計.單數,
        '總計_筆數': calc.總計.筆數,
        '總計_數量': calc.總計.數量,
        '總計_金額': calc.總計.金額,
      });

      upsertSummaryByKey_(sumSh, SUMMARY_HEADERS, recomputedIncoming, key);
    } catch (e) {
      // 若重算失敗，記錄錯誤並繼續回應原本 upsert 結果
      console.error('recompute summary failed', String(e));
    }

    // 清快取
    cacheDel_(techNo, rangeKey);
    cacheDelRange_(techNo, rangeKeyToStartEnd_(rangeKey));
    cacheDelLatestSummary_(techNo); // 清 latest cache

    return jsonOut_({
      ok: true,
      result: upsertRes.result,
      key,
      rangeKey,
      techNo,
      lastUpdatedAt: now,
      updateCount: upsertRes.updateCount,
      detailReplaced: rows.length,
      detailWrite: writeRes,
      recomputedSummary: recomputedSummary,
      sheets: { summary: sumShName, detail: detShName, detailIndex: idxShName },
    });
    const techNoRaw = String(payload.techNo || "");
    const rangeKey = String(payload.rangeKey || "").trim();
    const summary = payload.summary || {};
    const detail = Array.isArray(payload.detail) ? payload.detail : [];

    const techNo = normalizeTechNo_(techNoRaw);

    if (!techNo) return jsonOut_({ ok: false, error: "MISSING_techNo" });
    if (!rangeKey) return jsonOut_({ ok: false, error: "MISSING_rangeKey" });
    if (!clientHash) return jsonOut_({ ok: false, error: "MISSING_clientHash" });
    if (!detail.length) return jsonOut_({ ok: false, error: "EMPTY_DETAIL" });

    const key = `${rangeKey}_${techNo}`;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const now = formatTs_(new Date());

    const sumShName = sheetSummaryName_(techNo);
    const sumSh = ensureSheet_(ss, sumShName, SUMMARY_HEADERS);

    const s1 = pickCard_(summary, "排班");
    const s2 = pickCard_(summary, "老點");
    const s3 = pickCard_(summary, "總計");

    const incoming = {
      key,
      rangeKey,
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

    const upsertRes = upsertSummaryByKeyFast_(sumSh, SUMMARY_HEADERS, incoming, key);

    if (upsertRes.result === "nochange") {
      const outNoChange = {
        ok: true,
        result: "nochange",
        key,
        rangeKey,
        techNo,
        lastUpdatedAt: upsertRes.lastUpdatedAt,
        updateCount: upsertRes.updateCount,
      };
      cacheSet_(techNo, rangeKey, outNoChange, CONFIG.CACHE_TTL_SEC);
      return jsonOut_(outNoChange);
    }

    const detShName = sheetDetailName_(techNo);
    const detSh = ensureSheet_(ss, detShName, DETAIL_HEADERS);

    const idxShName = sheetIndexName_(techNo);
    const idxSh = ensureSheet_(ss, idxShName, INDEX_HEADERS);

    const rows = detail.map((r) => [
      key,
      rangeKey,
      techNo,
      now,
      source,
      pageUrl,
      clientTsIso,
      clientHash,

      String(r["訂單日期"] || ""),
      String(r["訂單編號"] || ""),
      num_(r["序"]),
      String(r["拉牌"] || ""),
      String(r["服務項目"] || ""),
      num_(r["業績金額"]),
      num_(r["抽成金額"]),
      num_(r["數量"]),
      num_(r["小計"]),
      num_(r["分鐘"]),
      String(r["開工"] || ""),
      String(r["完工"] || ""),
      String(r["狀態"] || ""),
    ]);

    const writeRes = upsertDetailByIndex_(detSh, idxSh, key, rangeKey, techNo, now, clientHash, rows);

    const out = {
      ok: true,
      result: upsertRes.result,
      key,
      rangeKey,
      techNo,
      lastUpdatedAt: now,
      updateCount: upsertRes.updateCount,
      detailReplaced: rows.length,
      detailWrite: writeRes,
      sheets: { summary: sumShName, detail: detShName, detailIndex: idxShName },
    };

    cacheDel_(techNo, rangeKey);
    return jsonOut_(out);
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.stack ? err.stack : err) });
  } finally {
    lock.releaseLock();
  }
}

function handleGetDetailPerf_(e) {
  try {
    const techNo = normalizeTechNo_((e && e.parameter && e.parameter.techNo) || "");
    const rangeKey = String((e && e.parameter && e.parameter.rangeKey) || "").trim();

    if (!techNo) return jsonOut_({ ok: false, error: "MISSING_techNo" });
    if (!rangeKey) return jsonOut_({ ok: false, error: "MISSING_rangeKey" });

    const cached = cacheGet_(techNo, rangeKey);
    if (cached) return jsonOut_(cached);

    const key = `${rangeKey}_${techNo}`;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const sumSh = getOrCreateSheetHeaderOnly_(ss, sheetSummaryName_(techNo), SUMMARY_HEADERS);
    const detSh = getOrCreateSheetHeaderOnly_(ss, sheetDetailName_(techNo), DETAIL_HEADERS);
    const idxSh = getOrCreateSheetHeaderOnly_(ss, sheetIndexName_(techNo), INDEX_HEADERS);

    const summary = findRowObjectByKeyTextFinder_(sumSh, key);
    const detail = findDetailObjectsByKeyViaIndex_(detSh, idxSh, key);

    const lastUpdatedAt = summary ? String(summary.lastUpdatedAt || "") : "";
    const updateCount = summary ? Number(summary.updateCount || 0) : 0;

    const out = {
      ok: true,
      result: "ok",
      key,
      rangeKey,
      techNo,
      lastUpdatedAt,
      updateCount,
      summaryRow: summary,
      detailRows: detail,
      sheets: {
        summary: sheetSummaryName_(techNo),
        detail: sheetDetailName_(techNo),
        detailIndex: sheetIndexName_(techNo),
      },
      cachedAt: formatTs_(new Date()),
    };

    cacheSet_(techNo, rangeKey, out, CONFIG.CACHE_TTL_SEC);
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

  const found = sh
    .getRange(2, keyIdx + 1, Math.max(0, sh.getLastRow() - 1), 1)
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

function upsertDetailByIndex_(detSh, idxSh, key, rangeKey, techNo, now, clientHash, rows) {
  const idxLastRow = idxSh.getLastRow();
  const idxLastCol = idxSh.getLastColumn();
  const headers = idxSh.getRange(1, 1, 1, idxLastCol).getValues()[0].map(String);

  const keyIdx = headers.indexOf("key");
  const startIdx = headers.indexOf("startRow");
  const countIdx = headers.indexOf("rowCount");
  const lastIdx = headers.indexOf("lastUpdatedAt");
  const hashIdx = headers.indexOf("clientHash");
  const rangeIdx = headers.indexOf("rangeKey");
  const techIdx = headers.indexOf("techNo");

  if (keyIdx < 0 || startIdx < 0 || countIdx < 0) {
    throw new Error("INDEX_HEADERS_INVALID");
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
      detSh.getRange(oldStart, 1, oldCount, DETAIL_HEADERS.length).clearContent();
      detSh.getRange(oldStart, 1, newCount, DETAIL_HEADERS.length).setValues(rows);

      idxSh
        .getRange(r, 1, 1, idxLastCol)
        .setValues([
          headers.map((h, i) => {
            if (i === keyIdx) return key;
            if (i === rangeIdx) return rangeKey;
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
    if (rangeIdx >= 0) rowVals[rangeIdx] = rangeKey;
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
    rangeKey,
    techNo,
    startRow,
    rowCount: newCount,
    lastUpdatedAt: now,
    clientHash,
  };
  const idxRow = INDEX_HEADERS.map((h) => (idxObj[h] !== undefined ? idxObj[h] : ""));
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
function sheetIndexName_(techNo) {
  return CONFIG.SHEET_INDEX_PREFIX + String(techNo);
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

function cacheKey_(techNo, rangeKey) {
  return `detailperf_v1:${techNo}:${rangeKey}`;
}
function cacheGet_(techNo, rangeKey) {
  const c = CacheService.getScriptCache();
  const raw = c.get(cacheKey_(techNo, rangeKey));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}
function cacheSet_(techNo, rangeKey, obj, ttlSec) {
  const c = CacheService.getScriptCache();
  c.put(cacheKey_(techNo, rangeKey), JSON.stringify(obj), ttlSec || CONFIG.CACHE_TTL_SEC);
}
function cacheDel_(techNo, rangeKey) {
  const c = CacheService.getScriptCache();
  c.remove(cacheKey_(techNo, rangeKey));
}
