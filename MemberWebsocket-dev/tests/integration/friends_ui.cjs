const {test}=require('node:test');const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');const fs=require('node:fs');const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../friends.js'),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,20));
async function page(booking=false){
 const dom=new JSDOM('<main id="'+(booking?'bookingView':'memberView')+'"><p id="bookingNotice"></p></main>',{runScripts:'outside-only',url:'https://example.test/member/#friend=INVITEQA'});
 const w=dom.window,calls=[];let friends=[{memberCode:'BBBB',displayName:'王○',status:'pending',incoming:true}],release;
 const session={config:{supabaseUrl:'https://example.test',supabasePublishableKey:'public'},idToken:'verified'};
 const request=async(_c,_t,_k,action,payload)=>{calls.push({action,payload});if(action.endsWith('list'))return {friends,receivedBookings:[]};if(action.endsWith('lookup'))return {memberCode:'CCCC',displayName:'陳○'};if(action.endsWith('accept'))friends=friends.map(f=>({...f,status:'accepted'}));return {status:'pending'};};
 w.MemberSystem={getSession:()=>session,request};
 if(booking){w.BookingSystem={getSession:()=>session};w.fetch=async(_url,opt)=>({ok:true,json:async()=>({ok:true,data:await request(null,null,null,JSON.parse(opt.body).action,JSON.parse(opt.body))})});}
 w.eval(source);const ready=()=>w.dispatchEvent(new w.CustomEvent(booking?'booking:member-loaded':'member-profile-ready',{detail:{profile:{lineUserId:'verified-A',memberCode:'AAAA',inviteCode:'INVITEQA'}}}));ready();await tick();
 return {dom,w,calls,ready,setFriends:value=>friends=value};
}
test('all invite entrances populate a safe lookup; request needs explicit confirmation; acceptance is separate',async()=>{
 const {dom,w,calls}=await page();try{
  assert.match(w.document.getElementById('friendShareUrl').value,/#friend=INVITEQA$/);
  assert.equal(w.document.getElementById('friendCode').value,'INVITEQA');assert.equal(calls.filter(c=>!c.action.endsWith('list')).length,0);
  w.document.getElementById('addFriendForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  assert.equal(calls.at(-1).action,'member.friend.lookup');assert.equal(w.document.getElementById('confirmFriendRequest').hidden,false);
  w.document.getElementById('confirmFriendRequest').click();await tick();assert.equal(calls.some(c=>c.action==='member.friend.request'&&c.payload.memberCode==='CCCC'),true);
  [...w.document.querySelectorAll('#friendList button')].find(b=>b.textContent==='接受').click();await tick();assert.match(w.document.getElementById('friendList').textContent,/已成為好友/);
  assert.equal(calls.some(c=>/referral|ticket|points/.test(c.action)),false);
 }finally{dom.window.close();}
});
test('booking lists only accepted friends and editing fixes the original recipient',async()=>{
 const {dom,w,setFriends,ready}=await page(true);try{
  assert.equal(w.document.querySelector('#friendBookingRecipient').options.length,1);
  setFriends([{memberCode:'BBBB',displayName:'王○',status:'accepted'}]);ready();await tick();
  const select=w.document.getElementById('friendBookingRecipient');select.value='BBBB';select.dispatchEvent(new w.Event('change'));assert.equal(w.MemberFriends.selected(),'BBBB');
  w.MemberFriends.lock('BBBB','王○');await tick();assert.equal(select.disabled,true);assert.equal(select.value,'BBBB');
  w.MemberFriends.clear();await tick();assert.equal(select.disabled,false);assert.equal(w.MemberFriends.selected(),'');
 }finally{dom.window.close();}
});
test('late account A response cannot repaint account B; the current account is reloaded',async()=>{
 const {dom,w}=await page();try{
  let resolve,calls=0;w.MemberSystem.request=async()=>{calls++;if(calls===1)return new Promise(r=>resolve=r);return {friends:[{memberCode:'BBBB',displayName:'B○',status:'accepted'}]};};
  w.document.getElementById('refreshFriends').click();await tick();
  w.dispatchEvent(new w.CustomEvent('member-profile-ready',{detail:{profile:{lineUserId:'verified-B',memberCode:'BBBB'}}}));
  resolve({friends:[{memberCode:'PRIVATE-A',displayName:'A○',status:'accepted'}]});await tick();await tick();
  assert.doesNotMatch(w.document.getElementById('friendList').textContent,/PRIVATE-A/);assert.match(w.document.getElementById('friendList').textContent,/BBBB/);
 }finally{dom.window.close();}
});
test('late lookup rejection and invite success cannot change the switched account panel',async()=>{
 const {dom,w}=await page();try{
  let reject,resolve,stage='lookup';
  w.MemberSystem.request=async(_c,_t,_k,action)=>{
   if(action.endsWith('list'))return {friends:[],receivedBookings:[]};
   if(action.endsWith('lookup'))return stage==='lookup'?new Promise((_r,j)=>reject=j):{memberCode:'CCCC',displayName:'陳○'};
   if(action.endsWith('request'))return new Promise(r=>resolve=r);
  };
  const switchAccount=id=>w.dispatchEvent(new w.CustomEvent('member-profile-ready',{detail:{profile:{lineUserId:id,memberCode:id}}}));
  w.document.getElementById('addFriendForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  switchAccount('verified-B');await tick();reject(new Error('PRIVATE-A lookup error'));await tick();
  assert.doesNotMatch(w.document.getElementById('friendStatus').textContent,/PRIVATE-A/);
  stage='request';w.document.getElementById('addFriendForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  w.document.getElementById('confirmFriendRequest').click();await tick();switchAccount('verified-C');await tick();
  resolve({status:'pending'});await tick();
  assert.equal(w.document.getElementById('confirmFriendRequest').hidden,true);
  assert.doesNotMatch(w.document.getElementById('friendStatus').textContent,/邀請已送出/);
 }finally{dom.window.close();}
});
