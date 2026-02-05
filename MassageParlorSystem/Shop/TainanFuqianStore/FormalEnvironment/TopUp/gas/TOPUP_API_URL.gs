/**
 * TopUp Serial Admin WebApp
 *
 * Features
 * - Admin gate: mode=adminUpsertAndCheck (self-register -> pending; approved -> allowed)
 * - Serials: list / generate / redeem / void / reactivate
 * - Op logs
 *
 * Deploy
 * - Deploy as Web App
 * - Execute as: Me
 * - Who has access: Anyone (or Anyone with the link)
 *
 * Storage (Spreadsheet)
 * - Sheet: Admins
 * - Sheet: Serials
 * - Sheet: OpsLog
 */

const SHEET_ADMINS = "Admins";
const SHEET_SERIALS = "Serials";
const SHEET_OPS = "OpsLog";

const DEFAULT_AUDIT = "待審核";
const AUDIT_APPROVED = "通過";

const STATUS_ACTIVE = "active";
const STATUS_USED = "used";
const STATUS_VOID = "void";

const MAX_GENERATE_COUNT = 500;
const MAX_LIST_LIMIT = 1000;

function doGet(e) {
  try {
    return json_({
      ok: true,
      hint: "TopUp Serial Admin WebApp",
      now: Date.now(),
      endpoints: [
        "POST text/plain JSON {mode:'adminUpsertAndCheck', userId, displayName}",
        "POST text/plain JSON {mode:'serials_list', filters?, limit?}",
        "POST text/plain JSON {mode:'serials_generate', amount, count, note?, syncEnabled?, pushEnabled?, personalStatusEnabled?, scheduleEnabled?, performanceEnabled?, actor?}",
        "POST text/plain JSON {mode:'serials_redeem', serial, note?, actor?}",
        "POST text/plain JSON {mode:'serials_redeem_public', serial, userId, displayName?, note?}",
        "POST text/plain JSON {mode:'serials_sync_used_note_public', userId, displayName}",
        "POST text/plain JSON {mode:'serials_void', serial, note?, actor?}",
        "POST text/plain JSON {mode:'serials_reactivate', serial, actor?}",
        "POST text/plain JSON {mode:'serials_delete', serial, note?, actor?}",
        "POST text/plain JSON {mode:'serials_delete_batch', serials, note?, actor?}",
      ],
      sheets: {
        admins: SHEET_ADMINS,
        serials: SHEET_SERIALS,
        opsLog: SHEET_OPS,
      },
    });
  } catch (err) {
    return jsonError_(err);
  }
}

