const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('member receipt flow opens the camera instead of a visible file picker', () => {
  const source = read('booking/booking-receipt.js');
  assert.match(source, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(source, /facingMode:\s*\{\s*ideal:\s*'environment'\s*\}/);
  assert.match(source, /bookingReceiptCamera/);
  assert.match(source, /captureFrame/);
  assert.doesNotMatch(source, /type="file"/);
  assert.doesNotMatch(source, /<input[^>]+id="bookingReceiptFile"/);
  assert.doesNotMatch(source, /getElementById\('bookingReceiptFile'\)/);
  assert.doesNotMatch(source, /拍攝或選擇收據圖片/);
  assert.match(source, /此流程不支援從檔案或相簿選擇圖片/);
});

test('member receipt submission waits for admin review', () => {
  const source = read('booking/booking-receipt.js');
  const edge = read('supabase/functions/booking-receipt-api/index.ts');
  const migration = read('supabase/migrations/20261001125500_booking_receipt_admin_confirmation.sql');
  assert.match(source, /等待管理端確認/);
  assert.match(edge, /finalize_booking_receipt_request/);
  assert.match(migration, /status='awaiting_review'/);
  assert.match(migration, /user\.booking\.receipt\.submit/);
  assert.doesNotMatch(edge, /p_reason:"booking-completion-failed"/);
});

test('admin can complete a booking with or without a receipt snapshot', () => {
  const admin = read('admin/booking-receipt-admin.js');
  const operations = read('supabase/functions/booking-admin-operations/index.ts');
  const migration = read('supabase/migrations/20261001125500_booking_receipt_admin_confirmation.sql');

  assert.match(admin, /確認收據並完成預約/);
  assert.match(admin, /查看收據快照/);
  assert.doesNotMatch(admin, /等待會員上傳收據/);
  assert.doesNotMatch(admin, /管理端不可直接完成預約/);
  assert.match(operations, /admin_confirm_booking_receipt_request/);
  assert.match(operations, /complete_booking_with_rewards_request/);
  assert.match(operations, /receiptConfirmed/);
  assert.doesNotMatch(operations, /請先等待會員拍攝並送出收據/);
  assert.match(migration, /nextReceiptStatus','bound'/);
});

test('completed bookings keep their secure receipt snapshot viewer after admin queue re-renders', () => {
  const admin = read('admin/booking-receipt-admin.js');
  const panel = read('admin/booking-panel-core.js');
  const edge = read('supabase/functions/booking-receipt-api/index.ts');

  assert.match(panel, /data-booking-filter="completed"/);
  assert.match(admin, /\['awaiting_review', 'bound'\]\.includes/);
  assert.match(admin, /查看收據快照/);
  assert.match(admin, /new MutationObserver/);
  assert.match(admin, /queueObserver\.observe\(queue, \{ childList: true \}\)/);
  assert.match(admin, /admin\.booking\.receipt\.url/);
  assert.match(edge, /\.in\("status",\["awaiting_review","bound"\]\)/);
  assert.match(edge, /createSignedUrl\(String\(result\.data\.object_path\),120\)/);
});

