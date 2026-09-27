(() => {
  'use strict';

  // This is presentation state only. Membership and access checks stay on the server.
  const VERSION = 1;
  const STEPS = [
    { selector: '#memberPass', title: '這是你的會員卡', description: '在這裡確認會員狀態、姓名與目前階級。' },
    { selector: '#membershipProgress', title: '查看升等進度', description: '服務時間會累積在這裡，下一個會員階級也會顯示在此。' },
    { selector: '.profile-details', title: '確認個人資料', description: '可以查看會員編號、聯絡資料，也能修改稱呼、生日和電話。' },
    { selector: '#memberFeatureLinks', title: '探索其他功能', description: '從這裡前往集點卡、活動票券、活動日曆與預約服務。' },
  ];
  const ui = {};
  let active = false;
  let stepIndex = 0;
  let storageKey = '';
  let checkedKey = '';
  let opener = null;
  let identityGeneration = 0;

  document.addEventListener('DOMContentLoaded', () => {
    for (const id of ['app', 'memberView', 'openMemberTour', 'memberTourOverlay', 'memberTourFocus', 'memberTourDialog', 'memberTourTitle', 'memberTourDescription', 'memberTourProgress', 'memberTourSkip', 'memberTourBack', 'memberTourNext']) {
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
      if (event.key === 'Escape') { event.preventDefault(); close('skip'); }
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
  });

  async function considerProfile(profile) {
    const lineUserId = String(profile?.lineUserId || '');
    if (!lineUserId || !profile.profileComplete || profile.membershipRequired) return;
    const generation = ++identityGeneration;
    let key = '';
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lineUserId));
      key = `member-tour:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
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
    const openWhenReady = (remainingFrames) => {
      if (generation !== identityGeneration || storageKey !== key) return;
      if (!ui.memberView.classList.contains('hidden')) return open(null);
      if (remainingFrames > 0) requestAnimationFrame(() => openWhenReady(remainingFrames - 1));
    };
    requestAnimationFrame(() => openWhenReady(30));
  }

  function available(index) {
    const element = document.querySelector(STEPS[index].selector);
    return element && element.isConnected && !element.closest('.hidden') ? element : null;
  }

  function findStep(from, direction) {
    for (let index = from; index >= 0 && index < STEPS.length; index += direction) {
      if (available(index)) return index;
    }
    return -1;
  }

  function open(trigger) {
    if (active || ui.memberView.classList.contains('hidden')) return;
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
    ui.memberTourProgress.textContent = `使用教學 ${stepIndex + 1} / ${STEPS.length}`;
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
