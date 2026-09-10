const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = (path) => fs.readFileSync(path, 'utf8');

const adminHtml = read('MemberWebsocket-dev/admin/index.html');
const eventHtml = read('MemberWebsocket-dev/event/index.html');
const adminLink = read('MemberWebsocket-dev/admin/event-ticket-activity-link.js');
const memberLink = read('MemberWebsocket-dev/event/activity-link.js');
const linkEdge = read('MemberWebsocket-dev/supabase/functions/event-ticket-links/index.ts');
const migration = read('MemberWebsocket-dev/supabase/migrations/20260910175251_add_event_ticket_activity_url.sql');
const calendarSync = read('MemberWebsocket-dev/admin/grant-automation.js');

assert.match(migration, /add column if not exists activity_url text not null default ''/);
assert.match(migration, /event_tickets_activity_url_check/);
assert.match(migration, /\^https:\/\//);
assert.match(migration, /char_length\(activity_url\) <= 2048/);

assert.match(linkEdge, /admin\.event-ticket-links\.save/);
assert.match(linkEdge, /user\.event-ticket-links\.list/);
assert.match(linkEdge, /verifyLineIdToken/);
assert.match(linkEdge, /authorizeAdmin/);
assert.match(linkEdge, /requireMember/);
assert.match(linkEdge, /EVENT_TICKET_ACTIVITY_URL_CHANGED/);
assert.match(linkEdge, /protocol !== "https:"/);
assert.match(linkEdge, /username \|\| parsed\.password/);
assert.doesNotMatch(linkEdge, /detail:\s*\{[^}]*activityUrl:/);

assert.match(adminLink, /id = 'eventTicketActivityUrl'/);
assert.match(adminLink, /admin\.event-ticket-links\.list/);
assert.match(adminLink, /admin\.event-ticket-links\.save/);
assert.match(adminLink, /expectedActivityUrl/);
assert.match(adminLink, /form\.addEventListener\('submit',[\s\S]*true\)/);
assert.match(adminLink, /僅接受 https:\/\//);

assert.match(memberLink, /user\.event-ticket-links\.list/);
assert.match(memberLink, /ticketModalActivityLink/);
assert.match(memberLink, /target = '_blank'/);
assert.match(memberLink, /rel = 'noopener noreferrer'/);
assert.match(memberLink, /source.*event-ticket-calendar/);
assert.match(memberLink, /autoOpenFromCalendar/);

assert.equal((adminHtml.match(/event-ticket-activity-link\.js/g) || []).length, 1);
assert.equal((eventHtml.match(/\.\/activity-link\.js/g) || []).length, 1);

// Calendar source identity must remain internal; replacing it with the external
// activity URL would break readonly/source cleanup and holiday behavior.
assert.match(calendarSync, /url\.searchParams\.set\('source', 'event-ticket-calendar'\)/);
assert.match(calendarSync, /url\.searchParams\.set\('eventTicketId'/);

console.log('event ticket activity link wiring/security OK');
