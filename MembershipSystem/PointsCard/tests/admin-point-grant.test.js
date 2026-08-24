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
  const notification = source.indexOf('ensurePointGrantNotification_(grant, cardMatch.card)', progressWrite);
  assert.ok(requested >= 0 && requested < append, 'pending audit must precede transaction record');
  assert.ok(append < progressWrite, 'processing record must exist before changing points');
  assert.ok(progressWrite < notification, 'reward notification decision happens after point state is updated');
  assert.ok(notification < success, 'success audit follows point/reward-notification mutation');
  assert.match(source, /status: 'processing'/);
  assert.match(source, /grant\.status = 'recorded'/);
  assert.match(source, /recoverAdminPointGrant_\(existing\)/);
  assert.match(source, /if \(grant\.status === 'recorded'\) return grant/);
});

test('plain point grants do not create member popups while newly unlocked tickets do', () => {
  const notifications = read('gas/MemberPointNotificationService.gs');
  assert.match(notifications, /rewardEntitlementsBetweenTotals_\(grant\.totalBefore, grant\.totalAfter, settings\)/);
  assert.match(notifications, /if \(!unlockedRewards\.length\) return null/);
  assert.match(notifications, /type: 'point-grant-reward'/);
  assert.match(notifications, /notification\.type === 'point-grant-reward'/);
  assert.match(notifications, /pointGrantRewardSummary_\(rewards\)/);
  assert.match(notifications, /return '新獲得：'/);
});

test('member notification APIs are isolated, identity-scoped and prevent IDOR', () => {
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
  assert.match(source.slice(transactionEnd), /attemptAdminPointGrantPush_\(result\.grantId\)/);
  assert.match(source.slice(transactionEnd), /result\.pushStatus = push\.status/);
  assert.doesNotMatch(push, /totalStamps\s*=/);
  assert.match(push, /pointGrantPushStatus_\(push\)/);
});

test('push retries reuse persisted reward details instead of recalculating historical entitlements', () => {
  const push = read('gas/AdminPointGrantPushService.gs');
  assert.match(push, /pointGrantNotificationId_\(grantId\)/);
  assert.match(push, /notification\.type !== 'point-grant-reward'/);
  assert.match(push, /return notification\.message/);
  assert.doesNotMatch(push, /pointGrantUnlockedRewards_\(/);
});

test('member and admin browser surfaces load local feature modules and use API actions', () => {
  const adminHtml = read('admin/index.html');
  const userHtml = read('user/index.html');
  const admin = read('admin/point-grant.js');
  const user = read('user/point-notifications.js');
  assert.match(adminHtml, /<script src="\.\/point-grant\.js"><\/script>/);
  assert.match(userHtml, /<script defer src="\.\/point-notifications\.js"><\/script>/);
  assert.match(admin, /PointsCard\.callApi\('admin\.points\.grant'/);
  assert.match(admin, /PointsCard\.randomHex\(16\)/);
  assert.doesNotMatch(admin, /totalStamps\s*[+\-]?=/);
  assert.match(user, /PointsCard\.callApi\('member\.point-notifications\.list'/);
  assert.match(user, /PointsCard\.callApi\('member\.point-notification\.read'/);
  assert.match(user, /目前點數：/);
  assert.doesNotMatch(user, /目前累計/);
  assert.match(user, /dialog\.addEventListener\('cancel',[\s\S]*preventDefault/);
});

test('point grant messages show reason/current points and append persisted ticket details when present', () => {
  const context = {
    Object,
    String,
    Number,
    Date,
    JSON,
    Math,
    console,
    sha256Hex_: () => '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  };
  vm.createContext(context);
  vm.runInContext(
    read('gas/LineMessagingService.gs') + '\n' +
      read('gas/MemberPointNotificationService.gs') + '\n' +
      read('gas/AdminPointGrantPushService.gs') +
      '\n;globalThis.__test = { pointGrantPushMessage_, pointGrantNotificationMessage_, pointGrantNotificationTitle_, pointGrantRetryKey_ };',
    context
  );

  const reward = [{ rewardName: '免費咖啡', rewardType: 'coupon' }];
  const rewardMessage = context.__test.pointGrantNotificationMessage_(reward);
  const message = context.__test.pointGrantPushMessage_(
    { stampCount: 5, reason: '活動補發', totalAfter: 12 },
    '夏季卡',
    rewardMessage
  );
  assert.match(message, /夏季卡/);
  assert.match(message, /5 點/);
  assert.match(message, /發放原因：活動補發/);
  assert.match(message, /目前點數：12 點/);
  assert.match(message, /優惠券「免費咖啡」/);
  assert.doesNotMatch(message, /目前累計/);
  assert.doesNotMatch(message, /Bearer|LINE_MESSAGING_CHANNEL_ACCESS_TOKEN|requestId|lineUserId/);

  const plainMessage = context.__test.pointGrantPushMessage_(
    { stampCount: 5, reason: '活動補發', totalAfter: 6 },
    '夏季卡',
    ''
  );
  assert.doesNotMatch(plainMessage, /新獲得/);
  assert.match(rewardMessage, /^新獲得：/);
  assert.doesNotMatch(rewardMessage, /活動補發|目前點數/);
  assert.match(context.__test.pointGrantNotificationTitle_(reward), /免費咖啡/);
  assert.match(context.__test.pointGrantRetryKey_('PG-TEST'), /^[a-f0-9-]{36}$/);
});