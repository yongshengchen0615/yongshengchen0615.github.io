'use strict';

const DELETED_CARD_DIAGNOSTICS = Object.freeze({
  maxAuditEvents: 100
});

/**
 * Read-only diagnostic for deleted-card reward retention incidents.
 *
 * This function is intentionally not exposed through doPost(). It must remain
 * useful even when the multi-card schema is incomplete, because schema damage
 * is one of the incidents this diagnostic is expected to explain.
 */
function diagnosePointsCardDeletedCardRetention(cardId) {
  const normalizedCardId = validMultiCardId_(cardId, true);
  const missingMultiCardSheets = deletedCardDiagnosticMissingMultiCardSheets_();
  const cardsSheetName = MULTI_CARD_SHEETS.cards || '';
  const cardsAvailable = !cardsSheetName || missingMultiCardSheets.indexOf(cardsSheetName) < 0;
  const cardMatch = cardsAvailable ? findMultiCard_(normalizedCardId) : null;
  const retainedRows = {
    progress: deletedCardDiagnosticCount_(MULTI_CARD_SHEETS.progress, normalizedCardId),
    vouchers: deletedCardDiagnosticCount_(MULTI_CARD_SHEETS.vouchers, normalizedCardId),
    stampRecords: deletedCardDiagnosticCount_(MULTI_CARD_SHEETS.stampRecords, normalizedCardId),
    rewardRecords: deletedCardDiagnosticCount_(MULTI_CARD_SHEETS.rewardRecords, normalizedCardId),
    notifications: deletedCardDiagnosticCount_(MULTI_CARD_SHEETS.notifications, normalizedCardId)
  };
  const deletionAudit = deletedCardDiagnosticAudit_(normalizedCardId);
  const card = cardMatch ? cardMatch.card : null;
  const classification = deletedCardDiagnosticClassification_(
    card,
    retainedRows,
    deletionAudit,
    missingMultiCardSheets
  );

  return {
    cardId: normalizedCardId,
    schemaHealth: {
      complete: missingMultiCardSheets.length === 0,
      missingMultiCardSheets: missingMultiCardSheets
    },
    card: card ? {
      exists: true,
      storedStatus: card.storedStatus,
      status: card.status,
      available: card.available,
      updatedAt: card.updatedAt
    } : {
      exists: false,
      storedStatus: 'missing',
      status: 'missing',
      available: false,
      updatedAt: ''
    },
    retainedRows: retainedRows,
    deletionAudit: deletionAudit,
    classification: classification,
    recoverableFromCurrentRows: Boolean(
      missingMultiCardSheets.length === 0 &&
      card && card.storedStatus === 'deleted' && Number(retainedRows.progress || 0) > 0
    )
  };
}

function deletedCardDiagnosticMissingMultiCardSheets_() {
  if (typeof getSpreadsheet_ !== 'function') return [];
  let spreadsheet;
  try { spreadsheet = getSpreadsheet_(); }
  catch (_) { return ['__storage_unavailable__']; }
  if (!spreadsheet || typeof spreadsheet.getSheetByName !== 'function') return ['__storage_unavailable__'];

  const names = [
    MULTI_CARD_SHEETS.cards,
    MULTI_CARD_SHEETS.progress,
    MULTI_CARD_SHEETS.vouchers,
    MULTI_CARD_SHEETS.stampRecords,
    MULTI_CARD_SHEETS.rewardRecords,
    MULTI_CARD_SHEETS.notifications
  ].filter(Boolean).filter(function (value, index, values) {
    return values.indexOf(value) === index;
  });

  return names.filter(function (sheetName) {
    return !spreadsheet.getSheetByName(sheetName);
  });
}

function deletedCardDiagnosticSheetAvailable_(sheetName) {
  if (!sheetName || typeof getSpreadsheet_ !== 'function') return true;
  try {
    const spreadsheet = getSpreadsheet_();
    return Boolean(spreadsheet && spreadsheet.getSheetByName(sheetName));
  } catch (_) {
    return false;
  }
}

