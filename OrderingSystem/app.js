const CONFIG = {
  LIFF_ID: "",
  GAS_WEB_APP_URL: "",
  LINKS: {},
};

const PLACEHOLDER_VALUES = new Set(["", "YOUR_LIFF_ID", "YOUR_GAS_WEB_APP_URL"]);

const state = {
  profile: null,
  idToken: "",
  user: null,
  openGroups: [],
  myGroups: [],
  myOrders: [],
  selectedGroupId: "",
  selectedQuantities: {},
  draftItems: [],
  editingGroupId: "",
  activeView: "joinView",
  loading: false,
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  wireEvents();
  resetDraftItems();
  renderIcons();
  await loadConfig();
  initApp();
});

async function loadConfig() {
  try {
    const response = await fetch("./config.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`config.json HTTP ${response.status}`);
    }

    const config = await response.json();
    CONFIG.LIFF_ID = String(config.LIFF_ID || config.liffId || "").trim();
    CONFIG.GAS_WEB_APP_URL = String(config.GAS_WEB_APP_URL || config.gasWebAppUrl || "").trim();
    CONFIG.LINKS = config.links || {};
  } catch (error) {
    CONFIG.LOAD_ERROR = error.message;
  }
}

function isAppConfigured() {
  return !PLACEHOLDER_VALUES.has(CONFIG.LIFF_ID) && !PLACEHOLDER_VALUES.has(CONFIG.GAS_WEB_APP_URL);
}

function cacheElements() {
  Object.assign(els, {
    profilePanel: document.querySelector("#profilePanel"),
    authStatus: document.querySelector("#authStatus"),
    techStatus: document.querySelector("#techStatus"),
    pageTitle: document.querySelector("#pageTitle"),
    mainViews: document.querySelector("#mainViews"),
    configNotice: document.querySelector("#configNotice"),
    technicianNotice: document.querySelector("#technicianNotice"),
    technicianForm: document.querySelector("#technicianForm"),
    technicianNumber: document.querySelector("#technicianNumber"),
    errorNotice: document.querySelector("#errorNotice"),
    errorText: document.querySelector("#errorText"),
    refreshGroupsButton: document.querySelector("#refreshGroupsButton"),
    groupList: document.querySelector("#groupList"),
    joinForm: document.querySelector("#joinForm"),
    selectedGroupPanel: document.querySelector("#selectedGroupPanel"),
    joinItemList: document.querySelector("#joinItemList"),
    joinNote: document.querySelector("#joinNote"),
    joinTotal: document.querySelector("#joinTotal"),
    submitJoinButton: document.querySelector("#submitJoinButton"),
    groupForm: document.querySelector("#groupForm"),
    groupFormTitle: document.querySelector("#groupFormTitle"),
    saveGroupButton: document.querySelector("#saveGroupButton"),
    groupName: document.querySelector("#groupName"),
    addDraftItemButton: document.querySelector("#addDraftItemButton"),
    draftItemEditor: document.querySelector("#draftItemEditor"),
    cancelEditButton: document.querySelector("#cancelEditButton"),
    refreshMyGroupsButton: document.querySelector("#refreshMyGroupsButton"),
    myGroupsList: document.querySelector("#myGroupsList"),
    refreshRecordsButton: document.querySelector("#refreshRecordsButton"),
    recordsTable: document.querySelector("#recordsTable"),
    toast: document.querySelector("#toast"),
  });
}

function wireEvents() {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  els.technicianForm.addEventListener("submit", saveTechnicianNumber);
  els.refreshGroupsButton.addEventListener("click", refreshDashboard);
  els.refreshMyGroupsButton.addEventListener("click", refreshDashboard);
  els.refreshRecordsButton.addEventListener("click", refreshDashboard);
  els.joinForm.addEventListener("submit", submitJoin);
  els.groupForm.addEventListener("submit", saveGroup);
  els.addDraftItemButton.addEventListener("click", () => {
    state.draftItems.push({ itemId: createId(), name: "", price: 0, active: true });
    renderDraftItems();
    renderIcons();
  });
  els.cancelEditButton.addEventListener("click", cancelEditGroup);
}

