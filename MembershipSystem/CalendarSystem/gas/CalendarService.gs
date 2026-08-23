'use strict';

const CALENDAR_TYPES_ = Object.freeze(['holiday', 'event', 'notice']);
const CALENDAR_VISIBLE_STATUSES_ = Object.freeze(['draft', 'published']);
const DATE_KEY_PATTERN_ = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN_ = /^([01]\d|2[0-3]):[0-5]\d$/;

function handleUserBootstrap_(identity) {
  authorizeUserAccount_(identity, true);
  return {
    profile: publicProfile_(identity),
    items: listCalendarItems_(false)
  };
}

function handleUserCalendarList_(identity) {
  authorizeUserAccount_(identity, false);
  return { items: listCalendarItems_(false) };
}

function handleAdminBootstrap_(identity, admin) {
  withDataLock_(function() {
    appendAuditRecord_({
      audit_id: Utilities.getUuid(),
      actor_line_user_id: identity.lineUserId,
      actor_role: admin.role,
      action: 'ADMIN_LOGIN',
      target_type: 'admin_access',
      target_id: identity.lineUserId,
      result: 'success',
      detail: 'Admin LIFF authentication and authorization succeeded',
      created_at: nowIso_()
    });
  });

  return {
    profile: publicProfile_(identity),
    role: admin.role,
    items: listCalendarItems_(true)
  };
}

function handleAdminCalendarList_() {
  return { items: listCalendarItems_(true) };
}

function handleAdminCalendarCreate_(identity, admin, rawItem) {
  const item = validateCalendarItem_(rawItem, false);
  const now = nowIso_();
  const record = {
    item_id: Utilities.getUuid(),
    type: item.type,
    title: item.title,
    start_date: item.startDate,
    end_date: item.endDate,
    all_day: item.allDay ? 'true' : 'false',
    start_time: item.startTime,
    end_time: item.endTime,
    description: item.description,
    location: item.location,
    status: item.status,
    created_by: identity.lineUserId,
    created_at: now,
    updated_by: identity.lineUserId,
    updated_at: now
  };

  withDataLock_(function() {
    appendRecord_('CalendarItems', record);
    appendAuditRecord_({
      audit_id: Utilities.getUuid(),
      actor_line_user_id: identity.lineUserId,
      actor_role: admin.role,
      action: 'CALENDAR_ITEM_CREATE',
      target_type: 'calendar_item',
      target_id: record.item_id,
      result: 'success',
      detail: 'type=' + record.type + ';status=' + record.status,
      created_at: now
    });
  });

  return { item: calendarRecordToApi_(record) };
}

function handleAdminCalendarUpdate_(identity, admin, rawItem, expectedUpdatedAt) {
  const item = validateCalendarItem_(rawItem, true);
  const expected = requireText_(expectedUpdatedAt, 'expectedUpdatedAt', 40, true);
  const now = nowIso_();
  let updatedRecord;

  withDataLock_(function() {
    const match = findRecordWithRow_('CalendarItems', 'item_id', item.itemId);
    if (!match) throw new ApiError(404, 'ITEM_NOT_FOUND', '找不到指定的日曆項目。');
    if (String(match.record.status || '') === 'archived') {
      throw new ApiError(409, 'ITEM_ARCHIVED', '已封存項目不可再編輯。');
    }
    if (String(match.record.updated_at || '') !== expected) {
      throw new ApiError(409, 'CONFLICT', '資料已被其他管理者更新。');
    }

    updatedRecord = {
      item_id: match.record.item_id,
      type: item.type,
      title: item.title,
      start_date: item.startDate,
      end_date: item.endDate,
      all_day: item.allDay ? 'true' : 'false',
      start_time: item.startTime,
      end_time: item.endTime,
      description: item.description,
      location: item.location,
      status: item.status,
      created_by: match.record.created_by,
      created_at: match.record.created_at,
      updated_by: identity.lineUserId,
      updated_at: now
    };

    updateRecordAtRow_('CalendarItems', match.rowNumber, updatedRecord);
    appendAuditRecord_({
      audit_id: Utilities.getUuid(),
      actor_line_user_id: identity.lineUserId,
      actor_role: admin.role,
      action: 'CALENDAR_ITEM_UPDATE',
      target_type: 'calendar_item',
      target_id: updatedRecord.item_id,
      result: 'success',
      detail: 'type=' + updatedRecord.type + ';status=' + updatedRecord.status,
      created_at: now
    });
  });

  return { item: calendarRecordToApi_(updatedRecord) };
}

