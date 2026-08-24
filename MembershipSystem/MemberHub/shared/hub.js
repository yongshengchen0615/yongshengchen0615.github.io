(() => {
  'use strict';

  const MODULES = Object.freeze({
    user: Object.freeze([
      { id: 'membership', title: '我的會員卡', description: '會員資料、等級、分鐘紀錄與消費 QR', href: '../modules/membership/user/', icon: '會員' },
      { id: 'points', title: '集點與票券', description: '多張集點卡、優惠券、抽獎券與掃碼集點', href: '../modules/points/user/', icon: '集點' },
      { id: 'calendar', title: '活動日曆', description: '休假日、活動、公告與月份瀏覽', href: '../modules/calendar/user/', icon: '日曆' }
    ]),
    admin: Object.freeze([
      { id: 'membership', title: '會員管理', description: '會員狀態、分鐘、等級門檻與消費 QR', href: '../modules/membership/admin/', icon: '會員' },
      { id: 'points', title: '集點管理', description: '集點卡、獎勵節點、票券、QR 與交易紀錄', href: '../modules/points/admin/', icon: '集點' },
      { id: 'calendar', title: '日曆管理', description: '建立活動、公告、休假日與使用者狀態', href: '../modules/calendar/admin/', icon: '日曆' }
    ])
  });

  function safeModuleId(value) {
    return ['membership', 'points', 'calendar'].includes(value) ? value : '';
  }

  function renderModules() {
    const surface = document.body.dataset.surface === 'admin' ? 'admin' : 'user';
    const container = document.querySelector('[data-module-list]');
    if (!container) return;

    const fragment = document.createDocumentFragment();
    MODULES[surface].forEach((module) => {
      const link = document.createElement('a');
      link.className = 'module-card';
      link.href = module.href;
      link.dataset.module = module.id;
      link.setAttribute('aria-label', `${module.title}：${module.description}`);

      const badge = document.createElement('span');
      badge.className = `module-icon module-icon--${safeModuleId(module.id)}`;
      badge.textContent = module.icon;
      badge.setAttribute('aria-hidden', 'true');

      const copy = document.createElement('span');
      copy.className = 'module-copy';
      const title = document.createElement('strong');
      title.textContent = module.title;
      const description = document.createElement('span');
      description.textContent = module.description;
      copy.append(title, description);

      const arrow = document.createElement('span');
      arrow.className = 'module-arrow';
      arrow.textContent = '→';
      arrow.setAttribute('aria-hidden', 'true');
      link.append(badge, copy, arrow);
      fragment.append(link);
    });
    container.replaceChildren(fragment);
  }

  document.addEventListener('DOMContentLoaded', renderModules, { once: true });
})();

