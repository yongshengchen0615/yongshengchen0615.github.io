/**
 * GAS Web App - Snapshot Receiver (FULL) + MD5 rowHash + Old Data_* schema
 *
 * POST mode=snapshot_v1:
 *  - overwrite Data_Body / Data_Foot (舊版欄位：masterId..updatedAt)
 *  - update BodyDataJson / FootDataJson (single-row cache)
 * GET  mode=sheet_all:
 *  - return cached json (fast)
 *
 * Deploy:
 * - Execute as: Me
 * - Who has access: Anyone (or Anyone with link)
 */

const CONFIG = {
  SPREADSHEET_ID: SpreadsheetApp.getActiveSpreadsheet().getId(), // 或填死 ID
  SHEET_BODY: "Data_Body",
  SHEET_FOOT: "Data_Foot",
  SHEET_BODY_JSON: "BodyDataJson",
  SHEET_FOOT_JSON: "FootDataJson",

  LOCK_WAIT_MS: 1500,
  JSON_CACHE_TTL_SEC: 10,

  // ✅ Data_Body / Data_Foot：改成與舊版相同的欄位（16 欄）
  ROW_HEADERS: [
    "masterId",
    "index",
    "sort",
    "status",
    "appointment",
    "remaining",
    "colorIndex",
    "colorMaster",
    "colorStatus",
    "bgIndex",
    "bgMaster",
    "bgStatus",
    "bgAppointment",
    "sourceTs",
    "rowHash",
    "updatedAt",
  ],

  // ✅ JSON cache sheet
  JSON_HEADERS: ["timestamp", "hash", "json"],
};

function doGet(e) {
  try {
    const mode = (e && e.parameter && e.parameter.mode) || "ping";
    if (mode === "ping") return jsonResponse_({ ok: true, mode, ts: new Date().toISOString() });

    if (mode === "sheet_all") {
      const data = handleSheetAll_();
      return jsonResponse_({ ok: true, mode, ...data, ts: new Date().toISOString() });
    }

    return jsonResponse_({ ok: false, error: "Unknown mode", mode });
  } catch (err) {
    return jsonResponse_({ ok: false, error: errToString_(err) });
  }
}

function doPost(e) {
  try {
    const payload = parseJsonPayload_(e);
    if (payload.mode !== "snapshot_v1") return jsonResponse_({ ok: false, error: "Unknown mode" });

    const res = handleSnapshotV1_(payload);
    return jsonResponse_({ ok: true, mode: "snapshot_v1", ...res });
  } catch (err) {
    return jsonResponse_({ ok: false, error: errToString_(err) });
  }
}

function handleSnapshotV1_(payload) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) throw new Error("LOCK_TIMEOUT");

  try {
    const ts = payload.timestamp || new Date().toISOString();
    const body = Array.isArray(payload.body) ? payload.body : [];
    const foot = Array.isArray(payload.foot) ? payload.foot : [];

    const shBody = getOrCreateSheet_(CONFIG.SHEET_BODY);
    const shFoot = getOrCreateSheet_(CONFIG.SHEET_FOOT);
    ensureHeader_(shBody, CONFIG.ROW_HEADERS);
    ensureHeader_(shFoot, CONFIG.ROW_HEADERS);

    // ✅ 依舊版 schema 寫入 Data_*
    overwriteTable_(shBody, CONFIG.ROW_HEADERS, body, ts);
    overwriteTable_(shFoot, CONFIG.ROW_HEADERS, foot, ts);

    const shBodyJson = getOrCreateSheet_(CONFIG.SHEET_BODY_JSON);
    const shFootJson = getOrCreateSheet_(CONFIG.SHEET_FOOT_JSON);
    ensureHeader_(shBodyJson, CONFIG.JSON_HEADERS);
    ensureHeader_(shFootJson, CONFIG.JSON_HEADERS);

    // ✅ Hash：stableForHash_ (不含 timestamp) → MD5
    const bodyHash = md5Hex_(JSON.stringify(stableForHash_(body)));
    const footHash = md5Hex_(JSON.stringify(stableForHash_(foot)));

    upsertSingleJsonRow_(shBodyJson, ts, bodyHash, JSON.stringify(body));
    upsertSingleJsonRow_(shFootJson, ts, footHash, JSON.stringify(foot));

    CacheService.getScriptCache().remove("sheet_all_cache_v1");

    return { timestamp: ts, bodyCount: body.length, footCount: foot.length };
  } finally {
    lock.releaseLock();
  }
}

function handleSheetAll_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("sheet_all_cache_v1");
  if (cached) return JSON.parse(cached);

  const shBodyJson = getOrCreateSheet_(CONFIG.SHEET_BODY_JSON);
  const shFootJson = getOrCreateSheet_(CONFIG.SHEET_FOOT_JSON);
  ensureHeader_(shBodyJson, CONFIG.JSON_HEADERS);
  ensureHeader_(shFootJson, CONFIG.JSON_HEADERS);

  const bodyObj = readSingleJsonRow_(shBodyJson);
  const footObj = readSingleJsonRow_(shFootJson);

  const res = {
    body: bodyObj.json ? JSON.parse(bodyObj.json) : [],
    foot: footObj.json ? JSON.parse(footObj.json) : [],
    bodyMeta: { timestamp: bodyObj.timestamp || "", hash: bodyObj.hash || "" },
    footMeta: { timestamp: footObj.timestamp || "", hash: footObj.hash || "" },
  };

  cache.put("sheet_all_cache_v1", JSON.stringify(res), CONFIG.JSON_CACHE_TTL_SEC);
  return res;
}

/* ===== helpers ===== */