function handleAdminCalendarArchive_(identity, admin, itemId, expectedUpdatedAt) {
  const id = requireText_(itemId, 'itemId', 64, true);
  validateItemId_(id);
  const expected = requireText_(expectedUpdatedAt, 'expectedUpdatedAt', 40, true);
  const now = nowIso_();
  let archivedRecord;

  withDataLock_(function() {
    const match = findRecordWithRow_('CalendarItems', 'item_id', id);
    if (!match) throw new ApiError(404, 'ITEM_NOT_FOUND', '找不到指定的日曆項目。');
    if (String(match.record.updated_at || '') !== expected) {
      throw new ApiError(409, 'CONFLICT', '資料已被其他管理者更新。');
    }
    if (String(match.record.status || '') === 'archived') {
      archivedRecord = match.record;
      return;
    }

    archivedRecord = Object.assign({}, match.record, {
      status: 'archived',
      updated_by: identity.lineUserId,
      updated_at: now
    });
    updateRecordAtRow_('CalendarItems', match.rowNumber, archivedRecord);
    appendAuditRecord_({
      audit_id: Utilities.getUuid(),
      actor_line_user_id: identity.lineUserId,
      actor_role: admin.role,
      action: 'CALENDAR_ITEM_ARCHIVE',
      target_type: 'calendar_item',
      target_id: id,
      result: 'success',
      detail: 'Soft archived calendar item',
      created_at: now
    });
  });

  return { item: calendarRecordToApi_(archivedRecord) };
}

function authorizeUserAccount_(identity, touchLogin) {
  return withDataLock_(function() {
    ensureCalendarStorage_();
    const now = nowIso_();
    const match = findRecordWithRow_('Users', 'line_user_id', identity.lineUserId);

    if (!match) {
      const record = {
        line_user_id: identity.lineUserId,
        display_name: identity.displayName,
        status: 'active',
        last_login_at: now,
        created_at: now,
        updated_at: now
      };
      appendRecord_('Users', record);
      return record;
    }

    const record = match.record;
    if (String(record.status || '').trim().toLowerCase() !== 'active') {
      throw new ApiError(403, 'ACCOUNT_DISABLED', '此帳號目前不可使用日曆服務。');
    }

    let changed = false;
    if (String(record.display_name || '') !== identity.displayName) {
      record.display_name = identity.displayName;
      changed = true;
    }
    if (touchLogin) {
      record.last_login_at = now;
      changed = true;
    }
    if (changed) {
      record.updated_at = now;
      updateRecordAtRow_('Users', match.rowNumber, record);
    }
    return record;
  });
}

function listCalendarItems_(includeAllStatuses) {
  ensureCalendarStorage_();
  return readRecords_('CalendarItems')
    .filter(function(record) {
      return includeAllStatuses || String(record.status || '') === 'published';
    })
    .map(calendarRecordToApi_)
    .sort(function(a, b) {
      return String(a.startDate).localeCompare(String(b.startDate)) ||
        String(a.startTime || '').localeCompare(String(b.startTime || '')) ||
        String(a.title || '').localeCompare(String(b.title || ''));
    });
}

