'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('opening an active card at an exact full-card boundary shows a fresh next cycle', () => {
  const context = { Object, Array, Number, Math, String, Boolean, console };
  vm.createContext(context);
  vm.runInContext(
    read('gas/MemberCardVisibilityService.gs') +
      '\n;globalThis.__cycleTest = { memberVisibleCycleProjection_ };',
    context
  );

  const fullCard = {
    card: { cardId: 'CARD-15', available: true },
    cardSize: 15,
    totalStamps: 15,
    visualStamps: 15,
    displayCycleNumber: 1,
    rewardNodes: [
      { stampsRequired: 5, rewardName: '5點優惠券', state: 'available' },
      { stampsRequired: 10, rewardName: '10點優惠券', state: 'available' },
      { stampsRequired: 15, rewardName: '15點優惠券', state: 'available' }
    ]
  };

  const nextCycle = context.__cycleTest.memberVisibleCycleProjection_(fullCard);
  assert.equal(nextCycle.totalStamps, 15, 'cumulative points remain authoritative and are never reset');
  assert.equal(nextCycle.visualStamps, 0);
  assert.equal(nextCycle.displayCycleNumber, 2);
  assert.deepEqual(Array.from(nextCycle.rewardNodes, (node) => node.state), ['pending', 'pending', 'pending']);
});

test('cycle rollover projection does not alter partial or unavailable cards', () => {
  const context = { Object, Array, Number, Math, String, Boolean, console };
  vm.createContext(context);
  vm.runInContext(
    read('gas/MemberCardVisibilityService.gs') +
      '\n;globalThis.__cycleTest = { memberVisibleCycleProjection_ };',
    context
  );

  const partial = {
    card: { cardId: 'CARD-15', available: true },
    cardSize: 15,
    totalStamps: 20,
    visualStamps: 5,
    displayCycleNumber: 2,
    rewardNodes: [{ stampsRequired: 5, state: 'available' }]
  };
  const partialResult = context.__cycleTest.memberVisibleCycleProjection_(partial);
  assert.equal(partialResult.visualStamps, 5);
  assert.equal(partialResult.displayCycleNumber, 2);
  assert.equal(partialResult.rewardNodes[0].state, 'available');

  const unavailable = {
    card: { cardId: 'CARD-15', available: false },
    cardSize: 15,
    totalStamps: 15,
    visualStamps: 15,
    displayCycleNumber: 1,
    rewardNodes: [{ stampsRequired: 15, state: 'available' }]
  };
  assert.equal(context.__cycleTest.memberVisibleCycleProjection_(unavailable), unavailable);
});

test('point grant LINE delivery always asks the member to open the card and keeps new-ticket details', () => {
  const context = { Object, String, Number, Date, JSON, Math, console };
  vm.createContext(context);
  vm.runInContext(
    read('gas/AdminPointGrantPushService.gs') +
      '\n;globalThis.__pushTest = { pointGrantPushMessage_, pointGrantPushDeliveryMessage_ };',
    context
  );

  const grant = { stampCount: 5, reason: '滿點後加碼' };
  const baseMessage = context.__pushTest.pointGrantPushMessage_(
    grant,
    '新獲得：優惠券「5點優惠券」。'
  );
  const message = context.__pushTest.pointGrantPushDeliveryMessage_(baseMessage);

  assert.equal(
    message,
    '發放點數：5 點\n發放原因：滿點後加碼\n新獲得：優惠券「5點優惠券」。\n請開啟集點卡確認集點進度。'
  );
  assert.doesNotMatch(message, /目前點數|目前累計|Bearer|requestId|lineUserId/);
});

test('point grant LINE delivery includes the progress CTA even when no ticket is unlocked', () => {
  const context = { Object, String, Number, Date, JSON, Math, console };
  vm.createContext(context);
  vm.runInContext(
    read('gas/AdminPointGrantPushService.gs') +
      '\n;globalThis.__pushTest = { pointGrantPushMessage_, pointGrantPushDeliveryMessage_ };',
    context
  );

  const baseMessage = context.__pushTest.pointGrantPushMessage_(
    { stampCount: 2, reason: '活動贈點' },
    ''
  );
  const message = context.__pushTest.pointGrantPushDeliveryMessage_(baseMessage);
  assert.equal(message, '發放點數：2 點\n發放原因：活動贈點\n請開啟集點卡確認集點進度。');
});
