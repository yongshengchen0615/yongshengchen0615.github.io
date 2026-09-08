'use strict';

const CALENDAR_ITEM_TYPES_ = Object.freeze(['holiday', 'event']);
const CALENDAR_ITEM_STATUSES_ = Object.freeze(['active', 'draft', 'archived']);
const CALENDAR_ITEM_MAX_VISIBLE_RANGE_DAYS_ = 93;
const CALENDAR_ITEM_MAX_DURATION_DAYS_ = 366;
const CALENDAR_ITEM_BATCH_MAX_OPERATIONS_ = 20;

function handleCalendarBootstrap_(identity, request) {
  const member = ensureMember_(identity);
  if (typeof assertMemberJoined_ === 'function') assertMemberJoined_(member);
  const range = calendarRangeFromRequest_(request);
  const profile = calendarMemberProfileForClient_(member, identity);
  const buildPayload = function() {
    return {
      profile: profile,
      rangeStart: range.start,
      rangeEnd: range.end,
      items: readCalendarItemsForRange_(range.start, range.end, calendarMemberTierKey_(profile))
    };
  };
  return typeof membershipVersionedBootstrapResponse_ === 'function'
    ? membershipVersionedBootstrapResponse_('calendar:' + range.start + ':' + range.end, identity, request, buildPayload)
    : buildPayload();
}

function calendarMemberProfileForClient_(member, identity) {
  const profile = memberForClient_(member);
  return {
    displayName: String(profile.displayName || identity.displayName || 'LINE 使用者'),
    tier: String(profile.tier || '一般會員'),
    tierProgress: profile.tierProgress && typeof profile.tierProgress === 'object' ? profile.tierProgress : {}
  };
}

function readCalendarItems_(includeAdminDetails) {
  return readRecords_('CalendarItems').map(function(item) {
    return calendarItemForClient_(item, includeAdminDetails);
  }).sort(function(left, right) {
    return String(left.startsOn).localeCompare(String(right.startsOn)) || String(left.title).localeCompare(String(right.title));
  });
}

function readCalendarItemsForRange_(rangeStart, rangeEnd, memberTierKey) {
  const buildPayload = function() {
    return readRecords_('CalendarItems').map(function(item) {
      return calendarItemForClient_(item, false);
    }).filter(function(item) {
      return item.status === 'active' && calendarItemOverlapsRange_(item, rangeStart, rangeEnd);
    }).sort(function(left, right) {
      return String(left.startsOn).localeCompare(String(right.startsOn)) || String(left.title).localeCompare(String(right.title));
    });
  };
  const baseItems = typeof membershipReadThroughCache_ === 'function'
    ? membershipReadThroughCache_('calendar-range:' + rangeStart + ':' + rangeEnd, buildPayload)
    : buildPayload();
  return (Array.isArray(baseItems) ? baseItems : []).map(function(item) {
    const clientItem = Object.assign({}, item);
    if (clientItem.itemType === 'event') clientItem.tierEligible = (clientItem.allowedTierKeys || []).indexOf(memberTierKey) >= 0;
    return clientItem;
  });
}

function calendarItemForClient_(item, includeAdminDetails, memberTierKey) {
  const itemType = String(item.item_type || '') === 'holiday' ? 'holiday' : 'event';
  const allowedTierKeys = itemType === 'event' ? calendarItemAllowedTierKeys_(item) : [];
  const link = itemType === 'event' ? calendarItemLink_(item) : { label: '', url: '' };
  const clientItem = {
    calendarItemId: String(item.calendar_item_id || ''),
    title: String(item.title || ''),
    itemType: itemType,
    description: String(item.description || ''),
    startsOn: String(item.starts_on || ''),
    endsOn: String(item.ends_on || ''),
    status: String(item.status || 'draft'),
    accent: calendarItemAccent_(item.accent),
    allowedTierKeys: allowedTierKeys,
    allowedTierLabels: calendarItemTierLabels_(allowedTierKeys),
    linkLabel: link.label,
    linkUrl: link.url
  };
  if (!includeAdminDetails && itemType === 'event') clientItem.tierEligible = allowedTierKeys.indexOf(memberTierKey) >= 0;
  if (includeAdminDetails) {
    clientItem.createdAt = String(item.created_at || '');
    clientItem.updatedAt = String(item.updated_at || '');
  }
  return clientItem;
}

