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
      const data=await window.MemberSystem.request(session.config,'event',session.idToken,'event.today-usable');
      let badge=document.getElementById('todayUsableTicketCount');
      if(!badge){
        badge=document.createElement('span');
        badge.id='todayUsableTicketCount';
        badge.className='today-usable-ticket-count';
        summary.parentElement?.append(badge);
      }
      badge.textContent=`今日可使用 ${Math.max(0,Number(data.todayUsableCount||0))} 張`;
      badge.dataset.businessDate=String(data.businessDate||'');
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
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh();});
  document.addEventListener('click',(event)=>{if(event.target?.closest?.('#ticketModalAction'))window.setTimeout(()=>void refresh(),800);},true);
})();
