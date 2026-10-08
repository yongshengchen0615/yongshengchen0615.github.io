const {test}=require('node:test');const assert=require('node:assert/strict');const {JSDOM}=require('jsdom');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../..');const tick=()=>new Promise(r=>setTimeout(r,15));
const source=name=>fs.readFileSync(path.join(root,name),'utf8');
async function transferFixture(){
 const dom=new JSDOM('<main id="pointsView"><button id="pointTransferButton">轉贈</button><div id="activeCardView" data-card-id="CARD"></div></main>',{url:'https://example.test/MemberWebsocket-dev/points/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,calls=[],transactions=new Map();let uncertain=true;
 w.confirm=()=>true;
 w.MemberSystem={getSession:()=>({config:{},idToken:'mock'}),request:async(c,t,k,action,p={})=>{
  calls.push({action,...p});
  if(action==='points.transfer.options')return {cards:[{cardId:'CARD',title:'QA card',balance:10}]};
  if(action==='member.friend.list')return {friends:[{memberCode:'BBBB',displayName:'王○',status:'accepted'},{memberCode:'CCCC',displayName:'pending',status:'pending'}]};
  if(action==='points.transfer.receiver')return {memberCode:p.memberCode,displayName:'王○'};
  if(action==='points.transfer.create'){if(!transactions.has(p.requestId))transactions.set(p.requestId,p);if(uncertain){uncertain=false;throw Object.assign(new Error('uncertain'),{code:'API_RESPONSE_UNCERTAIN'});}return {transferId:'TX',senderBalance:7};}
 }};
 w.eval(source('points/point-transfer.js'));
 w.dispatchEvent(new w.CustomEvent('user-tour:ready',{detail:{surface:'points',profile:{memberCode:'AAAA'}}}));await tick();
 w.document.getElementById('pointTransferButton').click();await tick();
 return {dom,w,calls,transactions};
}
test('friend selection resolves on server, amount preserves receiver, uncertainty locks content and reopening retries same transaction',async()=>{
 const f=await transferFixture();const el=id=>f.w.document.getElementById(id);
 try{
  el('pointTransferFriendsButton').click();await tick();assert.equal(el('pointTransferFriends').querySelectorAll('button').length,1);
  el('pointTransferFriends').querySelector('button').click();await tick();assert.match(el('pointTransferReceiver').textContent,/BBBB/);
  el('pointTransferAmount').value='3';el('pointTransferAmount').dispatchEvent(new f.w.Event('input'));
  el('pointTransferForm').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await tick();
  assert.equal(el('pointTransferAmount').disabled,true);assert.equal(el('pointTransferScan').disabled,true);assert.equal(f.transactions.size,1);
  el('pointTransferClose').click();el('pointTransferButton').click();await tick();
  el('pointTransferForm').dispatchEvent(new f.w.Event('submit',{cancelable:true}));await tick();
  const requests=f.calls.filter(c=>c.action==='points.transfer.create');assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId);assert.equal(f.transactions.size,1);assert.equal(el('pointTransferAmount').disabled,false);
 }finally{f.dom.window.close();}
});
test('camera dialogs stop earlier and revoked sessions, Escape restores focus and background scroll',()=>{
 const dom=new JSDOM('<button id="open">相機</button><div id="one" hidden><video></video></div><div id="two" hidden></div>',{runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 try{w.eval(source('camera-dialog.js'));const one=w.document.getElementById('one'),two=w.document.getElementById('two');w.CameraDialog.mount(one,'QR');w.CameraDialog.mount(two,'Receipt');let stopped=0;const stop=()=>stopped++;
  w.document.getElementById('open').focus();w.CameraDialog.open(one);w.CameraDialog.acquire(stop);w.CameraDialog.open(two);assert.equal(stopped,1);assert.equal(one.hidden,true);
  w.CameraDialog.acquire(stop);w.dispatchEvent(new w.CustomEvent('member:access-ended'));assert.equal(stopped,2);assert.equal(two.hidden,true);assert.equal(w.document.body.classList.contains('camera-dialog-open'),false);
  w.document.getElementById('open').focus();w.CameraDialog.open(one);w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(one.hidden,true);assert.equal(w.document.activeElement.id,'open');
 }finally{dom.window.close();}
});
