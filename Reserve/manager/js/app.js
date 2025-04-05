// js/app.js
import { fetchBookingConfig, saveBookingConfig } from './api.js';
import { initServiceManager } from './serviceManager.js';

let bookingConfig = {};

document.addEventListener('DOMContentLoaded', async () => {
  try {
    bookingConfig = await fetchBookingConfig();
    window.bookingConfig = bookingConfig;

    const form = document.getElementById('bookingForm');

    form.startTime.value = bookingConfig.startTime || '';
    form.endTime.value = bookingConfig.endTime || '';
    form.bufferMinutes.value = bookingConfig.bufferMinutes || 0;
    form.maxBookingDays.value = bookingConfig.maxBookingDays || 0;

    renderWeeklyOff();
    renderDateLists();
    renderBreakPeriods();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      bookingConfig.startTime = form.startTime.value;
      bookingConfig.endTime = form.endTime.value;
      bookingConfig.bufferMinutes = parseInt(form.bufferMinutes.value);
      bookingConfig.maxBookingDays = parseInt(form.maxBookingDays.value);

      const weeklyCheckboxes = document.querySelectorAll('#weeklyOffCheckboxes input');
      bookingConfig.dateTypes.weeklyOff = Array.from(weeklyCheckboxes)
        .filter(c => c.checked)
        .map(c => parseInt(c.value));

      try {
        await saveBookingConfig(bookingConfig);
        alert("✅ 設定已成功儲存！");
      } catch (err) {
        alert("❌ 儲存失敗：" + err.message);
      }

      //displayConfig();
    });

    //displayConfig();
    initServiceManager();

  } catch (err) {
    alert("❌ 無法載入設定資料：" + err.message);
  }
});

window.addBreakPeriod = function () {
  const index = bookingConfig.breakPeriods.length;
  bookingConfig.breakPeriods.push({ start: "12:00", end: "13:00" });
  renderBreakPeriods();
};

window.updateBreak = function (index, field, value) {
  if (bookingConfig.breakPeriods[index]) {
    bookingConfig.breakPeriods[index][field] = value;
  }
};

window.removeBreak = function (index) {
  bookingConfig.breakPeriods.splice(index, 1);
  renderBreakPeriods();
};

function renderBreakPeriods() {
  const list = document.getElementById('breakPeriodList');
  list.innerHTML = '';
  bookingConfig.breakPeriods.forEach((p, i) => {
    const div = document.createElement('div');
    div.innerHTML = `
      <input type="time" value="${p.start}" onchange="updateBreak(${i}, 'start', this.value)">
      到
      <input type="time" value="${p.end}" onchange="updateBreak(${i}, 'end', this.value)">
      <button onclick="removeBreak(${i})">刪除</button>
    `;
    list.appendChild(div);
  });
}

function renderWeeklyOff() {
  const checkboxes = document.querySelectorAll('#weeklyOffCheckboxes input');
  checkboxes.forEach(cb => {
    cb.checked = bookingConfig.dateTypes.weeklyOff.includes(parseInt(cb.value));
  });
}

window.addDate = function (type) {
  const input = document.getElementById(`${type}Input`);
  const date = input.value;
  const list = bookingConfig.dateTypes[type];
  if (date && !list.includes(date)) {
    list.push(date);
    renderDateLists();
  }
};

window.removeDate = function (type, date) {
  bookingConfig.dateTypes[type] = bookingConfig.dateTypes[type].filter(d => d !== date);
  renderDateLists();
};

function renderDateLists() {
  ['holiday', 'blockedDay', 'eventDay', 'halfDay'].forEach(type => {
    const listDiv = document.getElementById(`${type}List`);
    listDiv.innerHTML = bookingConfig.dateTypes[type].map(date =>
      `<div>${date} <button onclick="removeDate('${type}', '${date}')">刪除</button></div>`
    ).join('');
  });
}

function displayConfig() {
  // const configDisplay = document.getElementById('configDisplay');
  // configDisplay.innerHTML = `<h3>目前設定：</h3><pre>${JSON.stringify(bookingConfig, null, 2)}</pre>`;
}
