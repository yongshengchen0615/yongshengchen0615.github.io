/* Admin page logic for managing turntable probabilities via Apps Script */
(function () {
  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyWac7BflzzvIgv3r5ZMMl7WY4v6tFLgTKGxSkDUZ2Z8skDSLQAa6OOoAU3aN2MciAP/exec';
  const DEFAULT_COLORS = ['#F87171', '#34D399', '#60A5FA', '#FBBF24', '#A78BFA', '#F472B6', '#10B981', '#F59E0B'];
  let colorCtx;
  function ensureColorCtx() {
    if (!colorCtx) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      colorCtx = c.getContext('2d');
    }
    return colorCtx;
  }

  function colorToHex(input) {
    const s = String(input || '').trim();
    if (!s) return null;
    const hexRe = /^#([0-9a-fA-F]{6})$/;
    if (hexRe.test(s)) return s.toUpperCase();
    try {
      const ctx = ensureColorCtx();
      ctx.fillStyle = '#000000';
      ctx.fillStyle = s; // if invalid, stays '#000000'
      const out = ctx.fillStyle;
      if (/^#/.test(out)) return out.toUpperCase();
      const m = out.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (m) {
        const r = (parseInt(m[1]) | 0).toString(16).padStart(2, '0');
        const g = (parseInt(m[2]) | 0).toString(16).padStart(2, '0');
        const b = (parseInt(m[3]) | 0).toString(16).padStart(2, '0');
        return ('#' + r + g + b).toUpperCase();
      }
    } catch (_) {}
    return null;
  }

  const els = {
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
  const LS_SHEET = 'turntable_admin_sheet_name';
  const LS_PROXY = 'turntable_admin_proxy_url';
  const LS_NOCORS = 'turntable_admin_no_cors';
  const savedSheet = localStorage.getItem(LS_SHEET);
  const savedProxy = localStorage.getItem(LS_PROXY);
  const savedNoCors = localStorage.getItem(LS_NOCORS);
  if (savedSheet) els.sheetName.value = savedSheet;
  if (savedProxy) els.proxyUrl.value = savedProxy;
  if (savedNoCors) els.noCorsMode.checked = savedNoCors === '1';

  function setStatus(msg, ok = true) {
    const dot = '<span class="dot"></span>';
    els.status.innerHTML = (msg ? (dot + '<span>' + escapeHtml(msg) + '</span>') : '');
    els.status.className = 'status ' + (ok ? 'ok' : 'err');
  }

  function rowTemplate(item, idx) {
    const label = item?.label ?? '';
    const probability = item?.probability ?? '';
    const colorRaw = item?.color ?? '';
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
    // ensure any immediately rendered rows get numbering and synced events
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
      const probRaw = tds[2].querySelector('input').value.trim();
      const colorTextEl = tds[3].querySelector('input.colorText');
      const colorPickerEl = tds[3].querySelector('input.colorPicker');
      const colorTextVal = colorTextEl ? colorTextEl.value.trim() : '';
      const colorPickVal = colorPickerEl ? colorPickerEl.value.trim() : '';
      const color = colorTextVal || colorPickVal;
      if (!label) continue;
      rows.push({ label, probability: toNumber(probRaw), color: color || undefined });
    }
    return rows;
  }

  function renumberRows() {
    let i = 1;
    for (const tr of els.tableBody.querySelectorAll('tr')) {
      const idxEl = tr.querySelector('.row-index');
      if (idxEl) idxEl.textContent = String(i++);
      else {
        const first = tr.querySelector('td');
        if (first) first.textContent = String(i++);
      }
    }
  }

  function getDragAfterElement(container, y) {
    const elsArr = [...container.querySelectorAll('tr:not(.dragging)')];
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
    for (const child of elsArr) {
      const box = child.getBoundingClientRect();
      const offset = y - (box.top + box.height / 2);
      if (offset < 0 && offset > closest.offset) {
        closest = { offset, element: child };
      }
    }
    return closest.element;
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
    const url = SCRIPT_URL.trim();
    const sheet = els.sheetName.value.trim();
    const proxy = els.proxyUrl.value.trim();
    if (!url) return setStatus('請先在程式碼中設定 SCRIPT_URL', false);
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
    const url = SCRIPT_URL.trim();
    const sheet = els.sheetName.value.trim();
    const proxy = els.proxyUrl.value.trim();
    const useNoCors = !!els.noCorsMode.checked;
    if (!url) return setStatus('請先在程式碼中設定 SCRIPT_URL', false);
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
    const delBtn = e.target.closest('button[data-action="delete"]');
    const copyBtn = e.target.closest('button[data-action="copy"]');
    if (delBtn) {
      const tr = delBtn.closest('tr');
      if (tr) tr.remove();
      renumberRows();
      return;
    }
    if (copyBtn) {
      const tr = copyBtn.closest('tr');
      if (!tr) return;
      const tds = tr.querySelectorAll('td');
      const label = tds[1].querySelector('input')?.value?.trim() || '';
      const probRaw = tds[2].querySelector('input')?.value?.trim() || '';
      const colorTextEl = tds[3].querySelector('input.colorText');
      const colorPickerEl = tds[3].querySelector('input.colorPicker');
      const colorTextVal = colorTextEl ? colorTextEl.value.trim() : '';
      const colorPickVal = colorPickerEl ? colorPickerEl.value.trim() : '';
      const item = { label, probability: probRaw, color: colorTextVal || colorPickVal };

      // 使用正確的 TR 片段插入，避免巢狀 <tr> 造成 draggable 失效
      const idx = [...els.tableBody.querySelectorAll('tr')].indexOf(tr) + 1;
      const html = rowTemplate(item, idx);
      tr.insertAdjacentHTML('afterend', html);
      renumberRows();
      return;
    }
  });

  // Sync color picker and text input
  els.tableBody.addEventListener('input', (e) => {
    const picker = e.target.closest('input.colorPicker');
    const text = e.target.closest('input.colorText');
    if (picker) {
      const tr = picker.closest('tr');
      const textEl = tr?.querySelector('input.colorText');
      if (textEl) textEl.value = picker.value;
    } else if (text) {
      const hex = colorToHex(text.value);
      const tr = text.closest('tr');
      const pickerEl = tr?.querySelector('input.colorPicker');
      if (hex && pickerEl) pickerEl.value = hex;
    }
  });

  // Drag & Drop row reordering
  els.tableBody.addEventListener('dragstart', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    tr.classList.add('dragging');
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); } catch(_) {}
  });
  els.tableBody.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = els.tableBody.querySelector('tr.dragging');
    if (!dragging) return;
    const after = getDragAfterElement(els.tableBody, e.clientY);
    if (after == null) {
      els.tableBody.appendChild(dragging);
    } else {
      els.tableBody.insertBefore(dragging, after);
    }
  });
  els.tableBody.addEventListener('drop', (e) => {
    e.preventDefault();
  });
  els.tableBody.addEventListener('dragend', () => {
    const dragging = els.tableBody.querySelector('tr.dragging');
    if (dragging) dragging.classList.remove('dragging');
    renumberRows();
  });

  // Basic touch support for reordering on mobile/tablet
  let touchDrag = { active: false, row: null };
  els.tableBody.addEventListener('touchstart', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const tr = handle.closest('tr');
    if (!tr) return;
    touchDrag.active = true;
    touchDrag.row = tr;
    tr.classList.add('dragging');
  }, { passive: true });

  els.tableBody.addEventListener('touchmove', (e) => {
    if (!touchDrag.active || !touchDrag.row) return;
    if (e.cancelable) e.preventDefault();
    const touch = e.touches[0];
    const after = getDragAfterElement(els.tableBody, touch.clientY);
    if (after == null) {
      els.tableBody.appendChild(touchDrag.row);
    } else {
      els.tableBody.insertBefore(touchDrag.row, after);
    }
  }, { passive: false });

  els.tableBody.addEventListener('touchend', () => {
    if (touchDrag.row) touchDrag.row.classList.remove('dragging');
    touchDrag.active = false;
    touchDrag.row = null;
    renumberRows();
  });
})();
