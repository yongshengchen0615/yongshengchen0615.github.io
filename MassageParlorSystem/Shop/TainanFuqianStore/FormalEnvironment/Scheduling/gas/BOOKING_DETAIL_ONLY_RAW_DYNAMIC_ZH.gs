/*******************************************************
 * ✅ GAS（Apps Script）— 最終可貼可覆蓋版（只打 booking/detail + Raw 動態欄位 + 中文表頭 + 預約時間不顯示秒）
 *
 * ✅ 本版保證「移除舊 API」
 * - ❌ 不呼叫 /api/performance/total/{storeId}
 * - ❌ 不呼叫 /api/performance/detail/{storeId}
 * - ✅ 只呼叫 /api/booking/detail/{storeId}
 *
 * ✅ 本版保證「不產生 Summary」
 * - ❌ 不寫 Summary Sheet / cards / serviceSummary
 * - ✅ 只寫 Raw Sheet：YSPOS_BookingRaw_{storeId}
 *
 * ✅ Raw 欄位規則
 * - ✅ 不使用固定 headers
 * - ✅ 直接以 API 回傳物件 keys 動態建立表頭（union keys）
 * - ✅ 表頭顯示中文（由 HEADER_ZH_MAP 翻譯）
 * - ✅ 取值仍用原本的 API key
 * - ✅ 若翻譯後撞名，自動加 (2)(3)…
 *
 * ✅ 額外需求
 * - ✅ 「預約時間(bookingTime)」顯示到分鐘（不顯示秒）
 *
 * ✅ GAS 內建測試方式（不用部署 Web App）
 * 1) Script Properties 設 YSPOS_BEARER
 * 2) 執行：runTest_BookingDetailOnlyRawDynamicZh_v1()
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

  // ✅ 權限表：優先使用 BookingAccess；若不存在則 fallback PerformanceAccess
  SHEET_BOOKING_ACCESS: "BookingAccess",
  SHEET_PERF_ACCESS: "PerformanceAccess",

  // ✅ 師傅編號 → StoreId 對照來源：NetworkCapture
  SHEET_NETWORK_CAPTURE: "NetworkCapture",
  NC_COL_TECHNO: "TechNo",
  NC_COL_STOREID: "StoreId",
  NC_COL_REQUESTURL: "RequestUrl",
  NC_COL_RESPONSE: "Response",
  NC_SCAN_MAX_ROWS: 5000,

  MAX_PAGES: 400,

  // ✅ 動態表頭：核心欄位優先（存在才會放）
  BOOKING_CORE_KEYS: ["bookingTime", "bookingDetailId", "id", "bookingId", "storeId", "serviceName", "period", "time", "remarks"],
};

// ✅ API key → 中文欄位名稱（可自行擴充）
const HEADER_ZH_MAP = {
  // booking/detail 常見
  bookingTime: "預約時間",
  bookingDetailId: "預約明細ID",
  id: "ID",
  bookingId: "預約單ID",
  storeId: "店ID",
  serviceName: "服務項目",
  period: "節數",
  time: "分鐘",
  remarks: "備註",

  // 可能出現的欄位（依你資料流擴充）
  techNo: "師傅編號",
  masterCode: "師傅編號",
  techno: "師傅編號",
  customerName: "客人姓名",
  customerPhone: "客人電話",
  roomName: "包廂",
  status: "狀態",
  createdAt: "建立時間",
  updatedAt: "更新時間",
};

/* =====================================================
 * Web App (GET)
 * ===================================================== */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const mode = String(p.mode || "").trim();
    if (mode === "ping_v1") return json_({ ok: true, now: new Date().toISOString() });
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
    if (mode !== "syncStorePerf_v1" && mode !== "bookingQuery_v1") return json_({ ok: false, error: "UNKNOWN_MODE", mode });

    const userId = String(body.userId || "").trim();
    const techNo = String(body.techNo || body.masterCode || body.techno || "").trim();
    const storeIdInput = String(body.storeId || body.StoreId || "").trim();
    const bypassAccess = body.bypassAccess === true || String(body.bypassAccess || "") === "true";
    const from = normalizeDateKeyStrict_(body.from);
    const to = normalizeDateKeyStrict_(body.to || body.from);

    if (!from) return json_({ ok: false, error: "MISSING_FROM" });
    if (!to) return json_({ ok: false, error: "MISSING_TO" });

    // ✅ storeId 決策：Access / bypass + techNo lookup
    let storeId = "";
    // 1) 若請求已帶 storeId：直接使用（AUTH 會先做開通/認證）
    if (storeIdInput) {
      storeId = storeIdInput;
    }

    // 2) 若有 techNo：用 NetworkCapture 推導 storeId
    if (!storeId && techNo) {
      storeId = String(lookupStoreIdByTechNo_(techNo) || "").trim();
      if (!storeId) return json_({ ok: false, error: "TECHNO_NOT_FOUND", techNo });
    }

    // 3) 兼容舊模式：未帶 storeId/techNo 且 bypassAccess=false → 仍可用 access sheet 由 userId 查 storeId
    if (!storeId && !bypassAccess) {
      if (!userId) return json_({ ok: false, error: "MISSING_USERID" });

      const access = getBookingAccessByUserId_(userId);
      if (!access.ok) {
        if (String(access.error || "") === "SHEET_NOT_FOUND") {
          return json_({
            ok: false,
            error: "BOOKING_ACCESS_NOT_CONFIGURED",
            message: "缺少 BookingAccess/PerformanceAccess，請改由前端帶 storeId 或 techNo（並設 bypassAccess=true）",
          });
        }
        return json_(access);
      }

      if (access.bookingEnabled !== undefined && String(access.bookingEnabled) !== "是") {
        return json_({ ok: false, error: "FEATURE_OFF" });
      }

      storeId = String(access.storeId || "").trim();
      if (!storeId) return json_({ ok: false, error: "MISSING_STOREID" });
    }

    if (!storeId) {
      return json_({ ok: false, error: "MISSING_STOREID", message: "請提供 storeId 或 techNo" });
    }

    // ✅ 只打 booking/detail
    const url = `${CONFIG.BASE}/api/booking/detail/${encodeURIComponent(storeId)}`;
    const res = fetchPagedObj_(url, storeId, from, to, CONFIG.PAGE_SIZE, "bookingdetail");
    if (!res.ok) return json_(res);

    // ✅ Raw：直接用 API 回傳 rows（物件陣列）→ 動態表頭（中文）
    const rows = Array.isArray(res.content) ? res.content : [];

    // 前端查詢需要 rows 直接渲染；同時保留寫入 Raw sheet 的能力。
    // 若資料量過大導致回應過大，可再視需求加入 returnRowsLimit。

    const ss = SpreadsheetApp.getActive();
    const shRaw = getOrCreateSheet_(ss, `${CONFIG.SHEET_PREFIX}_BookingRaw_${storeId}`);
    writeRawDynamicFromObjectsZh_(shRaw, rows, CONFIG.BOOKING_CORE_KEYS);

    return json_({
      ok: true,
      mode,
      userId,
      techNo,
      storeId,
      from,
      to,
      api: { url: `/api/booking/detail/${storeId}` },
      recordHash: res.recordHash,
      cached: res.cached === true,
      meta: res.meta || null,
      rowsCountTotal: rows.length,
      rows: rows,
      written: { rawSheet: `${CONFIG.SHEET_PREFIX}_BookingRaw_${storeId}` },
      lastUpdatedAt: new Date().toISOString(),
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
function getBookingAccessByUserId_(userId) {
  const ss = SpreadsheetApp.getActive();
  // ✅ 優先 BookingAccess；沒有就 fallback PerformanceAccess
  const sh = ss.getSheetByName(CONFIG.SHEET_BOOKING_ACCESS) || ss.getSheetByName(CONFIG.SHEET_PERF_ACCESS);
  if (!sh) return { ok: false, error: "SHEET_NOT_FOUND", sheet: `${CONFIG.SHEET_BOOKING_ACCESS}/${CONFIG.SHEET_PERF_ACCESS}` };

  const values = sh.getDataRange().getValues();
  if (!values || values.length < 2) return { ok: false, error: "SHEET_EMPTY", sheet: sh.getName() };

  const header = values[0].map((x) => String(x || "").trim());
  const col = indexMap_(header);

  const idxUserId = pickCol_(col, ["userId", "userid", "lineUserId", "line_user_id", "LINE_USER_ID", "使用者ID"]) ?? -1;
  const idxStoreId = pickCol_(col, ["StoreId", "storeId", "storeid", "店ID", "門市ID"]) ?? -1;
  const idxEnabled =
    pickCol_(col, ["bookingEnabled", "預約查詢", "預約查詢開通", "預約", "booking", "BookingEnabled"]) ??
    pickCol_(col, ["performanceEnabled", "業績", "業績開通", "業績權限"]) ??
    -1;

  if (idxUserId < 0) return { ok: false, error: "MISSING_COLUMN_USERID", sheet: sh.getName() };
  if (idxStoreId < 0) return { ok: false, error: "MISSING_COLUMN_STOREID", sheet: sh.getName() };

  const uid = String(userId || "").trim();
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const v = String(row[idxUserId] || "").trim();
    if (v && v === uid) {
      const storeId = String(row[idxStoreId] || "").trim();
        const bookingEnabled = idxEnabled >= 0 ? String(row[idxEnabled] || "").trim() : undefined;
        return { ok: true, userId: uid, storeId, bookingEnabled, sheet: sh.getName() };
    }
  }
  return { ok: false, error: "USER_NOT_FOUND", userId: uid, sheet: sh.getName() };
}

/* =====================================================
 * NetworkCapture lookup (TechNo -> StoreId)
 * ===================================================== */
function getNetworkCaptureSheet_() {
  return SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_NETWORK_CAPTURE);
}

