'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function publicError(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  throw error;
}

function confirmationContext() {
  const writes = [];
  const context = {
    Array, Date, JSON, Math, Number, Object, String, console,
    cleanText_: (value) => String(value == null ? '' : value).trim(),
    fail_: publicError,
    readObjectsByField_: () => [],
    writeObjectRow_: (sheet, row, value) => writes.push({ sheet, row, value: { ...value } })
  };
  vm.createContext(context);
  vm.runInContext(
    read('gas/RewardConfirmationService.gs') + '\n;globalThis.__confirmation = {' +
      'normalizeRewardConfirmation_, validateRewardConfirmationForClaim_,' +
      'assertRewardEntitlementReservationAvailable_,' +
      'reserveRewardConfirmationForClaim_, consumeRewardConfirmationForClaim_ };',
    context
  );
  return { api: context.__confirmation, writes };
}

test('confirmation QR is reserved to one member, card, reward, and request then consumed once', () => {
  const { api, writes } = confirmationContext();
  const confirmation = api.normalizeRewardConfirmation_({
    confirmationId: 'RC-ONE', shareCode: 'a'.repeat(64), status: 'active',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  const binding = {
    memberLineUserId: 'U-MEMBER', cardId: 'CARD-ONE', rewardOrdinal: 2,
    requestId: 'b'.repeat(32)
  };

  api.reserveRewardConfirmationForClaim_('RewardConfirmations', 2, confirmation, binding);
  assert.equal(confirmation.status, 'reserved');
  assert.equal(confirmation.reservedByLineUserId, binding.memberLineUserId);
  assert.equal(confirmation.reservedCardId, binding.cardId);
  assert.equal(confirmation.reservedRewardOrdinal, binding.rewardOrdinal);
  assert.equal(confirmation.reservedRequestId, binding.requestId);
  assert.equal(writes.length, 1);

  api.reserveRewardConfirmationForClaim_('RewardConfirmations', 2, confirmation, binding);
  assert.equal(writes.length, 1, 'same transaction may retry without creating another reservation');

  assert.throws(
    () => api.validateRewardConfirmationForClaim_(confirmation, { ...binding, memberLineUserId: 'U-ATTACKER' }),
    (error) => error && error.publicCode === 'REWARD_CONFIRMATION_RESERVED'
  );

  api.consumeRewardConfirmationForClaim_('RewardConfirmations', 2, confirmation, binding);
  assert.equal(confirmation.status, 'consumed');
  assert.ok(confirmation.consumedAt);
  assert.equal(writes.length, 2);

  api.consumeRewardConfirmationForClaim_('RewardConfirmations', 2, confirmation, binding);
  assert.equal(writes.length, 2, 'same recorded request may recover idempotently');
  assert.throws(
    () => api.consumeRewardConfirmationForClaim_('RewardConfirmations', 2, confirmation, { ...binding, requestId: 'c'.repeat(32) }),
    (error) => error && error.publicCode === 'REWARD_CONFIRMATION_USED'
  );
});

test('one unclaimed entitlement cannot reserve multiple merchant confirmations', () => {
  const { api } = confirmationContext();
  const binding = {
    memberLineUserId: 'U-MEMBER', cardId: 'CARD-ONE', rewardOrdinal: 2,
    requestId: 'b'.repeat(32)
  };
  const confirmation = api.normalizeRewardConfirmation_({
    confirmationId: 'RC-NEW', status: 'active',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  const existing = {
    confirmationId: 'RC-OTHER', status: 'reserved',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    reservedByLineUserId: binding.memberLineUserId,
    reservedCardId: binding.cardId,
    reservedRewardOrdinal: binding.rewardOrdinal,
    reservedRequestId: 'c'.repeat(32)
  };
  const context = {
    Array, Date, JSON, Math, Number, Object, String, console,
    cleanText_: (value) => String(value == null ? '' : value).trim(),
    fail_: publicError,
    readObjectsByField_: () => [existing],
    writeObjectRow_: () => {}
  };
  vm.createContext(context);
  vm.runInContext(
    read('gas/RewardConfirmationService.gs') +
      '\n;globalThis.__assertAvailable = assertRewardEntitlementReservationAvailable_;',
    context
  );
  assert.throws(
    () => context.__assertAvailable('RewardConfirmations', confirmation, binding),
    (error) => error && error.publicCode === 'REWARD_CONFIRMATION_OUTSTANDING'
  );
});

test('a recorded request can finish consuming its exact expired reservation', () => {
  const { api, writes } = confirmationContext();
  const binding = {
    memberLineUserId: 'U-MEMBER', cardId: 'CARD-ONE', rewardOrdinal: 2,
    requestId: 'b'.repeat(32)
  };
  const confirmation = api.normalizeRewardConfirmation_({
    confirmationId: 'RC-RECOVERY', shareCode: 'a'.repeat(64), status: 'reserved',
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    reservedByLineUserId: binding.memberLineUserId,
    reservedCardId: binding.cardId,
    reservedRewardOrdinal: binding.rewardOrdinal,
    reservedRequestId: binding.requestId
  });

  assert.throws(
    () => api.consumeRewardConfirmationForClaim_('RewardConfirmations', 2, confirmation, binding),
    (error) => error && error.publicCode === 'REWARD_CONFIRMATION_EXPIRED'
  );
  const wrongBinding = { ...binding, requestId: 'c'.repeat(32) };
  assert.throws(
    () => api.consumeRewardConfirmationForClaim_('RewardConfirmations', 2, confirmation, wrongBinding, true),
    (error) => error && error.publicCode === 'REWARD_CONFIRMATION_RESERVED'
  );
  api.consumeRewardConfirmationForClaim_('RewardConfirmations', 2, confirmation, binding, true);
  assert.equal(confirmation.status, 'consumed');
  assert.equal(writes.length, 1);

  assert.throws(
    () => api.consumeRewardConfirmationForClaim_('RewardConfirmations', 2, confirmation, wrongBinding, true),
    (error) => error && error.publicCode === 'REWARD_CONFIRMATION_USED'
  );
});

test('client and schema carry the transaction binding while admin defaults to ten minutes', () => {
  const code = read('gas/Code.gs');
  const service = read('gas/MultiCardRewardService.gs');
  const user = read('user/app.js');
  const admin = read('admin/app.js');

  for (const field of [
    'reservedByLineUserId', 'reservedCardId', 'reservedRewardOrdinal',
    'reservedRequestId', 'reservedAt', 'consumedAt'
  ]) assert.match(code, new RegExp("'" + field + "'"));

  assert.match(service, /requestId:\s*requestId/);
  assert.match(service, /reserveRewardConfirmationForClaim_/);
  assert.match(service, /consumeRewardConfirmationForClaim_/);
  assert.match(user, /reward\.prepare'[\s\S]{0,360}requestId:\s*requestId/);
  assert.match(admin, /Date\.now\(\) \+ 10 \* 60 \* 1000/);
  assert.doesNotMatch(admin, /7 \* 24 \* 60 \* 60 \* 1000/);
});

test('confirmation record checks use exact field lookup without a full-table read', () => {
  const source = read('gas/RewardConfirmationService.gs');
  const calls = [];
  const rows = [
    { confirmationId: 'RC-TARGET', status: 'recorded' },
    { confirmationId: 'RC-TARGET', status: 'cancelled' }
  ];
  const context = {
    Array, Date, JSON, Math, Number, Object, String, console,
    POINTS_CARD_SHEETS: { rewardRecords: 'CardRewardRecords' },
    getSheet_: (name) => ({ name }),
    readObjectsByField_: (sheet, field, value) => {
      calls.push({ sheet: sheet.name, field, value });
      return rows;
    },
    readObjects_: () => { throw new Error('must not scan the complete reward record table'); },
    cleanText_: (value) => String(value == null ? '' : value).trim(),
    fail_: publicError
  };
  vm.createContext(context);
  vm.runInContext(
    source + '\n;globalThis.__recordLookup = {' +
      'countRewardConfirmationRecords_, hasRewardConfirmationRecords_ };',
    context
  );

  assert.equal(context.__recordLookup.countRewardConfirmationRecords_('RC-TARGET'), 1);
  assert.equal(context.__recordLookup.hasRewardConfirmationRecords_('RC-TARGET'), true);
  assert.deepEqual(calls, [
    { sheet: 'CardRewardRecords', field: 'confirmationId', value: 'RC-TARGET' },
    { sheet: 'CardRewardRecords', field: 'confirmationId', value: 'RC-TARGET' }
  ]);
});