function doPost(e) {
  try {
    const payload = readJsonBody_(e);
    const mode = String(payload.mode || "").trim();
    if (!mode) throw new Error("MODE_REQUIRED");

    // Ensure sheets exist early
    ensureSheets_();

    // Auth
    if (mode === "adminUpsertAndCheck") {
      const userId = normalizeUserId_(payload.userId);
      const displayName = normalizeDisplayName_(payload.displayName);
      const res = adminUpsertAndCheck_({ userId, displayName });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    // ✅ Public redeem (no admin gate): for end-users to redeem a serial by themselves
    if (mode === "serials_redeem_public") {
      const serial = normalizeSerial_(payload.serial);
      const note = normalizeNote_(payload.note);
      // ✅ 放寬：只要任何欄位提供 userId 即可（支援測試 local_dev）
      const userId = normalizeUserId_(
        payload.userId ||
          payload.userID ||
          payload.uid ||
          (payload.user && (payload.user.userId || payload.user.userID || payload.user.uid))
      );
      const displayName = normalizeDisplayName_(payload.displayName || (payload.user && payload.user.displayName));
      const res = serialsRedeemPublic_({ serial, note, user: { userId, displayName } });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    // ✅ Public UsedNote sync (no admin gate): for Scheduling / end-users to sync name changes
    if (mode === "serials_sync_used_note_public") {
      const userId = normalizeUserId_(
        payload.userId ||
          payload.userID ||
          payload.uid ||
          (payload.user && (payload.user.userId || payload.user.userID || payload.user.uid))
      );
      const displayName = normalizeDisplayName_(payload.displayName || (payload.user && payload.user.displayName));
      if (!userId) throw new Error("USER_ID_REQUIRED");

      const r = syncSerialUsedNoteForUser_({ userId, displayName });
      try {
        logOp_("serials_sync_used_note_public", "", { user: { userId, displayName }, updated: r && r.updated ? r.updated : 0 });
      } catch (_) {}
      return json_({ ok: true, ...(r || { updated: 0 }), now: Date.now() });
    }

    // All other modes require allowed admin
    const actor = normalizeActor_(payload.actor);
    const gate = requireAllowedAdmin_({ userId: actor.userId, displayName: actor.displayName });

    if (mode === "serials_list") {
      const filters = normalizeListFilters_(payload.filters);
      const limit = normalizeLimit_(payload.limit);
      const res = serialsList_({ filters, limit });
      return json_({ ok: true, ...res, now: Date.now(), actor: gate.user });
    }

    if (mode === "serials_generate") {
      const amount = normalizeAmount_(payload.amount);
      const count = normalizeCount_(payload.count, MAX_GENERATE_COUNT);
      const note = normalizeNote_(payload.note);
      const flags = normalizeSerialFeatureFlags_(payload);
      const res = serialsGenerate_({ amount, count, note, flags, actor: gate.user });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    if (mode === "serials_redeem") {
      const serial = normalizeSerial_(payload.serial);
      const note = normalizeNote_(payload.note);
      const res = serialsRedeem_({ serial, note, actor: gate.user });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    if (mode === "serials_void") {
      const serial = normalizeSerial_(payload.serial);
      const note = normalizeNote_(payload.note);
      const res = serialsVoid_({ serial, note, actor: gate.user });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    if (mode === "serials_reactivate") {
      const serial = normalizeSerial_(payload.serial);
      const res = serialsReactivate_({ serial, actor: gate.user });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    if (mode === "serials_delete") {
      const serial = normalizeSerial_(payload.serial);
      const note = normalizeNote_(payload.note);
      const res = serialsDelete_({ serial, note, actor: gate.user });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    if (mode === "serials_delete_batch") {
      const serials = Array.isArray(payload.serials) ? payload.serials : [];
      const note = normalizeNote_(payload.note);
      const res = serialsDeleteBatch_({ serials, note, actor: gate.user });
      return json_({ ok: true, ...res, now: Date.now() });
    }

    return json_({ ok: false, error: "UNSUPPORTED_MODE", mode, now: Date.now() });
  } catch (err) {
    return jsonError_(err);
  }
}

/* =====================================================
 * Admin Gate
 * ===================================================== */

function adminUpsertAndCheck_({ userId, displayName }) {
  if (!userId) throw new Error("USER_ID_REQUIRED");

  const sh = ensureSheet_(SHEET_ADMINS, [
    "UserId",
    "DisplayName",
    "Audit",
    "Role",
    "CreatedAtMs",
    "UpdatedAtMs",
    "LastSeenAtMs",
    "Note",
  ]);

  const now = Date.now();
  const rows = sh.getDataRange().getValues();

  // Find existing row by userId
  let rowIndex = -1; // 1-based in sheet
  for (let r = 2; r <= rows.length; r++) {
    const row = rows[r - 1];
    if (String(row[0] || "").trim() === userId) {
      rowIndex = r;
      break;
    }
  }

  if (rowIndex === -1) {
    // New admin registration (pending by default)
    sh.appendRow([userId, displayName, DEFAULT_AUDIT, "admin", now, now, now, ""]);
    logOp_("admin_register", "", { userId, displayName, audit: DEFAULT_AUDIT });
    return {
      allowed: false,
      audit: DEFAULT_AUDIT,
      user: { userId, displayName, audit: DEFAULT_AUDIT, role: "admin" },
      created: true,
    };
  }

  // Existing
  const row = rows[rowIndex - 1];
  const audit = String(row[2] || DEFAULT_AUDIT).trim() || DEFAULT_AUDIT;
  const role = String(row[3] || "admin").trim() || "admin";

  // Update displayName (best effort), updatedAt, lastSeen
  const oldName = String(row[1] || "").trim();
  const updates = [];
  if (displayName && displayName !== oldName) updates.push({ col: 2, value: displayName });
  updates.push({ col: 6, value: now });
  updates.push({ col: 7, value: now });

  if (updates.length) {
    const rg = sh.getRange(rowIndex, 1, 1, 8);
    const values = rg.getValues()[0];
    for (let i = 0; i < updates.length; i++) values[updates[i].col - 1] = updates[i].value;
    rg.setValues([values]);
  }

  // Best effort: sync historical UsedNote (Serials) for this userId.
  // So name changes reflect across previously redeemed rows.
  try {
    syncSerialUsedNoteForUser_({ userId, displayName: displayName || oldName });
  } catch (_) {}

  const allowed = audit === AUDIT_APPROVED;
  return {
    allowed,
    audit,
    user: { userId, displayName: displayName || oldName, audit, role },
    created: false,
  };
}

function requireAllowedAdmin_({ userId, displayName }) {
  const userIdNorm = normalizeUserId_(userId);
  if (!userIdNorm) throw new Error("USER_ID_REQUIRED");

  const sh = ensureSheet_(SHEET_ADMINS, [
    "UserId",
    "DisplayName",
    "Audit",
    "Role",
    "CreatedAtMs",
    "UpdatedAtMs",
    "LastSeenAtMs",
    "Note",
  ]);

  const rows = sh.getDataRange().getValues();
  for (let r = 2; r <= rows.length; r++) {
    const row = rows[r - 1];
    const uid = String(row[0] || "").trim();
    if (uid !== userIdNorm) continue;

    const audit = String(row[2] || DEFAULT_AUDIT).trim() || DEFAULT_AUDIT;
    const role = String(row[3] || "admin").trim() || "admin";

    // If caller provides a new displayName, sync it back to sheet.
    // (So name changes are reflected without requiring a separate upsert call.)
    const newName = normalizeDisplayName_(displayName);
    const oldName = String(row[1] || "").trim();
    const now = Date.now();
    try {
      const updates = [];
      if (newName && newName !== oldName) updates.push({ col: 2, value: newName });
      updates.push({ col: 6, value: now }); // UpdatedAtMs
      updates.push({ col: 7, value: now }); // LastSeenAtMs

      if (updates.length) {
        const rg = sh.getRange(r, 1, 1, 8);
        const values = rg.getValues()[0];
        for (let i = 0; i < updates.length; i++) values[updates[i].col - 1] = updates[i].value;
        rg.setValues([values]);
      }
    } catch (_) {}

    if (audit !== AUDIT_APPROVED) {
      const err = new Error("ADMIN_NOT_ALLOWED");
      err.details = { audit };
      throw err;
    }

    // Best effort: sync historical UsedNote (Serials) for this admin.
    try {
      syncSerialUsedNoteForUser_({ userId: userIdNorm, displayName: newName || oldName });
    } catch (_) {}

    return {
      ok: true,
      user: { userId: userIdNorm, displayName: String(newName || oldName || "").trim(), audit, role },
    };
  }

  // Not found: require caller to first call adminUpsertAndCheck
  const err = new Error("ADMIN_NOT_REGISTERED");
  err.details = { userId: userIdNorm };
  throw err;
}

function normalizeActor_(actor) {
  const a = actor || {};
  return {
    userId: normalizeUserId_(a.userId || a.userID || a.uid || ""),
    displayName: normalizeDisplayName_(a.displayName || a.name || ""),
  };
}

/* =====================================================
 * Serials
 * ===================================================== */

function serialsList_({ filters, limit }) {
  const sh = ensureSheet_(SHEET_SERIALS, serialsHeaders_());
  const values = sh.getDataRange().getValues();

  const q = String(filters.q || "").trim().toLowerCase();
  const status = String(filters.status || "all");
  const amount = filters.amount;

  const out = [];
  for (let r = 2; r <= values.length; r++) {
    const row = values[r - 1];
    const serial = String(row[0] || "").trim();
    if (!serial) continue;

    const rowAmount = Number(row[1]) || 0;
    const rowStatus = String(row[2] || STATUS_ACTIVE).trim() || STATUS_ACTIVE;
    const rowNote = String(row[3] || "");
    const createdAtMs = Number(row[4]) || 0;
    const usedAtMs = Number(row[7]) || 0;
    const usedNote = String(row[9] || "");
    const voidAtMs = Number(row[10]) || 0;

    // Feature flags (may be blank for older rows)
    const pushEnabled = parseFeatureCell_(row[16]);
    const personalStatusEnabled = parseFeatureCell_(row[17]);
    const scheduleEnabled = parseFeatureCell_(row[18]);
    const performanceEnabled = parseFeatureCell_(row[19]);
    // Backward compatible: missing SyncEnabled means "sync on".
    const syncEnabledRaw = parseFeatureCell_(row[20]);
    const syncEnabled = syncEnabledRaw === null ? true : syncEnabledRaw;

    if (q) {
      const hay = (serial + " " + rowNote).toLowerCase();
      if (hay.indexOf(q) === -1) continue;
    }

    if (status !== "all" && rowStatus !== status) continue;
    if (amount !== null && amount !== undefined && Number.isFinite(Number(amount)) && rowAmount !== Number(amount)) continue;

    out.push({
      serial,
      amount: rowAmount,
      status: rowStatus,
      note: rowNote,
      createdAtMs,
      usedAtMs,
      usedNote,
      voidAtMs,
      syncEnabled,
      pushEnabled,
      personalStatusEnabled,
      scheduleEnabled,
      performanceEnabled,
      features: {
        syncEnabled,
        pushEnabled,
        personalStatusEnabled,
        scheduleEnabled,
        performanceEnabled,
      },
    });

    if (out.length >= limit) break;
  }

  // Sort by createdAt desc (values are already append order; but keep safe)
  out.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

  return { serials: out };
}

function serialsGenerate_({ amount, count, note, flags, actor }) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const sh = ensureSheet_(SHEET_SERIALS, serialsHeaders_());
    const now = Date.now();
    const batchId = "B" + now + "-" + shortId_();

    const f = flags || {};
    const pushEnabled = encodeFeatureCell_(f.pushEnabled);
    const personalStatusEnabled = encodeFeatureCell_(f.personalStatusEnabled);
    const scheduleEnabled = encodeFeatureCell_(f.scheduleEnabled);
    const performanceEnabled = encodeFeatureCell_(f.performanceEnabled);
    const syncEnabled = encodeFeatureCell_(f.syncEnabled);

    const existing = buildExistingSerialSet_(sh);

    const rowsToAppend = [];
    const out = [];

    for (let i = 0; i < count; i++) {
      let serial = "";
      for (let tries = 0; tries < 12; tries++) {
        const s = generateSerial_();
        if (!existing.has(s)) {
          serial = s;
          existing.add(s);
          break;
        }
      }
      if (!serial) throw new Error("SERIAL_GENERATION_COLLISION");

      rowsToAppend.push([
        serial,
        amount,
        STATUS_ACTIVE,
        note,
        now,
        actor.userId,
        batchId,
        "", // UsedAtMs
        "", // UsedBy
        "", // UsedNote
        "", // VoidAtMs
        "", // VoidBy
        "", // VoidNote
        "", // ReactivatedAtMs
        "", // ReactivatedBy
        now, // UpdatedAtMs
        pushEnabled,
        personalStatusEnabled,
        scheduleEnabled,
        performanceEnabled,
        syncEnabled,
      ]);

      out.push({
        serial,
        amount,
        status: STATUS_ACTIVE,
        note,
        createdAtMs: now,
        syncEnabled: !!f.syncEnabled,
        pushEnabled: !!f.pushEnabled,
        personalStatusEnabled: !!f.personalStatusEnabled,
        scheduleEnabled: !!f.scheduleEnabled,
        performanceEnabled: !!f.performanceEnabled,
        features: {
          syncEnabled: !!f.syncEnabled,
          pushEnabled: !!f.pushEnabled,
          personalStatusEnabled: !!f.personalStatusEnabled,
          scheduleEnabled: !!f.scheduleEnabled,
          performanceEnabled: !!f.performanceEnabled,
        },
      });
    }

    if (rowsToAppend.length) sh.getRange(sh.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);

    logOp_("serials_generate", "", {
      batchId,
      amount,
      count,
      note,
      flags: {
        syncEnabled: !!(flags && flags.syncEnabled),
        pushEnabled: !!(flags && flags.pushEnabled),
        personalStatusEnabled: !!(flags && flags.personalStatusEnabled),
        scheduleEnabled: !!(flags && flags.scheduleEnabled),
        performanceEnabled: !!(flags && flags.performanceEnabled),
      },
      actor,
    });

    return { batchId, serials: out };
  } finally {
    lock.releaseLock();
  }
}

function serialsRedeem_({ serial, note, actor }) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  let res = null;
  let syncArgs = null;
  let logDetail = null;
  try {
    const sh = ensureSheet_(SHEET_SERIALS, serialsHeaders_());
    const idx = findSerialRowIndex_(sh, serial);
    if (idx < 2) throw new Error("SERIAL_NOT_FOUND");

    const row = sh.getRange(idx, 1, 1, serialsHeaders_().length).getValues()[0];
    const amount = Number(row[1]) || 0;
    const status = String(row[2] || STATUS_ACTIVE).trim() || STATUS_ACTIVE;
    if (status === STATUS_USED) throw new Error("SERIAL_ALREADY_USED");
    if (status === STATUS_VOID) throw new Error("SERIAL_VOID");

    const now = Date.now();
    row[2] = STATUS_USED;
    row[7] = now;
    row[8] = actor.userId;
    // UsedNote: 僅保留核銷者 displayName（依需求不存其他備註）
    row[9] = String(actor && actor.displayName ? actor.displayName : "").trim();
    row[15] = now;

    sh.getRange(idx, 1, 1, row.length).setValues([row]);

    const pushEnabled = parseFeatureCell_(row[16]);
    const personalStatusEnabled = parseFeatureCell_(row[17]);
    const scheduleEnabled = parseFeatureCell_(row[18]);
    const performanceEnabled = parseFeatureCell_(row[19]);
    // Backward compatible: missing SyncEnabled means "sync on".
    const syncEnabledRaw = parseFeatureCell_(row[20]);
    const syncEnabled = syncEnabledRaw === null ? true : syncEnabledRaw;

    res = {
      serial,
      amount,
      status: STATUS_USED,
      usedAtMs: now,
      usedBy: actor.userId,
      syncEnabled,
      pushEnabled,
      personalStatusEnabled,
      scheduleEnabled,
      performanceEnabled,
      features: {
        syncEnabled,
        pushEnabled,
        personalStatusEnabled,
        scheduleEnabled,
        performanceEnabled,
      },
    };

    syncArgs = { userId: actor.userId, displayName: actor.displayName };
    logDetail = { serial, note, actor };
  } finally {
    lock.releaseLock();
  }

  // Best-effort side effects outside lock to reduce queueing.
  try {
    if (syncArgs && syncArgs.userId && syncArgs.displayName) syncSerialUsedNoteForUser_(syncArgs);
  } catch (_) {}
  try {
    logOp_("serials_redeem", serial, logDetail);
  } catch (_) {}

  return res;
}

function serialsRedeemPublic_({ serial, note, user }) {
  const u = user || {};
  const userId = normalizeUserId_(u.userId);
  const displayName = normalizeDisplayName_(u.displayName);
  if (!userId) throw new Error("USER_ID_REQUIRED");

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  let res = null;
  let syncArgs = null;
  let logDetail = null;
  try {
    const sh = ensureSheet_(SHEET_SERIALS, serialsHeaders_());
    const idx = findSerialRowIndex_(sh, serial);
    if (idx < 2) throw new Error("SERIAL_NOT_FOUND");

    const row = sh.getRange(idx, 1, 1, serialsHeaders_().length).getValues()[0];
    const amount = Number(row[1]) || 0;
    const status = String(row[2] || STATUS_ACTIVE).trim() || STATUS_ACTIVE;
    if (status === STATUS_USED) throw new Error("SERIAL_ALREADY_USED");
    if (status === STATUS_VOID) throw new Error("SERIAL_VOID");

    const now = Date.now();
    row[2] = STATUS_USED;
    row[7] = now;
    row[8] = userId;

    // UsedNote: 僅保留核銷者 displayName（依需求不存其他備註）
    const finalNote = String(displayName || "").trim();
    row[9] = finalNote;
    row[15] = now;

    sh.getRange(idx, 1, 1, row.length).setValues([row]);

    const pushEnabled = parseFeatureCell_(row[16]);
    const personalStatusEnabled = parseFeatureCell_(row[17]);
    const scheduleEnabled = parseFeatureCell_(row[18]);
    const performanceEnabled = parseFeatureCell_(row[19]);
    // Backward compatible: missing SyncEnabled means "sync on".
    const syncEnabledRaw = parseFeatureCell_(row[20]);
    const syncEnabled = syncEnabledRaw === null ? true : syncEnabledRaw;

    res = {
      serial,
      amount,
      status: STATUS_USED,
      usedAtMs: now,
      usedBy: userId,
      syncEnabled,
      pushEnabled,
      personalStatusEnabled,
      scheduleEnabled,
      performanceEnabled,
      features: {
        syncEnabled,
        pushEnabled,
        personalStatusEnabled,
        scheduleEnabled,
        performanceEnabled,
      },
    };

    syncArgs = { userId, displayName };
    logDetail = { serial, note: String(note || "").trim(), usedNote: finalNote, user: { userId, displayName } };
  } finally {
    lock.releaseLock();
  }

  // Best-effort side effects outside lock to reduce queueing.
  try {
    if (syncArgs && syncArgs.userId && syncArgs.displayName) syncSerialUsedNoteForUser_(syncArgs);
  } catch (_) {}
  try {
    logOp_("serials_redeem_public", serial, logDetail);
  } catch (_) {}

  return res;
}

function syncSerialUsedNoteForUser_({ userId, displayName }) {
  const uid = normalizeUserId_(userId);
  const name = normalizeDisplayName_(displayName);
  if (!uid || !name) return { updated: 0 };

  const sh = ensureSheet_(SHEET_SERIALS, serialsHeaders_());
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { updated: 0 };

  // Only touch UsedBy + UsedNote columns for speed.
  const numRows = lastRow - 1;
  const rg = sh.getRange(2, 9, numRows, 2);
  const values = rg.getValues();
  let updated = 0;

  for (let i = 0; i < values.length; i++) {
    const usedBy = String(values[i][0] || "").trim();
    if (usedBy !== uid) continue;
    const cur = String(values[i][1] || "").trim();
    if (cur === name) continue;
    values[i][1] = name;
    updated++;
  }

  if (updated > 0) rg.setValues(values);
  return { updated };
}

function serialsVoid_({ serial, note, actor }) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const sh = ensureSheet_(SHEET_SERIALS, serialsHeaders_());
    const idx = findSerialRowIndex_(sh, serial);
    if (idx < 2) throw new Error("SERIAL_NOT_FOUND");

    const row = sh.getRange(idx, 1, 1, serialsHeaders_().length).getValues()[0];
    const status = String(row[2] || STATUS_ACTIVE).trim() || STATUS_ACTIVE;
    if (status === STATUS_USED) throw new Error("SERIAL_ALREADY_USED");
    if (status === STATUS_VOID) return { serial, status: STATUS_VOID, already: true };

    const now = Date.now();
    row[2] = STATUS_VOID;
    row[10] = now;
    row[11] = actor.userId;
    row[12] = note;
    row[15] = now;

    sh.getRange(idx, 1, 1, row.length).setValues([row]);

    logOp_("serials_void", serial, { serial, note, actor });

    return { serial, status: STATUS_VOID, voidAtMs: now };
  } finally {
    lock.releaseLock();
  }
}

function serialsReactivate_({ serial, actor }) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const sh = ensureSheet_(SHEET_SERIALS, serialsHeaders_());
    const idx = findSerialRowIndex_(sh, serial);
    if (idx < 2) throw new Error("SERIAL_NOT_FOUND");

    const row = sh.getRange(idx, 1, 1, serialsHeaders_().length).getValues()[0];
    const status = String(row[2] || STATUS_ACTIVE).trim() || STATUS_ACTIVE;
    if (status !== STATUS_VOID) throw new Error("SERIAL_NOT_VOID");

    const now = Date.now();
    row[2] = STATUS_ACTIVE;

    // clear void fields
    row[10] = "";
    row[11] = "";
    row[12] = "";

    // record reactivate
    row[13] = now;
    row[14] = actor.userId;
    row[15] = now;

    sh.getRange(idx, 1, 1, row.length).setValues([row]);

    logOp_("serials_reactivate", serial, { serial, actor });

    return { serial, status: STATUS_ACTIVE, reactivatedAtMs: now };
  } finally {
    lock.releaseLock();
  }
}

