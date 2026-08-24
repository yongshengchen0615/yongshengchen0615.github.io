'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const adminHtml = fs.readFileSync(path.resolve(__dirname, '../admin/index.html'), 'utf8');
const subpagesScript = fs.readFileSync(path.resolve(__dirname, '../admin/subpages.js'), 'utf8');

test('admin management is split into four subpages', () => {
  for (const page of ['overview', 'members', 'tiers', 'usage']) {
    assert.match(adminHtml, new RegExp(`data-admin-page="${page}"`));
    assert.match(adminHtml, new RegExp(`data-admin-page-panel="${page}"`));
  }

  assert.match(adminHtml, /id="adminPageOverview"/);
  assert.match(adminHtml, /id="adminPageMembers"/);
  assert.match(adminHtml, /id="adminPageTiers"/);
  assert.match(adminHtml, /id="adminPageUsage"/);
});

test('existing management functions stay inside their dedicated subpages', () => {
  const membersPage = adminHtml.match(/<section id="adminPageMembers"[\s\S]*?<\/section>\s*<section id="adminPageTiers"/)[0];
  const tiersPage = adminHtml.match(/<section id="adminPageTiers"[\s\S]*?<\/section>\s*<section id="adminPageUsage"/)[0];
  const usagePage = adminHtml.match(/<section id="adminPageUsage"[\s\S]*?<\/section>\s*<\/section>\s*<\/main>/)[0];

  assert.match(membersPage, /id="memberSearch"/);
  assert.match(membersPage, /id="memberTableBody"/);
  assert.match(tiersPage, /id="saveTierSettingsButton"/);
  assert.match(tiersPage, /id="tierSilverThreshold"/);
  assert.match(usagePage, /id="newUsageQrButton"/);
  assert.match(usagePage, /id="voucherTableBody"/);
});

test('subpage navigation supports direct hash navigation and overview shortcuts', () => {
  assert.match(adminHtml, /src="\.\/subpages\.js"/);
  assert.match(adminHtml, /data-admin-page-target="members"/);
  assert.match(adminHtml, /data-admin-page-target="tiers"/);
  assert.match(adminHtml, /data-admin-page-target="usage"/);
  assert.match(subpagesScript, /PAGE_NAMES = \['overview', 'members', 'tiers', 'usage'\]/);
  assert.match(subpagesScript, /window\.addEventListener\('hashchange'/);
  assert.match(subpagesScript, /window\.location\.hash = targetPage/);
  assert.doesNotThrow(() => new vm.Script(subpagesScript));
});