function handleCalendarItemSave_(identity, admin, request) {
  const input = calendarItemInputFromRequest_(request.calendarItem);
  const calendarItemId = input.calendarItemId;
  const expected = String(request.expectedUpdatedAt || '').trim();

  return withDataLock_(function() {
    const now = nowIso_();
    let item;
    let rowNumber = 0;
    if (calendarItemId) {
      const match = findRecordWithRow_('CalendarItems', 'calendar_item_id', calendarItemId);
      if (!match) throw new ApiError(404, 'CALENDAR_ITEM_NOT_FOUND', '找不到日曆項目。');
      if (expected && String(match.record.updated_at || '') !== expected) throw new ApiError(409, 'CONFLICT', '日曆項目已被更新，請重新整理。');
      item = match.record;
      rowNumber = match.rowNumber;
    } else {
      item = { calendar_item_id: calendarNewItemId_(), created_by: identity.lineUserId, created_at: now };
    }
    calendarApplyItemInput_(item, input, identity.lineUserId, now);
    item.updated_by = identity.lineUserId;
    item.updated_at = now;
    if (rowNumber) updateRecordAtRow_('CalendarItems', rowNumber, item); else appendRecord_('CalendarItems', item);
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'CALENDAR_ITEM_SAVE', target_type: 'calendar_item', target_id: item.calendar_item_id, result: 'success', detail: 'Calendar item saved', created_at: now });
    rotateMembershipDataCacheEpoch_();
    return { calendarItem: calendarItemForClient_(item, true) };
  });
}

function handleCalendarItemBatch_(identity, admin, request) {
  const operations = calendarBatchOperationsFromRequest_(request);
  return withDataLock_(function() {
    const prepared = operations.map(function(operation) {
      if (operation.operation === 'save' && !operation.calendarItem.calendarItemId) return { operation: operation, match: null };
      const calendarItemId = operation.operation === 'save' ? operation.calendarItem.calendarItemId : operation.calendarItemId;
      const match = findRecordWithRow_('CalendarItems', 'calendar_item_id', calendarItemId);
      if (!match) throw new ApiError(404, 'CALENDAR_ITEM_NOT_FOUND', '找不到日曆項目。');
      if (operation.expectedUpdatedAt && String(match.record.updated_at || '') !== operation.expectedUpdatedAt) {
        throw new ApiError(409, 'CONFLICT', '日曆項目已被更新，請重新整理。');
      }
      return { operation: operation, match: match };
    });
    const now = nowIso_();
    const savedCalendarItems = [];
    const deletedCalendarItemIds = [];

    prepared.forEach(function(entry) {
      if (entry.operation.operation !== 'save') return;
      const item = entry.match ? entry.match.record : {
        calendar_item_id: calendarNewItemId_(),
        created_by: identity.lineUserId,
        created_at: now
      };
      calendarApplyItemInput_(item, entry.operation.calendarItem, identity.lineUserId, now);
      if (entry.match) updateRecordAtRow_('CalendarItems', entry.match.rowNumber, item); else appendRecord_('CalendarItems', item);
      savedCalendarItems.push(calendarItemForClient_(item, true));
      appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'CALENDAR_ITEM_BATCH_SAVE', target_type: 'calendar_item', target_id: item.calendar_item_id, result: 'success', detail: 'Calendar batch item saved', created_at: now });
    });

    const deleteIds = prepared.filter(function(entry) { return entry.operation.operation === 'delete'; }).map(function(entry) { return entry.operation.calendarItemId; });
    if (deleteIds.length) {
      const deleteIdSet = Object.create(null);
      deleteIds.forEach(function(calendarItemId) { deleteIdSet[calendarItemId] = true; });
      deleteRecordsWhere_('CalendarItems', function(item) { return Boolean(deleteIdSet[String(item.calendar_item_id || '')]); });
      deleteIds.forEach(function(calendarItemId) {
        deletedCalendarItemIds.push(calendarItemId);
        appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'CALENDAR_ITEM_BATCH_DELETE', target_type: 'calendar_item', target_id: calendarItemId, result: 'success', detail: 'Calendar batch item deleted', created_at: now });
      });
    }
    rotateMembershipDataCacheEpoch_();
    return { savedCalendarItems: savedCalendarItems, deletedCalendarItemIds: deletedCalendarItemIds, operationCount: operations.length };
  });
}