async function initApp() {
  const configured = isAppConfigured();
  els.configNotice.classList.toggle("hidden", configured);

  if (!configured) {
    ensureDemoLogin();
    restoreDemoSession();
    renderAll();
    return;
  }

  try {
    await liff.init({
      liffId: CONFIG.LIFF_ID,
      withLoginOnExternalBrowser: true,
    });
    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    state.profile = await liff.getProfile();
    state.idToken = liff.getIDToken();
    await refreshDashboard({ silent: true });
  } catch (error) {
    showError(`LINE 初始化失敗：${error.message}`);
    renderAll();
  }
}

async function refreshDashboard(options = {}) {
  if (!state.idToken && isAppConfigured()) return;
  if (!isAppConfigured() && !state.profile) {
    renderAll();
    return;
  }
  try {
    const result = await apiRequest("bootstrap", {});
    applyDashboard(result);
    if (!options.silent) {
      showToast("資料已更新");
    }
  } catch (error) {
    showError(error.message);
  }
}

function applyDashboard(result) {
  state.user = result.user || null;
  state.openGroups = result.openGroups || [];
  state.myGroups = result.myGroups || [];
  state.myOrders = result.myOrders || [];

  if (!state.openGroups.some((group) => group.groupId === state.selectedGroupId)) {
    state.selectedGroupId = "";
    state.selectedQuantities = {};
  }

  renderAll();
}

async function apiRequest(action, payload = {}) {
  if (!isAppConfigured()) {
    return demoApi(action, payload);
  }

  setLoading(true);
  try {
    const response = await fetch(CONFIG.GAS_WEB_APP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        action,
        idToken: state.idToken,
        payload,
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.error || "API 執行失敗");
    }
    return data.data;
  } finally {
    setLoading(false);
  }
}

function renderAll() {
  renderProfile();
  renderStatus();
  renderGroupList();
  renderJoinPanel();
  renderDraftForm();
  renderDraftItems();
  renderMyGroups();
  renderRecords();
  renderIcons();
}

function renderProfile() {
  const displayName = getDisplayName();
  const pictureUrl = state.user?.pictureUrl || state.profile?.pictureUrl;
  const subtitle = state.user?.technicianNumber
    ? `技師 ${state.user.technicianNumber}`
    : state.user
      ? "待填技師號碼"
      : "尚未登入";

  els.profilePanel.innerHTML = `
    ${pictureUrl ? `<img src="${escapeHtml(pictureUrl)}" alt="">` : '<div class="avatar-placeholder"></div>'}
    <div>
      <p class="muted">${escapeHtml(subtitle)}</p>
      <strong>${escapeHtml(displayName)}</strong>
    </div>
  `;

}

function renderStatus() {
  const loggedIn = Boolean(state.user);
  const hasTechnicianNumber = canUseSystem();

  els.authStatus.className = "status-pill";
  els.authStatus.textContent = loggedIn ? "已登入 LINE" : "未登入";
  els.authStatus.classList.toggle("success", loggedIn);

  els.techStatus.className = "status-pill";
  if (!loggedIn) {
    els.techStatus.textContent = "未填技師號碼";
  } else if (hasTechnicianNumber) {
    els.techStatus.textContent = `技師 ${state.user.technicianNumber}`;
    els.techStatus.classList.add("success");
  } else {
    els.techStatus.textContent = "需填技師號碼";
    els.techStatus.classList.add("warning");
  }

  els.technicianNotice.classList.toggle("hidden", !loggedIn || hasTechnicianNumber);
  document.body.classList.toggle("setup-required", loggedIn && !hasTechnicianNumber);
  els.mainViews.classList.toggle("hidden", loggedIn && !hasTechnicianNumber);
  if (loggedIn && !els.technicianNumber.value) {
    els.technicianNumber.value = state.user?.technicianNumber || "";
  }

  const joinReady = hasTechnicianNumber && getSelectedJoinItems().length > 0 && Boolean(getSelectedGroup());
  els.submitJoinButton.disabled = state.loading || !joinReady;
  els.saveGroupButton.disabled = state.loading || !hasTechnicianNumber;
}

