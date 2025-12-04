// admin.js - 預約設定後台 JavaScript 模組

// API 相關常數和函數
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbwp46vU_Vk_s05D_LTbjAnDfUI4cyEUgQETikt6aIInecfZCAb_RI_vXZUm89GbNhEDgQ/exec';

function getEndpoint() {
  if (!ENDPOINT || !/^https:\/\/script.google.com\/.+\/exec$/.test(ENDPOINT)) {
    throw new Error('請先在程式碼中設定正確的 ENDPOINT');
  }
  return ENDPOINT;
}

async function apiGet(params) {
  const ep = getEndpoint();
  const url = ep + '?' + new URLSearchParams(params).toString();
  const res = await fetch(url, { method: 'GET' });
  return res.json();
}

async function apiPost(payload) {
  const ep = getEndpoint();
  // 不設置 Content-Type: application/json，避免 CORS 預檢；Apps Script 仍可讀取 postData.contents
  const res = await fetch(ep, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return res.json();
}

// 配置管理模組
const ConfigManager = {
  async upsertConfig(key, value) {
    // 嘗試 update，失敗再 create
    let res = await apiPost({ entity: 'config', action: 'update', key, data: { Key: key, Value: value } });
    if (!res.ok) {
      res = await apiPost({ entity: 'config', action: 'create', data: { Key: key, Value: value } });
    }
    return res;
  },

  async loadConfig() {
    const res = await apiGet({ entity: 'config', action: 'list' });
    return res.ok ? res.data : {};
  }
};

// 休息時間管理
const BreakPeriodManager = {
  addBreakRow(start = '', end = '') {
    const breakPeriodList = document.getElementById('breakPeriodList');
    const row = document.createElement('div');
    row.className = 'col-12';
    row.setAttribute('data-break-item', '1');
    row.innerHTML = `
      <div class="card border-warning">
        <div class="card-body p-3">
          <div class="row g-2 align-items-center">
            <div class="col-md-4">
              <label class="form-label small mb-1">開始時間</label>
              <input data-break-start type="time" value="${start}" class="form-control form-control-sm" />
            </div>
            <div class="col-md-4">
              <label class="form-label small mb-1">結束時間</label>
              <input data-break-end type="time" value="${end}" class="form-control form-control-sm" />
            </div>
            <div class="col-md-4">
              <button type="button" class="btn btn-outline-danger btn-sm w-100">刪除</button>
            </div>
          </div>
        </div>
      </div>
    `;
    row.querySelector('button').addEventListener('click', () => row.remove());
    breakPeriodList.appendChild(row);
  }
};

// 日期類型管理
const DateTypeManager = {
  async addDate(type) {
    try {
      const map = {
        holiday: 'holidayInput', blockedDay: 'blockedDayInput', eventDay: 'eventDayInput', halfDay: 'halfDayInput'
      };
      const id = map[type];
      if (!id) return alert('未知類型');
      const date = document.getElementById(id).value;
      if (!date) return alert('請選擇日期');
      const res = await apiPost({ entity: 'datetypes', action: 'create', data: { Type: type, Date: date } });
      if (res.ok) alert('已新增 ' + type + '：' + date);
      else alert('新增失敗：' + (res.error || ''));
    } catch (err) {
      alert('操作失敗：' + String(err));
    }
  },

  async renderDateTypes() {
    try {
      const res = await apiGet({ entity: 'datetypes', action: 'list' });
      if (!res.ok) { 
        document.getElementById('datesMsg').textContent = res.error || '載入失敗'; 
        document.getElementById('datesMsg').className = 'small text-danger'; 
        return; 
      }
      const data = Array.isArray(res.data) ? res.data : [];
      document.getElementById('datesMsg').textContent = `共 ${data.length} 筆`; 
      document.getElementById('datesMsg').className = 'small text-success';
      const byType = (t) => data.filter(r => r.Type === t);
      const renderList = (id, items, type) => {
        const el = document.getElementById(id);
        el.innerHTML = '';
        if (!items.length) { 
          el.innerHTML = '<p class="text-muted mb-0">（無）</p>'; 
          return; 
        }
        const table = document.createElement('table');
        table.className = 'table table-sm table-hover';
        table.innerHTML = `<thead class="table-light"><tr><th>日期</th><th class="text-end">操作</th></tr></thead><tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        items.forEach(({ Date }) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${Date}</td><td class="text-end"><button class="btn btn-outline-danger btn-sm" data-act="del">刪除</button></td>`;
          tr.querySelector('[data-act="del"]').addEventListener('click', async () => {
            if (!confirm(`確定刪除：${type} ${Date}？`)) return;
            const res = await apiPost({ entity: 'datetypes', action: 'delete', key: { Type: type, Date } });
            if (res.ok) this.renderDateTypes(); else alert('刪除失敗：' + (res.error || ''));
          });
          tbody.appendChild(tr);
        });
        el.appendChild(table);
      };
      renderList('holidayList', byType('holiday'), 'holiday');
      renderList('blockedDayList', byType('blockedDay'), 'blockedDay');
      renderList('eventDayList', byType('eventDay'), 'eventDay');
      renderList('halfDayList', byType('halfDay'), 'halfDay');
    } catch (err) {
      document.getElementById('datesMsg').textContent = String(err); 
      document.getElementById('datesMsg').className = 'small text-danger';
    }
  }
};

