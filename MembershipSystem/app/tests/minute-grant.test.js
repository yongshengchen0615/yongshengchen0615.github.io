'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function publicError(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  return error;
}

function loadMinuteGrantHelpers() {
  const source = fs.readFileSync(path.resolve(__dirname, '../gas/MinuteGrantService.gs'), 'utf8');
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
    cleanText_(value, maxLength, required) {
      const text = value == null ? '' : String(value).replace(/[\u0000-\u001F\u007F]/g, '').trim();
      if (required && !text) throw publicError('INVALID_INPUT', '缺少必要欄位。');
      if (text.length > maxLength) throw publicError('INVALID_INPUT', '輸入內容超過允許長度。');
      return text;
    },
    fail_(code, message) { throw publicError(code, message); },
    nonNegativeInt_(value) {
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
    },
    normalizeTier_(value) {
      const tier = String(value || '').toLowerCase();
      if (tier === 'vip') return 'platinum';
      return ['silver', 'gold', 'platinum'].includes(tier) ? tier : 'standard';
    },
    sheetSafe_(value) {
      if (typeof value === 'number' || typeof value === 'boolean') return value;
      const text = String(value == null ? '' : value);
      return /^[=+@-]/.test(text) ? "'" + text : text;
    },
    normalizeCell_(value) {
      const text = value == null ? '' : String(value);
      return /^'[=+@-]/.test(text) ? text.slice(1) : text;
    }
  };
  vm.createContext(context);
  vm.runInContext(
    source + '\nthis.__minuteGrantExports = { readMinuteGrantInput_, minuteGrantPushMessage_, publicMemberMinuteGrant_, minuteGrantToRow_ };',
    context
  );
  return context.__minuteGrantExports;
}

test('manual minute grant input requires member, integer minutes, reason, and idempotency key', () => {
  const api = loadMinuteGrantHelpers();
  const input = api.readMinuteGrantInput_({
    targetMemberNo: 'M2026000001',
    minutes: 120,
    reason: '補登預約服務',
    requestId: 'a'.repeat(32)
  });
  assert.equal(input.targetMemberNo, 'M2026000001');
  assert.equal(input.minutes, 120);
  assert.equal(input.reason, '補登預約服務');
  assert.equal(input.requestId, 'a'.repeat(32));
  assert.throws(() => api.readMinuteGrantInput_({ targetMemberNo: 'M1', minutes: 0, reason: 'x', requestId: 'a'.repeat(32) }), /1 到 60000/);
  assert.throws(() => api.readMinuteGrantInput_({ targetMemberNo: 'M1', minutes: 60, reason: '', requestId: 'a'.repeat(32) }), /缺少必要欄位/);
  assert.throws(() => api.readMinuteGrantInput_({ targetMemberNo: 'M1', minutes: 60, reason: 'x', requestId: 'bad' }), /識別碼/);
});

test('minute grant rows neutralize spreadsheet formulas in the admin-entered reason', () => {
  const api = loadMinuteGrantHelpers();
  const row = api.minuteGrantToRow_({
    grantId: 'MG-1', requestId: 'a'.repeat(32), memberLineUserId: 'U1', memberNo: 'M1',
    memberDisplayName: 'Test', minutes: 60, reason: '=IMPORTXML("https://example.com")'
  });
  assert.equal(row[6].startsWith("'="), true);
});

