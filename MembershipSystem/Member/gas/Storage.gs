'use strict';

const MEMBERSHIP_STORAGE_PROPERTY_ = 'MEMBERSHIP_SYSTEM_SPREADSHEET_ID';
const MEMBERSHIP_STORAGE_SCHEMA_CACHE_SECONDS_ = 120;
const MEMBERSHIP_DATA_CACHE_EPOCH_KEY_ = 'membership:data-epoch:v1';
const MEMBERSHIP_DATA_CACHE_EPOCH_SECONDS_ = 21600;
const MEMBERSHIP_BOOTSTRAP_CACHE_SECONDS_ = 120;
const MEMBERSHIP_BOOTSTRAP_CACHE_MAX_BYTES_ = 90000;
const MEMBERSHIP_SYNC_SCHEMA_VERSION_ = '2';
const MEMBERSHIP_SYNC_PROPERTY_PREFIX_ = 'MEMBERSHIP_SYNC_REVISION_V2:';
const MEMBERSHIP_SHEET_SCHEMAS_ = Object.freeze({
  Members: Object.freeze(['line_user_id', 'display_name', 'member_code', 'tier', 'status', 'joined_at', 'last_login_at', 'created_at', 'updated_at', 'birthday', 'phone', 'membership_status']),
  Admins: Object.freeze(['line_user_id', 'display_name', 'role', 'status', 'first_seen_at', 'updated_at']),
  PointCards: Object.freeze(['card_id', 'title', 'description', 'target_stamps', 'reward_title', 'status', 'accent', 'created_by', 'created_at', 'updated_by', 'updated_at', 'expiry_mode', 'expires_on', 'sort_order', 'style_key']),
  PointCardRewards: Object.freeze(['reward_id', 'card_id', 'threshold_stamps', 'reward_type', 'reward_title', 'reward_description', 'lottery_win_rate', 'created_at', 'updated_at', 'consume_stamps', 'ticket_template_id']),
  PointCardLotteryPrizes: Object.freeze(['prize_id', 'reward_id', 'prize_title', 'prize_description', 'win_rate', 'created_at', 'updated_at']),
  PointCardTicketTemplates: Object.freeze(['ticket_template_id', 'title', 'ticket_type', 'description', 'usage_method', 'usage_instructions', 'lottery_prizes_json', 'status', 'created_by', 'created_at', 'updated_by', 'updated_at']),
  PointCardTickets: Object.freeze(['ticket_id', 'line_user_id', 'card_id', 'reward_id', 'reward_key', 'threshold_stamps', 'ticket_type', 'ticket_title', 'ticket_description', 'lottery_prizes_json', 'status', 'failed_attempts', 'earned_at', 'used_at', 'result_json', 'created_at', 'updated_at', 'consume_stamps', 'ticket_template_id', 'usage_method', 'usage_instructions', 'points_spent', 'redeem_entry_id']),
  PointCardTicketChallenges: Object.freeze(['challenge_id', 'ticket_id', 'line_user_id', 'options_json', 'status', 'attempt_count', 'expires_at', 'created_at', 'used_at']),
  EventTickets: Object.freeze(['event_ticket_id', 'title', 'ticket_type', 'description', 'usage_method', 'usage_instructions', 'lottery_prizes_json', 'status', 'starts_on', 'ends_on', 'quota', 'accent', 'created_by', 'created_at', 'updated_by', 'updated_at', 'allowed_tier_keys']),
  EventTicketClaims: Object.freeze(['claim_id', 'event_ticket_id', 'line_user_id', 'ticket_type', 'ticket_title', 'ticket_description', 'usage_method', 'usage_instructions', 'lottery_prizes_json', 'status', 'claimed_at', 'used_at', 'result_json', 'created_at', 'updated_at']),
  CalendarItems: Object.freeze(['calendar_item_id', 'title', 'item_type', 'description', 'starts_on', 'ends_on', 'status', 'accent', 'created_by', 'created_at', 'updated_by', 'updated_at', 'allowed_tier_keys', 'link_label', 'link_url']),
  PointBalances: Object.freeze(['line_user_id', 'card_id', 'stamps', 'updated_at']),
  PointEntries: Object.freeze(['entry_id', 'line_user_id', 'card_id', 'amount', 'note', 'created_by', 'created_at', 'request_id', 'entry_type', 'reference_type', 'reference_id']),
  PointMutations: Object.freeze(['operation_id', 'operation_type', 'request_id', 'line_user_id', 'card_id', 'amount', 'ticket_id', 'before_stamps', 'after_stamps', 'entry_id', 'note', 'created_by', 'actor_role', 'result_json', 'status', 'created_at', 'updated_at']),
  ServiceTimeEntries: Object.freeze(['entry_id', 'line_user_id', 'minutes', 'note', 'created_by', 'created_at', 'request_id']),
  LineNotificationLogs: Object.freeze(['notification_id', 'request_id', 'line_user_id', 'message', 'status', 'error_code', 'created_at', 'sent_at', 'updated_at']),
  MembershipTierSettings: Object.freeze(['tier_key', 'tier_label', 'required_service_minutes', 'updated_by', 'updated_at', 'style_key']),
  AuditLogs: Object.freeze(['audit_id', 'actor_line_user_id', 'actor_role', 'action', 'target_type', 'target_id', 'result', 'detail', 'created_at'])
});
let MEMBERSHIP_SPREADSHEET_CACHE_ = null;

