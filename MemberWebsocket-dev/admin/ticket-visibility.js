(() => {
  'use strict';
  let session, version='',busy=false;
  async function request(action,payload={}) { return window.MemberSystem.request(session.config,'admin',session.idToken,action,payload); }
  document.addEventListener('DOMContentLoaded', async()=>{
    const panel=document.getElementById('eventsPanel');if(!panel)return;
    const section=document.createElement('section');section.className='tier-settings';section.id='ticketVisibilitySettings';
    section.innerHTML='<div><h3>會員階級顯示規則</h3><p>活動票券、活動日曆與預約入口共用這項設定。鎖定預覽可以查看說明，符合資格後才能領取或使用。</p></div><label>顯示內容<select id="ticketVisibilityPolicy"><option value="eligible_only">只顯示符合目前階級的內容</option><option value="higher_preview">符合資格＋較高階級鎖定預覽</option></select></label><p id="ticketVisibilityStatus" role="status" aria-live="polite">正在載入設定…</p><button id="saveTicketVisibility" type="button" class="button button-dark" disabled>儲存顯示規則</button><button id="refreshTicketVisibility" type="button" class="button button-refresh">重新載入</button>';
    panel.prepend(section);
    const select=section.querySelector('select'),status=section.querySelector('[role="status"]'),button=section.querySelector('#saveTicketVisibility');
    const load=async()=>{try{session=await window.MemberAdminSession.wait();const result=await request('admin.ticket-visibility.get');version=result.updatedAt;select.value=result.visibilityPolicy;button.disabled=false;status.textContent='';}catch(error){button.disabled=true;status.textContent=error.message||'顯示設定載入失敗，請重新載入。';}};
    button.addEventListener('click',async()=>{if(busy)return;busy=true;button.disabled=true;try{const result=await request('admin.ticket-visibility.save',{visibilityPolicy:select.value,expectedUpdatedAt:version});version=result.updatedAt;status.textContent='已儲存，會員端將同步更新。';}catch(error){status.textContent=error.message;}finally{busy=false;button.disabled=false;}});
    section.querySelector('#refreshTicketVisibility').addEventListener('click',()=>{if(!busy)void load();});
    await load();
  });
})();
