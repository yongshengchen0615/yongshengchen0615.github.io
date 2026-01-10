/**
 * Master Access Auth WebApp (no LINE login)
 *
 * Concept:
 * - Master approves guests by issuing a short-lived, single-use invite token.
 * - Guest opens dashboard with ?token=...; frontend exchanges token for a sessionId.
 * - Dashboard checks sessionId on each load.
 *
 * Endpoints (POST recommended to avoid CORS preflight):
 * - POST {entity:"auth", action:"issue", data:{ masterId, passphrase, ttlMinutes? }}
 * - POST {entity:"auth", action:"exchange", data:{ masterId, token }}
 * - POST {entity:"auth", action:"check", data:{ masterId, sessionId }}
 *
 * Storage:
 * - Sheet `Invites`: TokenId | MasterId | ExpiresAtMs | UsedAtMs | CreatedAtMs
 * - Sheet `Sessions`: SessionId | MasterId | RequestId | ExpiresAtMs | RevokedAtMs | CreatedAtMs | LastSeenAtMs
 *
 * Setup:
 * 1) In Apps Script: Project Settings -> Script Properties:
 *    - AUTH_SECRET: a long random secret
 *    - MASTER_PASSPHRASE: the master admin passphrase
 * 2) Deploy as WebApp (Execute as: Me, access: Anyone)
 */

const INVITES_SHEET = "Invites";
const SESSIONS_SHEET = "Sessions";
const REQUESTS_SHEET = "Requests";

// Once approved, guests should be able to exchange at any time.
// Use a very long invite TTL (practically permanent) while keeping token single-use.
const INVITE_TTL_MINUTES = 3650 * 24 * 60; // ~10 years

function doGet(e) {
  try {
    return json_({
      ok: true,
      hint: "Master Access Auth WebApp",
      endpoints: [
        "POST {entity:'auth', action:'issue', data:{masterId, passphrase, ttlMinutes?}}",
        "POST {entity:'auth', action:'passphrase_verify', data:{passphrase}}",
        "POST {entity:'auth', action:'passphrase_change', data:{oldPassphrase, newPassphrase}}",
        "POST {entity:'auth', action:'request', data:{masterId, guestName, guestNote?}}",
        "POST {entity:'auth', action:'requests_list', data:{masterId, passphrase, status?}}",
        "POST {entity:'auth', action:'requests_approve', data:{masterId, passphrase, requestId, ttlMinutes?}}",
        "POST {entity:'auth', action:'requests_deny', data:{masterId, passphrase, requestId}}",
        "POST {entity:'auth', action:'requests_delete', data:{masterId, passphrase, requestId}}",
        "POST {entity:'auth', action:'open_status', data:{masterId}}",
        "POST {entity:'auth', action:'exchange', data:{masterId, token}}",
        "POST {entity:'auth', action:'check', data:{masterId, sessionId}}",
      ],
      now: Date.now(),
    });
  } catch (err) {
    return jsonError_(err);
  }
}