function deletedCardDiagnosticCount_(sheetName, cardId) {
  if (!deletedCardDiagnosticSheetAvailable_(sheetName)) return null;
  const sheet = getMultiCardSheet_(sheetName);
  return readMultiCardObjectsByField_(sheet, 'cardId', cardId).filter(function (row) {
    return String(row.cardId || '') === cardId;
  }).length;
}

function deletedCardDiagnosticAudit_(cardId) {
  const auditSheetName = POINTS_CARD_SHEETS.audit;
  if (typeof getSpreadsheet_ === 'function' && !deletedCardDiagnosticSheetAvailable_(auditSheetName)) {
    return deletedCardDiagnosticAuditSummary_([], false);
  }

  const sheet = getSheet_(auditSheetName);
  const headers = POINTS_CARD_HEADERS.AuditLogs;
  const actionColumn = headers.indexOf('action');
  const resultColumn = headers.indexOf('result');
  const detailsColumn = headers.indexOf('details');
  const timestampColumn = headers.indexOf('timestamp');
  if (actionColumn < 0 || resultColumn < 0 || detailsColumn < 0 || timestampColumn < 0) {
    fail_('SCHEMA_MISMATCH', 'AuditLogs 缺少刪卡診斷所需欄位。');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return deletedCardDiagnosticAuditSummary_([], true);

  const detailsRange = sheet.getRange(2, detailsColumn + 1, lastRow - 1, 1);
  const matches = detailsRange.createTextFinder(cardId)
    .matchCase(false)
    .useRegularExpression(false)
    .findAll()
    .slice(-DELETED_CARD_DIAGNOSTICS.maxAuditEvents);

  const events = matches.map(function (match) {
    const row = sheet.getRange(match.getRow(), 1, 1, headers.length).getValues()[0];
    const action = String(row[actionColumn] || '');
    if (action !== 'CARD_DELETE_REQUESTED' && action !== 'CARD_DELETED') return null;
    const details = deletedCardDiagnosticDetails_(row[detailsColumn]);
    return {
      timestamp: String(row[timestampColumn] || ''),
      action: action,
      result: String(row[resultColumn] || ''),
      mode: deletedCardDiagnosticMode_(details)
    };
  }).filter(Boolean);

  return deletedCardDiagnosticAuditSummary_(events, true);
}

function deletedCardDiagnosticDetails_(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw || '').trim().replace(/^'/, '');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function deletedCardDiagnosticMode_(details) {
  if (!details || typeof details !== 'object') return 'unknown';
  if (details.preservedUnusedRewards === true || details.preservedCounts) return 'archive-preserve';
  if (details.deleteCounts || details.deletedProgressRows != null || details.deletedRewardRows != null) {
    return 'destructive-delete';
  }
  return 'unknown';
}

function deletedCardDiagnosticAuditSummary_(events, available) {
  const destructiveEvidence = events.some(function (event) { return event.mode === 'destructive-delete'; });
  const archiveEvidence = events.some(function (event) { return event.mode === 'archive-preserve'; });
  return {
    available: available !== false,
    events: events,
    destructiveEvidence: destructiveEvidence,
    archiveEvidence: archiveEvidence
  };
}

function deletedCardDiagnosticClassification_(card, retainedRows, deletionAudit, missingMultiCardSheets) {
  if (missingMultiCardSheets && missingMultiCardSheets.length) return 'storage-schema-incomplete';
  if (card && card.storedStatus !== 'deleted') return 'card-not-deleted';
  if (card && card.storedStatus === 'deleted') {
    if (Number(retainedRows.progress || 0) > 0 || Number(retainedRows.rewardRecords || 0) > 0 ||
        Number(retainedRows.stampRecords || 0) > 0) {
      return 'archived-retention-present';
    }
    return deletionAudit.archiveEvidence ? 'archived-retention-empty' : 'deleted-card-no-retained-member-rows';
  }
  if (deletionAudit.destructiveEvidence) return 'historical-destructive-delete-confirmed';
  return 'card-missing-unknown';
}
