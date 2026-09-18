const fs = require('node:fs');
const assert = require('node:assert/strict');

const loader = fs.readFileSync('MemberWebsocket-dev/admin/booking-panel.js', 'utf8');
const technicianDelete = fs.readFileSync('MemberWebsocket-dev/booking-technician-delete.js', 'utf8');

assert.match(loader, /Promise\.allSettled\(preloadExtensions\.map/);
assert.match(loader, /booking-summary\.js/);
assert.match(loader, /booking-admin-group-details\.js/);
assert.match(loader, /booking-always-open\.js/);
assert.match(loader, /booking-cancellation-sync\.js/);
assert.match(loader, /booking-panel-core\.js/);
assert.match(loader, /booking-resources\.js/);
assert.match(loader, /booking-technician-delete\.js/);

const preloadIndex = loader.indexOf('Promise.allSettled');
const coreIndex = loader.indexOf("load('booking-panel-core.js'");
const resourcesIndex = loader.indexOf("load('booking-resources.js'");
const technicianDeleteIndex = loader.indexOf("load('../booking-technician-delete.js'");

assert.ok(preloadIndex >= 0 && coreIndex > preloadIndex, 'optional booking extensions should preload before core');
assert.ok(resourcesIndex > coreIndex, 'resource controls require the mounted booking core');
assert.ok(technicianDeleteIndex > resourcesIndex, 'technician delete should load after resource controls');

assert.match(technicianDelete, /const installAll = \(\) => surfaces\.forEach\(installSurface\)/);
assert.match(technicianDelete, /new MutationObserver\(installAll\)/);
assert.match(technicianDelete, /observer\.observe\(document\.documentElement/);

console.log('booking admin extension loading resilience OK');