function validateCalendarItem_(rawItem, requireId) {
  if (!rawItem || Array.isArray(rawItem) || typeof rawItem !== 'object') {
    throw new ApiError(400, 'INVALID_ITEM', '日曆項目格式不合法。');
  }

  const itemId = requireId ? requireText_(rawItem.itemId, 'itemId', 64, true) : '';
  if (itemId) validateItemId_(itemId);

  const type = requireText_(rawItem.type, 'type', 20, true).toLowerCase();
  if (CALENDAR_TYPES_.indexOf(type) === -1) {
    throw new ApiError(400, 'INVALID_TYPE', '日曆類型不合法。');
  }

  const status = requireText_(rawItem.status, 'status', 20, true).toLowerCase();
  if (CALENDAR_VISIBLE_STATUSES_.indexOf(status) === -1) {
    throw new ApiError(400, 'INVALID_STATUS', '日曆狀態不合法。');
  }

  const title = requireText_(rawItem.title, 'title', 80, true);
  const startDate = requireText_(rawItem.startDate, 'startDate', 10, true);
  const endDate = requireText_(rawItem.endDate, 'endDate', 10, true);
  validateDateKey_(startDate, 'startDate');
  validateDateKey_(endDate, 'endDate');

  if (endDate < startDate) {
    throw new ApiError(400, 'INVALID_DATE_RANGE', '結束日期不得早於開始日期。');
  }

  const spanDays = Math.floor((Date.parse(endDate + 'T00:00:00Z') - Date.parse(startDate + 'T00:00:00Z')) / 86400000);
  if (spanDays > 366) {
    throw new ApiError(400, 'DATE_RANGE_TOO_LONG', '單一日曆項目不得超過 366 天。');
  }

  if (typeof rawItem.allDay !== 'boolean') {
    throw new ApiError(400, 'INVALID_ALL_DAY', 'allDay 必須是 boolean。');
  }
  const allDay = rawItem.allDay;
  let startTime = requireText_(rawItem.startTime, 'startTime', 5, false);
  let endTime = requireText_(rawItem.endTime, 'endTime', 5, false);

  if (allDay) {
    startTime = '';
    endTime = '';
  } else {
    if (!TIME_PATTERN_.test(startTime) || !TIME_PATTERN_.test(endTime)) {
      throw new ApiError(400, 'INVALID_TIME', '非全天項目必須提供合法的開始與結束時間。');
    }
    if (startDate === endDate && endTime <= startTime) {
      throw new ApiError(400, 'INVALID_TIME_RANGE', '同一天的結束時間必須晚於開始時間。');
    }
  }

  return {
    itemId: itemId,
    type: type,
    status: status,
    title: title,
    startDate: startDate,
    endDate: endDate,
    allDay: allDay,
    startTime: startTime,
    endTime: endTime,
    location: requireText_(rawItem.location, 'location', 120, false),
    description: requireText_(rawItem.description, 'description', 1000, false)
  };
}

function validateDateKey_(value, fieldName) {
  if (!DATE_KEY_PATTERN_.test(value)) {
    throw new ApiError(400, 'INVALID_DATE', fieldName + ' 日期格式不合法。');
  }
  const parsed = new Date(value + 'T00:00:00Z');
  if (isNaN(parsed.getTime()) || parsed.toISOString().substring(0, 10) !== value) {
    throw new ApiError(400, 'INVALID_DATE', fieldName + ' 日期不存在。');
  }
}

function validateItemId_(value) {
  if (!/^[0-9a-fA-F-]{36}$/.test(value)) {
    throw new ApiError(400, 'INVALID_ITEM_ID', 'itemId 不合法。');
  }
}

function requireText_(value, fieldName, maxLength, required) {
  if (value === null || value === undefined) {
    if (required) throw new ApiError(400, 'VALIDATION_ERROR', fieldName + ' 為必填。');
    return '';
  }
  if (typeof value !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', fieldName + ' 必須是字串。');
  }
  const text = value.trim();
  if (required && !text) {
    throw new ApiError(400, 'VALIDATION_ERROR', fieldName + ' 為必填。');
  }
  if (text.length > maxLength) {
    throw new ApiError(400, 'VALIDATION_ERROR', fieldName + ' 超過長度限制。');
  }
  return text;
}

function publicProfile_(identity) {
  return {
    lineUserId: identity.lineUserId,
    displayName: identity.displayName
  };
}

function calendarRecordToApi_(record) {
  return {
    itemId: String(record.item_id || ''),
    type: String(record.type || ''),
    title: String(record.title || ''),
    startDate: String(record.start_date || ''),
    endDate: String(record.end_date || ''),
    allDay: String(record.all_day || '').toLowerCase() === 'true',
    startTime: String(record.start_time || ''),
    endTime: String(record.end_time || ''),
    description: String(record.description || ''),
    location: String(record.location || ''),
    status: String(record.status || ''),
    createdAt: String(record.created_at || ''),
    updatedAt: String(record.updated_at || '')
  };
}