function renderGroupList() {
  if (!state.user) {
    els.groupList.innerHTML = '<div class="empty-state">請先使用 LINE 登入</div>';
    return;
  }

  if (!canUseSystem()) {
    els.groupList.innerHTML = '<div class="empty-state">輸入技師號碼後即可查看與加入團</div>';
    return;
  }

  if (!state.openGroups.length) {
    els.groupList.innerHTML = '<div class="empty-state">目前沒有別人開設中的團</div>';
    return;
  }

  els.groupList.innerHTML = state.openGroups
    .map((group) => {
      const active = group.groupId === state.selectedGroupId ? " active" : "";
      return `
        <article class="group-row${active}" data-group-id="${escapeHtml(group.groupId)}">
          <div>
            <div class="row-title">
              <strong>${escapeHtml(group.groupName)}</strong>
              <span class="status-pill success">開團中</span>
            </div>
            <p class="muted">團主：${escapeHtml(group.ownerName)}｜技師 ${escapeHtml(group.ownerTechnicianNumber || "-")}</p>
            <p class="muted">${group.items.length} 個項目｜${group.orderCount || 0} 筆加入</p>
          </div>
          <button class="ghost-button" type="button" data-select-group="${escapeHtml(group.groupId)}">
            <i data-lucide="arrow-right"></i>
            <span>選擇</span>
          </button>
        </article>
      `;
    })
    .join("");

  els.groupList.querySelectorAll("[data-select-group]").forEach((button) => {
    button.addEventListener("click", () => selectGroup(button.dataset.selectGroup));
  });
}

function renderJoinPanel() {
  const group = getSelectedGroup();
  if (!group) {
    els.selectedGroupPanel.innerHTML = '<p class="muted">尚未選擇團</p><strong>請從左側選擇要加入的團</strong>';
    els.joinItemList.innerHTML = '<div class="empty-state">選擇團後會顯示項目</div>';
    updateJoinTotal();
    return;
  }

  els.selectedGroupPanel.innerHTML = `
    <p class="muted">團主：${escapeHtml(group.ownerName)}｜技師 ${escapeHtml(group.ownerTechnicianNumber || "-")}</p>
    <strong>${escapeHtml(group.groupName)}</strong>
  `;

  if (!group.items.length) {
    els.joinItemList.innerHTML = '<div class="empty-state">這個團尚未設定項目</div>';
    updateJoinTotal();
    return;
  }

  els.joinItemList.innerHTML = group.items
    .map((item) => {
      const qty = state.selectedQuantities[item.itemId] || 0;
      return `
        <article class="menu-item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <p class="muted">${escapeHtml(group.groupName)}</p>
          </div>
          <div class="price">$${numberFormat(item.price)}</div>
          <div class="stepper" aria-label="${escapeHtml(item.name)} 數量">
            <button type="button" data-step="-1" data-item-id="${escapeHtml(item.itemId)}">-</button>
            <output>${qty}</output>
            <button type="button" data-step="1" data-item-id="${escapeHtml(item.itemId)}">+</button>
          </div>
        </article>
      `;
    })
    .join("");

  els.joinItemList.querySelectorAll("[data-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.itemId;
      const step = Number(button.dataset.step);
      const current = state.selectedQuantities[itemId] || 0;
      state.selectedQuantities[itemId] = Math.max(0, current + step);
      renderJoinPanel();
      renderStatus();
    });
  });

  updateJoinTotal();
}

