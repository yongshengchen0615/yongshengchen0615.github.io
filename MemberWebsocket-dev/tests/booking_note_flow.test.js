const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('member note is displayed, submitted and hydrated across booking flows', () => {
  const app = read('booking/app.js');
  const group = read('booking/group-booking.js');
  const bookingApi = read('supabase/functions/booking-api/index.ts');
  const groupApi = read('supabase/functions/booking-group-api/index.ts');
  const admin = read('admin/booking-panel-core.js');

  assert.match(app, /memberNote: els\.memberNote\.value/);
  assert.match(app, /els\.memberNote\.value = booking\.memberNote \|\| ''/);
  assert.match(app, /note\.textContent = `備註：\$\{booking\.memberNote\}`/);
  assert.match(group, /\.\.\.payload,[\s\S]*participants/);

  assert.match(bookingApi, /memberNote: row\.member_note \|\| ""/);
  assert.match(bookingApi, /adminNote: row\.admin_note \|\| ""/);
  assert.match(bookingApi, /p_member_note: memberNote/);
  assert.match(bookingApi, /p_member_note: asText\(body\.memberNote, 500\)/);

  assert.match(groupApi, /memberNote:r\.member_note\|\|""/);
  assert.match(groupApi, /adminNote:r\.admin_note\|\|""/);
  assert.match(groupApi, /p_member_note:asText\(body\.memberNote,500\)/);

  assert.match(admin, /會員備註：\$\{booking\.memberNote\}/);
  assert.match(admin, /管理端說明：\$\{booking\.adminNote\}/);
  assert.match(admin, /adminNote \}, true\)/);
});

test('booking note columns are bounded and notification migration sends both note types', () => {
  const bookingApi = read('supabase/functions/booking-api/index.ts');
  const groupApi = read('supabase/functions/booking-group-api/index.ts');
  const migration = read('supabase/migrations/20260918140535_booking_notification_notes.sql');

  assert.match(bookingApi, /asText\(body\.memberNote, 500\)/);
  assert.match(bookingApi, /asText\(body\.adminNote, 500\)/);
  assert.match(groupApi, /asText\(body\.memberNote,500\)/);

  assert.match(migration, /會員備註：/);
  assert.match(migration, /管理端說明：/);
  assert.match(migration, /latest\.member_note/);
  assert.match(migration, /latest\.admin_note/);
  assert.match(migration, /regexp_replace\(btrim\(latest\.member_note\), E'\[\\r\\n\]\+'/);
  assert.match(migration, /regexp_replace\(btrim\(latest\.admin_note\), E'\[\\r\\n\]\+'/);
});

test('LINE Flex transport parses note labels as standard booking detail fields', () => {
  const delivery = read('supabase/functions/booking-line-notifications/delivery.ts');
  const deliveryTest = read('supabase/functions/booking-line-notifications/delivery_test.ts');

  assert.match(delivery, /const separator = line\.indexOf\('：'\)/);
  assert.match(delivery, /fields\.push\(\{ label, value \}\)/);
  assert.match(deliveryTest, /會員備註：希望加強肩頸/);
  assert.match(deliveryTest, /管理端說明：已安排安靜區域/);
  assert.match(deliveryTest, /Flex body must include the member note/);
  assert.match(deliveryTest, /Flex body must include the admin note/);
});


test('confirmation modal always shows the booking note for single and group bookings', () => {
  const app = read('booking/app.js');
  const detailed = read('booking/booking-confirm-details.js');
  const formatter = read('booking/member-booking-format.js');
  const html = read('booking/index.html');

  assert.match(app, /note\.className = 'booking-confirm-note'/);
  assert.match(app, /note\.textContent = `預約備註：\$\{els\.memberNote\.value\.trim\(\) \|\| '未填寫'\}`/);

  assert.match(detailed, /noteBox\.className = 'group-confirm-participant booking-confirm-note'/);
  assert.match(detailed, /noteTitle\.textContent = '預約備註'/);
  assert.match(detailed, /note\.textContent = noteValue \|\| '未填寫'/);

  assert.match(formatter, /classList\?\.contains\('booking-confirm-note'\)/);
  assert.match(formatter, /summaryRow\('預約備註', confirmationNoteValue\(note\?\.textContent\)\)/);
  assert.match(formatter, /function confirmationNoteValue\(text\)/);
  assert.match(formatter, /\|\| '未填寫'/);

  assert.match(html, /app\.js\?v=booking-history-single-pass-20260918-1/);
  assert.match(html, /booking-confirm-details\.js\?v=booking-confirm-note-20260918-1/);
  assert.match(html, /member-booking-format\.js\?v=booking-history-single-pass-20260918-1/);
});
