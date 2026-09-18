const fs = require('node:fs');
const assert = require('node:assert/strict');

const core = fs.readFileSync('MemberWebsocket-dev/admin/booking-panel-core.js', 'utf8');
const resources = fs.readFileSync('MemberWebsocket-dev/admin/booking-resources.js', 'utf8');
const css = fs.readFileSync('MemberWebsocket-dev/admin/booking-panel.css', 'utf8');

for (const label of ['技師設定', '預約項目', '預約共用設定', '用戶預約']) {
  assert.ok(core.includes('>' + label), 'missing booking subtab: ' + label);
}
assert.ok(!core.includes('>預約確認<'), 'legacy 預約確認 title should be removed');
assert.match(core, /bookingAdminTechniciansSubtab/);
assert.match(core, /bookingAdminSettingsSubtab/);
assert.match(core, /bookingAdminTechniciansPanel/);
assert.match(core, /bookingAdminSettingsPanel/);
assert.ok(core.indexOf('項目類型') < core.indexOf('bookingAdminTypeList'));
assert.ok(core.indexOf('bookingAdminTypeList') < core.indexOf('bookingAdminServiceList'));
assert.match(core, /const allowed = \['technicians', 'services', 'settings', 'queue'\]/);
assert.match(resources, /getElementById\('bookingAdminTechnicianMount'\)/);
assert.doesNotMatch(resources, /booking-admin-hours-card/);
assert.match(css, /booking admin four-tab layout 20260918/);
assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);

console.log('booking admin four-tab layout OK');