function ss_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getOrCreateSheet_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function ensureHeader_(sh, headers) {
  const need = headers.length;
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, need).setValues([headers]);
    return;
  }
  const exist = sh.getRange(1, 1, 1, need).getDisplayValues()[0] || [];
  const same = headers.every((h, i) => String(exist[i] || "").trim() === h);
  if (!same) sh.getRange(1, 1, 1, need).setValues([headers]);
}

/**
 * ✅ 覆寫 Data_* 表（舊版欄位）
 * - sourceTs  : r.timestamp 或 payloadTs（會盡量轉成 yyyy/MM/dd HH:mm:ss，失敗則保留原字串）
 * - rowHash   : MD5(JSON.stringify(r))
 * - updatedAt : server now（台灣正常格式）
 */
function overwriteTable_(sh, headers, rows, payloadTs) {
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(sh.getLastColumn(), headers.length);
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, lastCol).clearContent();

  // ✅ updatedAt：統一用台灣正常格式
  const now = new Date();
  const updatedAt = fmtTs_(now); // yyyy/MM/dd HH:mm:ss

  const values = (rows || []).map((r) => {
    r = r || {};

    // ✅ sourceTs：優先 r.timestamp，其次 payloadTs；可解析就格式化，否則保留原字串
    const rawSource = (r.timestamp ?? payloadTs ?? "");
    const sourceTs = fmtTs_(rawSource);

    const rowHash = md5Hex_(JSON.stringify(r));

    return [
      r.masterId ?? "",
      r.index ?? "",
      r.sort ?? "",
      r.status ?? "",
      r.appointment ?? "",
      r.remaining ?? "",
      r.colorIndex ?? "",
      r.colorMaster ?? "",
      r.colorStatus ?? "",
      r.bgIndex ?? "",
      r.bgMaster ?? "",
      r.bgStatus ?? "",
      r.bgAppointment ?? "",
      sourceTs,
      rowHash,
      updatedAt,
    ];
  });

  if (values.length) sh.getRange(2, 1, values.length, headers.length).setValues(values);
}

/**
 * ✅ 將輸入轉成「yyyy/MM/dd HH:mm:ss」（預設用 Script 時區；建議專案時區設 Asia/Taipei）
 * 支援：
 * - Date
 * - ISO字串：2026-01-30T05:08:56.899Z
 * - 毫秒數字/字串：1700000000000
 * - 其他不可解析字串：原樣回傳
 */
function fmtTs_(input) {
  if (input === null || input === undefined || input === "") return "";

  const d = parseToDate_(input);
  if (!d) return String(input); // 無法解析就原樣保留（避免資料被吃掉）

  // 取 Script 時區（到 Apps Script 專案設定裡設 Asia/Taipei 最穩）
  const tz = Session.getScriptTimeZone() || "Asia/Taipei";
  return Utilities.formatDate(d, tz, "yyyy/MM/dd HH:mm:ss");
}

/**
 * ✅ 盡量把 input 轉成 Date
 * 回傳 Date 或 null
 */
function parseToDate_(input) {
  try {
    if (input instanceof Date) return isNaN(input.getTime()) ? null : input;

    // number：視為 epoch ms
    if (typeof input === "number") {
      const d = new Date(input);
      return isNaN(d.getTime()) ? null : d;
    }

    const s = String(input).trim();
    if (!s) return null;

    // 全數字：視為 epoch ms（避免 "1700000000000"）
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      const d = new Date(n);
      return isNaN(d.getTime()) ? null : d;
    }

    // 其他字串：交給 Date parse（可吃 ISO、RFC 等）
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  } catch (e) {
    return null;
  }
}


function upsertSingleJsonRow_(sh, ts, hash, jsonStr) {
  sh.getRange(2, 1, 1, CONFIG.JSON_HEADERS.length).setValues([[ts, hash, jsonStr]]);
}

function readSingleJsonRow_(sh) {
  if (sh.getLastRow() < 2) return { timestamp: "", hash: "", json: "" };
  const row = sh.getRange(2, 1, 1, CONFIG.JSON_HEADERS.length).getDisplayValues()[0];
  return { timestamp: row[0] || "", hash: row[1] || "", json: row[2] || "" };
}

/**
 * ✅ stableForHash_: 不含 timestamp（避免每次都變）
 * 用於 BodyDataJson / FootDataJson 的 hash 欄位
 */
function stableForHash_(rows) {
  return (rows || []).map((r) => ({
    index: r?.index ?? "",
    sort: r?.sort ?? "",
    masterId: r?.masterId ?? "",
    status: r?.status ?? "",
    appointment: r?.appointment ?? "",
    remaining: r?.remaining ?? "",
    colorIndex: r?.colorIndex ?? "",
    colorMaster: r?.colorMaster ?? "",
    colorStatus: r?.colorStatus ?? "",
    bgIndex: r?.bgIndex ?? "",
    bgMaster: r?.bgMaster ?? "",
    bgStatus: r?.bgStatus ?? "",
    bgAppointment: r?.bgAppointment ?? "",
  }));
}

/**
 * ✅ MD5 hex (GAS: Utilities.computeDigest)
 */
function md5Hex_(s) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    String(s ?? ""),
    Utilities.Charset.UTF_8
  );
  return bytes
    .map((b) => {
      const v = b < 0 ? b + 256 : b;
      return v.toString(16).padStart(2, "0");
    })
    .join("");
}

function parseJsonPayload_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error("NO_POST_DATA");
  return JSON.parse(e.postData.contents);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function errToString_(err) {
  try {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    if (err.message) return err.message;
    return JSON.stringify(err);
  } catch (e) {
    return String(err);
  }
}
