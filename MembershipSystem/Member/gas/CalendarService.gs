'use strict';

const CALENDAR_ITEM_TYPES_ = Object.freeze(['holiday', 'event']);
const CALENDAR_ITEM_STATUSES_ = Object.freeze(['active', 'draft', 'archived']);
const CALENDAR_ITEM_MAX_VISIBLE_RANGE_DAYS_ = 62;
const CALENDAR_ITEM_MAX_DURATION_DAYS_ = 366;

function handleCalendarBootstrap_(identity, request) {
  const member = ensureMember_(identity);
  const range = calendarRangeFromRequest_(request);
  return {
    profile: { displayName: String(member.display_name || identity.displayName || 'LINE 使用者') },
    rangeStart: range.start,
    rangeEnd: range.end,
    items: readCalendarItemsForRange_(range.start, range.end)
  };
}

function readCalendarItems_(includeAdminDetails) {
  return readRecords_('CalendarItems').map(function(item) {
    return calendarItemForClient_(item, includeAdminDetails);
  }).sort(function(left, right) {
    return String(left.startsOn).localeCompare(String(right.startsOn)) || String(left.title).localeCompare(String(right.title));
  });
}

function readCalendarItemsForRange_(rangeStart, rangeEnd) {
  return readCalendarItems_(false).filter(function(item) {
    return item.status === 'active' && calendarItemOverlapsRange_(item, rangeStart, rangeEnd);
  });
}

function calendarItemForClient_(item, includeAdminDetails) {
  const clientItem = {
    calendarItemId: String(item.calendar_item_id || ''),
    title: String(item.title || ''),
    itemType: String(item.item_type || '') === 'holiday' ? 'holiday' : 'event',
    description: String(item.description || ''),
    startsOn: String(item.starts_on || ''),
    endsOn: String(item.ends_on || ''),
    status: String(item.status || 'draft'),
    accent: calendarItemAccent_(item.accent)
  };
  if (includeAdminDetails) {
    clientItem.createdAt = String(item.created_at || '');
    clientItem.updatedAt = String(item.updated_at || '');
  }
  return clientItem;
}

function handleCalendarItemSave_(identity, admin, request) {
  const input = request.calendarItem && typeof request.calendarItem === 'object' && !Array.isArray(request.calendarItem) ? request.calendarItem : {};
  const calendarItemId = String(input.calendarItemId || '').trim();
  const title = String(input.title || '').trim();
  const itemType = String(input.itemType || '').trim().toLowerCase();
  const description = String(input.description || '').trim();
  const startsOn = calendarNormalizeDate_(input.startsOn, '開始日');
  const endsOn = calendarNormalizeDate_(input.endsOn || input.startsOn, '結束日');
  const status = String(input.status || '').trim().toLowerCase();
  const accent = calendarItemAccent_(input.accent);
  const expected = String(request.expectedUpdatedAt || '').trim();
  if (!title || title.length > 100 || CALENDAR_ITEM_TYPES_.indexOf(itemType) < 0 || description.length > 500 || !startsOn || !endsOn || startsOn > endsOn || !calendarRangeWithinLimit_(startsOn, endsOn, CALENDAR_ITEM_MAX_DURATION_DAYS_) || CALENDAR_ITEM_STATUSES_.indexOf(status) < 0 || !/^#[0-9a-f]{6}$/i.test(String(input.accent || '').trim())) {
    throw new ApiError(400, 'INVALID_CALENDAR_ITEM', '日曆項目的名稱、類型、日期、說明或狀態不合法。');
  }

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
      item = { calendar_item_id: 'CI-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), created_by: identity.lineUserId, created_at: now };
    }
    item.title = title;
    item.item_type = itemType;
    item.description = description;
    item.starts_on = startsOn;
    item.ends_on = endsOn;
    item.status = status;
    item.accent = accent;
    item.updated_by = identity.lineUserId;
    item.updated_at = now;
    if (rowNumber) updateRecordAtRow_('CalendarItems', rowNumber, item); else appendRecord_('CalendarItems', item);
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'CALENDAR_ITEM_SAVE', target_type: 'calendar_item', target_id: item.calendar_item_id, result: 'success', detail: 'Calendar item saved', created_at: now });
    rotateMembershipDataCacheEpoch_();
    return { calendarItem: calendarItemForClient_(item, true) };
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
