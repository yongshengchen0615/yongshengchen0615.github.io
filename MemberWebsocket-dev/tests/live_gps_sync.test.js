const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const root = join(__dirname, '..');
const read = (file) => readFileSync(join(root, file), 'utf8');

function setup() {
  let callback;
  let errors;
  const cleared = [];
  const events = [];
  const ctx = {
    Date, Math, Number, String, Object, Map, Set, Promise,
    navigator: { geolocation: {
      watchPosition(onFix, onError, opts) {
        callback = onFix; errors = onError;
        assert.equal(opts.maximumAge, 0);
        assert.equal(opts.enableHighAccuracy, true);
        return 0; // Watch ID 0 must be stopped, too.
      },
      clearWatch(id) { cleared.push(id); }
    }},
    window: {
      isSecureContext: true,
      setTimeout, clearTimeout
    }
  };
  vm.runInNewContext(read('ticket-live-location.js'), ctx);
  const watcher = ctx.window.TicketLiveLocation.create({
    onUpdate: (fix, fresh) => events.push({ fix, fresh })
  });
  return { watcher, events, cleared, emit: (data) => callback(data), fail: (e) => errors(e) };
}

test('watchPosition updates live location without refreshing or storing history', async () => {
  const { watcher, events, cleared, emit } = setup();
  const pending = watcher.read();
  emit({ coords: { latitude: 25.033, longitude: 121.5654, accuracy: 24 }, timestamp: Date.now() });
  const fix = await pending;
  assert.equal(fix.accuracy, 24);
  assert.equal(watcher.active(), true);
  emit({ coords: { latitude: 25.0332, longitude: 121.5657, accuracy: 9 }, timestamp: Date.now() });
  assert.equal(events.length, 2);
  assert.equal((await watcher.read()).accuracy, 9);
  watcher.stop();
  assert.deepEqual(cleared, [0]);
  assert.equal(watcher.latest(), null);
});

test('inaccurate fixes are visible but not accepted for ticket redemption', async () => {
  const { watcher, events, emit } = setup();
  const pending = watcher.read();
  emit({ coords: { latitude: 25.033, longitude: 121.5654, accuracy: 170 }, timestamp: Date.now() });
  assert.equal(events.length, 1);
  assert.equal(events[0].fresh, false);
  emit({ coords: { latitude: 25.034, longitude: 121.5657, accuracy: 20 }, timestamp: Date.now() });
  assert.equal((await pending).accuracy, 20);
  watcher.stop();
});

test('geo watchers and name confirmation are wired to both member ticket surfaces', () => {
  const event = read('event/app.js');
  const points = read('points/pointcard-ticket-overview.js');
  const admin = read('admin/coupon-location-editor.js');
  const realtime = read('member-system.js');
  const member = read('member/app.js');
  for (const file of ['event/index.html', 'points/index.html', 'admin/index.html']) {
    assert.match(read(file), /ticket-live-location\.js/);
  }
  assert.match(event, /confirmLiveLocationName/);
  assert.match(points, /confirmLiveLocationName/);
  assert.match(admin, /function stopGPS/);
  assert.match(admin, /TicketLiveLocation\.placeName/);
  assert.match(realtime, /periodic-reconcile/);
  assert.match(member, /Subscribe regardless of the initial view/);
});