function serialsDelete_({ serial, note, actor }) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const sh = ensureSheet_(SHEET_SERIALS, serialsHeaders_());
    const idx = findSerialRowIndex_(sh, serial);
    if (idx < 2) throw new Error("SERIAL_NOT_FOUND");

    const row = sh.getRange(idx, 1, 1, serialsHeaders_().length).getValues()[0];
    const status = String(row[2] || STATUS_ACTIVE).trim() || STATUS_ACTIVE;

    sh.deleteRow(idx);

    logOp_("serials_delete", serial, { serial, note, actor, status });

    return { serial, deleted: true };
  } finally {
    lock.releaseLock();
  }
}

function serialsDeleteBatch_({ serials, note, actor }) {
  const list = (serials || []).map((s) => String(s || "").trim()).filter(Boolean);
  const uniq = Array.from(new Set(list));
  if (!uniq.length) return { deleted: [], failed: [] };
  if (uniq.length > 500) throw new Error("TOO_MANY_SERIALS");

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const sh = ensureSheet_(SHEET_SERIALS, serialsHeaders_());
    const values = sh.getDataRange().getValues();

    const indexBySerial = new Map();
    for (let r = 2; r <= values.length; r++) {
      const s = String(values[r - 1][0] || "").trim();
      if (s) indexBySerial.set(s, r);
    }

    const rowsToDelete = [];
    const deleted = [];
    const failed = [];

    for (let i = 0; i < uniq.length; i++) {
      const serial = uniq[i];
      const idx = indexBySerial.get(serial) || -1;
      if (idx < 2) {
        failed.push({ serial, error: "SERIAL_NOT_FOUND" });
        continue;
      }
      const row = values[idx - 1];
      const status = String(row[2] || STATUS_ACTIVE).trim() || STATUS_ACTIVE;

      rowsToDelete.push({ idx, serial, status });
    }

    // delete from bottom to top to avoid index shift
    rowsToDelete.sort((a, b) => b.idx - a.idx);
    for (let i = 0; i < rowsToDelete.length; i++) {
      const it = rowsToDelete[i];
      sh.deleteRow(it.idx);
      deleted.push(it.serial);
    }

    logOp_("serials_delete_batch", "", {
      count: uniq.length,
      deletedCount: deleted.length,
      failedCount: failed.length,
      note,
      actor,
      serials: uniq,
    });

    return { deleted, failed };
  } finally {
    lock.releaseLock();
  }
}