// 服務管理模組
const ServiceManager = {
  async addService() {
    try {
      const isAddonType = document.getElementById('serviceTypeSelect').value === 'addon';
      // 建立行內輸入列
      const container = document.getElementById('serviceList');
      const formRow = document.createElement('div');
      formRow.className = 'card border-primary mb-3';
      formRow.innerHTML = `
        <div class="card-body p-3">
          <h6 class="card-title text-primary mb-3">新增${isAddonType ? '加購' : '主'}服務</h6>
          <div class="row g-2">
            <div class="col-md-6 col-lg-3">
              <input type="text" class="form-control" placeholder="服務名稱" />
            </div>
            <div class="col-md-6 col-lg-2">
              <input type="number" class="form-control" placeholder="分鐘" />
            </div>
            <div class="col-md-6 col-lg-2">
              <input type="number" class="form-control" placeholder="價格" />
            </div>
            <div class="col-md-6 col-lg-3">
              <input type="text" class="form-control" placeholder="分類（例：全身按摩）" value="${isAddonType ? '加購服務' : ''}" />
            </div>
            <div class="col-md-6 col-lg-2">
              <button type="button" class="btn btn-success w-100">儲存</button>
            </div>
          </div>
        </div>
      `;
      const [nameEl, minEl, priceEl, typeEl, saveBtn] = formRow.querySelectorAll('input,button');
      container.prepend(formRow);
      saveBtn.addEventListener('click', async () => {
        const ServiceName = nameEl.value.trim();
        const TimeMinutes = Number(minEl.value || '0');
        const Price = Number(priceEl.value || '0');
        const Type = typeEl.value.trim();
        const IsAddon = isAddonType ? 'TRUE' : 'FALSE';
        if (!ServiceName) return alert('請輸入服務名稱');
        const res = await apiPost({ entity: 'services', action: 'create', data: { ServiceName, TimeMinutes, Price, Type, IsAddon } });
        if (res.ok) { alert('服務已新增'); this.renderServices(); formRow.remove(); }
        else { alert('新增失敗：' + (res.error || '')); }
      });
    } catch (err) { alert('操作失敗：' + String(err)); }
  },

  async renderServices() {
    try {
      const res = await apiGet({ entity: 'services', action: 'list' });
      if (!res.ok) { 
        document.getElementById('servicesMsg').textContent = res.error || '載入失敗'; 
        document.getElementById('servicesMsg').className = 'small text-danger'; 
        return; 
      }
      const data = Array.isArray(res.data) ? res.data : [];
      document.getElementById('servicesMsg').textContent = `共 ${data.length} 筆`; 
      document.getElementById('servicesMsg').className = 'small text-success';
      const container = document.getElementById('serviceList');
      container.innerHTML = '';
      const main = data.filter(d => String(d.IsAddon).toUpperCase() !== 'TRUE');
      const addon = data.filter(d => String(d.IsAddon).toUpperCase() === 'TRUE');
      const section = (title, items, bgClass = 'bg-light') => {
        const wrap = document.createElement('div');
        wrap.className = `mb-4 ${bgClass}`;
        const h = document.createElement('h5'); 
        h.className = 'mb-3 text-primary';
        h.textContent = title; 
        wrap.appendChild(h);
        if (!items.length) {
          const empty = document.createElement('p');
          empty.className = 'text-muted mb-0';
          empty.textContent = '（無服務項目）';
          wrap.appendChild(empty);
          return wrap;
        }
        const table = document.createElement('table');
        table.className = 'table table-hover';
        table.innerHTML = `<thead class="table-light"><tr>
          <th>服務名稱</th>
          <th>分鐘</th>
          <th>價格</th>
          <th>分類</th>
          <th class="text-end">操作</th>
        </tr></thead><tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        items.forEach(it => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${it.ServiceName}</strong></td>
            <td>${it.TimeMinutes}</td>
            <td class="text-success">$${it.Price}</td>
            <td><small class="text-muted">${it.Type}</small></td>
            <td class="text-end">
              <button class="btn btn-outline-primary btn-sm me-1" data-act="edit">修改</button>
              <button class="btn btn-outline-danger btn-sm" data-act="del">刪除</button>
            </td>`;
          tr.querySelector('[data-act="del"]').addEventListener('click', async () => {
            if (!confirm(`確定刪除：${it.ServiceName}？`)) return;
            const res = await apiPost({ entity: 'services', action: 'delete', key: it.ServiceName });
            if (res.ok) this.renderServices(); else alert('刪除失敗：' + (res.error || ''));
          });
          tr.querySelector('[data-act="edit"]').addEventListener('click', () => {
            // 行內編輯
            const name = prompt('服務名稱', it.ServiceName) || it.ServiceName;
            const minutes = Number(prompt('分鐘', it.TimeMinutes) || it.TimeMinutes);
            const price = Number(prompt('價格', it.Price) || it.Price);
            const type = prompt('分類', it.Type) || it.Type;
            const payload = { entity: 'services', action: 'update', key: it.ServiceName, data: { ServiceName: name, TimeMinutes: minutes, Price: price, Type: type, IsAddon: String(it.IsAddon).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE' } };
            apiPost(payload).then(res => { if (res.ok) this.renderServices(); else alert('修改失敗：' + (res.error || '')); });
          });
          tbody.appendChild(tr);
        });
        wrap.appendChild(table);
        return wrap;
      };
      container.appendChild(section('🏥 主服務', main, 'bg-primary bg-opacity-10'));
      container.appendChild(section('➕ 加購服務', addon, 'bg-success bg-opacity-10'));
    } catch (err) {
      document.getElementById('servicesMsg').textContent = String(err); 
      document.getElementById('servicesMsg').className = 'small text-danger';
    }
  }
};

