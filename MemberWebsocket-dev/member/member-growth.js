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


  function parseReferralValue(raw) {
    const text = String(raw || '').trim();
    if (!text) throw new Error('請輸入邀請優惠碼或邀請人的會員編號。');
    let candidate = text;
    const pickFromUrl = (url) => {
      if (url.origin !== location.origin) throw new Error('邀請優惠連結不是本站連結。');
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
      return hash.get('reward') || hash.get('invite') || hash.get('friend') || url.searchParams.get('invite') || '';
    };
    if (/^https?:\/\//i.test(text)) {
      try { candidate = pickFromUrl(new URL(text)); }
      catch (error) {
        if (error?.message === '邀請優惠連結不是本站連結。') throw error;
        throw new Error('邀請優惠連結格式不正確。');
      }
    } else if (text.startsWith('#')) {
      const hash = new URLSearchParams(text.slice(1));
      candidate = hash.get('reward') || hash.get('invite') || hash.get('friend') || '';
    }
    try { candidate = decodeURIComponent(candidate); } catch (_) { /* keep raw candidate */ }
    candidate = String(candidate || '').trim().toUpperCase();
    if (/^[A-F0-9]{10}$/.test(candidate)) return { inviteCode: candidate };
    if (/^[A-Z0-9_-]{4,40}$/.test(candidate)) return { memberCode: candidate };
    throw new Error('請輸入有效的邀請優惠碼或邀請人的會員編號。');
  }

  function referralShareUrl() {
    const code = String(state.profile?.memberCode || '').trim().toUpperCase();
    if (!code) return '';
    const url = new URL('../member/', location.href);
    url.hash = 'reward=' + encodeURIComponent(code);
    return url.href;
  }

  async function copyReferralLink() {
    const url = referralShareUrl();
    if (!url) { showReferralStatus('會員編號仍在同步，請稍後再試。', true); return; }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(url);
      showReferralStatus('邀請優惠連結已複製。', false, 'success');
    } catch (_) {
      const field = document.createElement('textarea');
      field.value = url;
      field.className = 'friend-copy-buffer';
      document.getElementById('memberReferralModal')?.append(field);
      field.select();
      let copied = false;
      try { copied = document.execCommand?.('copy') === true; } catch (_) { /* report below */ }
      field.remove();
      showReferralStatus(copied ? '邀請優惠連結已複製。' : '無法複製邀請優惠連結，請稍後再試。', !copied, copied ? 'success' : 'error');
    }
  }

  async function shareReferralLink() {
    const url = referralShareUrl();
    if (!url) return;
    if (!navigator.share) { await copyReferralLink(); return; }
    try {
      await navigator.share({ title: '邀請優惠', url });
      showReferralStatus('邀請優惠連結已分享。', false, 'success');
    } catch (error) {
      if (error?.name !== 'AbortError') showReferralStatus('分享暫時無法使用，請改用複製邀請優惠連結。', true);
    }
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
      trigger.textContent = '好友';
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
    kicker.textContent = 'Friends';
    const title = document.createElement('h2');
    title.id = 'memberReferralTitle';
    title.textContent = '好友中心';
    headingCopy.append(kicker, title);
    const close = document.createElement('button');
    close.id = 'closeMemberReferral';
    close.type = 'button';
    close.className = 'member-referral-close';
    close.setAttribute('aria-label', '關閉好友中心');
    close.textContent = '×';
    heading.append(headingCopy, close);

    const description = document.createElement('p');
    description.id = 'memberReferralDescription';
    description.className = 'member-referral-description';
    description.textContent = '好友關係與邀請優惠分開管理：加好友與邀請好友在「好友」，推薦獎勵只在「邀請優惠」。';

    const share = document.createElement('section');
    share.className = 'member-referral-section';
    share.id = 'memberReferralShare';
    const shareTitle = document.createElement('strong');
    shareTitle.textContent = '分享邀請優惠';
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
    copy.textContent = '複製邀請優惠連結';
    const shareButton = document.createElement('button');
    shareButton.id = 'shareMemberReferral';
    shareButton.type = 'button';
    shareButton.className = 'button button-refresh';
    shareButton.textContent = '分享邀請優惠';
    shareRow.append(code, copy, shareButton);
    const shareHelp = document.createElement('small');
    shareHelp.textContent = '把邀請優惠連結分享給尚未綁定推薦關係的會員。綁定成功後，邀請者獲得 1 張好友邀請票券；被邀請者不會取得這張獎勵票券。';
    share.append(shareTitle, shareRow, shareHelp);

    const bind = document.createElement('form');
    bind.id = 'memberReferralForm';
    bind.className = 'member-referral-section member-referral-bind';
    bind.noValidate = true;
    const bindTitle = document.createElement('strong');
    bindTitle.textContent = '綁定邀請優惠';
    const bindLabel = document.createElement('label');
    bindLabel.setAttribute('for', 'memberReferralInviteCode');
    bindLabel.textContent = '邀請優惠碼或邀請人的會員編號';
    const input = document.createElement('input');
    input.id = 'memberReferralInviteCode';
    input.type = 'text';
    input.maxLength = 2048;
    input.autocomplete = 'off';
    input.inputMode = 'text';
    input.placeholder = '輸入優惠碼、會員編號或貼上邀請優惠連結';
    input.setAttribute('aria-describedby', 'memberReferralBindHelp');
    const help = document.createElement('small');
    help.id = 'memberReferralBindHelp';
    help.textContent = '這裡只處理邀請優惠，不會送出好友邀請。每位會員只能綁定一次，完成後不可改綁。';
    const submit = document.createElement('button');
    submit.id = 'bindMemberReferral';
    submit.type = 'submit';
    submit.className = 'button button-dark';
    submit.textContent = '確認綁定邀請優惠';
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
      submit.disabled = state.binding || state.bound || !input.value.trim();
      showReferralStatus('');
    });
    copy.addEventListener('click', () => void copyReferralLink());
    shareButton.addEventListener('click', () => void shareReferralLink());

    bind.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (state.binding || state.bound) return;

      let referral;
      try { referral = parseReferralValue(input.value); }
      catch (error) { showReferralStatus(error?.message || '邀請優惠資料格式不正確。', true); return; }

      const ownInvite = String(state.profile?.inviteCode || '').trim().toUpperCase();
      const ownMember = String(state.profile?.memberCode || '').trim().toUpperCase();
      if ((referral.inviteCode && referral.inviteCode === ownInvite) || (referral.memberCode && referral.memberCode === ownMember)) {
        showReferralStatus('不可使用自己的邀請優惠碼或會員編號。', true);
        return;
      }

      const session = window.MemberSystem?.getSession?.('member');
      if (!session) {
        showReferralStatus('登入狀態已失效，請重新整理後再試。', true);
        return;
      }

      state.binding = true;
      const current = state.generation;
      state.referralRequestId = state.referralRequestId || requestId('ref');
      input.disabled = true;
      submit.disabled = true;
      submit.textContent = '綁定中…';
      showReferralStatus('正在確認邀請優惠與獎勵票券…');

      try {
        const result = await window.MemberSystem.request(
          session.config,
          'member',
          session.idToken,
          'member.referral.bind',
          { ...referral, requestId: state.referralRequestId }
        );
        if (current !== state.generation) return;
        state.bound = true;
        const expires = result?.rewardExpiresOn
          ? '，票券效期至 ' + window.MemberSystem.formatDate(result.rewardExpiresOn)
          : '';
        showReferralStatus(
          result?.alreadyApplied
            ? '這組邀請優惠已完成；邀請人的好友邀請票券已發放' + expires + '。'
            : '邀請優惠綁定成功；邀請人已獲得 1 張好友邀請票券，你不會取得此獎勵票券' + expires + '。',
          false,
          'success'
        );
        submit.textContent = '已完成綁定';
      } catch (error) {
        if (current !== state.generation) return;
        submit.disabled = false;
        submit.textContent = '確認綁定邀請優惠';
        showReferralStatus(error?.code === 'REFERRAL_REWARD_UNAVAILABLE' ? '管理員尚未設定好友邀請票券。' : (error?.message || '邀請優惠暫時無法完成，請稍後再試。'), true);
      } finally {
        if (current === state.generation) {
          state.binding = false;
          input.disabled = false;
          if (!state.bound) submit.disabled = !input.value.trim();
        }
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
    for (const id of ['copyMemberInviteCode', 'shareMemberReferral']) {
      const button = document.getElementById(id);
      if (button) button.disabled = !code;
    }
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
      state.generation++;
      state.binding = false;
      state.bound = false;
      state.referralRequestId = '';
      document.getElementById('closeMemberReferral')?.click();
      const input = document.getElementById('memberReferralInviteCode');
      if (input) { input.value = ''; input.disabled = false; }
      const submit = document.getElementById('bindMemberReferral');
      if (submit) { submit.disabled = true; submit.textContent = '確認綁定邀請優惠'; }
    }
    state.profile = next;
    renderInviteCode(state.profile);
    void sendJoinCompletionMessage();
  });
  window.MemberReferral = {
    ensureUi: ensureReferralUi,
    close: () => document.getElementById('closeMemberReferral')?.click(),
    isBusy: () => state.binding,
    prefill: (value) => {
      const input = document.getElementById('memberReferralInviteCode');
      if (!input) return;
      input.value = String(value || '').slice(0, 2048);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    shareUrl: referralShareUrl,
    copyLink: copyReferralLink,
  };})();
