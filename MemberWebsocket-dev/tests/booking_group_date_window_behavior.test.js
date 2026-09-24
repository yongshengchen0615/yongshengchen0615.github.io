const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/booking-group-slots-api/index.ts'), 'utf8');
const slotSource = stripTypeScriptTypes(source.slice(
  source.indexOf('async function slots('), source.indexOf('\nDeno.serve(', source.indexOf('async function slots('))
));
const today = '2026-09-24';
const group = {
  settings: {
    min_advance_days: 4, max_advance_days: 33, max_party_size: 2,
    work_start_time: '09:00:00', work_end_time: '10:00:00'
  },
  primaryId: 'primary-technician', assignments: [], totalDurationMinutes: 30, totalAmount: 0
};

function buildSlots(holiday = false) {
  const context = {
    normalizeGroup: async () => group,
    SLOT_INTERVAL: 30,
    dateValue: (value) => String(value),
    taipeiDate: () => today,
    taipeiMinutes: () => 0,
    addDays: (date, days) => {
      const value = new Date(date + 'T00:00:00Z');
      value.setUTCDate(value.getUTCDate() + days);
      return value.toISOString().slice(0, 10);
    },
    isActiveBookingHoliday: async () => holiday,
    toMinutes: (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)),
    toTime: (value) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`,
  };
  return vm.runInNewContext(slotSource + '\nslots', context);
}

const range = { earliestBookingDate: '2026-09-28', latestBookingDate: '2026-10-27' };

test('group slots return both booking date limits when too early or too far', async () => {
  const slots = buildSlots();
  for (const date of ['2026-09-27', '2026-10-28']) {
    const result = await slots(null, null, { bookingDate: date });
    assert.equal(result.earliestBookingDate, range.earliestBookingDate);
    assert.equal(result.latestBookingDate, range.latestBookingDate);
    assert.equal(result.slots.length, 0);
  }
});

test('group slots retain booking limits for a holiday', async () => {
  const result = await buildSlots(true)(null, null, { bookingDate: '2026-10-01' });
  assert.equal(result.holidayBlocked, true);
  assert.equal(result.earliestBookingDate, range.earliestBookingDate);
  assert.equal(result.latestBookingDate, range.latestBookingDate);
  assert.equal(result.slots.length, 0);
});

test('group slots retain booking limits on a normally available date', async () => {
  const builder = { select() { return this; }, eq() { return this; }, in() { return this; },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
  const supabase = { from() { return builder; } };
  const result = await buildSlots()(supabase, null, { bookingDate: '2026-10-01' });
  assert.equal(result.earliestBookingDate, range.earliestBookingDate);
  assert.equal(result.latestBookingDate, range.latestBookingDate);
  assert.ok(result.slots.length > 0);
});
