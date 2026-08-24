'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function loadMemberHelpers() {
  const source = fs.readFileSync(path.resolve(__dirname, '../gas/Code.gs'), 'utf8');
  const context = {
    console,
    Date,
    Number,
    String,
    Boolean,
    Object,
    Array,
    RegExp,
    Math,
    JSON,
    getTierThresholds_() {
      return { standard: 0, silver: 600, gold: 1800, platinum: 3600 };
    },
    normalizeTier_(value) {
      const tier = String(value || '').trim().toLowerCase();
      if (tier === 'vip') return 'platinum';
      return ['silver', 'gold', 'platinum'].includes(tier) ? tier : 'standard';
    }
  };
  vm.createContext(context);
  vm.runInContext(
    source + '\nthis.__tierProgressExports = { memberTierProgress_, publicMember_ };',
    context
  );
  return context.__tierProgressExports;
}

function member(tier, consumedMinutes) {
  return {
    memberNo: 'M2026000001',
    displayName: 'Test',
    pictureUrl: '',
    tier,
    membershipStatus: 'active',
    joinedAt: '2026-08-24T00:00:00.000Z',
    expiresAt: '',
    consumedMinutes,
    updatedAt: '2026-08-24T00:00:00.000Z',
    availableMinutes: 0,
    note: ''
  };
}

test('standard member sees exact minutes remaining to silver', () => {
  const api = loadMemberHelpers();
  const progress = api.memberTierProgress_(member('standard', 599));
  assert.equal(progress.currentTier, 'standard');
  assert.equal(progress.currentMinutes, 599);
  assert.equal(progress.nextTier, 'silver');
  assert.equal(progress.nextThresholdMinutes, 600);
  assert.equal(progress.remainingMinutes, 1);
});

test('silver and gold members advance against configured thresholds', () => {
  const api = loadMemberHelpers();
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.memberTierProgress_(member('silver', 900)))),
    {
      currentTier: 'silver',
      currentMinutes: 900,
      nextTier: 'gold',
      nextThresholdMinutes: 1800,
      remainingMinutes: 900
    }
  );
  assert.equal(api.memberTierProgress_(member('gold', 3599)).remainingMinutes, 1);
});

test('platinum member is reported as the highest tier', () => {
  const api = loadMemberHelpers();
  const progress = api.memberTierProgress_(member('platinum', 5000));
  assert.equal(progress.nextTier, '');
  assert.equal(progress.nextThresholdMinutes, 0);
  assert.equal(progress.remainingMinutes, 0);
});

test('member-facing public payload contains progress but admin list payload stays compact', () => {
  const api = loadMemberHelpers();
  const memberPayload = api.publicMember_(member('standard', 120), false);
  const adminPayload = api.publicMember_(member('standard', 120), true);
  assert.equal(memberPayload.tierProgress.remainingMinutes, 480);
  assert.equal(Object.prototype.hasOwnProperty.call(adminPayload, 'tierProgress'), false);
});

test('member UI shows current tier, current minutes, next threshold, and remaining minutes', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../user/index.html'), 'utf8');
  const script = fs.readFileSync(path.resolve(__dirname, '../user/app.js'), 'utf8');
  assert.match(html, /id="tierProgressPanel"/);
  assert.match(html, /id="tierProgressText"/);
  assert.match(script, /目前\$\{tierLabel\[currentTier\]\}會員｜累計服務 \$\{formatMinutes\(currentMinutes\)\} 分鐘/);
  assert.match(script, /達到 \$\{formatMinutes\(nextThresholdMinutes\)\} 分鐘晉升\$\{tierLabel\[nextTier\]\}｜再預約服務 \$\{formatMinutes\(remainingMinutes\)\} 分鐘/);
  assert.match(script, /目前\$\{tierLabel\[currentTier\]\}會員｜已達最高會員等級/);
  assert.doesNotThrow(() => new vm.Script(script));
});