function ensureMembershipStorage_() {
  const spreadsheet = resolveMembershipSpreadsheet_();
  const schemaCache = membershipSchemaCache_();
  const schemaCacheKey = membershipSchemaCacheKey_(spreadsheet.getId());
  if (schemaCache && schemaCache.get(schemaCacheKey) === 'ready') return spreadsheet;

  Object.keys(MEMBERSHIP_SHEET_SCHEMAS_).forEach(function(sheetName) {
    ensureSheetSchema_(spreadsheet, sheetName, MEMBERSHIP_SHEET_SCHEMAS_[sheetName]);
  });
  ensureMembershipTierSettings_();
  if (schemaCache) {
    try { schemaCache.put(schemaCacheKey, 'ready', MEMBERSHIP_STORAGE_SCHEMA_CACHE_SECONDS_); } catch (_) {}
  }
  return spreadsheet;
}

function membershipSchemaCache_() {
  try { return CacheService.getScriptCache(); } catch (_) { return null; }
}

function membershipDataCacheEpoch_() {
  const cache = membershipSchemaCache_();
  if (!cache) return 'default';
  try { return String(cache.get(MEMBERSHIP_DATA_CACHE_EPOCH_KEY_) || 'default'); } catch (_) { return 'default'; }
}

function rotateMembershipDataCacheEpoch_() {
  const cache = membershipSchemaCache_();
  if (!cache) return;
  try { cache.put(MEMBERSHIP_DATA_CACHE_EPOCH_KEY_, Utilities.getUuid(), MEMBERSHIP_DATA_CACHE_EPOCH_SECONDS_); } catch (_) {}
}

function membershipVersionedBootstrapResponse_(scope, identity, request, buildPayload) {
  const version = membershipSyncRevision_(scope, identity);
  const cacheScope = membershipClientCacheScope_(scope, identity);
  const knownRevision = String(request && (request.knownRevision || request.knownVersion) || '').trim();
  const knownCacheScope = String(request && request.knownCacheScope || '').trim();
  // A revision alone is not enough: two accounts can legitimately have the
  // same surface revision, but must never reuse each other's browser cache.
  if (version && knownRevision && knownCacheScope && knownCacheScope === cacheScope && knownRevision === version) {
    return { unchanged: true, version: version, revision: version, cacheScope: cacheScope };
  }

  const cache = membershipSchemaCache_();
  const cacheKey = membershipBootstrapPayloadCacheKey_(scope, identity, version);
  let payload = null;
  if (cache && version) {
    try { payload = JSON.parse(cache.get(cacheKey) || 'null'); } catch (_) { payload = null; }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    payload = typeof buildPayload === 'function' ? buildPayload() : {};
    if (cache && version) {
      try {
        const serialized = JSON.stringify(payload);
        if (serialized.length <= MEMBERSHIP_BOOTSTRAP_CACHE_MAX_BYTES_) cache.put(cacheKey, serialized, MEMBERSHIP_BOOTSTRAP_CACHE_SECONDS_);
      } catch (_) {}
    }
  }
  return Object.assign({}, payload, { unchanged: false, version: version, revision: version, cacheScope: cacheScope });
}

