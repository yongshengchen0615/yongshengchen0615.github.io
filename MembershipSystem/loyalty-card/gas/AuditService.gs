'use strict';

function logAuditEvent_(event) {
  try {
    const sheet = getLoyaltySheet_(LOYALTY_SHEETS_.audit);
    appendObject_(sheet, {
      audit_id: 'audit_' + compactUuid_(),
      actor_id: safeCellText_(cleanText_(event && event.actorId, 80)),
      action: safeCellText_(cleanText_(event && event.action, 80)),
      target_id: safeCellText_(cleanText_(event && event.targetId, 80)),
      amount: normalizeAuditNumber_(event && event.amount),
      balance_before: normalizeAuditNumber_(event && event.balanceBefore),
      balance_after: normalizeAuditNumber_(event && event.balanceAfter),
      result: safeCellText_(cleanText_(event && event.result, 40)),
      reason: safeCellText_(cleanText_(event && event.reason, 120)),
      request_id: safeCellText_(cleanRequestId_(event && event.requestId)),
      created_at: isoNow_()
    });
  } catch (error) {
    console.error(
      'audit write failed action=%s result=%s',
      cleanText_(event && event.action, 80),
      cleanText_(event && event.result, 40)
    );
  }
}

function normalizeAuditNumber_(value) {
  if (value === '' || value === null || value === undefined) return '';
  const number = Number(value);
  return Number.isFinite(number) ? number : '';
}
