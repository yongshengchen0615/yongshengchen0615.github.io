const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'admin', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'admin', 'styles.css'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase', 'functions', 'api', 'index.ts'), 'utf8');

test('member directory exposes a records action beside existing actions', () => {
  assert.match(app, /actionButton\('紀錄', 'view-records'/);
  assert.match(app, /button\.dataset\.action === 'view-records'/);
  assert.match(html, /id="memberRecordsModal"/);
});

test('member records modal contains all requested activity categories', () => {
  for (const filter of ['pointCards', 'eventTickets', 'calendar', 'bookings']) {
    assert.ok(html.includes('data-record-filter="' + filter + '"'), filter);
  }
  assert.match(app, /admin\.member-records\.list/);
  assert.match(css, /\.member-records-modal-card/);
});

test('admin member records API stays behind existing admin authorization boundary', () => {
  const authorizePosition = api.indexOf('const admin = await authorizeAdmin(supabase,identity);');
  const routePosition = api.indexOf('action === "admin.member-records.list"');
  assert.ok(authorizePosition >= 0);
  assert.ok(routePosition > authorizePosition);
  assert.match(api, /\.eq\("is_test_account",false\)/);
});

test('member records use existing domain history without fabricating calendar views', () => {
  assert.match(api, /from\("point_entries"\)/);
  assert.match(api, /from\("point_tickets"\)/);
  assert.match(api, /from\("event_ticket_claims"\)/);
  assert.match(api, /from\("bookings"\)/);
  assert.match(api, /from\("calendar_items"\).*source_event_ticket_id/s);
  assert.match(api, /calendarTracking:"linked_records_only"/);
  assert.match(html, /不記錄會員開啟或點擊日曆的瀏覽行為/);
});

test('booking participant positions remain one-based in record display', () => {
  assert.match(app, /Math\.max\(1, Number\(participant\.position \|\| 1\)\)/);
  assert.doesNotMatch(app, /Number\(participant\.position \|\| 0\) \+ 1/);
});