function serialsHeaders_() {
  return [
    "Serial",
    "Amount",
    "Status",
    "Note",
    "CreatedAtMs",
    "CreatedBy",
    "BatchId",
    "UsedAtMs",
    "UsedBy",
    "UsedNote",
    "VoidAtMs",
    "VoidBy",
    "VoidNote",
    "ReactivatedAtMs",
    "ReactivatedBy",
    "UpdatedAtMs",
    "PushEnabled",
    "PersonalStatusEnabled",
    "ScheduleEnabled",
    "PerformanceEnabled",
    "SyncEnabled",
  ];
}

function normalizeSerialFeatureFlags_(payload) {
  const p = payload || {};
  const f = (p.features && typeof p.features === "object") ? p.features : {};

  // Default to true to avoid accidentally generating "no feature" serials when older clients call serials_generate.
  return {
    syncEnabled: normalizeFeatureFlag_(p.syncEnabled !== undefined ? p.syncEnabled : f.syncEnabled, true),
    pushEnabled: normalizeFeatureFlag_(p.pushEnabled !== undefined ? p.pushEnabled : f.pushEnabled, true),
    personalStatusEnabled: normalizeFeatureFlag_(p.personalStatusEnabled !== undefined ? p.personalStatusEnabled : f.personalStatusEnabled, true),
    scheduleEnabled: normalizeFeatureFlag_(p.scheduleEnabled !== undefined ? p.scheduleEnabled : f.scheduleEnabled, true),
    performanceEnabled: normalizeFeatureFlag_(p.performanceEnabled !== undefined ? p.performanceEnabled : f.performanceEnabled, true),
  };
}

