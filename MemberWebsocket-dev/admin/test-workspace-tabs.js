(() => {
  'use strict';

  const TABS = [
    { key: 'environment', label: '環境與帳號' },
    { key: 'runner', label: '自動化測試' },
    { key: 'history', label: '歷史紀錄' }
  ];

  let mounted = false;
  let activeKey = 'environment';
  const refs = { buttons: new Map(), panels: new Map() };

  window.addEventListener('DOMContentLoaded', mount);
  window.addEventListener('member-admin-ready', mount);

  function mount() {
    if (mounted) return;
    const host = document.getElementById('testModePanel');
    const heading = host?.querySelector('.test-mode-panel-heading');
    const environmentContent = host?.querySelector('.test-mode-panel-grid');
    const controlCenter = host?.querySelector('.test-control-center');
    const controlLayout = controlCenter?.querySelector('.test-control-layout');
    const historyCard = controlLayout?.querySelector('.test-control-history-card');
    if (!host || !heading || !environmentContent || !controlCenter || !controlLayout || !historyCard) return;

    const nav = document.createElement('nav');
    nav.className = 'test-workspace-tabs';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', '測試功能分類');

    for (const item of TABS) {
      const button = document.createElement('button');
      button.id = 'testWorkspace' + capitalize(item.key) + 'Tab';
      button.className = 'test-workspace-tab';
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', item.key === activeKey ? 'true' : 'false');
      button.setAttribute('aria-controls', 'testWorkspace' + capitalize(item.key) + 'Panel');
      button.tabIndex = item.key === activeKey ? 0 : -1;
      button.dataset.testWorkspaceTab = item.key;
      button.textContent = item.label;
      button.addEventListener('click', () => activate(item.key));
      button.addEventListener('keydown', onTabKeydown);
      refs.buttons.set(item.key, button);
      nav.appendChild(button);
    }

    const environmentPanel = createPanel('environment');
    const runnerPanel = createPanel('runner');
    const historyPanel = createPanel('history');

    const historyShell = document.createElement('section');
    historyShell.className = 'test-workspace-history-shell';
    historyShell.setAttribute('aria-labelledby', 'testWorkspaceHistoryTitle');

    const historyHeading = document.createElement('div');
    historyHeading.className = 'test-workspace-history-heading';
    historyHeading.innerHTML = '<div><span class="test-mode-eyebrow">Automation history</span><h3 id="testWorkspaceHistoryTitle">歷史測試紀錄</h3><p>保留最近的測試執行結果。點選任一紀錄後，會切換到自動化測試分頁並顯示該次案例、Expected 與 Actual。</p></div>';
    historyShell.append(historyHeading, historyCard);

    controlLayout.classList.add('is-runner-only');
    environmentPanel.appendChild(environmentContent);
    runnerPanel.appendChild(controlCenter);
    historyPanel.appendChild(historyShell);

    heading.after(nav, environmentPanel, runnerPanel, historyPanel);

    historyPanel.addEventListener('click', (event) => {
      if (event.target.closest('.test-control-history-item')) {
        activate('runner');
      }
    });

    window.AdminTestWorkspaceTabs = Object.freeze({
      activate: (key) => activate(key),
      current: () => activeKey
    });

    mounted = true;
    activate(activeKey, false);
  }

  function createPanel(key) {
    const panel = document.createElement('section');
    panel.id = 'testWorkspace' + capitalize(key) + 'Panel';
    panel.className = 'test-workspace-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', 'testWorkspace' + capitalize(key) + 'Tab');
    panel.tabIndex = 0;
    panel.hidden = key !== activeKey;
    refs.panels.set(key, panel);
    return panel;
  }

  function activate(key, focus = false) {
    if (!refs.buttons.has(key) || !refs.panels.has(key)) return;
    activeKey = key;
    for (const item of TABS) {
      const selected = item.key === key;
      const button = refs.buttons.get(item.key);
      const panel = refs.panels.get(item.key);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
      panel.hidden = !selected;
    }
    if (focus) refs.buttons.get(key)?.focus();
  }

  function onTabKeydown(event) {
    const index = TABS.findIndex((item) => item.key === event.currentTarget.dataset.testWorkspaceTab);
    if (index < 0) return;

    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    else return;

    event.preventDefault();
    activate(TABS[nextIndex].key, true);
  }

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
})();
