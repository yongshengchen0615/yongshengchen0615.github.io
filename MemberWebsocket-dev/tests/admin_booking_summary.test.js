const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = (path) => fs.readFileSync(path, 'utf8');

const loader = read('MemberWebsocket-dev/admin/booking-panel.js');
const summary = read('MemberWebsocket-dev/admin/booking-summary.js');
const styles = read('MemberWebsocket-dev/admin/booking-summary.css');

assert.match(loader, /booking-summary\.css/);
assert.match(loader, /booking-summary\.js/);
assert.match(loader, /booking-summary-20260912-4/);
assert.ok(loader.indexOf("load('booking-summary.js'") < loader.indexOf("load('booking-panel-core.js'"));
assert.match(summary, /booking-contact-api/);
assert.match(summary, /admin\.booking\.contacts/);
assert.match(summary, /contactSurname/);
assert.match(summary, /contactSalutation/);
assert.match(summary, /contactPhone/);
assert.match(summary, /return `\$\{surname\}\$\{label\}`/);
assert.match(summary, /複製預約內容/);
assert.match(summary, /navigator\.clipboard\.writeText/);
assert.match(summary, /document\.execCommand\('copy'\)/);
assert.match(summary, /STORE_SERVICE_ID/);
assert.match(summary, /booking-admin-item-list/);
assert.match(summary, /formatBookingDate/);
assert.match(summary, /WEEKDAY_LABELS/);
assert.match(summary, /renderImmediateSummaries/);
assert.match(summary, /legacyBookingFromCard/);
assert.match(summary, /booking-summary-provisional/);
assert.match(summary, /bookingMemberCode/);
assert.match(summary, /bookingStartTime/);
assert.doesNotMatch(summary, /markCardsPending/);
assert.doesNotMatch(summary, /showLegacyFallback/);
assert.match(styles, /booking-received-summary/);
assert.match(styles, /booking-copy-button/);
assert.match(styles, /booking-summary-normalized/);
assert.doesNotMatch(styles, /正在載入預約內容/);
assert.match(styles, /min-height: 44px/);

console.log('admin booking summary/copy/immediate-render wiring OK');
