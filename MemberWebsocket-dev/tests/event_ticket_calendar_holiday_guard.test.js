const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const read = (path) => fs.readFileSync(path, 'utf8');

const adminFlow = read('MemberWebsocket-dev/admin/grant-automation.js');
const realtime = read('MemberWebsocket-dev/realtime-resync.js');
const edge = read('MemberWebsocket-dev/supabase/functions/grant-automation/index.ts');

assert.match(adminFlow, /EVENT_TICKET_CALENDAR_MANAGED/);
assert.match(adminFlow, /syncManagedEventTicketDeleteButton/);
assert.match(adminFlow, /由活動票券管理/);
assert.match(adminFlow, /休假日不顯示活動，移除休假後會自動恢復/);
assert.doesNotMatch(adminFlow, /已自動取消加入日曆/);
assert.doesNotMatch(adminFlow, /saved\.calendarSync[\s\S]{0,160}reason === 'holiday'/);

assert.match(realtime, /splitManagedEventAroundHolidays/);
assert.match(realtime, /holidayDateSet/);
assert.match(realtime, /source.*event-ticket-calendar/);
assert.doesNotMatch(edge, /findActiveHolidayOverlap/);
assert.doesNotMatch(edge, /removeManagedEventTicketCalendarItems/);
assert.doesNotMatch(edge, /event_ticket_holiday_overlap/);

const sourceResult = {
  items: [
    {
      calendarItemId: 'HOL-12',
      itemType: 'holiday',
      title: '休假',
      status: 'active',
      startsOn: '2026-09-12',
      endsOn: '',
      linkUrl: ''
    },
    {
      calendarItemId: 'EVT-TICKET',
      itemType: 'event',
      title: '活動票券活動',
      status: 'active',
      startsOn: '2026-09-11',
      endsOn: '2026-09-13',
      linkUrl: 'https://example.com/event/?source=event-ticket-calendar&eventTicketId=ET-1'
    },
    {
      calendarItemId: 'EVT-MANUAL',
      itemType: 'event',
      title: '一般活動',
      status: 'active',
      startsOn: '2026-09-11',
      endsOn: '2026-09-13',
      linkUrl: ''
    }
  ]
};

let nextResult = sourceResult;
const baseRequest = async () => structuredClone(nextResult);
const windowMock = {
  MemberSystem: {
    request: baseRequest,
    subscribeRealtime() { return () => {}; }
  },
  location: { href: 'https://example.com/calendar/' },
  addEventListener() {},
  removeEventListener() {}
};
const context = {
  window: windowMock,
  document: {
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {}
  },
  navigator: { onLine: true },
  URL,
  Date,
  Set,
  Promise,
  structuredClone,
  console
};
vm.runInNewContext(realtime, context);

(async () => {
  const withHoliday = await windowMock.MemberSystem.request({}, 'calendar', 'token', 'user.calendar.bootstrap', {});
  const ticketSegments = withHoliday.items.filter((item) => item.calendarItemId === 'EVT-TICKET');
  assert.deepEqual(
    ticketSegments.map((item) => [item.startsOn, item.endsOn]),
    [['2026-09-11', ''], ['2026-09-13', '']]
  );
  const manualEvent = withHoliday.items.find((item) => item.calendarItemId === 'EVT-MANUAL');
  assert.equal(manualEvent.startsOn, '2026-09-11');
  assert.equal(manualEvent.endsOn, '2026-09-13');

  nextResult = {
    items: sourceResult.items.filter((item) => item.itemType !== 'holiday')
  };
  const withoutHoliday = await windowMock.MemberSystem.request({}, 'calendar', 'token', 'user.calendar.bootstrap', {});
  const restored = withoutHoliday.items.filter((item) => item.calendarItemId === 'EVT-TICKET');
  assert.equal(restored.length, 1);
  assert.equal(restored[0].startsOn, '2026-09-11');
  assert.equal(restored[0].endsOn, '2026-09-13');

  console.log('event ticket calendar holiday/source guard OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
