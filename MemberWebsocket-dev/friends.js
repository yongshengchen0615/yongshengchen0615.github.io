(() => {
 'use strict';
 const booking=Boolean(window.BookingSystem);let profile=null,generation=0,loading=false,selectedCode='',lockedRecipient=null;
 const el=id=>document.getElementById(id);
 function session(){return booking?window.BookingSystem.getSession():window.MemberSystem.getSession('member');}
 async function request(operation,code='') {
   const current=session();if(!current)throw new Error('登入狀態已失效，請重新整理。');
   if(!booking)return window.MemberSystem.request(current.config,'member',current.idToken,'member.friend.'+operation,{memberCode:code});
   const body={clientType:'booking',idToken:current.idToken,action:'member.friend.'+operation,memberCode:code};
   const response=await fetch(current.config.supabaseUrl.replace(/\/$/,'')+'/functions/v1/member-growth-api',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',apikey:current.config.supabasePublishableKey},body:JSON.stringify(window.TestModeClient?.payload?window.TestModeClient.payload(body):body)});
   const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error?.message||'好友資料載入失敗。');return result.data;
 }
 function status(text){if(el('friendStatus'))el('friendStatus').textContent=text;}
 function install() {
   if(el('friendsPanel'))return;
   const main=el(booking?'bookingView':'memberView');if(!main)return;
   const panel=document.createElement('section');panel.id='friendsPanel';panel.className='friends-panel';
   panel.innerHTML=booking?'<h2>替誰預約</h2><label>實際接受服務的會員<select id="friendBookingRecipient"><option value="">本人</option></select></label><p>好友接受邀請後可代約單人服務。票券由建立者選用自己的票券；完成服務後，好友取得正常點數與服務分鐘，代約者取得每種已設定集點規則的服務類型 1 點及一半服務分鐘（不足 1 分鐘向下取整）。</p><a href="../member/#friends">管理好友</a><button id="refreshFriends" type="button" class="button button-refresh">更新好友</button><p id="friendStatus" role="status" aria-live="polite"></p>':'<h2>我的好友</h2><p>好友邀請需要對方接受，才可替對方預約。好友關係與首次加入的邀請獎勵分別管理。</p><div class="friend-actions"><button id="shareFriendLink" type="button" class="button button-refresh">分享加入好友連結</button><button id="refreshFriends" type="button" class="button button-refresh">更新好友</button></div><canvas id="friendQr" class="friend-qr" aria-label="加入好友連結 QR Code" hidden></canvas><label>我的加入好友連結<input id="friendShareUrl" readonly aria-label="我的加入好友連結"></label><form id="addFriendForm"><label>會員編號或邀請碼<input id="friendCode" maxlength="40" autocomplete="off" required></label><button type="submit" class="button button-dark">查找好友</button><button id="confirmFriendRequest" type="button" class="button button-dark" hidden>確認送出好友邀請</button></form><p id="friendStatus" role="status" aria-live="polite"></p><div id="friendList"></div><div id="friendReceivedBookings"></div>';
   if(booking)el('bookingNotice')?.before(panel);else main.append(panel);
   el('refreshFriends').addEventListener('click',()=>void refresh());
   if(booking){el('friendBookingRecipient').addEventListener('change',event=>{selectedCode=event.target.value;status(selectedCode?'將替所選好友預約；送出前請再次確認受服務者。':'本次為本人預約。');});return;}
   let pendingCode='',busy=false;
   el('addFriendForm').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;const current=generation;try{const found=await request('lookup',el('friendCode').value.trim());if(current!==generation)return;pendingCode=found.memberCode;status(`確認好友：${found.displayName} · ${found.memberCode}。送出後需等待對方接受。`);el('confirmFriendRequest').hidden=false;}catch(error){status(error.message);}finally{busy=false;}});
   el('friendCode').addEventListener('input',()=>{pendingCode='';el('confirmFriendRequest').hidden=true;});
   el('confirmFriendRequest').addEventListener('click',async()=>{if(busy||!pendingCode)return;busy=true;el('confirmFriendRequest').disabled=true;try{const result=await request('request',pendingCode);status(result.status==='accepted'?'已是好友。':'邀請已送出，等待好友接受。');el('confirmFriendRequest').hidden=true;await refresh(false);}catch(error){status(error.message);}finally{busy=false;el('confirmFriendRequest').disabled=false;}});
   el('shareFriendLink').addEventListener('click',async()=>{const url=el('friendShareUrl').value;if(!url)return;try{if(navigator.share)await navigator.share({title:'加入我的好友',url});else{await navigator.clipboard.writeText(url);status('好友連結已複製。');}}catch(error){if(error.name!=='AbortError'){el('friendShareUrl').select();status('請複製上方好友連結。');}}});
   const linkCode=new URLSearchParams(location.hash.slice(1)).get('friend');if(linkCode)el('friendCode').value=linkCode.slice(0,40);
 }
 async function refresh(showLoading=true) {
   if(!profile||loading)return;loading=true;const current=generation;if(showLoading)status('正在載入好友…');
   try{const result=await request('list');if(current!==generation)return;
     if(booking){const select=el('friendBookingRecipient');if(lockedRecipient){select.replaceChildren(new Option(lockedRecipient.name||'本人',lockedRecipient.code));select.value=lockedRecipient.code;select.disabled=true;return;}select.disabled=false;const previous=selectedCode;select.replaceChildren(new Option('本人',''));for(const friend of result.friends||[])if(friend.status==='accepted')select.add(new Option(`${friend.displayName} · ${friend.memberCode}`,friend.memberCode));selectedCode=Array.from(select.options).some(option=>option.value===previous)?previous:'';select.value=selectedCode;}
     else {const list=el('friendList');list.replaceChildren();for(const friend of result.friends||[]){const row=document.createElement('article');row.className='friend-row';const copy=document.createElement('div');const name=document.createElement('strong');name.textContent=`${friend.displayName} · ${friend.memberCode}`;const hint=document.createElement('small');hint.textContent=friend.status==='accepted'?'已成為好友，可代約':friend.status==='blocked'?'已封鎖':friend.incoming?'收到好友邀請':'已送出邀請，等待接受';copy.append(name,hint);row.append(copy);const actions=document.createElement('div');actions.className='friend-actions';for(const [operation,label] of friend.status==='pending'&&friend.incoming?[['accept','接受'],['remove','婉拒'],['block','封鎖']]:friend.status==='blocked'?[['remove','解除封鎖']]:[['remove',friend.status==='pending'?'撤回邀請':'解除好友'],['block','封鎖']]){const button=document.createElement('button');button.type='button';button.className='button button-refresh';button.textContent=label;button.addEventListener('click',async()=>{button.disabled=true;try{await request(operation,friend.memberCode);status('好友關係已更新。');await refresh(false);}catch(error){status(error.message);}finally{button.disabled=false;}});actions.append(button);}row.append(actions);list.append(row);}if(!list.children.length)list.textContent='目前沒有好友，分享連結或輸入會員編號即可邀請。';
       const received=el('friendReceivedBookings');received.replaceChildren();for(const item of result.receivedBookings||[]){const line=document.createElement('p');line.textContent=`好友代約服務：${item.bookingDate} ${item.startTime} · ${item.statusLabel} · ${item.serviceTitle}`;received.append(line);}
     }
     if(showLoading)status('好友資料已更新。');
   }catch(error){if(current===generation)status(error.message||'好友資料載入失敗，請更新好友重試。');}
   finally{loading=false;if(current!==generation&&profile)void refresh();}
 }
 function ready(event){const next=event.detail?.profile;if(!next?.lineUserId)return;const changed=profile?.lineUserId!==next.lineUserId;if(changed){generation++;selectedCode='';lockedRecipient=null;el('friendsPanel')?.remove();}profile=next;install();if(!el('friendsPanel'))return;
   if(!booking){const url=new URL('./',location.href);url.hash='friend='+encodeURIComponent(profile.inviteCode||profile.memberCode||'');el('friendShareUrl').value=url.href;if(window.FriendQRCode&&profile.inviteCode){el('friendQr').hidden=false;window.FriendQRCode.toCanvas(el('friendQr'),url.href,{width:192,margin:2}).catch(()=>{el('friendQr').hidden=true;});}}
   void refresh();
 }
 window.addEventListener(booking?'booking:member-loaded':'member-profile-ready',ready);
 window.addEventListener(booking?'booking:refresh':'member-system:realtime-invalidation',()=>{if(profile)void refresh(false);});
 window.addEventListener('pagehide',()=>{generation++;profile=null;selectedCode='';});
 window.MemberFriends={selected:()=>selectedCode,lock:(code,name)=>{lockedRecipient={code:code||'',name:code?`${name||'好友'} · ${code}（編輯時不可更換）`:'本人（編輯時不可更換）'};selectedCode=code||'';void refresh();},clear:()=>{selectedCode='';lockedRecipient=null;const select=el('friendBookingRecipient');if(select){select.disabled=false;select.value='';}void refresh(false);}};
})();
