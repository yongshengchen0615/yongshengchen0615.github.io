const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const script = fs.readFileSync(path.join(root, 'user-tour.js'), 'utf8');
const profile = (id = 'LINE_TEST_A') => ({ lineUserId: id, profileComplete: true, membershipRequired: false });
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));

async function page({ surface = 'member', saved = {}, version = 1, missing = '', testSession = false } = {}) {
  const html = fs.readFileSync(path.join(root, surface, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: `https://example.test/${surface}/` });
  const w = dom.window;
  await new Promise((resolve) => w.addEventListener('load', resolve, { once: true }));
  Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle });
  w.TextEncoder = TextEncoder;
  if (testSession) w.TestModeClient = { getSessionToken: () => 'test-session' };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  const view = w.document.querySelector('main[data-user-tour]');
  view.classList.remove('hidden');
  if (missing) w.document.querySelector(missing)?.remove();
  for (const [key, value] of Object.entries(saved)) w.localStorage.setItem(key, value);
  w.eval(version === 1 ? script : script.replace('const VERSION = 1;', `const VERSION = ${version};`));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const ready = async (id = 'LINE_TEST_A') => {
    const eventName = surface === 'member' ? 'member-profile-ready' : 'user-tour:ready';
    w.dispatchEvent(new w.CustomEvent(eventName, { detail: { surface, profile: profile(id) } }));
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
  w.document.querySelector('main[data-user-tour]').classList.add('hidden');
  await ready();
  assert.equal(dialog.classList.contains('hidden'), true);
  w.document.querySelector('main[data-user-tour]').classList.remove('hidden');
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

test('every member client has its own first-use tour and replay button', async () => {
  let saved = {};
  const titles = {
    member: '這是你的會員卡',
    points: '查看會員階級',
    event: '確認會員資格',
    calendar: '確認會員階級',
    booking: '確認會員階級',
  };
  for (const surface of Object.keys(titles)) {
    const current = await page({ surface, saved });
    await current.ready();
    assert.equal(current.dialog.classList.contains('hidden'), false, surface);
    assert.match(current.dialog.textContent, new RegExp(titles[surface]));
    assert.equal(current.w.document.getElementById('openMemberTour').getAttribute('aria-controls'), 'memberTourDialog');
    current.w.document.getElementById('memberTourSkip').click();
    assert.equal(current.dialog.classList.contains('hidden'), true);
    current.w.document.getElementById('openMemberTour').click();
    assert.equal(current.dialog.classList.contains('hidden'), false, `${surface} replay`);
    current.w.document.getElementById('memberTourSkip').click();
    saved = Object.fromEntries(Object.entries(current.w.localStorage));
    current.dom.window.close();
  }
  assert.equal(Object.keys(saved).length, 5);
});

test('empty event data skips absent ticket targets, and an existing dialog is not covered', async () => {
  const current = await page({ surface: 'event' });
  current.w.document.getElementById('emptyView').classList.remove('hidden');
  await current.ready();
  current.w.document.getElementById('memberTourNext').click();
  current.w.document.getElementById('memberTourNext').click();
  assert.match(current.dialog.textContent, /尚無開放活動/);
  assert.equal(current.w.document.getElementById('memberTourProgress').textContent, '使用教學 3 / 3');
  current.w.document.getElementById('memberTourSkip').click();
  current.dom.window.close();

  const blocked = await page({ surface: 'event' });
  blocked.w.document.getElementById('ticketModal').classList.remove('hidden');
  await blocked.ready();
  assert.equal(blocked.dialog.classList.contains('hidden'), true);
  blocked.w.document.getElementById('ticketModal').classList.add('hidden');
  await tick();
  assert.equal(blocked.dialog.classList.contains('hidden'), false);
  blocked.dom.window.close();
});

test('automated test sessions retain manual help without blocking test actions', async () => {
  const current = await page({ surface: 'booking', testSession: true });
  await current.ready();
  assert.equal(current.dialog.classList.contains('hidden'), true);
  current.w.document.getElementById('openMemberTour').click();
  assert.equal(current.dialog.classList.contains('hidden'), false);
  current.dom.window.close();
});
