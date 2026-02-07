/*******************************************************
 * ✅ GAS（Apps Script）— 最終可貼可覆蓋版
 *
 * ✅ 變更摘要（相對你貼的版本）
 * 1) recordHash 改為「hash 全部內容 + meta」（避免只用 lastJson.data 造成偵測不準）
 * 2) parseBody_ 保留 JSON + form 兼容（但前端已改成真正的 form-urlencoded）
 * 3) 其餘結構不動：syncStorePerf_v1、storeId detail、cards/serviceSummary、Total UPSERT
 *******************************************************/

const CONFIG = {
  BASE: "https://yspos.youngsong.com.tw",
  SHEET_PREFIX: "YSPOS",
  PAGE_SIZE: 200,
  PAGE_MODES: [
    { name: "oneBased", numberFn: (p) => p + 1 },
    { name: "zeroBased", numberFn: (p) => p },
  ],
  CACHE_TTL_SEC: 30,
  SHEET_PERF_ACCESS: "PerformanceAccess",

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
  MAX_PAGES: 400,

  // ✅ Summary 列順序
  CARD_BUCKETS: ["排班", "老點", "女師傅", "男師傅", "其他", "總計"],
};

/* =====================================================
 * Web App (GET)
 * ===================================================== */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const mode = String(p.mode || "").trim();

    if (mode === "ping_v1") {
      return json_({ ok: true, now: new Date().toISOString() });
    }
    return json_({ ok: false, error: "UNKNOWN_MODE", mode });
  } catch (err) {
    return json_({ ok: false, error: "EXCEPTION", message: String(err && err.message ? err.message : err) });
  }
}

/* =====================================================
 * Web App (POST)
 * ===================================================== */