function membershipSyncScopeBase_(scope) {
  const value = String(scope || '').trim();
  if (value.indexOf('points') === 0) return 'points';
  if (value.indexOf('event') === 0) return 'event';
  if (value.indexOf('calendar') === 0) return 'calendar';
  if (value.indexOf('admin') === 0) return 'admin';
  return 'member';
}

function membershipSyncProperties_() {
  try { return PropertiesService.getScriptProperties(); } catch (_) { return null; }
}

function membershipSyncPropertyKey_(scope, lineUserId) {
  const base = membershipSyncScopeBase_(scope);
  if (!lineUserId) return MEMBERSHIP_SYNC_PROPERTY_PREFIX_ + 'surface:' + base;
  const raw = String(lineUserId || '').trim();
  const identityKey = typeof digest_ === 'function' ? String(digest_(raw)).substring(0, 40) : raw.replace(/[^A-Za-z0-9_-]/g, '_').substring(0, 40);
  return MEMBERSHIP_SYNC_PROPERTY_PREFIX_ + 'member:' + identityKey;
}

function membershipSyncRead_(scope, lineUserId) {
  const properties = membershipSyncProperties_();
  const key = membershipSyncPropertyKey_(scope, lineUserId);
  if (properties) {
    try { return String(properties.getProperty(key) || '0'); } catch (_) {}
  }
  const cache = membershipSchemaCache_();
  if (cache) {
    try { return String(cache.get(key) || '0'); } catch (_) {}
  }
  return '0';
}

function membershipSyncBump_(scope, lineUserId) {
  const key = membershipSyncPropertyKey_(scope, lineUserId);
  const value = membershipCacheVersionToken_();
  const properties = membershipSyncProperties_();
  if (properties) {
    try { properties.setProperty(key, value); return value; } catch (_) {}
  }
  const cache = membershipSchemaCache_();
  if (cache) {
    try { cache.put(key, value, MEMBERSHIP_DATA_CACHE_EPOCH_SECONDS_); } catch (_) {}
  }
  return value;
}

function membershipSyncBumpMember_(lineUserId) {
  const memberId = String(lineUserId || '').trim();
  if (!memberId) return '';
  const properties = membershipSyncProperties_();
  if (properties) {
    try {
      const value = membershipCacheVersionToken_();
      properties.setProperty(membershipSyncPropertyKey_('member', memberId), value);
      return value;
    } catch (_) {
      // Script Properties has a finite size. A global member revision keeps
      // existing clients correct after the granular revision store is full.
      return membershipSyncBump_('member', '');
    }
  }
  return membershipSyncBump_('member', memberId);
}

