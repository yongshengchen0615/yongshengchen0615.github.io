/* 共用後台管理邏輯：透過各活動資料夾的 config.js 連接 Apps Script。 */
(function () {
  const CFG = window.TURN_ADMIN_CONFIG || {};
  const SCRIPT_URL = String(CFG.scriptUrl || '').trim();
  const DEFAULT_SHEET = String(CFG.sheetName || '').trim();
  const DEFAULT_PROXY = String(CFG.proxyUrl || '').trim();
  const DEFAULT_NO_CORS = !!CFG.noCors;
  const DEFAULT_COLORS = ['#F87171', '#34D399', '#60A5FA', '#FBBF24', '#A78BFA', '#F472B6', '#10B981', '#F59E0B'];
  const LS_SHEET = 'turntable_admin_sheet_name';
  const LS_PROXY = 'turntable_admin_proxy_url';
  const LS_NOCORS = 'turntable_admin_no_cors';

  const els = {
    status: document.getElementById('status'),
    tableBody: document.querySelector('#dataTable tbody'),
    addRowBtn: document.getElementById('addRowBtn'),
    resetBtn: document.getElementById('resetBtn'),
    saveBtn: document.getElementById('saveBtn')
  };

  let colorCtx;
  function ensureColorCtx() {
    if (!colorCtx) {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      colorCtx = canvas.getContext('2d');
    }
    return colorCtx;
  }

  function colorToHex(input) {
    const source = String(input || '').trim();
    if (!source) return null;
    if (/^#([0-9a-fA-F]{6})$/.test(source)) return source.toUpperCase();

    try {
      const ctx = ensureColorCtx();
      ctx.fillStyle = '#010203';
      ctx.fillStyle = source;
      const out = ctx.fillStyle;
      if (out === '#010203' && source.toLowerCase() !== '#010203') return null;
      if (/^#/.test(out)) return out.toUpperCase();

      const match = out.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (match) {
        const r = (parseInt(match[1], 10) | 0).toString(16).padStart(2, '0');
        const g = (parseInt(match[2], 10) | 0).toString(16).padStart(2, '0');
        const b = (parseInt(match[3], 10) | 0).toString(16).padStart(2, '0');
        return ('#' + r + g + b).toUpperCase();
      }
    } catch (_) {}

    return null;
  }

  function getSheetName() {
    return String(localStorage.getItem(LS_SHEET) || DEFAULT_SHEET || '').trim();
  }

  function getProxyUrl() {
    return String(localStorage.getItem(LS_PROXY) || DEFAULT_PROXY || '').trim();
  }

  function getNoCorsMode() {
    const stored = localStorage.getItem(LS_NOCORS);
    return stored ? stored === '1' : DEFAULT_NO_CORS;
  }

  function persistSettings() {
    const sheet = getSheetName();
    const proxy = getProxyUrl();
    if (sheet) localStorage.setItem(LS_SHEET, sheet);
    if (proxy) localStorage.setItem(LS_PROXY, proxy);
    else localStorage.removeItem(LS_PROXY);
    localStorage.setItem(LS_NOCORS, getNoCorsMode() ? '1' : '0');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setStatus(message, ok = true) {
    const dot = '<span class="dot"></span>';
    els.status.innerHTML = message ? dot + '<span>' + escapeHtml(message) + '</span>' : '';
    els.status.className = 'status ' + (ok ? 'ok' : 'err');
  }

  function toNumber(value) {
    if (typeof value === 'number') return value;
    const source = String(value || '').trim();
    const match = source.match(/^([0-9]+(?:\.[0-9]+)?)%$/);
    if (match) return parseFloat(match[1]);
    const number = parseFloat(source);
    return Number.isFinite(number) ? number : 0;
  }

  function withQuery(url, params) {
    const pairs = Object.entries(params)
      .filter(([, value]) => value)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    if (!pairs.length) return url;
    return url + (url.includes('?') ? '&' : '?') + pairs.join('&');
  }

  function proxiedUrl(url) {
    const proxy = getProxyUrl();
    if (!proxy) return url;
    return proxy.replace(/\/$/, '') + '/' + url.replace(/^https?:\/\//, '');
  }

  function rowTemplate(item, idx) {
    const label = item?.label ?? item?.name ?? item?.獎項 ?? item?.名稱 ?? '';
    const probability = item?.probability ?? item?.weight ?? item?.機率 ?? item?.概率 ?? '';
    const colorRaw = item?.color ?? item?.colour ?? item?.顏色 ?? '';
    const paletteHex = DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
    const colorHex = colorToHex(colorRaw) || paletteHex;
    const colorText = colorRaw || colorHex;

    return `
      <tr draggable="true">
        <td><span class="drag-handle" title="拖曳排序" aria-label="拖曳排序">☰</span><span class="row-index">${idx + 1}</span></td>
        <td><input type="text" value="${escapeHtml(label)}" placeholder="獎項名稱" style="width:100%" /></td>
        <td><input type="text" value="${escapeHtml(probability)}" placeholder="數字或百分比，如 20 或 20%" style="width:100%" /></td>
        <td>
          <div class="color-field">
            <input type="color" class="colorPicker" value="${escapeHtml(colorHex)}" aria-label="選擇顏色" />
            <input type="text" class="colorText" value="${escapeHtml(colorText)}" placeholder="#FFB200 或 red" />
          </div>
        </td>
        <td>
          <button class="btn" data-action="copy">複製</button>
          <button class="btn danger" data-action="delete">刪除</button>
        </td>
      </tr>
    `;
  }

  function renderRows(items) {
    els.tableBody.innerHTML = (items || []).map(rowTemplate).join('');
    renumberRows();
  }

  function nextDefaultItem() {
    const idx = els.tableBody.children.length;
    return {
      label: `獎項 ${idx + 1}`,
      probability: 10,
      color: DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
    };
  }

  function addEmptyRow() {
    const idx = els.tableBody.children.length;
    els.tableBody.insertAdjacentHTML('beforeend', rowTemplate(nextDefaultItem(), idx));
    renumberRows();
  }

  function getRows() {
    const rows = [];

    for (const tr of els.tableBody.querySelectorAll('tr')) {
      const tds = tr.querySelectorAll('td');
      const label = tds[1].querySelector('input').value.trim();
      const probability = tds[2].querySelector('input').value.trim();
      const colorText = tds[3].querySelector('input.colorText')?.value?.trim() || '';
      const colorPick = tds[3].querySelector('input.colorPicker')?.value?.trim() || '';

      if (!label) continue;
      rows.push({
        label,
        probability: toNumber(probability),
        color: colorText || colorPick || undefined
      });
    }

    return rows;
  }

  function renumberRows() {
    let index = 1;
    for (const tr of els.tableBody.querySelectorAll('tr')) {
      const indexEl = tr.querySelector('.row-index');
      if (indexEl) indexEl.textContent = String(index);
      index += 1;
    }
  }

  function getDragAfterElement(container, y) {
    const rows = [...container.querySelectorAll('tr:not(.dragging)')];
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };

    for (const row of rows) {
      const box = row.getBoundingClientRect();
      const offset = y - (box.top + box.height / 2);
      if (offset < 0 && offset > closest.offset) {
        closest = { offset, element: row };
      }
    }

    return closest.element;
  }

  async function fetchData() {
    if (!SCRIPT_URL) {
      setStatus('請先在 config.js 設定 scriptUrl', false);
      return;
    }

    persistSettings();

    try {
      setStatus('載入中…');
      const target = proxiedUrl(withQuery(SCRIPT_URL, { sheet: getSheetName() }));
      const res = await fetch(target, { method: 'GET' });
      const payload = await res.json();
      if (payload?.error) {
        setStatus('後端錯誤：' + payload.error, false);
        return;
      }

      const items = Array.isArray(payload) ? payload : payload?.items;
      renderRows(Array.isArray(items) ? items : []);
      setStatus('載入完成');
    } catch (err) {
      setStatus('載入失敗：' + (err?.message || err), false);
    }
  }

  async function saveData() {
    if (!SCRIPT_URL) {
      setStatus('請先在 config.js 設定 scriptUrl', false);
      return;
    }

    persistSettings();

    const payload = {
      sheet: getSheetName() || undefined,
      items: getRows()
    };

    try {
      setStatus('儲存中…');
      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload)
      };
      if (getNoCorsMode()) options.mode = 'no-cors';

      const res = await fetch(proxiedUrl(SCRIPT_URL), options);
      const data = await res.json().catch(() => ({}));
      if (data?.error) {
        setStatus('後端錯誤：' + data.error, false);
        return;
      }
      setStatus(getNoCorsMode() ? '已送出（no-cors 模式，不讀回應）' : '儲存完成');
    } catch (err) {
      setStatus('儲存失敗：' + (err?.message || err), false);
    }
  }

  document.addEventListener('DOMContentLoaded', fetchData);
  els.addRowBtn.addEventListener('click', addEmptyRow);
  els.resetBtn.addEventListener('click', () => {
    els.tableBody.innerHTML = '';
    setStatus('已清空');
  });
  els.saveBtn.addEventListener('click', saveData);

  els.tableBody.addEventListener('click', (event) => {
    const deleteBtn = event.target.closest('button[data-action="delete"]');
    const copyBtn = event.target.closest('button[data-action="copy"]');

    if (deleteBtn) {
      const tr = deleteBtn.closest('tr');
      if (tr) tr.remove();
      renumberRows();
      return;
    }

    if (copyBtn) {
      const tr = copyBtn.closest('tr');
      if (!tr) return;

      const tds = tr.querySelectorAll('td');
      const item = {
        label: tds[1].querySelector('input')?.value?.trim() || '',
        probability: tds[2].querySelector('input')?.value?.trim() || '',
        color: tds[3].querySelector('input.colorText')?.value?.trim()
          || tds[3].querySelector('input.colorPicker')?.value?.trim()
          || ''
      };
      const idx = [...els.tableBody.querySelectorAll('tr')].indexOf(tr) + 1;
      tr.insertAdjacentHTML('afterend', rowTemplate(item, idx));
      renumberRows();
    }
  });

  els.tableBody.addEventListener('input', (event) => {
    const picker = event.target.closest('input.colorPicker');
    const text = event.target.closest('input.colorText');

    if (picker) {
      const textEl = picker.closest('tr')?.querySelector('input.colorText');
      if (textEl) textEl.value = picker.value;
      return;
    }

    if (text) {
      const hex = colorToHex(text.value);
      const pickerEl = text.closest('tr')?.querySelector('input.colorPicker');
      if (hex && pickerEl) pickerEl.value = hex;
    }
  });

  els.tableBody.addEventListener('dragstart', (event) => {
    const tr = event.target.closest('tr');
    if (!tr) return;
    tr.classList.add('dragging');
    try {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', '');
    } catch (_) {}
  });

  els.tableBody.addEventListener('dragover', (event) => {
    event.preventDefault();
    const dragging = els.tableBody.querySelector('tr.dragging');
    if (!dragging) return;

    const after = getDragAfterElement(els.tableBody, event.clientY);
    if (after == null) els.tableBody.appendChild(dragging);
    else els.tableBody.insertBefore(dragging, after);
  });

  els.tableBody.addEventListener('drop', (event) => {
    event.preventDefault();
  });

  els.tableBody.addEventListener('dragend', () => {
    const dragging = els.tableBody.querySelector('tr.dragging');
    if (dragging) dragging.classList.remove('dragging');
    renumberRows();
  });

  let touchDrag = { active: false, row: null };
  els.tableBody.addEventListener('touchstart', (event) => {
    const handle = event.target.closest('.drag-handle');
    if (!handle) return;

    const tr = handle.closest('tr');
    if (!tr) return;

    touchDrag = { active: true, row: tr };
    tr.classList.add('dragging');
  }, { passive: true });

  els.tableBody.addEventListener('touchmove', (event) => {
    if (!touchDrag.active || !touchDrag.row) return;
    if (event.cancelable) event.preventDefault();

    const touch = event.touches[0];
    const after = getDragAfterElement(els.tableBody, touch.clientY);
    if (after == null) els.tableBody.appendChild(touchDrag.row);
    else els.tableBody.insertBefore(touchDrag.row, after);
  }, { passive: false });

  els.tableBody.addEventListener('touchend', () => {
    if (touchDrag.row) touchDrag.row.classList.remove('dragging');
    touchDrag = { active: false, row: null };
    renumberRows();
  });
})();
