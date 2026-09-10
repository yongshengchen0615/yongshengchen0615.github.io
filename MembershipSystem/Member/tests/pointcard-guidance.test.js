'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('point-card guidance is wired through schema, admin save, and member rendering', () => {
  const storage = read('gas/Storage.gs');
  const service = read('gas/PointCardService.gs');
  const adminHtml = read('admin/index.html');
  const adminApp = read('admin/app.js');
  const pointsHtml = read('points/index.html');
  const pointsApp = read('points/app.js');
  const pointsCss = read('points/styles.css');

  assert.match(storage, /PointCards:[\s\S]*'usage_method'[\s\S]*'usage_instructions'[\s\S]*'benefit_description'/);
  assert.doesNotMatch(storage, /MEMBERSHIP_SYNC_SCHEMA_VERSION_/);
  assert.match(service, /card\.usage_method = usageMethod/);
  assert.match(service, /card\.usage_instructions = usageInstructions/);
  assert.match(service, /card\.benefit_description = benefitDescription/);

  for (const id of ['cardUsageMethod', 'cardUsageInstructions', 'cardBenefitDescription']) {
    assert.match(adminHtml, new RegExp(`id=["']${id}["']`));
    assert.match(adminApp, new RegExp(`els\\.${id}`));
    assert.match(pointsHtml, new RegExp(`id=["']${id}["']`));
    assert.match(pointsApp, new RegExp(`els\\.${id}`));
  }
  assert.match(pointsApp, /renderCardGuidance\(card\)/);
  assert.match(pointsApp, /visibleCount === 0/);
  assert.match(pointsHtml, /id=["']cardExpiry["']/);
  assert.match(pointsApp, /els\.cardExpiry\.textContent/);
  assert.doesNotMatch(adminHtml, /cardDescription|一句話說明/);
  assert.doesNotMatch(adminApp, /cardDescription/);
  assert.doesNotMatch(pointsHtml, /activeCardDescription|Reward options|rewardTitle|id=["']updatedAt["']/);
  assert.doesNotMatch(pointsApp, /els\.activeCardDescription|els\.rewardTitle|els\.updatedAt/);
  assert.doesNotMatch(service, /description: String\(card\.description/);
  assert.doesNotMatch(service, /card\.description = description/);
  assert.match(pointsApp, /function setConfiguredText\(element, value\)[\s\S]*element\.textContent[\s\S]*configured-text/);
  assert.match(pointsCss, /\.configured-text\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow-wrap:\s*anywhere/);
  assert.match(pointsApp, /setConfiguredText\(els\.ticketModalDescription,/);
  assert.match(pointsApp, /setConfiguredText\(els\.ticketModalUsageInstructions,/);
  assert.match(pointsApp, /setConfiguredText\(description, offer\.ticketDescription\)/);
});

test('point-card ticket settings allow multiline copy', () => {
  const adminHtml = read('admin/index.html');
  const adminApp = read('admin/app.js');

  assert.match(adminHtml, /id="ticketUsageMethod"[^>]*rows="2"/);
  assert.match(adminApp, /type === 'textarea'/);
  assert.match(adminApp, /fieldLabel\('獎項說明（可換行，選填）', 'textarea'/);
});