function membershipSyncDateKey_(scope) {
  const base = membershipSyncScopeBase_(scope);
  if (base !== 'event' && base !== 'calendar') return '';
  try { return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'); } catch (_) { return new Date().toISOString().slice(0, 10); }
}

function membershipSyncWindowKey_() {
  const seconds = Math.max(1, Number(MEMBERSHIP_BOOTSTRAP_CACHE_SECONDS_) || 120);
  return String(Math.floor(Date.now() / (seconds * 1000)));
}

function membershipSyncRevision_(scope, identity) {
  const base = membershipSyncScopeBase_(scope);
  const lineUserId = String(identity && identity.lineUserId || '').trim();
  const surfaceRevision = membershipSyncRead_(base, '');
  const globalMemberRevision = membershipSyncRead_('member', '');
  const memberRevision = membershipSyncRead_('member', lineUserId);
  const dateKey = membershipSyncDateKey_(base);
  // The bounded window also detects direct Sheet edits that bypass API writes.
  return [MEMBERSHIP_SYNC_SCHEMA_VERSION_, base, surfaceRevision, globalMemberRevision, memberRevision, dateKey || 'static', membershipSyncWindowKey_()].join(':');
}

function membershipClientCacheScope_(scope, identity) {
  const base = membershipSyncScopeBase_(scope);
  const lineUserId = String(identity && identity.lineUserId || '').trim();
  const raw = 'membership-client-cache:' + base + ':' + lineUserId;
  const fingerprint = typeof digest_ === 'function' ? String(digest_(raw)).substring(0, 48) : membershipSafeCacheScope_(raw);
  return 'v' + MEMBERSHIP_SYNC_SCHEMA_VERSION_ + ':' + base + ':' + fingerprint;
}

function membershipSyncBumpForWrite_(action, identity, request) {
  const name = String(action || '').trim();
  const targetMemberId = String(request && request.lineUserId || identity && identity.lineUserId || '').trim();
  const bumpSurface = function(scope) { membershipSyncBump_(scope, ''); };
  const bumpMember = function(lineUserId) { membershipSyncBumpMember_(lineUserId); };

  if (name === 'user.member.profile.save') return bumpMember(identity && identity.lineUserId);
  if (name === 'admin.member.update') return bumpMember(targetMemberId);
  if (name === 'admin.member-tiers.save') {
    ['member', 'points', 'event', 'calendar'].forEach(bumpSurface);
    return;
  }
  if (name.indexOf('admin.pointcards.') === 0 || name === 'admin.tickets.save') return bumpSurface('points');
  if (name === 'user.pointcard.ticket.redeem' || name === 'admin.stamps.add') return bumpMember(targetMemberId);
  if (name.indexOf('admin.event-tickets.') === 0) return bumpSurface('event');
  if (name === 'user.event.ticket.claim' || name === 'user.event.ticket.redeem') return bumpMember(identity && identity.lineUserId);
  if (name.indexOf('admin.calendar-items.') === 0) return bumpSurface('calendar');
  if (name === 'admin.service_minutes.add') return bumpMember(targetMemberId);
  if (name === 'admin.member-grants.add') return bumpMember(targetMemberId);
}

function membershipReadThroughCache_(scope, buildPayload) {
  const cache = membershipSchemaCache_();
  const version = membershipDataCacheEpoch_();
  const windowKey = membershipSyncWindowKey_();
  const cacheKey = 'membership:read:v1:' + membershipSafeCacheScope_(scope) + ':' + membershipSafeCacheScope_(version || 'uncached') + ':' + windowKey;
  if (cache) {
    try {
      const cached = JSON.parse(cache.get(cacheKey) || 'null');
      if (cached !== null) return cached;
    } catch (_) {}
  }
  const payload = typeof buildPayload === 'function' ? buildPayload() : null;
  if (cache) {
    try {
      const serialized = JSON.stringify(payload);
      if (serialized.length <= MEMBERSHIP_BOOTSTRAP_CACHE_MAX_BYTES_) cache.put(cacheKey, serialized, MEMBERSHIP_BOOTSTRAP_CACHE_SECONDS_);
    } catch (_) {}
  }
  return payload;
}

function membershipBootstrapPayloadCacheKey_(scope, identity, version) {
  const lineUserId = String(identity && identity.lineUserId || '').trim();
  const identityKey = typeof digest_ === 'function' ? digest_(lineUserId).substring(0, 32) : 'authenticated';
  return 'membership:bootstrap-payload:v1:' + membershipSafeCacheScope_(scope) + ':' + membershipSafeCacheScope_(version) + ':' + identityKey;
}

function membershipSafeCacheScope_(value) {
  const raw = String(value || '');
  const readable = raw.replace(/[^A-Za-z0-9:_-]/g, '_').substring(0, 96) || 'default';
  try {
    if (typeof digest_ === 'function') return readable + '-' + String(digest_(raw)).substring(0, 24);
  } catch (_) {}
  return readable;
}

function membershipCacheVersionToken_() {
  try {
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.getUuid === 'function') return Utilities.getUuid();
  } catch (_) {}
  return 'cache-' + Date.now() + '-' + Math.random().toString(36).substring(2, 14);
}