function handleCalendarItemDelete_(identity, admin, request) {
  const calendarItemId = String(request.calendarItemId || '').trim();
  const expected = String(request.expectedUpdatedAt || '').trim();
  if (!calendarItemId || calendarItemId.length > 80 || expected.length > 80) throw new ApiError(400, 'INVALID_CALENDAR_ITEM_DELETE', '日曆項目識別碼不合法。');
  return withDataLock_(function() {
    const match = findRecordWithRow_('CalendarItems', 'calendar_item_id', calendarItemId);
    if (!match) throw new ApiError(404, 'CALENDAR_ITEM_NOT_FOUND', '找不到日曆項目。');
    if (expected && String(match.record.updated_at || '') !== expected) throw new ApiError(409, 'CONFLICT', '日曆項目已被更新，請重新整理。');
    const deleted = deleteRecordsWhere_('CalendarItems', function(item) { return String(item.calendar_item_id || '') === calendarItemId; });
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'CALENDAR_ITEM_DELETE', target_type: 'calendar_item', target_id: calendarItemId, result: 'success', detail: 'Calendar item deleted', created_at: nowIso_() });
    rotateMembershipDataCacheEpoch_();
    return { deleted: Boolean(deleted), calendarItemId: calendarItemId };
  });
}

function calendarItemInputFromRequest_(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const input = {
    calendarItemId: String(raw.calendarItemId || '').trim(),
    title: String(raw.title || '').trim(),
    itemType: String(raw.itemType || '').trim().toLowerCase(),
    description: String(raw.description || '').trim(),
    startsOn: calendarNormalizeDate_(raw.startsOn, '開始日'),
    endsOn: calendarNormalizeDate_(raw.endsOn || raw.startsOn, '結束日'),
    status: String(raw.status || '').trim().toLowerCase(),
    accent: calendarItemAccent_(raw.accent),
    allowedTierKeys: Object.prototype.hasOwnProperty.call(raw, 'allowedTierKeys') ? raw.allowedTierKeys : undefined,
    link: Object.prototype.hasOwnProperty.call(raw, 'linkLabel') || Object.prototype.hasOwnProperty.call(raw, 'linkUrl') ? { label: raw.linkLabel, url: raw.linkUrl } : undefined
  };
  if (input.calendarItemId.length > 80 || !input.title || input.title.length > 100 || CALENDAR_ITEM_TYPES_.indexOf(input.itemType) < 0 || input.description.length > 500 || !input.startsOn || !input.endsOn || input.startsOn > input.endsOn || !calendarRangeWithinLimit_(input.startsOn, input.endsOn, CALENDAR_ITEM_MAX_DURATION_DAYS_) || CALENDAR_ITEM_STATUSES_.indexOf(input.status) < 0 || !/^#[0-9a-f]{6}$/i.test(String(raw.accent || '').trim())) {
    throw new ApiError(400, 'INVALID_CALENDAR_ITEM', '日曆項目的名稱、類型、日期、說明或狀態不合法。');
  }
  return input;
}

