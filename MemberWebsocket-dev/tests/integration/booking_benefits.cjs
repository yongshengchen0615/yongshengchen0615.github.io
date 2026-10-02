const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '../..');
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(load) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'booking/index.html'), 'utf8'), { url: 'https://example.test/MemberWebsocket-dev/booking/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.BookingSystem = { bookingBenefits: load };
  w.eval(fs.readFileSync(path.join(root, 'booking/booking-benefits.js'), 'utf8'));
  const el = id => w.document.getElementById(id);
  return { w, el, close: () => w.close(), start: () => w.BookingBenefits.start({}, 'fixture') };
}
const items = [
  { kind: 'points', id: 'reward', selectionId: 'PT-001', selectable: true, title: '集點券', statusLabel: '可使用', conditionLabel: '服務限制：目前未設定' },
  { kind: 'event', id: 'EVENT', selectionId: '', selectable: false, disabledReason: '請先領取票券後再於預約中選用', title: '<img src=x onerror=alert(1)>', statusLabel: '可領取', conditionLabel: '服務限制：目前未設定' },
  { kind: 'calendar', id: 'CAL', selectionId: 'CAL', selectable: true, title: '會員活動', statusLabel: '活動進行中', conditionLabel: '會員條件：目前會員階級適用 · 服務限制：目前未設定' },
];

test('0/1/N benefit cards render safely inside booking form and expose only eligible selectors', async () => {
  for (const count of [0, 1, 3]) {
    let calls = 0;
    const h = fixture(async () => { calls++; return { items: items.slice(0, count) }; });
    try {
      h.start(); await tick(10);
      assert.equal(h.el('bookingBenefitsList').querySelectorAll('.booking-benefit').length, count);
      assert.equal(h.el('bookingBenefits').dataset.state, count ? 'ready' : 'empty');
      assert.equal(h.el('bookingBenefitsList').getAttribute('aria-busy'), 'false');
      assert.equal(h.el('bookingBenefits').closest('form')?.id, 'bookingForm');
      const note = h.el('memberNote');
      assert.ok(h.el('bookingBenefits').compareDocumentPosition(note) & h.w.Node.DOCUMENT_POSITION_FOLLOWING);
      assert.equal(h.el('bookingBenefitsList').querySelector('img'), null);
      const links = h.el('bookingBenefitsList').querySelectorAll('a');
      assert.ok([...links].every(link => link.textContent === '查看詳情' && new URL(link.href).origin === 'https://example.test'));
      if (count === 3) {
        const groupKinds = [...h.el('bookingBenefitsList').querySelectorAll('.booking-benefit-group')]
          .map(group => group.dataset.benefitKind);
        assert.deepEqual(groupKinds, ['calendar', 'points', 'event']);
        const eventLink = [...links].find(link => /eventTicketId=EVENT/.test(link.href));
        assert.ok(eventLink, 'event benefit keeps its canonical detail link');
        assert.match(h.el('bookingBenefitsList').textContent, /服務限制：目前未設定/);
        const checkboxes = h.el('bookingBenefitsList').querySelectorAll('input[type="checkbox"]');
        assert.equal(checkboxes.length, 2, 'only precise selectable benefit references get checkboxes');
        const pointCheckbox = h.el('bookingBenefitsList').querySelector(
          'input[data-booking-benefit-kind="points"][data-booking-benefit-id="PT-001"]'
        );
        assert.ok(pointCheckbox);
        pointCheckbox.click();
        assert.equal(JSON.stringify(h.w.BookingBenefits.selectionPayload()), JSON.stringify([{ kind: 'points', id: 'PT-001' }]));
      }
      assert.equal(calls, 1, 'rendering and selection do not claim/redeem or start extra requests');
    } finally { h.close(); }
  }
});

test('slow/error recommendation API leaves booking interactions usable and supports retry', async () => {
  let reject;
  const h = fixture(() => new Promise((_resolve, fail) => { reject = fail; }));
  try {
    let booked = false;
    h.el('submitBookingButton').disabled = false;
    h.el('bookingForm').addEventListener('submit', event => { event.preventDefault(); booked = true; });
    h.start();
    assert.equal(h.el('bookingBenefits').dataset.state, 'loading');
    h.el('submitBookingButton').click();
    assert.equal(booked, true, 'booking proceeds while recommendation request hangs');
    reject(new Error('weak network')); await tick(10);
    assert.equal(h.el('bookingBenefits').dataset.state, 'error');
    assert.match(h.el('bookingBenefitsStatus').textContent, /仍可正常預約/);
    h.w.BookingSystem.bookingBenefits = async () => ({ items: [] });
    h.el('bookingBenefitsRetry').click(); await tick(10);
    assert.equal(h.el('bookingBenefits').dataset.state, 'empty');
  } finally { h.close(); }
});

test('realtime invalidation drops used tickets, coalesces storms and ignores stale responses', async () => {
  let resolveFirst, calls = 0;
  const h = fixture(() => {
    calls++;
    return calls === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve({ items: [] });
  });
  try {
    h.start();
    for (let i = 0; i < 20; i++) h.w.BookingBenefits.invalidate();
    resolveFirst({ items }); await tick(10);
    assert.equal(h.el('bookingBenefitsList').querySelectorAll('.booking-benefit').length, 0, 'stale inventory must never render');
    await tick(500);
    assert.equal(calls, 2);
    assert.equal(h.el('bookingBenefits').dataset.state, 'empty');
    h.w.BookingSystem.bookingBenefits = async () => ({ items });
    h.w.BookingBenefits.invalidate(); await tick(500);
    assert.equal(h.el('bookingBenefitsList').querySelectorAll('.booking-benefit').length, 3);
    h.w.BookingSystem.bookingBenefits = async () => ({ items: [] });
    h.w.BookingBenefits.invalidate();
    assert.equal(h.el('bookingBenefitsList').querySelectorAll('.booking-benefit').length, 0, 'old tickets disappear as soon as invalidated');
    await tick(500);
    assert.equal(h.el('bookingBenefits').dataset.state, 'empty');
  } finally { h.close(); }
});
