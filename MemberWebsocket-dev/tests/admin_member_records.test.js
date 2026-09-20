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
  for (const filter of ['presence', 'pointCards', 'eventTickets', 'calendar', 'bookings']) {
    assert.ok(html.includes('data-record-filter="' + filter + '"'), filter);
  }
  assert.match(app, /admin\.member-records\.list/);
  assert.match(css, /\.member-records-modal-card/);
});

test('open member records and directory presence refresh from realtime updates', () => {
  assert.match(app, /subscribeRealtime\(state\.config, 'admin', handleAdminRealtimeUpdate\)/);
  assert.match(app, /refreshOpenMemberRecords\(\)/);
  assert.match(app, /admin\.members\.presence\.list/);
  assert.match(app, /MEMBER_PRESENCE_POLL_MS = 15_000/);
  assert.match(html, />上線狀態<\/th>/);
  assert.match(css, /\.member-presence-pill\.online/);
  assert.match(css, /\.member-presence-pill\.offline/);
});

test('admin member records API stays behind existing admin authorization boundary', () => {
  const authorizePosition = api.indexOf('const admin = await authorizeAdmin(supabase,identity);');
  const routePosition = api.indexOf('action === "admin.member-records.list"');
  assert.ok(authorizePosition >= 0);
  assert.ok(routePosition > authorizePosition);
  assert.match(api, /select\("id,line_user_id,display_name,member_code,is_test_account"\)/);
});

test('member records include authenticated online and offline audit events', () => {
  assert.match(api, /const PRESENCE_ACTIONS = \[/);
  assert.match(api, /from\("audit_logs"\).*target_type.*member/s);
  assert.match(api, /presence:presenceRecords/);
  assert.match(api, /presence:presenceRecords\.length/);
  assert.match(app, /\['presence', '上／下線'\]/);
  assert.match(app, /會員下線/);
  assert.match(app, /會員上線/);
});

test('all member record sources invalidate admin realtime state', () => {
  const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260920145127_complete_member_record_realtime_invalidation.sql'), 'utf8');
  assert.match(migration, /event_ticket_claims/);
  assert.match(migration, /booking_completion_settlements/);
  assert.match(migration, /array\['event','admin'\]/);
  assert.match(migration, /array\['member','admin'\]/);
  assert.match(migration, /emit_realtime_invalidation/);
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