function membershipSchemaCacheKey_(spreadsheetId) {
  const signature = Object.keys(MEMBERSHIP_SHEET_SCHEMAS_).map(function(sheetName) {
    return sheetName + ':' + MEMBERSHIP_SHEET_SCHEMAS_[sheetName].join(',');
  }).join('|');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, signature, Utilities.Charset.UTF_8).map(function(byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('').substring(0, 16);
  return 'membership:schema:' + String(spreadsheetId || '') + ':' + digest;
}

function resolveMembershipSpreadsheet_() {
  if (MEMBERSHIP_SPREADSHEET_CACHE_) return MEMBERSHIP_SPREADSHEET_CACHE_;
  const properties = PropertiesService.getScriptProperties();
  const configuredId = String(properties.getProperty(MEMBERSHIP_STORAGE_PROPERTY_) || '').trim();
  if (configuredId) {
    try { MEMBERSHIP_SPREADSHEET_CACHE_ = SpreadsheetApp.openById(configuredId); return MEMBERSHIP_SPREADSHEET_CACHE_; } catch (_) { throw new ApiError(503, 'STORAGE_UNAVAILABLE', '設定的 Membership Spreadsheet 無法開啟。'); }
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) { MEMBERSHIP_SPREADSHEET_CACHE_ = active; properties.setProperty(MEMBERSHIP_STORAGE_PROPERTY_, active.getId()); return active; }
  try { MEMBERSHIP_SPREADSHEET_CACHE_ = SpreadsheetApp.create('Lumen Club Membership Data'); properties.setProperty(MEMBERSHIP_STORAGE_PROPERTY_, MEMBERSHIP_SPREADSHEET_CACHE_.getId()); return MEMBERSHIP_SPREADSHEET_CACHE_; } catch (_) { throw new ApiError(503, 'STORAGE_UNAVAILABLE', '無法建立 Membership Spreadsheet。'); }
}

function ensureSheetSchema_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]); sheet.setFrozenRows(1); sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold'); return;
  }
  const lastColumn = sheet.getLastColumn();
  if (lastColumn > headers.length) throw new ApiError(500, 'SCHEMA_MISMATCH', sheetName + ' 欄位數量與系統 schema 不一致。');
  const actual = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  if (lastColumn < headers.length) {
    if (!headers.slice(0, lastColumn).every(function(header, index) { return String(actual[index] || '') === header; })) throw new ApiError(500, 'SCHEMA_MISMATCH', sheetName + ' 欄位與系統 schema 不一致。');
    const addedHeaders = headers.slice(lastColumn);
    sheet.getRange(1, lastColumn + 1, 1, addedHeaders.length).setValues([addedHeaders]);
    sheet.getRange(1, lastColumn + 1, 1, addedHeaders.length).setNumberFormat('@');
  }
  const finalActual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (!headers.every(function(header, index) { return String(finalActual[index] || '') === header; })) throw new ApiError(500, 'SCHEMA_MISMATCH', sheetName + ' 欄位與系統 schema 不一致。');
}

function getDataSheet_(sheetName) { const sheet = resolveMembershipSpreadsheet_().getSheetByName(sheetName); if (!sheet) throw new ApiError(500, 'SCHEMA_MISSING', '缺少資料表：' + sheetName); return sheet; }

function readRecords_(sheetName) {
  const sheet = getDataSheet_(sheetName); const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName]; const lastRow = sheet.getLastRow(); if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().map(function(row) { return rowToRecord_(headers, row); });
}

