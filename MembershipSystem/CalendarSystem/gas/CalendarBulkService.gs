'use strict';

const CALENDAR_BULK_MAX_ITEMS_ = 20;

function handleAdminCalendarBulkCreate_(identity, admin, rawItems) {
  const items = requireCalendarBulkArray_(rawItems, 'items').map(function(rawItem) {
    const item = validateCalendarItem_(rawItem, false);
    enforceAdminCalendarNotPast_(item);
    return item;
  });
  const now = nowIso_();
  const records = items.map(function(item) {
    return {
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
      updated_at: now,
      color: item.color
    };
  });

  withDataLock_(function() {
    appendRecordsBatch_('CalendarItems', records);
    appendRecordsBatch_('AuditLogs', records.map(function(record) {
      return calendarBulkAuditRecord_(identity, admin, 'CALENDAR_ITEM_CREATE', record.item_id, 'type=' + record.type + ';status=' + record.status, now);
    }));
    bumpCalendarDataRevision_();
  });

  return { items: records.map(calendarRecordToApi_), count: records.length };
}

function handleAdminCalendarBulkUpdate_(identity, admin, rawUpdates) {
  const updates = requireCalendarBulkArray_(rawUpdates, 'updates').map(function(entry) {
    if (!entry || Array.isArray(entry) || typeof entry !== 'object') {
      throw new ApiError(400, 'INVALID_BULK_UPDATE', '批量修改資料格式不合法。');
    }
    const item = validateCalendarItem_(entry.item, true);
    enforceAdminCalendarNotPast_(item);
    return {
      item: item,
      expectedUpdatedAt: requireText_(entry.expectedUpdatedAt, 'expectedUpdatedAt', 40, true)
    };
  });
  ensureUniqueBulkItemIds_(updates.map(function(entry) { return entry.item.itemId; }));

  const now = nowIso_();
  let updatedRecords = [];

  withDataLock_(function() {
    const table = readCalendarItemTable_();
    const byId = indexCalendarItemTable_(table.records);
    const rowUpdates = [];

    updatedRecords = updates.map(function(entry) {
      const match = byId[entry.item.itemId];
      if (!match) throw new ApiError(404, 'ITEM_NOT_FOUND', '找不到指定的日曆項目。');
      if (String(match.record.status || '') === 'archived') {
        throw new ApiError(409, 'ITEM_ARCHIVED', '已封存項目不可再編輯。');
      }
      if (String(match.record.updated_at || '') !== entry.expectedUpdatedAt) {
        throw new ApiError(409, 'CONFLICT', '資料已被其他管理者更新。', { itemId: entry.item.itemId });
      }

      const updated = {
        item_id: match.record.item_id,
        type: entry.item.type,
        title: entry.item.title,
        start_date: entry.item.startDate,
        end_date: entry.item.endDate,
        all_day: entry.item.allDay ? 'true' : 'false',
        start_time: entry.item.startTime,
        end_time: entry.item.endTime,
        description: entry.item.description,
        location: entry.item.location,
        status: entry.item.status,
        created_by: match.record.created_by,
        created_at: match.record.created_at,
        updated_by: identity.lineUserId,
        updated_at: now,
        color: entry.item.color
      };
      rowUpdates.push({ rowNumber: match.rowNumber, record: updated });
      return updated;
    });

    writeCalendarRowsBatch_(table.sheet, rowUpdates);
    appendRecordsBatch_('AuditLogs', updatedRecords.map(function(record) {
      return calendarBulkAuditRecord_(identity, admin, 'CALENDAR_ITEM_UPDATE', record.item_id, 'type=' + record.type + ';status=' + record.status, now);
    }));
    bumpCalendarDataRevision_();
  });

  return { items: updatedRecords.map(calendarRecordToApi_), count: updatedRecords.length };
}

