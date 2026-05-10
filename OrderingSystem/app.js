(() => {
  const CONFIG_DEFAULTS = {
    gasWebAppUrl: "",
    liffId: "",
    lineChannelId: "",
    spreadsheetId: "",
    demoMode: true,
  };

  const STORAGE = {
    session: "orderingSystem.session",
    mode: "orderingSystem.mode",
    demoData: "orderingSystem.demoData",
    demoUser: "orderingSystem.demoUser",
  };

  const state = {
    api: null,
    config: { ...CONFIG_DEFAULTS },
    user: null,
    session: "",
    usingDemo: false,
    liff: null,
    liffReady: false,
    groups: [],
    selectedGroupId: "",
    view: "browse",
    filter: "all",
    search: "",
  };

  const els = {};
  const money = new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  });

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindStaticEvents();
    resetCreateForm();

    readLoginCallback();
    state.config = await loadConfig();
    state.usingDemo = !state.config.demoMode;
    state.api = createApi();
    renderConfigStatus();

    const mode = desiredAuthMode();
    if (localStorage.getItem(STORAGE.mode) !== mode) {
      state.session = "";
      localStorage.removeItem(STORAGE.session);
    }

    if (mode === "live") {
      await initLineLogin();
    }

    if (state.session && localStorage.getItem(STORAGE.mode) === mode) {
      await restoreSession();
    }

    if (!state.user) {
      await autoAuthenticate(mode);
    }

    renderSession();
    await refreshGroups();
  }

  function cacheElements() {
    els.sessionArea = document.querySelector("#sessionArea");
    els.mainNav = document.querySelector("#mainNav");
    els.configStatus = document.querySelector("#configStatus");
    els.loginButton = document.querySelector("#loginButton");
    els.heroLoginButton = document.querySelector("#heroLoginButton");
    els.demoLoginButton = document.querySelector("#demoLoginButton");
    els.loginPanel = document.querySelector("#loginPanel");
    els.createPanel = document.querySelector("#createPanel");
    els.createGroupForm = document.querySelector("#createGroupForm");
    els.groupNameInput = document.querySelector("#groupNameInput");
    els.itemEditor = document.querySelector("#itemEditor");
    els.addItemButton = document.querySelector("#addItemButton");
    els.resetCreateButton = document.querySelector("#resetCreateButton");
    els.groupSearchInput = document.querySelector("#groupSearchInput");
    els.groupList = document.querySelector("#groupList");
    els.emptyDetail = document.querySelector("#emptyDetail");
    els.groupDetail = document.querySelector("#groupDetail");
    els.detailOwner = document.querySelector("#detailOwner");
    els.detailTitle = document.querySelector("#detailTitle");
    els.detailStatus = document.querySelector("#detailStatus");
    els.detailItemCount = document.querySelector("#detailItemCount");
    els.detailOrderCount = document.querySelector("#detailOrderCount");
    els.detailTotal = document.querySelector("#detailTotal");
    els.ownerTools = document.querySelector("#ownerTools");
    els.ownerAddDraftButton = document.querySelector("#ownerAddDraftButton");
    els.ownerSaveItemsButton = document.querySelector("#ownerSaveItemsButton");
    els.ownerItemList = document.querySelector("#ownerItemList");
    els.joinGroupForm = document.querySelector("#joinGroupForm");
    els.quantityList = document.querySelector("#quantityList");
    els.joinSubtotal = document.querySelector("#joinSubtotal");
    els.orderSectionTitle = document.querySelector("#orderSectionTitle");
    els.saveOrdersButton = document.querySelector("#saveOrdersButton");
    els.orderList = document.querySelector("#orderList");
    els.toast = document.querySelector("#toast");
    els.itemRowTemplate = document.querySelector("#itemRowTemplate");
    els.groupCardTemplate = document.querySelector("#groupCardTemplate");
    els.quantityRowTemplate = document.querySelector("#quantityRowTemplate");
    els.orderRowTemplate = document.querySelector("#orderRowTemplate");
    els.ownerItemTemplate = document.querySelector("#ownerItemTemplate");
    els.navButtons = [...document.querySelectorAll("[data-view]")];
    els.viewPanels = [...document.querySelectorAll("[data-view-panel]")];
    els.filterButtons = [...document.querySelectorAll("[data-filter]")];
  }

  function bindStaticEvents() {
    els.loginButton.addEventListener("click", handleLogin);
    els.heroLoginButton.addEventListener("click", handleLogin);
    els.demoLoginButton.addEventListener("click", (event) => {
      withBusy(event.currentTarget, handleDemoLogin);
    });
    els.navButtons.forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });
    els.addItemButton.addEventListener("click", () => addCreateItemRow());
    els.resetCreateButton.addEventListener("click", resetCreateForm);
    els.createGroupForm.addEventListener("submit", handleCreateGroup);
    els.ownerAddDraftButton.addEventListener("click", () => addOwnerItemRow());
    els.ownerSaveItemsButton.addEventListener("click", handleSaveOwnerItems);
    els.ownerItemList.addEventListener("click", handleOwnerItemAction);
    els.joinGroupForm.addEventListener("submit", handleJoinGroup);
    els.quantityList.addEventListener("click", handleQuantityClick);
    els.quantityList.addEventListener("input", updateSubtotal);
    els.saveOrdersButton.addEventListener("click", handleSaveOrderEdits);
    els.orderList.addEventListener("click", handleOrderEditAction);
    els.groupSearchInput.addEventListener("input", () => {
      state.search = els.groupSearchInput.value.trim().toLowerCase();
      renderGroups();
    });
    els.filterButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.filter = button.dataset.filter;
        renderFilters();
        renderGroups();
      });
    });
  }

  async function loadConfig() {
    const inlineConfig = window.GROUP_BUY_CONFIG || {};
    let fileConfig = {};

    try {
      const response = await fetch("config.json", { cache: "no-store" });
      if (response.ok) {
        fileConfig = await response.json();
      }
    } catch (error) {
      fileConfig = {};
    }

    const merged = {
      ...CONFIG_DEFAULTS,
      ...fileConfig,
      ...inlineConfig,
    };

    return {
      ...merged,
      gasWebAppUrl: normalizeGasUrl(merged.gasWebAppUrl),
      liffId: String(merged.liffId || "").trim(),
      lineChannelId: String(merged.lineChannelId || "").trim(),
      spreadsheetId: String(merged.spreadsheetId || "").trim(),
      demoMode: merged.demoMode !== false,
    };
  }

  function readLoginCallback() {
    const url = new URL(window.location.href);
    const session = url.searchParams.get("session");
    const loginError = url.searchParams.get("login_error");

    if (session) {
      state.session = session;
      localStorage.setItem(STORAGE.session, session);
      localStorage.setItem(STORAGE.mode, "live");
      state.usingDemo = false;
      url.searchParams.delete("session");
      window.history.replaceState({}, document.title, url.toString());
    } else {
      state.session = localStorage.getItem(STORAGE.session) || "";
    }

    if (loginError) {
      showToast(loginError, "error");
      url.searchParams.delete("login_error");
      window.history.replaceState({}, document.title, url.toString());
    }
  }

  async function restoreSession() {
    try {
      state.user = await state.api.me(state.session);
    } catch (error) {
      localStorage.removeItem(STORAGE.session);
      localStorage.setItem(STORAGE.mode, "live");
      state.session = "";
      state.user = null;
      state.usingDemo = false;
      showToast("登入已過期，請重新登入。", "error");
    }
  }

  async function refreshGroups() {
    try {
      const groups = await state.api.listGroups(state.session);
      state.groups = groups.map(normalizeGroup).sort((a, b) => compareDateDesc(a.createdAt, b.createdAt));

      if (!state.groups.some((group) => group.id === state.selectedGroupId)) {
        state.selectedGroupId = state.groups[0] ? state.groups[0].id : "";
      }

      renderApp();
    } catch (error) {
      showToast(error.message || "讀取開團失敗。", "error");
      renderApp();
    }
  }

  function renderApp() {
    renderSession();
    renderFilters();
    renderGroups();
    renderDetail();
    renderView();
  }

  function renderConfigStatus() {
    const ready = isLiveConfigured();
    els.configStatus.textContent = state.usingDemo
      ? "測試身分"
      : ready
        ? "LIFF Live"
        : state.config.gasWebAppUrl
          ? "設定未完成"
          : "Demo";
    els.configStatus.classList.toggle("live", ready && !state.usingDemo);
    els.loginButton.classList.add("hidden");
    els.heroLoginButton.classList.add("hidden");
    els.demoLoginButton.classList.add("hidden");
  }

  function renderSession() {
    els.loginPanel.classList.toggle("hidden", Boolean(state.user));
    els.mainNav.classList.toggle("hidden", !state.user);

    const status = els.configStatus;
    els.sessionArea.replaceChildren(status);

    if (!state.user) {
      els.viewPanels.forEach((panel) => panel.classList.add("hidden"));
      return;
    }

    const chip = document.createElement("div");
    chip.className = "user-chip";

    if (state.user.pictureUrl) {
      const image = document.createElement("img");
      image.src = state.user.pictureUrl;
      image.alt = "";
      chip.appendChild(image);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "avatar-fallback";
      fallback.textContent = initials(state.user.displayName);
      chip.appendChild(fallback);
    }

    const name = document.createElement("span");
    name.textContent = state.user.displayName || "LINE 使用者";
    chip.appendChild(name);

    const logout = document.createElement("button");
    logout.className = "icon-button";
    logout.type = "button";
    logout.title = "登出";
    logout.setAttribute("aria-label", "登出");
    logout.textContent = "↪";
    logout.addEventListener("click", handleLogout);

    els.sessionArea.append(chip, logout);
  }

  function renderView() {
    if (!state.user) {
      return;
    }

    els.navButtons.forEach((button) => {
      const active = button.dataset.view === state.view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });

    els.viewPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.viewPanel !== state.view);
    });
  }

  function renderFilters() {
    els.filterButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.filter === state.filter);
    });
  }

  function renderGroups() {
    const groups = filteredGroups();
    els.groupList.replaceChildren();

    if (!groups.length) {
      els.groupList.appendChild(emptyState("目前沒有符合條件的開團"));
      return;
    }

    const fragment = document.createDocumentFragment();

    groups.forEach((group) => {
      const node = els.groupCardTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.groupId = group.id;
      node.classList.toggle("is-selected", group.id === state.selectedGroupId);
      node.querySelector(".group-owner").textContent = `團主 ${group.ownerName}`;
      node.querySelector(".group-name").textContent = group.name;
      node.querySelector(".meta-orders").textContent = group.isOwner
        ? `${group.stats.orders} 筆訂單`
        : `${group.stats.orders} 筆我的訂單`;
      node.querySelector(".meta-total").textContent = formatMoney(group.stats.total);

      const items = node.querySelector(".group-items");
      group.items.slice(0, 4).forEach((item) => {
        const pill = document.createElement("span");
        pill.className = "item-pill";
        pill.textContent = `${item.name} ${formatMoney(item.price)}`;
        items.appendChild(pill);
      });

      if (group.items.length > 4) {
        const extra = document.createElement("span");
        extra.className = "item-pill";
        extra.textContent = `+${group.items.length - 4}`;
        items.appendChild(extra);
      }

      node.addEventListener("click", () => selectGroup(group.id));
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectGroup(group.id);
        }
      });

      fragment.appendChild(node);
    });

    els.groupList.appendChild(fragment);
  }

  function renderDetail() {
    const group = selectedGroup();
    els.emptyDetail.classList.toggle("hidden", Boolean(group));
    els.groupDetail.classList.toggle("hidden", !group);

    if (!group) {
      return;
    }

    els.detailOwner.textContent = `團主 ${group.ownerName} · ${formatDate(group.createdAt)}`;
    els.detailTitle.textContent = group.name;
    els.detailStatus.textContent = group.status === "closed" ? "已截止" : "開放中";
    els.detailItemCount.textContent = String(group.items.length);
    els.detailOrderCount.textContent = String(group.stats.orders);
    els.detailTotal.textContent = formatMoney(group.stats.total);

    renderOwnerTools(group);
    renderQuantityRows(group);
    renderOrders(group);
    updateSubtotal();
  }

  function renderOwnerTools(group) {
    els.ownerTools.classList.toggle("hidden", !group.isOwner);
    els.ownerItemList.replaceChildren();

    if (!group.isOwner) {
      return;
    }

    if (!group.items.length) {
      els.ownerItemList.appendChild(emptyState("尚未建立品項，按新增品項加入"));
      return;
    }

    const fragment = document.createDocumentFragment();
    group.items.forEach((item) => {
      fragment.appendChild(buildOwnerItemRow(item));
    });

    els.ownerItemList.appendChild(fragment);
  }

  function addOwnerItemRow(item = {}) {
    const empty = els.ownerItemList.querySelector(".empty-state");
    if (empty) {
      empty.remove();
    }

    const node = buildOwnerItemRow(item);
    els.ownerItemList.appendChild(node);
    node.querySelector(".owner-item-name").focus();
  }

  function buildOwnerItemRow(item = {}) {
    const node = els.ownerItemTemplate.content.firstElementChild.cloneNode(true);
    if (item.id) {
      node.dataset.itemId = item.id;
    }
    node.querySelector(".owner-item-name").value = item.name || "";
    node.querySelector(".owner-item-price").value = item.price !== undefined ? String(item.price) : "";
    return node;
  }

  function renderQuantityRows(group) {
    els.quantityList.replaceChildren();

    if (!state.user) {
      els.quantityList.appendChild(emptyState("請先登入再加入開團"));
      return;
    }

    const fragment = document.createDocumentFragment();
    group.items.forEach((item) => {
      const node = els.quantityRowTemplate.content.firstElementChild.cloneNode(true);
      const input = node.querySelector("input");
      node.dataset.itemId = item.id;
      input.dataset.itemId = item.id;
      input.dataset.price = String(item.price);
      node.querySelector(".quantity-name").textContent = item.name;
      node.querySelector(".quantity-price").textContent = formatMoney(item.price);
      fragment.appendChild(node);
    });

    els.quantityList.appendChild(fragment);
  }

  function renderOrders(group) {
    els.orderList.replaceChildren();
    els.orderSectionTitle.textContent = group.isOwner ? "全部訂單" : "我的訂購紀錄";
    els.saveOrdersButton.classList.toggle("hidden", !group.orders.some(canEditOrder));

    if (!group.orders.length) {
      els.orderList.appendChild(emptyState(group.isOwner ? "尚未有人下單" : "你尚未下單"));
      return;
    }

    const fragment = document.createDocumentFragment();
    group.orders.slice(0, 8).forEach((order) => {
      const node = els.orderRowTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.orderId = order.id;
      node.classList.toggle("is-owner-order", order.userId === group.ownerUserId);
      node.querySelector(".order-user").textContent = order.userName;
      node.querySelector(".order-role-badge").textContent =
        order.userId === group.ownerUserId ? "團主訂購" : "非團主訂購";
      node.querySelector(".order-items").textContent = order.items
        .map((item) => `${item.name} × ${item.quantity}`)
        .join("、");
      node.querySelector(".order-total").textContent = formatMoney(order.total);
      renderOrderEditor(order, node.querySelector(".order-editor"));
      fragment.appendChild(node);
    });

    els.orderList.appendChild(fragment);
  }

  function renderOrderEditor(order, container) {
    container.replaceChildren();
    container.classList.toggle("hidden", !canEditOrder(order));

    if (!canEditOrder(order)) {
      return;
    }

    const list = document.createElement("div");
    list.className = "order-editor-list";

    order.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "order-edit-row";
      row.dataset.itemId = item.itemId;

      const meta = document.createElement("div");
      meta.className = "order-edit-meta";

      const name = document.createElement("strong");
      name.textContent = item.name;

      const price = document.createElement("span");
      price.textContent = `${formatMoney(item.price)} / 份`;

      const input = document.createElement("input");
      input.className = "order-edit-quantity";
      input.type = "number";
      input.min = "0";
      input.step = "1";
      input.inputMode = "numeric";
      input.value = String(item.quantity);
      input.setAttribute("aria-label", `修改 ${item.name} 數量`);

      const remove = document.createElement("button");
      remove.className = "icon-button remove-order-item";
      remove.type = "button";
      remove.title = "移除";
      remove.setAttribute("aria-label", `移除 ${item.name}`);
      remove.textContent = "×";

      meta.append(name, price);
      row.append(meta, input, remove);
      list.appendChild(row);
    });

    container.appendChild(list);
  }

  function canEditOrder(order) {
    return Boolean(state.user && order && order.userId === state.user.id && order.items.length);
  }

  function selectGroup(groupId) {
    state.selectedGroupId = groupId;
    renderGroups();
    renderDetail();
    setView("detail");
  }

  function setView(view) {
    if (!["browse", "create", "detail"].includes(view)) {
      return;
    }

    state.view = view;
    renderView();
  }

  function filteredGroups() {
    return state.groups.filter((group) => {
      const text = `${group.name} ${group.ownerName} ${group.items.map((item) => item.name).join(" ")}`.toLowerCase();
      const matchesSearch = !state.search || text.includes(state.search);
      const matchesFilter =
        state.filter === "all" ||
        (state.filter === "mine" && state.user && group.ownerUserId === state.user.id) ||
        (state.filter === "joined" && state.user && group.orders.some((order) => order.userId === state.user.id));
      return matchesSearch && matchesFilter;
    });
  }

  async function handleLogin(event) {
    if (!state.config.gasWebAppUrl) {
      await handleDemoLogin();
      return;
    }

    await withBusy(event.currentTarget, async () => {
      state.usingDemo = false;
      state.api = createApi();
      localStorage.setItem(STORAGE.mode, "live");
      renderConfigStatus();

      if (!isLiveConfigured()) {
        throw new Error("請先在 config.json 設定 liffId、lineChannelId、spreadsheetId、gasWebAppUrl。");
      }

      await initLineLogin();

      if (!state.liff) {
        throw new Error("LINE LIFF SDK 尚未載入。");
      }

      if (!state.liff.isLoggedIn()) {
        state.liff.login({ redirectUri: frontendUrl() });
        return;
      }

      await authenticateWithLine(false);
    });
  }

  async function autoAuthenticate(mode) {
    try {
      if (mode === "test") {
        await handleDemoLogin();
        return;
      }

      if (!isLiveConfigured()) {
        throw new Error("請先在 config.json 設定 liffId、lineChannelId、spreadsheetId、gasWebAppUrl。");
      }

      await initLineLogin();

      if (!state.liff) {
        throw new Error("LINE LIFF SDK 尚未載入。");
      }

      if (!state.liff.isLoggedIn()) {
        state.liff.login({ redirectUri: frontendUrl() });
        return;
      }

      await authenticateWithLine(true);
    } catch (error) {
      showToast(error.message || "自動登入失敗。", "error");
    }
  }

  async function initLineLogin() {
    if (!isLiveConfigured()) {
      return;
    }

    if (state.liffReady) {
      return;
    }

    if (!window.liff) {
      showToast("LINE LIFF SDK 載入失敗。", "error");
      return;
    }

    try {
      await window.liff.init({ liffId: state.config.liffId });
      state.liff = window.liff;
      state.liffReady = true;
    } catch (error) {
      showToast(error.message || "LIFF 初始化失敗。", "error");
    }
  }

  async function authenticateWithLine(silent) {
    const idToken = state.liff && state.liff.getIDToken();
    if (!idToken) {
      if (!silent) {
        throw new Error("無法取得 LINE ID token，請重新登入。");
      }
      return;
    }

    const result = await state.api.loginWithLine(idToken);
    state.session = result.session;
    state.user = result.user;
    state.usingDemo = false;
    localStorage.setItem(STORAGE.session, state.session);
    localStorage.setItem(STORAGE.mode, "live");

    if (!silent) {
      showToast("LINE 登入完成。");
    }
  }

  async function handleDemoLogin() {
    const user = {
      id: "demo_user",
      displayName: "測試使用者",
      pictureUrl: "",
    };
    if (state.config.gasWebAppUrl) {
      state.usingDemo = true;
      state.api = createApi();
      const result = await state.api.testLogin(user);
      state.session = result.session;
      state.user = result.user;
      localStorage.setItem(STORAGE.session, state.session);
      localStorage.setItem(STORAGE.mode, "test");
    } else {
      state.usingDemo = true;
      state.api = new DemoApi();
      localStorage.setItem(STORAGE.demoUser, JSON.stringify(user));
      localStorage.setItem(STORAGE.session, "demo-session");
      localStorage.setItem(STORAGE.mode, "test");
      state.session = "demo-session";
      state.user = user;
    }

    showToast("已切換為測試身分。");
  }

  function handleLogout() {
    if (state.liff && state.liff.isLoggedIn()) {
      state.liff.logout();
    }
    localStorage.removeItem(STORAGE.session);
    localStorage.setItem(STORAGE.mode, "live");
    state.session = "";
    state.user = null;
    state.usingDemo = false;
    state.view = "browse";
    state.api = createApi();
    renderApp();
  }

  async function handleCreateGroup(event) {
    event.preventDefault();

    if (!state.user) {
      showToast("請先登入。", "error");
      return;
    }

    const name = els.groupNameInput.value.trim();
    const items = collectCreateItems();

    if (!name) {
      showToast("請輸入開團名稱。", "error");
      return;
    }

    if (!items.length) {
      showToast("至少需要一個品項。", "error");
      return;
    }

    const submitter = event.submitter;
    await withBusy(submitter, async () => {
      const result = await state.api.createGroup({ name, items }, state.session, state.user);
      resetCreateForm();
      await refreshGroups();
      if (result && result.group && result.group.id) {
        state.selectedGroupId = result.group.id;
        state.view = "detail";
        renderApp();
      }
      showToast("開團已建立。");
    });
  }

  async function handleOwnerItemAction(event) {
    const deleteButton = event.target.closest(".delete-owner-item");

    if (!deleteButton) {
      return;
    }

    const row = event.target.closest(".owner-item-row");
    const group = selectedGroup();

    if (!row || !group || !group.isOwner) {
      showToast("只有團主可以管理品項。", "error");
      return;
    }

    row.remove();
    if (!els.ownerItemList.querySelector(".owner-item-row")) {
      els.ownerItemList.appendChild(emptyState("尚未建立品項，按新增品項加入"));
    }
    showToast("品項已標記移除，按儲存品項套用。");
  }

  async function handleSaveOwnerItems(event) {
    const group = selectedGroup();

    if (!group || !group.isOwner) {
      showToast("只有團主可以管理品項。", "error");
      return;
    }

    const items = collectOwnerItems();
    if (!items) {
      return;
    }

    await withBusy(event.currentTarget, async () => {
      await state.api.saveItems({ groupId: group.id, items }, state.session);
      await refreshGroups();
      state.selectedGroupId = group.id;
      state.view = "detail";
      renderApp();
      showToast("品項已儲存。");
    });
  }

  async function handleJoinGroup(event) {
    event.preventDefault();

    if (!state.user) {
      showToast("請先登入。", "error");
      return;
    }

    const group = selectedGroup();
    if (!group) {
      showToast("請先選擇開團。", "error");
      return;
    }

    const items = [...els.quantityList.querySelectorAll("input")]
      .map((input) => ({
        itemId: input.dataset.itemId,
        quantity: Math.max(0, Number.parseInt(input.value, 10) || 0),
      }))
      .filter((item) => item.quantity > 0);

    if (!items.length) {
      showToast("請選擇至少一個品項。", "error");
      return;
    }

    await withBusy(event.submitter, async () => {
      await state.api.joinGroup({ groupId: group.id, items }, state.session, state.user);
      await refreshGroups();
      state.selectedGroupId = group.id;
      state.view = "detail";
      renderApp();
      showToast("訂單已送出。");
    });
  }

  async function handleOrderEditAction(event) {
    const removeButton = event.target.closest(".remove-order-item");

    if (!removeButton) {
      return;
    }

    const orderNode = event.target.closest(".order-row");
    const group = selectedGroup();

    if (!orderNode || !group) {
      return;
    }

    const order = group.orders.find((entry) => entry.id === orderNode.dataset.orderId);
    if (!canEditOrder(order)) {
      showToast("只能修改自己的訂單。", "error");
      return;
    }

    if (removeButton) {
      const row = removeButton.closest(".order-edit-row");
      const input = row && row.querySelector(".order-edit-quantity");
      if (input) {
        input.value = "0";
      }
      if (row) {
        row.classList.add("is-pending-remove");
      }
    }

    showToast("品項已標記移除，按儲存訂單變更套用。");
  }

  async function handleSaveOrderEdits(event) {
    const group = selectedGroup();

    if (!group) {
      return;
    }

    const orders = collectOrderEdits(group);
    if (!orders.length) {
      showToast("沒有可儲存的訂單變更。", "error");
      return;
    }

    await withBusy(event.currentTarget, async () => {
      await state.api.saveOrders({ groupId: group.id, orders }, state.session);
      await refreshGroups();
      state.selectedGroupId = group.id;
      state.view = "detail";
      renderApp();
      showToast("訂單變更已儲存。");
    });
  }

  function handleQuantityClick(event) {
    const button = event.target.closest("[data-step]");
    if (!button) {
      return;
    }

    const input = button.closest(".quantity-row").querySelector("input");
    const nextValue = Math.max(0, (Number.parseInt(input.value, 10) || 0) + Number(button.dataset.step));
    input.value = String(nextValue);
    updateSubtotal();
  }

  function updateSubtotal() {
    const total = [...els.quantityList.querySelectorAll("input")].reduce((sum, input) => {
      const quantity = Math.max(0, Number.parseInt(input.value, 10) || 0);
      const price = Number(input.dataset.price) || 0;
      return sum + quantity * price;
    }, 0);

    els.joinSubtotal.textContent = formatMoney(total);
  }

  function collectOrderEditItems(orderNode) {
    return [...orderNode.querySelectorAll(".order-edit-row")].map((row) => ({
      itemId: row.dataset.itemId,
      quantity: Math.max(0, Number.parseInt(row.querySelector(".order-edit-quantity").value, 10) || 0),
    }));
  }

  function collectOrderEdits(group) {
    return [...els.orderList.querySelectorAll(".order-row")]
      .map((orderNode) => {
        const order = group.orders.find((entry) => entry.id === orderNode.dataset.orderId);
        if (!canEditOrder(order)) {
          return null;
        }
        return {
          orderId: order.id,
          items: collectOrderEditItems(orderNode),
        };
      })
      .filter(Boolean);
  }

  function collectOwnerItems() {
    const rows = [...els.ownerItemList.querySelectorAll(".owner-item-row")];
    const items = [];
    let invalid = false;

    rows.forEach((row) => {
      const nameInput = row.querySelector(".owner-item-name");
      const priceInput = row.querySelector(".owner-item-price");
      const name = nameInput.value.trim();
      const priceText = priceInput.value.trim();

      if (!row.dataset.itemId && !name && !priceText) {
        return;
      }

      const item = {
        id: row.dataset.itemId || "",
        name,
        price: Number(priceText),
      };

      if (!isValidItem(item)) {
        invalid = true;
        row.classList.add("is-invalid");
        return;
      }

      row.classList.remove("is-invalid");
      items.push(item);
    });

    if (invalid) {
      showToast("請確認每個品項都有名稱與有效金額。", "error");
      return null;
    }

    return items;
  }

  function collectCreateItems() {
    return [...els.itemEditor.querySelectorAll(".item-row")]
      .map((row) => ({
        name: row.querySelector('[name="itemName"]').value.trim(),
        price: Number(row.querySelector('[name="itemPrice"]').value),
      }))
      .filter(isValidItem);
  }

  function isValidItem(item) {
    return item.name && Number.isFinite(item.price) && item.price >= 0;
  }

  function resetCreateForm() {
    els.createGroupForm.reset();
    els.itemEditor.replaceChildren();
    addCreateItemRow();
    addCreateItemRow();
  }

  function addCreateItemRow(name = "", price = "") {
    const node = els.itemRowTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('[name="itemName"]').value = name;
    node.querySelector('[name="itemPrice"]').value = price;
    node.querySelector(".remove-item").addEventListener("click", () => {
      if (els.itemEditor.children.length <= 1) {
        node.querySelector('[name="itemName"]').value = "";
        node.querySelector('[name="itemPrice"]').value = "";
        return;
      }
      node.remove();
    });
    els.itemEditor.appendChild(node);
  }

  async function withBusy(button, task) {
    if (button) {
      button.disabled = true;
    }
    try {
      await task();
    } catch (error) {
      showToast(error.message || "操作失敗。", "error");
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  function selectedGroup() {
    return state.groups.find((group) => group.id === state.selectedGroupId) || null;
  }

  function normalizeGroup(group) {
    const items = (group.items || []).map((item) => ({
      ...item,
      price: Number(item.price) || 0,
    }));

    const orders = (group.orders || [])
      .map((order) => {
        const orderItems = (order.items || []).map((item) => ({
          ...item,
          price: Number(item.price) || 0,
          quantity: Number(item.quantity) || 0,
          subtotal: Number(item.subtotal) || (Number(item.price) || 0) * (Number(item.quantity) || 0),
        }));
        const total = Number(order.total) || orderItems.reduce((sum, item) => sum + item.subtotal, 0);
        return {
          ...order,
          total,
          items: orderItems,
        };
      })
      .sort((a, b) => compareDateDesc(a.createdAt, b.createdAt));

    const participants = new Set(orders.map((order) => order.userId).filter(Boolean)).size;
    const total = orders.reduce((sum, order) => sum + order.total, 0);
    const ownerUserId = group.ownerUserId || (group.owner && group.owner.id) || "";
    const isOwner = Boolean(group.isOwner || (state.user && ownerUserId === state.user.id));

    return {
      ...group,
      items,
      orders,
      status: group.status || "open",
      ownerName: group.ownerName || (group.owner && group.owner.displayName) || "LINE 使用者",
      ownerUserId,
      isOwner,
      canManageItems: Boolean(group.canManageItems || isOwner),
      stats: {
        participants,
        orders: orders.length,
        total,
        ...(group.stats || {}),
      },
    };
  }

  function emptyState(message) {
    const node = document.createElement("div");
    node.className = "empty-state";
    node.textContent = message;
    return node;
  }

  function showToast(message, type = "success") {
    window.clearTimeout(showToast.timer);
    els.toast.textContent = message;
    els.toast.className = `toast is-visible${type === "error" ? " is-error" : ""}`;
    showToast.timer = window.setTimeout(() => {
      els.toast.classList.remove("is-visible");
    }, 2800);
  }

  function initials(name = "") {
    return name.trim().slice(0, 1).toUpperCase() || "U";
  }

  function formatMoney(value) {
    return money.format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return new Intl.DateTimeFormat("zh-TW", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function compareDateDesc(a, b) {
    return new Date(b || 0).getTime() - new Date(a || 0).getTime();
  }

  function frontendUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    url.searchParams.delete("login_error");
    url.hash = "";
    return url.toString();
  }

  function isLiveConfigured() {
    return Boolean(
      state.config.gasWebAppUrl && state.config.liffId && state.config.lineChannelId && state.config.spreadsheetId
    );
  }

  function isGasConfigured() {
    return Boolean(state.config.gasWebAppUrl && state.config.spreadsheetId);
  }

  function desiredAuthMode() {
    return state.config.demoMode ? "live" : "test";
  }

  function normalizeGasUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }

    try {
      const url = new URL(raw);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch (error) {
      return raw.split("?")[0].split("#")[0];
    }
  }

  function createApi() {
    return state.config.gasWebAppUrl ? new GasApi(state.config) : new DemoApi();
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  class GasApi {
    constructor(config) {
      this.baseUrl = config.gasWebAppUrl;
      this.config = config;
    }

    loginWithLine(idToken) {
      return this.request("login", { idToken });
    }

    testLogin(user) {
      return this.request("testLogin", {
        payload: JSON.stringify(user),
      });
    }

    me(session) {
      return this.request("me", { session }).then((data) => data.user);
    }

    listGroups(session) {
      return this.request("groups", { session }).then((data) => data.groups || []);
    }

    createGroup(payload, session) {
      return this.request("createGroup", {
        session,
        payload: JSON.stringify(payload),
      });
    }

    addItem(payload, session) {
      return this.request("addItem", {
        session,
        payload: JSON.stringify(payload),
      });
    }

    updateItem(payload, session) {
      return this.request("updateItem", {
        session,
        payload: JSON.stringify(payload),
      });
    }

    deleteItem(payload, session) {
      return this.request("deleteItem", {
        session,
        payload: JSON.stringify(payload),
      });
    }

    saveItems(payload, session) {
      return this.request("saveItems", {
        session,
        payload: JSON.stringify(payload),
      });
    }

    joinGroup(payload, session) {
      return this.request("joinGroup", {
        session,
        payload: JSON.stringify(payload),
      });
    }

    updateOrder(payload, session) {
      return this.request("updateOrder", {
        session,
        payload: JSON.stringify(payload),
      });
    }

    saveOrders(payload, session) {
      return this.request("saveOrders", {
        session,
        payload: JSON.stringify(payload),
      });
    }

    request(action, params = {}) {
      return new Promise((resolve, reject) => {
        const callback = `__orderingSystem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const url = new URL(this.baseUrl);
        url.searchParams.set("action", action);
        url.searchParams.set("callback", callback);

        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, value);
          }
        });

        url.searchParams.set("spreadsheetId", this.config.spreadsheetId);
        url.searchParams.set("lineChannelId", this.config.lineChannelId);

        const script = document.createElement("script");
        const timeout = window.setTimeout(() => {
          cleanup();
          reject(new Error("GAS 回應逾時。"));
        }, 18000);

        const cleanup = () => {
          window.clearTimeout(timeout);
          delete window[callback];
          script.remove();
        };

        window[callback] = (response) => {
          cleanup();
          if (!response || response.ok === false) {
            reject(new Error((response && response.message) || "GAS 操作失敗。"));
            return;
          }
          resolve(response.data || {});
        };

        script.onerror = () => {
          cleanup();
          reject(new Error("無法連線 GAS Web App。"));
        };
        script.src = url.toString();
        document.body.appendChild(script);
      });
    }
  }

  class DemoApi {
    me() {
      return Promise.resolve(this.currentUser());
    }

    listGroups() {
      const user = this.currentUser();
      const groups = this.data().groups.map((group) => {
        const isOwner = group.ownerUserId === user.id;
        return {
          ...group,
          isOwner,
          canManageItems: isOwner,
          orders: isOwner ? group.orders : group.orders.filter((order) => order.userId === user.id),
        };
      });
      return Promise.resolve(groups);
    }

    createGroup(payload) {
      const data = this.data();
      const user = this.currentUser();
      const now = new Date().toISOString();
      const group = {
        id: uid("grp"),
        name: payload.name,
        ownerUserId: user.id,
        ownerName: user.displayName,
        status: "open",
        createdAt: now,
        items: payload.items.map((item) => ({
          id: uid("item"),
          name: item.name,
          price: Number(item.price) || 0,
        })),
        orders: [],
      };
      data.groups.unshift(group);
      this.save(data);
      return Promise.resolve({ group });
    }

    addItem(payload) {
      const data = this.data();
      const group = this.ownerGroup(data, payload.groupId);
      group.items.push({
        id: uid("item"),
        name: payload.item.name,
        price: Number(payload.item.price) || 0,
      });
      this.save(data);
      return Promise.resolve({ ok: true });
    }

    updateItem(payload) {
      const data = this.data();
      const group = this.ownerGroup(data, payload.groupId);
      const item = group.items.find((entry) => entry.id === payload.itemId);
      if (!item) {
        return Promise.reject(new Error("找不到品項。"));
      }
      item.name = payload.item.name;
      item.price = Number(payload.item.price) || 0;
      this.syncDemoOrderItems(group, item.id, item);
      this.save(data);
      return Promise.resolve({ ok: true });
    }

    deleteItem(payload) {
      const data = this.data();
      const group = this.ownerGroup(data, payload.groupId);
      const before = group.items.length;
      group.items = group.items.filter((entry) => entry.id !== payload.itemId);
      if (group.items.length === before) {
        return Promise.reject(new Error("找不到品項。"));
      }
      group.orders.forEach((order) => {
        order.items = order.items.filter((item) => item.itemId !== payload.itemId);
        order.total = order.items.reduce((sum, item) => sum + item.subtotal, 0);
      });
      group.orders = group.orders.filter((order) => order.items.length > 0);
      this.save(data);
      return Promise.resolve({ ok: true });
    }

    saveItems(payload) {
      const data = this.data();
      const group = this.ownerGroup(data, payload.groupId);
      const existingMap = new Map(group.items.map((item) => [item.id, item]));
      const nextItems = [];
      const keepIds = new Set();

      (payload.items || []).forEach((entry) => {
        const id = String(entry.id || "").trim();
        const item = {
          name: String(entry.name || "").trim(),
          price: Number(entry.price),
        };

        if (!isValidItem(item)) {
          throw new Error("請輸入品項名稱與金額。");
        }

        if (id) {
          const existing = existingMap.get(id);
          if (!existing) {
            throw new Error("找不到品項。");
          }
          existing.name = item.name;
          existing.price = item.price;
          keepIds.add(id);
          nextItems.push(existing);
          this.syncDemoOrderItems(group, id, existing);
          return;
        }

        nextItems.push({
          id: uid("item"),
          name: item.name,
          price: item.price,
        });
      });

      const removedIds = group.items
        .filter((item) => !keepIds.has(item.id) && !nextItems.some((entry) => entry.id === item.id))
        .map((item) => item.id);

      group.items = nextItems;
      removedIds.forEach((itemId) => {
        group.orders.forEach((order) => {
          order.items = order.items.filter((item) => item.itemId !== itemId);
          order.total = order.items.reduce((sum, item) => sum + item.subtotal, 0);
        });
      });
      group.orders = group.orders.filter((order) => order.items.length > 0);

      this.save(data);
      return Promise.resolve({ ok: true });
    }

    joinGroup(payload) {
      const data = this.data();
      const user = this.currentUser();
      const group = data.groups.find((entry) => entry.id === payload.groupId);
      if (!group) {
        return Promise.reject(new Error("找不到開團。"));
      }

      const items = payload.items
        .map((entry) => {
          const item = group.items.find((target) => target.id === entry.itemId);
          const quantity = Math.max(0, Number.parseInt(entry.quantity, 10) || 0);
          if (!item || quantity <= 0) {
            return null;
          }
          return {
            itemId: item.id,
            name: item.name,
            price: item.price,
            quantity,
            subtotal: item.price * quantity,
          };
        })
        .filter(Boolean);

      if (!items.length) {
        return Promise.reject(new Error("請選擇至少一個品項。"));
      }

      group.orders.unshift({
        id: uid("ord"),
        userId: user.id,
        userName: user.displayName,
        total: items.reduce((sum, item) => sum + item.subtotal, 0),
        createdAt: new Date().toISOString(),
        items,
      });

      this.save(data);
      return Promise.resolve({ ok: true });
    }

    updateOrder(payload) {
      const data = this.data();
      const user = this.currentUser();
      const group = data.groups.find((entry) => entry.id === payload.groupId);

      if (!group) {
        return Promise.reject(new Error("找不到開團。"));
      }

      const order = group.orders.find((entry) => entry.id === payload.orderId);
      if (!order) {
        return Promise.reject(new Error("找不到訂單。"));
      }

      if (order.userId !== user.id) {
        return Promise.reject(new Error("只能修改自己的訂單。"));
      }

      const quantityMap = {};
      (payload.items || []).forEach((entry) => {
        const itemId = String(entry.itemId || "").trim();
        const quantity = Math.max(0, Number.parseInt(entry.quantity, 10) || 0);
        if (itemId) {
          quantityMap[itemId] = quantity;
        }
      });

      order.items = order.items
        .map((item) => {
          const quantity = quantityMap[item.itemId] !== undefined ? quantityMap[item.itemId] : Number(item.quantity) || 0;
          if (quantity <= 0) {
            return null;
          }

          item.quantity = quantity;
          item.subtotal = (Number(item.price) || 0) * quantity;
          return item;
        })
        .filter(Boolean);

      if (!order.items.length) {
        group.orders = group.orders.filter((entry) => entry.id !== order.id);
      } else {
        order.total = order.items.reduce((sum, item) => sum + item.subtotal, 0);
      }

      this.save(data);
      return Promise.resolve({ ok: true });
    }

    saveOrders(payload) {
      const data = this.data();
      const user = this.currentUser();
      const group = data.groups.find((entry) => entry.id === payload.groupId);

      if (!group) {
        return Promise.reject(new Error("找不到開團。"));
      }

      (payload.orders || []).forEach((orderPayload) => {
        const order = group.orders.find((entry) => entry.id === orderPayload.orderId);
        if (!order) {
          throw new Error("找不到訂單。");
        }
        if (order.userId !== user.id) {
          throw new Error("只能修改自己的訂單。");
        }

        const quantityMap = {};
        (orderPayload.items || []).forEach((entry) => {
          const itemId = String(entry.itemId || "").trim();
          const quantity = Math.max(0, Number.parseInt(entry.quantity, 10) || 0);
          if (itemId) {
            quantityMap[itemId] = quantity;
          }
        });

        order.items = order.items
          .map((item) => {
            const quantity = quantityMap[item.itemId] !== undefined ? quantityMap[item.itemId] : Number(item.quantity) || 0;
            if (quantity <= 0) {
              return null;
            }

            item.quantity = quantity;
            item.subtotal = (Number(item.price) || 0) * quantity;
            return item;
          })
          .filter(Boolean);

        order.total = order.items.reduce((sum, item) => sum + item.subtotal, 0);
      });

      group.orders = group.orders.filter((order) => order.items.length > 0);
      this.save(data);
      return Promise.resolve({ ok: true });
    }

    ownerGroup(data, groupId) {
      const user = this.currentUser();
      const group = data.groups.find((entry) => entry.id === groupId);
      if (!group) {
        throw new Error("找不到開團。");
      }
      if (group.ownerUserId !== user.id) {
        throw new Error("只有團主可以管理品項。");
      }
      return group;
    }

    syncDemoOrderItems(group, itemId, item) {
      group.orders.forEach((order) => {
        order.items.forEach((orderItem) => {
          if (orderItem.itemId !== itemId) {
            return;
          }

          orderItem.name = item.name;
          orderItem.price = item.price;
          orderItem.subtotal = item.price * orderItem.quantity;
        });
        order.total = order.items.reduce((sum, orderItem) => sum + orderItem.subtotal, 0);
      });
    }

    currentUser() {
      const saved = localStorage.getItem(STORAGE.demoUser);
      if (saved) {
        return JSON.parse(saved);
      }
      return {
        id: "demo_user",
        displayName: "測試使用者",
        pictureUrl: "",
      };
    }

    data() {
      const saved = localStorage.getItem(STORAGE.demoData);
      if (saved) {
        return JSON.parse(saved);
      }

      const seeded = seedDemoData();
      this.save(seeded);
      return seeded;
    }

    save(data) {
      localStorage.setItem(STORAGE.demoData, JSON.stringify(data));
    }
  }

  function seedDemoData() {
    const now = Date.now();
    return {
      groups: [
        {
          id: "grp_lunch",
          name: "週五便當團",
          ownerUserId: "u_mina",
          ownerName: "Mina",
          status: "open",
          createdAt: new Date(now - 1000 * 60 * 36).toISOString(),
          items: [
            { id: "item_chicken", name: "椒麻雞腿飯", price: 120 },
            { id: "item_pork", name: "滷排骨飯", price: 105 },
            { id: "item_veg", name: "蔬食便當", price: 95 },
          ],
          orders: [
            {
              id: "ord_1",
              userId: "u_chen",
              userName: "阿誠",
              total: 225,
              createdAt: new Date(now - 1000 * 60 * 18).toISOString(),
              items: [
                { itemId: "item_chicken", name: "椒麻雞腿飯", price: 120, quantity: 1, subtotal: 120 },
                { itemId: "item_pork", name: "滷排骨飯", price: 105, quantity: 1, subtotal: 105 },
              ],
            },
          ],
        },
        {
          id: "grp_drink",
          name: "下午飲料團",
          ownerUserId: "u_hao",
          ownerName: "Hao",
          status: "open",
          createdAt: new Date(now - 1000 * 60 * 92).toISOString(),
          items: [
            { id: "item_tea", name: "四季春", price: 35 },
            { id: "item_milk", name: "珍珠鮮奶茶", price: 65 },
            { id: "item_coffee", name: "黑咖啡", price: 55 },
          ],
          orders: [],
        },
      ],
    };
  }
})();
