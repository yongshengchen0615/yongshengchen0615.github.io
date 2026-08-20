'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }

function publicError(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  throw error;
}

test('card names are unique after whitespace, width, and case normalization', () => {
  const context = {
    cleanText_: (value) => String(value == null ? '' : value).trim(),
    fail_: publicError
  };
  vm.createContext(context);
  vm.runInContext(read('gas/MultiCardStorage.gs') + '\n;globalThis.__cardNames = { multiCardNameKey_, assertMultiCardNameAvailable_ };', context);
  context.allMultiCards_ = () => [
    { cardId: 'CARD-ONE', name: '夏季 飲品卡' },
    { cardId: 'CARD-TWO', name: 'Member Card' }
  ];

  assert.equal(context.__cardNames.multiCardNameKey_('  ＭＥＭＢＥＲ　ＣＡＲＤ  '), 'member card');
  assert.throws(
    () => context.__cardNames.assertMultiCardNameAvailable_('member   card', 'CARD-THREE'),
    (error) => error.publicCode === 'CARD_NAME_DUPLICATE'
  );
  assert.doesNotThrow(() => context.__cardNames.assertMultiCardNameAvailable_('Member Card', 'CARD-TWO'));
  assert.doesNotThrow(() => context.__cardNames.assertMultiCardNameAvailable_('冬季飲品卡', 'CARD-THREE'));
});

test('all card write paths enforce name uniqueness inside their script lock', () => {
  const storage = read('gas/MultiCardStorage.gs');
  const editor = read('gas/MultiCardCardEditorService.gs');
  const createBody = storage.slice(storage.indexOf('function adminCardCreateMultiCard_'), storage.indexOf('function adminCardUpdateMultiCard_'));
  const updateBody = storage.slice(storage.indexOf('function adminCardUpdateMultiCard_'), storage.indexOf('function adminCardDeleteMultiCard_'));

  assert.match(createBody, /try \{[\s\S]*assertMultiCardNameAvailable_\(name, ''\)/);
  assert.match(updateBody, /try \{[\s\S]*assertMultiCardNameAvailable_\(name, cardId\)/);
  assert.match(editor, /try \{[\s\S]*assertMultiCardNameAvailable_\(name, cardId\)/);
});

test('QR management requires the selected card and rejects another card voucher', () => {
  const context = { fail_: publicError };
  vm.createContext(context);
  vm.runInContext(read('gas/MultiCardStampService.gs') + '\n;globalThis.__qrOwnership = { assertMultiCardVoucherBelongsToCard_ };', context);

  assert.doesNotThrow(() => context.__qrOwnership.assertMultiCardVoucherBelongsToCard_({ cardId: 'CARD-ONE' }, 'CARD-ONE'));
  assert.throws(
    () => context.__qrOwnership.assertMultiCardVoucherBelongsToCard_({ cardId: 'CARD-TWO' }, 'CARD-ONE'),
    (error) => error.publicCode === 'VOUCHER_CARD_MISMATCH'
  );

  const service = read('gas/MultiCardStampService.gs');
  const listStart = service.indexOf('function adminStampListMultiCard_');
  const listEnd = service.indexOf('\nfunction ', listStart + 10);
  const listBody = service.slice(listStart, listEnd);
  assert.match(listBody, /validMultiCardId_\(payload && payload\.cardId, true\)/);
  assert.match(listBody, /if \(!cardMatch\) fail_\('CARD_NOT_FOUND'/);
  assert.doesNotMatch(listBody, /selectedAdminMultiCard_/);

  for (const functionName of ['adminStampOpenMultiCard_', 'adminStampCancelMultiCard_', 'adminStampDeleteMultiCard_']) {
    const start = service.indexOf('function ' + functionName);
    const end = service.indexOf('\nfunction ', start + 10);
    const body = service.slice(start, end < 0 ? service.length : end);
    assert.match(body, /validMultiCardId_\(payload\.cardId, true\)/);
    assert.match(body, /assertMultiCardVoucherBelongsToCard_\(voucher, cardId\)/);
  }
});

test('new QR identifiers are collision checked and stamp records stay card scoped', () => {
  const service = read('gas/MultiCardStampService.gs');
  assert.match(service, /function newMultiCardVoucherId_/);
  assert.match(service, /if \(!findMultiCardByFieldWithRow_\(sheet, 'voucherId', voucherId\)\) return voucherId/);
  assert.match(service, /voucherId: newMultiCardVoucherId_\(sheet\)/);
  assert.match(service, /recoverProcessingCardStampRecordsForVoucher_\(voucher\.cardId, voucher\.voucherId\)/);
  assert.match(service, /record\.cardId === cardId && record\.voucherId === voucherId/);
  assert.match(service, /countMultiCardVoucherRecords_\(cardId, voucherId\)/);

  let randomCalls = 0;
  const context = {
    Utilities: { formatDate: () => '260820' },
    randomHex_: () => (++randomCalls === 1 ? 'aaaaaaaa' : 'bbbbbbbb'),
    findMultiCardByFieldWithRow_: (_sheet, _field, voucherId) => voucherId.endsWith('AAAAAAAA') ? { row: 2 } : null,
    fail_: publicError
  };
  vm.createContext(context);
  vm.runInContext(service + '\n;globalThis.__newVoucherId = newMultiCardVoucherId_;', context);
  assert.equal(context.__newVoucherId({}), 'SQ-260820-BBBBBBBB');

  const admin = read('admin/app.js');
  assert.match(admin, /admin\.stamp\.open', \{ cardId: voucher\.cardId, voucherId: voucher\.voucherId \}/);
  assert.match(admin, /admin\.stamp\.cancel', \{ cardId: voucher\.cardId, voucherId: voucher\.voucherId/);
  assert.match(admin, /admin\.stamp\.delete', \{ cardId: voucher\.cardId, voucherId: voucher\.voucherId/);
});