function normalizeFeatureFlag_(v, defaultValue) {
  if (v === null || v === undefined || v === "") return !!defaultValue;
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  const s = String(v).trim().toLowerCase();
  if (!s) return !!defaultValue;
  if (s === "true" || s === "1" || s === "y" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "n" || s === "no" || s === "off") return false;
  return !!defaultValue;
}

function encodeFeatureCell_(b) {
  return b ? 1 : 0;
}

function parseFeatureCell_(cellValue) {
  // Return boolean when explicitly set, else null.
  if (cellValue === null || cellValue === undefined || cellValue === "") return null;
  if (cellValue === true || cellValue === 1 || cellValue === "1") return true;
  if (cellValue === false || cellValue === 0 || cellValue === "0") return false;
  const s = String(cellValue).trim().toLowerCase();
  if (!s) return null;
  if (s === "true" || s === "y" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "n" || s === "no" || s === "off") return false;
  return null;
}

function findSerialRowIndex_(sh, serial) {
  const s = String(serial || "").trim();
  if (!s) return -1;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;

  // Fast path: TextFinder on column A (Serial)
  try {
    const rg = sh.getRange(2, 1, lastRow - 1, 1);
    const cell = rg.createTextFinder(s).matchEntireCell(true).findNext();
    if (cell) return cell.getRow();
  } catch (_) {
    // fallback below
  }

  // Fallback: scan values (slower)
  const values = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    const rowSerial = String(values[i][0] || "").trim();
    if (rowSerial === s) return i + 2;
  }
  return -1;
}

