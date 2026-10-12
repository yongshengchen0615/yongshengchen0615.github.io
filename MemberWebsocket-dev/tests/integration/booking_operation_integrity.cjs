const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { PGlite } = require('@electric-sql/pglite');
const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
const bookingId = '30000000-0000-4000-8000-000000000001';
const serviceId = '20000000-0000-4000-8000-000000000001';
const version = '2026-10-12T00:00:00.000Z';

function bookingFixture() {
  const dom = new JSDOM(read('booking/index.html'), { runScripts: 'outside-only', url: 'https://example.test/booking/', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false });
  w.HTMLElement.prototype.scrollIntoView = () => {};
  const booking = { bookingId, updatedAt: version, status: 'confirmed', bookingDate: '2099-01-01', startTime: '09:00', endTime: '10:00', items: [{ serviceId, serviceTitle: '測試服務', quantity: 1 }] };
  const base = { today: '2026-10-12', settings: { minAdvanceDays: 0, workStartTime: '09:00', workEndTime: '18:00' }, services: [{ serviceId, title: '測試服務', durationMinutes: 60, priceAmount: 100, isActive: true }], bookings: [booking] };
  w.BookingSystem = {
    loadConfig: async () => ({ supabaseUrl: 'https://fixture.supabase.co', supabasePublishableKey: 'fixture-key' }), signIn: async () => 'fixture-token',
    memberProfile: async () => ({}), subscribeRealtime: () => () => {}, formatDate: date => date,
    addDays: (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10),
    request: async () => structuredClone(base), clientError: (code, message) => Object.assign(new Error(message), { code }),
  };
  return { dom, w, booking, base };
}

test('uncertain retry keeps its request ID only for the same complete draft', async () => {
  const h = bookingFixture(), { w } = h;
  const writes = [];
  let context = { participants: [{ technicianId: 'a', items: [{ serviceId, quantity: 1 }] }], contactSource: 'custom', contactPhone: '0912345678', serviceRecipientMemberCode: '' };
  w.BookingGroupUI = { writeContext: () => structuredClone(context) };
  w.BookingSystem.request = async (_config, _type, _token, action, payload) => {
    if (action === 'user.booking.bootstrap') return structuredClone(h.base);
    writes.push(payload);
    throw Object.assign(new Error('送出結果不明'), { code: 'API_RESPONSE_UNCERTAIN' });
  };
  w.eval(read('booking/app.js').replace(/\}\)\(\);\s*$/, 'window.__fixture = { state, confirmBooking }; })();'));
  try {
    await tick();
    const s = w.__fixture.state;
    s.selections = [{ serviceId, selectionId: 'one' }];
    s.selectedSlot = { startTime: '09:00', endTime: '10:00' };
    w.document.getElementById('bookingDate').value = '2099-01-01';
    await w.__fixture.confirmBooking();
    await w.__fixture.confirmBooking();
    assert.equal(writes[0].requestId, writes[1].requestId);
    for (const change of [
      () => { context.participants[0].technicianId = 'b'; },
      () => { context.contactPhone = '0987654321'; },
      () => { context.serviceRecipientMemberCode = 'FRIEND'; },
      () => { context.participants.push({ technicianId: 'c', items: [{ serviceId, quantity: 2 }] }); },
    ]) {
      change(); await w.__fixture.confirmBooking();
      assert.notEqual(writes.at(-1).requestId, writes.at(-2).requestId);
    }
    assert.match(w.document.getElementById('bookingConfirmMessage').textContent, /無法確認/);
  } finally { w.close(); }
});

test('realtime group bootstrap preserves technician draft and write context matches it', async () => {
  const h = bookingFixture(), { w } = h;
  const techA = '40000000-0000-4000-8000-000000000001', techB = '40000000-0000-4000-8000-000000000002';
  w.fetch = async () => new Response(JSON.stringify({ ok: true, data: { settings: { maxPartySize: 2, primaryTechnicianId: techA, requirePrimaryTechnician: false }, technicians: [{ technicianId: techA, name: '甲', isActive: true }, { technicianId: techB, name: '乙', isActive: true }], bookingGroups: {} } }));
  w.eval(read('booking/group-booking.js'));
  try {
    await tick();
    await w.BookingSystem.request({}, 'member', 'fixture-token', 'user.booking.bootstrap');
    const select = w.document.querySelector('.participant-card select');
    assert.ok(select);
    select.value = techB; select.dispatchEvent(new w.Event('change'));
    const items = [{ serviceId, quantity: 1 }];
    assert.equal(w.BookingGroupUI.writeContext(items).participants[0].technicianId, techB);
    await w.BookingSystem.request({}, 'member', 'fixture-token', 'user.booking.bootstrap');
    assert.equal(w.document.querySelector('.participant-card select').value, techB);
    assert.equal(w.BookingGroupUI.writeContext(items).participants[0].technicianId, techB);
  } finally { w.close(); }
});

