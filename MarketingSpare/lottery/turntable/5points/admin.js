// 後台管理腳本：讀取與更新獎項至 Apps Script
// 需求：Apps Script 需支援 GET (取得) 與 POST (更新) JSON
// POST 內容格式：{ prizes: [ { label: string, weight: number, color?: string } ] }

const scriptUrlInput = document.getElementById('scriptUrl');
const loadBtn = document.getElementById('loadBtn');
const addBtn = document.getElementById('addBtn');
const saveBtn = document.getElementById('saveBtn');
const tableWrap = document.getElementById('tableWrap');
const statusEl = document.getElementById('status');

let prizes = []; // 目前編輯中的資料
let originalSerialized = ''; // 用於判斷是否有變更
let dragState = { active:false, fromIndex:null, overIndex:null, overPos:null };

function setStatus(msg, type){
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ' ' + type : '');
}

function serialize(arr){
  return JSON.stringify(arr.map(p=>({label:p.label, weight:p.weight, color:p.color||''})));
}

function markDirty(){
  const current = serialize(prizes);
  saveBtn.disabled = (current === originalSerialized || prizes.length === 0);
}

function renderTable(){
  if (!prizes.length){
    tableWrap.innerHTML = '<div class="empty-hint">尚無獎項，請新增。</div>';
    markDirty();
    return;
  }
  const rows = prizes.map((p,i)=>{
    return `<tr data-index="${i}" draggable="true" class="draggable-row">
      <td class="drag-cell"><button type="button" class="drag-handle" aria-label="拖曳排序" title="拖曳排序"></button></td>
      <td><input type="text" class="inp-label" value="${escapeHtml(p.label)}" placeholder="獎項名稱" /></td>
      <td style="width:110px"><input type="number" min="0" step="1" class="inp-weight" value="${p.weight}" /></td>
      <td style="width:150px" class="color-cell">
        <input type="text" class="inp-color" value="${p.color?escapeHtml(p.color):''}" placeholder="#HEX 或色名" style="flex:1 1 auto" />
        <input type="color" class="inp-color-picker" value="${p.color && isColorHex(p.color)?p.color:'#ffffff'}" />
      </td>
      <td style="width:110px" class="row-actions">
        <button class="secondary" data-act="dup">複製</button>
        <button class="danger" data-act="del">刪除</button>
      </td>
    </tr>`;
  }).join('');

  tableWrap.innerHTML = `<table><thead><tr><th style="width:44px">排序</th><th>獎項標題</th><th style="width:110px">權重</th><th style="width:150px">顏色</th><th style="width:110px">操作</th></tr></thead><tbody>${rows}</tbody></table>`;
  attachRowEvents();
  attachDndEvents();
  markDirty();
}

function attachRowEvents(){
  tableWrap.querySelectorAll('tbody tr').forEach(tr=>{
    const idx = Number(tr.getAttribute('data-index'));
    const labelInput = tr.querySelector('.inp-label');
    const weightInput = tr.querySelector('.inp-weight');
    const colorInput = tr.querySelector('.inp-color');
    const colorPicker = tr.querySelector('.inp-color-picker');
    labelInput.addEventListener('input', ()=>{ prizes[idx].label = labelInput.value.trim(); markDirty(); });
    weightInput.addEventListener('input', ()=>{ prizes[idx].weight = Number(weightInput.value); markDirty(); });
    colorInput.addEventListener('input', ()=>{ prizes[idx].color = colorInput.value.trim() || undefined; if (isColorHex(colorInput.value.trim())) colorPicker.value = normalizeHex(colorInput.value.trim()); markDirty(); });
    colorPicker.addEventListener('input', ()=>{ prizes[idx].color = colorPicker.value; colorInput.value = colorPicker.value; markDirty(); });
    tr.querySelectorAll('button[data-act]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const act = btn.getAttribute('data-act');
        if (act === 'del') {
          prizes.splice(idx,1); renderTable();
        } else if (act === 'dup') {
          prizes.splice(idx+1,0,{...prizes[idx]}); renderTable();
        }
      });
    });
  });
}

