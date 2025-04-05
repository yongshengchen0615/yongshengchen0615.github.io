// js/serviceManager.js
import { saveBookingConfig } from './api.js';

export function initServiceManager() {
  renderServiceUI();
  document.getElementById("serviceTypeSelect").addEventListener("change", renderServiceUI);
  document.getElementById("addServiceBtn").addEventListener("click", addServiceForm);
}

function renderServiceUI() {
  const type = document.getElementById("serviceTypeSelect").value;
  const listDiv = document.getElementById("serviceList");
  listDiv.innerHTML = "";

  const serviceData = bookingConfig.services[type];
  Object.entries(serviceData).forEach(([name, info], index) => {
    listDiv.appendChild(createServiceForm(name, info, type, index));
  });
}

function createServiceForm(name, data, type, index) {
  const wrapper = document.createElement("div");
  wrapper.classList.add("service-form");
  wrapper.setAttribute("draggable", "true");
  wrapper.dataset.index = index;

  wrapper.addEventListener("dragstart", dragStart);
  wrapper.addEventListener("dragover", dragOver);
  wrapper.addEventListener("drop", drop);
  wrapper.addEventListener("touchstart", touchStart);
  wrapper.addEventListener("touchmove", touchMove);
  wrapper.addEventListener("touchend", touchEnd);

  const categories = {
    main: ["全身按摩", "腳底按摩", "精油腳底按摩", "修腳服務"],
    addon: ["肩頸按摩", "刮痧", "熱敷", "精油升級"]
  };

  const optionsHTML = categories[type].map(opt =>
    `<option value="${opt}" ${data.type === opt ? "selected" : ""}>${opt}</option>`
  ).join("");

  wrapper.innerHTML = `
    <div class="service-fields">
      <input type="text" name="name" class="service-name" value="${name}" placeholder="服務名稱與價格">
      <select name="type" class="service-type">${optionsHTML}</select>
      <input type="number" name="time" class="service-time" value="${data.time}" placeholder="分鐘數">
      <input type="number" name="price" class="service-price" value="${data.price}" placeholder="價格（元）">
    </div>
    <div class="service-actions">
      <button type="button" onclick="saveService('${type}', ${index}, this)">💾 儲存</button>
      <button type="button" onclick="deleteService('${type}', '${name}')">🗑️ 刪除</button>
    </div>
  `;
  return wrapper;
}

function addServiceForm() {
  const type = document.getElementById("serviceTypeSelect").value;
  const newKey = `新服務${Date.now()}`;
  bookingConfig.services[type][newKey] = { time: 0, price: 0, type: "" };
  renderServiceUI();
}

window.saveService = async function (type, index, btn) {
  const form = btn.closest(".service-form");
  const nameInput = form.querySelector(".service-name");
  const timeInput = form.querySelector(".service-time");
  const priceInput = form.querySelector(".service-price");
  const typeInput = form.querySelector(".service-type");

  const oldKey = Object.keys(bookingConfig.services[type])[index];
  const newKey = nameInput.value.trim();

  const newData = {
    time: parseInt(timeInput.value),
    price: parseInt(priceInput.value),
    type: typeInput.value.trim()
  };

  if (oldKey !== newKey) {
    delete bookingConfig.services[type][oldKey];
  }
  bookingConfig.services[type][newKey] = newData;

  try {
    await saveBookingConfig(bookingConfig);
    alert("✅ 服務已儲存！");
  } catch (err) {
    alert("❌ 儲存服務失敗：" + err.message);
  }

  renderServiceUI();
  //displayConfig();
};

window.deleteService = async function (type, name) {
  delete bookingConfig.services[type][name];
  try {
    await saveBookingConfig(bookingConfig);
    alert("✅ 服務已刪除！");
  } catch (err) {
    alert("❌ 刪除服務失敗：" + err.message);
  }
  renderServiceUI();
 // displayConfig();
};

// 拖曳邏輯
let dragSourceIndex = null;
let touchStartY = null;

function dragStart(e) {
  dragSourceIndex = +e.currentTarget.dataset.index;
}
function dragOver(e) {
  e.preventDefault();
}
function drop(e) {
  const dropTargetIndex = +e.currentTarget.dataset.index;
  reorderService(dragSourceIndex, dropTargetIndex);
}
function touchStart(e) {
  touchStartY = e.touches[0].clientY;
  dragSourceIndex = +e.currentTarget.dataset.index;
  e.currentTarget.classList.add("dragging");
}
function touchMove(e) {
  e.preventDefault();
  const touchY = e.touches[0].clientY;
  const current = e.currentTarget;
  const rect = current.getBoundingClientRect();

  if (touchY < rect.top) {
    current.previousElementSibling?.before(current);
  } else if (touchY > rect.bottom) {
    current.nextElementSibling?.after(current);
  }
}
function touchEnd(e) {
  e.currentTarget.classList.remove("dragging");
  const containers = [...document.querySelectorAll(".service-form")];
  const dropTargetIndex = containers.indexOf(e.currentTarget);
  reorderService(dragSourceIndex, dropTargetIndex);
}

function reorderService(fromIndex, toIndex) {
  const type = document.getElementById("serviceTypeSelect").value;
  const keys = Object.keys(bookingConfig.services[type]);
  const items = keys.map(k => [k, bookingConfig.services[type][k]]);

  const [movedItem] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, movedItem);

  bookingConfig.services[type] = Object.fromEntries(items);
  renderServiceUI();
  //displayConfig();
}