test('member-facing grant payload contains reason but never exposes LINE ids, actor ids, request ids, or push internals', () => {
  const api = loadMinuteGrantHelpers();
  const output = api.publicMemberMinuteGrant_({
    grantId: 'MG-1', minutes: 60, reason: '生日活動', consumedAfterMinutes: 660,
    tierAfter: 'silver', grantedAt: '2026-08-24T10:00:00.000Z', createdAt: '2026-08-24T10:00:00.000Z',
    memberLineUserId: 'U-secret', grantedByLineUserId: 'U-admin', requestId: 'secret-request', pushErrorCode: 'HTTP_400'
  });
  assert.equal(output.reason, '生日活動');
  assert.equal(output.consumedAfterMinutes, 660);
  assert.equal(Object.prototype.hasOwnProperty.call(output, 'memberLineUserId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(output, 'grantedByLineUserId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(output, 'requestId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(output, 'pushErrorCode'), false);
});

test('LINE push message tells the member minutes, reason, total, and tier transition', () => {
  const api = loadMinuteGrantHelpers();
  const message = api.minuteGrantPushMessage_({
    minutes: 120,
    reason: '補登 8/24 預約服務',
    consumedAfterMinutes: 600,
    tierBefore: 'standard',
    tierAfter: 'silver'
  });
  assert.match(message, /本次發放：120 分鐘/);
  assert.match(message, /發放原因：補登 8\/24 預約服務/);
  assert.match(message, /累計消費：600 分鐘/);
  assert.match(message, /一般 → 銀級/);
});

test('API routing keeps manual grants behind server-side admin authorization and scopes member history to the authenticated identity', () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../gas/Code.gs'), 'utf8');
  const service = fs.readFileSync(path.resolve(__dirname, '../gas/MinuteGrantService.gs'), 'utf8');
  assert.match(code, /case 'admin\.minutes\.grant':\s*requireAdmin_\(context\);/s);
  assert.match(code, /case 'admin\.minutes\.grants\.list':\s*requireAdmin_\(context\);/s);
  assert.match(code, /case 'admin\.minutes\.push\.retry':\s*requireAdmin_\(context\);/s);
  assert.match(code, /case 'member\.minutes\.grants\.list':/);
  assert.match(service, /grant\.memberLineUserId === context\.identity\.sub/);
  assert.match(service, /findMinuteGrantByFieldWithRow_\('requestId', input\.requestId\)/);
  assert.match(service, /LockService\.getScriptLock\(\)/);
  assert.match(service, /isMembershipUsable_\(member\)/);
});

test('LINE Messaging token is read only from Script Properties and push uses a retry key', () => {
  const service = fs.readFileSync(path.resolve(__dirname, '../gas/LineMessagingService.gs'), 'utf8');
  assert.match(service, /LINE_MESSAGING_CHANNEL_ACCESS_TOKEN/);
  assert.match(service, /PropertiesService\.getScriptProperties\(\)/);
  assert.match(service, /https:\/\/api\.line\.me\/v2\/bot\/message\/push/);
  assert.match(service, /'X-Line-Retry-Key': retryKey/);
  assert.doesNotMatch(service, /Bearer [A-Za-z0-9_-]{20,}/);
});

test('admin and member frontends expose grant reason and history without mixing the feature into another admin block', () => {
  const adminHtml = fs.readFileSync(path.resolve(__dirname, '../admin/index.html'), 'utf8');
  const subpages = fs.readFileSync(path.resolve(__dirname, '../admin/subpages.js'), 'utf8');
  const adminScript = fs.readFileSync(path.resolve(__dirname, '../admin/minute-grants.js'), 'utf8');
  const userHtml = fs.readFileSync(path.resolve(__dirname, '../user/index.html'), 'utf8');
  const userScript = fs.readFileSync(path.resolve(__dirname, '../user/minute-grants.js'), 'utf8');

  assert.match(adminHtml, /data-admin-page="grants"/);
  assert.match(adminHtml, /data-admin-page-panel="grants"/);
  assert.match(adminHtml, /id="minuteGrantReason"[^>]*required/);
  assert.match(adminHtml, /原因會同時保存於系統、顯示在會員端/);
  assert.match(subpages, /'grants'/);
  assert.match(adminScript, /admin\.minutes\.grant/);
  assert.match(adminScript, /admin\.minutes\.push\.retry/);
  assert.match(userHtml, /id="minuteGrantHistoryTitle"/);
  assert.match(userScript, /member\.minutes\.grants\.list/);
  assert.match(userScript, /發放原因：/);
  assert.doesNotThrow(() => new vm.Script(adminScript));
  assert.doesNotThrow(() => new vm.Script(userScript));
});