function attachDndEvents(){
  const rows = Array.from(tableWrap.querySelectorAll('tbody tr'));
  const clearOver = () => {
    rows.forEach(r=>r.classList.remove('drag-over-before','drag-over-after'));
  };
  rows.forEach(tr=>{
    const idx = Number(tr.getAttribute('data-index'));

    tr.addEventListener('dragstart', (e)=>{
      // 避免從輸入或按鈕開始拖曳
      if (e.target && (e.target.closest('input') || e.target.closest('button'))) {
        e.preventDefault();
        return;
      }
      dragState.active = true;
      dragState.fromIndex = idx;
      tr.classList.add('dragging');
      if (e.dataTransfer){
        e.dataTransfer.effectAllowed = 'move';
        // Safari 需要有 setData 才能觸發 drop
        e.dataTransfer.setData('text/plain', String(idx));
      }
    });

    tr.addEventListener('dragend', ()=>{
      tr.classList.remove('dragging');
      clearOver();
      dragState = { active:false, fromIndex:null, overIndex:null, overPos:null };
    });

    tr.addEventListener('dragover', (e)=>{
      if (!dragState.active) return;
      e.preventDefault();
      const rect = tr.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height/2;
      clearOver();
      tr.classList.add(before ? 'drag-over-before' : 'drag-over-after');
      dragState.overIndex = idx;
      dragState.overPos = before ? 'before' : 'after';
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });

    tr.addEventListener('dragleave', ()=>{
      tr.classList.remove('drag-over-before','drag-over-after');
    });

    tr.addEventListener('drop', (e)=>{
      if (!dragState.active) return;
      e.preventDefault();
      const targetIdx = idx;
      let from = Number(dragState.fromIndex);
      let to = targetIdx + (dragState.overPos === 'after' ? 1 : 0);
      if (!Number.isFinite(from) || !Number.isFinite(to)) return;
      if (to > from) to--; // 移除後索引位移修正
      clearOver();
      dragState = { active:false, fromIndex:null, overIndex:null, overPos:null };
      if (from === to) return; // 無變更
      const moved = prizes.splice(from,1)[0];
      prizes.splice(to,0,moved);
      renderTable();
      setStatus('已重新排序。','');
    });
  });

  // 跨裝置拖曳：使用拖曳手把 + Pointer 事件
  const handles = Array.from(tableWrap.querySelectorAll('.drag-handle'));
  let ptrDragging = false;
  let ptrFromIdx = null;
  let ptrOverIdx = null;
  let ptrOverPos = null; // 'before' | 'after'

  const onPtrMove = (e)=>{
    if (!ptrDragging) return;
    e.preventDefault();
    const y = e.clientY;
    let targetTr = null;
    for (const r of rows){
      const rect = r.getBoundingClientRect();
      if (y >= rect.top && y <= rect.bottom){ targetTr = r; break; }
    }
    clearOver();
    if (!targetTr){ ptrOverIdx = null; ptrOverPos = null; return; }
    const rect = targetTr.getBoundingClientRect();
    const before = (y - rect.top) < rect.height/2;
    targetTr.classList.add(before ? 'drag-over-before' : 'drag-over-after');
    ptrOverIdx = Number(targetTr.getAttribute('data-index'));
    ptrOverPos = before ? 'before' : 'after';
  };

  const stopPtrDrag = ()=>{
    if (!ptrDragging) return;
    ptrDragging = false;
    clearOver();
    rows.forEach(r=>r.classList.remove('dragging'));
    if (ptrFromIdx==null || ptrOverIdx==null){ ptrFromIdx = ptrOverIdx = ptrOverPos = null; return; }
    let from = Number(ptrFromIdx);
    let to = ptrOverIdx + (ptrOverPos === 'after' ? 1 : 0);
    if (to > from) to--;
    if (from !== to){
      const moved = prizes.splice(from,1)[0];
      prizes.splice(to,0,moved);
      renderTable();
      setStatus('已重新排序。','');
    }
    ptrFromIdx = ptrOverIdx = ptrOverPos = null;
    window.removeEventListener('pointermove', onPtrMove, { capture:false });
    window.removeEventListener('pointerup', stopPtrDrag, { capture:false });
    window.removeEventListener('pointercancel', stopPtrDrag, { capture:false });
  };

  handles.forEach(h=>{
    h.addEventListener('pointerdown', (e)=>{
      // 僅用手把啟動，避免干擾輸入欄位
      const tr = h.closest('tr');
      if (!tr) return;
      ptrFromIdx = Number(tr.getAttribute('data-index'));
      ptrDragging = true;
      tr.classList.add('dragging');
      try { h.setPointerCapture(e.pointerId); } catch(_){}
      window.addEventListener('pointermove', onPtrMove, { passive:false });
      window.addEventListener('pointerup', stopPtrDrag, { passive:true });
      window.addEventListener('pointercancel', stopPtrDrag, { passive:true });
    }, { passive:true });
  });
}

