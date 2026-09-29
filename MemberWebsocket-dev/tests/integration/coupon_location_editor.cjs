const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

const root = join(__dirname, '../..');
const dom = new JSDOM(readFileSync(join(root, 'admin/index.html'), 'utf8'), {
  url: 'https://example.test/admin/', runScripts: 'outside-only',
});
const { window } = dom;
window.eval(readFileSync(join(root, 'admin/coupon-location-editor.js'), 'utf8'));
const editor = window.CouponLocationEditor;
editor.init();
const $ = (id) => window.document.getElementById(id);
assert.ok($('eventTicketForm').contains($('eventTicketLocationMap')), 'map must stay inside ticket form');
$('eventTicketRequiresLocation').checked = true;
$('eventTicketRequiresLocation').dispatchEvent(new window.Event('change'));
assert.equal($('eventTicketLocationControls').classList.contains('hidden'), false);
editor.set([
  { name: '台北', latitude: 25.033964, longitude: 121.564468, radiusMeters: 150 },
  { name: '台中', latitude: 24.147736, longitude: 120.673648, radiusMeters: 100 },
]);
assert.equal(editor.get().length, 2);
assert.equal($('eventTicketLocationRows').querySelectorAll('.coupon-location-row').length, 2);
$('eventTicketLocationRows').querySelector('input').value = '台北門市';
$('eventTicketLocationRows').querySelector('input').dispatchEvent(new window.Event('input'));
assert.equal(editor.get()[0].name, '台北門市');
$('eventTicketLocationRows').querySelectorAll('.coupon-location-row')[1].querySelector('button:last-child').click();
assert.deepEqual(editor.get().map((place) => place.name), ['台北門市']);
editor.set([]);
assert.equal($('eventTicketLocationCount').textContent, '0 / 20 個使用地點');
console.log('coupon location editor: passed');
