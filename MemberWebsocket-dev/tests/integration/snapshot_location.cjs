const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const load=require('./fixtures/load-postgres-snapshot.cjs');
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,20));
test('snapshot policy uses real PostgreSQL, admin authorization, version guard, current policy and replay',async t=>{
 const db=await load();
 try{
  await db.exec('select maintenance.ensure_required_system_baseline();');
  await db.exec(read('supabase/migrations/20261010015823_snapshot_location_policy.sql'));
  const one=async(q,args=[]) => (await db.query(q,args)).rows[0];
  const member=(await one("insert into members(line_user_id,member_code,status,membership_status,is_test_account) values('test:snapshot','QA-SNAPSHOT','active','active',true) returning id")).id;
  await db.exec("insert into admins(line_user_id,role,status) values('test:admin','admin','active');");
  const save=(value,actor='test:admin',expected=null)=>one("select (save_booking_shared_settings_v5('09:00','17:00',30,0,0,'',10,false,'18:00',$1,$2,$3)).snapshot_location_required required",[expected,actor,value]);
  const point=()=>({latitude:25.03,longitude:121.56,accuracy:20,timestamp:Date.now()});
  const prepare=(id,location=null)=>one('select prepare_snapshot_receipt_request($1,$2,$3,$4,100,$5) result',[member,id,`${member}/accessible/${id}.jpg`,'image/jpeg',location]);
  const finalize=(id,location=null,owner=member)=>one("select finalize_snapshot_receipt_request($1,$2,'test:snapshot','image/jpeg',100,$3,$4) result",[id,owner,'a'.repeat(64),location]);
  let receipt;
  await t.test('legacy default OFF prepares without location and keeps mode code',async()=>{
   assert.equal((await one('select snapshot_location_required required from booking_settings')).required,false);
   receipt=(await prepare('QA-SNAPSHOT-FIRST')).result.receiptId;
   assert.equal((await one('select submission_mode from booking_receipts where receipt_id=$1',[receipt])).submission_mode,'accessible');
  });
  await t.test('unauthorized and stale policy changes roll back; authorized change is audited',async()=>{
   await assert.rejects(save(true,'test:member'),/ADMIN_REQUIRED/);
   await assert.rejects(save(true,'test:admin','2000-01-01T00:00:00Z'),/BOOKING_SETTINGS_CONFLICT/);
   assert.equal((await save(true)).required,true);
   assert.equal((await one("select count(*)::int n from booking_audit_events where action='SNAPSHOT_LOCATION_POLICY_UPDATED'")).n,1);
   assert.equal((await save(null)).required,true,'Old client saves preserve the existing policy');
  });
  await t.test('ON rejects missing/stale/invalid GPS before creating any snapshot',async()=>{
   for(const value of [null,{},false,{...point(),latitude:91},{...point(),longitude:-181},{...point(),accuracy:-1},{...point(),timestamp:Date.now()-180000},{...point(),timestamp:Date.now()+60000},{...point(),latitude:'25'}]){
    await assert.rejects(prepare('QA-SNAPSHOT-INVALID',value),/SNAPSHOT_LOCATION/);
   }
   assert.equal((await one('select count(*)::int n from booking_receipts')).n,1);
  });
  await t.test('policy changed after prepare is enforced at finalize; owner and replay remain safe',async()=>{
   await assert.rejects(finalize(receipt),/SNAPSHOT_LOCATION_REQUIRED/);
   assert.equal((await one('select status from booking_receipts where receipt_id=$1',[receipt])).status,'pending_upload');
   assert.equal((await finalize(receipt,point())).result.status,'awaiting_review');
   assert.equal((await finalize(receipt)).result.alreadyApplied,true);
   await assert.rejects(finalize(receipt,point(),'00000000-0000-4000-8000-000000000099'),/MEMBERSHIP_REQUIRED|RECEIPT_NOT_OWNED/);
   assert.equal((await save(false)).required,false);
   assert.ok((await prepare('QA-SNAPSHOT-OFF')).result.receiptId);
  });
  await t.test('anonymous/authenticated roles cannot invoke policy or snapshot write RPCs',async()=>{
   for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select require_snapshot_location(null)'),/permission denied/);
    await assert.rejects(prepare('QA-DENIED'),/permission denied/);
    await assert.rejects(save(true),/permission denied/);
    await db.exec('reset role');
   }
  });
 }finally{await db.close();}
});

function page(required){
 const dom=new JSDOM('<main class="app-shell"></main>',{url:'https://example.test/booking/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,calls=[];let cameras=0;
 w.BookingSystem={getSession:()=>({config:{},idToken:'fixture'}),request:async(...args)=>{calls.push(args);return {snapshotLocationRequired:required,bookings:[],submissions:[]};}};
 Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>{cameras++;throw new Error('mock camera');}}});
 w.eval(read('booking/booking-receipt.js'));
 return {w,dom,calls,cameras:()=>cameras};
}
test('OFF opens without GPS; ON blocks unsupported/denied/timeout GPS and retries',async()=>{
 const off=page(false);try{await off.w.BookingReceipts.openAccessible();await tick();assert.equal(off.cameras(),1);}finally{off.w.close();}
 const f=page(true);try{
  await f.w.BookingReceipts.openAccessible();assert.equal(f.cameras(),0);assert.equal(f.w.document.getElementById('bookingReceiptFile').disabled,true);
  assert.match(f.w.document.getElementById('bookingReceiptMessage').textContent,/不支援定位/);
  let code=1;
  Object.defineProperty(f.w.navigator,'geolocation',{value:{getCurrentPosition:(_ok,fail)=>fail({code})}});
  f.w.document.getElementById('bookingReceiptCapture').click();await tick();assert.match(f.w.document.getElementById('bookingReceiptMessage').textContent,/定位權限未開啟/);
  code=3;f.w.document.getElementById('bookingReceiptCapture').click();await tick();assert.match(f.w.document.getElementById('bookingReceiptMessage').textContent,/定位逾時/);
  f.w.navigator.geolocation.getCurrentPosition=ok=>ok({coords:{latitude:25,longitude:121,accuracy:10},timestamp:Date.now()});
  f.w.document.getElementById('bookingReceiptCapture').click();await tick();assert.equal(f.cameras(),1);assert.equal(f.w.document.getElementById('bookingReceiptFile').disabled,false);
 }finally{f.w.close();}
});
test('late GPS after cancellation cannot reopen camera or snapshot UI',async()=>{
 const f=page(true);try{
  let resolve;
  Object.defineProperty(f.w.navigator,'geolocation',{value:{getCurrentPosition:ok=>resolve=ok}});
  const opening=f.w.BookingReceipts.openAccessible();await tick();
  f.w.document.getElementById('bookingReceiptCancel').click();
  resolve({coords:{latitude:25,longitude:121,accuracy:10},timestamp:Date.now()});await opening;
  assert.equal(f.cameras(),0);assert.equal(f.w.document.getElementById('bookingReceiptModal').classList.contains('hidden'),true);
 }finally{f.w.close();}
});
