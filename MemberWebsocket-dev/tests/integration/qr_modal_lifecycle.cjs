const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,10));
function page(){
 const dom=new JSDOM('<button id="open">掃描</button><section id="panel" hidden><video></video></section>',{url:'https://example.test/MemberWebsocket-dev/points/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 const style=w.document.createElement('style');style.textContent=read('qr-scan-dialog.css');w.document.head.append(style);
 w.HTMLElement.prototype.getClientRects=()=>[{}];
 w.eval(read('qr-scan-dialog.js'));
 return {dom,w,panel:w.document.getElementById('panel'),opener:w.document.getElementById('open')};
}
test('scanner close button stops resources, restores panel/focus, and can reopen',async()=>{
 const f=page();try{
  let starts=0,stops=0;
  const open=()=>f.w.QRScanDialog.open(f.panel,{opener:f.opener,start:()=>starts++,stop:()=>stops++});
  open();await tick();assert.equal(starts,1);
  f.w.document.querySelector('.qr-scan-dialog-close').click();
  assert.equal(f.w.QRScanDialog.isOpen(),false);
  assert.equal(stops,1);assert.equal(f.panel.hidden,true);assert.equal(f.w.document.activeElement,f.opener);
  open();await tick();assert.equal(starts,2);f.w.QRScanDialog.close(f.panel);assert.equal(stops,2);
 }finally{f.w.close();}
});
test('pagehide closes scanner and a pending start is cancelled',async()=>{
 const f=page();try{
  let starts=0,stops=0;
  f.w.QRScanDialog.open(f.panel,{start:()=>starts++,stop:()=>stops++});
  f.w.dispatchEvent(new f.w.Event('pagehide'));await tick();
  assert.equal(f.w.QRScanDialog.isOpen(),false);assert.equal(starts,0);assert.equal(stops,1);
 }finally{f.w.close();}
});

test('QR display is lazy, purpose-specific, cancels stale rendering and reports errors',async()=>{
 const f=page();try{
  const values=[];let complete;
  f.w.FriendQRCode={toCanvas:(_canvas,value)=>{values.push(value);return new Promise(r=>complete=r);}};
  for(const value of ['AAAA','https://example.test/MemberWebsocket-dev/member/#friend=AAAA','https://example.test/MemberWebsocket-dev/member/#reward=AAAA']){
   assert.equal(f.w.QRDisplayDialog.show({memberCode:'AAAA',value,opener:f.opener}),true);
   await tick();assert.equal(f.w.document.querySelector('#qrDisplayPanel canvas').hidden,true);
   complete();await tick();assert.equal(f.w.document.querySelector('#qrDisplayPanel canvas').hidden,false);
   f.w.document.querySelector('.qr-scan-dialog-close').click();assert.equal(f.w.QRScanDialog.isOpen(),false);
   assert.equal(f.w.getComputedStyle(f.w.document.getElementById('qrDisplayPanel')).display,'none','Closing must hide the restored display panel');
  }
  assert.deepEqual(values,['AAAA','https://example.test/MemberWebsocket-dev/member/#friend=AAAA','https://example.test/MemberWebsocket-dev/member/#reward=AAAA']);
  f.w.QRDisplayDialog.show({memberCode:'AAAA'});await tick();f.w.QRDisplayDialog.close();complete();await tick();
  assert.equal(f.w.document.querySelector('#qrDisplayPanel canvas').hidden,true);
  f.w.FriendQRCode.toCanvas=async()=>{throw new Error('offline');};
  f.w.QRDisplayDialog.show({memberCode:'AAAA'});await tick();assert.match(f.w.document.getElementById('qrDisplayPanel').textContent,/暫時無法顯示/);
 }finally{f.w.close();}
});
