'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function loadProfileModule() {
  const sourcePath = path.resolve(__dirname, '../gas/ProfileManagement.gs');
  const source = fs.readFileSync(sourcePath, 'utf8');
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
    normalizeCell_(value) {
      if (value instanceof Date) return value.toISOString();
      if (typeof value === 'boolean' || typeof value === 'number') return value;
      const text = value == null ? '' : String(value);
      return /^'[=+@-]/.test(text) ? text.slice(1) : text;
    },
    sheetSafe_(value) {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const text = value instanceof Date ? value.toISOString() : String(value);
      return /^[=+@-]/.test(text) ? "'" + text : text;
    },
    cleanText_(value, maxLength, required) {
      const text = value == null ? '' : String(value).replace(/[\u0000-\u001F\u007F]/g, '').trim();
      if (required && !text) this.fail_('INVALID_INPUT', '缺少必要欄位。');
      if (text.length > maxLength) this.fail_('INVALID_INPUT', '輸入內容超過允許長度。');
      return text;
    },
    fail_(code, message) {
      const error = new Error(message);
      error.publicCode = code;
      throw error;
    },
    Utilities: {
      formatDate() { return '2026-08-24'; }
    }
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.__profileTestExports = { normalizeProfilePhoneValue_, rowToProfile_, profileToRow_, publicProfile_, writeProfile_, inspectAndFormatLegacyProfilePhones_, validateProfilePhone_ };', context);
  return { context, api: context.__profileTestExports };
}

test('preserves a Taiwan phone leading zero as a string through row serialization', () => {
  const { api } = loadProfileModule();
  const profile = {
    lineUserId: 'U-test',
    phone: '0912345678',
    birthDate: '1990-01-02',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z'
  };

  const row = api.profileToRow_(profile);
  assert.equal(row[1], '0912345678');
  assert.equal(typeof row[1], 'string');
});

test('normalizes legacy numeric phone cells to the API string contract without inventing digits', () => {
  const { api } = loadProfileModule();
  const profile = api.rowToProfile_([
    'U-test',
    912345678,
    '1990-01-02',
    '2026-08-24T00:00:00.000Z',
    '2026-08-24T00:00:00.000Z'
  ]);

  assert.equal(profile.phone, '912345678');
  assert.equal(typeof profile.phone, 'string');
  assert.equal(api.publicProfile_(profile).phone, '912345678');
});

test('forces the phone cell to plain text before writing the profile row', () => {
  const { api } = loadProfileModule();
  const calls = [];
  const sheet = {
    getRange(...args) {
      return {
        setNumberFormat(format) {
          calls.push(['format', args, format]);
          return this;
        },
        setValues(values) {
          calls.push(['values', args, values]);
          return this;
        }
      };
    }
  };

  api.writeProfile_(sheet, 2, {
    lineUserId: 'U-test',
    phone: '0912345678',
    birthDate: '1990-01-02',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z'
  });

  assert.deepEqual(calls[0], ['format', [2, 2], '@']);
  assert.equal(calls[1][0], 'values');
  assert.equal(calls[1][2][0][1], '0912345678');
});

test('legacy storage inspection formats the phone column and only reports numeric rows', () => {
  const { context, api } = loadProfileModule();
  const calls = [];
  const phoneRange = {
    getValues() {
      return [['0912345678'], [912345678], ['+886912345678']];
    },
    setNumberFormat(format) {
      calls.push(format);
    }
  };
  const sheet = {
    getLastRow() { return 4; },
    getRange(row, column, rows, columns) {
      assert.deepEqual([row, column, rows, columns], [2, 2, 3, 1]);
      return phoneRange;
    }
  };
  context.getCachedSheet_ = () => sheet;

  const result = api.inspectAndFormatLegacyProfilePhones_();
  assert.equal(result.formattedRows, 3);
  assert.deepEqual(Array.from(result.legacyNumericRows), [3]);
  assert.deepEqual(calls, ['@']);
});

test('phone validation preserves local leading zero and international plus prefix', () => {
  const { api } = loadProfileModule();
  assert.equal(api.validateProfilePhone_('0912-345-678'), '0912345678');
  assert.equal(api.validateProfilePhone_('+886 912 345 678'), '+886912345678');
  assert.throws(
    () => api.validateProfilePhone_('0912ABC678'),
    (error) => error && error.publicCode === 'INVALID_PHONE'
  );
});