function renderDraftForm() {
  const editing = Boolean(state.editingGroupId);
  els.groupFormTitle.textContent = editing ? "編輯開團" : "建立新團";
  els.saveGroupButton.innerHTML = editing
    ? '<i data-lucide="save"></i><span>儲存變更</span>'
    : '<i data-lucide="save"></i><span>建立團</span>';
  els.cancelEditButton.classList.toggle("hidden", !editing);
  renderIcons();
}

function renderDraftItems() {
  if (!state.draftItems.length) {
    els.draftItemEditor.innerHTML = '<div class="empty-state">請新增至少一個項目</div>';
    return;
  }

  els.draftItemEditor.innerHTML = state.draftItems
    .map(
      (item, index) => `
        <div class="item-row" data-index="${index}">
          <div class="form-row">
            <label>項目</label>
            <input value="${escapeHtml(item.name || "")}" data-field="name" placeholder="例如：珍奶、蛋糕、洗髮精">
          </div>
          <div class="form-row">
            <label>價格</label>
            <input type="number" min="0" step="1" value="${Number(item.price || 0)}" data-field="price">
          </div>
          <button class="icon-button" type="button" data-remove="${index}" aria-label="移除項目" title="移除項目">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      `,
    )
    .join("");

  els.draftItemEditor.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      const row = input.closest(".item-row");
      const item = state.draftItems[Number(row.dataset.index)];
      item[input.dataset.field] = input.dataset.field === "price" ? Number(input.value) : input.value;
    });
  });

  els.draftItemEditor.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      state.draftItems.splice(Number(button.dataset.remove), 1);
      renderDraftItems();
      renderIcons();
    });
  });
}

function renderMyGroups() {
  if (!state.user) {
    els.myGroupsList.innerHTML = '<div class="empty-state">請先使用 LINE 登入</div>';
    return;
  }

  if (!canUseSystem()) {
    els.myGroupsList.innerHTML = '<div class="empty-state">輸入技師號碼後即可開團</div>';
    return;
  }

  if (!state.myGroups.length) {
    els.myGroupsList.innerHTML = '<div class="empty-state">你尚未開團</div>';
    return;
  }

  els.myGroupsList.innerHTML = state.myGroups
    .map((group) => {
      const summary = summarizeOrders(group.orders || []);
      const statusText = group.status === "open" ? "開團中" : "已關閉";
      const statusClass = group.status === "open" ? "success" : "warning";
      return `
        <article class="owned-group">
          <div class="owned-group-head">
            <div>
              <div class="row-title">
                <strong>${escapeHtml(group.groupName)}</strong>
                <span class="status-pill ${statusClass}">${statusText}</span>
              </div>
              <p class="muted">${group.items.length} 個項目｜${(group.orders || []).length} 筆加入</p>
            </div>
            <div class="approval-actions">
              <button class="ghost-button" type="button" data-edit-group="${escapeHtml(group.groupId)}">
                <i data-lucide="pencil"></i>
                <span>編輯</span>
              </button>
              <button class="ghost-button" type="button" data-toggle-group="${escapeHtml(group.groupId)}">
                <i data-lucide="${group.status === "open" ? "lock" : "unlock"}"></i>
                <span>${group.status === "open" ? "關閉" : "開啟"}</span>
              </button>
            </div>
          </div>

          <div class="summary-grid">
            ${
              summary.length
                ? summary
                    .map(
                      (item) => `
                        <div class="summary-row">
                          <div>
                            <strong>${escapeHtml(item.name)}</strong>
                            <p class="muted">${item.quantity} 份</p>
                          </div>
                          <strong>$${numberFormat(item.total)}</strong>
                        </div>
                      `,
                    )
                    .join("")
                : '<div class="empty-state">尚無人加入</div>'
            }
          </div>

          <div class="table-wrap compact-table">
            <table>
              <thead>
                <tr>
                  <th>技師</th>
                  <th>姓名</th>
                  <th>項目</th>
                  <th>金額</th>
                  <th>備註</th>
                </tr>
              </thead>
              <tbody>
                ${
                  group.orders && group.orders.length
                    ? group.orders
                        .map(
                          (order) => `
                            <tr>
                              <td>${escapeHtml(order.technicianNumber)}</td>
                              <td>${escapeHtml(order.displayName)}</td>
                              <td>${escapeHtml(order.itemSummary)}</td>
                              <td>$${numberFormat(order.total)}</td>
                              <td>${escapeHtml(order.note || "")}</td>
                            </tr>
                          `,
                        )
                        .join("")
                    : '<tr><td colspan="5">尚無加入紀錄</td></tr>'
                }
              </tbody>
            </table>
          </div>
        </article>
      `;
    })
    .join("");

  els.myGroupsList.querySelectorAll("[data-edit-group]").forEach((button) => {
    button.addEventListener("click", () => startEditGroup(button.dataset.editGroup));
  });
  els.myGroupsList.querySelectorAll("[data-toggle-group]").forEach((button) => {
    button.addEventListener("click", () => toggleGroupStatus(button.dataset.toggleGroup));
  });
}

