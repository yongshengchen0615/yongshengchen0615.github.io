(() => {
  'use strict';

  const state = {
    profile: null,
    referralRequestId: '',
    binding: false,
    bound: false,
    joinSubmitted: false,
    generation: 0,
    previewCode: '',
    previewMemberCode: '',
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

  function showReferralStatus(message, error = false, kind = 'info') {
    const status = document.getElementById('memberReferralStatus');
    if (!status) return;
    status.textContent = String(message || '');
    status.classList.toggle('hidden', !message);
    status.classList.toggle('error', Boolean(error));
    status.classList.toggle('success', Boolean(message) && !error && kind === 'success');
    status.dataset.state = error ? 'error' : kind;
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
      trigger.textContent = '好友與邀請';
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
    kicker.textContent = 'Friends & invitations';
    const title = document.createElement('h2');
    title.id = 'memberReferralTitle';
    title.textContent = '好友與邀請';
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
    description.textContent = '使用會員編號或 QR Code 查找好友。好友邀請需對方接受；首次邀請獎勵需另外確認，每位會員只能綁定一次。';

    const share = document.createElement('section');
    share.className = 'member-referral-section';
    share.id = 'memberReferralShare';
    const shareTitle = document.createElement('strong');
    shareTitle.textContent = '① 邀請有禮';
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
    copy.textContent = '複製好友邀請連結';
    shareRow.append(code, copy);
    const shareHelp = document.createElement('small');
    shareHelp.textContent = '把好友邀請連結或會員 QR Code 分享給好友。每成功邀請一位尚未綁定邀請關係的好友，邀請者會獲得 1 張好友邀請票券；被邀請者不會獲得此獎勵票券。';
    share.append(shareTitle, shareRow, shareHelp);

    const bind = document.createElement('form');
    bind.id = 'memberReferralForm';
    bind.className = 'member-referral-section member-referral-bind';
    bind.noValidate = true;
    const bindTitle = document.createElement('strong');
    bindTitle.textContent = '② 加好友';
    const bindLabel = document.createElement('label');
    bindLabel.setAttribute('for', 'memberReferralInviteCode');
    bindLabel.textContent = '好友會員編號';
    const input = document.createElement('input');
    input.id = 'memberReferralInviteCode';
    input.type = 'text';
    input.maxLength = 2048;
    input.autocomplete = 'off';
    input.inputMode = 'text';
    input.placeholder = '輸入會員編號（亦可貼上好友連結）';
    input.setAttribute('aria-describedby', 'memberReferralBindHelp');
    const help = document.createElement('small');
    help.id = 'memberReferralBindHelp';
    help.textContent = '查找後可送出好友邀請，或另外確認首次邀請獎勵。支援會員編號、QR Code 與既有邀請碼；綁定成功後不可改綁。';
    const submit = document.createElement('button');
    submit.id = 'bindMemberReferral';
    submit.type = 'button';
    submit.className = 'button button-dark';
    submit.textContent = '綁定首次邀請獎勵';
    submit.disabled = true;
    const status = document.createElement('p');
    status.id = 'memberReferralStatus';
    status.className = 'member-growth-status hidden';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    bind.append(bindTitle, bindLabel, input, help, submit, status);

    dialog.append(heading, description, share, bind);
    modal.append(dialog);
    document.body.append(modal);

    const shell = document.querySelector('.app-shell');
    let previousInert = null;
    const closeModal = () => {
      if (shell && previousInert !== null) { shell.inert = previousInert; previousInert = null; }
      modal.classList.add('hidden');
      window.dispatchEvent(new Event('member-referral:closed'));
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    };
    const openModal = () => {
      if (shell && previousInert === null) { previousInert = shell.inert; shell.inert = true; }
      renderInviteCode(state.profile);
      showReferralStatus('');
      modal.classList.remove('hidden');
      trigger.setAttribute('aria-expanded', 'true');
      window.requestAnimationFrame(() => {
        modal.tabIndex = -1;
        modal.focus({ preventScroll: true });
      });
    };

    trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', openModal);
    close.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });
    document.addEventListener('keydown', (event) => {
      if (modal.classList.contains('hidden')) return;
      if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
      if (event.key === 'Tab') {
        const items = Array.from(modal.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]')).filter(item => item.getClientRects().length && !item.closest('[hidden]'));
        const first = items[0], last = items.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === modal || document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    });

    input.addEventListener('input', () => {
      if (!state.binding && !state.bound) state.referralRequestId = '';
      state.previewCode = ''; state.previewMemberCode = '';
      submit.disabled = true;
      window.MemberFriends?.invalidate?.();
      showReferralStatus('');
    });

    copy.addEventListener('click', () => void window.MemberFriends?.copyInvitationLink?.());

    bind.addEventListener('submit', (event) => {
      event.preventDefault();
      void window.MemberFriends?.lookup?.();
    });
    submit.addEventListener('click', async (event) => {
      event.preventDefault();
      if (state.binding || state.bound || window.MemberFriends?.isBusy?.()) return;

      const inviteCode = state.previewCode;
      const ownCode = String(state.profile?.inviteCode || '').trim().toUpperCase();
      if (!/^[A-F0-9]{10}$/.test(inviteCode) && !/^[A-Z0-9_-]{4,40}$/.test(state.previewMemberCode)) {
        showReferralStatus('請先查找好友會員編號，再確認綁定邀請獎勵。', true);
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
      const current = state.generation;
      window.MemberFriends?.stopScan?.();
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
          { ...(inviteCode ? { inviteCode } : { memberCode: state.previewMemberCode }), requestId: state.referralRequestId }
        );
        if (current !== state.generation) return;
        state.bound = true;
        const expires = result?.rewardExpiresOn
          ? '，票券效期至 ' + window.MemberSystem.formatDate(result.rewardExpiresOn)
          : '';
        showReferralStatus(
          result?.alreadyApplied
            ? '這組邀請關係已完成；邀請人的好友邀請票券已發放' + expires + '。'
            : '好友邀請綁定成功；邀請人已獲得 1 張好友邀請票券，你不會取得此邀請獎勵票券' + expires + '。', false, 'success'
        );
        submit.textContent = '已完成綁定';
      } catch (error) {
        if (current !== state.generation) return;
        input.disabled = false;
        submit.disabled = false;
        submit.textContent = '綁定首次邀請獎勵';
        showReferralStatus(error?.code === 'REFERRAL_REWARD_UNAVAILABLE' ? '管理員尚未設定好友邀請票券。' : (error?.message || '好友邀請暫時無法完成，請稍後再試。'), true);
      } finally {
        if (current === state.generation) { state.binding = false; input.disabled = false; }
      }
    });

    window.dispatchEvent(new Event('member-referral:ui-ready'));
    return modal;
  }

  function renderInviteCode(profile) {
    ensureReferralUi();
    const codeEl = document.getElementById('memberReferralOwnCode');
    if (!codeEl) return;
    const code = String(profile?.memberCode || '').trim().toUpperCase();
    codeEl.textContent = code ? '會員編號 · ' + code : '建立中';
    const copy = document.getElementById('copyMemberInviteCode');
    if (copy) copy.disabled = !code;
  }

  async function sendJoinCompletionMessage() {
    if (!state.joinSubmitted) return;
    state.joinSubmitted = false;

    const message = '我已完成 Lumen Club 會員註冊，想開始使用會員服務。';
    try {
      if (!window.liff || typeof window.liff.sendMessages !== 'function' || !window.liff.isInClient?.()) return;
      const context = typeof window.liff.getContext === 'function' ? window.liff.getContext() : null;
      if (!context || context.type !== 'utou') return;
      await window.liff.sendMessages([{ type: 'text', text: message }]);
    } catch (error) {
      console.warn('automatic membership completion LINE message failed', error);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    watchJoinSubmit();
    ensureReferralUi();
  });

  window.addEventListener('member-profile-ready', (event) => {
    const next = event?.detail?.profile || {};
    if (state.profile?.lineUserId !== next.lineUserId) {
      state.generation++; state.binding = false; state.bound = false;
      state.previewCode = ''; state.previewMemberCode = ''; state.referralRequestId = '';
      document.getElementById('closeMemberReferral')?.click();
      const input = document.getElementById('memberReferralInviteCode');
      if (input) { input.value = ''; input.disabled = false; }
      const submit = document.getElementById('bindMemberReferral');
      if (submit) { submit.disabled = true; submit.textContent = '綁定首次邀請獎勵'; }
    }
    state.profile = next;
    renderInviteCode(state.profile);
    void sendJoinCompletionMessage();
  });
  window.MemberReferral = {
    ensureUi: ensureReferralUi,
    close: () => document.getElementById('closeMemberReferral')?.click(),
    isBusy: () => state.binding,
    preview: (code, memberCode = '') => {
      state.previewCode = /^[A-F0-9]{10}$/.test(code) ? code : '';
      state.previewMemberCode = /^[A-Z0-9_-]{4,40}$/.test(memberCode) ? memberCode : '';
      const button = document.getElementById('bindMemberReferral');
      if (button) button.disabled = (!state.previewCode && !state.previewMemberCode) || state.binding || state.bound;
    },
  };
})();