function calendarBatchOperationsFromRequest_(request) {
  const rawOperations = request && request.calendarItemOperations;
  if (!Array.isArray(rawOperations) || !rawOperations.length || rawOperations.length > CALENDAR_ITEM_BATCH_MAX_OPERATIONS_) {
    throw new ApiError(400, 'INVALID_CALENDAR_BATCH', '每次批次處理需要 1–' + CALENDAR_ITEM_BATCH_MAX_OPERATIONS_ + ' 個日曆項目。');
  }
  const existingIds = Object.create(null);
  return rawOperations.map(function(rawOperation) {
    const value = rawOperation && typeof rawOperation === 'object' && !Array.isArray(rawOperation) ? rawOperation : {};
    const operation = String(value.operation || '').trim().toLowerCase();
    const expectedUpdatedAt = String(value.expectedUpdatedAt || '').trim();
    if (expectedUpdatedAt.length > 80) throw new ApiError(400, 'INVALID_CALENDAR_BATCH', '日曆項目的版本資料不合法。');
    if (operation === 'save') {
      const calendarItem = calendarItemInputFromRequest_(value.calendarItem);
      if (calendarItem.calendarItemId) {
        if (!expectedUpdatedAt) throw new ApiError(400, 'INVALID_CALENDAR_BATCH', '批次修改需要日曆項目的版本資料。');
        if (existingIds[calendarItem.calendarItemId]) throw new ApiError(400, 'DUPLICATE_CALENDAR_ITEM_OPERATION', '同一個日曆項目不能在同一批次重複處理。');
        existingIds[calendarItem.calendarItemId] = true;
      }
      return { operation: operation, calendarItem: calendarItem, expectedUpdatedAt: expectedUpdatedAt };
    }
    if (operation === 'delete') {
      const calendarItemId = String(value.calendarItemId || '').trim();
      if (!calendarItemId || calendarItemId.length > 80) throw new ApiError(400, 'INVALID_CALENDAR_BATCH', '日曆項目識別碼不合法。');
      if (!expectedUpdatedAt) throw new ApiError(400, 'INVALID_CALENDAR_BATCH', '批次刪除需要日曆項目的版本資料。');
      if (existingIds[calendarItemId]) throw new ApiError(400, 'DUPLICATE_CALENDAR_ITEM_OPERATION', '同一個日曆項目不能在同一批次重複處理。');
      existingIds[calendarItemId] = true;
      return { operation: operation, calendarItemId: calendarItemId, expectedUpdatedAt: expectedUpdatedAt };
    }
    throw new ApiError(400, 'INVALID_CALENDAR_BATCH', '批次日曆操作不合法。');
  });
}

function calendarApplyItemInput_(item, input, lineUserId, now) {
  item.title = input.title;
  item.item_type = input.itemType;
  item.description = input.description;
  item.starts_on = input.startsOn;
  item.ends_on = input.endsOn;
  item.status = input.status;
  item.accent = input.accent;
  item.allowed_tier_keys = JSON.stringify(calendarItemAllowedTierKeysForSave_(input, item));
  const link = calendarItemLinkForSave_(input, item);
  item.link_label = link.label;
  item.link_url = link.url;
  item.updated_by = lineUserId;
  item.updated_at = now;
}

function calendarItemTierDefinitions_() {
  if (typeof MEMBERSHIP_TIER_DEFINITIONS_ !== 'undefined' && Array.isArray(MEMBERSHIP_TIER_DEFINITIONS_)) return MEMBERSHIP_TIER_DEFINITIONS_;
  return [
    { tierKey: 'general', label: '一般會員' },
    { tierKey: 'silver', label: '銀級會員' },
    { tierKey: 'gold', label: '金級會員' },
    { tierKey: 'platinum', label: '白金會員' }
  ];
}

function calendarItemAllTierKeys_() { return calendarItemTierDefinitions_().map(function(tier) { return tier.tierKey; }); }

function calendarItemTierLabels_(tierKeys) {
  const allowed = Array.isArray(tierKeys) ? tierKeys : [];
  return calendarItemTierDefinitions_().filter(function(tier) { return allowed.indexOf(tier.tierKey) >= 0; }).map(function(tier) { return tier.label; });
}

function normalizeCalendarItemAllowedTierKeys_(value) {
  if (!Array.isArray(value)) throw new ApiError(400, 'INVALID_CALENDAR_ITEM', '活動適用會員等級不合法。');
  const requested = {};
  value.forEach(function(item) { const tierKey = String(item || '').trim(); if (tierKey) requested[tierKey] = true; });
  const allowedTierKeys = calendarItemAllTierKeys_().filter(function(tierKey) { return Boolean(requested[tierKey]); });
  if (!allowedTierKeys.length || Object.keys(requested).length !== allowedTierKeys.length) throw new ApiError(400, 'INVALID_CALENDAR_ITEM', '請至少選擇一個有效的活動適用會員等級。');
  return allowedTierKeys;
}

