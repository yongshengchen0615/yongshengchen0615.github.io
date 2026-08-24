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

test('new ticket entitlement is computed from the same before/after totals and carried directly into the first LINE push', () => {
  const source = read('gas/AdminPointGrantService.gs');
  const notifications = read('gas/MemberPointNotificationService.gs');
  const push = read('gas/AdminPointGrantPushService.gs');
  const rewardCalculation = source.indexOf('rewardEntitlementsBetweenTotals_(totalBefore, totalAfter, settings)');
  const progressWrite = source.indexOf('progress.totalStamps = totalAfter');
  const notification = source.indexOf('rewardNotificationForPush = ensurePointGrantNotification_(grant, cardMatch.card, unlockedRewards)');
  const pushAttempt = source.indexOf('attemptAdminPointGrantPush_(result.grantId, rewardNotificationForPush)');

  assert.ok(rewardCalculation >= 0 && rewardCalculation < progressWrite,
    'new rewards must be determined from the transaction before mutating progress');
  assert.ok(progressWrite < notification && notification < pushAttempt,
    'the exact unlocked rewards must be persisted and forwarded to push');
  assert.match(notifications, /Array\.isArray\(precomputedRewards\) \? precomputedRewards : pointGrantUnlockedRewards_/);
  assert.match(push, /pointGrantRewardPushMessage_\(grant, rewardNotification\)/);
  assert.match(push, /const directMessage = pointGrantRewardPushMessageFromNotification_\(grant, notificationOverride\)/);
  assert.match(push, /if \(directMessage\) return directMessage/);
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
  assert.match(source.slice(transactionEnd), /attemptAdminPointGrantPush_\(result\.grantId, rewardNotificationForPush\)/);
  assert.match(source.slice(transactionEnd), /result\.pushStatus = push\.status/);
  assert.doesNotMatch(push, /totalStamps\s*=/);
  assert.match(push, /pointGrantPushStatus_\(push\)/);
});

test('direct and persisted reward details are both bound to the same grant owner/card before push', () => {
  const push = read('gas/AdminPointGrantPushService.gs');
  assert.match(push, /pointGrantNotificationId_\(grant\.grantId\)/);
  assert.match(push, /notification\.type !== 'point-grant-reward'/);
  assert.match(push, /notification\.memberLineUserId !== grant\.memberLineUserId/);
  assert.match(push, /notification\.relatedId !== grant\.grantId/);
  assert.match(push, /notification\.cardId !== grant\.cardId/);
  assert.match(push, /return notification\.message/);
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

test('point grant push contains only amount, reason and optional newly earned ticket details', () => {
  const context = {
    Object,
    String,
    Number,
    Date,
    JSON,
    Math,
    console,
    sha256Hex_: () => '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    normalizeMemberPointNotification_: (value) => value
  };
  vm.createContext(context);
  vm.runInContext(
    read('gas/LineMessagingService.gs') + '\n' +
      read('gas/MemberPointNotificationService.gs') + '\n' +
      read('gas/AdminPointGrantPushService.gs') +
      '\n;globalThis.__test = { pointGrantPushMessage_, pointGrantNotificationMessage_, pointGrantNotificationTitle_, pointGrantRetryKey_, pointGrantRewardPushMessageFromNotification_ };',
    context
  );

  const reward = [{ rewardName: '免費咖啡', rewardType: 'coupon' }];
  const rewardMessage = context.__test.pointGrantNotificationMessage_(reward);
  const message = context.__test.pointGrantPushMessage_(
    { stampCount: 5, reason: '活動補發' },
    rewardMessage
  );
  assert.equal(message, '發放點數：5 點\n發放原因：活動補發\n新獲得：優惠券「免費咖啡」。');
  assert.doesNotMatch(message, /目前點數|目前累計|夏季卡/);
  assert.doesNotMatch(message, /Bearer|LINE_MESSAGING_CHANNEL_ACCESS_TOKEN|requestId|lineUserId/);

  const plainMessage = context.__test.pointGrantPushMessage_(
    { stampCount: 5, reason: '活動補發' },
    ''
  );
  assert.equal(plainMessage, '發放點數：5 點\n發放原因：活動補發');
  assert.doesNotMatch(plainMessage, /新獲得/);
  assert.match(rewardMessage, /^新獲得：/);
  assert.doesNotMatch(rewardMessage, /活動補發|目前點數/);
  assert.match(context.__test.pointGrantNotificationTitle_(reward), /免費咖啡/);
  assert.match(context.__test.pointGrantRetryKey_('PG-TEST'), /^[a-f0-9-]{36}$/);

  const grant = { grantId: 'PG-TEST', cardId: 'CARD-1', memberLineUserId: 'U-1' };
  const notification = {
    type: 'point-grant-reward',
    memberLineUserId: 'U-1',
    relatedId: 'PG-TEST',
    cardId: 'CARD-1',
    message: rewardMessage
  };
  assert.equal(context.__test.pointGrantRewardPushMessageFromNotification_(grant, notification), rewardMessage);
  assert.equal(context.__test.pointGrantRewardPushMessageFromNotification_(grant, { ...notification, memberLineUserId: 'U-2' }), '');
  assert.equal(context.__test.pointGrantRewardPushMessageFromNotification_(grant, { ...notification, cardId: 'CARD-2' }), '');
});