const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('booking history hydrates point-card source metadata without changing ticket write payloads', () => {
  const api = read('supabase/functions/booking-api/index.ts');
  const groupApi = read('supabase/functions/booking-group-api/index.ts');
  const receiptApi = read('supabase/functions/booking-receipt-api/index.ts');
  const benefits = read('booking/booking-benefits.js');

  for (const source of [api, groupApi, receiptApi]) {
    assert.match(source, /point_cards\(title\)/);
    assert.match(source, /cardTitle/);
  }
  assert.match(api, /pointBenefitRefs/);
  assert.match(groupApi, /pointCardTitleByTicket/);
  assert.match(receiptApi, /pointCardTitlesForBenefits/);
  assert.match(benefits, /cardTitle:\s*item\.cardTitle\s*\|\|\s*''/);
  assert.match(benefits, /function selectionPayload\(\)[\s\S]*kind:\s*item\.kind,\s*id:\s*item\.id/);
});

test('member and admin booking records render explicit ticket kind and point-card source', () => {
  const member = read('booking/app.js');
  const group = read('booking/group-booking.js');
  const admin = read('admin/booking-panel-core.js');
  const accessible = read('admin/booking-accessible-admin.js');

  assert.match(member, /本次使用票券/);
  assert.match(member, /benefit\.cardTitle/);
  assert.match(member, /集點卡票券/);
  assert.match(member, /活動票券/);
  assert.match(group, /item\.cardTitle/);
  assert.match(admin, /使用票券/);
  assert.match(admin, /bookingBenefitDisplayTitle/);
  assert.match(accessible, /benefitRecordTitle/);
  assert.match(accessible, /benefitKindLabel/);
});
