/**
 * Edge GAS - ScriptCache + Sheet mirror
 * Ultra FAST edge cache + visible sheet storage
 *
 * ✅ Added:
 * - GET ?mode=cache_one&masterId=xxx  (for app.js Edge Cache Reader v5)
 *   returns { ok:true, masterId, body:{}, foot:{} } OR { ok:false, error:"cache_miss" }
 */

var CONFIG = {
  CACHE_SEC: 30,

  // ✅ Edge 試算表內要落地的工作表名
  SHEET_BODY: "Data_Body",
  SHEET_FOOT: "Data_Foot",
  SHEET_PUSH_LOG: "EdgePushLog", // optional: 推送紀錄
  LOG_MAX_ROWS: 300
};

/* ===========================
 * Utils
 * =========================== */
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
function isoNow_() {
  return new Date().toISOString();
}
function normDigits_(v) {
  return String(v == null ? "" : v).replace(/[^\d]/g, "");
}

/* ===========================
 * Cache helpers
 * =========================== */
function cachePut_(key, obj, sec) {
  CacheService.getScriptCache().put(key, JSON.stringify(obj), sec || CONFIG.CACHE_SEC);
}
function cacheGet_(key) {
  var v = CacheService.getScriptCache().get(key);
  return v ? JSON.parse(v) : null;
}

/* ===========================
 * Sheet helpers (Edge)
 * =========================== */
function getSheet_(name) {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function ensureHeader_Data_(sh) {
  var h = [
    "masterId","index","sort","status","appointment","remaining",
    "colorIndex","colorMaster","colorStatus",
    "bgIndex","bgMaster","bgStatus","bgAppointment",
    "sourceTs","updatedAt"
  ];
  if (sh.getLastRow() === 0) sh.getRange(1,1,1,h.length).setValues([h]);
}

function ensureHeader_Log_(sh) {
  var h = ["serverTs","payloadTs","hasBody","hasFoot","bodyCount","footCount","note"];
  if (sh.getLastRow() === 0) sh.getRange(1,1,1,h.length).setValues([h]);
}

function trimLog_(sh) {
  var max = CONFIG.LOG_MAX_ROWS;
  if (!max || max <= 0) return;
  var last = sh.getLastRow();
  var rows = Math.max(0, last - 1);
  if (rows <= max) return;
  sh.deleteRows(2, rows - max);
}

function writePanelToSheet_(sheetName, ts, rows) {
  var sh = getSheet_(sheetName);
  ensureHeader_Data_(sh);

  rows = rows || [];
  var now = isoNow_();

  var values = rows.map(function(r) {
    r = r || {};
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
      r.timestamp || ts || "",
      now
    ];
  });

  if (values.length) {
    sh.getRange(2,1,values.length,15).setValues(values);
  }

  var old = sh.getLastRow() - 1;
  if (old > values.length) {
    sh.getRange(2 + values.length, 1, old - values.length, 15).clearContent();
  }
}

function appendPushLog_(payloadTs, hasBody, hasFoot, bodyCount, footCount, note) {
  var sh = getSheet_(CONFIG.SHEET_PUSH_LOG);
  ensureHeader_Log_(sh);

  sh.getRange(sh.getLastRow() + 1, 1, 1, 7).setValues([[
    isoNow_(),
    payloadTs || "",
    hasBody ? "Y" : "",
    hasFoot ? "Y" : "",
    bodyCount || 0,
    footCount || 0,
    note || ""
  ]]);

  trimLog_(sh);
}

/* ===========================
 * Format appointment cell
 * =========================== */
function formatApptCell_(v) {
  if (v == null || v === "") return "";

  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
    if (v.getFullYear() === 1899 && v.getMonth() === 11 && v.getDate() === 30) {
      return Utilities.formatDate(v, "Asia/Taipei", "HH:mm");
    }
    return Utilities.formatDate(v, "Asia/Taipei", "yyyy-MM-dd HH:mm");
  }

  return String(v).trim();
}

/* ===========================
 * Read sheet rows for API
 * =========================== */
function readPanelSheetAsRows_(sheetName) {
  var sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sh) return [];

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var header = values[0].map(function (h) { return String(h || "").trim(); });

  function idx_(name) {
    var i = header.indexOf(name);
    return i >= 0 ? i : -1;
  }

  var iMasterId = idx_("masterId");
  var iIndex = idx_("index");
  var iSort = idx_("sort");
  var iStatus = idx_("status");
  var iAppt = idx_("appointment");
  var iRemain = idx_("remaining");

  var iColorIndex = idx_("colorIndex");
  var iColorMaster = idx_("colorMaster");
  var iColorStatus = idx_("colorStatus");

  var iBgIndex = idx_("bgIndex");
  var iBgMaster = idx_("bgMaster");
  var iBgStatus = idx_("bgStatus");
  var iBgAppt = idx_("bgAppointment");

  var iTs = idx_("sourceTs");

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var masterId = iMasterId >= 0 ? row[iMasterId] : "";
    if (masterId === "" || masterId == null) continue;

    out.push({
      masterId: String(masterId || "").trim(),
      index: iIndex >= 0 ? row[iIndex] : "",
      sort: iSort >= 0 ? row[iSort] : "",
      status: iStatus >= 0 ? row[iStatus] : "",
      appointment: formatApptCell_(iAppt >= 0 ? row[iAppt] : ""),
      remaining: iRemain >= 0 ? row[iRemain] : "",

      colorIndex: iColorIndex >= 0 ? row[iColorIndex] : "",
      colorMaster: iColorMaster >= 0 ? row[iColorMaster] : "",
      colorStatus: iColorStatus >= 0 ? row[iColorStatus] : "",

      bgIndex: iBgIndex >= 0 ? row[iBgIndex] : "",
      bgMaster: iBgMaster >= 0 ? row[iBgMaster] : "",
      bgStatus: iBgStatus >= 0 ? row[iBgStatus] : "",
      bgAppointment: iBgAppt >= 0 ? row[iBgAppt] : "",

      timestamp: iTs >= 0 ? row[iTs] : ""
    });
  }

  return out;
}

