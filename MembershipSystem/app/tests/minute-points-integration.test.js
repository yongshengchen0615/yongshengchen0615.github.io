'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const crypto = require('node:crypto');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

function readRepository(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../../..', relativePath), 'utf8');
}

test('minute grants persist the point conversion and synchronise it before the member push', () => {
  const minuteGrant = read('gas/MinuteGrantService.gs');
  const bridge = read('gas/PointsCardMinuteGrantService.gs');
  const sync = minuteGrant.indexOf('attemptMinuteGrantPointsSync_(grant.grantId)');
  const push = minuteGrant.indexOf('attemptMinuteGrantPush_(grant.grantId)');

  assert.match(minuteGrant, /'pointsPerServiceMinutes', 'pointsGranted', 'pointsCardId'/);
  assert.match(minuteGrant, /Math\.floor\(minutes \/ pointsPerServiceMinutes\)/);
  assert.match(minuteGrant, /MAX_ADMIN_MINUTE_GRANT_POINTS = 100/);
  assert.ok(sync >= 0 && sync < push, 'PointsCard must be synchronised before the consolidated LINE push');
  assert.match(bridge, /POINTS_CARD_MINUTE_GRANT_WEB_APP_URL/);
  assert.match(bridge, /POINTS_CARD_MINUTE_GRANT_INTEGRATION_SECRET/);
  assert.match(bridge, /Utilities\.computeHmacSha256Signature/);
  assert.match(bridge, /membership-minute-grant-points:/);
  assert.match(bridge, /cardId: grant\.pointsCardId/);
  assert.match(bridge, /integration\.minutes\.cards\.list/);
  assert.match(bridge, /muteHttpExceptions: true/);
  assert.doesNotMatch(bridge, /webAppUrlProperty/);
  assert.doesNotMatch(read('shared/config.json'), /POINTS_CARD_MINUTE_GRANT_INTEGRATION_SECRET/);
});

test('PointsCard endpoint comes from app config and is generated into the GAS deployment bundle', () => {
  const config = JSON.parse(read('shared/config.json'));
  const bridge = read('gas/PointsCardMinuteGrantService.gs');
  const workflow = readRepository('.github/workflows/deploy-membership-gas.yml');

  assert.match(config.POINTS_CARD_GAS_WEB_APP_URL, /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/);
  assert.match(bridge, /POINTS_CARD_MINUTE_GRANT_WEB_APP_URL/);
  assert.match(workflow, /MembershipSystem\/app\/shared\/config\.json/);
  assert.match(workflow, /Generate GAS integration configuration/);
  assert.match(workflow, /POINTS_CARD_GAS_WEB_APP_URL/);
  assert.match(workflow, /PointsCardIntegrationConfig\.gs/);
  assert.doesNotMatch(read('shared/config.json'), /POINTS_CARD_MINUTE_GRANT_INTEGRATION_SECRET/);
});

test('a failed cross-system delivery remains retryable through an admin-only route', () => {
  const code = read('gas/Code.gs');
  const minuteGrant = read('gas/MinuteGrantService.gs');
  const bridge = read('gas/PointsCardMinuteGrantService.gs');
  const admin = read('admin/minute-grants.js');

  assert.match(code, /case 'admin\.minutes\.points\.retry':\s*requireAdmin_\(context\);/s);
  assert.match(minuteGrant, /function adminMinuteGrantRetryPoints_\(context, payload\)/);
  assert.match(bridge, /pointGrantStatus = result\.status \|\| 'failed'/);
  assert.match(admin, /function retryPoints\(grantId, button\)/);
  assert.match(admin, /重試集點/);
});

test('app admins fetch and select only signed PointsCard choices before the minute grant is recorded', () => {
  const code = read('gas/Code.gs');
  const minuteGrant = read('gas/MinuteGrantService.gs');
  const bridge = read('gas/PointsCardMinuteGrantService.gs');
  const admin = read('admin/minute-grants.js');

  assert.match(code, /case 'admin\.minutes\.points\.cards\.list':\s*requireAdmin_\(context\);/s);
  assert.match(bridge, /function callPointsCardMinuteGrantCards_\(\)/);
  assert.match(bridge, /cardsAction: 'integration\.minutes\.cards\.list'/);
  assert.match(minuteGrant, /const pointsCardId = cleanText_\(payload && payload\.pointsCardId/);
  assert.match(minuteGrant, /pointsCardId: input\.pointsCardId/);
  assert.match(admin, /function loadPointCards\(\)/);
  assert.match(admin, /pointsCardId,/);
});

test('both GAS deployments calculate the same HMAC signature without exposing the secret', () => {
  const utilities = {
    computeHmacSha256Signature(value, secret) {
      return Array.from(crypto.createHmac('sha256', secret).update(value).digest(), (byte) => byte > 127 ? byte - 256 : byte);
    }
  };
  const appContext = { Utilities: utilities, Object, String, Number, Array, RegExp };
  const pointsContext = { Utilities: utilities, Object, String, Number, Array, RegExp };
  vm.createContext(appContext);
  vm.createContext(pointsContext);
  vm.runInContext(read('gas/PointsCardMinuteGrantService.gs') + '\nthis.sign = hmacSha256Hex_;', appContext);
  vm.runInContext(read('../PointsCard/gas/MinuteGrantIntegrationService.gs') + '\nthis.sign = minuteGrantIntegrationHmacHex_;', pointsContext);
  const payload = '{"source":"MembershipSystem","requestId":"a"}';
  const secret = 'a'.repeat(32);
  assert.equal(appContext.sign(payload, secret), pointsContext.sign(payload, secret));
  assert.match(read('gas/PointsCardMinuteGrantService.gs'), /secret\.length < 32/);
  assert.match(read('../PointsCard/gas/MinuteGrantIntegrationService.gs'), /secret\.length < 32/);
});
