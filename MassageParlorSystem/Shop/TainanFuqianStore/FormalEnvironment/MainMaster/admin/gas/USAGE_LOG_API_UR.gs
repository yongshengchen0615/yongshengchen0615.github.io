/**
 * GAS Web App: Usage Logger
 * - 寫入台北時間 yyyy/MM/dd HH:mm:ss
 * - 額外保留 tsIso 欄位（ISO 原始時間）方便 debug
 * - 新增 listUsageLog：讀取並回傳前端顯示所需三欄（ts / actorUserId / actorDisplayName）
 */

const USAGE_LOG_SHEET_NAME = "UsageLog";
const TZ = "Asia/Taipei";
const TS_FMT = "yyyy/MM/dd HH:mm:ss";

function doGet(e) {
  return json_({
    ok: true,
    hint: "POST JSON with mode=appendUsageLog | listUsageLog",
    modes: ["appendUsageLog", "listUsageLog"],
  });
}

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    const mode = String(payload.mode || "").trim();

    const ss = getTargetSpreadsheet_();
    const sheet = getOrCreateSheet_(ss, USAGE_LOG_SHEET_NAME);

    // Header (idempotent) - 仍維持你原本 9 欄
    ensureHeader_(sheet, [
      "ts", // ✅ 台北時間字串
      "tsIso", // ✅ ISO(UTC) 原始字串
      "event",
      "actorUserId",
      "actorDisplayName",
      "pageHref",
      "pagePath",
      "ua",
      "dataJson",
    ]);

    if (mode === "appendUsageLog") {
      // ---- 時間處理：輸出 ts=台北時間字串 + tsIso=ISO ----
      const { tsText, tsIso } = normalizeTs_(payload.ts);

      const eventName = String(payload.event || "unknown");
      const actorUserId = payload.actor && payload.actor.userId ? String(payload.actor.userId) : "";
      const actorDisplayName =
        payload.actor && payload.actor.displayName ? String(payload.actor.displayName) : "";
      const pageHref = payload.page && payload.page.href ? String(payload.page.href) : "";
      const pagePath = payload.page && payload.page.path ? String(payload.page.path) : "";
      const ua = String(payload.ua || "");
      const dataJson = JSON.stringify(payload.data || {});

      sheet.appendRow([
        tsText,
        tsIso,
        eventName,
        actorUserId,
        actorDisplayName,
        pageHref,
        pagePath,
        ua,
        dataJson,
      ]);

      return json_({ ok: true, ts: tsText, tsIso });
    }

    if (mode === "listUsageLog") {
      // 前端可送 limit；不送就預設 200
      const limitRaw = Number(payload.limit);
      const limit = clamp_(isFinite(limitRaw) ? Math.floor(limitRaw) : 200, 1, 1000);

      const lastRow = sheet.getLastRow();
      if (lastRow <= 1) return json_({ ok: true, rows: [] });

      const startRow = Math.max(2, lastRow - limit + 1);
      const numRows = lastRow - startRow + 1;

      // 讀取 9 欄，但只回傳三欄給前端顯示
      const values = sheet.getRange(startRow, 1, numRows, 9).getValues();

      const rows = values
        .map((r) => ({
          ts: String(r[0] ?? ""),
          actorUserId: String(r[3] ?? ""),
          actorDisplayName: String(r[4] ?? ""),
        }))
        .reverse(); // 最新在最上面；若你要舊到新，把 reverse() 拿掉

      return json_({ ok: true, rows });
    }

    return json_({ ok: false, error: "unsupported mode" });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.stack ? err.stack : err) });
  }
}

/**
 * payload.ts 可能是：
 * - 空：用伺服器現在時間
 * - ISO 字串：2026-01-07T02:57:35.380Z
 * - 其他可被 Date parse 的字串/數字
 *
 * 回傳：
 * - tsText：台北時間 yyyy/MM/dd HH:mm:ss
 * - tsIso：ISO(UTC) 字串
 */
function normalizeTs_(inputTs) {
  let d;

  if (inputTs === undefined || inputTs === null || String(inputTs).trim() === "") {
    d = new Date(); // server now
  } else {
    // 支援 ISO/epoch/一般字串
    d = new Date(inputTs);
    if (isNaN(d.getTime())) {
      // parse 失敗就 fallback 用 server now
      d = new Date();
    }
  }

  const tsIso = d.toISOString(); // 永遠是 UTC Z
  const tsText = Utilities.formatDate(d, TZ, TS_FMT); // ✅ 台北時間字串
  return { tsText, tsIso };
}

function clamp_(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function parsePayload_(e) {
  if (!e) return {};

  // JSON body (text/plain / application/json)
  if (e.postData && e.postData.contents) {
    const raw = String(e.postData.contents);
    try {
      return JSON.parse(raw);
    } catch (_ignored) {}
  }

  // Fallback: form encoded
  return e.parameter || {};
}

function getTargetSpreadsheet_() {
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (_ignored) {}

  const id = PropertiesService.getScriptProperties().getProperty("USAGE_LOG_SPREADSHEET_ID");
  if (!id) throw new Error("Missing Script Property: USAGE_LOG_SPREADSHEET_ID (standalone only)");
  return SpreadsheetApp.openById(id);
}

function getOrCreateSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  return sheet ? sheet : ss.insertSheet(name);
}

function ensureHeader_(sheet, header) {
  const firstRow = sheet.getRange(1, 1, 1, header.length).getValues()[0];
  const matches = header.every((h, i) => String(firstRow[i] || "").trim() === h);
  if (!matches) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}