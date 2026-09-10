# Booking notice / holiday verification

Automated wiring assertions: `booking_notice_holiday_wiring.test.js`.

The database migration must also be verified with a rollback-only transaction to confirm:
- multiline booking notices preserve `\n`;
- active holidays reject booking inserts with `BOOKING_HOLIDAY`;
- no QA rows remain after rollback.
