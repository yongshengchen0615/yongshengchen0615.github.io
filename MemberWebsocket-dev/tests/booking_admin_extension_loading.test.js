const fs = require('node:fs');
const assert = require('node:assert/strict');

const loader = fs.readFileSync('MemberWebsocket-dev/admin/booking-panel.js', 'utf8');
const technicianDelete = fs.readFileSync('MemberWebsocket-dev/booking-technician-delete.js', 'utf8');

assert.match(loader, /Promise\.allSettled\(preloadExtensions\.map/);
assert.doesNotMatch(loader, /\['booking-summary\.js'/);
assert.doesNotMatch(loader, /\['\.\.\/booking-admin-group-details\.js'/);
assert.match(loader, /booking-always-open\.js/);
assert.match(loader, /booking-cancellation-sync\.js/);
assert.match(loader, /booking-panel-core\.js/);
assert.match(loader, /booking-resources\.js/);
assert.doesNotMatch(loader, /booking-technician-delete\.js/);

const preloadIndex = loader.indexOf('Promise.allSettled');
const coreIndex = loader.indexOf("load('booking-panel-core.js'");
const resourcesIndex = loader.indexOf("['booking-resources.js'");
assert.ok(preloadIndex >= 0 && coreIndex > preloadIndex, 'booking extensions should preload before core');
assert.ok(resourcesIndex >= 0 && resourcesIndex < coreIndex, 'technician resource controls must preload independently of core');
assert.match(loader, /booking-technician-modal-20260918-1/);
assert.match(loader, /booking-settings-layout-20260918-1-max-advance-20260919-1/);

assert.match(technicianDelete, /const installAll = \(\) => surfaces\.forEach\(installSurface\)/);
assert.match(technicianDelete, /new MutationObserver\(installAll\)/);
assert.match(technicianDelete, /observer\.observe\(document\.documentElement/);

console.log('booking admin extension loading resilience OK');
