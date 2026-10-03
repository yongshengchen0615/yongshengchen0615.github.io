(() => {
  'use strict';

  const state = {
    requestId: '',
    fingerprint: '',
    receiver: null,
    receiverGeneration: 0,
    busy: false,
    activeCardId: '',
    activeCardTitle: '',
    memberCode: '',
    options: new Map(),
    loaded: false,
    refreshPromise: null,
    refreshQueued: false
  };

  function newRequestId() {
    const value = window.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2);
    return 'pt-' + value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 90);
  }

  function session() {
    return window.MemberSystem?.getSession?.('points') || null;
  }

  function setMessage(message, error = false) {
    const target = document.getElementById('pointTransferMessage');
    if (!target) return;
    target.textContent = String(message || '');
    target.classList.toggle('hidden', !message);
    target.classList.toggle('error', Boolean(error));
  }

  function clearReceiver() {
    state.receiverGeneration += 1;
    state.receiver = null;
    state.requestId = '';
    state.fingerprint = '';
    renderReceiver();
  }

  function renderReceiver() {
    const target = document.getElementById('pointTransferReceiver');
    if (!target) return;
    if (!state.receiver) {
      target.textContent = '';
      target.classList.add('hidden');
      return;
    }
    target.textContent = `收件會員：${state.receiver.displayName}（${state.receiver.memberCode}）`;
    target.classList.remove('hidden');
  }

  function ensureModal() {
    let modal = document.getElementById('pointTransferModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'pointTransferModal';
    modal.className = 'point-transfer-modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pointTransferTitle');
    modal.innerHTML = `
      <section class="point-transfer-card">
        <div class="point-transfer-heading">
          <div>
            <p class="point-transfer-kicker">Member transfer</p>
            <h2 id="pointTransferTitle">點數轉贈</h2>
            <p id="pointTransferCardSummary" class="point-transfer-card-summary">目前集點卡</p>
          </div>
          <button id="pointTransferClose" class="point-transfer-close" type="button" aria-label="關閉點數轉贈">×</button>
        </div>
        <section class="point-transfer-own-code" aria-label="我的會員編號">
          <div class="point-transfer-own-code-text">
            <span>我的會員編號</span>
            <strong id="pointTransferOwnMemberCode">讀取中…</strong>
          </div>
          <button id="pointTransferCopyOwnCode" class="point-transfer-copy-button" type="button" disabled>複製會員編號</button>
        </section>
        <form id="pointTransferForm" class="point-transfer-form">
          <input id="pointTransferCard" type="hidden">
          <label>
            <span>收件會員編號</span>
            <input id="pointTransferMemberCode" type="text" maxlength="40" autocomplete="off" placeholder="例如 MXXXXXXXXXX" required>
          </label>
          <button id="pointTransferLookup" class="point-transfer-secondary-button" type="button">確認收件會員</button>
          <p id="pointTransferReceiver" class="point-transfer-receiver hidden"></p>
          <label>
            <span>轉贈點數</span>
            <input id="pointTransferAmount" type="number" min="1" step="1" inputmode="numeric" required>
          </label>
          <p id="pointTransferBalanceHint" class="point-transfer-balance-hint"></p>
          <button id="pointTransferSubmit" class="point-transfer-submit" type="submit">確認轉贈</button>
          <p id="pointTransferMessage" class="point-transfer-message hidden" role="status" aria-live="polite"></p>
        </form>
      </section>`;

    document.body.append(modal);
    modal.querySelector('#pointTransferClose').addEventListener('click', closeModal);
    modal.querySelector('#pointTransferCopyOwnCode').addEventListener('click', copyOwnMemberCode);
    modal.addEventListener('click', (event) => {
      if (event.target === modal && !state.busy) closeModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.classList.contains('hidden') && !state.busy) closeModal();
    });

    const code = modal.querySelector('#pointTransferMemberCode');
    const amount = modal.querySelector('#pointTransferAmount');
    [code, amount].forEach((input) => input.addEventListener('input', clearReceiver));
    modal.querySelector('#pointTransferLookup').addEventListener('click', lookupReceiver);
    modal.querySelector('#pointTransferForm').addEventListener('submit', submitTransfer);
    return modal;
  }

  function updateOwnMemberCode() {
    const output = document.getElementById('pointTransferOwnMemberCode');
    const button = document.getElementById('pointTransferCopyOwnCode');
    if (output) output.textContent = state.memberCode || '尚未取得會員編號';
    if (button) button.disabled = !state.memberCode;
  }

  async function copyOwnMemberCode() {
    const code = String(state.memberCode || '').trim();
    if (!code) return;

    const button = document.getElementById('pointTransferCopyOwnCode');
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code);
        copied = true;
      }
    } catch (_) {}

    if (!copied) {
      const proxy = document.createElement('textarea');
      proxy.className = 'point-transfer-copy-proxy';
      proxy.value = code;
      proxy.setAttribute('readonly', '');
      document.body.append(proxy);
      proxy.select();
      try { copied = document.execCommand('copy'); } catch (_) {}
      proxy.remove();
    }

    if (!button) return;
    const original = '複製會員編號';
    button.textContent = copied ? '已複製' : '複製失敗';
    window.setTimeout(() => {
      button.textContent = original;
    }, 1600);
  }

  function currentCardId() {
    return String(
      state.activeCardId ||
      document.getElementById('activeCardView')?.dataset.cardId ||
      ''
    );
  }

  function updateOpenButton() {
    const button = document.getElementById('pointTransferButton');
    if (!button) return;
    const cardId = currentCardId();
    const option = state.options.get(cardId);
    const balance = Number(option?.balance || 0);
    button.disabled = !state.loaded || !cardId || !option || balance <= 0;
    button.title = button.disabled && state.loaded ? '這張集點卡目前沒有可轉贈點數' : '';
  }

  function updateModalBalance() {
    const cardId = document.getElementById('pointTransferCard')?.value;
    const option = state.options.get(cardId);
    const balance = Math.max(0, Number(option?.balance || 0));
    const amount = document.getElementById('pointTransferAmount');
    if (amount) amount.max = String(balance);
    const summary = document.getElementById('pointTransferCardSummary');
    if (summary) summary.textContent = `${option?.title || state.activeCardTitle || '集點卡'}・可轉贈 ${balance} 點${option?.expiresOn ? `・至 ${option.expiresOn}` : ''}`;
    const hint = document.getElementById('pointTransferBalanceHint');
    if (hint) hint.textContent = `本次轉贈會從這張集點卡扣除，最多可轉贈 ${balance} 點。`;
  }

  function openModal() {
    const modal = ensureModal();
    const cardId = currentCardId();
    const option = state.options.get(cardId);
    if (!option || Number(option.balance || 0) <= 0) {
      updateOpenButton();
      return;
    }

    clearReceiver();
    document.getElementById('pointTransferCard').value = cardId;
    document.getElementById('pointTransferMemberCode').value = '';
    document.getElementById('pointTransferAmount').value = '';
    document.getElementById('pointTransferCardSummary').textContent =
      `${option.title || state.activeCardTitle || '集點卡'}・可轉贈 ${Number(option.balance || 0)} 點${option.expiresOn ? `・至 ${option.expiresOn}` : ''}`;
    document.getElementById('pointTransferBalanceHint').textContent =
      `本次轉贈會從這張集點卡扣除，最多可轉贈 ${Number(option.balance || 0)} 點。`;
    document.getElementById('pointTransferAmount').max = String(Number(option.balance || 0));
    setMessage('');
    modal.classList.remove('hidden');
    document.body.classList.add('point-transfer-modal-open');
    window.setTimeout(() => document.getElementById('pointTransferMemberCode')?.focus(), 0);
  }

  function closeModal() {
    if (state.busy) return;
    document.getElementById('pointTransferModal')?.classList.add('hidden');
    document.body.classList.remove('point-transfer-modal-open');
    clearReceiver();
    setMessage('');
    document.getElementById('pointTransferButton')?.focus();
  }

  async function loadOptions() {
    if (state.refreshPromise) {
      state.refreshQueued = true;
      return state.refreshPromise;
    }

    const s = session();
    if (!s) {
      updateOpenButton();
      return;
    }

    state.refreshPromise = (async () => {
      try {
        const data = await window.MemberSystem.request(s.config, 'points', s.idToken, 'points.transfer.options');
        const cards = Array.isArray(data.cards) ? data.cards : [];
        state.options = new Map(cards.map((card) => [String(card.cardId || ''), {
          cardId: String(card.cardId || ''),
          title: String(card.title || '集點卡'),
          balance: Number(card.balance || 0),
          expiresOn: String(card.expiresOn || '')
        }]));
        state.loaded = true;
        updateOpenButton();
        updateModalBalance();
      } catch (error) {
        state.options = new Map();
        state.loaded = true;
        updateOpenButton();
        updateModalBalance();
        if (!document.getElementById('pointTransferModal')?.classList.contains('hidden')) {
          setMessage(error?.message || '目前無法讀取可轉贈點數。', true);
        }
      } finally {
        state.refreshPromise = null;
        if (state.refreshQueued) {
          state.refreshQueued = false;
          void loadOptions();
        }
      }
    })();

    return state.refreshPromise;
  }

  function syncActiveCard(detail) {
    const cardId = String(detail?.cardId || '');
    const title = String(detail?.title || '');
    const stamps = Math.max(0, Number(detail?.stamps || 0));

    state.activeCardId = cardId;
    state.activeCardTitle = title;

    const current = state.options.get(cardId);
    const transferEligible = detail?.transferEligible !== false;
    if (current) {
      state.options.set(cardId, {
        ...current,
        title: title || current.title,
        balance: stamps,
        expiresOn: String(detail?.expiresOn || current.expiresOn || '')
      });
    } else if (cardId && transferEligible && stamps > 0) {
      state.options.set(cardId, {
        cardId,
        title: title || '集點卡',
        balance: stamps,
        expiresOn: String(detail?.expiresOn || '')
      });
    }
    updateOpenButton();

    // renderCards() is also the endpoint of the points realtime refresh path.
    // Re-fetch transfer eligibility/balance here so the transfer button never
    // requires a full-page reload after an admin grant, redemption, or transfer.
    void loadOptions();
  }

  async function lookupReceiver() {
    if (state.busy) return;
    const s = session();
    if (!s) return;
    const memberCode = String(document.getElementById('pointTransferMemberCode').value || '').trim();
    if (!memberCode) return setMessage('請輸入收件會員編號。', true);
    clearReceiver();
    const generation = state.receiverGeneration;
    setMessage('正在確認收件會員…');
    try {
      const receiver = await window.MemberSystem.request(
        s.config,
        'points',
        s.idToken,
        'points.transfer.receiver',
        { memberCode }
      );
      if (generation !== state.receiverGeneration) return;
      state.receiver = receiver;
      renderReceiver();
      setMessage('已確認收件會員，請核對後再送出。');
    } catch (error) {
      if (generation !== state.receiverGeneration) return;
      state.receiver = null;
      renderReceiver();
      setMessage(error?.message || '目前無法確認收件會員。', true);
    }
  }

  async function submitTransfer(event) {
    event.preventDefault();
    if (state.busy) return;

    const s = session();
    if (!s) return;

    const cardId = String(document.getElementById('pointTransferCard').value || '');
    const option = state.options.get(cardId);
    const memberCode = String(document.getElementById('pointTransferMemberCode').value || '').trim();
    const amount = Number(document.getElementById('pointTransferAmount').value);

    if (!option) return setMessage('這張集點卡目前無法轉贈。', true);
    if (!state.receiver || state.receiver.memberCode !== memberCode) return setMessage('請先確認收件會員。', true);
    if (!Number.isSafeInteger(amount) || amount <= 0) return setMessage('請輸入大於 0 的整數點數。', true);
    if (amount > Number(option.balance || 0)) return setMessage('轉贈點數不可超過目前可用點數。', true);

    const fingerprint = JSON.stringify([cardId, memberCode, amount]);
    if (state.fingerprint !== fingerprint) {
      state.requestId = newRequestId();
      state.fingerprint = fingerprint;
    }

    if (!window.confirm(`確定從「${option.title}」轉贈 ${amount} 點給 ${state.receiver.displayName}（${memberCode}）嗎？`)) return;

    state.busy = true;
    const submit = document.getElementById('pointTransferSubmit');
    const close = document.getElementById('pointTransferClose');
    submit.disabled = true;
    close.disabled = true;
    const fields = ['pointTransferMemberCode', 'pointTransferAmount', 'pointTransferLookup'].map((id) => document.getElementById(id));
    fields.forEach((field) => { if (field) field.disabled = true; });
    setMessage('正在安全轉贈點數…');

    try {
      const result = await window.MemberSystem.request(
        s.config,
        'points',
        s.idToken,
        'points.transfer.create',
        { cardId, memberCode, amount, requestId: state.requestId }
      );
      setMessage(`轉贈完成。交易編號 ${result.transferId}，目前剩餘 ${result.senderBalance} 點。`);
      state.requestId = '';
      state.fingerprint = '';
      state.receiver = null;
      renderReceiver();
      document.getElementById('pointTransferAmount').value = '';
      window.dispatchEvent(new CustomEvent('pointcard:transfer-completed', { detail: { cardId, senderBalance: Number(result.senderBalance || 0) } }));
      const refresh = window.PointCardClient && typeof window.PointCardClient.refresh === 'function'
        ? window.PointCardClient.refresh()
        : Promise.resolve();
      await Promise.allSettled([refresh, loadOptions()]);
    } catch (error) {
      setMessage(
        error?.code === 'API_RESPONSE_UNCERTAIN'
          ? '結果尚未確認；請保持相同內容再次按「確認轉贈」，系統會沿用同一操作識別，不會重複扣點。'
          : (error?.message || '點數轉贈失敗。'),
        true
      );
    } finally {
      state.busy = false;
      submit.disabled = false;
      close.disabled = false;
      fields.forEach((field) => { if (field) field.disabled = false; });
    }
  }

  function bind() {
    ensureModal();
    const openButton = document.getElementById('pointTransferButton');
    if (openButton && !openButton.dataset.bound) {
      openButton.dataset.bound = 'true';
      openButton.addEventListener('click', openModal);
    }
    updateOpenButton();
    updateOwnMemberCode();
  }

  window.addEventListener('pointcard:active-changed', (event) => {
    syncActiveCard(event?.detail);
  });

  window.addEventListener('user-tour:ready', (event) => {
    if (event?.detail?.surface !== 'points') return;
    state.memberCode = String(event?.detail?.profile?.memberCode || '').trim();
    bind();
    updateOwnMemberCode();
    void loadOptions();
  });

  window.addEventListener('pageshow', () => {
    bind();
    if (!document.getElementById('pointsView')?.classList.contains('hidden')) void loadOptions();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!document.getElementById('pointsView')?.classList.contains('hidden')) void loadOptions();
  });

  window.addEventListener('online', () => {
    if (!document.getElementById('pointsView')?.classList.contains('hidden')) void loadOptions();
  });
})();