function doPost(e) {
  try {
    const body = parseBody_(e);
    const mode = String(body.mode || "").trim();
    if (mode !== "syncStorePerf_v1") return json_({ ok: false, error: "UNKNOWN_MODE", mode });

    const userId = String(body.userId || "").trim();
    const techNo = String(body.techNo || body.masterCode || body.techno || "").trim();
    const storeIdInput = String(body.storeId || "").trim();
    const bypassAccess = body.bypassAccess === true || String(body.bypassAccess || "") === "true";
    const from = normalizeDateKeyStrict_(body.from);
    const to = normalizeDateKeyStrict_(body.to || body.from);
    const includeDetail = body.includeDetail === true || String(body.includeDetail || "") === "true";

    if (!from) return json_({ ok: false, error: "MISSING_FROM" });
    if (!to) return json_({ ok: false, error: "MISSING_TO" });

    var storeId = "";
    if (!bypassAccess) {
      if (!userId) return json_({ ok: false, error: "MISSING_USERID" });
      const access = getPerformanceAccessByUserId_(userId);
      if (!access.ok) return json_(access);

      if (access.performanceEnabled !== undefined && String(access.performanceEnabled) !== "是") {
        return json_({ ok: false, error: "FEATURE_OFF" });
      }

      storeId = String(access.storeId || "").trim();
      if (!storeId) return json_({ ok: false, error: "MISSING_STOREID" });
    } else {
      storeId = storeIdInput;
      if (!storeId) {
        if (!techNo) return json_({ ok: false, error: "MISSING_TECHNO" });
        storeId = String(lookupStoreIdByTechNo_(techNo) || "").trim();
        if (!storeId) return json_({ ok: false, error: "TECHNO_NOT_FOUND", techNo });
      }
    }

    const ss = SpreadsheetApp.getActive();

    // 1) total (store)
    const totalRes = fetchPagedObj_(
      `${CONFIG.BASE}/api/performance/total/${encodeURIComponent(storeId)}`,
      storeId,
      from,
      to,
      CONFIG.PAGE_SIZE,
      "perftotal"
    );
    if (!totalRes.ok) return json_(totalRes);

    // 2) upsert total sheet
    const shTotal = getOrCreateSheet_(ss, `${CONFIG.SHEET_PREFIX}_PerfTotalRaw_${storeId}`);
    const totalWrite = upsertPerfTotalRaw_(shTotal, storeId, from, to, totalRes.content, totalRes.recordHash);

    // 3) detail (optional) —— ✅ storeId detail
    let detailRowsFirst = [];
    let cards = null;
    let serviceSummary = [];
    let apiTotals = null;
    let detailRes = null;

    if (includeDetail) {
      detailRes = fetchPagedObj_(
        `${CONFIG.BASE}/api/performance/detail/${encodeURIComponent(storeId)}`,
        storeId,
        from,
        to,
        CONFIG.PAGE_SIZE,
        "perfdetail"
      );
      if (!detailRes.ok) return json_(detailRes);

      apiTotals = detailRes.meta || null;

      // ✅ 正規化成「第一筆格式」
      detailRowsFirst = (detailRes.content || []).map((r) => normalizePerfDetailToFirstFormatObj_(r));

      // ✅ raw：清空重寫（明細維持一致）
      const shRaw = getOrCreateSheet_(ss, `${CONFIG.SHEET_PREFIX}_PerfRaw_${storeId}`);
      writePerfRaw_FirstFormatObj_(shRaw, storeId, from, to, detailRowsFirst);

      // ✅ cards/serviceSummary
      cards = buildCardsFromFirstRows_(detailRowsFirst);
      serviceSummary = buildServiceSummaryFromFirstRows_(detailRowsFirst);

      // ✅ summary
      const shSum = getOrCreateSheet_(ss, `${CONFIG.SHEET_PREFIX}_PerfSummary_${storeId}`);
      writePerfSummaryFromCards_(shSum, storeId, from, to, cards, serviceSummary, apiTotals);
    }

    return json_({
      ok: true,
      mode,
      userId,
      techNo,
      storeId,
      from,
      to,
      includeDetail,
      lastUpdatedAt: new Date().toISOString(),
      written: {
        totalSheet: `${CONFIG.SHEET_PREFIX}_PerfTotalRaw_${storeId}`,
        rawSheet: includeDetail ? `${CONFIG.SHEET_PREFIX}_PerfRaw_${storeId}` : "",
        summarySheet: includeDetail ? `${CONFIG.SHEET_PREFIX}_PerfSummary_${storeId}` : "",
      },
      total: {
        rowsCount: (totalRes.content || []).length,
        upsert: totalWrite,
        recordHash: totalRes.recordHash,
        aggregates: totalRes.meta || null,
        rows: (totalRes.content || []).map((r) => normalizePerfTotalRow_(r)),
      },
      detail: includeDetail
        ? {
            rowsCount: detailRowsFirst.length,
            recordHash: detailRes ? detailRes.recordHash : "",
            apiTotals: apiTotals || null,
            cards,
            serviceSummaryCount: serviceSummary.length,
            serviceSummary,
            rows: detailRowsFirst,
          }
        : { skipped: true },
    });
  } catch (err) {
    return json_({ ok: false, error: "EXCEPTION", message: String(err && err.message ? err.message : err) });
  }
}

/* =====================================================
 * ✅ parseBody_（JSON + form 兼容）
 * ===================================================== */
function parseBody_(e) {
  const out = {};
  try {
    const p = (e && e.parameter) || {};
    for (const k in p) out[k] = p[k];

    const txt = e && e.postData && e.postData.contents ? String(e.postData.contents) : "";
    if (!txt) return out;

    // JSON first
    try {
      const j = JSON.parse(txt);
      if (j && typeof j === "object") return Object.assign(out, j);
    } catch (_) {}

    // x-www-form-urlencoded fallback
    const pairs = txt.split("&");
    for (const pair of pairs) {
      if (!pair) continue;
      const idx = pair.indexOf("=");
      const k = idx >= 0 ? pair.slice(0, idx) : pair;
      const v = idx >= 0 ? pair.slice(idx + 1) : "";
      const kk = decodeURIComponent(k.replace(/\+/g, " "));
      const vv = decodeURIComponent(v.replace(/\+/g, " "));
      if (kk) out[kk] = vv;
    }
    return out;
  } catch (_) {
    return out;
  }
}

/* =====================================================
 * PerformanceAccess: userId → storeId / enabled
 * ===================================================== */