function findHeaderIndex_(headerRow, name) {
  const target = String(name || "").trim().toLowerCase();
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || "").trim().toLowerCase();
    if (h === target) return i;
  }
  return -1;
}

function findHeaderIndexAny_(headerRow, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const idx = findHeaderIndex_(headerRow, candidates[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

function extractStoreIdFromRequestUrl_(url) {
  url = String(url || "").trim();
  if (!url) return "";
  const m = url.match(/\/detail\/(\d+)(?:\b|\/|\?|#|$)/i);
  return m && m[1] ? String(m[1]).trim() : "";
}

function extractTechNoFromResponse_(respText) {
  const s = String(respText || "").trim();
  if (!s) return "";
  const m1 = s.match(/"TechNo"\s*:\s*"?(\d+)"?/i);
  if (m1 && m1[1]) return String(m1[1]).trim();
  const m2 = s.match(/"techno"\s*:\s*"?(\d+)"?/i);
  if (m2 && m2[1]) return String(m2[1]).trim();
  const m3 = s.match(/師傅號碼\s*[:：=]\s*(\d+)/i);
  if (m3 && m3[1]) return String(m3[1]).trim();
  return "";
}

function buildTechNoToStoreIdMapFromNetworkCapture_() {
  const sheet = getNetworkCaptureSheet_();
  if (!sheet) return {};

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 2) return {};

  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  const techIdx = findHeaderIndexAny_(header, [
    CONFIG.NC_COL_TECHNO || "TechNo",
    "techno",
    "師傅編號",
    "師傅號碼",
    "MasterCode",
    "masterCode",
  ]);

  const storeIdx = findHeaderIndexAny_(header, [
    CONFIG.NC_COL_STOREID || "StoreId",
    "storeid",
    "StoreID",
    "Store",
    "StoreNo",
  ]);

  const reqIdx = findHeaderIndexAny_(header, [CONFIG.NC_COL_REQUESTURL || "RequestUrl", "requesturl", "url"]);
  const respIdx = findHeaderIndexAny_(header, [CONFIG.NC_COL_RESPONSE || "Response", "response", "Body", "body"]);

  const scanMax = CONFIG.NC_SCAN_MAX_ROWS || 5000;
  const startRow = Math.max(2, lastRow - scanMax + 1);
  const numRows = lastRow - startRow + 1;

  const values = sheet.getRange(startRow, 1, numRows, lastCol).getValues();
  const map = {};

  for (let i = 0; i < values.length; i++) {
    const row = values[i];

    let techNo = "";
    if (techIdx >= 0) techNo = String(row[techIdx] || "").trim();
    if (!techNo && respIdx >= 0) techNo = extractTechNoFromResponse_(row[respIdx]);
    if (!techNo) continue;

    let storeId = "";
    if (storeIdx >= 0) storeId = String(row[storeIdx] || "").trim();
    if (!storeId && reqIdx >= 0) storeId = extractStoreIdFromRequestUrl_(row[reqIdx]);
    if (!storeId) continue;

    map[techNo] = storeId;
  }
  return map;
}

function lookupStoreIdByTechNo_(techNo) {
  const t = String(techNo || "").trim();
  if (!t) return "";

  try {
    const cache = CacheService.getScriptCache();
    const key = "techno_storeid_map_from_networkcapture_v1";
    const cached = cache.get(key);
    let map = cached ? JSON.parse(cached) : null;

    if (!map) {
      map = buildTechNoToStoreIdMapFromNetworkCapture_();
      cache.put(key, JSON.stringify(map), 300);
    }
    return String(map[t] || "").trim();
  } catch (e) {
    const map2 = buildTechNoToStoreIdMapFromNetworkCapture_();
    return String(map2[t] || "").trim();
  }
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
 * ✅ Raw writer: 動態表頭（union keys）+ 中文表頭顯示 + bookingTime 去秒
 * ===================================================== */
function writeRawDynamicFromObjectsZh_(sh, rows, coreKeys) {
  const list = Array.isArray(rows) ? rows : [];

  // 1) 蒐集所有 keys（union）
  const keySet = {};
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (!o || typeof o !== "object") continue;
    Object.keys(o).forEach((k) => {
      if (k) keySet[k] = 1;
    });
  }

  // 2) 產生 key 順序：核心欄位（存在才放） + 其他欄位字母排序
  const allKeys = Object.keys(keySet);
  const core = Array.isArray(coreKeys) ? coreKeys : [];
  const presentCore = core.filter((k) => keySet[k]);
  const rest = allKeys.filter((k) => presentCore.indexOf(k) < 0).sort((a, b) => String(a).localeCompare(String(b)));
  const keysOrdered = presentCore.concat(rest);

  // 3) 中文表頭（顯示用），同名去重
  const headersZh = makeUniqueHeaders_(keysOrdered.map((k) => translateHeaderToZh_(k)));

  // 4) 清表 + 寫 header + 寫資料（資料仍用原 key 對應）
  sh.clearContents();

  if (!keysOrdered.length) {
    sh.getRange(1, 1, 1, 1).setValues([["(無資料)"]]);
    return;
  }

  sh.getRange(1, 1, 1, headersZh.length).setValues([headersZh]);

  if (!list.length) return;

  const values = list.map((o) => keysOrdered.map((k) => normalizeCell_(o ? o[k] : "", k)));
  sh.getRange(2, 1, values.length, keysOrdered.length).setValues(values);
}

function translateHeaderToZh_(key) {
  const k = String(key || "").trim();
  if (!k) return k;
  // ✅ 未翻譯的欄位：保留原 key
  return HEADER_ZH_MAP[k] || k;
}

function makeUniqueHeaders_(headers) {
  const used = {};
  return (headers || []).map((h) => {
    const base = String(h || "").trim() || "欄位";
    if (!used[base]) {
      used[base] = 1;
      return base;
    }
    used[base] += 1;
    return `${base}(${used[base]})`;
  });
}

// ✅ bookingTime 去秒：只顯示到分鐘
function formatBookingTimeNoSeconds_(v) {
  if (!v) return "";
  const s = String(v).trim();

  // 2026-02-08T09:30:20 或 2026-02-08 09:30:20
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})(?::\d{2})?$/);
  if (m) return `${m[1]} ${m[2]}`;

  return s;
}

function normalizeCell_(v, key) {
  if (v === null || v === undefined) return "";

  // ✅ 僅針對 bookingTime 移除秒
  if (key === "bookingTime") {
    return formatBookingTimeNoSeconds_(v);
  }

  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;

  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
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

function sha1_(str) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, str, Utilities.Charset.UTF_8);
  return raw
    .map((b) => {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? "0" + v : v;
    })
    .join("");
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
 * ✅ 測試方式（GAS 內直接跑，不用部署 Web App）
 * ===================================================== */
function runTest_BookingDetailOnlyRawDynamicZh_v1() {
  // ✅ 測試參數（照你提供的例子）
  const storeId = "2259";
  const from = "2026-02-01";
  const to = "2026-02-28";

  const url = `${CONFIG.BASE}/api/booking/detail/${encodeURIComponent(storeId)}`;
  const res = fetchPagedObj_(url, storeId, from, to, CONFIG.PAGE_SIZE, "bookingdetail_test");

  if (!res.ok) {
    Logger.log(res);
    throw new Error(`TEST_FETCH_FAILED: ${JSON.stringify(res)}`);
  }

  const rows = Array.isArray(res.content) ? res.content : [];

  const ss = SpreadsheetApp.getActive();
  const shRaw = getOrCreateSheet_(ss, `${CONFIG.SHEET_PREFIX}_BookingRaw_${storeId}`);
  writeRawDynamicFromObjectsZh_(shRaw, rows, CONFIG.BOOKING_CORE_KEYS);

  Logger.log({
    ok: true,
    storeId,
    from,
    to,
    rowsCount: rows.length,
    recordHash: res.recordHash,
    rawSheet: `${CONFIG.SHEET_PREFIX}_BookingRaw_${storeId}`,
    sampleRow: rows[0] || null,
    sampleKeys: rows[0] ? Object.keys(rows[0]) : [],
  });
}