function doPost(e) {
  try {
    const payload = readJsonBody_(e);
    const entity = String(payload.entity || "").trim();
    const action = String(payload.action || "").trim();
    const data = payload.data || {};

    if (entity === "auth" && action === "passphrase_verify") {
      const passphrase = String(data.passphrase || "");
      assertPassphrase_(passphrase);
      return json_({ ok: true, now: Date.now() });
    }

    if (entity === "auth" && action === "passphrase_change") {
      const oldPassphrase = String(data.oldPassphrase || "");
      const newPassphraseRaw = String(data.newPassphrase || "");
      assertPassphrase_(oldPassphrase);

      const newPassphrase = String(newPassphraseRaw || "").trim();
      if (!newPassphrase) throw new Error("NEW_PASSPHRASE_REQUIRED");
      if (newPassphrase.length < 4) throw new Error("NEW_PASSPHRASE_TOO_SHORT");
      if (newPassphrase.length > 80) throw new Error("NEW_PASSPHRASE_TOO_LONG");

      PropertiesService.getScriptProperties().setProperty("MASTER_PASSPHRASE", newPassphrase);
      return json_({ ok: true, now: Date.now() });
    }

    if (entity === "auth" && action === "issue") {
      const masterId = normalizeMasterId_(data.masterId);
      const passphrase = String(data.passphrase || "");
      const ttlMinutes = INVITE_TTL_MINUTES;

      assertPassphrase_(passphrase);
      const res = issueInvite_({ masterId, ttlMinutes });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    if (entity === "auth" && action === "request") {
      const masterId = normalizeMasterId_(data.masterId);
      const guestName = normalizeGuestName_(data.guestName);
      const guestNote = normalizeGuestNote_(data.guestNote);
      const res = createRequest_({ masterId, guestName, guestNote });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    if (entity === "auth" && action === "requests_list") {
      const masterId = normalizeMasterId_(data.masterId);
      const passphrase = String(data.passphrase || "");
      const status = normalizeRequestStatus_(data.status || "pending");
      assertPassphrase_(passphrase);
      const res = listRequests_({ masterId, status });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    if (entity === "auth" && action === "requests_approve") {
      const masterId = normalizeMasterId_(data.masterId);
      const passphrase = String(data.passphrase || "");
      const requestId = String(data.requestId || "").trim();
      const ttlMinutes = INVITE_TTL_MINUTES;
      const dashboardUrl = normalizeDashboardUrl_(data.dashboardUrl);
      assertPassphrase_(passphrase);
      const res = approveRequest_({ masterId, requestId, ttlMinutes, dashboardUrl });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    if (entity === "auth" && action === "requests_deny") {
      const masterId = normalizeMasterId_(data.masterId);
      const passphrase = String(data.passphrase || "");
      const requestId = String(data.requestId || "").trim();
      assertPassphrase_(passphrase);
      const res = denyRequest_({ masterId, requestId });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    if (entity === "auth" && action === "requests_delete") {
      const masterId = normalizeMasterId_(data.masterId);
      const passphrase = String(data.passphrase || "");
      const requestId = String(data.requestId || "").trim();
      assertPassphrase_(passphrase);
      const res = deleteRequest_({ masterId, requestId });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    if (entity === "auth" && action === "open_status") {
      const masterId = normalizeMasterId_(data.masterId);
      if (!masterId) throw new Error("MASTER_ID_REQUIRED");
      // This variant does not implement Users-sheet gate; treat as open.
      return json_({ ok: true, approved: true, enabled: true, found: false, now: Date.now() });
    }

    if (entity === "auth" && action === "exchange") {
      const masterId = normalizeMasterId_(data.masterId);
      const token = String(data.token || "").trim();
      const res = exchangeInviteForSession_({ masterId, token });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    if (entity === "auth" && action === "check") {
      const masterId = normalizeMasterId_(data.masterId);
      const sessionId = String(data.sessionId || "").trim();
      const ok = checkSession_({ masterId, sessionId });
      return json_({ ok, now: Date.now() });
    }

    return json_({ ok: false, error: "UNSUPPORTED", received: { entity, action } });
  } catch (err) {
    return jsonError_(err);
  }
}

function createRequest_({ masterId, guestName, guestNote }) {
  if (!masterId) throw new Error("MASTER_ID_REQUIRED");
  if (!guestName) throw new Error("GUEST_NAME_REQUIRED");

  const now = Date.now();
  const requestId = shortId_();

  const sh = ensureSheet_(
    REQUESTS_SHEET,
    [
      "RequestId",
      "MasterId",
      "GuestName",
      "GuestNote",
      "Status",
      "CreatedAtMs",
      "ApprovedAtMs",
      "DeniedAtMs",
      "ApprovedToken",
      "TokenExpiresAtMs",
      "ApprovedLink",
    ]
  );

  sh.appendRow([requestId, masterId, guestName, guestNote, "pending", now, "", "", "", "", ""]);

  return { requestId, status: "pending" };
}

function listRequests_({ masterId, status }) {
  if (!masterId) throw new Error("MASTER_ID_REQUIRED");
  const st = normalizeRequestStatus_(status || "pending");

  const sh = ensureSheet_(
    REQUESTS_SHEET,
    [
      "RequestId",
      "MasterId",
      "GuestName",
      "GuestNote",
      "Status",
      "CreatedAtMs",
      "ApprovedAtMs",
      "DeniedAtMs",
      "ApprovedToken",
      "TokenExpiresAtMs",
      "ApprovedLink",
    ]
  );

  const values = sh.getDataRange().getValues();
  const out = [];
  for (let r = 2; r <= values.length; r++) {
    const row = values[r - 1];
    const rowMaster = normalizeMasterId_(row[1]);
    if (rowMaster !== masterId) continue;
    const rowStatus = String(row[4] || "").trim();
    if (st && rowStatus !== st) continue;

    out.push({
      requestId: String(row[0] || "").trim(),
      masterId: rowMaster,
      guestName: String(row[2] || "").trim(),
      guestNote: String(row[3] || "").trim(),
      status: rowStatus,
      createdAtMs: Number(row[5]) || 0,
      approvedAtMs: Number(row[6]) || 0,
      deniedAtMs: Number(row[7]) || 0,
      token: String(row[8] || "").trim(),
      tokenExpiresAtMs: Number(row[9]) || 0,
      approvedLink: String(row[10] || "").trim(),
    });
  }

  out.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  return { rows: out };
}

function approveRequest_({ masterId, requestId, ttlMinutes, dashboardUrl }) {
  if (!masterId) throw new Error("MASTER_ID_REQUIRED");
  if (!requestId) throw new Error("REQUEST_ID_REQUIRED");

  const sh = ensureSheet_(
    REQUESTS_SHEET,
    [
      "RequestId",
      "MasterId",
      "GuestName",
      "GuestNote",
      "Status",
      "CreatedAtMs",
      "ApprovedAtMs",
      "DeniedAtMs",
      "ApprovedToken",
      "TokenExpiresAtMs",
      "ApprovedLink",
    ]
  );

  const values = sh.getDataRange().getValues();
  let rowNo = -1;
  let row = null;
  for (let r = 2; r <= values.length; r++) {
    const rid = String(values[r - 1][0] || "").trim();
    if (rid === requestId) {
      rowNo = r;
      row = values[r - 1];
      break;
    }
  }
  if (rowNo < 0) throw new Error("REQUEST_NOT_FOUND");

  const rowMaster = normalizeMasterId_(row[1]);
  if (rowMaster !== masterId) throw new Error("REQUEST_MASTER_MISMATCH");

  const status = String(row[4] || "").trim();
  if (status === "approved") {
    return {
      requestId,
      status: "approved",
      token: String(row[8] || "").trim(),
      expiresAtMs: Number(row[9]) || 0,
      approvedLink: String(row[10] || "").trim(),
    };
  }
  if (status === "denied") throw new Error("REQUEST_ALREADY_DENIED");

  const ttl = clampInt_(Number(ttlMinutes || 60), 5, 1440);
  const issued = issueInvite_({ masterId, ttlMinutes: ttl });
  const now = Date.now();

  const approvedLink = buildApprovedLink_(dashboardUrl, issued.token);

  // Columns:
  // 5 Status, 7 ApprovedAtMs, 8 DeniedAtMs, 9 ApprovedToken, 10 TokenExpiresAtMs, 11 ApprovedLink
  sh.getRange(rowNo, 5, 1, 1).setValue("approved");
  sh.getRange(rowNo, 7, 1, 1).setValue(String(now));
  sh.getRange(rowNo, 8, 1, 1).setValue("");
  sh.getRange(rowNo, 9, 1, 1).setValue(issued.token);
  sh.getRange(rowNo, 10, 1, 1).setValue(String(issued.expiresAtMs));
  sh.getRange(rowNo, 11, 1, 1).setValue(approvedLink);

  return {
    requestId,
    status: "approved",
    token: issued.token,
    expiresAtMs: issued.expiresAtMs,
    approvedLink,
  };
}

function deleteRequest_({ masterId, requestId }) {
  if (!masterId) throw new Error("MASTER_ID_REQUIRED");
  if (!requestId) throw new Error("REQUEST_ID_REQUIRED");

  const sh = ensureSheet_(
    REQUESTS_SHEET,
    [
      "RequestId",
      "MasterId",
      "GuestName",
      "GuestNote",
      "Status",
      "CreatedAtMs",
      "ApprovedAtMs",
      "DeniedAtMs",
      "ApprovedToken",
      "TokenExpiresAtMs",
      "ApprovedLink",
    ]
  );

  const values = sh.getDataRange().getValues();
  let rowNo = -1;
  let row = null;
  for (let r = 2; r <= values.length; r++) {
    const rid = String(values[r - 1][0] || "").trim();
    if (rid === requestId) {
      rowNo = r;
      row = values[r - 1];
      break;
    }
  }
  if (rowNo < 0) throw new Error("REQUEST_NOT_FOUND");

  const rowMaster = normalizeMasterId_(row[1]);
  if (rowMaster !== masterId) throw new Error("REQUEST_MASTER_MISMATCH");

  const approvedToken = String(row[8] || "").trim();

  // Revoke all active sessions issued from this request (if any)
  const revokedCount = revokeSessionsByRequestId_({ masterId, requestId });

  // Also revoke unused invite token (if any) so deleted guests cannot exchange later.
  if (approvedToken) revokeInviteByToken_({ masterId, token: approvedToken });

  // Delete the request row (remove guest from list)
  sh.deleteRow(rowNo);

  return { requestId, status: "deleted", revokedCount };
}

function revokeInviteByToken_({ masterId, token }) {
  try {
    const m = normalizeMasterId_(masterId);
    const t = String(token || "").trim();
    if (!m || !t) return 0;

    const parts = t.split(".");
    if (parts.length !== 2) return 0;
    const tokenId = String(parts[0] || "").trim();
    if (!tokenId) return 0;

    const invites = ensureSheet_(INVITES_SHEET, ["TokenId", "MasterId", "ExpiresAtMs", "UsedAtMs", "CreatedAtMs"]);
    const data = invites.getDataRange().getValues();
    const now = Date.now();

    for (let r = 2; r <= data.length; r++) {
      const row = data[r - 1];
      const rowTokenId = String(row[0] || "").trim();
      if (rowTokenId !== tokenId) continue;
      const rowMaster = normalizeMasterId_(row[1]);
      if (rowMaster !== m) return 0;
      const usedAtMs = String(row[3] || "").trim();
      if (usedAtMs) return 0;
      invites.getRange(r, 4, 1, 1).setValue(String(now));
      return 1;
    }
  } catch {
    // ignore
  }
  return 0;
}

function denyRequest_({ masterId, requestId }) {
  if (!masterId) throw new Error("MASTER_ID_REQUIRED");
  if (!requestId) throw new Error("REQUEST_ID_REQUIRED");

  const sh = ensureSheet_(
    REQUESTS_SHEET,
    [
      "RequestId",
      "MasterId",
      "GuestName",
      "GuestNote",
      "Status",
      "CreatedAtMs",
      "ApprovedAtMs",
      "DeniedAtMs",
      "ApprovedToken",
      "TokenExpiresAtMs",
      "ApprovedLink",
    ]
  );

  const values = sh.getDataRange().getValues();
  let rowNo = -1;
  let row = null;
  for (let r = 2; r <= values.length; r++) {
    const rid = String(values[r - 1][0] || "").trim();
    if (rid === requestId) {
      rowNo = r;
      row = values[r - 1];
      break;
    }
  }
  if (rowNo < 0) throw new Error("REQUEST_NOT_FOUND");

  const rowMaster = normalizeMasterId_(row[1]);
  if (rowMaster !== masterId) throw new Error("REQUEST_MASTER_MISMATCH");

  const status = String(row[4] || "").trim();
  if (status === "denied") return { requestId, status: "denied", deleted: false };
  if (status === "approved") throw new Error("REQUEST_ALREADY_APPROVED");

  // User requirement: deny => delete guest request data
  sh.deleteRow(rowNo);
  return { requestId, status: "deleted", deleted: true };
}

function normalizeDashboardUrl_(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  // basic validation: only allow http/https URLs
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

function buildApprovedLink_(dashboardUrl, token) {
  const base = String(dashboardUrl || "").trim();
  const t = String(token || "").trim();
  if (!base || !t) return "";
  try {
    const u = new URL(base);
    u.searchParams.set("token", t);
    return u.toString();
  } catch {
    return "";
  }
}

function issueInvite_({ masterId, ttlMinutes }) {
  if (!masterId) throw new Error("MASTER_ID_REQUIRED");

  const secret = getAuthSecret_();
  const now = Date.now();
  const expiresAtMs = now + ttlMinutes * 60 * 1000;

  const tokenId = randomId_();
  const sig = hmacBase64Url_(secret, [tokenId, masterId, String(expiresAtMs)].join("|"));
  const token = tokenId + "." + sig;

  const sh = ensureSheet_(INVITES_SHEET, ["TokenId", "MasterId", "ExpiresAtMs", "UsedAtMs", "CreatedAtMs"]);
  sh.appendRow([tokenId, masterId, expiresAtMs, "", now]);

  return { token, expiresAtMs };
}

function exchangeInviteForSession_({ masterId, token }) {
  if (!masterId) throw new Error("MASTER_ID_REQUIRED");
  if (!token) throw new Error("TOKEN_REQUIRED");

  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("TOKEN_FORMAT_INVALID");

  const tokenId = String(parts[0] || "").trim();
  const sig = String(parts[1] || "").trim();
  if (!tokenId || !sig) throw new Error("TOKEN_FORMAT_INVALID");

  const invites = ensureSheet_(INVITES_SHEET, ["TokenId", "MasterId", "ExpiresAtMs", "UsedAtMs", "CreatedAtMs"]);
  const data = invites.getDataRange().getValues();

  // find token row
  let rowNo = -1;
  let row = null;
  for (let r = 2; r <= data.length; r++) {
    const tokenIdCell = String(data[r - 1][0] || "").trim();
    if (tokenIdCell === tokenId) {
      rowNo = r;
      row = data[r - 1];
      break;
    }
  }
  if (rowNo < 0) throw new Error("TOKEN_NOT_FOUND");

  const rowMaster = normalizeMasterId_(row[1]);
  const expiresAtMs = Number(row[2]);
  const usedAtMs = String(row[3] || "").trim();

  if (rowMaster !== masterId) throw new Error("TOKEN_MASTER_MISMATCH");
  if (Number.isNaN(expiresAtMs)) throw new Error("TOKEN_BAD_ROW");
  if (expiresAtMs <= Date.now()) throw new Error("TOKEN_EXPIRED");
  if (usedAtMs) throw new Error("TOKEN_ALREADY_USED");

  // verify signature
  const secret = getAuthSecret_();
  const expectedSig = hmacBase64Url_(secret, [tokenId, masterId, String(expiresAtMs)].join("|"));
  if (!timingSafeEq_(expectedSig, sig)) throw new Error("TOKEN_SIGNATURE_INVALID");

  // mark used
  invites.getRange(rowNo, 4, 1, 1).setValue(String(Date.now()));

  // Try to map token -> requestId (so master can later revoke this guest)
  const requestId = findRequestIdByApprovedToken_({ masterId, token });

  // create session
  const sessionId = randomId_();
  // Requirement: once approved and exchanged on a device, guest can keep viewing indefinitely
  // (practically long-lived) unless the master rejects future applications.
  // The invite token itself remains single-use, so the same link cannot be used on multiple devices.
  const sessionTtlMs = 3650 * 24 * 60 * 60 * 1000; // ~10 years
  const now = Date.now();
  const sessionExpiresAtMs = now + sessionTtlMs;

  const sessions = ensureSheet_(SESSIONS_SHEET, [
    "SessionId",
    "MasterId",
    "RequestId",
    "ExpiresAtMs",
    "RevokedAtMs",
    "CreatedAtMs",
    "LastSeenAtMs",
  ]);
  sessions.appendRow([sessionId, masterId, requestId, sessionExpiresAtMs, "", now, now]);

  return { sessionId, expiresAtMs: sessionExpiresAtMs };
}

function checkSession_({ masterId, sessionId }) {
  if (!masterId) return false;
  if (!sessionId) return false;

  const sessions = ensureSheet_(SESSIONS_SHEET, [
    "SessionId",
    "MasterId",
    "RequestId",
    "ExpiresAtMs",
    "RevokedAtMs",
    "CreatedAtMs",
    "LastSeenAtMs",
  ]);
  const data = sessions.getDataRange().getValues();

  for (let r = 2; r <= data.length; r++) {
    const sid = String(data[r - 1][0] || "").trim();
    if (sid !== sessionId) continue;

    const rowMaster = normalizeMasterId_(data[r - 1][1]);
    const expiresAtMs = Number(data[r - 1][3]);
    const revokedAtMs = String(data[r - 1][4] || "").trim();

    if (rowMaster !== masterId) return false;
    if (revokedAtMs) return false;
    if (Number.isNaN(expiresAtMs)) return false;
    if (expiresAtMs <= Date.now()) return false;

    // touch last seen (col 7)
    sessions.getRange(r, 7, 1, 1).setValue(String(Date.now()));
    return true;
  }

  return false;
}

function findRequestIdByApprovedToken_({ masterId, token }) {
  try {
    if (!masterId || !token) return "";

    const sh = ensureSheet_(
      REQUESTS_SHEET,
      [
        "RequestId",
        "MasterId",
        "GuestName",
        "GuestNote",
        "Status",
        "CreatedAtMs",
        "ApprovedAtMs",
        "DeniedAtMs",
        "ApprovedToken",
        "TokenExpiresAtMs",
        "ApprovedLink",
      ]
    );

    const values = sh.getDataRange().getValues();
    for (let r = 2; r <= values.length; r++) {
      const row = values[r - 1];
      const rowMaster = normalizeMasterId_(row[1]);
      if (rowMaster !== masterId) continue;
      const approvedToken = String(row[8] || "").trim();
      if (approvedToken && approvedToken === token) {
        return String(row[0] || "").trim();
      }
    }
  } catch {
    // ignore mapping failures
  }
  return "";
}

function revokeSessionsByRequestId_({ masterId, requestId }) {
  if (!masterId || !requestId) return 0;

  const sessions = ensureSheet_(SESSIONS_SHEET, [
    "SessionId",
    "MasterId",
    "RequestId",
    "ExpiresAtMs",
    "RevokedAtMs",
    "CreatedAtMs",
    "LastSeenAtMs",
  ]);
  const data = sessions.getDataRange().getValues();
  const now = Date.now();
  let count = 0;

  for (let r = 2; r <= data.length; r++) {
    const row = data[r - 1];
    const rowMaster = normalizeMasterId_(row[1]);
    if (rowMaster !== masterId) continue;
    const rowRequestId = String(row[2] || "").trim();
    if (rowRequestId !== requestId) continue;
    const revokedAtMs = String(row[4] || "").trim();
    if (revokedAtMs) continue;

    sessions.getRange(r, 5, 1, 1).setValue(String(now));
    count++;
  }

  return count;
}

function assertPassphrase_(passphrase) {
  const expected = String(PropertiesService.getScriptProperties().getProperty("MASTER_PASSPHRASE") || "");
  if (!expected) throw new Error("MASTER_PASSPHRASE_NOT_SET");
  if (!passphrase) throw new Error("PASSPHRASE_REQUIRED");
  if (!timingSafeEq_(expected, String(passphrase))) throw new Error("PASSPHRASE_INVALID");
}

function getAuthSecret_() {
  const s = String(PropertiesService.getScriptProperties().getProperty("AUTH_SECRET") || "");
  if (!s) throw new Error("AUTH_SECRET_NOT_SET");
  return s;
}

function ensureSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("NO_ACTIVE_SPREADSHEET");

  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  const h = Array.isArray(headers) ? headers : [];
  if (h.length) {
    const first = sh.getRange(1, 1, 1, h.length).getValues()[0] || [];
    const need = h.some((x, i) => String(first[i] || "").trim() !== String(x));
    if (need) {
      sh.getRange(1, 1, 1, h.length).setValues([h]);
      sh.setFrozenRows(1);
    }
  }

  return sh;
}

function normalizeMasterId_(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/\d+/);
  if (!m) return "";
  const n = parseInt(m[0], 10);
  if (Number.isNaN(n)) return "";
  return String(n).padStart(2, "0");
}

function randomId_() {
  const bytes = Utilities.getUuid().replace(/-/g, "");
  return bytes;
}

function shortId_() {
  // 8 chars, easy to communicate to master
  const uuid = Utilities.getUuid().replace(/-/g, "");
  return uuid.slice(0, 8).toUpperCase();
}

function normalizeGuestName_(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.slice(0, 40);
}

function normalizeGuestNote_(v) {
  const s = String(v ?? "").trim();
  return s.slice(0, 120);
}

function normalizeRequestStatus_(v) {
  const s = String(v ?? "").trim();
  if (s === "pending" || s === "approved" || s === "denied") return s;
  return "pending";
}

function hmacBase64Url_(secret, message) {
  const raw = Utilities.computeHmacSha256Signature(String(message), String(secret));
  const b64 = Utilities.base64Encode(raw);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEq_(a, b) {
  const sa = String(a);
  const sb = String(b);
  if (sa.length !== sb.length) return false;
  let out = 0;
  for (let i = 0; i < sa.length; i++) out |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return out === 0;
}

function clampInt_(n, min, max) {
  const v = Math.floor(Number(n));
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function readJsonBody_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : "";
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("INVALID_JSON_BODY");
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function jsonError_(err) {
  const msg = err && err.message ? String(err.message) : String(err);
  return json_({ ok: false, error: msg });
}
