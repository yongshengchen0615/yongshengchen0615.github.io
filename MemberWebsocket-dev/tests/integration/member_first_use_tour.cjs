const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const script = fs.readFileSync(path.join(root, 'user-tour.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'user-tour.css'), 'utf8');
const memberApp = fs.readFileSync(path.join(root, 'member/app.js'), 'utf8');
const profile = (id = 'LINE_TEST_A') => ({ lineUserId: id, profileComplete: true, membershipRequired: false });
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));

async function page({ surface = 'member', saved = {}, now = '2026-09-27T15:59:00Z', missing = '', testSession = false, query = '' } = {}) {
  const html = fs.readFileSync(path.join(root, surface, 'index.html'), 'utf8');
  const suffix = query ? `?${String(query).replace(/^\?/, '')}` : '';
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: `https://example.test/${surface}/${suffix}` });
  const w = dom.window;
  await new Promise((resolve) => w.addEventListener('load', resolve, { once: true }));
  Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle });
  w.TextEncoder = TextEncoder;
  w.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new Date(now).getTime(); }
  };
  if (testSession) w.TestModeClient = { getSessionToken: () => 'test-session' };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  const view = w.document.querySelector('main[data-user-tour]');
  view.classList.remove('hidden');
  if (missing) w.document.querySelector(missing)?.remove();
  for (const [key, value] of Object.entries(saved)) w.localStorage.setItem(key, value);
  w.eval(script);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const ready = async (id = 'LINE_TEST_A') => {
    const eventName = surface === 'member' ? 'member-profile-ready' : 'user-tour:ready';
    w.dispatchEvent(new w.CustomEvent(eventName, { detail: { surface, profile: profile(id) } }));
    await tick();
  };
  return { dom, w, ready, dialog: w.document.getElementById('memberTourDialog') };
}

test('tour opens on every visit; today skip ends at Taipei midnight; manual completion clears skip', async () => {
  const first = await page();
  await first.ready();
  assert.equal(first.dialog.classList.contains('hidden'), false);
  assert.equal(first.w.document.getElementById('app').inert, true);
  assert.equal(first.w.document.getElementById('memberTourSkip').textContent, '今日略過');
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
  assert.equal(JSON.parse(Object.values(entries)[0]).source, 'explicit');
  assert.equal(JSON.parse(Object.values(entries)[0]).skippedAt, '2026-09-27T15:59:00.000Z');
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
  assert.equal(Object.keys(completed).length, 0);
  refreshed.dom.window.close();

  const reopened = await page({ saved: completed });
  await reopened.ready();
  assert.equal(reopened.dialog.classList.contains('hidden'), false);
  reopened.w.document.getElementById('memberTourSkip').click();
  const skipBeforeMidnight = Object.fromEntries(Object.entries(reopened.w.localStorage));
  reopened.dom.window.close();

  const tomorrow = await page({ saved: skipBeforeMidnight, now: '2026-09-27T16:00:00Z' });
  await tomorrow.ready();
  assert.equal(tomorrow.dialog.classList.contains('hidden'), false);
  tomorrow.dom.window.close();
});

test('only an explicit current-format daily skip suppresses auto-start', async () => {
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('LINE_TEST_A'))).toString('hex');
  const key = `member-tour:${hash}`;
  const completed = await page({ saved: { [key]: JSON.stringify({ version: 1, outcome: 'complete', completedAt: '2026-09-27T15:59:00Z' }) } });
  await completed.ready();
  assert.equal(completed.dialog.classList.contains('hidden'), false);
  completed.dom.window.close();

  const ambiguousOldSkip = { [key]: JSON.stringify({ version: 1, outcome: 'skip', completedAt: '2026-09-27T15:59:00Z' }) };
  const legacy = await page({ saved: ambiguousOldSkip });
  await legacy.ready();
  assert.equal(legacy.dialog.classList.contains('hidden'), false);
  legacy.dom.window.close();

  const explicitSkip = { [key]: JSON.stringify({ outcome: 'skip', source: 'explicit', skippedAt: '2026-09-27T15:59:00Z' }) };
  const today = await page({ saved: explicitSkip });
  await today.ready();
  assert.equal(today.dialog.classList.contains('hidden'), true);
  today.dom.window.close();

  const tomorrow = await page({ saved: explicitSkip, now: '2026-09-27T16:00:00Z' });
  await tomorrow.ready();
  assert.equal(tomorrow.dialog.classList.contains('hidden'), false);
  tomorrow.dom.window.close();
});