function getPerformanceAccessByUserId_(userId) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(CONFIG.SHEET_PERF_ACCESS);
  if (!sh) return { ok: false, error: "SHEET_NOT_FOUND", sheet: CONFIG.SHEET_PERF_ACCESS };

  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return { ok: false, error: "SHEET_EMPTY", sheet: CONFIG.SHEET_PERF_ACCESS };

  const header = values[0].map((x) => String(x || "").trim());
  const col = indexMap_(header);

  const idxUserId = pickCol_(col, ["userId", "userid", "lineUserId", "line_user_id", "LINE_USER_ID", "使用者ID"]) ?? -1;
  const idxStoreId = pickCol_(col, ["StoreId", "storeId", "storeid", "店ID", "門市ID"]) ?? -1;
  const idxEnabled = pickCol_(col, ["performanceEnabled", "業績", "業績開通", "業績權限"]) ?? -1;

  if (idxUserId < 0) return { ok: false, error: "MISSING_COLUMN_USERID", sheet: CONFIG.SHEET_PERF_ACCESS };
  if (idxStoreId < 0) return { ok: false, error: "MISSING_COLUMN_STOREID", sheet: CONFIG.SHEET_PERF_ACCESS };

  const uid = String(userId || "").trim();
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const v = String(row[idxUserId] || "").trim();
    if (v && v === uid) {
      const storeId = String(row[idxStoreId] || "").trim();
      const performanceEnabled = idxEnabled >= 0 ? String(row[idxEnabled] || "").trim() : undefined;
      return { ok: true, userId: uid, storeId, performanceEnabled };
    }
  }

  return { ok: false, error: "USER_NOT_FOUND", userId: uid, sheet: CONFIG.SHEET_PERF_ACCESS };
}

