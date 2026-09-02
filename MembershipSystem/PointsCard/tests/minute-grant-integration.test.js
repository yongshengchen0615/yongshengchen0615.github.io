'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('minute-to-points endpoint is HMAC-protected, time-bound, and not a browser admin route', () => {
  const code = read('gas/Code.gs');
  const integration = read('gas/MinuteGrantIntegrationService.gs');
  const route = code.indexOf("if (action === 'integration.minutes.grant-points')");
  const cardListRoute = code.indexOf("if (action === 'integration.minutes.cards.list')");
  const tokenRead = code.indexOf('const idToken = cleanText_');

  assert.ok(route >= 0 && route < tokenRead, 'signed integration route must not depend on a browser LIFF token');
  assert.ok(cardListRoute >= 0 && cardListRoute < tokenRead, 'signed card-list route must not depend on a browser LIFF token');
  assert.match(code, /minuteGrantIntegrationSecretProperty: 'POINTS_CARD_MINUTE_GRANT_INTEGRATION_SECRET'/);
  assert.doesNotMatch(code, /POINTS_CARD_MINUTE_GRANT_CARD_ID/);
  assert.match(integration, /Utilities\.computeHmacSha256Signature/);
  assert.match(integration, /minuteGrantIntegrationSignatureMatches_/);
  assert.match(integration, /maxClockSkewMs: 10 \* 60 \* 1000/);
  assert.match(integration, /INTEGRATION_REQUEST_EXPIRED/);
  assert.match(integration, /Math\.floor\(serviceMinutes \/ pointsPerServiceMinutes\) !== stampCount/);
  assert.match(integration, /const cardId = validMultiCardId_\(payload\.cardId, true\)/);
  assert.match(integration, /function minuteGrantCardsListIntegration_\(event\)/);
  assert.match(integration, /allMultiCards_\(\)\.filter\(function \(card\) \{ return card\.available; \}\)/);
  assert.doesNotMatch(integration, /LINE_MESSAGING_CHANNEL_ACCESS_TOKEN|Authorization:\s*'Bearer/);
});

test('trusted minute integration reuses point grant recovery and does not issue a second LINE push', () => {
  const service = read('gas/AdminPointGrantService.gs');
  const integration = read('gas/MinuteGrantIntegrationService.gs');

  assert.match(integration, /adminPointGrantMultiCard_\([\s\S]*source: 'minute-grant'/);
  assert.match(service, /const integration = internalOptions && internalOptions\.source === 'minute-grant'/);
  assert.match(service, /findByFieldWithRow_\(memberSheet, 'lineUserId', integration\.targetMemberLineUserId\)/);
  assert.match(service, /ensureMinuteGrantIntegrationMember_\(integration, memberSheet\)/);
  assert.match(service, /pushStatus: integration \? 'delegated' : 'pending'/);
  assert.match(service, /pushStatus: integration \? 'delegated' : 'pending'/);
  assert.match(read('gas/AdminPointGrantPushService.gs'), /pushStatus === 'delegated'/);
});