function readRecordFields_(sheetName, fieldNames) {
  const fields = Array.isArray(fieldNames) ? fieldNames.map(function(field) { return String(field || ''); }) : [];
  if (!fields.length) return [];
  const sheet = getDataSheet_(sheetName);
  const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName];
  const indexes = fields.map(function(field) {
    const index = headers.indexOf(field);
    if (index < 0) throw new ApiError(500, 'SCHEMA_MISSING', '未知欄位：' + field);
    return index;
  });
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const firstIndex = Math.min.apply(null, indexes);
  const lastIndex = Math.max.apply(null, indexes);
  const values = sheet.getRange(2, firstIndex + 1, lastRow - 1, lastIndex - firstIndex + 1).getValues();
  return values.map(function(row) {
    const record = {};
    fields.forEach(function(field, fieldIndex) { record[field] = decodeSheetValue_(row[indexes[fieldIndex] - firstIndex]); });
    return record;
  });
}

function readRecordsByExactField_(sheetName, keyField, keyValue) {
  const sheet = getDataSheet_(sheetName);
  const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName];
  const keyIndex = headers.indexOf(keyField);
  const normalizedKey = String(keyValue || '');
  if (keyIndex < 0) throw new ApiError(500, 'SCHEMA_MISSING', '未知欄位：' + keyField);
  if (!normalizedKey || sheet.getLastRow() < 2) return [];

  const matches = sheet.getRange(2, keyIndex + 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(normalizedKey)
    .matchEntireCell(true)
    .matchCase(true)
    .findAll();
  const rowNumbers = matches.map(function(match) { return match.getRow(); }).sort(function(left, right) { return left - right; });
  if (!rowNumbers.length) return [];

  const groups = [];
  rowNumbers.forEach(function(rowNumber) {
    const last = groups[groups.length - 1];
    if (last && rowNumber === last.end + 1) last.end = rowNumber;
    else groups.push({ start: rowNumber, end: rowNumber });
  });
  return groups.reduce(function(records, group) {
    const values = sheet.getRange(group.start, 1, group.end - group.start + 1, headers.length).getValues();
    return records.concat(values.map(function(row) { return rowToRecord_(headers, row); }));
  }, []);
}

function findRecordWithRow_(sheetName, keyField, keyValue) {
  const sheet = getDataSheet_(sheetName); const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName]; const index = headers.indexOf(keyField); if (index < 0) throw new ApiError(500, 'SCHEMA_MISSING', '未知欄位：' + keyField);
  if (sheet.getLastRow() < 2) return null;
  const match = sheet.getRange(2, index + 1, sheet.getLastRow() - 1, 1).createTextFinder(String(keyValue || '')).matchEntireCell(true).matchCase(true).findNext();
  if (!match) return null;
  return { rowNumber: match.getRow(), record: rowToRecord_(headers, sheet.getRange(match.getRow(), 1, 1, headers.length).getValues()[0]) };
}

function findRecordWithRowByExactFields_(sheetName, expectedFields) {
  const fields = expectedFields && typeof expectedFields === 'object' && !Array.isArray(expectedFields) ? Object.keys(expectedFields) : [];
  if (!fields.length) return null;
  const sheet = getDataSheet_(sheetName);
  const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName];
  fields.forEach(function(field) { if (headers.indexOf(field) < 0) throw new ApiError(500, 'SCHEMA_MISSING', '未知欄位：' + field); });
  if (sheet.getLastRow() < 2) return null;
  const primaryField = fields[0];
  const primaryIndex = headers.indexOf(primaryField);
  const matches = sheet.getRange(2, primaryIndex + 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(expectedFields[primaryField] || ''))
    .matchEntireCell(true)
    .matchCase(true)
    .findAll();
  for (let index = 0; index < matches.length; index += 1) {
    const rowNumber = matches[index].getRow();
    const record = rowToRecord_(headers, sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0]);
    if (fields.every(function(field) { return String(record[field] || '') === String(expectedFields[field] || ''); })) return { rowNumber, record };
  }
  return null;
}