/* ===========================
 * Find one tech row by masterId
 * =========================== */
function findOneByMasterId_(rows, masterId) {
  var target = normDigits_(masterId);
  if (!target) return null;

  rows = Array.isArray(rows) ? rows : [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    if (normDigits_(r.masterId) === target) return r;
  }
  return null;
}

/* ===========================
 * ✅ GET cache_one (for app.js)
 * =========================== */
function handleCacheOne_(masterId) {
  var bodyCache = cacheGet_("EDGE::body::latest"); // { ts, rows:[...] }
  var footCache = cacheGet_("EDGE::foot::latest");

  var bodyRows = bodyCache && Array.isArray(bodyCache.rows) ? bodyCache.rows : null;
  var footRows = footCache && Array.isArray(footCache.rows) ? footCache.rows : null;

  // fallback to sheet if cache empty
  if (!bodyRows) bodyRows = readPanelSheetAsRows_(CONFIG.SHEET_BODY);
  if (!footRows) footRows = readPanelSheetAsRows_(CONFIG.SHEET_FOOT);

  var bodyHit = findOneByMasterId_(bodyRows, masterId);
  var footHit = findOneByMasterId_(footRows, masterId);

  if (!bodyHit && !footHit) {
    return json_({ ok: false, error: "cache_miss", masterId: String(masterId || "") });
  }

  // normalize output expected by front-end:
  // { ok:true, masterId, body:{status,appointment,remaining,timestamp}, foot:{...} }
  function normalizeOut_(r) {
    if (!r) return null;
    return {
      status: r.status != null ? String(r.status) : "",
      appointment: r.appointment != null ? String(r.appointment) : "",
      remaining: r.remaining != null ? r.remaining : "",
      timestamp: r.timestamp != null ? String(r.timestamp) : ""
    };
  }

  return json_({
    ok: true,
    masterId: String(masterId || ""),
    body: normalizeOut_(bodyHit),
    foot: normalizeOut_(footHit),
    edgeTs: isoNow_()
  });
}

/* ===========================
 * POST: receive from Origin
 * =========================== */
function doPost(e) {
  try {
    // CORS preflight support (optional)
    if (
      e &&
      e.postData &&
      e.postData.type &&
      String(e.postData.type).indexOf("text/plain") === 0 &&
      e.postData.contents === "_cors_preflight_"
    ) {
      return json_({ ok: true, preflight: true });
    }

    var raw = (e && e.postData && e.postData.contents) || "{}";
    var data = JSON.parse(raw);

    if (data.mode !== "edge_sync_v1") {
      appendPushLog_("", false, false, 0, 0, "bad_mode");
      return json_({ ok: false, err: "bad_mode" });
    }

    var ts = data.timestamp || isoNow_();
    var hasBody = Array.isArray(data.body);
    var hasFoot = Array.isArray(data.foot);

    // cache + mirror sheet
    if (hasBody) {
      cachePut_("EDGE::body::latest", { ts: ts, rows: data.body });
      writePanelToSheet_(CONFIG.SHEET_BODY, ts, data.body);
    }

    if (hasFoot) {
      cachePut_("EDGE::foot::latest", { ts: ts, rows: data.foot });
      writePanelToSheet_(CONFIG.SHEET_FOOT, ts, data.foot);
    }

    cachePut_("EDGE::meta::timestamp", ts);

    appendPushLog_(
      ts,
      hasBody, hasFoot,
      hasBody ? data.body.length : 0,
      hasFoot ? data.foot.length : 0,
      "ok"
    );

    return json_({ ok: true, serverTs: isoNow_() });

  } catch (err) {
    appendPushLog_("", false, false, 0, 0, "err:" + String(err));
    return json_({ ok: false, err: String(err) });
  }
}

/* ===========================
 * GET: read cache/sheet (Edge)
 * - mode=sheet_all：讀 Data_Body / Data_Foot
 * - mode=cache_one&masterId=xxx：回單一技師（給前端）
 * - 保留原本 panel=body/foot/meta
 * =========================== */
function doGet(e) {
  var q = (e && e.parameter) || {};

  // preflight
  if (q && q._cors === "preflight") return json_({ ok: true, preflight: true });

  var mode = String(q.mode || "").trim();
  var panel = String(q.panel || "").trim();

  // ✅ NEW: for app.js
  if (mode === "cache_one") {
    return handleCacheOne_(q.masterId);
  }

  // ✅ existing: sheet_all
  if (mode === "sheet_all") {
    return json_({
      ok: true,
      source: "edge_sheet",
      timestamp: isoNow_(),
      body: readPanelSheetAsRows_(CONFIG.SHEET_BODY),
      foot: readPanelSheetAsRows_(CONFIG.SHEET_FOOT)
    });
  }

  // ✅ existing: cache panels
  if (panel === "body") return json_({ ok: true, panel: "body", data: cacheGet_("EDGE::body::latest") });
  if (panel === "foot") return json_({ ok: true, panel: "foot", data: cacheGet_("EDGE::foot::latest") });
  if (panel === "meta") return json_({ ok: true, panel: "meta", data: cacheGet_("EDGE::meta::timestamp") });

  return json_({ ok: false, err: "invalid_mode" });
}