test('spotlight dims only outside the selected UI and moves the dialog away from its target', async () => {
  assert.match(styles, /\.member-tour-overlay\s*\{[^}]*background:\s*transparent/);
  assert.match(styles, /\.member-tour-mask\s*\{[^}]*background:\s*var\(--theme-overlay,\s*rgba\(7,\s*18,\s*14,\s*\.48\)\)/);
  assert.doesNotMatch(styles, /200vmax/);
  assert.match(styles, /#memberTourSkip[^{]*\{[^}]*background:\s*transparent/);
  const { dom, w, ready, dialog } = await page();
  const target = w.document.getElementById('memberPass');
  let top = 600;
  target.getBoundingClientRect = () => ({ left: 700, right: 900, top, bottom: top + 100 });
  dialog.getBoundingClientRect = () => ({ left: 614, right: 1004, height: 280 });
  await ready();
  for (let attempt = 0; attempt < 8 && !dialog.classList.contains('member-tour-dialog-top'); attempt += 1) await tick();
  assert.equal(dialog.classList.contains('member-tour-dialog-top'), true);
  assert.equal(w.document.getElementById('memberTourFocus').style.left, '695px');
  const masks = Object.fromEntries(
    Array.from(w.document.querySelectorAll('[data-member-tour-mask]'))
      .map((mask) => [mask.dataset.memberTourMask, mask])
  );
  assert.deepEqual(Object.keys(masks).sort(), ['bottom', 'left', 'right', 'top']);
  assert.equal(masks.top.style.height, '585px');
  assert.equal(masks.bottom.style.top, '715px');
  assert.equal(masks.left.style.width, '685px');
  assert.equal(masks.left.style.height, '130px');
  assert.equal(masks.right.style.left, '915px');
  assert.equal(masks.right.style.height, '130px');
  top = 60;
  w.dispatchEvent(new w.Event('scroll'));
  assert.equal(dialog.classList.contains('member-tour-dialog-top'), false);
  assert.equal(masks.top.style.height, '45px');
  assert.equal(masks.bottom.style.top, '175px');
  dom.window.close();
});

test('account isolation, missing anchor, keyboard escape and focus return', async () => {
  const { dom, w, ready, dialog } = await page({ missing: '#membershipProgress' });
  await ready();
  w.document.getElementById('memberTourNext').click();
  assert.match(dialog.textContent, /確認個人資料/);
  w.document.getElementById('memberTourOverlay').click();
  assert.equal(dialog.classList.contains('hidden'), false);
  assert.equal(w.localStorage.length, 0);
  const escape = new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  dialog.dispatchEvent(escape);
  assert.equal(dialog.classList.contains('hidden'), true);
  assert.equal(w.localStorage.length, 0);
  assert.equal(w.document.activeElement.id, 'openMemberTour');
  await ready('LINE_TEST_B');
  assert.equal(dialog.classList.contains('hidden'), false);
  assert.equal(Object.keys(w.localStorage).length, 0);
  const backwardsTab = new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  dialog.dispatchEvent(backwardsTab);
  assert.equal(w.document.activeElement.id, 'memberTourNext');
  w.document.getElementById('memberTourSkip').click();
  assert.equal(Object.keys(w.localStorage).length, 1);
  dom.window.close();
});

test('tour keeps waiting until the member view becomes visible, even after a slow login transition', async () => {
  const { dom, w, ready, dialog } = await page();
  w.document.querySelector('main[data-user-tour]').classList.add('hidden');
  await ready();
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(dialog.classList.contains('hidden'), true);
  w.document.querySelector('main[data-user-tour]').classList.remove('hidden');
  await tick();
  assert.equal(dialog.classList.contains('hidden'), false);
  dom.window.close();
});

test('member app announces tour readiness only after the member view is shown', () => {
  assert.match(memberApp, /setView\('member'\);\s*announceTourReady\(state\.profile\);/);
  assert.match(memberApp, /renderProfile\(profile\);\s*setView\('member'\);\s*announceTourReady\(profile\);/);
  const renderProfileBody = memberApp.match(/function renderProfile\(profile\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.doesNotMatch(renderProfileBody, /member-profile-ready/);
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

test('every member client has a daily skip and manual replay button', async () => {
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
    assert.equal(current.w.document.getElementById('memberTourSkip').textContent, '今日略過');
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
  const sameDay = await page({ surface: 'booking', saved });
  await sameDay.ready();
  assert.equal(sameDay.dialog.classList.contains('hidden'), true);
  sameDay.dom.window.close();
  const nextDay = await page({ surface: 'booking', saved, now: '2026-09-27T16:00:00Z' });
  await nextDay.ready();
  assert.equal(nextDay.dialog.classList.contains('hidden'), false);
  nextDay.dom.window.close();
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

test('test accounts auto-start the same tutorial as real members', async () => {
  const current = await page({ surface: 'booking', testSession: true });
  await current.ready();
  assert.equal(current.dialog.classList.contains('hidden'), false);
  assert.match(current.dialog.textContent, /確認會員階級/);
  current.dom.window.close();
});

test('paired E2E always receives the tutorial so the runner can validate and dismiss it without persisting a skip', async () => {
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('LINE_TEST_A'))).toString('hex');
  const key = `user-tour:booking:${hash}`;
  const current = await page({
    surface: 'booking',
    testSession: true,
    query: 'qaPair=run-1&e2eParticipant=1',
    saved: {
      [key]: JSON.stringify({ outcome: 'skip', source: 'explicit', skippedAt: '2026-09-27T15:59:00Z' })
    }
  });
  await current.ready();
  assert.equal(current.dialog.classList.contains('hidden'), false);
  current.dialog.dispatchEvent(new current.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await tick();
  assert.equal(current.dialog.classList.contains('hidden'), true);
  assert.equal(JSON.parse(current.w.localStorage.getItem(key)).source, 'explicit');
  current.dom.window.close();
});