function buildExistingSerialSet_(sh) {
  const values = sh.getDataRange().getValues();
  const set = new Set();
  for (let r = 2; r <= values.length; r++) {
    const s = String(values[r - 1][0] || "").trim();
    if (s) set.add(s);
  }
  return set;
}

/* =====================================================
 * Logs
 * ===================================================== */

function logOp_(action, serial, detail) {
  const sh = ensureSheet_(SHEET_OPS, ["AtMs", "Action", "Serial", "ActorUserId", "ActorName", "DetailJson"]);
  const now = Date.now();

  const actorUserId = detail && detail.actor && detail.actor.userId ? String(detail.actor.userId) : "";
  const actorName = detail && detail.actor && detail.actor.displayName ? String(detail.actor.displayName) : "";

  const json = safeJsonStringify_(detail || {});
  sh.appendRow([now, String(action || ""), String(serial || ""), actorUserId, actorName, json]);
}

/* =====================================================
 * Normalizers
 * ===================================================== */

function normalizeUserId_(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (s.length > 128) return s.slice(0, 128);
  return s;
}

function normalizeDisplayName_(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (s.length > 80) return s.slice(0, 80);
  return s;
}

function normalizeAmount_(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error("AMOUNT_INVALID");
  if (n > 1000000) throw new Error("AMOUNT_TOO_LARGE");
  return Math.round(n);
}

