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

function extractCase(source, action) {
  const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp("case '" + escaped + "':[\\s\\S]*?(?=case '|default:)", 'm'));
  assert.ok(match, 'missing router case: ' + action);
  return match[0];
}

test('manual point grant is an authenticated admin-only server mutation', () => {
  const code = read('gas/Code.gs');
  const route = extractCase(code, 'admin.points.grant');
  assert.match(code, /'admin\.points\.grant'/);
  assert.match(route, /requireAdmin_\(context\)/);
  assert.match(route, /rateLimit_\('admin-points-grant:' \+ identity\.sub, 20, 60\)/);
  assert.match(route, /adminPointGrantMultiCard_\(context, payload\)/);
});

test('grant service validates member, card, amount, reason and idempotency identity', () => {
  const source = read('gas/AdminPointGrantService.gs');
  const storage = read('gas/AdminPointGrantStorage.gs');
  assert.match(source, /strictInt_\([\s\S]*payload\.stampCount,[\s\S]*POINTS_CARD_ADMIN_GRANTS\.maxGrantPoints/);
  assert.match(storage, /maxGrantPoints: 100/);
  assert.match(source, /cleanText_\(payload\.reason, 200, true\)/);
  assert.match(source, /\^\[a-f0-9\]\{32,64\}\$/);
  assert.match(source, /member\.membershipStatus !== 'active'/);
  assert.match(source, /!cardMatch\.card\.available/);
  assert.match(source, /existingGrant\.memberLineUserId !== member\.lineUserId/);
  assert.match(source, /existingGrant\.cardId !== cardId/);
  assert.match(source, /existingGrant\.stampCount !== stampCount/);
  assert.match(source, /existingGrant\.reason !== reason/);
  assert.match(source, /fail_\('REQUEST_CONFLICT'/);
});

test('grant storage stays schema-exact and spreadsheet-formula safe', () => {
  const storage = read('gas/AdminPointGrantStorage.gs');
  assert.match(storage, /CardPointGrants:/);
  assert.match(storage, /MemberPointNotifications:/);
  assert.match(storage, /lastColumn !== expected\.length/);
  assert.match(storage, /headers\[index\] !== header/);
  assert.match(storage, /typeof value === 'string' \? safeCellText_\(value\) : value/);
});

test('grant transaction records intent before progress mutation and success audit after mutation', () => {
  const source = read('gas/AdminPointGrantService.gs');
  const requested = source.indexOf("'CARD_POINTS_GRANT_REQUESTED'");
  const append = source.indexOf('appendAdminPointGrantObject_(POINTS_CARD_ADMIN_GRANTS.grantsSheet, grant)');
  const progressWrite = source.indexOf('progress.totalStamps = totalAfter');
  const success = source.indexOf("'CARD_POINTS_GRANTED'", progressWrite);
  const notification = source.indexOf('ensurePointGrantNotification_(grant, cardMatch.card, unlockedRewards)', progressWrite);
  assert.ok(requested >= 0 && requested < append, 'pending audit must precede transaction record');
  assert.ok(append < progressWrite, 'processing record must exist before changing points');
  assert.ok(progressWrite < notification, 'reward notification persistence happens after point state is updated');
  assert.ok(notification < success, 'success audit follows point/reward-notification mutation');
  assert.match(source, /status: 'processing'/);
  assert.match(source, /grant\.status = 'recorded'/);
  assert.match(source, /recoverAdminPointGrant_\(existing\)/);
  assert.match(source, /if \(grant\.status === 'recorded'\) return grant/);
});

test('new ticket entitlement and grant snapshot are carried directly into the first LINE push', () => {
  const source = read('gas/AdminPointGrantService.gs');
  const notifications = read('gas/MemberPointNotificationService.gs');
  const push = read('gas/AdminPointGrantPushService.gs');
  const rewardCalculation = source.indexOf('rewardEntitlementsBetweenTotals_(totalBefore, totalAfter, settings)');
  const progressWrite = source.indexOf('progress.totalStamps = totalAfter');
  const notification = source.indexOf('rewardNotificationForPush = ensurePointGrantNotification_(grant, cardMatch.card, unlockedRewards)');
  const snapshot = source.indexOf('grantForPush = grant', notification);
  const pushAttempt = source.indexOf('attemptAdminPointGrantPush_(result.grantId, grantForPush, rewardNotificationForPush)');

  assert.ok(rewardCalculation >= 0 && rewardCalculation < progressWrite,
    'new rewards must be determined from the transaction before mutating progress');
  assert.ok(progressWrite < notification && notification < snapshot && snapshot < pushAttempt,
    'the exact grant and unlocked rewards must be forwarded to first push');
  assert.match(notifications, /Array\.isArray\(precomputedRewards\) \? precomputedRewards : pointGrantUnlockedRewards_/);
  assert.match(push, /pointGrantPushGrantSnapshot_\(persistedGrant, grantOverride\)/);
  assert.match(push, /pointGrantRewardPushMessage_\(messageGrant, rewardNotification\)/);
  assert.match(push, /pointGrantPushMessage_\(messageGrant, rewardMessage\)/);
});

test('15-point full card plus 5 admin points unlocks the next-cycle 5-point coupon', () => {
  const context = { Object, String, Number, Date, JSON, Math, Set, Map, console };
  vm.createContext(context);
  vm.runInContext(
    read('gas/Code.gs') +
      '\n;globalThis.__rewardTest = { rewardEntitlementsBetweenTotals_ };',
    context
  );
  const settings = {
    cardSize: 15,
    rewardNodes: [
      { nodeId: 'R5', stampsRequired: 5, rewardName: '5點優惠券', rewardType: 'coupon', lotteryPrizes: [], ticketValidityDays: 0, unusedReminderDays: 0 },
      { nodeId: 'R10', stampsRequired: 10, rewardName: '10點優惠券', rewardType: 'coupon', lotteryPrizes: [], ticketValidityDays: 0, unusedReminderDays: 0 },
      { nodeId: 'R15', stampsRequired: 15, rewardName: '15點優惠券', rewardType: 'coupon', lotteryPrizes: [], ticketValidityDays: 0, unusedReminderDays: 0 }
    ]
  };

  const unlocked = context.__rewardTest.rewardEntitlementsBetweenTotals_(15, 20, settings);
  assert.equal(unlocked.length, 1);
  assert.equal(unlocked[0].nodeId, 'R5');
  assert.equal(unlocked[0].rewardName, '5點優惠券');
  assert.equal(unlocked[0].rewardType, 'coupon');
  assert.equal(unlocked[0].cycleNumber, 2);
  assert.equal(unlocked[0].absoluteStamps, 20);
});

test('plain point grants create no reward detail while newly unlocked tickets are persisted for LINE push', () => {
  const notifications = read('gas/MemberPointNotificationService.gs');
  assert.match(notifications, /rewardEntitlementsBetweenTotals_\(grant\.totalBefore, grant\.totalAfter, settings\)/);
  assert.match(notifications, /if \(!unlockedRewards\.length\) return null/);
  assert.match(notifications, /type: 'point-grant-reward'/);
  assert.match(notifications, /pointGrantRewardSummary_\(rewards\)/);
  assert.match(notifications, /return '新獲得：'/);
});

test('member notification APIs remain identity-scoped and prevent IDOR even though the browser no longer consumes them', () => {
  const code = read('gas/Code.gs');
  const grant = read('gas/AdminPointGrantService.gs');
  const notifications = read('gas/MemberPointNotificationService.gs');
  assert.match(extractCase(code, 'member.point-notifications.list'), /memberPointNotificationsList_\(context, payload\)/);
  assert.match(extractCase(code, 'member.point-notification.read'), /memberPointNotificationRead_\(context, payload\)/);
  assert.doesNotMatch(grant, /function memberPointNotificationsList_/);
  assert.doesNotMatch(grant, /function memberPointNotificationRead_/);
  assert.match(notifications, /notification\.memberLineUserId === context\.identity\.sub/);
  assert.match(notifications, /notification\.status === 'unread'/);
  assert.match(notifications, /notification\.memberLineUserId !== context\.identity\.sub/);
  assert.match(notifications, /fail_\('FORBIDDEN'/);
  assert.match(notifications, /notification\.status = 'read'/);
});

test('official-account push is isolated behind messaging infrastructure', () => {
  const grant = read('gas/AdminPointGrantService.gs');
  const notifications = read('gas/MemberPointNotificationService.gs');
  const push = read('gas/AdminPointGrantPushService.gs');
  const messaging = read('gas/LineMessagingService.gs');

  assert.match(push, /createLineMessagingClient_\(\)/);
  assert.match(push, /sendTextPush/);
  assert.doesNotMatch(grant, /LINE_MESSAGING_CHANNEL_ACCESS_TOKEN|UrlFetchApp\.fetch|Authorization:\s*'Bearer/);
  assert.doesNotMatch(notifications, /LINE_MESSAGING_CHANNEL_ACCESS_TOKEN|UrlFetchApp\.fetch|Authorization:\s*'Bearer/);
  assert.doesNotMatch(push, /LINE_MESSAGING_CHANNEL_ACCESS_TOKEN|UrlFetchApp\.fetch|Authorization:\s*'Bearer/);
  assert.match(messaging, /channelAccessTokenProperty: 'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN'/);
  assert.match(messaging, /https:\/\/api\.line\.me\/v2\/bot\/message\/push/);
  assert.match(messaging, /Authorization: 'Bearer ' \+ channelAccessToken/);
  assert.match(messaging, /'X-Line-Retry-Key': retryKey/);
  assert.doesNotMatch(push, /pushErrorCode\s*=\s*channelAccessToken/);
  assert.doesNotMatch(push, /audit_\([^\n]*channelAccessToken/);
});

test('push failure is a side effect and does not roll back the completed point transaction', () => {
  const source = read('gas/AdminPointGrantService.gs');
  const push = read('gas/AdminPointGrantPushService.gs');
  const transactionEnd = source.indexOf('} finally {\n    lock.releaseLock();\n  }\n\n  const push = attemptAdminPointGrantPush_');
  assert.ok(transactionEnd >= 0, 'push must occur only after transaction lock is released');
  assert.match(source.slice(transactionEnd), /attemptAdminPointGrantPush_\(result\.grantId, grantForPush, rewardNotificationForPush\)/);
  assert.match(source.slice(transactionEnd), /result\.pushStatus = push\.status/);
  assert.doesNotMatch(push, /totalStamps\s*=/);
  assert.match(push, /pointGrantPushStatus_\(push\)/);
});

test('direct grant/reward details are bound to the persisted grant owner and transaction before push', () => {
  const push = read('gas/AdminPointGrantPushService.gs');
  assert.match(push, /direct\.grantId !== persistedGrant\.grantId/);
  assert.match(push, /direct\.memberLineUserId !== persistedGrant\.memberLineUserId/);
  assert.match(push, /direct\.memberNo !== persistedGrant\.memberNo/);
  assert.match(push, /direct\.cardId !== persistedGrant\.cardId/);
  assert.match(push, /direct\.stampCount !== persistedGrant\.stampCount/);
  assert.match(push, /direct\.totalBefore !== persistedGrant\.totalBefore/);
  assert.match(push, /direct\.totalAfter !== persistedGrant\.totalAfter/);
  assert.match(push, /notification\.type !== 'point-grant-reward'/);
  assert.match(push, /notification\.memberLineUserId !== grant\.memberLineUserId/);
  assert.match(push, /notification\.relatedId !== grant\.grantId/);
  assert.match(push, /notification\.cardId !== grant\.cardId/);
  assert.doesNotMatch(push, /pointGrantUnlockedRewards_\(/);
});

test('opening PointsCard never consumes or displays point-grant notifications', () => {
  const adminHtml = read('admin/index.html');
  const userHtml = read('user/index.html');
  const admin = read('admin/point-grant.js');
  const user = read('user/point-notifications.js');
  assert.match(adminHtml, /<script src="\.\/point-grant\.js"><\/script>/);
  assert.match(userHtml, /<script defer src="\.\/point-notifications\.js"><\/script>/);
  assert.match(admin, /PointsCard\.callApi\('admin\.points\.grant'/);
  assert.match(admin, /PointsCard\.randomHex\(16\)/);
  assert.doesNotMatch(admin, /totalStamps\s*[+\-]?=/);
  assert.doesNotMatch(user, /member\.point-notifications\.list|member\.point-notification\.read/);
  assert.doesNotMatch(user, /showModal|createElement\('dialog'\)|pointGrantNoticeDialog/);
  assert.match(user, /LINE push only/);
});

test('point grant push preserves reason and optional ticket details for the 15-to-20 boundary', () => {
  const context = {
    Object,
    String,
    Number,
    Date,
    JSON,
    Math,
    console,
    storedNonNegativeInt_: (value) => Number(value || 0),
    sha256Hex_: () => '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  };
  vm.createContext(context);
  vm.runInContext(
    read('gas/LineMessagingService.gs') + '\n' +
      read('gas/AdminPointGrantStorage.gs') + '\n' +
      read('gas/MemberPointNotificationService.gs') + '\n' +
      read('gas/AdminPointGrantPushService.gs') +
      '\n;globalThis.__test = { pointGrantPushMessage_, pointGrantNotificationMessage_, pointGrantNotificationTitle_, pointGrantRetryKey_, pointGrantRewardPushMessageFromNotification_, pointGrantPushGrantSnapshot_ };',
    context
  );

  const reward = [{ rewardName: '5點優惠券', rewardType: 'coupon' }];
  const rewardMessage = context.__test.pointGrantNotificationMessage_(reward);
  const persistedGrant = {
    grantId: 'PG-TEST', requestId: 'a'.repeat(32), cardId: 'CARD-1', memberLineUserId: 'U-1', memberNo: 'PC-1',
    stampCount: 5, reason: '', status: 'recorded', totalBefore: 15, totalAfter: 20,
    grantedByLineUserId: 'ADMIN-1', pushStatus: 'pending'
  };
  const directGrant = { ...persistedGrant, reason: '滿點後加碼' };
  const messageGrant = context.__test.pointGrantPushGrantSnapshot_(persistedGrant, directGrant);
  assert.ok(messageGrant);
  assert.equal(messageGrant.reason, '滿點後加碼');

  const message = context.__test.pointGrantPushMessage_(messageGrant, rewardMessage);
  assert.equal(message, '發放點數：5 點\n發放原因：滿點後加碼\n新獲得：優惠券「5點優惠券」。');
  assert.doesNotMatch(message, /目前點數|目前累計/);
  assert.doesNotMatch(message, /Bearer|LINE_MESSAGING_CHANNEL_ACCESS_TOKEN|requestId|lineUserId/);

  const notification = {
    type: 'point-grant-reward',
    memberLineUserId: 'U-1',
    relatedId: 'PG-TEST',
    cardId: 'CARD-1',
    message: rewardMessage
  };
  assert.equal(context.__test.pointGrantRewardPushMessageFromNotification_(messageGrant, notification), rewardMessage);
  assert.equal(context.__test.pointGrantRewardPushMessageFromNotification_(messageGrant, { ...notification, memberLineUserId: 'U-2' }), '');
  assert.equal(context.__test.pointGrantPushGrantSnapshot_(persistedGrant, { ...directGrant, cardId: 'CARD-2' }), null);
  assert.match(context.__test.pointGrantRetryKey_('PG-TEST'), /^[a-f0-9-]{36}$/);
});