test('contact-only booking transport preserves uncertain-write classification and context', async () => {
  const h = bookingFixture(), { w } = h;
  w.fetch = async () => { throw new TypeError('fixture connection lost'); };
  w.eval(read('booking/contact-details.js'));
  try {
    await tick();
    w.document.querySelector('input[name="bookingContactSource"][value="custom"]').checked = true;
    w.document.getElementById('bookingContactSurname').value = '測試';
    w.document.getElementById('bookingContactSalutation').value = 'mr';
    w.document.getElementById('bookingContactPhone').value = '0912345678';
    assert.equal(w.BookingContactUI.writeContext().contactSource, 'custom');
    await assert.rejects(w.BookingSystem.request({}, 'member', 'fixture-token', 'user.booking.create', {}), { code: 'API_RESPONSE_UNCERTAIN' });
  } finally { w.close(); }
});

test('member cancellation forwards the rendered version, locks repeat clicks and shows history feedback', async () => {
  const h = bookingFixture(), { w } = h;
  const calls = [];
  let release;
  w.confirm = () => true;
  w.MembershipProgress = { render() {} };
  w.fetch = async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    if (body.action === 'member.request') await new Promise(resolve => { release = resolve; });
    return new Response(JSON.stringify({ ok: true, data: { request: { cancellationRequestedAt: version }, requests: [] } }));
  };
  w.eval(read('booking/member-ui.js'));
  w.eval(read('booking/app.js'));
  try {
    await tick();
    const button = [...w.document.querySelectorAll('.booking-item button')].find(node => node.textContent === '申請取消');
    assert.ok(button); button.click();
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute('aria-busy'), 'true');
    button.click();
    assert.equal(calls.filter(call => call.action === 'member.request').length, 1);
    assert.equal(calls.find(call => call.action === 'member.request').expectedUpdatedAt, version);
    release(); await tick();
    const message = w.document.getElementById('bookingHistoryMessage');
    assert.match(message.textContent, /已送出取消申請/);
    assert.equal(message.closest('form'), null);
  } finally { w.close(); }
});

test('admin lifecycle feedback remains in queue and duplicate actions cannot submit while pending', async () => {
  const dom = new JSDOM(read('admin/index.html'), { runScripts: 'outside-only', url: 'https://example.test/admin/' });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false });
  w.MemberAdminSession = { wait: () => new Promise(() => {}) };
  const source = read('admin/booking-panel-core.js').replace(/\}\)\(\);\s*$/, 'window.__fixture = { state, els, mount, runPageAction, lockOperationControls }; })();');
  w.eval(source);
  try {
    w.__fixture.mount();
    const { state, els, runPageAction } = w.__fixture;
    assert.ok(els.bookingAdminQueueMessage);
    assert.equal(els.bookingAdminQueueMessage.closest('[role="tabpanel"]').id, 'bookingAdminStandardQueueView');
    let release, writes = 0;
    const pending = runPageAction(els.bookingAdminQueueMessage, async () => { writes++; await new Promise(resolve => { release = resolve; }); throw Object.assign(new Error('版本已更新'), { code: 'TEST_REFUSAL' }); });
    assert.equal(state.busy, true);
    assert.equal(els.bookingAdminQueueSubtab.disabled, true);
    assert.match(els.bookingAdminQueueMessage.textContent, /正在處理/);
    await runPageAction(els.bookingAdminQueueMessage, async () => { writes++; });
    assert.equal(writes, 1);
    release(); await pending;
    assert.equal(state.busy, false);
    assert.equal(els.bookingAdminQueueSubtab.disabled, false);
    assert.equal(els.bookingAdminQueueMessage.textContent, '版本已更新');
    assert.equal(els.bookingAdminQueueMessage.getAttribute('aria-live'), 'polite');
  } finally { w.close(); }
});

test('receipt ACL migration denies public-role operations and keeps service-role workflow functional', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table booking_receipts(id integer primary key); create table booking_receipt_cleanup_queue(id integer primary key);
      alter table booking_receipts enable row level security; alter table booking_receipt_cleanup_queue enable row level security;
      grant all on booking_receipts, booking_receipt_cleanup_queue to anon, authenticated, service_role;
      insert into booking_receipts values (1); insert into booking_receipt_cleanup_queue values (1);`);
    await db.exec(read('supabase/migrations/20261012095506_booking_receipt_least_privilege.sql'));
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      for (const table of ['booking_receipts', 'booking_receipt_cleanup_queue']) {
        for (const query of ['select * from ' + table, 'truncate ' + table, 'insert into ' + table + ' values (2)']) await assert.rejects(db.exec(query), /permission denied/);
      }
      await db.exec('reset role');
    }
    await db.exec('set role service_role; insert into booking_receipts values (2); delete from booking_receipt_cleanup_queue where id=1;');
    assert.equal((await db.query('select count(*)::int n from booking_receipts')).rows[0].n, 2);
    await db.exec('reset role');
    await db.exec(read('supabase/migrations/20261012095506_booking_receipt_least_privilege.sql'));
  } finally { await db.close(); }
});
