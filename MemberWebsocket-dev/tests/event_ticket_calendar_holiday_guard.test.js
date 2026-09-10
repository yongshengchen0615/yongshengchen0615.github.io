const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = (path) => fs.readFileSync(path, 'utf8');

const adminFlow = read('MemberWebsocket-dev/admin/grant-automation.js');
const edge = read('MemberWebsocket-dev/supabase/functions/grant-automation/index.ts');

assert.match(adminFlow, /saved\.calendarSync/);
assert.match(adminFlow, /reason === 'holiday'/);
assert.match(adminFlow, /checkbox\.checked = false/);
assert.match(adminFlow, /活動期間遇到休假/);
assert.match(adminFlow, /自動取消加入日曆/);

assert.match(edge, /function isManagedEventTicketCalendarLink/);
assert.match(edge, /async function findActiveHolidayOverlap/);
assert.match(edge, /async function removeManagedEventTicketCalendarItems/);
assert.match(edge, /a\.start <= b\.end && a\.end >= b\.start/);
assert.match(edge, /\.eq\("item_type","holiday"\)\.eq\("status","active"\)/);
assert.match(edge, /reason:"holiday"/);
assert.match(edge, /admin\.calendar-items\.auto-delete-holiday-conflict/);
assert.match(edge, /row\.item_type !== "event"/);
assert.match(edge, /isManagedEventTicketCalendarLink\(existing\.data\.link_url\)/);
assert.match(edge, /\.delete\(\)\.in\("calendar_item_id",ids\)/);

console.log('event ticket calendar holiday guard wiring OK');
