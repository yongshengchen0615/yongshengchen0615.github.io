(() => {
  'use strict';

  // Presentation state only. Authentication and permissions stay on the server.
  const VERSION = 1;
  const SURFACES = {
    member: [
      { selector: '#memberPass', title: '這是你的會員卡', description: '在這裡確認會員狀態、姓名與目前階級。' },
      { selector: '#membershipProgress', title: '查看升等進度', description: '服務時間會累積在這裡，下一個會員階級也會顯示在此。' },
      { selector: '.profile-details', title: '確認個人資料', description: '可以查看會員編號、聯絡資料，也能修改稱呼、生日和電話。' },
      { selector: '#memberFeatureLinks', title: '探索其他功能', description: '從這裡前往集點卡、活動票券、活動日曆與預約服務。' },
    ],
    points: [
      { selector: '#membershipProgress', title: '查看會員階級', description: '先確認目前階級與下一階段所需的服務時間。' },
      { selector: '#cardTabs button', title: '切換集點卡', description: '有多張卡片時，從這裡選擇要查看的集點卡。' },
      { selector: '#activeCardView:not(.hidden)', title: '查看集點進度', description: '這裡顯示目前點數、使用期限與優惠說明。' },
      { selector: '.tickets-panel', title: '查看可用票券', description: '集點卡票券在這裡查看；使用前請確認票券詳情。' },
      { selector: '#ticketHistoryDisclosure', title: '查看使用紀錄', description: '需要查詢已使用的票券時，可以展開紀錄。' },
    ],
    event: [
      { selector: '#membershipProgress', title: '確認會員資格', description: '部分活動依會員階級開放，先在這裡確認目前階級。' },
      { selector: '.event-toolbar', title: '查看活動狀態', description: '這裡會顯示目前開放的票券及已使用紀錄數量。' },
      { selector: '#eventList .event-ticket', title: '查看或領取票券', description: '點開票券後先閱讀說明；領取與核銷是不同操作。' },
      { selector: '#usedTicketHistory:not(.hidden)', title: '查詢核銷紀錄', description: '已使用的票券與結果保留在這裡。' },
      { selector: '#emptyView:not(.hidden)', title: '尚無開放活動', description: '有新的活動票券時，會顯示在這個區域。' },
    ],
    calendar: [
      { selector: '#membershipProgress', title: '確認會員階級', description: '會員階級與累積服務時間會顯示在這裡。' },
      { selector: '.calendar-toolbar', title: '切換月份', description: '使用左右按鈕切換月份，也可以回到本月。' },
      { selector: '#calendarGrid', title: '查看休假日與活動', description: '有活動或休假的日期可點開查看詳細內容。' },
    ],
    booking: [
      { selector: '#membershipProgress', title: '確認會員階級', description: '預約前可先查看會員階級與服務時間進度。' },
      { selector: '#bookingNotice', title: '閱讀預約說明', description: '請先確認店家公告與可預約時段規則。' },
      { selector: '#calendarGrid', title: '選擇預約日期', description: '點選可預約日期後，再選服務與時間；送出前會再次確認。' },
      { selector: '#bookingView .booking-card[aria-labelledby="myBookingsTitle"]', title: '查看我的預約', description: '已預約、已完成與已取消的紀錄都會顯示在這裡。' },
    ],
  };
  let surface = '';
  let STEPS = [];
  const ui = {};
  let active = false;
  let stepIndex = 0;
  let storageKey = '';
  let checkedKey = '';
  let opener = null;
  let identityGeneration = 0;

  document.addEventListener('DOMContentLoaded', () => {
    ui.view = document.querySelector('main[data-user-tour]');
    surface = ui.view?.dataset.userTour || '';
    STEPS = SURFACES[surface] || [];
    if (!STEPS.length) return;
    installControls();
    ui.app = document.getElementById('app') || document.querySelector('.app-shell');
    for (const id of ['openMemberTour', 'memberTourOverlay', 'memberTourFocus', 'memberTourDialog', 'memberTourTitle', 'memberTourDescription', 'memberTourProgress', 'memberTourSkip', 'memberTourBack', 'memberTourNext']) {
      ui[id] = document.getElementById(id);
    }
    if (Object.values(ui).some((element) => !element)) return;
    ui.openMemberTour.addEventListener('click', () => open(ui.openMemberTour));
    ui.memberTourOverlay.addEventListener('click', () => close('skip'));
    ui.memberTourSkip.addEventListener('click', () => close('skip'));
    ui.memberTourBack.addEventListener('click', () => move(-1));
    ui.memberTourNext.addEventListener('click', () => {
      if (stepIndex === STEPS.length - 1) close('complete');
      else move(1);
    });
    ui.memberTourDialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close('skip'); }
      if (event.key !== 'Tab') return;
      const focusable = [ui.memberTourSkip, ui.memberTourBack, ui.memberTourNext].filter((button) => !button.disabled);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ui.memberTourTitle)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
    window.addEventListener('resize', positionFocus);
    window.addEventListener('scroll', positionFocus, true);
    window.addEventListener('member-profile-ready', (event) => { void considerProfile(event.detail?.profile); });
    window.addEventListener('user-tour:ready', (event) => { if (event.detail?.surface === surface) void considerProfile(event.detail.profile); });
  });

  function installControls() {
    if (!document.getElementById('openMemberTour')) {
      const button = document.createElement('button');
      button.id = 'openMemberTour';
      button.type = 'button';
      button.className = 'text-button';
      button.textContent = '使用教學';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-controls', 'memberTourDialog');
      const menu = ui.view.querySelector('.account-menu');
      menu?.insertBefore(button, menu.querySelector('#logoutButton'));
    }
    if (document.getElementById('memberTourDialog')) return;
    const overlay = document.createElement('div');
    overlay.id = 'memberTourOverlay';
    overlay.className = 'member-tour-overlay hidden';
    overlay.setAttribute('aria-hidden', 'true');
    const focus = document.createElement('div');
    focus.id = 'memberTourFocus';
    focus.className = 'member-tour-focus hidden';
    focus.setAttribute('aria-hidden', 'true');
    const dialog = document.createElement('section');
    dialog.id = 'memberTourDialog';
    dialog.className = 'member-tour-dialog hidden';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'memberTourTitle');
    dialog.setAttribute('aria-describedby', 'memberTourDescription');
    dialog.tabIndex = -1;
    dialog.innerHTML = '<p id="memberTourProgress" class="member-tour-progress" aria-live="polite"></p><h2 id="memberTourTitle" tabindex="-1"></h2><p id="memberTourDescription"></p><div class="member-tour-actions"><button id="memberTourSkip" type="button">略過教學</button><button id="memberTourBack" type="button">上一步</button><button id="memberTourNext" type="button">下一步</button></div>';
    document.body.append(overlay, focus, dialog);
  }

  async function considerProfile(profile) {
    const lineUserId = String(profile?.lineUserId || '');
    if (!lineUserId || !profile.profileComplete || profile.membershipRequired) return;
    const generation = ++identityGeneration;
    let key = '';
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lineUserId));
      const identityHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      // Keep the already published member tour completion state on that surface.
      key = surface === 'member' ? `member-tour:${identityHash}` : `user-tour:${surface}:${identityHash}`;
    } catch (_) {
      // Storage and Web Crypto can be unavailable in embedded browsers; the tour still works manually.
      return;
    }
    if (generation !== identityGeneration) return;
    if (storageKey && storageKey !== key && active) close('switch');
    storageKey = key;
    if (checkedKey === key) return;
    checkedKey = key;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { /* storage blocked */ }
    if (saved?.version === VERSION && saved?.completedAt) return;
    // Automated test sessions keep the entry point, but the tour must not cover their test actions.
    if (window.TestModeClient?.getSessionToken?.()) return;
    const openWhenReady = (remainingFrames) => {
      if (generation !== identityGeneration || storageKey !== key) return;
      if (!ui.view.classList.contains('hidden') && !otherDialogOpen()) return open(null);
      if (remainingFrames > 0) requestAnimationFrame(() => openWhenReady(remainingFrames - 1));
    };
    requestAnimationFrame(() => openWhenReady(30));
  }

  function available(index) {
    const element = document.querySelector(STEPS[index].selector);
    return element && element.isConnected && !element.closest('.hidden,[hidden]') ? element : null;
  }

  function otherDialogOpen() {
    return Array.from(document.querySelectorAll('[aria-modal="true"]')).some((dialog) =>
      dialog !== ui.memberTourDialog && !dialog.closest('.hidden,[hidden]')
    );
  }

  function findStep(from, direction) {
    for (let index = from; index >= 0 && index < STEPS.length; index += direction) {
      if (available(index)) return index;
    }
    return -1;
  }

  function open(trigger) {
    if (active || ui.view.classList.contains('hidden') || otherDialogOpen()) return;
    const first = findStep(0, 1);
    if (first < 0) return; // DOM may still be loading: leave the version unrecorded.
    opener = trigger;
    stepIndex = first;
    active = true;
    ui.memberTourOverlay.classList.remove('hidden');
    ui.memberTourDialog.classList.remove('hidden');
    ui.app.inert = true;
    renderStep();
  }

  function move(direction) {
    const next = findStep(stepIndex + direction, direction);
    if (next < 0) {
      if (direction > 0) close('complete');
      return;
    }
    stepIndex = next;
    renderStep();
  }

  function renderStep() {
    if (!active) return;
    const target = available(stepIndex);
    if (!target) {
      const next = findStep(stepIndex + 1, 1);
      if (next < 0) { close('missing'); return; }
      stepIndex = next;
      renderStep();
      return;
    }
    const step = STEPS[stepIndex];
    const visibleSteps = STEPS.map((_, index) => index).filter((index) => available(index));
    ui.memberTourProgress.textContent = `使用教學 ${visibleSteps.indexOf(stepIndex) + 1} / ${visibleSteps.length}`;
    ui.memberTourTitle.textContent = step.title;
    ui.memberTourDescription.textContent = step.description;
    ui.memberTourBack.disabled = findStep(stepIndex - 1, -1) < 0;
    ui.memberTourNext.textContent = findStep(stepIndex + 1, 1) < 0 ? '完成' : '下一步';
    target.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    requestAnimationFrame(positionFocus);
    ui.memberTourTitle.focus();
  }

  function positionFocus() {
    if (!active) return;
    const target = available(stepIndex);
    if (!target) { ui.memberTourFocus.classList.add('hidden'); return; }
    const box = target.getBoundingClientRect();
    if (box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) {
      ui.memberTourFocus.classList.add('hidden');
      return;
    }
    const frame = ui.memberTourFocus.style;
    frame.left = `${Math.max(4, box.left - 5)}px`;
    frame.top = `${Math.max(4, box.top - 5)}px`;
    frame.width = `${Math.max(0, Math.min(innerWidth - 8, box.right + 5) - Math.max(4, box.left - 5))}px`;
    frame.height = `${Math.max(0, Math.min(innerHeight - 8, box.bottom + 5) - Math.max(4, box.top - 5))}px`;
    ui.memberTourFocus.classList.remove('hidden');
  }

  function close(outcome) {
    if (!active) return;
    active = false;
    ui.memberTourOverlay.classList.add('hidden');
    ui.memberTourFocus.classList.add('hidden');
    ui.memberTourDialog.classList.add('hidden');
    ui.app.inert = false;
    if ((outcome === 'skip' || outcome === 'complete') && storageKey) {
      try { localStorage.setItem(storageKey, JSON.stringify({ version: VERSION, completedAt: new Date().toISOString(), outcome })); } catch (_) { /* optional UX state */ }
    }
    const focusTarget = opener?.isConnected ? opener : ui.openMemberTour;
    opener = null;
    focusTarget.focus();
  }
})();
