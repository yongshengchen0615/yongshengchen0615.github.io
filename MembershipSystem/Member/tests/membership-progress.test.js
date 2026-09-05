'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadComponent() {
  const nodes = new Map([
    ['[data-membership-current-tier]', { textContent: '' }],
    ['[data-membership-summary]', { textContent: '' }],
    ['[data-membership-remaining]', { textContent: '' }],
    ['[data-membership-progress-track]', { attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, value); } }],
    ['[data-membership-progress-bar]', { style: {} }]
  ]);
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'shared/membership-progress.js'), 'utf8'), context, { filename: 'shared/membership-progress.js' });
  return { component: context.window.MembershipProgress, nodes, root: { querySelector: (selector) => nodes.get(selector) || null } };
}

test('shared membership progress uses the same requested tier format and calculated progress', () => {
  const { component, nodes, root: progressRoot } = loadComponent();
  component.render(progressRoot, {
    tier: '銀級會員',
    tierProgress: {
      serviceMinutesTotal: 900,
      currentRequiredServiceMinutes: 600,
      nextTierLabel: '金級會員',
      nextRequiredServiceMinutes: 1800,
      remainingServiceMinutes: 900
    }
  });
  assert.equal(nodes.get('[data-membership-current-tier]').textContent, '目前會員階級：銀級會員');
  assert.equal(nodes.get('[data-membership-summary]').textContent, '累積 900 分鐘・下一階段 金級會員 1800 分鐘');
  assert.equal(nodes.get('[data-membership-remaining]').textContent, '距離 金級會員 還需要 900 分鐘');
  assert.equal(nodes.get('[data-membership-progress-bar]').style.width, '25%');
  assert.equal(nodes.get('[data-membership-progress-track]').attributes.get('aria-valuetext'), '距離 金級會員 還需要 900 分鐘');
});

test('shared membership progress keeps the highest-tier state explicit', () => {
  const { component, nodes, root: progressRoot } = loadComponent();
  component.render(progressRoot, { tier: '鑽石會員', tierProgress: { serviceMinutesTotal: 3600, isHighestTier: true } });
  assert.equal(nodes.get('[data-membership-summary]').textContent, '累積 3600 分鐘・已達最高會員階級');
  assert.equal(nodes.get('[data-membership-remaining]').textContent, '已達最高會員階級');
  assert.equal(nodes.get('[data-membership-progress-bar]').style.width, '100%');
});

test('every member-facing LIFF loads the same membership progress structure', () => {
  const surfaces = [
    ['member', 'profile'],
    ['points', 'state.profile'],
    ['event', 'state.profile'],
    ['calendar', 'state.profile']
  ];
  surfaces.forEach(([surface, profile]) => {
    const html = fs.readFileSync(path.join(root, surface, 'index.html'), 'utf8');
    const app = fs.readFileSync(path.join(root, surface, 'app.js'), 'utf8');
    assert.match(html, /membership-progress\.css/);
    assert.match(html, /membership-progress\.js/);
    assert.match(html, /<h2 id="membershipProgressTitle">會員階級<\/h2>/);
    assert.match(html, /data-membership-current-tier/);
    assert.match(html, /data-membership-summary/);
    assert.match(html, /data-membership-remaining/);
    assert.match(html, /data-membership-progress-track/);
    assert.match(app, new RegExp(`MembershipProgress\\.render\\(els\\.membershipProgress, ${profile.replace('.', '\\.')}`));
  });
});
