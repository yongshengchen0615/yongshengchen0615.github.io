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

test('only admin confirmation completes and settles a receipt-backed booking', () => {
  const admin = read('admin/booking-receipt-admin.js');
  const operations = read('supabase/functions/booking-admin-operations/index.ts');
  const migration = read('supabase/migrations/20261001125500_booking_receipt_admin_confirmation.sql');
  assert.match(admin, /確認收據並完成預約/);
  assert.match(operations, /admin_confirm_booking_receipt_request/);
  assert.match(migration, /RECEIPT_AWAITING_REVIEW_REQUIRED/);
  assert.match(migration, /complete_booking_with_rewards_request/);
  assert.match(migration, /nextReceiptStatus','bound'/);
});