function renderRecords() {
  if (!state.myOrders.length) {
    els.recordsTable.innerHTML = '<tr><td colspan="5">尚無加入紀錄</td></tr>';
    return;
  }

  els.recordsTable.innerHTML = state.myOrders
    .map(
      (order) => `
        <tr>
          <td>${escapeHtml(formatDateTime(order.createdAt))}</td>
          <td>${escapeHtml(order.groupName)}</td>
          <td>${escapeHtml(order.itemSummary)}</td>
          <td>$${numberFormat(order.total)}</td>
          <td>${escapeHtml(order.note || "")}</td>
        </tr>
      `,
    )
    .join("");
}

async function saveTechnicianNumber(event) {
  event.preventDefault();
  clearError();
  const technicianNumber = els.technicianNumber.value.trim();
  if (!technicianNumber) {
    showToast("請輸入技師號碼");
    return;
  }

  try {
    const result = await apiRequest("saveTechnicianNumber", { technicianNumber });
    applyDashboard(result);
    showToast("技師號碼已儲存");
  } catch (error) {
    showError(error.message);
  }
}

async function saveGroup(event) {
  event.preventDefault();
  clearError();

  if (!canUseSystem()) {
    showToast("請先輸入技師號碼");
    return;
  }

  const groupName = els.groupName.value.trim();
  const items = state.draftItems
    .map((item) => ({
      itemId: item.itemId,
      name: String(item.name || "").trim(),
      price: Number(item.price || 0),
    }))
    .filter((item) => item.name);

  if (!groupName) {
    showToast("請輸入團名");
    return;
  }
  if (!items.length) {
    showToast("請新增至少一個項目");
    return;
  }

  try {
    const action = state.editingGroupId ? "updateGroup" : "createGroup";
    const wasEditing = Boolean(state.editingGroupId);
    const result = await apiRequest(action, {
      groupId: state.editingGroupId,
      groupName,
      items,
    });
    applyDashboard(result);
    resetGroupForm();
    switchView("myGroupsView");
    showToast(wasEditing ? "開團已更新" : "開團已建立");
  } catch (error) {
    showError(error.message);
  }
}

async function submitJoin(event) {
  event.preventDefault();
  clearError();

  if (!canUseSystem()) {
    showToast("請先輸入技師號碼");
    return;
  }

  const group = getSelectedGroup();
  const items = getSelectedJoinItems();
  if (!group || !items.length) {
    showToast("請先選擇要加入的項目");
    return;
  }

  try {
    const result = await apiRequest("joinGroup", {
      groupId: group.groupId,
      items,
      note: els.joinNote.value.trim(),
    });
    state.selectedQuantities = {};
    els.joinNote.value = "";
    applyDashboard(result);
    showToast("已加入開團");
  } catch (error) {
    showError(error.message);
  }
}

