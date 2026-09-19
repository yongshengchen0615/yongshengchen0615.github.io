const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = (path) => fs.readFileSync(path, 'utf8');

const adminHtml = read('MemberWebsocket-dev/admin/index.html');
const eventHtml = read('MemberWebsocket-dev/event/index.html');
const eventApp = read('MemberWebsocket-dev/event/app.js');
const calendarSync = read('MemberWebsocket-dev/admin/grant-automation.js');
const adminApp = read('MemberWebsocket-dev/admin/app.js');
const fixedTicketAdmin = read('MemberWebsocket-dev/admin/fixed-ticket-admin.js');

assert.equal(fs.existsSync('MemberWebsocket-dev/admin/event-ticket-activity-link.js'), false);
assert.equal(fs.existsSync('MemberWebsocket-dev/event/activity-link.js'), false);

for (const asset of [
  'fixed-ticket-admin-integration.js?v=fixed-ticket-sync-20260916-1',
  'fixed-ticket-calendar-option.js?v=fixed-ticket-calendar-20260917-4',
  'fixed-ticket-admin.js?v=fixed-ticket-unified-session-20260919-1',
]) assert.ok(adminHtml.includes(asset), asset);

assert.ok(adminHtml.includes('fixed-ticket-admin.css?v=fixed-ticket-20260916-1'));
assert.ok(!adminHtml.includes('event-ticket-activity-link.js'));

assert.ok(eventHtml.includes('app.js?v=event-single-render-20260919-1'));
assert.ok(!eventHtml.includes('activity-link.js'));
assert.ok(eventApp.includes("type.textContent = fixed ? '固定票券'"));
assert.ok(eventApp.includes("fixed ? '發放方式' : '領取方式'"));
assert.ok(eventApp.includes('系統自動發放'));
assert.ok(eventApp.includes('normalizeFixedOffers'));
assert.ok(eventApp.includes('autoOpenFromCalendar'));
assert.ok(eventApp.includes("source') !== 'event-ticket-calendar'"));

assert.ok(calendarSync.includes("url.searchParams.set('source', 'event-ticket-calendar')"));
assert.ok(calendarSync.includes("url.searchParams.set('eventTicketId'"));

console.log('event ticket fixed-ticket rendering is integrated into current entrypoints');

assert.ok(adminApp.includes("dataset.memberAdminReady = 'true'"));
assert.ok(adminApp.includes("new Event('member-admin-ready')"));
assert.ok(adminApp.includes("new Event('member-admin-event-ticket-list-rendered')"));
assert.ok(fixedTicketAdmin.includes("window.addEventListener('member-admin-ready', loadTemplates, { once: true })"));
assert.ok(fixedTicketAdmin.includes("window.addEventListener('member-admin-event-ticket-list-rendered', renderFixedList)"));
assert.ok(!fixedTicketAdmin.includes("new MutationObserver(() => {"));
assert.ok(!fixedTicketAdmin.includes("for (let attempt = 0; attempt < 80; attempt += 1)"));