function escapeHtml(str){
  return str.replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[s]));
}

function isColorHex(v){
  return /^#[0-9a-fA-F]{6}$/.test(v.trim());
}
function normalizeHex(v){
  const m = v.trim().match(/^#([0-9a-fA-F]{6})$/); return m ? '#'+m[1].toLowerCase() : '#ffffff';
}

addBtn.addEventListener('click', ()=>{
  prizes.push({label:'新獎項', weight:1, color:undefined});
  renderTable();
});

saveBtn.addEventListener('click', async ()=>{
  // 驗證
  const cleaned = prizes.map(p=>({label:p.label.trim(), weight:Number(p.weight), color:p.color? p.color.trim(): undefined}));
  for (const p of cleaned){
    if (!p.label) return setStatus('存在空白標題，請修正。','error');
    if (!Number.isFinite(p.weight) || p.weight<0) return setStatus('權重需為非負整數。','error');
    if (p.color && !isColorHex(p.color) && /\s/.test(p.color)) return setStatus('顏色格式不合法 (HEX 或色名無空白)。','error');
  }
  setStatus('儲存中...', '');
  saveBtn.disabled = true;
  const spinner = document.createElement('span'); spinner.className='loading-inline'; saveBtn.prepend(spinner);
  try {
    const url = scriptUrlInput.value.trim();
    const resp = await fetch(url, {
      method: 'POST',
      // 使用簡單請求以避免 CORS 預檢（Apps Script 以 e.postData.contents 解析）
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ prizes: cleaned })
    });
    if (!resp.ok) throw new Error('HTTP '+resp.status);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || '未知錯誤');
    prizes = cleaned; // 套用成功狀態
    originalSerialized = serialize(prizes);
    renderTable();
    setStatus('儲存成功，共 '+prizes.length+' 筆。','success');

    // 儲存後再次讀取一次，檢查 0 權重是否被後端過濾，若有則提示更新 Apps Script
    try {
      const verifyResp = await fetch(url + '?t=' + Date.now());
      if (verifyResp.ok) {
        const verifyData = await verifyResp.json();
        const serverPrizes = Array.isArray(verifyData.prizes) ? verifyData.prizes : [];
        const zerosClient = new Set(cleaned.filter(p => Number(p.weight) === 0).map(p => String(p.label).trim()));
        const zerosServer = new Set(serverPrizes.filter(p => Number(p.weight) === 0).map(p => String(p.label || '').trim()));
        const droppedZero = [];
        zerosClient.forEach(lbl => { if (!zerosServer.has(lbl)) droppedZero.push(lbl); });
        if (droppedZero.length) {
          setStatus('注意：後端未保留 0 權重獎項：' + droppedZero.join(', ') + '。請更新 Apps Script 以允許 0 權重。', 'error');
        }
      }
    } catch(_) { /* ignore verify errors */ }
  } catch(e){
    console.error(e);
    setStatus('儲存失敗: '+e.message,'error');
  } finally {
    spinner.remove();
    markDirty();
  }
});

loadBtn.addEventListener('click', ()=>{ loadPrizes(); });

async function loadPrizes(){
  setStatus('載入中...','');
  saveBtn.disabled = true;
  try {
    const url = scriptUrlInput.value.trim();
    const resp = await fetch(url + '?t=' + Date.now());
    if (!resp.ok) throw new Error('HTTP '+resp.status);
    const data = await resp.json();
    if (!data.prizes || !Array.isArray(data.prizes)) throw new Error('格式錯誤');
    prizes = data.prizes.map(p=>({
      label: String(p.label||'').trim(),
      weight: Number(p.weight)||0,
      color: p.color? String(p.color).trim() || undefined : undefined
    })).filter(p=>p.label);
    originalSerialized = serialize(prizes);
    renderTable();
    setStatus('載入完成，' + prizes.length + ' 筆。','success');
  } catch(e){
    console.error(e);
    setStatus('載入失敗: '+e.message,'error');
    prizes = [];
    renderTable();
  }
}

// 初次載入
loadPrizes();
