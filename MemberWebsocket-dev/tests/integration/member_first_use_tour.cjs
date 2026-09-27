const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'member/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'member/first-use-tour.js'), 'utf8');
const profile = (id = 'LINE_TEST_A') => ({ lineUserId: id, profileComplete: true, membershipRequired: false });
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));

async function page({ saved = {}, version = 1, missing = '' } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/member/' });
  const w = dom.window;
  await new Promise((resolve) => w.addEventListener('load', resolve, { once: true }));
  Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle });
  w.TextEncoder = TextEncoder;
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.document.getElementById('memberView').classList.remove('hidden');
  if (missing) w.document.querySelector(missing)?.remove();
  for (const [key, value] of Object.entries(saved)) w.localStorage.setItem(key, value);
  w.eval(version === 1 ? script : script.replace('const VERSION = 1;', `const VERSION = ${version};`));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const ready = async (id = 'LINE_TEST_A') => {
    w.dispatchEvent(new w.CustomEvent('member-profile-ready', { detail: { profile: profile(id) } }));
    await tick();
  };
  return { dom, w, ready, dialog: w.document.getElementById('memberTourDialog') };
}

test('first login, back, skip, refresh, manual replay and version change', async () => {
  const first = await page();
  await first.ready();
  assert.equal(first.dialog.classList.contains('hidden'), false);
  assert.equal(first.w.document.getElementById('app').inert, true);
  assert.match(first.dialog.textContent, /這是你的會員卡/);
  first.w.document.getElementById('memberTourNext').click();
  assert.match(first.dialog.textContent, /查看升等進度/);
  first.w.document.getElementById('memberTourBack').click();
  assert.match(first.dialog.textContent, /這是你的會員卡/);
  first.w.document.getElementById('memberTourSkip').click();
  assert.equal(first.dialog.classList.contains('hidden'), true);
  assert.equal(first.w.document.getElementById('app').inert, false);
  const entries = Object.fromEntries(Object.entries(first.w.localStorage));
  assert.equal(Object.keys(entries).length, 1);
  assert.equal(JSON.parse(Object.values(entries)[0]).outcome, 'skip');
  first.dom.window.close();

  const refreshed = await page({ saved: entries });
  await refreshed.ready();
  assert.equal(refreshed.dialog.classList.contains('hidden'), true);
  refreshed.w.document.getElementById('openMemberTour').click();
  assert.equal(refreshed.dialog.classList.contains('hidden'), false);
  for (let index = 0; index < 3; index++) refreshed.w.document.getElementById('memberTourNext').click();
  assert.match(refreshed.dialog.textContent, /探索其他功能/);
  assert.equal(refreshed.w.document.getElementById('memberTourNext').textContent, '完成');
  refreshed.w.document.getElementById('memberTourNext').click();
  assert.equal(refreshed.dialog.classList.contains('hidden'), true);
  const completed = Object.fromEntries(Object.entries(refreshed.w.localStorage));
  assert.equal(JSON.parse(Object.values(completed)[0]).outcome, 'complete');
  refreshed.dom.window.close();

  const upgraded = await page({ saved: completed, version: 2 });
  await upgraded.ready();
  assert.equal(upgraded.dialog.classList.contains('hidden'), false);
  upgraded.dom.window.close();
});

test('account isolation, missing anchor, keyboard escape and focus return', async () => {
  const { dom, w, ready, dialog } = await page({ missing: '#membershipProgress' });
  await ready();
  w.document.getElementById('memberTourNext').click();
  assert.match(dialog.textContent, /確認個人資料/);
  const escape = new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  dialog.dispatchEvent(escape);
  assert.equal(dialog.classList.contains('hidden'), true);
  assert.equal(w.document.activeElement.id, 'openMemberTour');
  await ready('LINE_TEST_B');
  assert.equal(dialog.classList.contains('hidden'), false);
  assert.equal(Object.keys(w.localStorage).length, 1);
  const backwardsTab = new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  dialog.dispatchEvent(backwardsTab);
  assert.equal(w.document.activeElement.id, 'memberTourNext');
  w.document.getElementById('memberTourSkip').click();
  assert.equal(Object.keys(w.localStorage).length, 2);
  dom.window.close();
});

test('tour only opens after member view is visible and verified profile is ready', async () => {
  const { dom, w, ready, dialog } = await page();
  w.document.getElementById('memberView').classList.add('hidden');
  await ready();
  assert.equal(dialog.classList.contains('hidden'), true);
  w.document.getElementById('memberView').classList.remove('hidden');
  await tick();
  assert.equal(dialog.classList.contains('hidden'), false);
  dom.window.close();
});

test('refresh during the tour restarts safely, and absent anchors leave the page usable', async () => {
  const first = await page();
  await first.ready();
  first.w.document.getElementById('memberTourNext').click();
  assert.equal(first.w.localStorage.length, 0);
  first.dom.window.close();

  const refreshed = await page();
  await refreshed.ready();
  assert.match(refreshed.dialog.textContent, /這是你的會員卡/);
  refreshed.dom.window.close();

  const noAnchors = await page();
  for (const selector of ['#memberPass', '#membershipProgress', '.profile-details', '#memberFeatureLinks']) {
    noAnchors.w.document.querySelector(selector).remove();
  }
  await noAnchors.ready();
  assert.equal(noAnchors.dialog.classList.contains('hidden'), true);
  assert.notEqual(noAnchors.w.document.getElementById('app').inert, true);
  assert.equal(noAnchors.w.localStorage.length, 0);
  noAnchors.dom.window.close();
});
