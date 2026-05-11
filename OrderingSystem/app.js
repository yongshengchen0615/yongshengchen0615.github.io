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
    detailMode: "orders",
    loadingCount: 0,
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
    const stopLoading = showLoading("正在登入並讀取團購資料", "載入中");

    try {
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
    } finally {
      stopLoading();
    }
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
    els.emptyDetailBackButton = document.querySelector("#emptyDetailBackButton");
    els.groupDetail = document.querySelector("#groupDetail");
    els.detailBackButton = document.querySelector("#detailBackButton");
    els.detailOwner = document.querySelector("#detailOwner");
    els.detailTitle = document.querySelector("#detailTitle");
    els.detailStatus = document.querySelector("#detailStatus");
    els.detailItemCount = document.querySelector("#detailItemCount");
    els.detailOrderCount = document.querySelector("#detailOrderCount");
    els.detailTotal = document.querySelector("#detailTotal");
    els.ownerDetailTabs = document.querySelector("#ownerDetailTabs");
    els.ownerDetailButtons = [...document.querySelectorAll("[data-owner-detail]")];
    els.ownerTools = document.querySelector("#ownerTools");
    els.ownerAddOptionGroupButton = document.querySelector("#ownerAddOptionGroupButton");
    els.ownerOptionBankList = document.querySelector("#ownerOptionBankList");
    els.ownerAddDraftButton = document.querySelector("#ownerAddDraftButton");
    els.ownerSaveItemsButton = document.querySelector("#ownerSaveItemsButton");
    els.ownerItemList = document.querySelector("#ownerItemList");
    els.detailOrderWorkspace = document.querySelector("#detailOrderWorkspace");
    els.joinGroupForm = document.querySelector("#joinGroupForm");
    els.quantityList = document.querySelector("#quantityList");
    els.selectionList = document.querySelector("#selectionList");
    els.selectionEmpty = document.querySelector("#selectionEmpty");
    els.selectionTotal = document.querySelector("#selectionTotal");
    els.orderSectionTitle = document.querySelector("#orderSectionTitle");
    els.saveOrdersButton = document.querySelector("#saveOrdersButton");
    els.orderList = document.querySelector("#orderList");
    els.loadingOverlay = document.querySelector("#loadingOverlay");
    els.loadingTitle = document.querySelector("#loadingTitle");
    els.loadingMessage = document.querySelector("#loadingMessage");
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
      withBusy(event.currentTarget, handleDemoLogin, "正在建立測試登入");
    });
    els.navButtons.forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });
    els.addItemButton.addEventListener("click", () => addCreateItemRow());
    els.resetCreateButton.addEventListener("click", resetCreateForm);
    els.emptyDetailBackButton.addEventListener("click", showBrowseView);
    els.detailBackButton.addEventListener("click", showBrowseView);
    els.ownerDetailButtons.forEach((button) => {
      button.addEventListener("click", () => setOwnerDetailMode(button.dataset.ownerDetail));
    });
    els.createGroupForm.addEventListener("submit", handleCreateGroup);
    els.ownerAddOptionGroupButton.addEventListener("click", handleAddOwnerOptionGroup);
    els.ownerOptionBankList.addEventListener("click", handleOwnerOptionBankAction);
    els.ownerOptionBankList.addEventListener("input", syncOwnerItemOptionPickers);
    els.ownerAddDraftButton.addEventListener("click", () => addOwnerItemRow());
    els.ownerSaveItemsButton.addEventListener("click", handleSaveOwnerItems);
    els.ownerItemList.addEventListener("click", handleOwnerItemAction);
    els.ownerItemList.addEventListener("change", handleOwnerItemChange);
    els.joinGroupForm.addEventListener("submit", handleJoinGroup);
    els.quantityList.addEventListener("click", handleQuantityClick);
    els.quantityList.addEventListener("input", updateSubtotal);
    els.quantityList.addEventListener("change", updateSubtotal);
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

    els.mainNav.classList.toggle("is-detail-mode", state.view === "detail");

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

    renderOwnerDetailMode(group);
    renderOwnerTools(group);
    renderQuantityRows(group);
    renderOrders(group);
    updateSubtotal();
  }

  function renderOwnerDetailMode(group) {
    const isOwner = Boolean(group && group.isOwner);
    if (!isOwner) {
      state.detailMode = "orders";
    }

    const mode = state.detailMode === "items" && isOwner ? "items" : "orders";
    state.detailMode = mode;

    els.ownerDetailTabs.classList.toggle("hidden", !isOwner);
    els.ownerTools.classList.toggle("hidden", !isOwner || mode !== "items");
    els.detailOrderWorkspace.classList.toggle("hidden", isOwner && mode !== "orders");

    els.ownerDetailButtons.forEach((button) => {
      const active = button.dataset.ownerDetail === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.setAttribute("tabindex", active ? "0" : "-1");
    });
  }

  function renderOwnerTools(group) {
    els.ownerItemList.replaceChildren();
    const optionBank = ownerOptionBankGroups(group.items || []);
    renderOwnerOptionBank(optionBank);

    if (!group.isOwner) {
      return;
    }

    if (!group.items.length) {
      els.ownerItemList.appendChild(emptyState("尚未建立品項，按新增品項加入"));
      return;
    }

    const fragment = document.createDocumentFragment();
    group.items.forEach((item) => {
      fragment.appendChild(buildOwnerItemRow(item, optionBank));
    });

    els.ownerItemList.appendChild(fragment);
  }

  function addOwnerItemRow(item = {}) {
    const empty = els.ownerItemList.querySelector(".empty-state");
    if (empty) {
      empty.remove();
    }

    const node = buildOwnerItemRow(item, collectOwnerOptionBank(false).options);
    els.ownerItemList.appendChild(node);
    node.querySelector(".owner-item-name").focus();
  }

  function buildOwnerItemRow(item = {}, optionBank = []) {
    const node = els.ownerItemTemplate.content.firstElementChild.cloneNode(true);
    const selectedIds = new Set(normalizeOptionGroups(item.options || []).map((group) => group.id));
    if (item.id) {
      node.dataset.itemId = item.id;
    }
    node.querySelector(".owner-item-name").value = item.name || "";
    node.querySelector(".owner-item-price").value = item.price !== undefined ? String(item.price) : "";
    renderOwnerItemOptionPicker(node, selectedIds, optionBank);
    return node;
  }

  function renderOwnerOptionBank(optionGroups) {
    const normalized = normalizeOptionGroups(optionGroups);
    els.ownerOptionBankList.replaceChildren();

    if (!normalized.length) {
      els.ownerOptionBankList.appendChild(emptyState("尚未建立品項細項"));
      return;
    }

    normalized.forEach((group) => {
      els.ownerOptionBankList.appendChild(buildOwnerOptionGroup(group));
    });
  }

  function renderOwnerItemOptionPicker(row, selectedIds, optionBank = collectOwnerOptionBank().options) {
    const normalized = normalizeOptionGroups(optionBank);
    const toggle = row.querySelector(".owner-item-has-options");
    const picker = row.querySelector(".owner-item-option-picker");
    const enabled = toggle.checked || selectedIds.size > 0;

    toggle.checked = enabled;
    picker.classList.toggle("hidden", !enabled);
    picker.replaceChildren();

    if (!normalized.length) {
      picker.appendChild(emptyState("尚未建立可套用的品項細項"));
      return;
    }

    const list = document.createElement("div");
    list.className = "owner-option-apply-list";
    normalized.forEach((group) => {
      const label = document.createElement("label");
      label.className = "owner-option-apply";

      const input = document.createElement("input");
      input.className = "owner-option-bank-choice";
      input.type = "checkbox";
      input.value = group.id;
      input.checked = selectedIds.has(group.id);

      const text = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = group.name;
      const summary = document.createElement("small");
      summary.textContent = formatOptionGroupSummary(group);
      text.append(name, summary);

      label.append(input, text);
      list.appendChild(label);
    });
    picker.appendChild(list);
  }

  function buildOwnerOptionGroup(group = {}) {
    const node = document.createElement("div");
    node.className = "owner-option-group";
    node.dataset.optionId = group.id || uid("opt");

    const head = document.createElement("div");
    head.className = "owner-option-group-head";

    const name = document.createElement("input");
    name.className = "owner-option-group-name";
    name.type = "text";
    name.maxLength = 24;
    name.placeholder = "細項名稱，例如：甜度、冰塊、加購";
    name.setAttribute("aria-label", "細項名稱");
    name.value = group.name || "";

    const remove = document.createElement("button");
    remove.className = "icon-button delete-owner-option-group";
    remove.type = "button";
    remove.title = "刪除細項";
    remove.setAttribute("aria-label", "刪除細項");
    remove.textContent = "×";

    const choices = document.createElement("div");
    choices.className = "owner-option-choice-list";
    (group.choices && group.choices.length ? group.choices : [{}]).forEach((choice) => {
      choices.appendChild(buildOwnerOptionChoice(choice));
    });

    const addChoice = document.createElement("button");
    addChoice.className = "text-button add-owner-option-choice";
    addChoice.type = "button";
    addChoice.textContent = "新增加價選項";

    head.append(name, remove);
    node.append(head, choices, addChoice);
    return node;
  }

  function buildOwnerOptionChoice(choice = {}) {
    const node = document.createElement("div");
    node.className = "owner-option-choice";
    node.dataset.choiceId = choice.id || uid("choice");

    const name = document.createElement("input");
    name.className = "owner-option-choice-name";
    name.type = "text";
    name.maxLength = 24;
    name.placeholder = "選項名稱";
    name.setAttribute("aria-label", "選項名稱");
    name.value = choice.name || "";

    const price = document.createElement("input");
    price.className = "owner-option-choice-price";
    price.type = "number";
    price.min = "0";
    price.step = "1";
    price.inputMode = "numeric";
    price.placeholder = "加價";
    price.setAttribute("aria-label", "選項加價");
    price.value = choice.price ? String(choice.price) : "";

    const remove = document.createElement("button");
    remove.className = "icon-button delete-owner-option-choice";
    remove.type = "button";
    remove.title = "刪除選項";
    remove.setAttribute("aria-label", "刪除選項");
    remove.textContent = "×";

    node.append(name, price, remove);
    return node;
  }

  function ownerOptionBankGroups(items) {
    const groups = [];
    const byId = new Map();

    (items || []).forEach((item) => {
      normalizeOptionGroups(item.options || []).forEach((group) => {
        const id = group.id || optionId(group.name, groups.length);
        const existing = byId.get(id);
        if (existing) {
          mergeOptionGroup(existing, group);
          return;
        }

        const cloned = cloneOptionGroup({ ...group, id });
        byId.set(id, cloned);
        groups.push(cloned);
      });
    });

    return groups;
  }

  function mergeOptionGroup(target, source) {
    const existingChoices = new Set(target.choices.map((choice) => `${choice.id}:${choice.name}:${choice.price}`));
    source.choices.forEach((choice) => {
      const key = `${choice.id}:${choice.name}:${choice.price}`;
      if (!existingChoices.has(key)) {
        target.choices.push({ ...choice });
        existingChoices.add(key);
      }
    });
  }

  function cloneOptionGroup(group) {
    return {
      id: group.id,
      name: group.name,
      choices: (group.choices || []).map((choice) => ({ ...choice })),
    };
  }

  function formatOptionGroupSummary(group) {
    return (group.choices || [])
      .map((choice) => (choice.price > 0 ? `${choice.name} +${formatMoney(choice.price)}` : choice.name))
      .join("、");
  }

  function ownerItemOptionSelections(row) {
    return new Set(
      [...row.querySelectorAll(".owner-option-bank-choice:checked")]
        .map((input) => input.value)
        .filter(Boolean)
    );
  }

  function syncOwnerItemOptionPickers() {
    const optionBank = collectOwnerOptionBank(false).options;
    els.ownerItemList.querySelectorAll(".owner-item-row").forEach((row) => {
      renderOwnerItemOptionPicker(row, ownerItemOptionSelections(row), optionBank);
    });
  }

  function renderQuantityRows(group) {
    els.quantityList.replaceChildren();

    if (!state.user) {
      els.quantityList.appendChild(emptyState("請先登入再加入開團"));
      return;
    }

    const fragment = document.createDocumentFragment();
    group.items.forEach((item) => {
      fragment.appendChild(buildQuantityRow(item));
    });

    els.quantityList.appendChild(fragment);
  }

  function buildQuantityRow(item, isVariant = false) {
    const node = els.quantityRowTemplate.content.firstElementChild.cloneNode(true);
    const input = node.querySelector("input");
    const options = normalizeOptionGroups(item.options || []);
    node.dataset.itemId = item.id;
    node.dataset.name = item.name;
    node.dataset.price = String(item.price);
    input.dataset.itemId = item.id;
    input.dataset.name = item.name;
    input.dataset.price = String(item.price);
    node.querySelector(".quantity-name").textContent = item.name;
    node.querySelector(".quantity-price").textContent = `${formatMoney(item.price)} 起`;
    renderQuantityOptions(node.querySelector(".quantity-options"), options);
    node.querySelector(".add-quantity-variant").classList.toggle("hidden", !options.length);
    node.querySelector(".remove-quantity-variant").classList.toggle("hidden", !isVariant);
    return node;
  }

  function renderQuantityOptions(container, optionGroups) {
    container.replaceChildren();
    if (!optionGroups.length) {
      container.classList.add("hidden");
      return;
    }

    container.classList.remove("hidden");
    optionGroups.forEach((group) => {
      const label = document.createElement("label");
      label.className = "quantity-option-field";

      const title = document.createElement("span");
      title.textContent = group.name;

      const select = document.createElement("select");
      select.className = "quantity-option-select";
      select.dataset.groupId = group.id;
      select.dataset.groupName = group.name;

      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "不選擇";
      select.appendChild(empty);

      group.choices.forEach((choice) => {
        const option = document.createElement("option");
        option.value = choice.id;
        option.dataset.choiceName = choice.name;
        option.dataset.price = String(choice.price);
        option.textContent = choice.price > 0 ? `${choice.name} +${formatMoney(choice.price)}` : choice.name;
        select.appendChild(option);
      });

      label.append(title, select);
      container.appendChild(label);
    });
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
        .map((item) => `${formatOrderItemLabel(item)} × ${item.quantity}`)
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
      row.dataset.entryId = item.entryId || "";
      row.dataset.itemId = item.itemId;

      const meta = document.createElement("div");
      meta.className = "order-edit-meta";

      const name = document.createElement("strong");
      name.textContent = formatOrderItemLabel(item);

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
    state.detailMode = "orders";
    renderGroups();
    renderDetail();
    setView("detail");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setOwnerDetailMode(mode) {
    if (!["orders", "items"].includes(mode)) {
      return;
    }

    const group = selectedGroup();
    if (!group || !group.isOwner) {
      return;
    }

    state.detailMode = mode;
    renderOwnerDetailMode(group);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showBrowseView() {
    setView("browse");
    window.scrollTo({ top: 0, behavior: "smooth" });
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
    }, "正在登入 LINE");
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
        state.detailMode = "orders";
        state.view = "detail";
        renderApp();
      }
      showToast("開團已建立。");
    }, "正在儲存開團資料");
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

  function handleAddOwnerOptionGroup() {
    const empty = els.ownerOptionBankList.querySelector(".empty-state");
    if (empty) {
      empty.remove();
    }

    const node = buildOwnerOptionGroup();
    els.ownerOptionBankList.appendChild(node);
    syncOwnerItemOptionPickers();
    node.querySelector(".owner-option-group-name").focus();
  }

  function handleOwnerOptionBankAction(event) {
    const deleteOptionGroupButton = event.target.closest(".delete-owner-option-group");
    if (deleteOptionGroupButton) {
      const group = deleteOptionGroupButton.closest(".owner-option-group");
      if (group) {
        group.remove();
        if (!els.ownerOptionBankList.querySelector(".owner-option-group")) {
          els.ownerOptionBankList.appendChild(emptyState("尚未建立品項細項"));
        }
        syncOwnerItemOptionPickers();
      }
      return;
    }

    const addOptionChoiceButton = event.target.closest(".add-owner-option-choice");
    if (addOptionChoiceButton) {
      const group = addOptionChoiceButton.closest(".owner-option-group");
      const list = group && group.querySelector(".owner-option-choice-list");
      if (list) {
        list.appendChild(buildOwnerOptionChoice());
        syncOwnerItemOptionPickers();
        list.lastElementChild.querySelector(".owner-option-choice-name").focus();
      }
      return;
    }

    const deleteOptionChoiceButton = event.target.closest(".delete-owner-option-choice");
    if (deleteOptionChoiceButton) {
      const choice = deleteOptionChoiceButton.closest(".owner-option-choice");
      if (choice) {
        choice.remove();
        syncOwnerItemOptionPickers();
      }
    }
  }

  function handleOwnerItemChange(event) {
    const toggle = event.target.closest(".owner-item-has-options");
    if (!toggle) {
      return;
    }

    const row = toggle.closest(".owner-item-row");
    const picker = row && row.querySelector(".owner-item-option-picker");
    if (!picker) {
      return;
    }

    picker.classList.toggle("hidden", !toggle.checked);
    if (toggle.checked) {
      renderOwnerItemOptionPicker(row, ownerItemOptionSelections(row), collectOwnerOptionBank(false).options);
    }
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
    }, "正在儲存品項與細項設定");
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

    const items = selectedQuantityItems().map((item) => ({
      itemId: item.itemId,
      quantity: item.quantity,
      options: item.options,
    }));

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
    }, "正在送出訂單");
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
    }, "正在儲存訂單變更");
  }

  function handleQuantityClick(event) {
    const addVariantButton = event.target.closest(".add-quantity-variant");
    if (addVariantButton) {
      const row = addVariantButton.closest(".quantity-row");
      const group = selectedGroup();
      const item = group && group.items.find((entry) => entry.id === row.dataset.itemId);
      if (row && item) {
        row.after(buildQuantityRow(item, true));
        updateSubtotal();
      }
      return;
    }

    const removeVariantButton = event.target.closest(".remove-quantity-variant");
    if (removeVariantButton) {
      const row = removeVariantButton.closest(".quantity-row");
      if (row) {
        row.remove();
        updateSubtotal();
      }
      return;
    }

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
    const items = selectedQuantityItems();
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);

    els.selectionTotal.textContent = formatMoney(total);
    els.selectionEmpty.classList.toggle("hidden", items.length > 0);
    els.selectionList.replaceChildren();

    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "selection-row";

      const meta = document.createElement("div");
      meta.className = "selection-meta";

      const name = document.createElement("strong");
      name.textContent = `${item.name} × ${item.quantity}`;

      const detail = document.createElement("span");
      const optionsText = formatSelectedOptions(item.options);
      detail.textContent = optionsText
        ? `${optionsText} · ${formatMoney(item.unitPrice)} / 份`
        : `${formatMoney(item.unitPrice)} / 份`;

      const subtotal = document.createElement("span");
      subtotal.className = "selection-subtotal";
      subtotal.textContent = formatMoney(item.subtotal);

      meta.append(name, detail);
      row.append(meta, subtotal);
      fragment.appendChild(row);
    });

    els.selectionList.appendChild(fragment);
  }

  function selectedQuantityItems() {
    const selectedMap = new Map();

    [...els.quantityList.querySelectorAll(".quantity-row")].forEach((row) => {
      const input = row.querySelector("input");
      if (!input) {
        return;
      }

      const quantity = Math.max(0, Number.parseInt(input.value, 10) || 0);
      if (quantity <= 0) {
        return;
      }

      const basePrice = Number(row.dataset.price) || 0;
      const options = selectedRowOptions(row);
      const unitPrice = basePrice + options.reduce((sum, option) => sum + option.price, 0);
      const item = {
        itemId: row.dataset.itemId,
        name: row.dataset.name || "品項",
        price: basePrice,
        unitPrice,
        options,
        optionKey: optionSignature(options),
        quantity,
        subtotal: unitPrice * quantity,
      };
      const key = `${item.itemId}::${item.optionKey}`;
      const existing = selectedMap.get(key);
      if (existing) {
        existing.quantity += item.quantity;
        existing.subtotal += item.subtotal;
        return;
      }
      selectedMap.set(key, item);
    });

    return [...selectedMap.values()];
  }

  function selectedRowOptions(row) {
    return [...row.querySelectorAll(".quantity-option-select")]
      .map((select) => {
        const selected = select.selectedOptions[0];
        if (!selected || !selected.value) {
          return null;
        }
        return {
          groupId: select.dataset.groupId,
          groupName: select.dataset.groupName,
          choiceId: selected.value,
          choiceName: selected.dataset.choiceName || selected.textContent,
          price: Number(selected.dataset.price) || 0,
        };
      })
      .filter(Boolean);
  }

  function optionSignature(options) {
    return normalizeSelectedOptions(options)
      .map((option) => `${option.groupId}:${option.choiceId}:${option.price}`)
      .join("|");
  }

  function normalizeSelectedOptions(options) {
    if (!Array.isArray(options)) {
      return [];
    }

    return options
      .map((option) => ({
        groupId: String(option.groupId || "").trim(),
        groupName: String(option.groupName || "").trim(),
        choiceId: String(option.choiceId || "").trim(),
        choiceName: String(option.choiceName || "").trim(),
        price: Number(option.price) || 0,
      }))
      .filter((option) => option.groupName && option.choiceName);
  }

  function syncSelectedOptionsToItemOptions(options, itemOptionGroups) {
    const groups = normalizeOptionGroups(itemOptionGroups || []);
    const groupMap = new Map();
    groups.forEach((group) => {
      groupMap.set(group.id, {
        group,
        choices: new Map(group.choices.map((choice) => [choice.id, choice])),
      });
    });

    return normalizeSelectedOptions(options)
      .map((option) => {
        const matchedGroup = groupMap.get(option.groupId);
        const matchedChoice = matchedGroup && matchedGroup.choices.get(option.choiceId);
        if (matchedGroup && matchedChoice) {
          return {
            groupId: matchedGroup.group.id,
            groupName: matchedGroup.group.name,
            choiceId: matchedChoice.id,
            choiceName: matchedChoice.name,
            price: matchedChoice.price,
          };
        }

        return groups.length ? null : option;
      })
      .filter(Boolean);
  }

  function formatSelectedOptions(options) {
    return normalizeSelectedOptions(options)
      .map((option) => (option.price > 0 ? `${option.choiceName} +${formatMoney(option.price)}` : option.choiceName))
      .join("、");
  }

  function formatOrderItemLabel(item) {
    const optionsText = formatSelectedOptions(item.options);
    return optionsText ? `${item.name}（${optionsText}）` : item.name;
  }

  function normalizeOptionGroups(groups) {
    if (!Array.isArray(groups)) {
      return [];
    }

    return groups
      .map((group, groupIndex) => {
        const name = String(group.name || "").trim().slice(0, 24);
        const choices = Array.isArray(group.choices) ? group.choices : [];
        return {
          id: String(group.id || optionId(name, groupIndex)).trim(),
          name,
          choices: choices
            .map((choice, choiceIndex) => {
              const choiceName = String(choice.name || "").trim().slice(0, 24);
              const price = Math.max(0, Number(choice.price) || 0);
              return {
                id: String(choice.id || optionId(choiceName, choiceIndex)).trim(),
                name: choiceName,
                price,
              };
            })
            .filter((choice) => choice.name),
        };
      })
      .filter((group) => group.name && group.choices.length);
  }

  function optionId(name, index) {
    const normalized = String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return normalized ? `opt_${normalized}` : `opt_${index}`;
  }

  function collectOrderEditItems(orderNode) {
    return [...orderNode.querySelectorAll(".order-edit-row")].map((row) => ({
      entryId: row.dataset.entryId || "",
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
    const optionBankResult = collectOwnerOptionBank();
    const optionById = new Map(optionBankResult.options.map((group) => [group.id, group]));
    const items = [];
    let invalid = optionBankResult.invalid;

    rows.forEach((row) => {
      const nameInput = row.querySelector(".owner-item-name");
      const priceInput = row.querySelector(".owner-item-price");
      const hasOptions = row.querySelector(".owner-item-has-options").checked;
      const name = nameInput.value.trim();
      const priceText = priceInput.value.trim();
      const optionsResult = hasOptions ? collectOwnerAppliedOptionGroups(row, optionById) : { options: [], invalid: false };

      if (!row.dataset.itemId && !name && !priceText && !hasOptions) {
        return;
      }

      const item = {
        id: row.dataset.itemId || "",
        name,
        price: Number(priceText),
        options: optionsResult.options,
      };

      if (!isValidItem(item) || optionsResult.invalid) {
        invalid = true;
        row.classList.add("is-invalid");
        return;
      }

      row.classList.remove("is-invalid");
      items.push(item);
    });

    if (invalid) {
      showToast("請確認品項、細項與加價選項都已完整填寫。", "error");
      return null;
    }

    return items;
  }

  function collectOwnerAppliedOptionGroups(row, optionById) {
    const selectedIds = ownerItemOptionSelections(row);
    const options = [...selectedIds].map((id) => optionById.get(id)).filter(Boolean).map(cloneOptionGroup);

    return {
      options,
      invalid: selectedIds.size === 0 || options.length !== selectedIds.size,
    };
  }

  function collectOwnerOptionBank(markInvalid = true) {
    return collectOwnerOptionGroups(els.ownerOptionBankList, {
      markInvalid,
      requireGroups: false,
    });
  }

  function collectOwnerOptionGroups(container, settings = {}) {
    const markInvalid = settings.markInvalid !== false;
    const requireGroups = Boolean(settings.requireGroups);
    const groups = [];
    let invalid = false;

    container.querySelectorAll(".owner-option-group").forEach((groupNode, groupIndex) => {
      const nameInput = groupNode.querySelector(".owner-option-group-name");
      const name = nameInput.value.trim();
      const choices = [];

      groupNode.querySelectorAll(".owner-option-choice").forEach((choiceNode, choiceIndex) => {
        const choiceNameInput = choiceNode.querySelector(".owner-option-choice-name");
        const choicePriceInput = choiceNode.querySelector(".owner-option-choice-price");
        const choiceName = choiceNameInput.value.trim();
        const priceText = choicePriceInput.value.trim();

        if (!choiceName && !priceText) {
          return;
        }

        const price = Number(priceText || 0);
        if (!choiceName || !Number.isFinite(price) || price < 0) {
          invalid = true;
          choiceNode.classList.toggle("is-invalid", markInvalid);
          return;
        }

        if (markInvalid) {
          choiceNode.classList.remove("is-invalid");
        }
        choices.push({
          id: choiceNode.dataset.choiceId || optionId(choiceName, choiceIndex),
          name: choiceName,
          price,
        });
      });

      if (!name && !choices.length) {
        return;
      }

      if (!name || !choices.length) {
        invalid = true;
        groupNode.classList.toggle("is-invalid", markInvalid);
        return;
      }

      if (markInvalid) {
        groupNode.classList.remove("is-invalid");
      }
      groups.push({
        id: groupNode.dataset.optionId || optionId(name, groupIndex),
        name,
        choices,
      });
    });

    if (requireGroups && !groups.length) {
      invalid = true;
    }

    return {
      options: groups,
      invalid,
    };
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

  async function withBusy(button, task, loadingMessage = "") {
    if (button) {
      button.disabled = true;
    }
    const stopLoading = loadingMessage ? showLoading(loadingMessage, "處理中") : null;
    try {
      await task();
    } catch (error) {
      showToast(error.message || "操作失敗。", "error");
    } finally {
      if (stopLoading) {
        stopLoading();
      }
      if (button) {
        button.disabled = false;
      }
    }
  }

  function showLoading(message = "處理中，請稍候", title = "處理中") {
    state.loadingCount += 1;
    setLoadingContent(message, title);
    setLoadingVisible(true);

    let closed = false;
    return () => {
      if (closed) {
        return;
      }
      closed = true;
      state.loadingCount = Math.max(0, state.loadingCount - 1);
      if (state.loadingCount === 0) {
        setLoadingVisible(false);
      }
    };
  }

  function setLoadingContent(message, title) {
    if (els.loadingTitle) {
      els.loadingTitle.textContent = title;
    }
    if (els.loadingMessage) {
      els.loadingMessage.textContent = message;
    }
  }

  function setLoadingVisible(visible) {
    if (!els.loadingOverlay) {
      return;
    }
    els.loadingOverlay.classList.toggle("is-visible", visible);
    els.loadingOverlay.setAttribute("aria-busy", visible ? "true" : "false");
    document.body.classList.toggle("is-loading", visible);
  }

  function selectedGroup() {
    return state.groups.find((group) => group.id === state.selectedGroupId) || null;
  }

  function normalizeGroup(group) {
    const items = (group.items || []).map((item) => ({
      ...item,
      price: Number(item.price) || 0,
      options: normalizeOptionGroups(item.options || []),
    }));

    const orders = (group.orders || [])
      .map((order) => {
        const orderItems = (order.items || []).map((item) => ({
          ...item,
          entryId: item.entryId || item.id || "",
          options: normalizeSelectedOptions(item.options || []),
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
          options: normalizeOptionGroups(item.options || []),
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
        options: normalizeOptionGroups(payload.item.options || []),
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
      item.options = normalizeOptionGroups(payload.item.options || []);
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
          options: normalizeOptionGroups(entry.options || []),
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
          existing.options = item.options;
          keepIds.add(id);
          nextItems.push(existing);
          this.syncDemoOrderItems(group, id, existing);
          return;
        }

        nextItems.push({
          id: uid("item"),
          name: item.name,
          price: item.price,
          options: item.options,
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

      const selectedMap = new Map();
      (payload.items || []).forEach((entry) => {
        const item = group.items.find((target) => target.id === entry.itemId);
        const quantity = Math.max(0, Number.parseInt(entry.quantity, 10) || 0);
        if (!item || quantity <= 0) {
          return;
        }
        const options = syncSelectedOptionsToItemOptions(entry.options || [], item.options || []);
        const optionExtra = options.reduce((sum, option) => sum + option.price, 0);
        const unitPrice = (Number(item.price) || 0) + optionExtra;
        const key = `${item.id}::${optionSignature(options)}`;
        const selected = selectedMap.get(key) || {
          id: uid("oi"),
          itemId: item.id,
          name: item.name,
          options,
          price: unitPrice,
          quantity: 0,
          subtotal: 0,
        };
        selected.quantity += quantity;
        selected.subtotal += unitPrice * quantity;
        selectedMap.set(key, selected);
      });
      const items = [...selectedMap.values()];

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

      const quantityByEntry = {};
      const quantityByItem = {};
      (payload.items || []).forEach((entry) => {
        const entryId = String(entry.entryId || "").trim();
        const itemId = String(entry.itemId || "").trim();
        const quantity = Math.max(0, Number.parseInt(entry.quantity, 10) || 0);
        if (entryId) {
          quantityByEntry[entryId] = quantity;
        }
        if (itemId) {
          quantityByItem[itemId] = quantity;
        }
      });

      order.items = order.items
        .map((item) => {
          const quantity =
            item.id && quantityByEntry[item.id] !== undefined
              ? quantityByEntry[item.id]
              : quantityByItem[item.itemId] !== undefined
                ? quantityByItem[item.itemId]
                : Number(item.quantity) || 0;
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

        const quantityByEntry = {};
        const quantityByItem = {};
        (orderPayload.items || []).forEach((entry) => {
          const entryId = String(entry.entryId || "").trim();
          const itemId = String(entry.itemId || "").trim();
          const quantity = Math.max(0, Number.parseInt(entry.quantity, 10) || 0);
          if (entryId) {
            quantityByEntry[entryId] = quantity;
          }
          if (itemId) {
            quantityByItem[itemId] = quantity;
          }
        });

        order.items = order.items
          .map((item) => {
            const quantity =
              item.id && quantityByEntry[item.id] !== undefined
                ? quantityByEntry[item.id]
                : quantityByItem[item.itemId] !== undefined
                  ? quantityByItem[item.itemId]
                  : Number(item.quantity) || 0;
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
          orderItem.options = syncSelectedOptionsToItemOptions(orderItem.options || [], item.options || []);
          orderItem.price = item.price + orderItem.options.reduce((sum, option) => sum + option.price, 0);
          orderItem.subtotal = orderItem.price * orderItem.quantity;
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
            {
              id: "item_chicken",
              name: "椒麻雞腿飯",
              price: 120,
              options: [{ id: "opt_addon", name: "加購", choices: [{ id: "opt_rice", name: "加飯", price: 10 }] }],
            },
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
                { id: "oi_demo_chicken", itemId: "item_chicken", name: "椒麻雞腿飯", price: 120, quantity: 1, subtotal: 120 },
                { id: "oi_demo_pork", itemId: "item_pork", name: "滷排骨飯", price: 105, quantity: 1, subtotal: 105 },
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
            {
              id: "item_tea",
              name: "四季春",
              price: 35,
              options: [
                { id: "opt_sugar", name: "甜度", choices: [{ id: "sugar_normal", name: "正常", price: 0 }, { id: "sugar_less", name: "少糖", price: 0 }, { id: "sugar_none", name: "無糖", price: 0 }] },
                { id: "opt_ice", name: "冰塊", choices: [{ id: "ice_normal", name: "正常冰", price: 0 }, { id: "ice_less", name: "少冰", price: 0 }, { id: "ice_none", name: "去冰", price: 0 }] },
              ],
            },
            {
              id: "item_milk",
              name: "珍珠鮮奶茶",
              price: 65,
              options: [
                { id: "opt_sugar", name: "甜度", choices: [{ id: "sugar_normal", name: "正常", price: 0 }, { id: "sugar_half", name: "半糖", price: 0 }, { id: "sugar_none", name: "無糖", price: 0 }] },
                { id: "opt_addon", name: "加料", choices: [{ id: "addon_pearl", name: "珍珠加量", price: 10 }, { id: "addon_pudding", name: "布丁", price: 15 }] },
              ],
            },
            { id: "item_coffee", name: "黑咖啡", price: 55 },
          ],
          orders: [],
        },
      ],
    };
  }
})();