function handleAdminCalendarBulkArchive_(identity, admin, rawItems) {
  const requests = requireCalendarBulkArray_(rawItems, 'items').map(function(entry) {
    if (!entry || Array.isArray(entry) || typeof entry !== 'object') {
      throw new ApiError(400, 'INVALID_BULK_ARCHIVE', '批量移除資料格式不合法。');
    }
    const itemId = requireText_(entry.itemId, 'itemId', 64, true);
    validateItemId_(itemId);
    return {
      itemId: itemId,
      expectedUpdatedAt: requireText_(entry.expectedUpdatedAt, 'expectedUpdatedAt', 40, true)
    };
  });
  ensureUniqueBulkItemIds_(requests.map(function(entry) { return entry.itemId; }));

  const now = nowIso_();
  let archivedRecords = [];
  let changedRecords = [];

  withDataLock_(function() {
    const table = readCalendarItemTable_();
    const byId = indexCalendarItemTable_(table.records);
    const rowUpdates = [];

    archivedRecords = requests.map(function(entry) {
      const match = byId[entry.itemId];
      if (!match) throw new ApiError(404, 'ITEM_NOT_FOUND', '找不到指定的日曆項目。');
      if (String(match.record.updated_at || '') !== entry.expectedUpdatedAt) {
        throw new ApiError(409, 'CONFLICT', '資料已被其他管理者更新。', { itemId: entry.itemId });
      }
      if (String(match.record.status || '') === 'archived') return match.record;

      const archived = Object.assign({}, match.record, {
        status: 'archived',
        updated_by: identity.lineUserId,
        updated_at: now
      });
      rowUpdates.push({ rowNumber: match.rowNumber, record: archived });
      changedRecords.push(archived);
      return archived;
    });

    if (changedRecords.length) {
      writeCalendarRowsBatch_(table.sheet, rowUpdates);
      appendRecordsBatch_('AuditLogs', changedRecords.map(function(record) {
        return calendarBulkAuditRecord_(identity, admin, 'CALENDAR_ITEM_ARCHIVE', record.item_id, 'Soft archived calendar item via bulk action', now);
      }));
      bumpCalendarDataRevision_();
    }
  });

  return { items: archivedRecords.map(calendarRecordToApi_), count: archivedRecords.length };
}

function requireCalendarBulkArray_(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_BULK_REQUEST', fieldName + ' 必須是陣列。');
  }
  if (value.length < 1) {
    throw new ApiError(400, 'INVALID_BULK_REQUEST', '至少需要 1 筆資料。');
  }
  if (value.length > CALENDAR_BULK_MAX_ITEMS_) {
    throw new ApiError(400, 'BULK_LIMIT_EXCEEDED', '單次批量操作最多 ' + CALENDAR_BULK_MAX_ITEMS_ + ' 筆。');
  }
  return value;
}

function ensureUniqueBulkItemIds_(itemIds) {
  const seen = {};
  itemIds.forEach(function(itemId) {
    if (seen[itemId]) {
      throw new ApiError(400, 'DUPLICATE_ITEM_ID', '同一批次不可重複操作相同項目。', { itemId: itemId });
    }
    seen[itemId] = true;
  });
}

function readCalendarItemTable_() {
  const sheet = getDataSheet_('CalendarItems');
  const headers = CALENDAR_SHEET_SCHEMAS_.CalendarItems;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { sheet: sheet, records: [] };
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return {
    sheet: sheet,
    records: values.map(function(row) { return rowToRecord_(headers, row); })
  };
}

function indexCalendarItemTable_(records) {
  const byId = {};
  records.forEach(function(record, index) {
    const itemId = String(record.item_id || '');
    if (itemId) byId[itemId] = { rowNumber: index + 2, record: record };
  });
  return byId;
}

function writeCalendarRowsBatch_(sheet, rowUpdates) {
  if (!rowUpdates || !rowUpdates.length) return;
  const headers = CALENDAR_SHEET_SCHEMAS_.CalendarItems;
  const sorted = rowUpdates.slice().sort(function(a, b) { return a.rowNumber - b.rowNumber; });
  let group = [];

  function flushGroup_() {
    if (!group.length) return;
    const range = sheet.getRange(group[0].rowNumber, 1, group.length, headers.length);
    range.setNumberFormat('@');
    range.setValues(group.map(function(entry) { return recordToRow_(headers, entry.record); }));
    group = [];
  }

  sorted.forEach(function(entry) {
    if (!group.length || entry.rowNumber === group[group.length - 1].rowNumber + 1) {
      group.push(entry);
      return;
    }
    flushGroup_();
    group.push(entry);
  });
  flushGroup_();
}

function appendRecordsBatch_(sheetName, records) {
  if (!records || !records.length) return;
  const sheet = getDataSheet_(sheetName);
  const headers = CALENDAR_SHEET_SCHEMAS_[sheetName];
  if (!headers) throw new ApiError(500, 'SCHEMA_MISSING', '未知資料表：' + sheetName);
  const rowNumber = Math.max(sheet.getLastRow() + 1, 2);
  const range = sheet.getRange(rowNumber, 1, records.length, headers.length);
  range.setNumberFormat('@');
  range.setValues(records.map(function(record) { return recordToRow_(headers, record); }));
}

function calendarBulkAuditRecord_(identity, admin, action, targetId, detail, createdAt) {
  return {
    audit_id: Utilities.getUuid(),
    actor_line_user_id: identity.lineUserId,
    actor_role: admin.role,
    action: action,
    target_type: 'calendar_item',
    target_id: targetId,
    result: 'success',
    detail: detail,
    created_at: createdAt
  };
}