function selectGroup(groupId) {
  state.selectedGroupId = groupId;
  state.selectedQuantities = {};
  renderGroupList();
  renderJoinPanel();
  renderStatus();
  renderIcons();
}

function startEditGroup(groupId) {
  const group = state.myGroups.find((candidate) => candidate.groupId === groupId);
  if (!group) return;

  state.editingGroupId = group.groupId;
  els.groupName.value = group.groupName;
  state.draftItems = group.items.map((item) => ({
    itemId: item.itemId,
    name: item.name,
    price: Number(item.price || 0),
    active: true,
  }));
  renderDraftForm();
  renderDraftItems();
  switchView("createView");
}

async function toggleGroupStatus(groupId) {
  const group = state.myGroups.find((candidate) => candidate.groupId === groupId);
  if (!group) return;

  try {
    const result = await apiRequest("setGroupStatus", {
      groupId,
      status: group.status === "open" ? "closed" : "open",
    });
    applyDashboard(result);
    showToast(group.status === "open" ? "已關閉開團" : "已重新開啟");
  } catch (error) {
    showError(error.message);
  }
}

function cancelEditGroup() {
  resetGroupForm();
  renderAll();
}

function resetGroupForm() {
  state.editingGroupId = "";
  els.groupName.value = "";
  resetDraftItems();
  renderDraftForm();
  renderDraftItems();
}

function resetDraftItems() {
  state.draftItems = [{ itemId: createId(), name: "", price: 0, active: true }];
}

function switchView(viewId) {
  state.activeView = viewId;
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === viewId);
  });
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewId);
  });

  const titleMap = {
    joinView: "加入團",
    createView: state.editingGroupId ? "編輯開團" : "開團",
    myGroupsView: "我開的團",
    recordsView: "加入紀錄",
  };
  els.pageTitle.textContent = titleMap[viewId] || "開團系統";
}

function getSelectedGroup() {
  return state.openGroups.find((group) => group.groupId === state.selectedGroupId) || null;
}

function getSelectedJoinItems() {
  const group = getSelectedGroup();
  if (!group) return [];

  return Object.entries(state.selectedQuantities)
    .filter(([, quantity]) => Number(quantity) > 0)
    .map(([itemId, quantity]) => {
      const item = group.items.find((candidate) => candidate.itemId === itemId);
      return {
        itemId,
        name: item?.name || "",
        price: Number(item?.price || 0),
        quantity: Number(quantity),
      };
    })
    .filter((item) => item.name);
}

function updateJoinTotal() {
  const total = getSelectedJoinItems().reduce((sum, item) => sum + item.price * item.quantity, 0);
  els.joinTotal.textContent = `$${numberFormat(total)}`;
}

function summarizeOrders(orders) {
  const map = new Map();
  orders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const current = map.get(item.itemId) || {
        name: item.name,
        quantity: 0,
        total: 0,
      };
      current.quantity += Number(item.quantity || 0);
      current.total += Number(item.price || 0) * Number(item.quantity || 0);
      map.set(item.itemId, current);
    });
  });
  return Array.from(map.values()).sort((a, b) => b.quantity - a.quantity);
}

function canUseSystem() {
  return Boolean(state.user && state.user.technicianNumber);
}

function getDisplayName() {
  return state.user?.displayName || state.profile?.displayName || "LINE 帳號";
}

function setLoading(value) {
  state.loading = value;
  renderStatus();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove("show");
  }, 2600);
}

function showError(message) {
  els.errorText.textContent = message;
  els.errorNotice.classList.remove("hidden");
}

