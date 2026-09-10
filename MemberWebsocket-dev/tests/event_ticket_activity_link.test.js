const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = (path) => fs.readFileSync(path, 'utf8');

const adminHtml = read('MemberWebsocket-dev/admin/index.html');
const eventHtml = read('MemberWebsocket-dev/event/index.html');
const adminLink = read('MemberWebsocket-dev/admin/event-ticket-activity-link.js');
const memberLink = read('MemberWebsocket-dev/event/activity-link.js');
const calendarSync = read('MemberWebsocket-dev/admin/grant-automation.js');

// The optional activity-link settings are retired from both admin and member UI.
assert.doesNotMatch(adminLink, /eventTicketActivityUrl/);
assert.doesNotMatch(adminLink, /eventTicketActivityLinkName/);
assert.doesNotMatch(adminLink, /admin\.event-ticket-links\.(?:list|save)/);
assert.doesNotMatch(adminLink, /連結名稱（選填）/);
assert.doesNotMatch(adminLink, /活動連結（選填）/);

assert.doesNotMatch(memberLink, /user\.event-ticket-links\.list/);
assert.doesNotMatch(memberLink, /ticketModalActivityLink/);
assert.doesNotMatch(memberLink, /activity-link-button/);
assert.doesNotMatch(memberLink, /target = '_blank'/);
assert.doesNotMatch(memberLink, /前往活動連結/);
assert.doesNotMatch(memberLink, /↗/);
assert.match(memberLink, /source.*event-ticket-calendar/);
assert.match(memberLink, /autoOpenFromCalendar/);

// Keep the compatibility script reference until the large admin HTML is next edited.
assert.equal((adminHtml.match(/event-ticket-activity-link\.js/g) || []).length, 1);
assert.equal((eventHtml.match(/\.\/activity-link\.js/g) || []).length, 1);
assert.doesNotMatch(eventHtml, /ticketModalActivityLink/);

// Calendar source identity still drives the internal ticket deep-link.
assert.match(calendarSync, /url\.searchParams\.set\('source', 'event-ticket-calendar'\)/);
assert.match(calendarSync, /url\.searchParams\.set\('eventTicketId'/);

console.log('event ticket retired activity-link settings guard OK');
