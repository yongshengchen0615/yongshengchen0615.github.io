const {test}=require('node:test');const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');const fs=require('node:fs');const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../friends.js'),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,20));
async function page(booking=false){
 const dom=new JSDOM('<main id="'+(booking?'bookingView':'memberView')+'"><div id="memberPass"></div><p id="bookingNotice"></p><fieldset class="booking-contact-fieldset"><div id="bookingRecipientHost"></div></fieldset></main>',{pretendToBeVisual:true,runScripts:'outside-only',url:'https://example.test/member/#friend=BBBB000000'});
 const w=dom.window,calls=[];let friends=[{memberCode:'BBBB',displayName:'王○',status:'pending',incoming:true}],release;
 const session={config:{supabaseUrl:'https://example.test',supabasePublishableKey:'public'},idToken:'verified'};
 const request=async(_c,_t,_k,action,payload)=>{calls.push({action,payload});if(action.endsWith('list'))return {friends,receivedBookings:[]};if(action.endsWith('lookup'))return {memberCode:'CCCC',displayName:'陳○'};if(action.endsWith('accept'))friends=friends.map(f=>({...f,status:'accepted'}));return {status:'pending'};};
 w.MemberSystem={getSession:()=>session,request};
 if(booking){w.BookingSystem={getSession:()=>session};w.fetch=async(_url,opt)=>({ok:true,json:async()=>({ok:true,data:await request(null,null,null,JSON.parse(opt.body).action,JSON.parse(opt.body))})});}
 w.eval(fs.readFileSync(path.resolve(__dirname,'../../friend-qr-scanner.js'),'utf8'));if(!booking)w.eval(fs.readFileSync(path.resolve(__dirname,'../../member/member-growth.js'),'utf8'));w.eval(source);const ready=()=>w.dispatchEvent(new w.CustomEvent(booking?'booking:member-loaded':'member-profile-ready',{detail:{profile:{lineUserId:'verified-A',memberCode:'AAAA',inviteCode:'AAAA000000'}}}));ready();await tick();
 return {dom,w,calls,ready,setFriends:value=>friends=value};
}
test('all invite entrances populate a safe lookup; request needs explicit confirmation; acceptance is separate',async()=>{
 const {dom,w,calls}=await page();try{
  assert.match(w.MemberFriends.invitationUrl(),/#friend=AAAA$/);assert.equal(w.document.getElementById('friendShareUrl'),null);
  assert.equal(w.document.getElementById('memberReferralInviteCode').value,'BBBB000000');assert.equal(calls.filter(c=>!c.action.endsWith('list')).length,0);assert.equal(w.document.querySelectorAll('#friendsPanel').length,1);assert.equal(w.document.getElementById('memberReferralModal').contains(w.document.getElementById('friendsPanel')),true);assert.equal(w.document.getElementById('openMemberReferral').textContent,'好友與邀請');
  w.document.getElementById('memberReferralForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  assert.equal(calls.at(-1).action,'member.friend.lookup');assert.equal(w.document.getElementById('confirmFriendRequest').hidden,false);
  w.document.getElementById('confirmFriendRequest').click();await tick();assert.equal(calls.some(c=>c.action==='member.friend.request'&&c.payload.memberCode==='CCCC'),true);
  [...w.document.querySelectorAll('#friendList button')].find(b=>b.textContent==='接受').click();await tick();assert.match(w.document.getElementById('friendList').textContent,/已成為好友/);
  assert.equal(calls.some(c=>/referral|ticket|points/.test(c.action)),false);
 }finally{dom.window.close();}
});
test('booking lists only accepted friends and editing fixes the original recipient',async()=>{
 const {dom,w,setFriends,ready}=await page(true);try{
  assert.equal(w.document.querySelector('#friendBookingRecipient').options.length,1);
  assert.equal(w.document.getElementById('friendBookingRecipient').closest('.booking-contact-fieldset')!==null,true);
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
  w.document.getElementById('memberReferralForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  switchAccount('verified-B');await tick();reject(new Error('PRIVATE-A lookup error'));await tick();
  assert.doesNotMatch(w.document.getElementById('friendStatus').textContent,/PRIVATE-A/);
  stage='request';w.document.getElementById('memberReferralInviteCode').value='CCCC';w.document.getElementById('memberReferralForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  w.document.getElementById('confirmFriendRequest').click();await tick();switchAccount('verified-C');await tick();
  resolve({status:'pending'});await tick();
  assert.equal(w.document.getElementById('confirmFriendRequest').hidden,true);
  assert.doesNotMatch(w.document.getElementById('friendStatus').textContent,/邀請已送出/);
 }finally{dom.window.close();}
});
test('unified lookup enables a separate one-time reward confirmation; changing the input invalidates both writes',async()=>{
 const {dom,w,calls}=await page();try{
  const field=w.document.getElementById('memberReferralInviteCode'),reward=w.document.getElementById('bindMemberReferral');
  assert.equal(reward.disabled,true);await w.MemberFriends.lookup();assert.equal(reward.disabled,false);
  assert.equal(calls.filter(c=>c.action==='member.referral.bind').length,0);
  field.value='DDDD000000';field.dispatchEvent(new w.Event('input'));assert.equal(reward.disabled,true);assert.equal(w.document.getElementById('confirmFriendRequest').hidden,true);
  await w.MemberFriends.lookup();reward.click();await tick();assert.equal(calls.filter(c=>c.action==='member.referral.bind').length,1);assert.equal(calls.at(-1).payload.inviteCode,'DDDD000000');
  assert.equal(field.disabled,false);assert.equal(reward.disabled,true);assert.equal(calls.some(c=>c.action==='member.friend.request'),false);
 }finally{dom.window.close();}
});
test('an old reward response cannot update the new account or leave its controls locked',async()=>{
 const {dom,w}=await page();try{
  let resolve;w.MemberSystem.request=async(_c,_t,_k,action)=>action==='member.referral.bind'?new Promise(r=>resolve=r):action.endsWith('lookup')?{memberCode:'CCCC',displayName:'陳○'}:{friends:[]};
  await w.MemberFriends.lookup();w.document.getElementById('bindMemberReferral').click();await tick();
  w.dispatchEvent(new w.CustomEvent('member-profile-ready',{detail:{profile:{lineUserId:'verified-B',memberCode:'BBBB',inviteCode:'BBBB000000'}}}));
  resolve({rewardExpiresOn:'PRIVATE-A'});await tick();
  assert.doesNotMatch(w.document.getElementById('memberReferralStatus').textContent,/PRIVATE-A|綁定成功/);assert.equal(w.document.getElementById('memberReferralInviteCode').disabled,false);
  w.document.getElementById('memberReferralInviteCode').value='CCCC000000';await w.MemberFriends.lookup();assert.equal(w.document.getElementById('bindMemberReferral').disabled,false);
 }finally{dom.window.close();}
});

test('member number lookup enables only explicit referral confirmation and preserves copy/share fallback',async()=>{
 const {dom,w,calls}=await page();try {
  const input=w.document.getElementById('memberReferralInviteCode');input.value='CCCC';input.dispatchEvent(new w.Event('input'));
  await w.MemberFriends.lookup();assert.equal(w.document.getElementById('bindMemberReferral').disabled,false);assert.equal(calls.some(c=>c.action==='member.referral.bind'),false);
  w.document.getElementById('bindMemberReferral').click();await tick();assert.equal(calls.filter(c=>c.action==='member.referral.bind').length,1);assert.equal(calls.find(c=>c.action==='member.referral.bind').payload.memberCode,'CCCC');
  let copied='';Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>{copied=text;}},configurable:true});
  w.document.getElementById('copyMemberInviteCode').click();await tick();assert.match(copied,/#friend=AAAA$/);assert.match(w.document.getElementById('friendStatus').textContent,/已複製/);assert.equal(w.document.getElementById('friendShareUrl'),null);
  w.document.getElementById('shareFriendLink').click();await tick();assert.match(w.document.getElementById('friendStatus').textContent,/已複製/);
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async()=>{throw new Error('denied');}},configurable:true});w.document.execCommand=()=>false;
  await w.MemberFriends.copyInvitationLink();assert.match(w.document.getElementById('friendStatus').textContent,/無法複製/);assert.equal(w.document.querySelector('.friend-copy-buffer'),null);
 }finally{dom.window.close();}
});
