(() => {
  'use strict';

  const state = { requestId: '', fingerprint: '', receiver: null, busy: false };

  function newRequestId() {
    const value = window.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2);
    return 'pt-' + value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 90);
  }
  function session() { return window.MemberSystem?.getSession?.('points') || null; }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function setMessage(message, error=false) {
    const target=document.getElementById('pointTransferMessage');
    if(!target) return;
    target.textContent=String(message||'');
    target.classList.toggle('hidden',!message);
    target.classList.toggle('error',Boolean(error));
  }
  function ensurePanel() {
    let panel=document.getElementById('pointTransferPanel');
    if(panel) return panel;
    const view=document.getElementById('pointsView');
    if(!view) return null;
    panel=el('section','point-transfer-panel');
    panel.id='pointTransferPanel';
    panel.setAttribute('aria-labelledby','pointTransferTitle');
    panel.innerHTML='<div class="point-transfer-heading"><div><p class="label dark-label">Member transfer</p><h2 id="pointTransferTitle">點數轉贈</h2><p>以會員編號確認收件人，送出後點數會以同一筆原子交易扣除與入帳。</p></div></div><form id="pointTransferForm" class="point-transfer-form"><label>集點卡<select id="pointTransferCard" required></select></label><label>收件會員編號<input id="pointTransferMemberCode" type="text" maxlength="40" autocomplete="off" placeholder="例如 MXXXXXXXXXX" required></label><button id="pointTransferLookup" class="button button-light" type="button">確認收件會員</button><p id="pointTransferReceiver" class="point-transfer-receiver hidden"></p><label>轉贈點數<input id="pointTransferAmount" type="number" min="1" step="1" required></label><button id="pointTransferSubmit" class="button button-dark" type="submit">確認轉贈</button><p id="pointTransferMessage" class="point-transfer-message hidden" role="status" aria-live="polite"></p></form>';
    const note=view.querySelector('.points-note');
    view.insertBefore(panel,note||null);
    const form=panel.querySelector('#pointTransferForm');
    const code=panel.querySelector('#pointTransferMemberCode');
    const card=panel.querySelector('#pointTransferCard');
    const amount=panel.querySelector('#pointTransferAmount');
    [code,card,amount].forEach(input=>input.addEventListener('input',()=>{state.receiver=null;state.requestId='';state.fingerprint='';renderReceiver();}));
    panel.querySelector('#pointTransferLookup').addEventListener('click',lookupReceiver);
    form.addEventListener('submit',submitTransfer);
    return panel;
  }
  async function loadOptions() {
    ensurePanel();
    const s=session();
    if(!s) return;
    const select=document.getElementById('pointTransferCard');
    try{
      const data=await window.MemberSystem.request(s.config,'points',s.idToken,'points.transfer.options');
      const cards=Array.isArray(data.cards)?data.cards:[];
      select.replaceChildren(...cards.map(card=>{
        const option=document.createElement('option');
        option.value=String(card.cardId||'');
        option.textContent=`${String(card.title||'集點卡')}｜可轉贈 ${Number(card.balance||0)} 點${card.expiresOn?'｜至 '+card.expiresOn:''}`;
        option.dataset.balance=String(Number(card.balance||0));
        return option;
      }));
      select.disabled=!cards.length;
      document.getElementById('pointTransferSubmit').disabled=!cards.length;
      if(!cards.length) setMessage('目前沒有可轉贈的點數。');
    }catch(error){setMessage(error?.message||'目前無法讀取可轉贈點數。',true);}
  }
  function renderReceiver(){
    const target=document.getElementById('pointTransferReceiver');
    if(!target)return;
    if(!state.receiver){target.textContent='';target.classList.add('hidden');return;}
    target.textContent=`收件會員：${state.receiver.displayName}（${state.receiver.memberCode}）`;
    target.classList.remove('hidden');
  }
  async function lookupReceiver(){
    const s=session(); if(!s)return;
    const memberCode=String(document.getElementById('pointTransferMemberCode').value||'').trim();
    if(!memberCode)return setMessage('請輸入收件會員編號。',true);
    setMessage('正在確認收件會員…');
    try{
      state.receiver=await window.MemberSystem.request(s.config,'points',s.idToken,'points.transfer.receiver',{memberCode});
      renderReceiver(); setMessage('已確認收件會員，請核對後再送出。');
    }catch(error){state.receiver=null;renderReceiver();setMessage(error?.message||'目前無法確認收件會員。',true);}
  }
  async function submitTransfer(event){
    event.preventDefault();
    if(state.busy)return;
    const s=session();if(!s)return;
    const cardId=String(document.getElementById('pointTransferCard').value||'');
    const memberCode=String(document.getElementById('pointTransferMemberCode').value||'').trim();
    const amount=Number(document.getElementById('pointTransferAmount').value);
    if(!state.receiver||state.receiver.memberCode!==memberCode)return setMessage('請先確認收件會員。',true);
    if(!Number.isSafeInteger(amount)||amount<=0)return setMessage('請輸入大於 0 的整數點數。',true);
    const fingerprint=JSON.stringify([cardId,memberCode,amount]);
    if(state.fingerprint!==fingerprint){state.requestId=newRequestId();state.fingerprint=fingerprint;}
    if(!window.confirm(`確定將 ${amount} 點轉贈給 ${state.receiver.displayName}（${memberCode}）嗎？`))return;
    state.busy=true;document.getElementById('pointTransferSubmit').disabled=true;setMessage('正在安全轉贈點數…');
    try{
      const result=await window.MemberSystem.request(s.config,'points',s.idToken,'points.transfer.create',{cardId,memberCode,amount,requestId:state.requestId});
      setMessage(`轉贈完成。交易編號 ${result.transferId}，目前剩餘 ${result.senderBalance} 點。`);
      state.requestId='';state.fingerprint='';state.receiver=null;renderReceiver();
      document.getElementById('pointTransferAmount').value='';
      await loadOptions();
    }catch(error){
      setMessage(error?.code==='API_RESPONSE_UNCERTAIN'?'結果尚未確認；請保持相同內容再次按「確認轉贈」，系統會沿用同一操作識別，不會重複扣點。':(error?.message||'點數轉贈失敗。'),true);
    }finally{state.busy=false;document.getElementById('pointTransferSubmit').disabled=false;}
  }
  window.addEventListener('user-tour:ready',(event)=>{if(event?.detail?.surface==='points')void loadOptions();});
  window.addEventListener('pageshow',()=>{if(!document.getElementById('pointsView')?.classList.contains('hidden'))void loadOptions();});
})();
