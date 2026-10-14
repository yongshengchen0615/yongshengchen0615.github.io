(() => {
  'use strict';
  const keyPrefix = 'booking-mode:v2:';
  const el = id => document.getElementById(id);
  let enabled = false;
  let memberId = '';
  let lastChatFeedback = null;
  function snapshotChatFeedback(result) {
    if (result?.alreadyApplied === true) return '此快照先前已送出，不會重複傳送 LINE 訊息。';
    if (result?.chatResult?.sent === true) return '已由你的 LINE 將「快照確認」傳送到官方帳號聊天。';
    if (result?.chatResult?.reason === 'not_in_line_chat')
      return '目前不是從 LINE 官方帳號聊天內開啟，未自動傳送聊天訊息；可回到官方帳號聊天告知管理員。';
    return 'LINE 聊天訊息未成功傳送，請回到官方帳號聊天告知管理員；快照送審不受影響。';
  }
  window.BookingAccessibility = Object.freeze({ getPreferenceKey: () => memberId ? keyPrefix + memberId : '' });
  function renderLocationState({ status = 'idle', message = '' } = {}) {
    const statusLabel = el('bookingSnapshotLocationStatus');
    const retry = el('bookingSnapshotLocationRetry');
    const upload = el('bookingAccessibleUpload');
    if (upload) upload.disabled = enabled && status !== 'ready';
    if (retry) retry.classList.toggle('hidden', status !== 'error');
    if (!statusLabel) return;
    statusLabel.textContent = status === 'ready'
      ? 'GPS 已定位，可以拍攝快照收據。送出時會再次確認定位有效性。'
      : status === 'requesting' ? '正在取得 GPS 定位，請允許裝置提供位置…'
      : status === 'error' ? (message || '定位失敗，請按「重新定位」。')
      : '切換到快照模式後將請求 GPS 定位。';
    statusLabel.classList.toggle('error', status === 'error');
  }

  function setMode(value, persist = false) {
    enabled = Boolean(value);
    document.body.classList.toggle('booking-accessible-mode', enabled);
    el('bookingAccessiblePanel')?.classList.toggle('hidden', !enabled);
    const toggle = el('bookingAccessibleToggle');
    toggle?.setAttribute('aria-pressed', String(enabled));
    if (toggle) toggle.textContent = enabled ? '返回一般預約模式' : '開啟快照模式';
    if (el('bookingModeTitle')) el('bookingModeTitle').textContent = enabled ? '快照模式' : '一般預約模式';
    if (el('bookingModeDescription')) el('bookingModeDescription').textContent = enabled
      ? '完成服務後拍收據，交由管理員核對登記。'
      : '自行選擇日期、服務項目與時段。';
    if (persist && memberId) {
      try { localStorage.setItem(keyPrefix + memberId, enabled ? 'accessible' : 'general'); }
      catch { if (el('bookingModePreference')) el('bookingModePreference').textContent = '此裝置無法儲存偏好；重新開啟時會使用一般模式。'; }
    }
    if (enabled) {
      renderLocationState({ status: 'requesting' });
      // Browser permission must be requested as part of the mode-toggle gesture.
      void window.BookingReceipts?.beginSnapshotMode?.().catch(() => {});
      renderTickets(window.BookingBenefits?.getItems?.() || []);
      void window.BookingReceipts?.refresh?.();
    } else {
      window.BookingReceipts?.endSnapshotMode?.();
      renderLocationState();
    }
  }
  function renderTickets(items) {
    const host = el('bookingAccessibleTickets');
    if (!host) return;
    host.replaceChildren();
    const tickets = (Array.isArray(items) ? items : []).filter(item =>
      ['points', 'event'].includes(item.kind)
      // A future general reservation does not block a separate snapshot when
      // the server confirms surplus points can cover both redemptions.
      && (item.selectable === true || (item.kind === 'event' && item.claimRequired === true)));
    tickets.forEach(item => {
      const card = document.createElement('article');
      card.className = 'ui-ticket snapshot-overview-ticket';
      card.dataset.kind = item.kind;
      if (item.kind === 'points') card.dataset.cardStyle = window.MemberUI.pointCardStyleKey(item.cardStyleKey);
      const heading = document.createElement('div');
      heading.className = 'snapshot-overview-heading';
      const headingCopy = document.createElement('div');
      headingCopy.className = 'snapshot-overview-heading-copy';
      const kind = document.createElement('span');
      kind.className = 'snapshot-overview-kind';
      kind.textContent = item.kind === 'points' ? '集點卡票券' : '活動票券';
      const title = document.createElement('h4');
      title.textContent = String(item.title || '可用票券');
      headingCopy.append(kind, title);
      const state = document.createElement('span');
      state.className = 'snapshot-overview-status';
      state.textContent = item.claimRequired ? '尚未領取' : '可供登記';
      heading.append(headingCopy, state);
      card.append(heading);
      if (item.cardTitle && item.kind === 'points') {
        const source = document.createElement('p');
        source.className = 'snapshot-overview-source';
        source.textContent = '來源集點卡：' + String(item.cardTitle);
        card.append(source);
      }
      const condition = document.createElement('p');
      condition.className = 'snapshot-overview-condition';
      condition.textContent = String(item.conditionLabel || item.subtitle || '依票券使用條件核對');
      const expiry = document.createElement('p');
      expiry.className = 'snapshot-overview-expiry';
      expiry.textContent = item.endsOn ? `有效至 ${item.endsOn}` : '依票券有效期限使用';
      card.append(condition, expiry);
      if (item.kind === 'points') card.append(window.MemberUI.pointTicketDetails(item));
      if (item.claimRequired) {
        const help = document.createElement('p');
        help.className = 'snapshot-overview-claim-help';
        help.textContent = '拍攝快照時可先領取，領取後仍需符合票券條件。';
        card.append(help);
      }
      host.append(card);
    });
    if (el('bookingAccessibleTicketsStatus')) {
      el('bookingAccessibleTicketsStatus').textContent = tickets.length
        ? `目前有 ${tickets.length} 張可登記／待領取票券，請於拍攝快照時勾選。`
        : '目前沒有可登記或可領取的票券；仍可送出快照收據。';
    }
  }
  function renderSnapshotHistory(submissions) {
    const view=el('bookingView');if(!view)return;
    let host=el('bookingSnapshotHistory');if(!host){host=document.createElement('section');host.id='bookingSnapshotHistory';host.className='booking-card';view.append(host);}
    host.replaceChildren();const rows=Array.isArray(submissions) ? submissions : [];host.hidden=!rows.length;if(!rows.length)return;
    const heading=document.createElement('h2');heading.textContent='快照預約明細';host.append(heading);
    const requested=new URLSearchParams(window.location.search).get('receiptId');
    for(const row of rows){
      const details=document.createElement('details');details.className='member-booking-details';details.dataset.receiptId=String(row.receiptId || '');
      const summary=document.createElement('summary');summary.textContent=`${row.cancelled ? '已撤回' : row.dismissed ? '需重新提供收據' : row.status==='bound' ? '已登記' : '待審核'} · ${String(row.receiptId || '')}`;details.append(summary);
      const add=text=>{const p=document.createElement('p');p.textContent=text;details.append(p);};
      add('送出時間：'+String(row.createdAt || '—'));
      const benefits=Array.isArray(row.requestedBenefits) ? row.requestedBenefits : [];
      add('本次登記票券：'+(benefits.map(x=>String(x.title || x.id || '票券')).join('、') || '未選用'));
      const settlement=Array.isArray(row.settlement) ? row.settlement[0] : row.settlement;
      if(settlement)add(`已核准服務時間：${Number(settlement.service_minutes || 0)} 分鐘`);
      if(requested===String(row.receiptId)){details.classList.add('booking-detail-target');window.requestAnimationFrame(()=>details.scrollIntoView?.({block:'center'}));}
      host.append(details);
    }
  }
  function renderStatus(submissions) {
    renderSnapshotHistory(submissions);
    const status = el('bookingAccessibleStatus');
    if (!status) return;
    const latest = (Array.isArray(submissions) ? submissions : []).find(r => ['awaiting_review','bound'].includes(r.status) || r.dismissed || r.cancelled);
    if (!latest) { status.textContent = '尚未送出收據。'; return; }
    if (latest.status === 'awaiting_review') {
      status.textContent = '收據已送出，等待管理員登記。再次拍攝會取代目前待登記收據。';
      if (latest.requestedBenefits?.length) status.textContent += ` 登記票券：${latest.requestedBenefits.map(item => item.title || item.id).join('、')}。`;
      const cancel = document.createElement('button'); cancel.type='button'; cancel.className='button button-outline'; cancel.textContent='撤回登記';
      cancel.addEventListener('click', async () => {
        if (!window.confirm('撤回這次收據與票券登記？尚未核准的票券不會核銷。')) return;
        cancel.disabled=true;
        try { const session=window.BookingSystem.getSession(); await window.BookingSystem.request(session.config,'booking',session.idToken,'user.booking.receipt.cancel',{receiptId:latest.receiptId,expectedUpdatedAt:latest.updatedAt}); await window.BookingReceipts.refresh(); }
        catch(error) {status.textContent=error?.message||'無法撤回，請重新整理後確認狀態。';}
      });
      status.append(cancel);
      if (lastChatFeedback?.receiptId === String(latest.receiptId || '')) {
        status.append(document.createTextNode(' ' + lastChatFeedback.message));
      }
    } else if (latest.cancelled) {
      status.textContent = '已撤回收據與票券登記，未執行核銷。';
    } else if (latest.dismissed) {
      status.textContent = '管理員請您重新提供收據，請確認內容後再次拍攝。';
    } else {
      const settlement = Array.isArray(latest.settlement) ? latest.settlement[0] : latest.settlement;
      const minutes = Number(settlement?.service_minutes || 0);
      const rewards = Array.isArray(settlement?.reward_details) ? settlement.reward_details : [];
      const points = rewards.reduce((sum, reward) => sum + Math.max(0,Number(reward.points || 0)),0);
      status.textContent = `管理員已登記完成${settlement ? `：累積服務 ${minutes} 分鐘，獲得 ${points} 點。` : '，點數與服務時間已依規則記錄。'}`;
    }
  }
  window.addEventListener('DOMContentLoaded', () => {
    el('bookingAccessibleToggle')?.addEventListener('click', () => setMode(!enabled, true));
    el('bookingSnapshotLocationRetry')?.addEventListener('click', () => {
      if (!enabled) return;
      renderLocationState({ status: 'requesting' });
      void window.BookingReceipts?.beginSnapshotMode?.().catch(() => {});
    });
    window.addEventListener('booking:snapshot-location-state', event => {
      if (enabled) renderLocationState(event.detail);
    });
    el('bookingAccessibleUpload')?.addEventListener('click', () => window.BookingReceipts?.openAccessible?.());
    el('bookingAccessibleRefresh')?.addEventListener('click', () => {
      el('bookingAccessibleStatus').textContent = '正在更新登記狀態…';
      window.BookingBenefits?.syncNow?.(); void window.BookingReceipts?.refresh?.();
    });
    setMode(false);
  });
  // Resolve before revealing the booking view; the old shared key is deliberately ignored.
  window.addEventListener('booking:member-loaded', event => {
    const nextId = String(event.detail?.profile?.lineUserId || '');
    if (nextId === memberId) return;
    memberId = nextId;
    let preferred = false;
    if (el('bookingModePreference')) el('bookingModePreference').textContent = '切換後會記住此會員在本裝置的偏好。';
    try { preferred = Boolean(memberId) && localStorage.getItem(keyPrefix + memberId) === 'accessible'; }
    catch { if (el('bookingModePreference')) el('bookingModePreference').textContent = '此裝置無法儲存偏好；重新開啟時會使用一般模式。'; }
    setMode(preferred);
  });
  window.addEventListener('booking:benefits-loaded', event => renderTickets(event.detail?.items));
  window.addEventListener('booking:snapshot-benefit-options', event => { if (enabled) renderTickets(event.detail?.items); });
  window.addEventListener('booking:receipts-updated', event => renderStatus(event.detail?.submissions));
  window.addEventListener('booking:receipt-load-error', () => {
    if (el('bookingAccessibleStatus')) el('bookingAccessibleStatus').textContent = '暫時無法更新收據狀態，請按「更新登記狀態與票券」重試。';
  });
  window.addEventListener('booking:accessible-receipt-submitted', event => {
    const result = event.detail || {};
    const message = snapshotChatFeedback(result);
    lastChatFeedback = { receiptId: String(result.receiptId || ''), message };
    if (el('bookingAccessibleStatus')) {
      el('bookingAccessibleStatus').textContent = '收據已送出，等待管理員登記。' + ' ' + message;
    }
  });
  window.addEventListener('booking:view-shown', () => { if (enabled) void window.BookingReceipts?.refresh?.(); });
})();
