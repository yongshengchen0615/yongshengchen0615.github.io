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
  assert.match(source, /strictInt_\(payload\.stampCount, 1, POINTS_CARD_ADMIN_GRANTS\.maxGrantPoints/);
  assert.match(source, /maxGrantPoints: 100/);
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

test('grant transaction records intent before progress mutation and success audit after mutation', () => {
  const source = read('gas/AdminPointGrantService.gs');
  const requested = source.indexOf("'CARD_POINTS_GRANT_REQUESTED'");
  const append = source.indexOf('appendAdminPointGrantObject_(POINTS_CARD_ADMIN_GRANTS.grantsSheet, grant)');
  const progressWrite = source.indexOf('progress.totalStamps = totalAfter');
  const success = source.indexOf("'CARD_POINTS_GRANTED'", progressWrite);
  const notification = source.indexOf('ensurePointGrantNotification_(grant, cardMatch.card.name)', progressWrite);
  assert.ok(requested >= 0 && requested < append, 'pending audit must precede transaction record');
  assert.ok(append < progressWrite, 'processing record must exist before changing points');
  assert.ok(progressWrite < notification, 'notification is created after point state is updated');
  assert.ok(notification < success, 'success audit follows point/notification mutation');
  assert.match(source, /status: 'processing'/);
  assert.match(source, /grant\.status = 'recorded'/);
  assert.match(source, /recoverAdminPointGrant_\(existing\)/);
});

test('member notification APIs are identity-scoped and prevent IDOR', () => {
  const code = read('gas/Code.gs');
  const source = read('gas/AdminPointGrantService.gs');
  assert.match(extractCase(code, 'member.point-notifications.list'), /memberPointNotificationsList_\(context, payload\)/);
  assert.match(extractCase(code, 'member.point-notification.read'), /memberPointNotificationRead_\(context, payload\)/);
  assert.match(source, /notification\.memberLineUserId === context\.identity\.sub/);
  assert.match(source, /notification\.status === 'unread'/);
  assert.match(source, /notification\.memberLineUserId !== context\.identity\.sub\) fail_\('FORBIDDEN'/);
  assert.match(source, /notification\.status = 'read'/);
});

test('official-account push uses the existing secret property and deterministic retry key without exposing the token', () => {
  const source = read('gas/AdminPointGrantService.gs');
  assert.match(source, /channelAccessTokenProperty: 'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN'/);
  assert.match(source, /https:\/\/api\.line\.me\/v2\/bot\/message\/push/);
  assert.match(source, /Authorization: 'Bearer ' \+ channelAccessToken/);
  assert.match(source, /'X-Line-Retry-Key': retryKey/);
  assert.match(source, /responseCode === 200 \|\| responseCode === 409/);
  assert.match(source, /responseCode === 429 \|\| responseCode >= 500/);
  assert.doesNotMatch(source, /pushErrorCode\s*=\s*channelAccessToken/);
  assert.doesNotMatch(source, /audit_\([^\n]*channelAccessToken/);
});

test('push failure is a side effect and does not roll back the completed point transaction', () => {
  const source = read('gas/AdminPointGrantService.gs');
  const transactionEnd = source.indexOf('} finally {\n    lock.releaseLock();\n  }\n\n  const push = attemptAdminPointGrantPush_');
  assert.ok(transactionEnd >= 0, 'push must occur only after transaction lock is released');
  assert.match(source.slice(transactionEnd), /attemptAdminPointGrantPush_\(result\.grantId\)/);
  assert.match(source.slice(transactionEnd), /result\.pushStatus = push\.status/);
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
  assert.match(user, /dialog\.addEventListener\('cancel',[\s\S]*preventDefault/);
});

test('point grant messages contain only the business notification payload', () => {
  const context = {
    Object,
    String,
    Number,
    Date,
    JSON,
    Math,
    console,
    storedNonNegativeInt_: (value) => Number(value || 0),
    sha256Hex_: () => '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    Utilities: { formatDate: () => '260822' }
  };
  vm.createContext(context);
  vm.runInContext(
    read('gas/AdminPointGrantService.gs') + '\n;globalThis.__test = { pointGrantPushMessage_, pointGrantNotificationMessage_, pointGrantRetryKey_ };',
    context
  );
  const message = context.__test.pointGrantPushMessage_({ stampCount: 5, reason: '活動補發', totalAfter: 12 }, '夏季卡');
  assert.match(message, /夏季卡/);
  assert.match(message, /5 點/);
  assert.match(message, /活動補發/);
  assert.match(message, /12 點/);
  assert.doesNotMatch(message, /Bearer|LINE_MESSAGING_CHANNEL_ACCESS_TOKEN|requestId|lineUserId/);
  assert.match(context.__test.pointGrantRetryKey_('PG-TEST'), /^[a-f0-9-]{36}$/);
});
