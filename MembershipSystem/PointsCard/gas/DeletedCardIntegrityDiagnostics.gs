'use strict';

const DELETED_CARD_DIAGNOSTICS = Object.freeze({
  maxAuditEvents: 100
});

/**
 * Read-only diagnostic for deleted-card reward retention incidents.
 *
 * This function is intentionally not exposed through doPost(). It is meant for
 * trusted Apps Script operators investigating whether a card was archived by
 * the current retention flow or removed by an older destructive-delete flow.
 */
function diagnosePointsCardDeletedCardRetention(cardId) {
  ensureMultiCardStorage_();
  const normalizedCardId = validMultiCardId_(cardId, true);
  const cardMatch = findMultiCard_(normalizedCardId);
  const retainedRows = {
    progress: deletedCardDiagnosticCount_(MULTI_CARD_SHEETS.progress, normalizedCardId),
    vouchers: deletedCardDiagnosticCount_(MULTI_CARD_SHEETS.vouchers, normalizedCardId),
    stampRecords: deletedCardDiagnosticCount_(MULTI_CARD_SHEETS.stampRecords, normalizedCardId),
    rewardRecords: deletedCardDiagnosticCount_(MULTI_CARD_SHEETS.rewardRecords, normalizedCardId),
    notifications: deletedCardDiagnosticCount_(MULTI_CARD_SHEETS.notifications, normalizedCardId)
  };
  const deletionAudit = deletedCardDiagnosticAudit_(normalizedCardId);
  const card = cardMatch ? cardMatch.card : null;
  const classification = deletedCardDiagnosticClassification_(card, retainedRows, deletionAudit);

  return {
    cardId: normalizedCardId,
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
      card && card.storedStatus === 'deleted' && retainedRows.progress > 0
    )
  };
}

function deletedCardDiagnosticCount_(sheetName, cardId) {
  const sheet = getMultiCardSheet_(sheetName);
  return readMultiCardObjectsByField_(sheet, 'cardId', cardId).filter(function (row) {
    return String(row.cardId || '') === cardId;
  }).length;
}

function deletedCardDiagnosticAudit_(cardId) {
  const sheet = getSheet_(POINTS_CARD_SHEETS.audit);
  const headers = POINTS_CARD_HEADERS.AuditLogs;
  const actionColumn = headers.indexOf('action');
  const resultColumn = headers.indexOf('result');
  const detailsColumn = headers.indexOf('details');
  const timestampColumn = headers.indexOf('timestamp');
  if (actionColumn < 0 || resultColumn < 0 || detailsColumn < 0 || timestampColumn < 0) {
    fail_('SCHEMA_MISMATCH', 'AuditLogs 缺少刪卡診斷所需欄位。');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return deletedCardDiagnosticAuditSummary_([]);

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

  return deletedCardDiagnosticAuditSummary_(events);
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

function deletedCardDiagnosticAuditSummary_(events) {
  const destructiveEvidence = events.some(function (event) { return event.mode === 'destructive-delete'; });
  const archiveEvidence = events.some(function (event) { return event.mode === 'archive-preserve'; });
  return {
    events: events,
    destructiveEvidence: destructiveEvidence,
    archiveEvidence: archiveEvidence
  };
}

function deletedCardDiagnosticClassification_(card, retainedRows, deletionAudit) {
  if (card && card.storedStatus !== 'deleted') return 'card-not-deleted';
  if (card && card.storedStatus === 'deleted') {
    if (retainedRows.progress > 0 || retainedRows.rewardRecords > 0 || retainedRows.stampRecords > 0) {
      return 'archived-retention-present';
    }
    return deletionAudit.archiveEvidence ? 'archived-retention-empty' : 'deleted-card-no-retained-member-rows';
  }
  if (deletionAudit.destructiveEvidence) return 'historical-destructive-delete-confirmed';
  return 'card-missing-unknown';
}
