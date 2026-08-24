'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function formatDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((result, part) => {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function publicError(code, message) {
  const error = new Error(message);
  error.publicCode = code;
  return error;
}

function loadProfileModule() {
  const source = fs.readFileSync(path.resolve(__dirname, '../gas/ProfileManagement.gs'), 'utf8');
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
      return value == null ? '' : String(value);
    },
    sheetSafe_(value) { return value == null ? '' : String(value); },
    cleanText_(value, maxLength, required) {
      const text = value == null ? '' : String(value).trim();
      if (required && !text) throw publicError('INVALID_INPUT', '缺少必要欄位。');
      if (text.length > maxLength) throw publicError('INVALID_INPUT', '輸入內容超過允許長度。');
      return text;
    },
    fail_(code, message) {
      throw publicError(code, message);
    },
    Utilities: {
      formatDate(date, timeZone) { return formatDateInTimeZone(date, timeZone); }
    }
  };

  vm.createContext(context);
  vm.runInContext(
    source + '\nthis.__birthDateExports = {' +
      ' normalizeProfileBirthDateValue_, rowToProfile_, publicProfile_,' +
      ' writeProfile_, validateProfileBirthDate_, isProfileComplete_' +
    ' };',
    context
  );
  return context.__birthDateExports;
}

test('birthday is mandatory at the GAS validation boundary', () => {
  const api = loadProfileModule();
  assert.throws(
    () => api.validateProfileBirthDate_(''),
    (error) => error && error.publicCode === 'INVALID_INPUT'
  );
  assert.equal(api.validateProfileBirthDate_('1990-01-02'), '1990-01-02');
});

test('Google Sheets Date birthday is normalized to YYYY-MM-DD in Asia/Taipei', () => {
  const api = loadProfileModule();
  const sheetsDate = new Date('1990-01-01T16:00:00.000Z');
  const profile = api.rowToProfile_([
    'U-test',
    '0912345678',
    sheetsDate,
    '2026-08-24T00:00:00.000Z',
    '2026-08-24T00:00:00.000Z'
  ]);

  assert.equal(profile.birthDate, '1990-01-02');
  assert.equal(api.publicProfile_(profile).birthDate, '1990-01-02');
  assert.equal(api.isProfileComplete_(profile), true);
});

test('legacy ISO birthday is normalized without a UTC day shift', () => {
  const api = loadProfileModule();
  assert.equal(api.normalizeProfileBirthDateValue_('1990-01-01T16:00:00.000Z'), '1990-01-02');
  assert.equal(api.normalizeProfileBirthDateValue_('invalid'), '');
});

test('phone and birthday columns are forced to plain text before profile write', () => {
  const api = loadProfileModule();
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
  assert.deepEqual(calls[1], ['format', [2, 3], '@']);
  assert.equal(calls[2][0], 'values');
  assert.equal(calls[2][2][0][1], '0912345678');
  assert.equal(calls[2][2][0][2], '1990-01-02');
});

test('member profile forms require birthday year month and day', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../user/index.html'), 'utf8');

  for (const prefix of ['profileSetup', 'profileEdit']) {
    assert.match(html, new RegExp(`id="${prefix}BirthYear"[^>]*required`));
    assert.match(html, new RegExp(`id="${prefix}BirthMonth"[^>]*required`));
    assert.match(html, new RegExp(`id="${prefix}BirthDay"[^>]*required`));
  }
});

test('member card displays the complete phone number instead of masking it', () => {
  const script = fs.readFileSync(path.resolve(__dirname, '../user/app.js'), 'utf8');
  assert.match(script, /function formatPhone\(value\)[\s\S]*return phone \|\| '—';/);
  assert.match(script, /profilePhone'\)\.textContent = profile \? formatPhone\(profile\.phone\) : '—'/);
  assert.doesNotMatch(script, /maskPhone/);
  assert.doesNotMatch(script, /'•'\.repeat/);
  assert.doesNotThrow(() => new vm.Script(script));
});