function normalizeCount_(v, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error("COUNT_INVALID");
  const m = Math.max(1, Number(max) || 1);
  if (n > m) throw new Error("COUNT_TOO_LARGE");
  return Math.round(n);
}

function normalizeNote_(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (s.length > 300) return s.slice(0, 300);
  return s;
}

function normalizeSerial_(v) {
  const s = String(v || "").trim().toUpperCase();
  if (!s) throw new Error("SERIAL_REQUIRED");
  if (s.length > 80) throw new Error("SERIAL_TOO_LONG");
  // allow A-Z0-9- only
  const cleaned = s.replace(/[^A-Z0-9-]/g, "");
  if (!cleaned) throw new Error("SERIAL_INVALID");
  return cleaned;
}

function normalizeListFilters_(f) {
  const o = f || {};
  const q = String(o.q || "").trim();
  const status = String(o.status || "all").trim();
  const amountRaw = o.amount;
  let amount = null;
  if (amountRaw !== null && amountRaw !== undefined && String(amountRaw).trim() !== "") {
    const n = Number(amountRaw);
    if (Number.isFinite(n) && n > 0) amount = Math.round(n);
  }

  const statusOk = status === "all" || status === STATUS_ACTIVE || status === STATUS_USED || status === STATUS_VOID;
  return {
    q: q.slice(0, 80),
    status: statusOk ? status : "all",
    amount,
  };
}

