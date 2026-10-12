const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const root = join(__dirname, '..');
const read = relative => readFileSync(join(root, relative), 'utf8');

function setup(onPosition) {
  const events = [];
  let gpsCalls = 0;
  let policyCalls = 0;
  const window = {
    isSecureContext: true,
    BookingSystem: {
      getSession: () => ({ idToken: 'fixture', config: {} }),
      request: () => { policyCalls += 1; throw new Error('GPS must not depend on a policy fetch'); }
    },
    addEventListener() {},
    dispatchEvent(event) { events.push(event.detail); }
  };
  const document = { addEventListener() {} };
  const navigator = { geolocation: { getCurrentPosition(success, failure, options) {
    gpsCalls += 1;
    onPosition(success, failure, options);
  }}};
  class CustomEvent { constructor(name, options) { this.type = name; this.detail = options.detail; } }
  vm.runInNewContext(read('booking/booking-receipt.js'),
    { window, document, navigator, CustomEvent, console });
  return { api: window.BookingReceipts, events, gpsCalls: () => gpsCalls, policyCalls: () => policyCalls };
}

test('entering snapshot mode requests fresh high-accuracy GPS before any API fetch', async () => {
  const fixture = setup((success, _fail, options) => {
    assert.equal(options.maximumAge, 0);
    assert.equal(options.enableHighAccuracy, true);
    success({ coords: { latitude: 25.03, longitude: 121.56, accuracy: 16 }, timestamp: Date.now() });
  });
  assert.equal(typeof fixture.api.beginSnapshotMode, 'function');
  await fixture.api.beginSnapshotMode();
  assert.equal(fixture.gpsCalls(), 1);
  assert.equal(fixture.policyCalls(), 0);
  assert.deepEqual(fixture.events.map(event => event.status), ['requesting','ready']);
  fixture.api.endSnapshotMode();
  assert.equal(fixture.events.at(-1).status, 'idle');
});

test('GPS permission failure is reported and the next retry can succeed', async () => {
  let deny = true;
  const fixture = setup((success, fail) => {
    if (deny) fail({ code: 1 });
    else success({ coords: { latitude: 25.03, longitude: 121.56, accuracy: 20 }, timestamp: Date.now() });
  });
  await assert.rejects(fixture.api.beginSnapshotMode(), /定位權限未開啟/);
  assert.equal(fixture.events.at(-1).status, 'error');
  deny = false;
  await fixture.api.beginSnapshotMode();
  assert.equal(fixture.events.at(-1).status, 'ready');
  assert.equal(fixture.gpsCalls(), 2);
});

test('snapshot UI acquires GPS on mode entry, before enabling receipt capture', () => {
  const accessible = read('booking/booking-accessible.js');
  const receipt = read('booking/booking-receipt.js');
  const page = read('booking/index.html');
  assert.match(accessible, /beginSnapshotMode\?\.\(\)/);
  assert.match(accessible, /upload\.disabled = enabled && status !== 'ready'/);
  assert.match(accessible, /bookingSnapshotLocationRetry/);
  assert.match(receipt, /freshModeLocation\(\) \|\| await \(modeLocationPending \|\| beginSnapshotMode\(\)\)/);
  assert.match(receipt, /state\.location = await snapshotLocation\(\)/);
  assert.doesNotMatch(receipt, /if \(policy\.snapshotLocationRequired !== true\) return null/);
  assert.match(page, /id="bookingSnapshotLocationStatus"/);
  assert.match(page, /id="bookingAccessibleUpload"[^>]*disabled/);
});
