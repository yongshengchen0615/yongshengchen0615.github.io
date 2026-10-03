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
    section.innerHTML = '<div class="accessible-admin-queue-heading"><div><span class="accessible-admin-eyebrow">Accessible review</span><h3 id="accessibleAdminQueueTitle">無障礙收據審核</h3><p>依收據核對實際服務、票券與點數後完成補登。</p></div><span id="accessibleAdminQueueCount" class="accessible-admin-count-pill">0 筆待審核</span></div><div id="accessibleAdminQueueList" class="accessible-admin-queue-list"></div>';
    panel.prepend(section);
    renderQueue();
  }
  function renderQueue() {
    ensureQueue();
    const list = el('accessibleAdminQueueList');
    if (!list) return;
    list.replaceChildren();
    const count = el('accessibleAdminQueueCount');
    if (count) count.textContent = `${state.submissions.length} 筆待審核`;
    if (!state.submissions.length) {
      const empty = document.createElement('div'); empty.className = 'accessible-admin-empty';
      const strong = document.createElement('strong'); strong.textContent = '目前沒有等待審核的無障礙收據';
      const small = document.createElement('small'); small.textContent = '會員上傳新收據後會自動出現在這裡。';
      empty.append(strong,small); list.append(empty); return;
    }
    state.submissions.forEach(receipt => {
      const card = document.createElement('article'); card.className = 'accessible-admin-queue-card';
      const info = document.createElement('div'); info.className = 'accessible-admin-queue-info';
      const heading = document.createElement('div'); heading.className = 'accessible-admin-queue-member';
      const name = document.createElement('strong'); name.textContent = receipt.memberName || '會員';
      const status = document.createElement('span'); status.className = 'accessible-admin-status-pill'; status.textContent = '待審核';
      heading.append(name,status);
      const meta = document.createElement('div'); meta.className = 'accessible-admin-queue-meta';
      const code = document.createElement('span'); code.textContent = receipt.memberCode || '無會員編號';
      const time = document.createElement('time'); time.textContent = new Date(receipt.createdAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
      meta.append(code,time); info.append(heading,meta);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-dark accessible-admin-review-button';
      button.textContent = '開始審核'; button.addEventListener('click', () => { void open(receipt); });
      card.append(info,button); list.append(card);
    });
  }
  function ensureModal() {
    if (el('accessibleAdminModal')) return el('accessibleAdminModal');
    const modal = document.createElement('section');
    modal.id = 'accessibleAdminModal'; modal.className = 'booking-admin-modal hidden';
    modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true'); modal.setAttribute('aria-labelledby','accessibleAdminTitle');
    modal.innerHTML = `<div class="booking-admin-modal-card accessible-admin-card">
      <div class="booking-admin-modal-heading accessible-admin-modal-heading">
        <div><span class="accessible-admin-eyebrow">Receipt review</span><h2 id="accessibleAdminTitle">無障礙預約審核</h2><p>核對收據、服務、票券與點數後一次完成結算。</p></div>
        <button id="accessibleAdminClose" class="booking-admin-modal-close" type="button" aria-label="關閉">×</button>
      </div>
      <div class="accessible-admin-review-layout">
        <aside class="accessible-admin-receipt-pane" aria-label="收據預覽">
          <div class="accessible-admin-member-card">
            <span class="accessible-admin-eyebrow">Member</span>
            <strong id="accessibleAdminMember"></strong>
            <small id="accessibleAdminReceiptMeta"></small>
          </div>
          <div class="accessible-admin-receipt-frame">
            <div id="accessibleAdminImageLoading" class="accessible-admin-image-loading">正在載入收據…</div>
            <img id="accessibleAdminImage" class="hidden" alt="等待補登的收據快照">
          </div>
          <p class="accessible-admin-receipt-help">請先確認收據內容與本次服務一致，再進行右側審核。</p>
        </aside>
        <form id="accessibleAdminForm" class="accessible-admin-review-form">
          <section class="accessible-admin-review-section">
            <div class="accessible-admin-step-heading"><span>1</span><div><strong>確認預約來源</strong><small>可連結既有預約，避免重複登記。</small></div></div>
            <label class="accessible-admin-field">預約來源<select id="accessibleAdminExisting"><option value="">新增已完成的服務紀錄</option></select></label>
            <p class="accessible-admin-section-note">既有預約會沿用原服務項目；已完成的預約只補綁收據，不會再次集點或核銷。</p>
          </section>

          <fieldset id="accessibleAdminNewFields" class="accessible-admin-review-section"><legend class="sr-only">本次實際完成的服務</legend>
            <div class="accessible-admin-step-heading"><span>2</span><div><strong>核對實際服務</strong><small>填寫實際完成日期、時間與服務分鐘數。</small></div></div>
            <div class="accessible-admin-date-grid">
              <label class="accessible-admin-field">服務日期（營業日）<input id="accessibleAdminDate" type="date" required></label>
              <label class="accessible-admin-field">開始時間<input id="accessibleAdminTime" type="time" step="60" required></label>
            </div>
            <div id="accessibleAdminItems" class="accessible-admin-service-list"></div>
          </fieldset>

          <fieldset id="accessibleAdminBenefitFields" class="accessible-admin-review-section"><legend class="sr-only">本次票券審核</legend>
            <div class="accessible-admin-step-heading"><span>3</span><div><strong>審核票券與點數</strong><small>只允許仍可用且符合本次服務項目的票券。</small></div></div>
            <div id="accessibleAdminBenefits" class="accessible-admin-benefit-list"></div>
            <div id="accessibleAdminPointSummary" class="accessible-admin-point-summary" aria-live="polite"></div>
            <p id="accessibleAdminBenefitHint" class="accessible-admin-section-note"></p>
          </fieldset>

          <section class="accessible-admin-review-section accessible-admin-final-section">
            <div class="accessible-admin-step-heading"><span>4</span><div><strong>確認並完成</strong><small>可加入管理端備註，再送出完整結算。</small></div></div>
            <label class="accessible-admin-field">核對備註<textarea id="accessibleAdminNote" maxlength="500" rows="2" placeholder="例如：收據已核對、現場補登原因…"></textarea></label>
            <p id="accessibleAdminMessage" class="accessible-admin-message" role="status" aria-live="polite"></p>
          </section>

          <div class="booking-admin-actions accessible-admin-sticky-actions">
            <button id="accessibleAdminSubmit" class="button button-dark" type="submit" disabled>確認並完成審核</button>
            <button id="accessibleAdminDismiss" class="button button-outline" type="button" disabled>退回重拍</button>
          </div>
        </form>
      </div>
    </div>`
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
  function pointBudgetSnapshot() {
    const root = el('accessibleAdminBenefits');
    const budgets = new Map();
    if (!root) return budgets;
    [...root.querySelectorAll('[data-benefit-check][data-kind="points"]')].forEach(input => {
      const cardKey = String(input.dataset.pointCard || input.dataset.pointCardTitle || '未分類集點卡');
      const cardTitle = String(input.dataset.pointCardTitle || cardKey || '集點卡');
      const cost = Math.max(0, Number(input.dataset.pointCost || 0));
      const balance = Math.max(0, Number(input.dataset.pointBalance || 0));
      const current = budgets.get(cardKey) || {cardTitle, required:0, available:balance};
      current.available = Math.min(current.available, balance);
      if (input.checked) current.required += cost;
      budgets.set(cardKey, current);
    });
    return budgets;
  }
  function pointBudgetExceeded() {
    return [...pointBudgetSnapshot().values()].some(budget => budget.required > budget.available);
  }
  function updatePointBudgetSummary() {
    const root = el('accessibleAdminBenefits');
    const summary = el('accessibleAdminPointSummary');
    if (!root || !summary) return;
    const budgets = pointBudgetSnapshot();
    summary.replaceChildren();

    const selectedPointInputs = [...root.querySelectorAll('[data-benefit-check][data-kind="points"]:checked')];
    if (!selectedPointInputs.length) {
      const p = document.createElement('p');
      p.textContent = '目前未選擇集點卡票券；勾選後會即時計算本次扣點與剩餘點數。';
      summary.append(p);
    } else {
      [...budgets.values()].filter(budget => budget.required > 0).forEach(budget => {
        const remaining = Math.max(0, budget.available - budget.required);
        const card = document.createElement('div'); card.className = 'accessible-admin-point-card';
        const title = document.createElement('strong'); title.textContent = budget.cardTitle;
        const values = document.createElement('div'); values.className = 'accessible-admin-point-values';
        [['目前可用',budget.available],['本次扣除',budget.required],['審核後剩餘',remaining]].forEach(([label,value]) => {
          const item = document.createElement('span');
          const small = document.createElement('small'); small.textContent = label;
          const number = document.createElement('b'); number.textContent = `${value} 點`;
          item.append(small,number); values.append(item);
        });
        card.append(title,values);
        if (budget.required > budget.available) card.classList.add('error');
        summary.append(card);
      });
    }

    [...root.querySelectorAll('[data-benefit-check][data-kind="points"]')].forEach(input => {
      const baseDisabled = input.dataset.baseDisabled === 'true';
      if (baseDisabled || input.checked) {
        input.disabled = baseDisabled;
        return;
      }
      const cardKey = String(input.dataset.pointCard || input.dataset.pointCardTitle || '未分類集點卡');
      const budget = budgets.get(cardKey);
      const remaining = budget ? Math.max(0, budget.available - budget.required) : Math.max(0, Number(input.dataset.pointBalance || 0));
      const cost = Math.max(0, Number(input.dataset.pointCost || 0));
      input.disabled = cost > remaining;
      input.dataset.pointBudgetBlocked = input.disabled ? 'true' : 'false';
    });
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
      updatePointBudgetSummary();
      return;
    }

    const catalogItems = (state.options?.benefitCatalog?.items || []).filter(item => item.kind === 'points' || item.kind === 'event');
    const pendingKeys = new Set(currentBenefits.filter(item => item.status === 'pending').map(item => `${item.kind}:${item.id}`));
    const selectedServices = selectedServiceIds();
    const shownKeys = new Set();

    if (!catalogItems.length && !pendingKeys.size) {
      const p = document.createElement('p'); p.textContent = '目前沒有可審核的票券。'; root.append(p);
      updatePointBudgetSummary();
      return;
    }

    catalogItems.forEach(item => {
      const key = `${item.kind}:${item.selectionId || ''}`;
      if (item.selectionId) shownKeys.add(key);
      const required = Array.isArray(item.requiredServiceIds) ? item.requiredServiceIds.map(String).filter(Boolean) : [];
      const matchAll = item.requiredServiceMatchMode === 'all';
      const serviceEligible = !required.length || (matchAll ? required.every(id => selectedServices.has(id)) : required.some(id => selectedServices.has(id)));
      const row = document.createElement('div'); row.className = 'accessible-admin-benefit';
      const label = document.createElement('label');
      const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.benefitCheck = ''; check.dataset.kind = item.kind; check.dataset.selectionId = item.selectionId;
      check.checked = Boolean(item.selectionId) && pendingKeys.has(key) && item.selectable === true && serviceEligible;
      check.disabled = !item.selectionId || item.selectable !== true || !serviceEligible;
      check.dataset.baseDisabled = check.disabled ? 'true' : 'false';
      if (item.kind === 'points') {
        check.dataset.pointCard = String(item.cardId || item.cardTitle || '');
        check.dataset.pointCardTitle = String(item.cardTitle || '集點卡');
        check.dataset.pointCost = String(Math.max(0, Number(item.pointCost || 0)));
        check.dataset.pointBalance = String(Math.max(0, Number(item.pointBalance || 0)));
      }
      const copy = document.createElement('span'); copy.className = 'accessible-admin-benefit-copy';
      const top = document.createElement('span'); top.className = 'accessible-admin-benefit-title';
      const kind = document.createElement('em'); kind.className = `accessible-admin-benefit-kind kind-${item.kind}`; kind.textContent = item.kind === 'points' ? '集點卡' : '活動票券';
      const strong = document.createElement('strong'); strong.textContent = item.title || '預約票券';
      top.append(kind,strong);
      const small = document.createElement('small');
      const reason = !serviceEligible
        ? (item.requiredServiceRequirementLabel || '本次實際服務項目不符合票券限制')
        : (item.disabledReason || item.conditionLabel || item.subtitle || '');
      small.textContent = [item.subtitle, reason].filter(Boolean).filter((value,index,list)=>list.indexOf(value)===index).join(' · ');
      copy.append(top,small);
      if (item.kind === 'points') {
        const facts = document.createElement('span'); facts.className = 'accessible-admin-benefit-facts';
        const cost = Math.max(0,Number(item.pointCost || 0));
        const balance = Math.max(0,Number(item.pointBalance || 0));
        facts.textContent = `需 ${cost} 點 · 可用 ${balance} 點`;
        copy.append(facts);
      }
      label.append(check,copy); row.append(label); root.append(row);
      check.addEventListener('change', () => {
        if (check.checked) {
          const limit = benefitLimit(item.kind);
          const selected = [...root.querySelectorAll(`[data-benefit-check][data-kind="${item.kind}"]:checked`)].length;
          if (limit > 0 && selected > limit) {
            check.checked = false;
            message(item.kind === 'event' ? `活動票券本次最多可審核 ${limit} 張。` : `集點卡票券本次最多可審核 ${limit} 張。`, true);
          } else if (item.kind === 'points' && pointBudgetExceeded()) {
            const cardKey = String(check.dataset.pointCard || check.dataset.pointCardTitle || '未分類集點卡');
            const cost = Math.max(0, Number(check.dataset.pointCost || 0));
            const overBudget = pointBudgetSnapshot().get(cardKey);
            const remainingBeforeThisTicket = Math.max(0, Number(overBudget?.available || 0) - Math.max(0, Number(overBudget?.required || 0) - cost));
            check.checked = false;
            message(`會員目前可用點數不足：此票券需 ${cost} 點，目前這張集點卡只剩 ${remainingBeforeThisTicket} 點可再使用；請取消其他集點卡票券後再選擇。`, true);
          }
        }
        updatePointBudgetSummary();
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
    updatePointBudgetSummary();
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
    el('accessibleAdminMember').textContent = `${receipt.memberName || '會員'} · ${receipt.memberCode || '無會員編號'}`;
    el('accessibleAdminReceiptMeta').textContent = `上傳時間：${new Date(receipt.createdAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}`;
    el('accessibleAdminImageLoading').classList.remove('hidden');
    el('accessibleAdminImage').removeAttribute('src'); el('accessibleAdminImage').classList.add('hidden');
    el('accessibleAdminSubmit').disabled = true; el('accessibleAdminDismiss').disabled = true;
    el('accessibleAdminItems').replaceChildren();
    el('accessibleAdminBenefits').replaceChildren();
    el('accessibleAdminPointSummary').replaceChildren();
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
      el('accessibleAdminImage').src = image.signedUrl; el('accessibleAdminImage').classList.remove('hidden'); el('accessibleAdminImageLoading').classList.add('hidden');
      (options.bookings || []).forEach(booking => {
        el('accessibleAdminExisting').append(new Option(`${booking.bookingDate} ${booking.startTime} ${booking.status === 'completed' ? '已完成' : '已確認'} · ${booking.title}`,booking.bookingId));
      });
      (options.services || []).forEach(service => {
        const row = document.createElement('div'); row.className = 'accessible-admin-item'; row.dataset.serviceId = service.id;
        const choice = document.createElement('label'); choice.className = 'accessible-admin-service-choice';
        const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.serviceCheck = '';
        const rule = (options.rewardRules || []).find(rule => String(rule.serviceType).trim().toLowerCase() === String(service.service_type || '').trim().toLowerCase());
        const copy = document.createElement('span'); copy.className = 'accessible-admin-service-copy';
        const title = document.createElement('strong'); title.textContent = service.title || '服務項目';
        const meta = document.createElement('small');
        meta.textContent = `${service.service_type || '未分類'} · ${service.counts_toward_membership === false ? '不累計會員時間與點數' : rule ? `每 ${rule.minutesPerPoint} 分鐘集 1 點 · ${rule.cardTitle}` : '未設定集點規則，只記錄服務時間'}`;
        copy.append(title,meta); choice.append(check,copy);
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
      message(options.primaryTechnicianConfigured ? (options.rewardRules?.length ? '請依序核對收據、實際服務、票券與點數後完成審核。' : '目前未設定服務集點規則，這次只記錄服務時間；請先在服務類型設定集點卡與每點分鐘數，才會自動發點。') : '尚未設定主要技師；請先設定，或連結已有預約。',!options.primaryTechnicianConfigured);
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
    if (pointBudgetExceeded()) { message('會員目前可用點數不足，請取消部分集點卡票券後再完成審核。',true); updatePointBudgetSummary(); return; }
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