function normalizeLimit_(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 300;
  return Math.min(Math.round(n), MAX_LIST_LIMIT);
}

/* =====================================================
 * Serial generator (Crockford Base32)
 * ===================================================== */

function generateSerial_() {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + "|" + Date.now() + "|" + Math.random());
  // use first 16 bytes (higher entropy)
  const raw = bytes.slice(0, 16);
  const b32 = crockfordBase32_(raw);
  // format: TP-XXXX-XXXX-XXXX-XXXX-XXXX
  // (20 chars Crockford Base32 = 100 bits)
  const body = b32.slice(0, 20);
  return (
    "TP-" +
    body.slice(0, 4) +
    "-" +
    body.slice(4, 8) +
    "-" +
    body.slice(8, 12) +
    "-" +
    body.slice(12, 16) +
    "-" +
    body.slice(16, 20)
  );
}

function crockfordBase32_(bytes) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let bits = 0;
  let value = 0;
  let out = "";

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | (bytes[i] & 0xff);
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function shortId_() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 10);
}

/* =====================================================
 * Sheets + JSON helpers
 * ===================================================== */

function ensureSheets_() {
  ensureSheet_(SHEET_ADMINS, [
    "UserId",
    "DisplayName",
    "Audit",
    "Role",
    "CreatedAtMs",
    "UpdatedAtMs",
    "LastSeenAtMs",
    "Note",
  ]);
  ensureSheet_(SHEET_SERIALS, serialsHeaders_());
  ensureSheet_(SHEET_OPS, ["AtMs", "Action", "Serial", "ActorUserId", "ActorName", "DetailJson"]);
}

function ensureSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  const firstRow = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  const needInit = firstRow.every((c) => String(c || "").trim() === "");

  if (needInit) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, Math.min(headers.length, 12));
  } else {
    // Backfill missing headers (best effort)
    for (let i = 0; i < headers.length; i++) {
      const want = headers[i];
      const cur = String(firstRow[i] || "").trim();
      if (!cur) sh.getRange(1, i + 1).setValue(want);
    }
  }

  return sh;
}

function readJsonBody_(e) {
  const raw = (e && e.postData && e.postData.contents) || "";
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    const e2 = new Error("INVALID_JSON");
    e2.raw = raw.slice(0, 300);
    throw e2;
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function jsonError_(err) {
  const message = err && err.message ? String(err.message) : "ERROR";
  const out = {
    ok: false,
    error: message,
    now: Date.now(),
  };

  if (err && err.details) out.details = err.details;

  // Avoid leaking too much, but keep some info for debugging
  try {
    out.stack = String(err && err.stack ? err.stack : "").split("\n").slice(0, 6).join("\n");
  } catch (_) {}

  return json_(out);
}

function safeJsonStringify_(o) {
  try {
    return JSON.stringify(o);
  } catch (_) {
    return "{}";
  }
}
