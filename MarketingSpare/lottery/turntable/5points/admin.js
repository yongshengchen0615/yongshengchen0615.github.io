/* Admin page logic for managing turntable probabilities via Apps Script */
(function () {
  const els = {
    scriptUrl: document.getElementById('scriptUrl'),
    sheetName: document.getElementById('sheetName'),
    proxyUrl: document.getElementById('proxyUrl'),
    noCorsMode: document.getElementById('noCorsMode'),
    loadBtn: document.getElementById('loadBtn'),
    status: document.getElementById('status'),
    tableBody: document.querySelector('#dataTable tbody'),
    addRowBtn: document.getElementById('addRowBtn'),
    resetBtn: document.getElementById('resetBtn'),
    saveBtn: document.getElementById('saveBtn'),
  };

  // Persist URL to localStorage for convenience
  const LS_KEY = 'turntable_admin_script_url';
  const LS_SHEET = 'turntable_admin_sheet_name';
  const LS_PROXY = 'turntable_admin_proxy_url';
  const LS_NOCORS = 'turntable_admin_no_cors';
  const savedUrl = localStorage.getItem(LS_KEY);
  const savedSheet = localStorage.getItem(LS_SHEET);
  const savedProxy = localStorage.getItem(LS_PROXY);
  const savedNoCors = localStorage.getItem(LS_NOCORS);
  if (savedUrl) els.scriptUrl.value = savedUrl;
  if (savedSheet) els.sheetName.value = savedSheet;
  if (savedProxy) els.proxyUrl.value = savedProxy;
  if (savedNoCors) els.noCorsMode.checked = savedNoCors === '1';

  function setStatus(msg, ok = true) {
    els.status.textContent = msg || '';
    els.status.className = 'status ' + (ok ? 'ok' : 'err');
  }

  function rowTemplate(item, idx) {
    const label = item?.label ?? '';
    const probability = item?.probability ?? '';
    const color = item?.color ?? '';
    return `
      <tr>
        <td>${idx + 1}</td>
        <td><input type="text" value="${escapeHtml(label)}" placeholder="獎項名稱" /></td>
        <td><input type="text" value="${escapeHtml(probability)}" placeholder="數字或百分比，如 20 或 20%" /></td>
        <td><input type="text" value="${escapeHtml(color)}" placeholder="#FFB200 或 red" /></td>
        <td><button class="btn danger" data-action="delete">刪除</button></td>
      </tr>
    `;
  }

  function renderRows(items) {
    els.tableBody.innerHTML = (items || []).map(rowTemplate).join('');
  }

  function addEmptyRow() {
    const tr = document.createElement('tr');
    tr.innerHTML = rowTemplate({}, els.tableBody.children.length);
    els.tableBody.appendChild(tr);
  }

  function getRows() {
    const rows = [];
    for (const tr of els.tableBody.querySelectorAll('tr')) {
      const tds = tr.querySelectorAll('td');
      const label = tds[1].querySelector('input').value.trim();
      const probRaw = tds[2].querySelector('input').value.trim();
      const color = tds[3].querySelector('input').value.trim();
      if (!label) continue;
      rows.push({ label, probability: toNumber(probRaw), color: color || undefined });
    }
    return rows;
  }

  function toNumber(val) {
    if (typeof val === 'number') return val;
    const s = String(val || '').trim();
    const m = s.match(/^([0-9]+(?:\.[0-9]+)?)%$/);
    if (m) return parseFloat(m[1]);
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function fetchData() {
    const url = els.scriptUrl.value.trim();
    const sheet = els.sheetName.value.trim();
    const proxy = els.proxyUrl.value.trim();
    if (!url) return setStatus('請先填入 Apps Script Web App URL', false);
    localStorage.setItem(LS_KEY, url);
    if (sheet) localStorage.setItem(LS_SHEET, sheet);
    if (proxy) localStorage.setItem(LS_PROXY, proxy); else localStorage.removeItem(LS_PROXY);

    try {
      setStatus('載入中…');
      const qs = sheet ? `?sheet=${encodeURIComponent(sheet)}` : '';
      const target = (proxy ? (proxy.replace(/\/$/, '') + '/' + url.replace(/^https?:\/\//, '')) : (url)) + qs;
      const res = await fetch(target, { method: 'GET' });
      const data = await res.json();
      if (data && data.error) {
        setStatus('後端錯誤：' + data.error, false);
        return;
      }
      renderRows(Array.isArray(data) ? data : []);
      setStatus('載入完成');
    } catch (err) {
      setStatus('載入失敗：' + (err?.message || err), false);
    }
  }

  async function saveData() {
    const url = els.scriptUrl.value.trim();
    const sheet = els.sheetName.value.trim();
    const proxy = els.proxyUrl.value.trim();
    const useNoCors = !!els.noCorsMode.checked;
    if (!url) return setStatus('請先填入 Apps Script Web App URL', false);
    localStorage.setItem(LS_KEY, url);
    if (sheet) localStorage.setItem(LS_SHEET, sheet);
    if (proxy) localStorage.setItem(LS_PROXY, proxy); else localStorage.removeItem(LS_PROXY);
    localStorage.setItem(LS_NOCORS, useNoCors ? '1' : '0');

    const payload = {
      sheet: sheet || undefined,
      items: getRows()
    };

    try {
      setStatus('儲存中…');
      const target = proxy ? (proxy.replace(/\/$/, '') + '/' + url.replace(/^https?:\/\//, '')) : url;
      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload)
      };
      if (useNoCors) options.mode = 'no-cors';
      const res = await fetch(target, options);
      const data = await res.json().catch(() => ({}));
      if (data && data.error) {
        setStatus('後端錯誤：' + data.error, false);
        return;
      }
      setStatus(useNoCors ? '已送出（no-cors 模式，不讀回應）' : '儲存完成');
    } catch (err) {
      setStatus('儲存失敗：' + (err?.message || err), false);
    }
  }

  // Event bindings
  els.loadBtn.addEventListener('click', fetchData);
  els.addRowBtn.addEventListener('click', addEmptyRow);
  els.resetBtn.addEventListener('click', () => {
    els.tableBody.innerHTML = '';
    setStatus('已清空');
  });
  els.saveBtn.addEventListener('click', saveData);

  els.tableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="delete"]');
    if (!btn) return;
    const tr = btn.closest('tr');
    if (tr) tr.remove();
  });
})();
