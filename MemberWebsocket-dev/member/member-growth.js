(() => {
  'use strict';

  const state = { joinSubmitted: false, pendingInviteCode: '', referralRequestId: '', profile: null };
  let statusEl = null;

  function requestId(prefix) {
    const value = window.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(36).slice(2);
    return prefix + '-' + value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  }

  function injectJoinInviteField() {
    const form = document.getElementById('profileForm');
    if (!form || document.getElementById('profileInviteCode')) return;
    const terms = form.querySelector('.terms-box');
    const field = document.createElement('div');
    field.className = 'profile-field member-growth-invite-field';
    const label = document.createElement('label');
    label.setAttribute('for', 'profileInviteCode');
    label.textContent = '好友邀請碼（選填）';
    const input = document.createElement('input');
    input.id = 'profileInviteCode';
    input.type = 'text';
    input.maxLength = 10;
    input.autocomplete = 'off';
    input.inputMode = 'text';
    input.placeholder = '10 碼邀請碼';
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 10);
    });
    const help = document.createElement('small');
    help.className = 'profile-field-help';
    help.textContent = '邀請碼不影響加入會員；成功綁定後，雙方各獲一張好友邀請獎勵券。';
    field.append(label, input, help);
    if (terms) form.insertBefore(field, terms);
    else form.append(field);

    form.addEventListener('submit', () => {
      state.joinSubmitted = true;
      state.pendingInviteCode = input.value.trim().toUpperCase();
      state.referralRequestId = state.referralRequestId || requestId('ref');
    }, true);
  }

  function ensurePanel() {
    const memberView = document.getElementById('memberView');
    if (!memberView) return null;
    let panel = document.getElementById('memberGrowthPanel');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'memberGrowthPanel';
    panel.className = 'member-growth-panel';
    panel.setAttribute('aria-labelledby', 'memberGrowthTitle');
    panel.innerHTML = '<div class="member-growth-heading"><div><p class="kicker">Member growth</p><h2 id="memberGrowthTitle">好友邀請與 LINE</h2></div></div><div id="memberInviteShare" class="member-growth-card"></div><div id="memberLineFollowup" class="member-growth-card hidden"></div><p id="memberGrowthStatus" class="member-growth-status hidden" role="status" aria-live="polite"></p>';
    const pass = document.getElementById('memberPass');
    if (pass?.parentNode) pass.parentNode.insertBefore(panel, pass.nextSibling);
    else memberView.append(panel);
    statusEl = panel.querySelector('#memberGrowthStatus');
    return panel;
  }

  function showStatus(message, error = false) {
    ensurePanel();
    if (!statusEl) return;
    statusEl.textContent = String(message || '');
    statusEl.classList.toggle('hidden', !message);
    statusEl.classList.toggle('error', Boolean(error));
  }

  function renderInvite(profile) {
    const panel = ensurePanel();
    const host = panel?.querySelector('#memberInviteShare');
    if (!host) return;
    const code = String(profile?.inviteCode || '').trim();
    host.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = '我的好友邀請碼';
    const codeEl = document.createElement('code');
    codeEl.className = 'member-invite-code';
    codeEl.textContent = code || '建立中';
    const note = document.createElement('p');
    note.textContent = code ? '好友加入會員後 24 小時內綁定此碼，雙方各獲一張 30 天效期獎勵券。' : '邀請碼正在同步，重新整理後即可查看。';
    host.append(title, codeEl, note);
    if (code) {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'button button-refresh';
      copy.textContent = '複製邀請碼';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code);
          showStatus('邀請碼已複製。');
        } catch (_) {
          showStatus('瀏覽器無法自動複製，請長按邀請碼複製。', true);
        }
      });
      host.append(copy);
    }
  }

  function renderLineFollowup() {
    const panel = ensurePanel();
    const host = panel?.querySelector('#memberLineFollowup');
    if (!host || !state.joinSubmitted) return;
    host.classList.remove('hidden');
    host.replaceChildren();

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
        if (!/^https:\/\/line\.me\/R\/oaMessage\//.test(baseUrl)) {
          throw new Error('LINE 官方帳號入口無效。');
        }
        result.textContent = '正在開啟 LINE 官方帳號，訊息會先填入輸入框，仍需由你按下傳送。';
        window.location.assign(baseUrl.replace(/\/$/, '') + '/?' + encodeURIComponent(message));
      } catch (_) {
        result.textContent = '這個畫面目前無法直接送出訊息。會員資格不受影響；請返回 LINE 官方帳號聊天室後再試。';
      } finally {
        button.disabled = false;
      }
    });
    host.append(title, preview, button, result);
  }

  async function bindReferralIfNeeded() {
    const code = state.pendingInviteCode;
    if (!state.joinSubmitted || !code) return;
    const session = window.MemberSystem?.getSession?.('member');
    if (!session) return showStatus('會員已建立，但邀請碼尚未完成綁定；請重新整理後再試。', true);
    try {
      const result = await window.MemberSystem.request(
        session.config, 'member', session.idToken, 'member.referral.bind',
        { inviteCode: code, requestId: state.referralRequestId }
      );
      showStatus(result.alreadyApplied ? '邀請關係已確認，獎勵券已存在。' : '邀請碼綁定成功，雙方獎勵券已發放。');
      state.pendingInviteCode = '';
    } catch (error) {
      showStatus('會員已成功加入；邀請碼未完成綁定：' + (error?.message || '請稍後再試。'), true);
    }
  }

  window.addEventListener('DOMContentLoaded', injectJoinInviteField);
  window.addEventListener('member-profile-ready', async (event) => {
    state.profile = event?.detail?.profile || {};
    renderInvite(state.profile);
    if (state.joinSubmitted) {
      await bindReferralIfNeeded();
      renderLineFollowup();
    }
  });
})();
