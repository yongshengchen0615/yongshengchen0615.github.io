(() => {
  'use strict';

  const state = {
    profile: null,
    referralRequestId: '',
    binding: false,
    bound: false,
    joinSubmitted: false,
  };

  function requestId(prefix) {
    const value = window.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2);
    return prefix + '-' + value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  }

  function watchJoinSubmit() {
    const form = document.getElementById('profileForm');
    if (!form || form.dataset.memberGrowthBound === 'true') return;
    form.dataset.memberGrowthBound = 'true';
    form.addEventListener('submit', () => {
      state.joinSubmitted = true;
    }, true);
  }

  function showReferralStatus(message, error = false) {
    const status = document.getElementById('memberReferralStatus');
    if (!status) return;
    status.textContent = String(message || '');
    status.classList.toggle('hidden', !message);
    status.classList.toggle('error', Boolean(error));
    status.classList.toggle('success', Boolean(message) && !error);
  }

  function ensureReferralUi() {
    const pass = document.getElementById('memberPass');
    if (!pass) return null;

    let trigger = document.getElementById('openMemberReferral');
    if (!trigger) {
      trigger = document.createElement('button');
      trigger.id = 'openMemberReferral';
      trigger.type = 'button';
      trigger.className = 'member-referral-trigger';
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-controls', 'memberReferralModal');
      trigger.textContent = '好友邀請';
      pass.append(trigger);
    }

    let modal = document.getElementById('memberReferralModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'memberReferralModal';
    modal.className = 'member-referral-modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'memberReferralTitle');
    modal.setAttribute('aria-describedby', 'memberReferralDescription');

    const dialog = document.createElement('section');
    dialog.className = 'member-referral-dialog';

    const heading = document.createElement('div');
    heading.className = 'member-referral-heading';
    const headingCopy = document.createElement('div');
    const kicker = document.createElement('p');
    kicker.className = 'kicker';
    kicker.textContent = 'Friend referral';
    const title = document.createElement('h2');
    title.id = 'memberReferralTitle';
    title.textContent = '好友邀請';
    headingCopy.append(kicker, title);
    const close = document.createElement('button');
    close.id = 'closeMemberReferral';
    close.type = 'button';
    close.className = 'member-referral-close';
    close.setAttribute('aria-label', '關閉好友邀請視窗');
    close.textContent = '×';
    heading.append(headingCopy, close);

    const description = document.createElement('p');
    description.id = 'memberReferralDescription';
    description.className = 'member-referral-description';
    description.textContent = '分享自己的邀請碼，或輸入好友提供的邀請碼完成綁定。每位會員只能綁定一次。';

    const share = document.createElement('section');
    share.className = 'member-referral-section';
    const shareTitle = document.createElement('strong');
    shareTitle.textContent = '我的邀請碼';
    const shareRow = document.createElement('div');
    shareRow.className = 'member-referral-code-row';
    const code = document.createElement('code');
    code.id = 'memberReferralOwnCode';
    code.className = 'member-invite-code';
    code.textContent = '建立中';
    const copy = document.createElement('button');
    copy.id = 'copyMemberInviteCode';
    copy.type = 'button';
    copy.className = 'button button-refresh';
    copy.textContent = '複製';
    shareRow.append(code, copy);
    const shareHelp = document.createElement('small');
    shareHelp.textContent = '把這組邀請碼傳給好友。好友完成綁定後，符合目前好友邀請活動規則的雙方會取得獎勵票券。';
    share.append(shareTitle, shareRow, shareHelp);

    const bind = document.createElement('form');
    bind.id = 'memberReferralForm';
    bind.className = 'member-referral-section member-referral-bind';
    bind.noValidate = true;
    const bindTitle = document.createElement('strong');
    bindTitle.textContent = '輸入好友邀請碼';
    const bindLabel = document.createElement('label');
    bindLabel.setAttribute('for', 'memberReferralInviteCode');
    bindLabel.textContent = '好友邀請碼';
    const input = document.createElement('input');
    input.id = 'memberReferralInviteCode';
    input.type = 'text';
    input.maxLength = 10;
    input.autocomplete = 'off';
    input.inputMode = 'text';
    input.placeholder = '10 碼邀請碼';
    input.setAttribute('aria-describedby', 'memberReferralBindHelp');
    const help = document.createElement('small');
    help.id = 'memberReferralBindHelp';
    help.textContent = '不可使用自己的邀請碼。綁定成功後不可改綁其他人。';
    const submit = document.createElement('button');
    submit.id = 'bindMemberReferral';
    submit.type = 'submit';
    submit.className = 'button button-dark';
    submit.textContent = '確認綁定';
    const status = document.createElement('p');
    status.id = 'memberReferralStatus';
    status.className = 'member-growth-status hidden';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    bind.append(bindTitle, bindLabel, input, help, submit, status);

    dialog.append(heading, description, share, bind);
    modal.append(dialog);
    document.body.append(modal);

    const closeModal = () => {
      if (state.binding) return;
      modal.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    };
    const openModal = () => {
      renderInviteCode(state.profile);
      showReferralStatus('');
      modal.classList.remove('hidden');
      trigger.setAttribute('aria-expanded', 'true');
      window.requestAnimationFrame(() => {
        try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
      });
    };

    trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', openModal);
    close.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
    });

    input.addEventListener('input', () => {
      const next = input.value.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 10);
      if (input.value !== next) input.value = next;
      if (!state.binding && !state.bound) state.referralRequestId = '';
      showReferralStatus('');
    });

    copy.addEventListener('click', async () => {
      const ownCode = String(state.profile?.inviteCode || '').trim();
      if (!/^[A-F0-9]{10}$/.test(ownCode)) {
        showReferralStatus('邀請碼仍在同步，請稍後重新開啟視窗。', true);
        return;
      }
      try {
        await navigator.clipboard.writeText(ownCode);
        showReferralStatus('邀請碼已複製。');
      } catch (_) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        showReferralStatus('無法自動複製，已選取邀請碼，請使用系統複製功能。');
      }
    });

    bind.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.binding || state.bound) return;

      const inviteCode = input.value.trim().toUpperCase();
      const ownCode = String(state.profile?.inviteCode || '').trim().toUpperCase();
      if (!/^[A-F0-9]{10}$/.test(inviteCode)) {
        showReferralStatus('請輸入完整的 10 碼好友邀請碼。', true);
        return;
      }
      if (ownCode && inviteCode === ownCode) {
        showReferralStatus('不可使用自己的邀請碼。', true);
        return;
      }

      const session = window.MemberSystem?.getSession?.('member');
      if (!session) {
        showReferralStatus('登入狀態已失效，請重新整理後再試。', true);
        return;
      }

      state.binding = true;
      state.referralRequestId = state.referralRequestId || requestId('ref');
      input.disabled = true;
      submit.disabled = true;
      submit.textContent = '綁定中…';
      showReferralStatus('正在確認邀請關係與獎勵票券…');

      try {
        const result = await window.MemberSystem.request(
          session.config,
          'member',
          session.idToken,
          'member.referral.bind',
          { inviteCode, requestId: state.referralRequestId }
        );
        state.bound = true;
        const expires = result?.rewardExpiresOn
          ? '，票券效期至 ' + window.MemberSystem.formatDate(result.rewardExpiresOn)
          : '';
        showReferralStatus(
          result?.alreadyApplied
            ? '這組邀請關係已完成，獎勵票券已存在' + expires + '。'
            : '好友邀請綁定成功，邀請人與你各獲一張好友邀請票券' + expires + '。'
        );
        submit.textContent = '已完成綁定';
      } catch (error) {
        input.disabled = false;
        submit.disabled = false;
        submit.textContent = '確認綁定';
        showReferralStatus(error?.message || '好友邀請暫時無法完成，請稍後再試。', true);
      } finally {
        state.binding = false;
      }
    });

    return modal;
  }

  function renderInviteCode(profile) {
    ensureReferralUi();
    const codeEl = document.getElementById('memberReferralOwnCode');
    if (!codeEl) return;
    const code = String(profile?.inviteCode || '').trim().toUpperCase();
    codeEl.textContent = /^[A-F0-9]{10}$/.test(code) ? code : '建立中';
    const copy = document.getElementById('copyMemberInviteCode');
    if (copy) copy.disabled = !/^[A-F0-9]{10}$/.test(code);
  }

  function renderLineFollowup() {
    if (!state.joinSubmitted || document.getElementById('memberLineFollowupPanel')) return;
    const memberView = document.getElementById('memberView');
    const pass = document.getElementById('memberPass');
    if (!memberView || !pass) return;

    const panel = document.createElement('section');
    panel.id = 'memberLineFollowupPanel';
    panel.className = 'member-growth-card member-line-followup';
    const title = document.createElement('strong');
    title.textContent = '加入完成後傳訊至 LINE 官方帳號';
    const preview = document.createElement('p');
    const message = '我已完成 Lumen Club 會員註冊，想開始使用會員服務。';
    preview.textContent = '建議訊息：' + message;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-dark';
    button.textContent = '由我傳送這則 LINE 訊息';
    const result = document.createElement('p');
    result.className = 'member-line-result';

    button.addEventListener('click', async () => {
      button.disabled = true;
      result.textContent = '正在開啟 LINE 傳訊能力…';
      try {
        if (window.liff && typeof window.liff.sendMessages === 'function' && window.liff.isInClient?.()) {
          await window.liff.sendMessages([{ type: 'text', text: message }]);
          result.textContent = '訊息已由你的 LINE 帳號送出。';
          return;
        }
        const session = window.MemberSystem?.getSession?.('member');
        if (!session) {
          result.textContent = '登入狀態已失效。會員資格不受影響；請重新整理後再開啟 LINE 官方帳號。';
          return;
        }
        const account = await window.MemberSystem.request(
          session.config, 'member', session.idToken, 'member.line.official-account'
        );
        const baseUrl = String(account?.chatUrl || '');
        if (!/^https:\/\/line\.me\/R\/oaMessage\//.test(baseUrl)) throw new Error('LINE 官方帳號入口無效。');
        result.textContent = '正在開啟 LINE 官方帳號，訊息會先填入輸入框，仍需由你按下傳送。';
        window.location.assign(baseUrl.replace(/\/$/, '') + '/?' + encodeURIComponent(message));
      } catch (_) {
        result.textContent = '這個畫面目前無法直接送出訊息。會員資格不受影響；請返回 LINE 官方帳號聊天室後再試。';
      } finally {
        button.disabled = false;
      }
    });

    panel.append(title, preview, button, result);
    pass.insertAdjacentElement('afterend', panel);
  }

  window.addEventListener('DOMContentLoaded', () => {
    watchJoinSubmit();
    ensureReferralUi();
  });

  window.addEventListener('member-profile-ready', (event) => {
    state.profile = event?.detail?.profile || {};
    renderInviteCode(state.profile);
    renderLineFollowup();
  });
})();