/* =====================================================
 * NetworkCapture lookup (TechNo -> StoreId)
 * ===================================================== */
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
    "masterCode",
  ]);

  var storeIdx = findHeaderIndexAny_(header, [
    CONFIG.NC_COL_STOREID || "StoreId",
    "storeid",
    "StoreID",
    "Store",
    "StoreNo",
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
 * 用師傅編號(TechNo) 查 StoreId
 */
function lookupStoreIdByTechNo_(techNo) {
  var t = String(techNo || "").trim();
  if (!t) return "";

  try {
    var cache = CacheService.getScriptCache();
    var key = "techno_storeid_map_from_networkcapture_v1";
    var cached = cache.get(key);
    var map = cached ? JSON.parse(cached) : null;

    if (!map) {
      map = buildTechNoToStoreIdMapFromNetworkCapture_();
      cache.put(key, JSON.stringify(map), 300);
    }

    return String(map[t] || "").trim();
  } catch (e) {
    var map2 = buildTechNoToStoreIdMapFromNetworkCapture_();
    return String(map2[t] || "").trim();
  }
}

function indexMap_(headerArr) {
  const m = {};
  for (let i = 0; i < headerArr.length; i++) {
    const k = String(headerArr[i] || "").trim();
    if (!k) continue;
    m[k] = i;
  }
  return m;
}

function pickCol_(colMap, names) {
  for (const n of names) if (colMap[n] !== undefined) return colMap[n];
  const lower = {};
  Object.keys(colMap).forEach((k) => (lower[String(k).toLowerCase()] = colMap[k]));
  for (const n of names) {
    const idx = lower[String(n).toLowerCase()];
    if (idx !== undefined) return idx;
  }
  return null;
}

/* =====================================================
 * Fetch (content + meta + recordHash)
 * ===================================================== */
function fetchPagedObj_(url, ownerId, from, to, pageSize, kind) {
  const cache = CacheService.getScriptCache();
  const cacheKey = `yspos:obj:${kind}:${ownerId}:${from}:${to}:${pageSize}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    const obj = safeJsonParseSoft_(cached);
    if (obj && Array.isArray(obj.content)) return { ok: true, ...obj, cached: true };
  }

  const token = getBearerToken_();

  for (const mode of CONFIG.PAGE_MODES) {
    let page = 0;
    let modeFailed = false;

    let all = [];
    let lastJson = null;

    while (true) {
      const payload = { size: pageSize, number: mode.numberFn(page), from, to };

      const res = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        headers: { accept: "application/json, text/plain, */*", authorization: token },
        muteHttpExceptions: true,
      });

      if (res.getResponseCode() !== 200) {
        modeFailed = true;
        break;
      }

      const json = safeJsonParseSoft_(res.getContentText());
      if (!json || json.success !== true) {
        modeFailed = true;
        break;
      }

      lastJson = json;

      const data = json.data || {};
      const content = Array.isArray(data.content) ? data.content : [];
      all.push(...content);

      if (data.last === true || content.length === 0) break;

      page += 1;
      if (page > CONFIG.MAX_PAGES) throw new Error("Pagination overflow");
    }

    if (!modeFailed) {
      const meta = extractMetaTotals_(lastJson);

      // ✅ 修正：recordHash 改為 hash 全部 rows + meta（更可信）
      const recordHash = sha1_(JSON.stringify({ meta: meta || null, content: all || [] }));

      const out = { content: all, meta, recordHash };
      cache.put(cacheKey, JSON.stringify(out), CONFIG.CACHE_TTL_SEC);
      return { ok: true, ...out, cached: false };
    }
  }

  return { ok: false, error: "FETCH_FAILED", url, ownerId, from, to };
}

function extractMetaTotals_(json) {
  const d = json && json.data ? json.data : null;
  if (!d) return null;
  return {
    total: d.total || null,
    old: d.old || null,
    schedule: d.schedule || null,
    totalElements: d.totalElements,
    totalPages: d.totalPages,
  };
}

/* =====================================================
 * ✅ Total UPSERT sheet
 * ===================================================== */
function upsertPerfTotalRaw_(sh, storeId, from, to, rows, recordHash) {
  const headers = [
    "UpsertKey",
    "RowNo",
    "StoreId",
    "TechNo",
    "From",
    "To",
    "RecordHash",
    "Name",
    "TotalCount",
    "TotalPeriod",
    "TotalPrice",
    "OldCount",
    "OldPeriod",
    "OldPrice",
    "ScheduleCount",
    "SchedulePeriod",
    "SchedulePrice",
    "OtherJson",
  ];

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const cur = sh
      .getRange(1, 1, 1, sh.getLastColumn())
      .getValues()[0]
      .map((x) => String(x || "").trim());
    if (!sameHeader_(cur, headers)) {
      sh.clearContents();
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }

  const lastRow = sh.getLastRow();
  const existing = {};
  if (lastRow >= 2) {
    const data = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (let i = 0; i < data.length; i++) {
      const key = String(data[i][0] || "").trim();
      if (key) existing[key] = 2 + i;
    }
  }

  let inserted = 0;
  let updated = 0;

  const techNo = "";
  const list = Array.isArray(rows) ? rows : [];

  list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant"));

  const toAppend = [];

  for (let i = 0; i < list.length; i++) {
    const r = list[i] || {};
    const name = String(r.name ?? r.serviceName ?? r.title ?? "").trim();
    const nameHash = sha1_(name);
    const upsertKey = `${storeId}|${from}|${to}|${nameHash}`;

    const rowValues = [
      upsertKey,
      i + 1,
      storeId,
      techNo,
      from,
      to,
      recordHash || "",
      name,
      numOr0_(r.totalCount ?? r.count),
      numOr0_(r.totalPeriod ?? r.period),
      numOr0_(r.totalPrice ?? r.price ?? r.amount),
      numOr0_(r.oldCount),
      numOr0_(r.oldPeriod),
      numOr0_(r.oldPrice),
      numOr0_(r.scheduleCount),
      numOr0_(r.schedulePeriod),
      numOr0_(r.schedulePrice),
      JSON.stringify(r || {}),
    ];

    const hitRowNo = existing[upsertKey];
    if (hitRowNo) {
      sh.getRange(hitRowNo, 1, 1, headers.length).setValues([rowValues]);
      updated += 1;
    } else {
      toAppend.push(rowValues);
      inserted += 1;
    }
  }

  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, headers.length).setValues(toAppend);
  }

  return { inserted, updated, totalIncoming: list.length };
}

function sameHeader_(cur, target) {
  if (!Array.isArray(cur) || !Array.isArray(target)) return false;
  if (cur.length < target.length) return false;
  for (let i = 0; i < target.length; i++) {
    if (String(cur[i] || "").trim() !== String(target[i] || "").trim()) return false;
  }
  return true;
}

/* =====================================================
 * Raw & Summary sheets
 * ===================================================== */
function writePerfRaw_FirstFormatObj_(sh, storeId, from, to, rowsObj) {
  const headers = ["訂單日期", "訂單編號", "序", "拉牌", "服務項目", "業績金額", "抽成金額", "數量", "小計", "分鐘", "開工", "完工", "狀態"];

  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);

  const values = (rowsObj || []).map((o) => headers.map((h) => (o[h] != null ? o[h] : "")));
  if (values.length) sh.getRange(2, 1, values.length, headers.length).setValues(values);
}

function writePerfSummaryFromCards_(sh, storeId, from, to, cards, serviceSummary, apiTotals) {
  sh.clearContents();

  sh.getRange(1, 1, 6, 2).setValues([
    ["店ID", storeId],
    ["區間", `${from} ~ ${to}`],
    ["更新時間", new Date()],
    ["API_TOTAL(orderCount/count/period/price)", apiTotals && apiTotals.total ? JSON.stringify(apiTotals.total) : ""],
    ["API_OLD(orderCount/count/period/price)", apiTotals && apiTotals.old ? JSON.stringify(apiTotals.old) : ""],
    ["API_SCHEDULE(orderCount/count/period/price)", apiTotals && apiTotals.schedule ? JSON.stringify(apiTotals.schedule) : ""],
  ]);

  const start = 8;
  sh.getRange(start, 1, 1, 5).setValues([["類別", "單數", "筆數", "數量", "金額"]]);

  const c = cards || {};
  const rows = CONFIG.CARD_BUCKETS.map((k) => [k, c[k]?.單數 || 0, c[k]?.筆數 || 0, c[k]?.數量 || 0, c[k]?.金額 || 0]);
  sh.getRange(start + 1, 1, rows.length, 5).setValues(rows);

  const start2 = start + 2 + rows.length;

  const headers2 = ["服務項目", "總筆數", "總節數", "總計金額", "老點筆數", "老點節數", "老點金額", "排班筆數", "排班節數", "排班金額"];
  sh.getRange(start2, 1, 1, headers2.length).setValues([headers2]);

  const list = Array.isArray(serviceSummary) ? serviceSummary : [];
  const values2 = list.map((o) => headers2.map((h) => (o[h] != null ? o[h] : 0)));
  if (values2.length) sh.getRange(start2 + 1, 1, values2.length, headers2.length).setValues(values2);
}

/* =====================================================
 * Normalize
 * ===================================================== */
function normalizePerfTotalRow_(r) {
  const o = r || {};
  return {
    name: o.name ?? o.serviceName ?? o.title ?? "",
    totalCount: numOr0_(o.totalCount ?? o.count),
    totalPeriod: numOr0_(o.totalPeriod ?? o.period),
    totalPrice: numOr0_(o.totalPrice ?? o.price ?? o.amount),
    oldCount: numOr0_(o.oldCount),
    oldPeriod: numOr0_(o.oldPeriod),
    oldPrice: numOr0_(o.oldPrice),
    scheduleCount: numOr0_(o.scheduleCount),
    schedulePeriod: numOr0_(o.schedulePeriod),
    schedulePrice: numOr0_(o.schedulePrice),
  };
}

function bucketFromSelectMode_(selectMode) {
  const sm = String(selectMode || "").trim().toUpperCase();
  if (sm === "OLD") return "老點";
  if (sm === "SCHEDULING") return "排班";
  if (sm === "FEMALE") return "女師傅";
  if (sm === "MALE") return "男師傅";
  if (sm) return "其他";
  return "其他";
}

function normalizePerfDetailToFirstFormatObj_(r) {
  const orderDate = normalizeDateKey_(r.orderTime ?? r.orderDate ?? r.date ?? "");
  const seq =
    r.index != null && r.index !== ""
      ? r.index
      : r.seq != null && r.seq !== ""
      ? r.seq
      : r.no != null && r.no !== ""
      ? r.no
      : "";

  const selectMode = String(r.selectMode || "").trim();
  const bucket = bucketFromSelectMode_(selectMode);
  const pull = bucket;

  const statusText = normalizeStatus_(r.status);
  const startTime = normalizeTime_(r.start ?? r.startTime ?? "");
  const endTime = normalizeTime_(r.end ?? r.endTime ?? "");

  return {
    訂單日期: orderDate,
    訂單編號: String(r.orderNum ?? ""),
    序: String(seq ?? ""),
    拉牌: pull,
    服務項目: String(r.serviceName ?? ""),
    業績金額: numOr0_(r.performance),
    抽成金額: numOr0_(r.rake),
    數量: parseQty_(r.amount),
    小計: numOr0_(r.total),
    分鐘: numOr0_(r.time),
    開工: startTime,
    完工: endTime,
    狀態: statusText,

    __bucket: bucket,
    __selectMode: selectMode,
  };
}

/* =====================================================
 * Cards / ServiceSummary
 * ===================================================== */
function buildCardsFromFirstRows_(rows) {
  const init = () => ({ 單數: 0, 筆數: 0, 數量: 0, 金額: 0, _orders: {} });

  const cards = {};
  for (const k of CONFIG.CARD_BUCKETS) cards[k] = init();

  function pickBucket_(row) {
    const b = String(row.__bucket || "").trim();
    if (b && cards[b]) return b;

    const p = String(row["拉牌"] || "").trim();
    if (p && cards[p]) return p;

    return "其他";
  }

  for (const row of rows || []) {
    const bucket = pickBucket_(row);
    const orderNo = String(row["訂單編號"] || "").trim();
    const qty = parseQty_(row["數量"]);
    const amt = numOr0_(row["小計"] || row["業績金額"]);

    cards["總計"].筆數 += 1;
    cards["總計"].數量 += qty;
    cards["總計"].金額 += amt;
    if (orderNo) cards["總計"]._orders[orderNo] = 1;

    cards[bucket].筆數 += 1;
    cards[bucket].數量 += qty;
    cards[bucket].金額 += amt;
    if (orderNo) cards[bucket]._orders[orderNo] = 1;
  }

  for (const k of CONFIG.CARD_BUCKETS) {
    cards[k].單數 = Object.keys(cards[k]._orders).length;
    delete cards[k]._orders;
  }

  return cards;
}

function buildServiceSummaryFromFirstRows_(rows) {
  const map = {};

  function isOld_(row) {
    const b = String(row.__bucket || row["拉牌"] || "").trim();
    return b === "老點";
  }

  for (const row of rows || []) {
    const name = String(row["服務項目"] || "（未命名）");
    const old = isOld_(row);
    const qty = parseQty_(row["數量"]);
    const amt = numOr0_(row["小計"] || row["業績金額"]);

    if (!map[name]) {
      map[name] = {
        服務項目: name,
        總筆數: 0,
        總節數: 0,
        總計金額: 0,
        老點筆數: 0,
        老點節數: 0,
        老點金額: 0,
        排班筆數: 0,
        排班節數: 0,
        排班金額: 0,
      };
    }

    const o = map[name];
    o["總筆數"] += 1;
    o["總節數"] += qty;
    o["總計金額"] += amt;

    if (old) {
      o["老點筆數"] += 1;
      o["老點節數"] += qty;
      o["老點金額"] += amt;
    } else {
      o["排班筆數"] += 1;
      o["排班節數"] += qty;
      o["排班金額"] += amt;
    }
  }

  return Object.values(map).sort((a, b) => (b["總計金額"] || 0) - (a["總計金額"] || 0));
}

/* =====================================================
 * Helpers
 * ===================================================== */
function normalizeDateKeyStrict_(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!m) return "";
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getBearerToken_() {
  const raw = PropertiesService.getScriptProperties().getProperty("YSPOS_BEARER");
  if (!raw || !raw.trim()) throw new Error("❌ Missing Script Property: YSPOS_BEARER");
  return raw.startsWith("Bearer ") ? raw.trim() : `Bearer ${raw.trim()}`;
}

function safeJsonParseSoft_(t) {
  try {
    return JSON.parse(String(t || ""));
  } catch (_) {
    return null;
  }
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function numOr0_(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseQty_(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;

  let s = String(v).trim();
  if (!s) return 0;

  s = s
    .replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xff10))
    .replace(/．/g, ".")
    .replace(/－/g, "-");

  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  s = s.replace(/[^\d.\-]/g, "");

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDateKey_(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  const m = t.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return t;
}

function normalizeTime_(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  const m = t.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return t;
  return `${String(m[1]).padStart(2, "0")}:${m[2]}:${m[3]}`;
}

function normalizeStatus_(v) {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s || s === "0") return "";
  if (/[提早超時分]/.test(s)) return s;
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return "";
  if (n < 0) return `提早${Math.abs(n)}分`;
  return `超時${n}分`;
}

function sha1_(str) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, str, Utilities.Charset.UTF_8);
  return raw
    .map((b) => {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? "0" + v : v;
    })
    .join("");
}