function calendarItemAllowedTierKeys_(item) {
  const raw = String(item && item.allowed_tier_keys || '').trim();
  if (!raw) return calendarItemAllTierKeys_();
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { return []; }
  if (!Array.isArray(parsed)) return [];
  const requested = {};
  parsed.forEach(function(value) { const tierKey = String(value || '').trim(); if (tierKey) requested[tierKey] = true; });
  return calendarItemAllTierKeys_().filter(function(tierKey) { return Boolean(requested[tierKey]); });
}

function calendarItemAllowedTierKeysForSave_(input, existingItem) {
  if (input.itemType !== 'event') return [];
  if (input.allowedTierKeys === undefined) {
    return existingItem && String(existingItem.item_type || '') === 'event' ? calendarItemAllowedTierKeys_(existingItem) : calendarItemAllTierKeys_();
  }
  return normalizeCalendarItemAllowedTierKeys_(input.allowedTierKeys);
}

function calendarItemLink_(item) {
  const label = String(item && item.link_label || '').trim();
  const url = String(item && item.link_url || '').trim();
  return label && label.length <= 80 && url && url.length <= 2048 && calendarItemIsSafeHttpsUrl_(url) ? { label: label, url: url } : { label: '', url: '' };
}

function calendarItemLinkForSave_(input, existingItem) {
  if (input.itemType !== 'event') return { label: '', url: '' };
  if (input.link === undefined) return calendarItemLink_(existingItem);
  const label = String(input.link.label || '').trim();
  const url = String(input.link.url || '').trim();
  if (!label && !url) return { label: '', url: '' };
  if (!label || !url || label.length > 80 || url.length > 2048 || !calendarItemIsSafeHttpsUrl_(url)) {
    throw new ApiError(400, 'INVALID_CALENDAR_ITEM', '活動連結名稱與 HTTPS 網址不合法。');
  }
  return { label: label, url: url };
}

function calendarItemIsSafeHttpsUrl_(value) {
  const url = String(value || '').trim();
  return /^https:\/\/[^\s<>"']+$/i.test(url) && /^https:\/\/[^\/?#@]+(?:[\/?#]|$)/i.test(url);
}

function calendarMemberTierKey_(profile) {
  const tierKey = String(profile && profile.tierProgress && profile.tierProgress.currentTierKey || '').trim();
  return calendarItemAllTierKeys_().indexOf(tierKey) >= 0 ? tierKey : 'general';
}

function calendarNewItemId_() {
  return 'CI-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase();
}

function calendarRangeFromRequest_(request) {
  const rawStart = String(request && request.rangeStart || '').trim();
  const rawEnd = String(request && request.rangeEnd || '').trim();
  if (!rawStart && !rawEnd) {
    const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
    return { start: calendarAddDays_(today, -31), end: calendarAddDays_(today, 31) };
  }
  const start = calendarNormalizeDate_(rawStart, '查詢開始日');
  const end = calendarNormalizeDate_(rawEnd, '查詢結束日');
  if (!start || !end || start > end || !calendarRangeWithinLimit_(start, end, CALENDAR_ITEM_MAX_VISIBLE_RANGE_DAYS_)) {
    throw new ApiError(400, 'INVALID_CALENDAR_RANGE', '日曆查詢區間不合法。');
  }
  return { start: start, end: end };
}

function calendarItemOverlapsRange_(item, rangeStart, rangeEnd) {
  const startsOn = String(item && item.startsOn || '');
  const endsOn = String(item && item.endsOn || startsOn);
  return Boolean(startsOn && endsOn && startsOn <= rangeEnd && endsOn >= rangeStart);
}

function calendarNormalizeDate_(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new ApiError(400, 'INVALID_CALENDAR_DATE', label + '格式不合法。');
  const parts = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) throw new ApiError(400, 'INVALID_CALENDAR_DATE', label + '格式不合法。');
  return normalized;
}

function calendarRangeWithinLimit_(start, end, maxDays) {
  const startDate = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  const days = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
  return Number.isInteger(days) && days >= 1 && days <= maxDays;
}

function calendarAddDays_(value, days) {
  const date = new Date(String(value) + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function calendarItemAccent_(value) {
  const accent = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(accent) ? accent.toUpperCase() : '#DF6B4D';
}
