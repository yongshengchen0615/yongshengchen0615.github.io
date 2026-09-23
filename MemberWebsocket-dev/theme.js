(() => {
  'use strict';

  const STORAGE_KEY = 'lumen-color-theme-v1';
  const THEMES = new Set(['light', 'dark']);
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');

  function readStoredTheme() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      return THEMES.has(value) ? value : '';
    } catch {
      return '';
    }
  }

  function preferredTheme() {
    return readStoredTheme() || (media?.matches ? 'dark' : 'light');
  }

  function updateThemeMeta(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1714' : '#f6f1e8');
  }

  function updateButton(theme) {
    const button = document.getElementById('themeToggleButton');
    if (!button) return;
    const isDark = theme === 'dark';
    button.setAttribute('aria-pressed', String(isDark));
    button.setAttribute('aria-label', isDark ? '切換為亮色調' : '切換為暗色調');
    button.setAttribute('title', isDark ? '切換為亮色調' : '切換為暗色調');
    button.textContent = isDark ? '☀ 亮色' : '☾ 暗色';
  }

  function applyTheme(theme, options = {}) {
    const next = THEMES.has(theme) ? theme : preferredTheme();
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    updateThemeMeta(next);
    updateButton(next);

    if (options.persist === true) {
      try { window.localStorage.setItem(STORAGE_KEY, next); } catch {}
    }

    if (options.emit !== false) {
      window.dispatchEvent(new CustomEvent('lumen:themechange', { detail: { theme: next } }));
    }
    return next;
  }

  function createToggle() {
    if (document.getElementById('themeToggleButton')) return;
    const host = document.querySelector('.account-menu');
    if (!host) return;

    const button = document.createElement('button');
    button.id = 'themeToggleButton';
    button.type = 'button';
    button.className = 'theme-toggle-button';
    button.dataset.uiThemeControl = 'true';

    const logout = host.querySelector('#logoutButton');
    if (logout) host.insertBefore(button, logout);
    else host.appendChild(button);

    button.addEventListener('click', () => {
      const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark', { persist: true });
    });

    updateButton(document.documentElement.dataset.theme || preferredTheme());
  }

  applyTheme(preferredTheme(), { emit: false });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createToggle, { once: true });
  } else {
    createToggle();
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    applyTheme(THEMES.has(event.newValue) ? event.newValue : preferredTheme(), { emit: false });
  });

  media?.addEventListener?.('change', (event) => {
    if (readStoredTheme()) return;
    applyTheme(event.matches ? 'dark' : 'light');
  });

  window.LumenTheme = Object.freeze({
    get: () => document.documentElement.dataset.theme || preferredTheme(),
    set: (theme) => applyTheme(theme, { persist: true }),
    reset: () => {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
      return applyTheme(media?.matches ? 'dark' : 'light');
    }
  });
})();
