(() => {
  'use strict';
  let busy=false;
  async function refresh(){
    if(busy)return;
    const session=window.MemberSystem?.getSession?.('event');
    const summary=document.getElementById('eventSummary');
    if(!session||!summary)return;
    busy=true;
    try{
      const response=await fetch(`${String(session.config?.supabaseUrl||'').replace(/\/$/,'')}/functions/v1/event-ticket-extension-api`,{
        method:'POST',
        headers:{'Content-Type':'application/json',apikey:String(session.config?.supabasePublishableKey||'')},
        cache:'no-store',
        body:JSON.stringify({
          operation:'member.today-usable',
          idToken:session.idToken,
          testSessionToken:String(window.TestModeClient?.getSessionToken?.()||'')
        })
      });
      const payload=await response.json().catch(()=>null);
      if(!response.ok||!payload||payload.ok!==true)throw new Error(payload?.error?.message||'今日可使用張數暫時無法取得');
      const data=payload.data||{};
      let badge=document.getElementById('todayUsableTicketCount');
      if(!badge){
        badge=document.createElement('span');
        badge.id='todayUsableTicketCount';
        badge.className='today-usable-ticket-count';
        summary.parentElement?.append(badge);
      }
      const usableCount=Math.max(0,Number(data.todayUsableCount||0));
      const availableCount=Math.max(0,Number(data.availableTodayCount ?? usableCount));
      const maxTickets=Math.max(1,Number(data.maxTicketsPerRedemption||1));
      badge.textContent=`今日可使用 ${usableCount} 張 · 單次上限 ${maxTickets} 張`;
      badge.dataset.businessDate=String(data.businessDate||'');
      badge.dataset.availableTodayCount=String(availableCount);
      badge.dataset.maxTicketsPerRedemption=String(maxTickets);
      badge.title=availableCount>usableCount?`目前共有 ${availableCount} 張可用；單次最多使用 ${maxTickets} 張。`:`目前共有 ${availableCount} 張可用活動票券。`;
      badge.classList.remove('is-error');
    }catch(error){
      let badge=document.getElementById('todayUsableTicketCount');
      if(!badge){
        badge=document.createElement('span');badge.id='todayUsableTicketCount';badge.className='today-usable-ticket-count';
        summary.parentElement?.append(badge);
      }
      badge.textContent='今日可使用張數暫時無法取得';
      badge.classList.add('is-error');
    }finally{busy=false;}
  }
  window.addEventListener('user-tour:ready',(event)=>{if(event?.detail?.surface==='event')void refresh();});
  window.addEventListener('focus',()=>void refresh());
  window.addEventListener('event-ticket:batch-redeemed',()=>void refresh());
  window.addEventListener('event-ticket:batch-redeemed',()=>void refresh());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh();});
  document.addEventListener('click',(event)=>{if(event.target?.closest?.('#ticketModalAction'))window.setTimeout(()=>void refresh(),800);},true);
})();
