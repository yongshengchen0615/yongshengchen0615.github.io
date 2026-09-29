const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { JSDOM } = require('jsdom');

const root = join(__dirname, '../..');

async function run() {
  const dom = new JSDOM(readFileSync(join(root, 'admin/index.html'), 'utf8'), {
    url: 'https://example.test/admin/', runScripts: 'outside-only',
  });
  const { window } = dom;
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition(success) {
        success({
          coords: { latitude: 22.997, longitude: 120.212, accuracy: 12 },
          timestamp: Date.now(),
        });
      },
    },
  });
  window.fetch = async () => ({
    ok: true,
    json: async () => [{ display_name: '台南火車站, 台南市', lat: '22.9971', lon: '120.2123' }],
  });

  window.eval(readFileSync(join(root, 'admin/coupon-location-editor.js'), 'utf8'));
  window.TicketLocationEditors.init();
  const editor = window.CouponLocationEditor;
  const templateEditor = window.TicketLocationEditors.template;
  const $ = (id) => window.document.getElementById(id);

  assert.ok($('eventTicketForm').contains($('eventTicketLocationMap')), 'event map must stay inside ticket form');
  assert.ok($('ticketForm').contains($('ticketLocationMap')), 'template map must stay inside ticket form');
  assert.ok($('eventTicketAddressSearch'), 'event ticket address search must exist');
  assert.ok($('ticketAddressSearch'), 'point-ticket template address search must exist');

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
  $('eventTicketUseCurrentLocationButton').click();
  assert.equal(editor.get().length, 1, 'GPS button must add the current position');
  assert.equal(editor.get()[0].name, '目前 GPS 位置');

  editor.set([]);
  $('eventTicketAddressSearch').value = '台南火車站';
  await editor.searchAddress();
  const searchResult = $('eventTicketAddressResults').querySelector('button');
  assert.ok(searchResult, 'address search must render a selectable result');
  searchResult.click();
  assert.equal(editor.get().length, 1);
  assert.match(editor.get()[0].name, /台南火車站/);

  $('ticketRequiresLocation').checked = true;
  $('ticketRequiresLocation').dispatchEvent(new window.Event('change'));
  templateEditor.set([{ name: '集點票券門市', latitude: 23.0, longitude: 120.2, radiusMeters: 120 }]);
  assert.equal(templateEditor.get().length, 1);
  assert.equal($('ticketLocationControls').classList.contains('hidden'), false);
  assert.equal($('ticketLocationCount').textContent, '1 / 20 個使用地點');

  console.log('all-ticket location editor: passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
