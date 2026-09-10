const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = (path) => fs.readFileSync(path, 'utf8');

const adminPanel = read('MemberWebsocket-dev/admin/booking-panel.js');
const calendarFlow = read('MemberWebsocket-dev/booking/calendar-flow.js');
const adminApi = read('MemberWebsocket-dev/supabase/functions/booking-admin-api/index.ts');
const calendarApi = read('MemberWebsocket-dev/supabase/functions/booking-calendar-api/index.ts');
const migration = read('MemberWebsocket-dev/supabase/migrations/20260910235500_booking_notice_holiday_block.sql');

assert.match(adminPanel, /bookingAdminNotice/);
assert.match(adminPanel, /bookingNotice/);
assert.match(adminPanel, /admin\.booking\.settings\.save/);
assert.match(adminApi, /save_booking_shared_settings/);
assert.match(adminApi, /bookingNotice/);
assert.match(calendarApi, /calendar_items/);
assert.match(calendarApi, /item_type", "holiday/);
assert.match(calendarApi, /calendar_item_id,title,description,starts_on,ends_on,accent/);
assert.match(calendarApi, /accent: String\(row\.accent/);
assert.match(calendarApi, /bookingNotice/);
assert.match(calendarFlow, /holidaysByDate/);
assert.match(calendarFlow, /休假日，無法預約/);
assert.match(calendarFlow, /showHolidayNotice/);
assert.match(calendarFlow, /textContent = description/);
assert.match(calendarFlow, /accent: safeHolidayAccent\(raw\?\.accent\)/);
assert.match(calendarFlow, /applyHolidayAccent\(button, holidays\[0\]\?\.accent\)/);
assert.match(calendarFlow, /applyHolidayAccent\(item, holiday\.accent\)/);
assert.doesNotMatch(calendarFlow, /ackBookingHolidayButton/);
assert.doesNotMatch(calendarFlow, />知道了</);
assert.match(migration, /booking_notice/);
assert.match(migration, /prevent_booking_on_active_holiday/);
assert.match(migration, /BOOKING_HOLIDAY/);
assert.match(migration, /status = 'active'/);

console.log('booking notice/holiday wiring OK');
