'use strict';

function sameMultiCardRewardNodes_(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function adminCardSaveMultiCard_(context, payload) {
  ensureMultiCardStorage_();
  const cardId = validMultiCardId_(payload.cardId, true);
  const expectedUpdatedAt = cleanText_(payload.expectedUpdatedAt, 64, true);
  const name = cleanText_(payload.name, MULTI_CARD.maxNameLength, true);
  const description = cleanText_(payload.description || '', MULTI_CARD.maxDescriptionLength, false);
  const expiresAt = validMultiCardExpiry_(payload.expiresAt || '');
  const rewardNodes = normalizeRewardNodes_(
    payload.rewardNodes,
    'INVALID_REWARD_NODES',
    '請設定有效的獎勵節點；節點點數最多 10,000 點。'
  );

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) fail_('BUSY', '系統忙碌中，請稍後再試。');
  try {
    const match = findMultiCard_(cardId);
    if (!match) fail_('CARD_NOT_FOUND', '找不到指定集點卡。');
    if (match.card.storedStatus === 'deleted') fail_('CARD_NOT_FOUND', '找不到指定集點卡。');
    if (match.card.updatedAt !== expectedUpdatedAt) {
      fail_('CONFLICT', '集點卡已被更新，請重新整理後再試。');
    }
    assertMultiCardNameAvailable_(name, cardId);

    const rewardNodesChanged = !sameMultiCardRewardNodes_(match.card.rewardNodes, rewardNodes);
    if (rewardNodesChanged && rewardSettingsLockedForCard_(cardId)) {
      fail_('REWARD_SETTINGS_LOCKED', '這張集點卡已有票券使用紀錄，不能再修改獎勵節點。');
    }

    const now = new Date().toISOString();
    const next = Object.assign({}, match.card, {
      name: name,
      description: description,
      expiresAt: expiresAt,
      rewardNodes: rewardNodesChanged ? rewardNodes : match.card.rewardNodes,
      rewardNodesUpdatedAt: rewardNodesChanged ? now : match.card.rewardNodesUpdatedAt,
      updatedAt: now
    });

    if (!audit_(context.identity.sub, 'admin', 'CARD_SAVE_REQUESTED', '', 'pending', {
      cardId: cardId,
      rewardNodeCount: rewardNodes.length,
      rewardNodesChanged: rewardNodesChanged,
      expiryMode: expiresAt ? 'limited' : 'unlimited'
    })) {
      fail_('AUDIT_UNAVAILABLE', '稽核紀錄暫時無法寫入，集點卡未儲存。');
    }

    writeMultiCardObjectRow_(
      getMultiCardSheet_(MULTI_CARD_SHEETS.cards),
      match.row,
      multiCardStorageObject_(next)
    );

    audit_(context.identity.sub, 'admin', 'CARD_SAVED', '', 'success', {
      cardId: cardId,
      rewardNodeCount: rewardNodes.length,
      rewardNodesChanged: rewardNodesChanged
    });

    const saved = normalizeMultiCard_(multiCardStorageObject_(next));
    return {
      card: publicMultiCard_(saved),
      settings: multiCardSettings_(saved),
      rewardNodesChanged: rewardNodesChanged
    };
  } finally {
    lock.releaseLock();
  }
}