// 每週休假管理
const WeeklyOffManager = {
  async renderWeeklyOff() {
    try {
      const res = await apiGet({ entity: 'config', action: 'list' });
      if (!res.ok) { 
        document.getElementById('weeklyMsg').textContent = res.error || '載入失敗'; 
        document.getElementById('weeklyMsg').className = 'small text-danger'; 
        return; 
      }
      const offs = (() => { try { return JSON.parse(res.data.weeklyOff || '[]'); } catch { return []; } })();
      const boxes = Array.from(document.querySelectorAll('#weeklyOffCheckboxes input[type="checkbox"]'));
      boxes.forEach(cb => { cb.checked = offs.includes(cb.value); });
      document.getElementById('weeklyMsg').textContent = offs.length ? `目前設定：${offs.map(d => ['週日','週一','週二','週三','週四','週五','週六'][d]).join(', ')}` : '目前設定：（無）'; 
      document.getElementById('weeklyMsg').className = 'small text-success';
    } catch (err) {
      document.getElementById('weeklyMsg').textContent = String(err); 
      document.getElementById('weeklyMsg').className = 'small text-danger';
    }
  }
};

// 初始化和事件綁定
document.addEventListener('DOMContentLoaded', () => {
  // 表單提交
  const bookingForm = document.getElementById('bookingForm');
  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const startTime = document.getElementById('startTime').value;
      const endTime = document.getElementById('endTime').value;
      const bufferMinutes = document.getElementById('bufferMinutes').value;
      const maxBookingDays = document.getElementById('maxBookingDays').value;

      // 休息時間收集
      const breaks = Array.from(document.querySelectorAll('[data-break-item]')).map(el => ({
        start: el.querySelector('[data-break-start]').value,
        end: el.querySelector('[data-break-end]').value
      })).filter(b => b.start && b.end);

      // weeklyOff 勾選
      const weeklyChecked = Array.from(document.querySelectorAll('#weeklyOffCheckboxes input[type="checkbox"]'))
        .filter(cb => cb.checked)
        .map(cb => cb.value);

      // 儲存配置
      await ConfigManager.upsertConfig('startTime', startTime || '');
      await ConfigManager.upsertConfig('endTime', endTime || '');
      await ConfigManager.upsertConfig('bufferMinutes', String(bufferMinutes || ''));
      await ConfigManager.upsertConfig('maxBookingDays', String(maxBookingDays || ''));
      await ConfigManager.upsertConfig('breakPeriods', JSON.stringify(breaks));
      await ConfigManager.upsertConfig('weeklyOff', JSON.stringify(weeklyChecked));

      alert('已儲存設定到 Config 工作表');
    } catch (err) {
      alert('儲存設定失敗：' + String(err));
    }
  });

  // 綁定全域函數
  window.addBreakPeriod = () => BreakPeriodManager.addBreakRow();
  window.addDate = (type) => DateTypeManager.addDate(type);

  // 服務管理事件
  document.getElementById('addServiceBtn').addEventListener('click', () => ServiceManager.addService());
  document.getElementById('servicesRefresh').addEventListener('click', () => ServiceManager.renderServices());

  // 每週休假事件
  document.getElementById('weeklyRefresh').addEventListener('click', () => WeeklyOffManager.renderWeeklyOff());

  // 特殊日期事件
  document.getElementById('datesRefresh').addEventListener('click', () => DateTypeManager.renderDateTypes());

  // 預載配置
  (async function preloadConfig() {
    try {
      if (!ENDPOINT) return;
      const cfg = await ConfigManager.loadConfig();
      // 時間格式化
      const toHHMM = (val) => {
        if (!val) return '';
        if (/^\d{2}:\d{2}(:\d{2}(\.\d{3})?)?$/.test(val)) return val.slice(0,5);
        try {
          const d = new Date(val);
          if (!isNaN(d.getTime())) {
            const hh = String(d.getHours()).padStart(2,'0');
            const mm = String(d.getMinutes()).padStart(2,'0');
            return `${hh}:${mm}`;
          }
        } catch {}
        return '';
      };
      if (cfg.startTime) document.getElementById('startTime').value = toHHMM(cfg.startTime);
      if (cfg.endTime) document.getElementById('endTime').value = toHHMM(cfg.endTime);
      if (cfg.bufferMinutes) document.getElementById('bufferMinutes').value = Number(cfg.bufferMinutes);
      if (cfg.maxBookingDays) document.getElementById('maxBookingDays').value = Number(cfg.maxBookingDays);
      if (cfg.breakPeriods) {
        try { JSON.parse(cfg.breakPeriods).forEach(b => BreakPeriodManager.addBreakRow(b.start, b.end)); } catch {}
      }
      if (cfg.weeklyOff) {
        try {
          const offs = JSON.parse(cfg.weeklyOff);
          Array.from(document.querySelectorAll('#weeklyOffCheckboxes input[type="checkbox"]')).forEach(cb => {
            cb.checked = offs.includes(cb.value);
          });
        } catch {}
      }
      // 初次渲染
      WeeklyOffManager.renderWeeklyOff();
      DateTypeManager.renderDateTypes();
      ServiceManager.renderServices();
    } catch {}
  })();
});