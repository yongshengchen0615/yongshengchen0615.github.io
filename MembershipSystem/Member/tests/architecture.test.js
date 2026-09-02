'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

test('Member module has independent user surfaces and one shared admin surface', () => {
  [
    'index.html', 'config.json', 'README.md', 'shared/common.js',
    'member/index.html', 'member/styles.css', 'member/app.js',
    'points/index.html', 'points/styles.css', 'points/app.js',
    'admin/index.html', 'admin/styles.css', 'admin/app.js',
    'gas/Code.gs', 'gas/Auth.gs', 'gas/Storage.gs', 'gas/MemberService.gs', 'gas/PointCardService.gs', 'gas/appsscript.json', 'tests/pointcard-rewards.test.js'
  ].forEach((file) => assert.equal(exists(file), true, `missing ${file}`));
});

test('public config contains separate LIFF ids and no secret-shaped key', () => {
  const config = JSON.parse(read('config.json'));
  assert.equal(typeof config.gasWebAppUrl, 'string');
  assert.equal(typeof config.memberLiffId, 'string');
  assert.equal(typeof config.pointsLiffId, 'string');
  assert.equal(typeof config.adminLiffId, 'string');
  assert.notEqual(config.memberLiffId, config.pointsLiffId);
  assert.notEqual(config.memberLiffId, config.adminLiffId);
  assert.notEqual(config.pointsLiffId, config.adminLiffId);
  assert.equal(Object.keys(config).some((key) => /secret|token|password/i.test(key)), false);
});

test('user clients expose separate entry points while admin uses one app', () => {
  const memberHtml = read('member/index.html');
  const pointsHtml = read('points/index.html');
  const adminHtml = read('admin/index.html');
  assert.match(memberHtml, /\.\/styles\.css/);
  assert.match(memberHtml, /\.\/app\.js/);
  assert.match(pointsHtml, /\.\/styles\.css/);
  assert.match(pointsHtml, /\.\/app\.js/);
  assert.match(adminHtml, /\.\/styles\.css/);
  assert.match(adminHtml, /\.\/app\.js/);
  assert.match(adminHtml, /membersPanel/);
  assert.match(adminHtml, /cardsPanel/);
});

test('all browser JavaScript and GAS files parse as JavaScript', () => {
  const files = ['shared/common.js', 'member/app.js', 'points/app.js', 'admin/app.js', 'gas/Code.gs', 'gas/Auth.gs', 'gas/Storage.gs', 'gas/MemberService.gs', 'gas/PointCardService.gs'];
  files.forEach((file) => assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), file));
});
