'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }

function htmlIds(source) {
  return new Set(Array.from(source.matchAll(/\sid="([^"]+)"/g), (match) => match[1]));
}

function jsElementIds(source) {
  return Array.from(source.matchAll(/\$\('([^']+)'\)/g), (match) => match[1]);
}

test('multi-card storage uses independent card, progress, QR, stamp, and reward tables', () => {
  const storage = read('gas/MultiCardStorage.gs');
  assert.match(storage, /cards:\s*'Cards'/);
  assert.match(storage, /progress:\s*'MemberCardProgress'/);
  assert.match(storage, /vouchers:\s*'CardStampVouchers'/);
  assert.match(storage, /stampRecords:\s*'CardStampRecords'/);
  assert.match(storage, /rewardRecords:\s*'CardRewardRecords'/);
  assert.match(storage, /'cardId', 'name', 'description'/);
  assert.match(storage, /maxCardStamps:\s*10000/);
  assert.match(storage, /maxNameLength:\s*80/);
  assert.match(storage, /maxDescriptionLength:\s*500/);
  assert.match(storage, /multiCardProgressId_\(cardId, lineUserId\)/);
});

test('multi-card APIs require server-side admin authorization and route all mutations', () => {
  const code = read('gas/Code.gs');
  for (const action of [
    'admin.cards.list', 'admin.card.create', 'admin.card.update', 'admin.card.delete',
    'admin.reward-nodes.update', 'admin.stamp.create', 'admin.stamp.delete'
  ]) {
    assert.match(code, new RegExp("case '" + action.replace(/[.]/g, '\\.') + "':\\s*requireAdmin_\\(context\\)"));
  }
  assert.match(code, /version:\s*'2\.0\.0'/);
  assert.match(code, /memberMeMultiCard_\(context, payload\)/);
  assert.match(code, /stampRecordMultiCard_\(context, payload\)/);
  assert.match(code, /memberRewardClaimMultiCard_\(context, payload\)/);
});

test('deleting a card permanently removes only rows belonging to that card', () => {
  const storage = read('gas/MultiCardStorage.gs');
  const deletion = storage.slice(storage.indexOf('function adminCardDeleteMultiCard_'));
  assert.match(deletion, /deleteMultiCardRowsWhere_\(getMultiCardSheet_\(MULTI_CARD_SHEETS\.stampRecords\)/);
  assert.match(deletion, /deleteMultiCardRowsWhere_\(getMultiCardSheet_\(MULTI_CARD_SHEETS\.rewardRecords\)/);
  assert.match(deletion, /deleteMultiCardRowsWhere_\(getMultiCardSheet_\(MULTI_CARD_SHEETS\.vouchers\)/);
  assert.match(deletion, /deleteMultiCardRowsWhere_\(getMultiCardSheet_\(MULTI_CARD_SHEETS\.progress\)/);
  assert.match(deletion, /deleteMultiCardObjectRow_\(getMultiCardSheet_\(MULTI_CARD_SHEETS\.cards\), match\.row\)/);
  assert.match(deletion, /row\.cardId === cardId/g);
  assert.doesNotMatch(deletion, /status\s*=\s*'deleted'/);
  assert.doesNotMatch(deletion, /reactivat|重新啟用/);
});

test('card point and redemption state is no longer stored on Members during normal multi-card mutations', () => {
  const stamps = read('gas/MultiCardStampService.gs');
  const rewards = read('gas/MultiCardRewardService.gs');
  assert.match(stamps, /ensureMemberCardProgress_/);
  assert.match(stamps, /progress\.totalStamps = totalAfter/);
  assert.match(stamps, /cardId:\s*cardMatch\.card\.cardId/);
  assert.doesNotMatch(stamps, /member\.totalStamps\s*=\s*totalAfter/);
  assert.match(rewards, /progress\.redeemedRewards = redeemedAfter/);
  assert.match(rewards, /cardId:\s*card\.cardId/);
  assert.doesNotMatch(rewards, /member\.redeemedRewards\s*=\s*redeemedAfter/);
});

test('reward node thresholds are no longer limited to 20 points', () => {
  const code = read('gas/Code.gs');
  const adminLifecycle = read('admin/card-lifecycle.js');
  const storage = read('gas/Storage.gs');
  assert.match(code, /MAX_CARD_STAMPS = 10000/);
  assert.match(code, /stampsRequired > MAX_CARD_STAMPS/);
  assert.match(adminLifecycle, /MAX_CARD_STAMPS = 10000/);
  assert.match(adminLifecycle, /1 到 10,000/);
  assert.match(storage, /2 到 10,000 點/);
  assert.doesNotMatch(code, /stampsRequired > 20/);
});

test('admin UI manages card selection, name, description, expiry, create, update, and permanent delete', () => {
  const script = read('admin/card-lifecycle.js');
  assert.match(script, /cardSelect/);
  assert.match(script, /cardName/);
  assert.match(script, /cardDescription/);
  assert.match(script, /admin\.cards\.list/);
  assert.match(script, /admin\.card\.create/);
  assert.match(script, /admin\.card\.update/);
  assert.match(script, /admin\.card\.delete/);
  assert.match(script, /所有會員點數、集點紀錄、集點 QR/);
  assert.match(script, /PointsCard\.setSelectedCardId/);
  assert.doesNotThrow(() => new vm.Script(script));
});

test('member UI can switch cards and large cards use summarized progress instead of thousands of stamp nodes', () => {
  const html = read('user/index.html');
  const script = read('user/app.js');
  const ids = htmlIds(html);
  for (const id of ['cardSwitcher', 'memberCardSelect', 'cardTitle', 'cardDescription', 'noCardState']) assert.ok(ids.has(id));
  const missing = Array.from(new Set(jsElementIds(script))).filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
  assert.match(script, /MAX_GRID_STAMPS = 60/);
  assert.match(script, /renderLargeCardProgress/);
  assert.match(script, /if \(total > MAX_GRID_STAMPS\)/);
  assert.match(script, /PointsCard\.setSelectedCardId\(cardId\)/);
  assert.match(html, /目前沒有可用集點卡/);
  assert.doesNotThrow(() => new vm.Script(script));
});

test('shared transport injects only a validated selected card id into API payloads', () => {
  const common = read('shared/common.js');
  assert.match(common, /SELECTED_CARD_KEY/);
  assert.match(common, /\^CARD-\[A-Z0-9-\]\{2,58\}\$/);
  assert.match(common, /if \(selectedCardId && !requestPayload\.cardId\) requestPayload\.cardId = selectedCardId/);
  assert.match(common, /getSelectedCardId/);
  assert.match(common, /setSelectedCardId/);
  assert.doesNotThrow(() => new vm.Script(common));
});

test('reward confirmation usage and deletion checks read the new card-scoped reward records', () => {
  const rewards = read('gas/MultiCardRewardService.gs');
  const code = read('gas/Code.gs');
  assert.match(rewards, /MULTI_CARD_SHEETS\.rewardRecords/);
  assert.match(rewards, /multiCardRewardConfirmationRecordCounts_/);
  assert.match(rewards, /hasRewardConfirmationRecordsMultiCard_/);
  assert.match(code, /adminRewardConfirmationListMultiCard_/);
  assert.match(code, /adminRewardConfirmationOpenMultiCard_/);
  assert.match(code, /adminRewardConfirmationDeleteMultiCard_/);
});
