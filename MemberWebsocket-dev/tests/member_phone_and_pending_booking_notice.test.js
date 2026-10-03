const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('member join and edit phone fields share country-code E.164 composition', () => {
  const html = read('member/index.html');
  const app = read('member/app.js');
  const profile = read('member/profile-extension.js');
  const helper = read('member/member-phone.js');

  assert.match(html, /id="profileCountryCode"/);
  assert.match(html, /id="phoneEditCountryCode"/);
  assert.match(html, /value="\+886">台灣 \+886/);
  assert.match(app, /MemberPhone\?\.compose\(els\.profileCountryCode\.value, els\.profilePhone\.value\)/);
  assert.match(profile, /MemberPhone\?\.compose\(valueOf\('phoneEditCountryCode'\), valueOf\('phoneEditInput'\)\)/);

  const sandbox = { window: {} };
  vm.runInNewContext(helper, sandbox);
  const phone = sandbox.window.MemberPhone;
  assert.equal(phone.compose('+886', '0912-345-678'), '+886912345678');
  assert.equal(phone.compose('+81', '090-1234-5678'), '+819012345678');
  assert.equal(phone.compose('+1', '415-555-2671'), '+14155552671');
  assert.equal(phone.compose('+886', '09AB-345'), '');
  assert.deepEqual(
    JSON.parse(JSON.stringify(phone.split('+886912345678'))),
    { countryCode: '+886', localNumber: '0912345678' },
  );
});

test('server and database enforce canonical phone format and booking-created member notice', () => {
  const api = read('supabase/functions/member-profile-api/index.ts');
  const migration = read('supabase/migrations/20261003152500_member_phone_e164_and_pending_booking_notice.sql');

  assert.match(api, /function isValidE164/);
  assert.match(api, /if \(hasPhone && !isValidE164\(phone\)\)/);
  assert.match(migration, /members_phone_e164_check/);
  assert.match(migration, /phone ~ '\^\\\+\[1-9\]\[0-9\]\{7,14\}\$'/);
  assert.match(migration, /【等待管理員確認預約】/);
  assert.match(migration, /event_kind = 'created'[\s\S]*'member',member_record\.line_user_id/);
});