function appendRecord_(sheetName, record) {
  const sheet = getDataSheet_(sheetName); const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName]; const row = Math.max(sheet.getLastRow() + 1, 2); const range = sheet.getRange(row, 1, 1, headers.length); range.setNumberFormat('@'); range.setValues([recordToRow_(headers, record)]); return row;
}

function updateRecordAtRow_(sheetName, rowNumber, record) {
  const sheet = getDataSheet_(sheetName); const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName]; if (rowNumber < 2 || rowNumber > sheet.getLastRow()) throw new ApiError(500, 'INVALID_ROW', '資料列位置不合法。'); const range = sheet.getRange(rowNumber, 1, 1, headers.length); range.setNumberFormat('@'); range.setValues([recordToRow_(headers, record)]);
}

function deleteRecordsWhere_(sheetName, predicate) {
  const sheet = getDataSheet_(sheetName); const headers = MEMBERSHIP_SHEET_SCHEMAS_[sheetName]; const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const rowNumbers = [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (predicate(rowToRecord_(headers, rows[index]))) rowNumbers.push(index + 2);
  }
  for (let index = 0; index < rowNumbers.length;) {
    const end = rowNumbers[index]; let start = end; index += 1;
    while (index < rowNumbers.length && rowNumbers[index] === start - 1) { start = rowNumbers[index]; index += 1; }
    sheet.deleteRows(start, end - start + 1);
  }
  return rowNumbers.length;
}

function resetMembershipSystemDataForNewEnvironment() {
  const spreadsheet = ensureMembershipStorage_();
  const clearedRowsBySheet = withDataLock_(function() {
    const cleared = {};
    Object.keys(MEMBERSHIP_SHEET_SCHEMAS_).forEach(function(sheetName) {
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) throw new ApiError(500, 'SCHEMA_MISSING', '缺少資料表：' + sheetName);
      const rowCount = Math.max(0, sheet.getLastRow() - 1);
      if (rowCount) sheet.deleteRows(2, rowCount);
      cleared[sheetName] = rowCount;
    });

    // Keep the required system baseline while leaving all member and operational records empty.
    const now = nowIso_();
    MEMBERSHIP_TIER_DEFINITIONS_.forEach(function(definition) {
      appendRecord_('MembershipTierSettings', { tier_key: definition.tierKey, tier_label: definition.label, required_service_minutes: String(definition.defaultRequiredServiceMinutes), style_key: membershipTierDefaultStyleKey_(definition.tierKey), updated_by: 'system', updated_at: now });
    });
    return cleared;
  });

  const cache = membershipSchemaCache_();
  if (cache) {
    try { cache.remove(membershipSchemaCacheKey_(spreadsheet.getId())); } catch (_) {}
  }
  clearMembershipTierSettingsCache_();
  rotateMembershipDataCacheEpoch_();
  return { reset: true, spreadsheetId: spreadsheet.getId(), clearedRowsBySheet, restoredMembershipTierSettings: MEMBERSHIP_TIER_DEFINITIONS_.length };
}

function recordToRow_(headers, record) { return headers.map(function(header) { return escapeSheetValue_(record && record[header] !== undefined ? record[header] : ''); }); }
function rowToRecord_(headers, row) { const record = {}; headers.forEach(function(header, index) { record[header] = decodeSheetValue_(row[index]); }); return record; }
function escapeSheetValue_(value) { if (value === null || value === undefined) return ''; const text = String(value); return /^[=+\-@]/.test(text) ? "'" + text : text; }
function decodeSheetValue_(value) { const text = value === null || value === undefined ? '' : String(value); return /^'[=+\-@]/.test(text) ? text.substring(1) : text; }
function withDataLock_(callback) { const lock = LockService.getScriptLock(); try { lock.waitLock(5000); } catch (_) { throw new ApiError(429, 'STORAGE_BUSY', '資料正在更新，請稍後再試。'); } try { return callback(); } finally { lock.releaseLock(); } }
function appendAuditRecord_(record) { appendRecord_('AuditLogs', record); }
function nowIso_() { return new Date().toISOString(); }
