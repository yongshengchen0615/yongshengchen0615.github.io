const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync(path.join(__dirname,'../supabase/functions/booking-receipt-api/index.ts'),'utf8');
const code = source.slice(source.indexOf('async function prepare('),source.indexOf('async function finalize('));
const member = { id:'10000000-0000-4000-8000-000000000001' };
const body = { bookingId:'30000000-0000-4000-8000-000000000001',requestId:'receipt-request',mimeType:'image/jpeg',sizeBytes:100 };

for (const status of ['pending_upload','awaiting_review','bound']) {
  test(`receipt prepare: ${status} cannot grant overwrite access to a submitted snapshot`, async () => {
    const signed = [];
    const context = vm.createContext({
      asText:(value) => String(value || ''),
      ALLOWED_MIME:new Set(['image/jpeg']),MAX_FILE_BYTES:5242880,
      BUCKET:'booking-receipts',
      crypto:require('node:crypto').webcrypto,extensionFor:() => 'jpg',
      ApiError:class extends Error {},dbError:(error) => error,
    });
    vm.runInContext(stripTypeScriptTypes(code),context);
    const db = {
      rpc:async () => ({ data:{ status,receiptId:'receipt',objectPath:'object',alreadyPrepared:true },error:null }),
      storage:{ from:() => ({ createSignedUploadUrl:async (path,options) => { signed.push({ path,upsert:options.upsert }); return { data:{ token:'fixture' } }; } }) },
    };
    const result = await context.prepare(db,{},member,body);
    if (status === 'pending_upload') {
      assert.deepEqual(signed,[{ path:'object',upsert:false }]);
      assert.equal(result.uploadToken,'fixture');
    } else {
      assert.equal(signed.length,0);
      assert.equal(result.uploadToken,undefined);
      assert.equal(result.status,status);
    }
  });
}

test('the member receipt list prefers the submitted snapshot over failed or pending replacements', async () => {
  const code = source.slice(source.indexOf('async function memberList('),source.indexOf('async function prepare('));
  const context = vm.createContext({localTaipeiNowMs:() => Date.now(),Date,ApiError:class extends Error {}});
  vm.runInContext(stripTypeScriptTypes(code),context);
  const rows = [{id:body.bookingId,status:'confirmed',booking_receipts:[
    { receipt_id:'old',status:'awaiting_review',created_at:'2026-10-01T00:00:00Z' },
    { receipt_id:'pending',status:'pending_upload',created_at:'2026-10-02T00:00:00Z' },
    { receipt_id:'failed',status:'failed',created_at:'2026-10-03T00:00:00Z' },
  ]}];
  const q = { select(){return q;},eq(){return q;},in(){return q;},order(){return q;},limit:async () => ({ data:rows }) };
  const result = await context.memberList({ from:() => q },member);
  assert.equal(result.bookings[0].receipt.receiptId,'old');
  assert.equal(result.bookings[0].canSubmitReceipt,true);
});
