const fs = require('node:fs');
const assert = require('node:assert/strict');

const resources = fs.readFileSync('MemberWebsocket-dev/admin/booking-resources.js', 'utf8');
const deleteExtension = fs.readFileSync('MemberWebsocket-dev/booking-technician-delete.js', 'utf8');
const loader = fs.readFileSync('MemberWebsocket-dev/admin/booking-panel.js', 'utf8');
const styles = fs.readFileSync('MemberWebsocket-dev/admin/booking-resources.css', 'utf8');

assert.match(resources, /bookingAdminTechnicianModal/);
assert.match(resources, /bookingAdminTechnicianDeleteConfirm/);
assert.match(resources, /function openNewTechnicianModal\(/);
assert.match(resources, /function openEditTechnicianModal\(/);
assert.match(resources, /function openDeleteTechnicianConfirm\(/);
assert.match(resources, /function deleteTechnicianRequest\(/);
assert.match(resources, /admin\.booking\.resources\.technician\.delete/);
assert.match(resources, /＋ 新增技師/);
assert.match(resources, /確認刪除技師/);
assert.doesNotMatch(resources, /window\.confirm/);

assert.doesNotMatch(loader, /booking-technician-delete\.js/);
assert.doesNotMatch(deleteExtension, /bookingAdminTechnicianForm/);
assert.match(deleteExtension, /form: 'technicianForm'/);

assert.match(styles, /booking-admin-technician-modal-card/);
assert.match(styles, /booking-admin-technician-delete-confirm/);

console.log('booking admin technician modal CRUD wiring OK');
