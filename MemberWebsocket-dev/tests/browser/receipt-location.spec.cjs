const {test,expect}=require('playwright/test');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
let server,base;
const runs=new Map();
const fixtureScripts=new Map();
const blank=()=>({prepare:[],finalize:[],uploads:[],redeem:[],attempts:0,status:'confirmed'});
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
function shell(surface,run,mode) {
  const html=fs.readFileSync(path.join(root,surface,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  const fixture=`
    const run=${JSON.stringify(run)},mode=${JSON.stringify(mode)};
    window.fixtureStreams=[];window.fixtureEvents=0;
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let denied=mode==='camera-denied';
    navigator.mediaDevices.getUserMedia=async constraints=>{if(denied){denied=false;throw new DOMException('Permission denied','NotAllowedError');}const stream=await original(constraints);window.fixtureStreams.push(stream);return stream;};
    async function request(_config,_type,_token,action,payload={}){const response=await fetch('/api?run='+run+'&mode='+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,payload})});const body=await response.json();if(!response.ok)throw Object.assign(new Error(body.message),{code:body.code});return body;}
    const config={supabaseUrl:location.origin,supabasePublishableKey:'local-fixture'};
    window.BookingSystem={getSession:()=>({config,idToken:'local-fixture'}),request};
    window.supabase={createClient:()=>({storage:{from:()=>({uploadToSignedUrl:async(objectPath,token,file,options)=>{const response=await fetch('/upload?run='+run+'&token='+token,{method:'PUT',headers:{'Content-Type':options.contentType},body:file});return {error:response.ok?null:Object.assign(new Error('Upload unavailable'),{code:'RECEIPT_UPLOAD_UNAVAILABLE'})};}})}})};
    window.addEventListener('booking:accessible-receipt-submitted',()=>window.fixtureEvents++);
    window.MemberSystem={loadConfig:async()=>config,signIn:async()=> 'local-fixture',request,subscribeRealtime:()=>()=>{},bindDialogKeyboard(){}};
    window.MembershipProgress={render(){}};
  `;
  fixtureScripts.set(run,fixture);
  return html.replace(/href="\.\//g,`href="/${surface}/`).replace('</body>',`<script src="/fixture.js?run=${encodeURIComponent(run)}"></script><script src="/ticket-booking-choice.js"></script><script src="/event-ticket-ui.js"></script><script src="/${surface==='booking'?'booking/booking-receipt.js':'event/app.js'}"></script></body>`);
}
test.beforeAll(async()=>{
  server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      const run=url.searchParams.get('run');
      if(url.pathname==='/fixture.js') {res.writeHead(200,{'Content-Type':'text/javascript'});res.end(fixtureScripts.get(run));return;}
      if(url.pathname==='/receipt'||url.pathname==='/geo') {
        runs.set(run,blank());res.writeHead(200,{'Content-Type':'text/html'});res.end(shell(url.pathname==='/receipt'?'booking':'event',run,url.searchParams.get('mode')||''));return;
      }
      if(url.pathname==='/api'||url.pathname==='/upload') {
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=Buffer.concat(chunks),state=runs.get(run);
        if(url.pathname==='/upload') {
          state.uploads.push({size:data.length,type:req.headers['content-type'],jpeg:data[0]===255&&data[1]===216,token:url.searchParams.get('token')});
          if(url.searchParams.get('mode')==='unused')return json(res,{},503);
          return json(res,{});
        }
        const {action,payload}=JSON.parse(data);
        if(action==='user.booking.receipt.prepare') {
          state.prepare.push(payload);return json(res,{receiptId:'QA-RECEIPT',objectPath:'qa/receipt.jpg',uploadToken:'qa-token'});
        }
        if(action==='user.booking.receipt.finalize') {
          state.finalize.push(payload);state.status='awaiting_review';
          if(url.searchParams.get('mode')==='uncertain'&&state.finalize.length===1)return json(res,{code:'API_RESPONSE_UNCERTAIN',message:'Uncertain result'},503);
          return json(res,{receiptId:'QA-RECEIPT',status:'awaiting_review',alreadyApplied:state.finalize.length>1});
        }
        if(action==='user.booking.receipt.list')return json(res,{snapshotLocationRequired:url.searchParams.get('mode')==='location-required',bookings:[],submissions:[]});
        if(action==='user.event.bootstrap')return json(res,{profile:{displayName:'QA',tierKey:'general'},usedTickets:[],usedTicketCount:0,offers:[{
          ticket:{eventTicketId:'QA-GEO',title:'GPS QA',ticketType:'coupon',description:'GPS receipt QA',usageMethod:'Once',usageInstructions:'Once',requiresLocation:true,allowedTierKeys:['general'],prizes:[]},
          claim:{claimId:'QA-CLAIM',status:'claimed',ticketTitle:'GPS QA',ticketDescription:'GPS receipt QA',ticketType:'coupon'},eligibleBookings:[{bookingId:'00000000-0000-4000-8000-000000000001',bookingDate:'2099-01-01',startTime:'10:00',title:'GPS booking'}],canUse:true,availability:'open',tierEligible:true
        }]});
        if(action==='user.event.ticket.redeem') {
          state.redeem.push(payload);
          if(Math.abs(payload.location.latitude-25.033964)>.001)return json(res,{code:'LOCATION_OUT_OF_RANGE',message:'超出核銷範圍'},400);
          return json(res,{ticket:{claimId:'QA-CLAIM',eventTicketId:'QA-GEO',status:'used',ticketTitle:'GPS QA',ticketDescription:'GPS receipt QA',ticketType:'coupon',usedAt:new Date().toISOString()}});
        }
        return json(res,{code:'UNKNOWN_ACTION',message:action},400);
      }
      const file=path.resolve(root,'.'+url.pathname);
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,{},404);
      res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream'});fs.createReadStream(file).pipe(res);
    }catch(error){json(res,{message:error.message},500);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
});
test.afterAll(async()=>{await new Promise(resolve=>server.close(resolve));});
test.beforeEach(async({page})=>{await page.route('https://**',route=>route.abort());page.on('dialog',dialog=>dialog.accept());});
async function open(page,run,mode='',accessible=true) {
  await page.goto(base+'/receipt?run='+run+'&mode='+mode);
  expect(await page.evaluate(()=>typeof window.BookingSystem?.getSession)).toBe('function');
  await page.evaluate(accessible=>accessible?window.BookingReceipts.openAccessible():window.BookingReceipts.openBooking('QA-BOOKING','version-1'),accessible);
}

test('snapshot positioning policy blocks denied GPS and successful retries send fresh evidence',async({page,context})=>{
 const run='snapshot-location-policy';
 await open(page,run,'location-required');
 await expect(page.locator('#bookingReceiptMessage')).toContainText('定位權限未開啟');
 await expect(page.locator('#bookingReceiptFile')).toBeDisabled();expect(runs.get(run).prepare).toHaveLength(0);
 await context.grantPermissions(['geolocation'],{origin:base});await context.setGeolocation({latitude:25.033964,longitude:121.564472,accuracy:10});
 await page.locator('#bookingReceiptCapture').click();await expect(page.locator('#bookingReceiptCapture')).toHaveText('拍攝收據');
 await page.locator('#bookingReceiptCapture').click();await expect(page.locator('#bookingReceiptSubmit')).toBeEnabled();
 await page.locator('#bookingReceiptSubmit').click();await expect(page.locator('#bookingReceiptModal')).toBeHidden();
 const state=runs.get(run);expect(state.prepare).toHaveLength(1);expect(state.finalize).toHaveLength(1);
 expect(state.prepare[0].location).toMatchObject({latitude:25.033964,longitude:121.564472,accuracy:10});
 expect(state.finalize[0].location.timestamp).toBeGreaterThan(Date.now()-120000);
});
async function capture(page,{screenSnapshot=false}={}) {
  let snapshotSize=0;
  await expect(page.locator('#bookingReceiptCapture')).toHaveText('拍攝收據');
  if(screenSnapshot) {
    await page.evaluate(()=>{
      const existing=document.getElementById('e2eReceiptSnapshotSource'); if(existing)existing.remove();
      const source=document.createElement('article');
      source.id='e2eReceiptSnapshotSource';
      source.setAttribute('aria-label','E2E 快照收據替代快照');
      source.style.cssText='width:360px;padding:24px;background:#fff;color:#111;border:2px solid #222;font:16px/1.6 sans-serif';
      source.innerHTML='<strong>E2E 快照收據快照</strong><p>測試服務：QA Body Service</p><p>金額：NT$ 100</p><p>用途：以螢幕快照代替實體收據照片</p>';
      document.querySelector('.booking-receipt-modal-card')?.append(source);
    });
    const snapshot=await page.locator('#e2eReceiptSnapshotSource').screenshot({type:'jpeg',quality:84});
    snapshotSize=snapshot.length;
    await page.evaluate((bytes)=>{
      const canvas=document.getElementById('bookingReceiptCanvas');
      const original=canvas.toBlob.bind(canvas);
      canvas.toBlob=(callback)=>{
        canvas.toBlob=original;
        callback(new Blob([Uint8Array.from(bytes)],{type:'image/jpeg'}));
      };
    },Array.from(snapshot));
  }
  await page.locator('#bookingReceiptCapture').click();
  await expect(page.locator('#bookingReceiptSubmit')).toBeEnabled();
  await expect(page.locator('#bookingReceiptPreview')).toHaveAttribute('src',/^data:image\/jpeg/);
  return snapshotSize;
}
for(const accessible of [true,false])test(`${accessible?'accessible':'booking'} camera to JPEG, signed upload, finalize and review boundary`,async({page})=>{
  const run='receipt-'+accessible;await open(page,run,'',accessible);
  const screenshotSize=await capture(page,{screenSnapshot:accessible});
  await page.locator('#bookingReceiptSubmit').click();
  await expect(page.locator('#bookingReceiptModal')).toBeHidden();
  const state=runs.get(run);expect(state.prepare).toHaveLength(1);expect(state.finalize).toHaveLength(1);expect(state.uploads).toHaveLength(1);
  expect(state.prepare[0].mimeType).toBe('image/jpeg');expect(state.prepare[0].sizeBytes).toBeGreaterThan(100);
  expect(state.uploads[0]).toMatchObject({jpeg:true,type:'image/jpeg',token:'qa-token'});
  if(accessible) {
    expect(screenshotSize).toBeGreaterThan(100);
    expect(state.uploads[0].size).toBe(screenshotSize);
  }
  expect(state.status).toBe('awaiting_review');expect(state.prepare[0].accessible===true).toBe(accessible);
  expect(state.finalize[0].expectedUpdatedAt).toBe(accessible?'':'version-1');
  expect(await page.evaluate(()=>fixtureEvents)).toBe(accessible?1:0);
  expect(await page.evaluate(()=>fixtureStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')))).toBe(true);
});
test('denied camera permission can retry and closing releases the real video stream',async({page})=>{
  await open(page,'permission','camera-denied');
  await expect(page.locator('#bookingReceiptMessage')).toContainText('相機');
  await page.locator('#bookingReceiptCapture').click();await expect(page.locator('#bookingReceiptCapture')).toHaveText('拍攝收據');
  await page.locator('#bookingReceiptCancel').click();await expect(page.locator('#bookingReceiptModal')).toBeHidden();
  expect(await page.evaluate(()=>fixtureStreams.length===1&&fixtureStreams[0].getTracks().every(track=>track.readyState==='ended'))).toBe(true);
  expect(runs.get('permission').prepare).toHaveLength(0);
});
test('retake replaces the image without sending the discarded capture',async({page})=>{
  await open(page,'retake');await capture(page);await page.locator('#bookingReceiptRetake').click();
  await expect(page.locator('#bookingReceiptSubmit')).toBeDisabled();await capture(page);
  await page.locator('#bookingReceiptSubmit').click();await expect(page.locator('#bookingReceiptModal')).toBeHidden();
  expect(runs.get('retake').uploads).toHaveLength(1);
  expect(await page.evaluate(()=>fixtureStreams.length)).toBe(2);
});
test('uncertain finalize retry preserves receipt and does not repeat prepare or upload',async({page})=>{
  await open(page,'uncertain','uncertain');await capture(page);await page.locator('#bookingReceiptSubmit').click();
  await expect(page.locator('#bookingReceiptMessage')).toContainText('無法確認');
  await expect(page.locator('#bookingReceiptSubmit')).toBeEnabled();await page.locator('#bookingReceiptSubmit').click();
  await expect(page.locator('#bookingReceiptModal')).toBeHidden();
  const state=runs.get('uncertain');expect(state.prepare).toHaveLength(1);expect(state.uploads).toHaveLength(1);expect(state.finalize).toHaveLength(2);
  expect(state.finalize[0]).toEqual(state.finalize[1]);
});
test('double submit is locked until upload/finalize finishes',async({page})=>{
  await open(page,'double');await capture(page);
  await page.evaluate(()=>{document.getElementById('bookingReceiptSubmit').click();document.getElementById('bookingReceiptSubmit').click();});
  await expect(page.locator('#bookingReceiptModal')).toBeHidden();expect(runs.get('double').prepare).toHaveLength(1);expect(runs.get('double').finalize).toHaveLength(1);
});
test('GPS permission denial cannot dispatch redemption; permission retry sends actual coordinates',async({page,context})=>{
  await page.goto(base+'/geo?run=gps-permission');await page.locator('[data-event-ticket-id="QA-GEO"]').first().click();
  await page.locator('#ticketModalAction').click();await expect(page.locator('#ticketModalMessage')).toContainText('定位遭拒');expect(runs.get('gps-permission').redeem).toHaveLength(0);
  await context.grantPermissions(['geolocation']);await context.setGeolocation({latitude:25.033964,longitude:121.564468,accuracy:10});
  await page.locator('#ticketModalAction').click();await expect(page.locator('#ticketModalResult')).toBeVisible();
  expect(runs.get('gps-permission').redeem[0].location).toMatchObject({latitude:25.033964,longitude:121.564468,accuracy:10});
});
test('GPS out of range keeps ticket usable and a new in-range fix can retry',async({page,context})=>{
  await context.grantPermissions(['geolocation']);await context.setGeolocation({latitude:24,longitude:120,accuracy:10});
  await page.goto(base+'/geo?run=gps-range');await page.locator('[data-event-ticket-id="QA-GEO"]').first().click();await page.locator('#ticketModalAction').click();
  await expect(page.locator('#ticketModalMessage')).toContainText('超出');
  await context.setGeolocation({latitude:25.033964,longitude:121.564468,accuracy:5});await page.locator('#ticketModalAction').click();
  await expect(page.locator('#ticketModalResult')).toBeVisible();expect(runs.get('gps-range').redeem).toHaveLength(2);
  const attempts=runs.get('gps-range').redeem;expect(attempts[0].bookingId).toBe('00000000-0000-4000-8000-000000000001');expect(attempts[0].requestId).toBe(attempts[1].requestId);
});


test('accessible receipt image fallback supports preview, discard, and one signed upload after camera denial',async({page})=>{
  const run='receipt-image-picker';
  await open(page,run,'camera-denied',true);
  await expect(page.locator('#bookingReceiptMessage')).toContainText('選擇收據圖片');
  const uploadFile={name:'receipt.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1WQAAAABJRU5ErkJggg==','base64')};
  await page.locator('#bookingReceiptFile').setInputFiles(uploadFile);
  await expect(page.locator('#bookingReceiptPreview')).toHaveAttribute('src',/^data:image\/png/);
  await expect(page.locator('#bookingReceiptSubmit')).toBeEnabled();
  await page.locator('#bookingReceiptDiscard').click();
  await expect(page.locator('#bookingReceiptSubmit')).toBeDisabled();
  expect(runs.get(run).prepare).toHaveLength(0);
  await page.locator('#bookingReceiptFile').setInputFiles(uploadFile);
  await expect(page.locator('#bookingReceiptSubmit')).toBeEnabled();
  await page.locator('#bookingReceiptSubmit').click();
  await expect(page.locator('#bookingReceiptModal')).toBeHidden();
  const state=runs.get(run);
  expect(state.prepare).toHaveLength(1);
  expect(state.finalize).toHaveLength(1);
  expect(state.uploads).toHaveLength(1);
  expect(state.prepare[0].mimeType).toBe('image/png');
  expect(state.uploads[0].type).toBe('image/png');
  expect(state.status).toBe('awaiting_review');
});

test('invalid receipt images are rejected; cancel preserves all business records',async({page})=>{
  const run='receipt-file-invalid';
  await open(page,run,'camera-denied',true);
  await expect(page.locator('.app-shell')).toHaveAttribute('inert','');
  await page.locator('#bookingReceiptFile').setInputFiles({name:'bad.pdf',mimeType:'application/pdf',buffer:Buffer.from('not an image')});
  await expect(page.locator('#bookingReceiptMessage')).toContainText('JPG');
  await expect(page.locator('#bookingReceiptSubmit')).toBeDisabled();
  await page.locator('#bookingReceiptFile').setInputFiles({name:'huge.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(5*1024*1024+1,255)});
  await expect(page.locator('#bookingReceiptMessage')).toContainText('5 MB');
  await expect(page.locator('#bookingReceiptSubmit')).toBeDisabled();
  await page.locator('#bookingReceiptCancel').click();
  await expect(page.locator('#bookingReceiptModal')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/booking-receipt-modal-open/);
  await expect(page.locator('.app-shell')).not.toHaveAttribute('inert','');
  expect(runs.get(run).prepare).toHaveLength(0);
  expect(runs.get(run).finalize).toHaveLength(0);
  expect(runs.get(run).uploads).toHaveLength(0);
});
