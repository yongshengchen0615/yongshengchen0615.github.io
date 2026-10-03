(() => {
  'use strict';
  const state = { submissions: [], selected: null, busy: false, generation: 0, options: null };
  const el = id => document.getElementById(id);
  async function request(action, payload = {}) {
    const session = window.MemberSystem?.getSession?.('admin');
    if (!session) throw new Error('管理端登入已失效，請重新登入。');
    return window.MemberSystem.request(session.config, 'admin', session.idToken, action, payload);
  }
  function message(text, error = false) {
    const target = el('accessibleAdminMessage');
    if (!target) return;
    target.textContent = text;
    target.classList.toggle('error', error);
  }
  function ensureQueue() {
    const panel = el('bookingAdminQueuePanel');
    if (!panel || el('accessibleAdminQueue')) return;
    const section = document.createElement('section');
    section.id = 'accessibleAdminQueue';
    section.className = 'accessible-admin-queue';
    section.setAttribute('aria-labelledby','accessibleAdminQueueTitle');
    section.innerHTML = '<h3 id="accessibleAdminQueueTitle">無障礙收據・等待補登</h3><p>核對收據後補登實際服務，或連結已有預約，系統會依既有規則記錄點數與服務時間。</p><div id="accessibleAdminQueueList"></div>';
    panel.prepend(section);
    renderQueue();
  }
  function renderQueue() {
    ensureQueue();
    const list = el('accessibleAdminQueueList');
    if (!list) return;
    list.replaceChildren();
    if (!state.submissions.length) { const p = document.createElement('p'); p.textContent = '目前沒有等待補登的收據。'; list.append(p); return; }
    state.submissions.forEach(receipt => {
      const card = document.createElement('article');
      const copy = document.createElement('p');
      copy.textContent = `${receipt.memberName} · ${receipt.memberCode} · ${new Date(receipt.createdAt).toLocaleString('zh-TW', { timeZone:'Asia/Taipei' })}`;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-dark';
      button.textContent = '核對收據並登記服務'; button.addEventListener('click', () => { void open(receipt); });
      card.append(copy,button); list.append(card);
    });
  }
  function ensureModal() {
    if (el('accessibleAdminModal')) return el('accessibleAdminModal');
    const modal = document.createElement('section');
    modal.id = 'accessibleAdminModal'; modal.className = 'booking-admin-modal hidden';
    modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.setAttribute('aria-labelledby','accessibleAdminTitle');
    modal.innerHTML = `<div class="booking-admin-modal-card accessible-admin-card">
      <div class="booking-admin-modal-heading"><h2 id="accessibleAdminTitle">收據服務補登</h2><button id="accessibleAdminClose" class="booking-admin-modal-close" type="button" aria-label="關閉">×</button></div>
      <p id="accessibleAdminMember"></p>
      <img id="accessibleAdminImage" class="hidden" alt="等待補登的收據快照">
      <form id="accessibleAdminForm">
        <label>連結已有預約（避免重複登記）<select id="accessibleAdminExisting"><option value="">新增已完成的服務紀錄</option></select></label>
        <p>已有預約會沿用原服務項目；已完成的預約只補綁收據，不重複集點。新增紀錄按主要技師的服務項目結算。</p>
        <fieldset id="accessibleAdminNewFields"><legend>本次實際完成的服務</legend>
          <label>服務日期（營業日）<input id="accessibleAdminDate" type="date" required></label>
          <label>開始時間<input id="accessibleAdminTime" type="time" step="60" required></label>
          <p>僅登記已完成的服務。凌晨時段的營業日依目前跨日營業設定計算。</p>
          <div id="accessibleAdminItems"></div>
        </fieldset>
        <fieldset id="accessibleAdminBenefitFields"><legend>本次票券審核</legend>
          <p>請核對會員本次要使用的活動票券與集點卡票券。只有已領取、仍可用且符合本次服務項目的票券才能核銷。</p>
          <div id="accessibleAdminBenefits"></div>
          <p id="accessibleAdminBenefitHint"></p>
        </fieldset>
        <label>核對備註<textarea id="accessibleAdminNote" maxlength="500" rows="2"></textarea></label>
        <p id="accessibleAdminMessage" role="status" aria-live="polite"></p>
        <div class="booking-admin-actions"><button id="accessibleAdminSubmit" class="button button-dark" type="submit" disabled>確認收據並補登完成</button>
          <button id="accessibleAdminDismiss" class="button button-outline" type="button" disabled>退回，請會員重拍</button></div>
      </form></div>`;
    document.body.append(modal);
    el('accessibleAdminClose').addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    el('accessibleAdminExisting').addEventListener('change', () => { void handleExistingBookingChange(); });
    el('accessibleAdminForm').addEventListener('submit', submit);
    el('accessibleAdminDismiss').addEventListener('click', dismiss);
    return modal;
  }
  function selectedServiceIds() {
    const bookingId = el('accessibleAdminExisting')?.value || '';
    if (bookingId) return new Set((state.options?.currentBookingServiceIds || []).map(String));
    return new Set([...el('accessibleAdminItems').children]
      .filter(row => row.querySelector('[data-service-check]')?.checked)
      .map(row => String(row.dataset.serviceId || ''))
      .filter(Boolean));
  }
  function benefitLimit(kind) {
    const catalog = state.options?.benefitCatalog || {};
    const raw = kind === 'event' ? catalog.eventTicketMaxPerDay : catalog.pointTicketMaxPerRedemption;
    const value = Number(raw ?? 0);
    return Number.isInteger(value) && value >= 0 ? value : 1;
  }
  function collectBenefits() {
    return [...el('accessibleAdminBenefits').querySelectorAll('[data-benefit-check]:checked')]
      .map(input => ({kind:String(input.dataset.kind || ''),id:String(input.dataset.selectionId || '')}))
      .filter(item => item.id && (item.kind === 'points' || item.kind === 'event'));
  }
  function renderBenefits() {
    const root = el('accessibleAdminBenefits');
    const hint = el('accessibleAdminBenefitHint');
    if (!root || !hint) return;
    root.replaceChildren();
    hint.textContent = '';

    const currentBenefits = Array.isArray(state.options?.currentBenefits) ? state.options.currentBenefits : [];
    const currentStatus = String(state.options?.currentBookingStatus || '');
    if (currentStatus === 'completed') {
      if (!currentBenefits.length) {
        const p = document.createElement('p'); p.textContent = '這筆既有預約沒有使用票券。'; root.append(p);
      } else {
        currentBenefits.forEach(benefit => {
          const row = document.createElement('div'); row.className = 'accessible-admin-benefit';
          const strong = document.createElement('strong'); strong.textContent = benefit.title || '預約票券';
          const small = document.createElement('small');
          small.textContent = benefit.status === 'redeemed' || benefit.status === 'applied' ? '已完成核銷' : `狀態：${benefit.status || '已記錄'}`;
          row.append(strong,small); root.append(row);
        });
      }
      hint.textContent = '已完成的既有預約只補綁收據，不會再次變更或核銷票券。';
      return;
    }

    const catalogItems = (state.options?.benefitCatalog?.items || []).filter(item => item.kind === 'points' || item.kind === 'event');
    const pendingKeys = new Set(currentBenefits.filter(item => item.status === 'pending').map(item => `${item.kind}:${item.id}`));
    const selectedServices = selectedServiceIds();
    const shownKeys = new Set();

    if (!catalogItems.length && !pendingKeys.size) {
      const p = document.createElement('p'); p.textContent = '目前沒有可審核的票券。'; root.append(p);
      return;
    }

    catalogItems.forEach(item => {
      const key = `${item.kind}:${item.selectionId || ''}`;
      if (!item.selectionId) return;
      shownKeys.add(key);
      const required = Array.isArray(item.requiredServiceIds) ? item.requiredServiceIds.map(String).filter(Boolean) : [];
      const matchAll = item.requiredServiceMatchMode === 'all';
      const serviceEligible = !required.length || (matchAll ? required.every(id => selectedServices.has(id)) : required.some(id => selectedServices.has(id)));
      const row = document.createElement('div'); row.className = 'accessible-admin-benefit';
      const label = document.createElement('label');
      const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.benefitCheck = ''; check.dataset.kind = item.kind; check.dataset.selectionId = item.selectionId;
      check.checked = pendingKeys.has(key) && item.selectable === true && serviceEligible;
      check.disabled = item.selectable !== true || !serviceEligible;
      const copy = document.createElement('span');
      const strong = document.createElement('strong'); strong.textContent = item.title || '預約票券';
      const small = document.createElement('small');
      const reason = !serviceEligible
        ? (item.requiredServiceRequirementLabel || '本次實際服務項目不符合票券限制')
        : (item.disabledReason || item.conditionLabel || item.subtitle || '');
      small.textContent = [item.subtitle, reason].filter(Boolean).filter((value,index,list)=>list.indexOf(value)===index).join(' · ');
      copy.append(strong,small); label.append(check,copy); row.append(label); root.append(row);
      check.addEventListener('change', () => {
        if (!check.checked) return;
        const limit = benefitLimit(item.kind);
        const selected = [...root.querySelectorAll(`[data-benefit-check][data-kind="${item.kind}"]:checked`)].length;
        if (limit > 0 && selected > limit) {
          check.checked = false;
          message(item.kind === 'event' ? `活動票券本次最多可審核 ${limit} 張。` : `集點卡票券本次最多可審核 ${limit} 張。`, true);
        }
      });
    });

    currentBenefits.filter(item => item.status === 'pending').forEach(item => {
      const key = `${item.kind}:${item.id}`;
      if (shownKeys.has(key)) return;
      const row = document.createElement('div'); row.className = 'accessible-admin-benefit accessible-admin-benefit-warning';
      const strong = document.createElement('strong'); strong.textContent = item.title || '原預約票券';
      const small = document.createElement('small'); small.textContent = '此票券目前已不可使用；送出審核時會取消這筆預約的票券保留。';
      row.append(strong,small); root.append(row);
    });

    const eventLimit = benefitLimit('event');
    const pointLimit = benefitLimit('points');
    hint.textContent = `活動票券：${eventLimit === 0 ? '張數不限' : `最多 ${eventLimit} 張`}；集點卡票券：${pointLimit === 0 ? '張數不限' : `最多 ${pointLimit} 張`}。管理員不可代替會員領取尚未領取的活動票券。`;
  }
  async function handleExistingBookingChange() {
    const bookingId = el('accessibleAdminExisting')?.value || '';
    el('accessibleAdminNewFields').disabled = Boolean(bookingId);
    if (!state.selected || state.busy) return;
    const generation = ++state.generation;
    el('accessibleAdminSubmit').disabled = true;
    el('accessibleAdminBenefitFields').disabled = true;
    message('正在重新核對這筆預約的票券…');
    try {
      const options = await request('admin.booking.receipt.options',{receiptId:state.selected.receiptId,bookingId});
      if (generation !== state.generation) return;
      state.options = options;
      renderBenefits();
      el('accessibleAdminSubmit').disabled = false;
      message(options.currentBookingStatus === 'completed'
        ? '這筆預約已完成；請核對既有票券紀錄後補綁收據。'
        : '請核對收據、實際服務與本次使用票券後送出。');
    } catch (error) {
      if (generation === state.generation) message(error.message || '目前無法載入票券審核資料。',true);
    } finally {
      if (generation === state.generation) el('accessibleAdminBenefitFields').disabled = false;
    }
  }
  function close() {
    if (state.busy) return;
    state.generation++;
    el('accessibleAdminModal')?.classList.add('hidden');
    el('accessibleAdminImage')?.removeAttribute('src');
    state.selected = null;
  }
  async function open(receipt) {
    if (state.busy) return;
    const modal = ensureModal();
    el('accessibleAdminForm').reset(); el('accessibleAdminNewFields').disabled = false;
    state.selected = receipt; state.options = null;
    const generation = ++state.generation;
    modal.classList.remove('hidden');
    el('accessibleAdminMember').textContent = `${receipt.memberName} · ${receipt.memberCode}`;
    el('accessibleAdminImage').removeAttribute('src'); el('accessibleAdminImage').classList.add('hidden');
    el('accessibleAdminSubmit').disabled = true; el('accessibleAdminDismiss').disabled = true;
    el('accessibleAdminItems').replaceChildren();
    el('accessibleAdminBenefits').replaceChildren();
    el('accessibleAdminBenefitHint').textContent = '';
    el('accessibleAdminExisting').replaceChildren(new Option('新增已完成的服務紀錄',''));
    message('正在載入收據與登記選項…');
    try {
      const [image, options] = await Promise.all([
        request('admin.booking.receipt.url',{receiptId:receipt.receiptId}),
        request('admin.booking.receipt.options',{receiptId:receipt.receiptId}),
      ]);
      if (generation !== state.generation) return;
      state.options = options;
      el('accessibleAdminImage').src = image.signedUrl; el('accessibleAdminImage').classList.remove('hidden');
      (options.bookings || []).forEach(booking => {
        el('accessibleAdminExisting').append(new Option(`${booking.bookingDate} ${booking.startTime} ${booking.status === 'completed' ? '已完成' : '已確認'} · ${booking.title}`,booking.bookingId));
      });
      (options.services || []).forEach(service => {
        const row = document.createElement('div'); row.className = 'accessible-admin-item'; row.dataset.serviceId = service.id;
        const choice = document.createElement('label'); const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.serviceCheck = '';
        const rule = (options.rewardRules || []).find(rule => String(rule.serviceType).trim().toLowerCase() === String(service.service_type || '').trim().toLowerCase());
        choice.append(check, document.createTextNode(`${service.title}（${service.service_type || '未分類'}）${service.counts_toward_membership === false ? '・不累計會員時間與點數' : rule ? `・每 ${rule.minutesPerPoint} 分鐘集 1 點（${rule.cardTitle}）` : '・未設定集點規則，只記錄服務時間'}`));
        const minutesLabel = document.createElement('label'); minutesLabel.textContent = '每次實際分鐘';
        const minutes = document.createElement('input'); minutes.type='number'; minutes.min='1'; minutes.max='720'; minutes.step='1'; minutes.value=String(service.duration_minutes || 30); minutes.dataset.minutes=''; minutes.disabled=true; minutesLabel.append(minutes);
        const quantityLabel = document.createElement('label'); quantityLabel.textContent = '次數';
        const quantity = document.createElement('input'); quantity.type='number'; quantity.min='1'; quantity.max='20'; quantity.step='1'; quantity.value='1'; quantity.dataset.quantity=''; quantity.disabled=true; quantityLabel.append(quantity);
        check.addEventListener('change', () => {
          minutes.disabled=!check.checked; quantity.disabled=!check.checked; minutes.required=check.checked; quantity.required=check.checked;
          renderBenefits();
        });
        row.append(choice,minutesLabel,quantityLabel); el('accessibleAdminItems').append(row);
      });
      renderBenefits();
      el('accessibleAdminDate').value = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      el('accessibleAdminSubmit').disabled = false; el('accessibleAdminDismiss').disabled = false;
      message(options.primaryTechnicianConfigured ? (options.rewardRules?.length ? '請核對收據、服務日期與實際分鐘後送出。' : '目前未設定服務集點規則，這次只記錄服務時間；請先在服務類型設定集點卡與每點分鐘數，才會自動發點。') : '尚未設定主要技師；請先設定，或連結已有預約。',!options.primaryTechnicianConfigured);
    } catch (error) { if (generation === state.generation) message(error.message || '目前無法載入登記選項。',true); }
  }
  function lock(value) {
    state.busy = value;
    el('accessibleAdminClose').disabled = value;
    el('accessibleAdminSubmit').disabled = value;
    el('accessibleAdminDismiss').disabled = value;
    el('accessibleAdminForm').setAttribute('aria-busy',String(value));
  }
  async function refresh() {
    try { const data = await request('admin.booking.receipt.list'); state.submissions = data.submissions || []; renderQueue(); }
    catch { /* Existing receipt refresh reports read errors. */ }
  }
  async function submit(event) {
    event.preventDefault();
    if (state.busy || !state.selected || !state.options) return;
    const receipt = state.selected;
    const bookingId = el('accessibleAdminExisting').value;
    const items = [...el('accessibleAdminItems').children].filter(row => row.querySelector('[data-service-check]').checked)
      .map(row => ({serviceId:row.dataset.serviceId,minutes:Number(row.querySelector('[data-minutes]').value),quantity:Number(row.querySelector('[data-quantity]').value)}));
    if (!bookingId && !items.length) { message('請勾選至少一個實際完成的服務項目。',true); return; }
    const benefits = collectBenefits();
    lock(true); message('正在審核票券、登記服務並結算，請稍候…');
    try {
      const result = await request('admin.booking.receipt.register',{
        receiptId:receipt.receiptId,expectedUpdatedAt:receipt.updatedAt,bookingId,
        bookingDate:el('accessibleAdminDate').value,startTime:el('accessibleAdminTime').value,items,benefits,adminNote:el('accessibleAdminNote').value,
      });
      const settlement = result.settlement || {};
      const points = (settlement.rewards || []).reduce((sum,reward) => sum+Math.max(0,Number(reward.points || 0)),0);
      const redemptions = Array.isArray(settlement.redemptions) ? settlement.redemptions.length : 0;
      message(`已登記完成：會員服務 ${Number(settlement.serviceMinutes || 0)} 分鐘，獲得 ${points} 點，核銷 ${redemptions} 張票券${result.alreadyApplied ? '（原登記已完成，未重複結算）' : ''}。`);
      state.selected = null;
      await refresh();
      window.dispatchEvent(new CustomEvent('member-admin:booking-snapshot-request'));
      window.dispatchEvent(new CustomEvent('member-admin:booking-registration-completed',{detail:{bookingId:result.bookingId}}));
    } catch (error) { message(error.code === 'API_RESPONSE_UNCERTAIN' ? '結果尚未確認。請用同一張收據重試；系統不會重複集點。' : error.message || '登記未完成。',true); }
    finally { lock(false); if (!state.selected) { el('accessibleAdminSubmit').disabled=true; el('accessibleAdminDismiss').disabled=true; } }
  }
  async function dismiss() {
    if (state.busy || !state.selected || !window.confirm('退回這張收據，請會員重新拍攝？本次不會新增點數與服務時間。')) return;
    lock(true);
    try { await request('admin.booking.receipt.dismiss',{receiptId:state.selected.receiptId,expectedUpdatedAt:state.selected.updatedAt}); state.selected=null; await refresh(); message('已退回收據，會員可重新拍攝。'); }
    catch(error) { message(error.message || '目前無法退回收據。',true); }
    finally { lock(false); if (!state.selected) { el('accessibleAdminSubmit').disabled=true; el('accessibleAdminDismiss').disabled=true; } }
  }
  window.addEventListener('admin:accessible-receipts-updated', event => { state.submissions=event.detail?.submissions || []; renderQueue(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !el('accessibleAdminModal')?.classList.contains('hidden')) close(); });
  const observer = new MutationObserver(ensureQueue);
  window.addEventListener('DOMContentLoaded', () => { ensureQueue(); observer.observe(document.body,{childList:true,subtree:true}); });
  window.addEventListener('pagehide', () => observer.disconnect());
  window.addEventListener('pageshow', () => observer.observe(document.body,{childList:true,subtree:true}));
})();
