(() => {
  const CONFIG_DEFAULTS = {
    gasWebAppUrl: "",
    demoMode: true,
  };

  const STORAGE = {
    session: "orderingSystem.session",
    demoData: "orderingSystem.demoData",
    demoUser: "orderingSystem.demoUser",
  };

  const state = {
    api: null,
    config: { ...CONFIG_DEFAULTS },
    user: null,
    session: "",
    groups: [],
    selectedGroupId: "",
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

    state.config = await loadConfig();
    state.api = state.config.gasWebAppUrl ? new GasApi(state.config.gasWebAppUrl) : new DemoApi();

    readLoginCallback();
    renderConfigStatus();

    if (state.session) {
      await restoreSession();
    }

    renderSession();
    await refreshGroups();
  }

  function cacheElements() {
    els.sessionArea = document.querySelector("#sessionArea");
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
    els.joinGroupForm = document.querySelector("#joinGroupForm");
    els.quantityList = document.querySelector("#quantityList");
    els.joinSubtotal = document.querySelector("#joinSubtotal");
    els.orderList = document.querySelector("#orderList");
    els.toast = document.querySelector("#toast");
    els.itemRowTemplate = document.querySelector("#itemRowTemplate");
    els.groupCardTemplate = document.querySelector("#groupCardTemplate");
    els.quantityRowTemplate = document.querySelector("#quantityRowTemplate");
    els.orderRowTemplate = document.querySelector("#orderRowTemplate");
    els.filterButtons = [...document.querySelectorAll("[data-filter]")];
  }

  function bindStaticEvents() {
    els.loginButton.addEventListener("click", handleLogin);
    els.heroLoginButton.addEventListener("click", handleLogin);
    els.demoLoginButton.addEventListener("click", handleDemoLogin);
    els.addItemButton.addEventListener("click", () => addCreateItemRow());
    els.resetCreateButton.addEventListener("click", resetCreateForm);
    els.createGroupForm.addEventListener("submit", handleCreateGroup);
    els.joinGroupForm.addEventListener("submit", handleJoinGroup);
    els.quantityList.addEventListener("click", handleQuantityClick);
    els.quantityList.addEventListener("input", updateSubtotal);
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

    return {
      ...CONFIG_DEFAULTS,
      ...fileConfig,
      ...inlineConfig,
      gasWebAppUrl: String(fileConfig.gasWebAppUrl || inlineConfig.gasWebAppUrl || "").trim(),
    };
  }

  function readLoginCallback() {
    const url = new URL(window.location.href);
    const session = url.searchParams.get("session");
    const loginError = url.searchParams.get("login_error");

    if (session) {
      state.session = session;
      localStorage.setItem(STORAGE.session, session);
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
      state.session = "";
      state.user = null;
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
  }

  function renderConfigStatus() {
    els.configStatus.textContent = state.config.gasWebAppUrl ? "GAS Live" : "Demo";
    els.configStatus.classList.toggle("live", Boolean(state.config.gasWebAppUrl));
    els.demoLoginButton.classList.toggle("hidden", Boolean(state.config.gasWebAppUrl));
  }

  function renderSession() {
    els.loginPanel.classList.toggle("hidden", Boolean(state.user));
    els.createPanel.classList.toggle("hidden", !state.user);

    const status = els.configStatus;
    els.sessionArea.replaceChildren(status);

    if (!state.user) {
      els.sessionArea.appendChild(els.loginButton);
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
      node.querySelector(".meta-orders").textContent = `${group.stats.orders} 筆訂單`;
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

    renderQuantityRows(group);
    renderOrders(group);
    updateSubtotal();
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

    if (!group.orders.length) {
      els.orderList.appendChild(emptyState("尚未有人下單"));
      return;
    }

    const fragment = document.createDocumentFragment();
    group.orders.slice(0, 8).forEach((order) => {
      const node = els.orderRowTemplate.content.firstElementChild.cloneNode(true);
      node.querySelector(".order-user").textContent = order.userName;
      node.querySelector(".order-items").textContent = order.items
        .map((item) => `${item.name} × ${item.quantity}`)
        .join("、");
      node.querySelector(".order-total").textContent = formatMoney(order.total);
      fragment.appendChild(node);
    });

    els.orderList.appendChild(fragment);
  }

  function selectGroup(groupId) {
    state.selectedGroupId = groupId;
    renderGroups();
    renderDetail();
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
      handleDemoLogin();
      return;
    }

    await withBusy(event.currentTarget, async () => {
      const authUrl = await state.api.loginUrl(frontendUrl());
      window.location.href = authUrl;
    });
  }

  function handleDemoLogin() {
    const user = {
      id: "demo_user",
      displayName: "測試使用者",
      pictureUrl: "",
    };
    localStorage.setItem(STORAGE.demoUser, JSON.stringify(user));
    localStorage.setItem(STORAGE.session, "demo-session");
    state.session = "demo-session";
    state.user = user;
    showToast("已切換為測試身分。");
    renderApp();
  }

  function handleLogout() {
    localStorage.removeItem(STORAGE.session);
    state.session = "";
    state.user = null;
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
        renderApp();
      }
      showToast("開團已建立。");
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
      renderApp();
      showToast("訂單已送出。");
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

  function collectCreateItems() {
    return [...els.itemEditor.querySelectorAll(".item-row")]
      .map((row) => ({
        name: row.querySelector('[name="itemName"]').value.trim(),
        price: Number(row.querySelector('[name="itemPrice"]').value),
      }))
      .filter((item) => item.name && Number.isFinite(item.price) && item.price >= 0);
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

    return {
      ...group,
      items,
      orders,
      status: group.status || "open",
      ownerName: group.ownerName || (group.owner && group.owner.displayName) || "LINE 使用者",
      ownerUserId: group.ownerUserId || (group.owner && group.owner.id) || "",
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

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  class GasApi {
    constructor(baseUrl) {
      this.baseUrl = baseUrl;
    }

    loginUrl(frontend) {
      return this.request("lineLoginUrl", { frontend }).then((data) => data.authUrl);
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

    joinGroup(payload, session) {
      return this.request("joinGroup", {
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
      return Promise.resolve(this.data().groups);
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
