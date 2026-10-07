(() => {
  'use strict';
  const booking = Boolean(window.BookingSystem);
  let profile = null, generation = 0, loading = false, busy = false;
  let selectedCode = '', lockedRecipient = null, pendingCode = '', scanner = null, invitationUrl = '';
  const el = id => document.getElementById(id);
  const input = () => el('memberReferralInviteCode');
  function session() { return booking ? window.BookingSystem.getSession() : window.MemberSystem.getSession('member'); }
  async function request(operation, code = '') {
    const current = session();
    if (!current) throw new Error('登入狀態已失效，請重新整理。');
    if (!booking) return window.MemberSystem.request(current.config, 'member', current.idToken, 'member.friend.' + operation, { memberCode: code });
    const body = { clientType: 'booking', idToken: current.idToken, action: 'member.friend.' + operation, memberCode: code };
    const response = await fetch(current.config.supabaseUrl.replace(/\/$/, '') + '/functions/v1/member-growth-api', {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', apikey: current.config.supabasePublishableKey },
      body: JSON.stringify(window.TestModeClient?.payload ? window.TestModeClient.payload(body) : body),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message || '好友資料載入失敗。');
    return result.data;
  }
  function status(message, state = 'info') {
    for (const id of ['friendStatus', 'friendListStatus']) {
      const node = el(id);
      if (!node) continue;
      node.textContent = message;
      node.dataset.state = message ? state : '';
    }
  }
  function stopScan() { scanner?.stop(); if (el('friendQrScanner')) el('friendQrScanner').hidden = true; }
  function selectMemberTab(name, focus = false) {
    if (booking) return;
    const selected = name === 'invite' ? 'invite' : 'friends';
    for (const tabName of ['friends', 'invite']) {
      const suffix = tabName === 'friends' ? 'Friends' : 'Invite';
      const button = el('memberReferralTab' + suffix);
      const panel = el('memberReferral' + suffix + 'TabPanel');
      const active = tabName === selected;
      if (button) {
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        button.tabIndex = active ? 0 : -1;
      }
      if (panel) panel.hidden = !active;
    }
    if (selected !== 'invite') stopScan();
    if (focus) el(selected === 'invite' ? 'memberReferralTabInvite' : 'memberReferralTabFriends')?.focus();
  }
  function installMemberTabs(modal, share, form) {
    const existing = el('memberReferralSubtabs');
    if (existing) return {
      tablist: existing,
      friendsPanel: el('memberReferralFriendsTabPanel'),
      invitePanel: el('memberReferralInviteTabPanel'),
    };
    const dialog = modal?.querySelector('.member-referral-dialog');
    if (!dialog || !share || !form) return null;

    const tablist = document.createElement('div');
    tablist.id = 'memberReferralSubtabs';
    tablist.className = 'friend-subtabs';
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', '好友與邀請功能');

    const makeTab = (id, label, panelId, selected) => {
      const button = document.createElement('button');
      button.id = id;
      button.type = 'button';
      button.className = 'friend-subtab';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panelId);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
      button.textContent = label;
      return button;
    };
    const friendsTab = makeTab('memberReferralTabFriends', '好友', 'memberReferralFriendsTabPanel', true);
    const inviteTab = makeTab('memberReferralTabInvite', '邀請', 'memberReferralInviteTabPanel', false);
    tablist.append(friendsTab, inviteTab);

    const friendsPanel = document.createElement('section');
    friendsPanel.id = 'memberReferralFriendsTabPanel';
    friendsPanel.className = 'friend-subtab-panel';
    friendsPanel.setAttribute('role', 'tabpanel');
    friendsPanel.setAttribute('aria-labelledby', friendsTab.id);

    const invitePanel = document.createElement('section');
    invitePanel.id = 'memberReferralInviteTabPanel';
    invitePanel.className = 'friend-subtab-panel';
    invitePanel.setAttribute('role', 'tabpanel');
    invitePanel.setAttribute('aria-labelledby', inviteTab.id);
    invitePanel.hidden = true;

    share.before(tablist);
    invitePanel.append(share, form);
    tablist.after(friendsPanel, invitePanel);

    friendsTab.addEventListener('click', () => selectMemberTab('friends'));
    inviteTab.addEventListener('click', () => selectMemberTab('invite'));
    tablist.addEventListener('keydown', event => {
      const current = event.target.closest?.('[role="tab"]');
      if (!current || !tablist.contains(current)) return;
      const tabs = [friendsTab, inviteTab];
      let index = tabs.indexOf(current);
      if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') index = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else return;
      event.preventDefault();
      selectMemberTab(index === 1 ? 'invite' : 'friends', true);
    });
    selectMemberTab('friends');
    return { tablist, friendsPanel, invitePanel };
  }
  function invalidate() { pendingCode = ''; stopScan(); if (el('confirmFriendRequest')) el('confirmFriendRequest').hidden = true; }
  async function lookup() {
    if (!profile || busy || window.MemberReferral?.isBusy()) return;
    const current = generation, entered = input().value;
    invalidate(); window.MemberReferral?.preview(''); busy = true;
    status('正在查找好友…', 'loading');
    const button = el('lookupFriend'); if (button) button.disabled = true;
    try {
      const code = window.FriendQRScanner.parseInvitation(entered);
      if ([profile.inviteCode, profile.memberCode].map(value => String(value || '').toUpperCase()).includes(code)) throw new Error('不可使用自己的邀請碼或會員編號。');
      const found = await request('lookup', code);
      if (current !== generation || entered !== input().value) return;
      pendingCode = found.memberCode;
      window.MemberReferral?.preview(code, found.memberCode);
      status(`查找好友成功：${found.displayName} · ${found.memberCode}。送出好友邀請後需等待對方接受；首次邀請獎勵可另外確認綁定。`, 'success');
      el('confirmFriendRequest').hidden = false;
    } catch (error) {
      if (current === generation && entered === input().value) status(`查找好友失敗：${error?.message || '請確認邀請碼或會員編號後重試。'}`, 'error');
    }
    finally { if (current === generation) busy = false; if (button) button.disabled = false; }
  }
  function install() {
    if (el('friendsPanel')) return;
    if (booking) {
      const main = el('bookingView'); if (!main) return;
      const panel = document.createElement('section'); panel.id = 'friendsPanel'; panel.className = 'friends-panel booking-recipient';
      panel.innerHTML = '<label>服務對象<select id="friendBookingRecipient"><option value="">本人</option></select></label><p>好友接受邀請後可代約單人服務。票券由建立者選用自己的票券；完成服務後，好友取得正常點數與服務分鐘，代約者取得每種已設定集點規則的服務類型 1 點及一半服務分鐘（不足 1 分鐘向下取整）。</p><a href="../member/#friends">管理好友與邀請</a><button id="refreshFriends" type="button" class="button button-refresh">更新好友</button><p id="friendStatus" class="friend-feedback" role="status" aria-live="polite"></p>';
      (el('bookingRecipientHost') || el('bookingNotice')?.parentElement)?.append(panel);
      el('friendBookingRecipient').addEventListener('change', event => { selectedCode = event.target.value; status(selectedCode ? '將替所選好友預約；送出前請再次確認受服務者。' : '本次為本人預約。'); });
    } else {
      const modal = window.MemberReferral?.ensureUi(); if (!modal || !input()) return;
      const share = el('memberReferralShare'), form = el('memberReferralForm');
      const tabs = installMemberTabs(modal, share, form); if (!tabs) return;
      const sharing = document.createElement('div'); sharing.className = 'friend-sharing';
      sharing.innerHTML = '<canvas id="friendQr" class="friend-qr" aria-label="會員編號 QR Code：加好友與邀請有禮" hidden></canvas><div class="friend-link-actions"><button id="shareFriendLink" type="button" class="button button-refresh">分享好友邀請連結</button><small>分享連結與 QR Code 只帶會員編號，好友查找後再確認操作。</small></div>';
      sharing.querySelector('.friend-link-actions').prepend(el('copyMemberInviteCode'));
      share.append(sharing);
      const controls = document.createElement('div'); controls.className = 'friend-actions';
      controls.innerHTML = '<button id="scanFriendQr" type="button" class="button button-refresh">掃描 QR Code</button><button id="uploadFriendQr" type="button" class="button button-refresh">選擇 QR 圖片</button><input id="friendQrFile" type="file" accept="image/png,image/jpeg,image/webp" hidden><button id="lookupFriend" type="submit" class="button button-dark">查找好友</button><button id="confirmFriendRequest" type="button" class="button button-dark" hidden>確認送出好友邀請</button>';
      const camera = document.createElement('section'); camera.id = 'friendQrScanner'; camera.hidden = true;
      camera.innerHTML = '<video id="friendQrVideo" autoplay muted playsinline aria-label="好友 QR Code 相機預覽"></video><p>將完整 QR Code 放在畫面中央。影像只在目前裝置辨識。</p><button id="stopFriendQr" type="button" class="button button-refresh">關閉相機</button>';
      const panel = document.createElement('section'); panel.id = 'friendsPanel'; panel.className = 'friends-panel';
      panel.innerHTML = '<div class="friends-panel-heading"><h3>我的好友</h3><button id="refreshFriends" type="button" class="button button-refresh">更新好友</button></div><p id="friendListStatus" class="friend-feedback" role="status" aria-live="polite"></p><div id="friendList"></div><div id="friendReceivedBookings"></div>';
      const message = document.createElement('p'); message.id = 'friendStatus'; message.className = 'friend-feedback'; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
      el('bindMemberReferral').before(controls, camera);
      controls.after(message);
      tabs.friendsPanel.append(panel);
      scanner = window.FriendQRScanner.create(el('friendQrVideo'), {
        onStatus: status,
        onResult: code => { stopScan(); input().value = code; input().dispatchEvent(new Event('input', { bubbles: true })); void lookup(); },
      });
      el('scanFriendQr').addEventListener('click', () => { if (busy || window.MemberReferral.isBusy()) return; camera.hidden = false; void scanner.start(); });
      el('stopFriendQr').addEventListener('click', () => { stopScan(); el('scanFriendQr').focus(); });
      el('uploadFriendQr').addEventListener('click', () => { if (!busy && !window.MemberReferral.isBusy()) el('friendQrFile').click(); });
      el('friendQrFile').addEventListener('change', event => { const file = event.target.files?.[0]; event.target.value = ''; stopScan(); void scanner.readFile(file); });
      el('confirmFriendRequest').addEventListener('click', async event => {
        if (busy || !pendingCode || window.MemberReferral.isBusy()) return;
        const current = generation, button = event.currentTarget; busy = true; button.disabled = true; stopScan();
        try { const result = await request('request', pendingCode); if (current !== generation) return; status(result.status === 'accepted' ? '已是好友。' : '邀請已送出，等待好友接受。'); button.hidden = true; await refresh(false); }
        catch (error) { if (current === generation) status(error.message); }
        finally { if (current === generation) busy = false; button.disabled = false; }
      });
      el('shareFriendLink').addEventListener('click', shareInvitationLink);
    }
    el('refreshFriends').addEventListener('click', () => void refresh());
  }
  async function copyInvitationLink() {
    const url = invitationUrl, current = generation;
    if (!url) { status('會員編號仍在同步，請稍後再試。'); return; }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(url);
      if (current === generation) status('好友邀請連結已複製。');
    } catch (_) {
      if (current !== generation) return;
      // Legacy WebViews: copy in the same dialog without exposing the full URL.
      const field = document.createElement('textarea');
      field.value = url; field.className = 'friend-copy-buffer';
      el('memberReferralModal').append(field); field.select();
      let copied = false;
      try { copied = document.execCommand?.('copy') === true; } catch (_) { /* report below */ }
      field.remove(); el('copyMemberInviteCode')?.focus();
      status(copied ? '好友邀請連結已複製。' : '無法複製連結，請使用分享按鈕或讓好友掃描 QR Code。');
    }
  }
  async function shareInvitationLink() {
    const url = invitationUrl, current = generation;
    if (!url) return;
    if (!navigator.share) { await copyInvitationLink(); return; }
    try {
      await navigator.share({ title: '好友與邀請', url });
      if (current === generation) status('好友邀請連結已分享。');
    } catch (error) {
      if (current === generation && error.name !== 'AbortError') status('分享暫時無法使用，請按「複製好友邀請連結」或掃描 QR Code。');
    }
  }
  async function refresh(showLoading = true) {
    if (!profile || loading) return;
    loading = true; const current = generation;
    const panel = el('friendsPanel'); panel.dataset.state = 'loading'; panel.setAttribute('aria-busy', 'true');
    el('refreshFriends').disabled = true;
    if (showLoading) status('正在載入好友…');
    try {
      const result = await request('list'); if (current !== generation) return;
      if (booking) {
        const select = el('friendBookingRecipient');
        if (lockedRecipient) { select.replaceChildren(new Option(lockedRecipient.name || '本人', lockedRecipient.code)); select.value = lockedRecipient.code; select.disabled = true; panel.dataset.state = 'ready'; if (showLoading) status('編輯既有預約，服務對象維持原會員。'); return; }
        select.disabled = false; const previous = selectedCode; select.replaceChildren(new Option('本人', ''));
        for (const friend of result.friends || []) if (friend.status === 'accepted') select.add(new Option(`${friend.displayName} · ${friend.memberCode}`, friend.memberCode));
        selectedCode = Array.from(select.options).some(option => option.value === previous) ? previous : ''; select.value = selectedCode;
      } else {
        const list = el('friendList'); list.replaceChildren();
        for (const friend of result.friends || []) {
          const row = document.createElement('article'); row.className = 'friend-row';
          const copy = document.createElement('div'), name = document.createElement('strong'), hint = document.createElement('small');
          name.textContent = `${friend.displayName} · ${friend.memberCode}`;
          hint.textContent = friend.status === 'accepted' ? '已成為好友，可代約' : friend.status === 'blocked' ? '已封鎖' : friend.incoming ? '收到好友邀請' : '已送出邀請，等待接受';
          copy.append(name, hint); row.append(copy);
          const actions = document.createElement('div'); actions.className = 'friend-actions';
          const choices = friend.status === 'pending' && friend.incoming ? [['accept', '接受'], ['remove', '婉拒'], ['block', '封鎖']] : friend.status === 'blocked' ? [['remove', '解除封鎖']] : [['remove', friend.status === 'pending' ? '撤回邀請' : '解除好友'], ['block', '封鎖']];
          for (const [operation, label] of choices) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-refresh'; button.textContent = label;
            button.addEventListener('click', async () => {
              const account = generation; button.disabled = true;
              try { await request(operation, friend.memberCode); if (account !== generation) return; status('好友關係已更新。'); await refresh(false); }
              catch (error) { if (account === generation) status(error.message); }
              finally { button.disabled = false; }
            }); actions.append(button);
          }
          row.append(actions); list.append(row);
        }
        if (!list.children.length) list.textContent = '目前沒有好友，分享連結或掃描 QR Code 即可邀請。';
        const received = el('friendReceivedBookings'); received.replaceChildren();
        for (const item of result.receivedBookings || []) { const line = document.createElement('p'); line.textContent = `好友代約服務：${item.bookingDate} ${item.startTime} · ${item.statusLabel} · ${item.serviceTitle}`; received.append(line); }
      }
      panel.dataset.state = (result.friends || []).length ? 'ready' : 'empty';
      if (showLoading) status('好友資料已更新。');
    } catch (error) { if (current === generation) { panel.dataset.state = 'error'; status(error.message || '好友資料載入失敗，請更新好友重試。'); } }
    finally { loading = false; panel.setAttribute('aria-busy', 'false'); if (el('refreshFriends')) el('refreshFriends').disabled = false; if (current !== generation && profile) void refresh(); }
  }
  function ready(event) {
    const next = event.detail?.profile; if (!next?.lineUserId) return;
    if (next.membershipRequired || next.profileComplete === false) { generation++; stopScan(); profile = null; invitationUrl = ''; selectedCode = ''; lockedRecipient = null; window.MemberReferral?.close(); return; }
    const changed = profile?.lineUserId !== next.lineUserId;
    if (changed) { generation++; stopScan(); busy = false; selectedCode = ''; lockedRecipient = null; invalidate(); el('friendList')?.replaceChildren(); el('friendReceivedBookings')?.replaceChildren(); for (const id of ['lookupFriend', 'confirmFriendRequest']) if (el(id)) el(id).disabled = false; if (booking) el('friendsPanel')?.remove(); }
    profile = next; install(); if (!el('friendsPanel')) return;
    if (!booking) {
      const url = new URL('../member/', location.href); url.hash = 'friend=' + encodeURIComponent(profile.memberCode || '');
      invitationUrl = profile.memberCode ? url.href : '';
      el('shareFriendLink').disabled = !invitationUrl;
      const canvas = el('friendQr'); canvas.hidden = true;
      if (window.FriendQRCode && profile.memberCode) { canvas.hidden = false; window.FriendQRCode.toCanvas(canvas, url.href, { width: 192, margin: 2 }).catch(() => { canvas.hidden = true; }); }
      const hash = new URLSearchParams(location.hash.slice(1));
      const incoming = hash.get('friend') || hash.get('invite') || new URLSearchParams(location.search).get('invite');
      if (changed) selectMemberTab('friends');
      if (changed && incoming) input().value = incoming.slice(0, 40);
      if (changed && (location.hash === '#friends' || incoming)) {
        selectMemberTab(incoming ? 'invite' : 'friends');
        el('openMemberReferral').click();
      }
    }
    void refresh();
  }
  window.addEventListener(booking ? 'booking:member-loaded' : 'member-profile-ready', ready);
  window.addEventListener('member-referral:closed', stopScan);
  window.addEventListener(booking ? 'booking:refresh' : 'member-system:realtime-invalidation', () => { if (profile) void refresh(false); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopScan(); });
  window.addEventListener('pagehide', () => { generation++; stopScan(); profile = null; invitationUrl = ''; selectedCode = ''; });
  window.MemberFriends = {
    lookup, invalidate, stopScan, openTab: selectMemberTab, copyInvitationLink, invitationUrl: () => invitationUrl, isBusy: () => busy, selected: () => selectedCode,
    lock: (code, name) => { lockedRecipient = { code: code || '', name: code ? `${name || '好友'} · ${code}（編輯時不可更換）` : '本人（編輯時不可更換）' }; selectedCode = code || ''; void refresh(); },
    clear: () => { selectedCode = ''; lockedRecipient = null; const select = el('friendBookingRecipient'); if (select) { select.disabled = false; select.value = ''; } void refresh(false); },
  };
})();
