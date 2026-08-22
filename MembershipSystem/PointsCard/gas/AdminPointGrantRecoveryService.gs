'use strict';

function recoverProcessingAdminPointGrantsForMember_(lineUserId) {
  ensureAdminPointGrantStorage_();
  readAdminPointGrantObjects_(POINTS_CARD_ADMIN_GRANTS.grantsSheet).forEach(function (row) {
    if (String(row.memberLineUserId || '') !== String(lineUserId || '') || String(row.status || '') !== 'processing') return;
    const match = findAdminPointGrantByFieldWithRow_(POINTS_CARD_ADMIN_GRANTS.grantsSheet, 'grantId', row.grantId);
    if (match) recoverAdminPointGrant_(match);
  });
}

function stampRecordWithAdminPointGrantRecovery_(context, payload) {
  ensureMultiCardStorage_();
  ensureAdminPointGrantStorage_();
  const memberMatch = findByFieldWithRow_(getSheet_(POINTS_CARD_SHEETS.members), 'lineUserId', context.identity.sub);
  if (memberMatch) recoverProcessingAdminPointGrantsForMember_(context.identity.sub);
  return stampRecordMultiCard_(context, payload);
}

function adminPointGrantWithRecovery_(context, payload) {
  ensureMultiCardStorage_();
  ensureAdminPointGrantStorage_();
  const targetMemberNo = cleanText_(payload && payload.targetMemberNo, 30, true);
  const memberMatch = findByFieldWithRow_(getSheet_(POINTS_CARD_SHEETS.members), 'memberNo', targetMemberNo);
  if (memberMatch) {
    const member = normalizeMember_(memberMatch.object);
    recoverProcessingAdminPointGrantsForMember_(member.lineUserId);
  }
  return adminPointGrantMultiCard_(context, payload);
}
