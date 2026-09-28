(() => {
  'use strict';
  window.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const ids = ['termsReload','termsAdminMessage','termsVersionList','termsNewDraft','termsDraftForm','termsId','termsVersion','termsTitle','termsSummary','termsBody','termsEffectiveAt','termsRequired','termsReconsent','termsSave','termsActivate'];
    const el = Object.fromEntries(ids.map((id) => [id, $(id)]));
    let rows = [];
    let busy = false;
    function message(value) { el.termsAdminMessage.textContent = value; el.termsAdminMessage.classList.toggle('hidden', !value); }
    function session() {
      const value = window.MemberSystem.getSession('admin');
      if (!value) throw new Error('請先登入管理端。');
      return value;
    }
    async function request(action, payload = {}) {
      const { config, idToken } = session();
      return window.MemberSystem.request(config, 'admin', idToken, action, payload);
    }
    function show(row) {
      el.termsId.value = row?.id || '';
      el.termsVersion.value = row?.version || '';
      el.termsTitle.value = row?.title || '';
      el.termsSummary.value = row?.summary || '';
      el.termsBody.value = row?.body || '';
      const date = row?.effective_at ? new Date(row.effective_at) : new Date();
      el.termsEffectiveAt.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      el.termsRequired.checked = row ? row.required === true : true;
      el.termsReconsent.checked = row?.reconsent_existing === true;
      const editable = !row || row.status === 'draft';
      for (const control of el.termsDraftForm.querySelectorAll('input:not([type="hidden"]),textarea')) control.disabled = !editable;
      el.termsSave.disabled = !editable;
      el.termsActivate.disabled = !row || row.status !== 'draft';
      for (const button of el.termsVersionList.querySelectorAll('button')) button.setAttribute('aria-current', String(button.dataset.id === row?.id));
    }
    async function reload(selectedId) {
      const result = await request('admin.terms.list');
      rows = result.terms || [];
      el.termsVersionList.replaceChildren();
      for (const row of rows) {
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.id = row.id;
        button.textContent = `${row.version} · ${row.status === 'active' ? '啟用中' : row.status === 'draft' ? '草稿' : '歷史版本'} · ${row.title}`;
        button.addEventListener('click', () => show(row));
        el.termsVersionList.append(button);
      }
      if (!rows.length) el.termsVersionList.textContent = '尚無條款。請建立並啟用第一版。';
      show(rows.find((row) => row.id === selectedId) || rows.find((row) => row.status === 'active') || rows[0] || null);
    }
    async function run(task) {
      if (busy) return;
      busy = true; message('');
      try { await task(); }
      catch (error) { message(error?.code === 'API_RESPONSE_UNCERTAIN' ? '無法確認是否儲存成功，請先重新載入版本確認。' : error?.message || '操作失敗。'); }
      finally { busy = false; }
    }
    el.termsReload.addEventListener('click', () => run(() => reload(el.termsId.value)));
    el.termsNewDraft.addEventListener('click', () => { show(null); message(''); });
    el.termsDraftForm.addEventListener('submit', (event) => {
      event.preventDefault();
      run(async () => {
        const result = await request('admin.terms.draft.save', {
          id: el.termsId.value || null, version: el.termsVersion.value.trim(), title: el.termsTitle.value.trim(),
          summary: el.termsSummary.value.trim(), body: el.termsBody.value.trim(),
          effectiveAt: new Date(el.termsEffectiveAt.value).toISOString(), required: el.termsRequired.checked,
          reconsentExisting: el.termsReconsent.checked
        });
        await reload(result.id); message('草稿已儲存。確認內容後再啟用。');
      });
    });
    el.termsActivate.addEventListener('click', () => run(async () => {
      const id = el.termsId.value;
      if (!id) return;
      await request('admin.terms.activate', { id });
      await reload(id); message('此版本已啟用，新的會員申請立即適用。');
    }));
    $('membersTab').addEventListener('click', () => { if (session()) run(() => reload(el.termsId.value)); });
    // Admin session becomes available after the authenticated bootstrap.
    const observer = new MutationObserver(() => {
      if (window.MemberSystem.getSession('admin') && !$('adminView').classList.contains('hidden')) {
        observer.disconnect(); run(() => reload());
      }
    });
    observer.observe($('adminView'), { attributes:true, attributeFilter:['class'] });
  });
})();