function clearError() {
  els.errorText.textContent = "";
  els.errorNotice.classList.add("hidden");
}

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function numberFormat(value) {
  return Number(value || 0).toLocaleString("zh-TW");
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function restoreDemoSession() {
  const db = getDemoDb();
  state.profile = db.currentProfile || null;
  if (!state.profile) return;

  const user = db.users.find((candidate) => candidate.lineUserId === state.profile.userId) || null;
  applyDashboard(buildDemoDashboard(db, user));
}

function ensureDemoLogin() {
  const db = getDemoDb();
  if (!db.currentProfile) {
    db.currentProfile = {
      userId: "demo-user",
      displayName: "Demo 技師",
      pictureUrl: "",
    };
    saveDemoDb(db);
  }
}

function demoLogin() {
  const db = getDemoDb();
  db.currentProfile = {
    userId: "demo-user",
    displayName: "Demo 技師",
    pictureUrl: "",
  };
  saveDemoDb(db);
  restoreDemoSession();
  showToast("已進入 Demo 模式");
}

function demoLogout() {
  const db = getDemoDb();
  db.currentProfile = null;
  saveDemoDb(db);
  Object.assign(state, {
    profile: null,
    idToken: "",
    user: null,
    openGroups: [],
    myGroups: [],
    myOrders: [],
    selectedGroupId: "",
    selectedQuantities: {},
    editingGroupId: "",
    activeView: "joinView",
    loading: false,
  });
  resetGroupForm();
  switchView("joinView");
  renderAll();
  showToast("已登出 Demo 模式");
}

function demoApi(action, payload) {
  const db = getDemoDb();
  const currentUserId = db.currentProfile?.userId || "demo-user";
  let user = db.users.find((candidate) => candidate.lineUserId === currentUserId);

  if (!user) {
    user = {
      lineUserId: currentUserId,
      displayName: db.currentProfile?.displayName || "Demo 使用者",
      pictureUrl: "",
      technicianNumber: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.users.push(user);
  }

  switch (action) {
    case "bootstrap":
      break;
    case "saveTechnicianNumber":
      user.technicianNumber = String(payload.technicianNumber || "").trim();
      user.updatedAt = new Date().toISOString();
      break;
    case "createGroup":
      requireDemoTechnician(user);
      db.groups.unshift({
        groupId: createId(),
        groupName: String(payload.groupName || "").trim(),
        ownerLineUserId: user.lineUserId,
        ownerName: user.displayName,
        ownerTechnicianNumber: user.technicianNumber,
        status: "open",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      saveDemoItems(db, db.groups[0].groupId, payload.items || []);
      break;
    case "updateGroup":
      requireDemoTechnician(user);
      updateDemoGroup(db, user, payload);
      break;
    case "setGroupStatus":
      requireDemoTechnician(user);
      setDemoGroupStatus(db, user, payload);
      break;
    case "joinGroup":
      requireDemoTechnician(user);
      addDemoJoinOrder(db, user, payload);
      break;
    default:
      throw new Error(`未知操作：${action}`);
  }

  saveDemoDb(db);
  return buildDemoDashboard(db, user);
}

function requireDemoTechnician(user) {
  if (!user.technicianNumber) {
    throw new Error("請先輸入技師號碼");
  }
}

function buildDemoDashboard(db, user) {
  if (!user) {
    return { user: null, openGroups: [], myGroups: [], myOrders: [] };
  }

  const orders = db.orders.map(normalizeDemoOrder);
  const groups = db.groups.map((group) => ({
    ...group,
    items: db.items.filter((item) => item.groupId === group.groupId && item.active !== false),
    orders: orders.filter((order) => order.groupId === group.groupId),
    orderCount: orders.filter((order) => order.groupId === group.groupId).length,
  }));

  return {
    user,
    openGroups: groups.filter((group) => group.status === "open" && group.ownerLineUserId !== user.lineUserId),
    myGroups: groups.filter((group) => group.ownerLineUserId === user.lineUserId),
    myOrders: orders.filter((order) => order.lineUserId === user.lineUserId),
  };
}

function saveDemoItems(db, groupId, items) {
  db.items = db.items.filter((item) => item.groupId !== groupId);
  items
    .filter((item) => String(item.name || "").trim())
    .forEach((item) => {
      db.items.push({
        itemId: item.itemId || createId(),
        groupId,
        name: String(item.name || "").trim(),
        price: Number(item.price || 0),
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
}

function updateDemoGroup(db, user, payload) {
  const group = db.groups.find((candidate) => candidate.groupId === payload.groupId);
  if (!group || group.ownerLineUserId !== user.lineUserId) {
    throw new Error("找不到可編輯的開團");
  }
  group.groupName = String(payload.groupName || "").trim();
  group.updatedAt = new Date().toISOString();
  saveDemoItems(db, group.groupId, payload.items || []);
}

function setDemoGroupStatus(db, user, payload) {
  const group = db.groups.find((candidate) => candidate.groupId === payload.groupId);
  if (!group || group.ownerLineUserId !== user.lineUserId) {
    throw new Error("找不到可調整的開團");
  }
  group.status = payload.status === "closed" ? "closed" : "open";
  group.updatedAt = new Date().toISOString();
}

function addDemoJoinOrder(db, user, payload) {
  const group = db.groups.find((candidate) => candidate.groupId === payload.groupId);
  if (!group || group.status !== "open") {
    throw new Error("這個團目前無法加入");
  }
  if (group.ownerLineUserId === user.lineUserId) {
    throw new Error("不能加入自己開的團");
  }

  const items = (payload.items || []).map((requested) => {
    const item = db.items.find((candidate) => candidate.itemId === requested.itemId && candidate.groupId === group.groupId);
    if (!item || Number(requested.quantity || 0) <= 0) {
      throw new Error("加入項目不正確");
    }
    return {
      itemId: item.itemId,
      name: item.name,
      price: Number(item.price),
      quantity: Number(requested.quantity),
    };
  });

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  db.orders.unshift({
    orderId: createId(),
    groupId: group.groupId,
    groupName: group.groupName,
    ownerLineUserId: group.ownerLineUserId,
    lineUserId: user.lineUserId,
    displayName: user.displayName,
    technicianNumber: user.technicianNumber,
    itemSummary: items.map((item) => `${item.name} x${item.quantity}`).join("、"),
    items,
    total,
    note: String(payload.note || "").trim(),
    createdAt: new Date().toISOString(),
  });
}

function normalizeDemoOrder(order) {
  return {
    ...order,
    items: order.items || [],
    total: Number(order.total || 0),
  };
}

function getDemoDb() {
  const stored = localStorage.getItem("group-system-demo-db");
  if (stored) return JSON.parse(stored);

  const now = new Date().toISOString();
  const otherGroupId = createId();
  return {
    currentProfile: null,
    users: [
      {
        lineUserId: "demo-user",
        displayName: "Demo 技師",
        pictureUrl: "",
        technicianNumber: "",
        createdAt: now,
        updatedAt: now,
      },
      {
        lineUserId: "demo-owner",
        displayName: "小林",
        pictureUrl: "",
        technicianNumber: "B018",
        createdAt: now,
        updatedAt: now,
      },
    ],
    groups: [
      {
        groupId: otherGroupId,
        groupName: "下午飲料團",
        ownerLineUserId: "demo-owner",
        ownerName: "小林",
        ownerTechnicianNumber: "B018",
        status: "open",
        createdAt: now,
        updatedAt: now,
      },
    ],
    items: [
      { itemId: createId(), groupId: otherGroupId, name: "紅茶", price: 30, active: true, createdAt: now, updatedAt: now },
      { itemId: createId(), groupId: otherGroupId, name: "珍珠奶茶", price: 55, active: true, createdAt: now, updatedAt: now },
      { itemId: createId(), groupId: otherGroupId, name: "檸檬綠茶", price: 45, active: true, createdAt: now, updatedAt: now },
    ],
    orders: [],
  };
}

function saveDemoDb(db) {
  localStorage.setItem("group-system-demo-db", JSON.stringify(db));
}

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
