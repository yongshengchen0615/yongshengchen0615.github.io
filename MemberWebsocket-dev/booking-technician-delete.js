(() => {
  'use strict';

  const surfaces = [
    {
      form: 'technicianForm',
      technicianId: 'technicianId',
      expectedUpdatedAt: 'technicianExpectedUpdatedAt',
      technicianName: 'technicianName',
      title: 'technicianFormTitle',
      saveButton: 'saveTechnicianButton',
      newButton: 'newTechnicianButton',
      refreshButton: '',
      message: 'bookingResourceMessage',
      deleteButton: 'deleteTechnicianButton',
    },
  ];

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  function init() {
    const installAll = () => surfaces.forEach(installSurface);
    installAll();

    // The standalone booking resource editor is dynamically mounted. Keep watching
    // long enough for LIFF/admin bootstrap so its delete control remains available.
    // The primary admin technician page owns its custom modal deletion flow directly.
    const observer = new MutationObserver(installAll);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 30000);
  }

  function installSurface(surface) {
    const form = document.getElementById(surface.form);
    const saveButton = document.getElementById(surface.saveButton);
    if (!form || !saveButton || document.getElementById(surface.deleteButton)) return;

    const button = document.createElement('button');
    button.id = surface.deleteButton;
    button.className = 'button button-danger';
    button.type = 'button';
    button.textContent = '刪除技師';
    button.disabled = true;
    saveButton.insertAdjacentElement('afterend', button);
    button.addEventListener('click', () => deleteTechnician(surface, button));

    const sync = () => {
      const technicianId = String(document.getElementById(surface.technicianId)?.value || '');
      button.disabled = !technicianId;
      button.classList.toggle('hidden', !technicianId);
    };

    const title = document.getElementById(surface.title);
    if (title) new MutationObserver(sync).observe(title, { childList: true, subtree: true, characterData: true });
    document.getElementById(surface.newButton)?.addEventListener('click', () => window.queueMicrotask(sync));
    form.addEventListener('click', () => window.queueMicrotask(sync));
    sync();
  }

  async function deleteTechnician(surface, button) {
    const technicianId = String(document.getElementById(surface.technicianId)?.value || '');
    const expectedUpdatedAt = String(document.getElementById(surface.expectedUpdatedAt)?.value || '');
    const technicianName = String(document.getElementById(surface.technicianName)?.value || '').trim() || '這位技師';
    if (!technicianId || !expectedUpdatedAt) return showMessage(surface, '請先選擇要刪除的技師。', 'error');

    const confirmed = window.confirm(`確定永久刪除技師「${technicianName}」？\n\n若已有預約紀錄，系統會拒絕刪除並保留歷史資料。`);
    if (!confirmed) return;

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = '刪除中…';
    try {
      const config = await loadConfig();
      const idToken = await waitForToken();
      const endpoint = `${String(config?.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/booking-technician-delete`;
      if (!config?.supabaseUrl || !config?.supabasePublishableKey) throw clientError('CONFIG_ERROR', '預約服務設定不完整。');

      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 30000);
      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          cache: 'no-store',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', apikey: String(config.supabasePublishableKey) },
          body: JSON.stringify({
            action: 'admin.booking.resources.technician.delete',
            clientType: 'admin',
            idToken,
            technicianId,
            expectedUpdatedAt,
          }),
        });
      } finally {
        window.clearTimeout(timer);
      }

      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok !== true) {
        throw clientError(String(data?.error?.code || 'API_ERROR'), String(data?.error?.message || '技師刪除失敗。'));
      }

      showMessage(surface, `技師「${technicianName}」已刪除。`, 'success');
      document.getElementById(surface.newButton)?.click();
      window.dispatchEvent(new CustomEvent('booking:technician-deleted', { detail: { technicianId } }));
      if (surface.refreshButton) document.getElementById(surface.refreshButton)?.click();
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? '技師刪除服務逾時，請稍後再試。'
        : error?.message || '技師刪除失敗。';
      showMessage(surface, message, 'error');
    } finally {
      button.textContent = originalText;
      button.disabled = !String(document.getElementById(surface.technicianId)?.value || '');
    }
  }

  async function loadConfig() {
    if (typeof window.MemberSystem?.loadConfig === 'function') return await window.MemberSystem.loadConfig();
    if (typeof window.BookingSystem?.loadConfig === 'function') return await window.BookingSystem.loadConfig();
    throw clientError('CONFIG_ERROR', '找不到預約服務設定。');
  }

  async function waitForToken() {
    for (let i = 0; i < 150; i += 1) {
      const token = typeof window.liff?.getIDToken === 'function' ? String(window.liff.getIDToken() || '') : '';
      if (token) return token;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    throw clientError('AUTH_REQUIRED', '管理端登入尚未完成，請重新整理後再試。');
  }

  function showMessage(surface, message, type) {
    const element = document.getElementById(surface.message);
    if (!element) return;
    element.textContent = String(message || '');
    element.className = `form-message${type === 'success' ? ' success' : ''}`;
  }

  function clientError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
})();