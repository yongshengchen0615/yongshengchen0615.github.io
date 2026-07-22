(function () {
  "use strict";

  var CONFIG = Object.freeze({});
  var STATE_IDS = [
    "loading-state",
    "login-state",
    "setup-state",
    "pending-state",
    "unauthorized-state",
    "error-state",
    "dashboard-state",
  ];
  var members = [];
  var metrics = { all: 0, pending: 0, approved: 0, denied: 0 };
  var pagination = { page: 1, pageSize: 50, total: 0, totalPages: 0 };
  var currentIdToken = "";
  var pendingDenyMember = null;
  var updatingMemberIds = Object.create(null);
  var toastTimer = null;
  var bootVersion = 0;
  var listRequestVersion = 0;
  var isDemoSession = false;
  var isListLoading = false;
  var isMutationLoading = false;
  var isLiffInitialized = false;
  var INVALID_TOKEN_RECOVERY_PREFIX = "persona-admin-invalid-token-recovery:";

  function byId(id) {
    return document.getElementById(id);
  }

  function loadConfig() {
    if (!window.MemberApi) {
      return Promise.reject(createError("CLIENT_LIBRARY_ERROR", "無法載入後台連線元件。"));
    }
    return window.MemberApi
      .loadConfig("config.json", ["LIFF_ID", "GAS_WEB_APP_URL", "BRAND_NAME"])
      .then(function (config) {
        CONFIG = config;
        pagination.pageSize = getConfiguredPageSize();
      });
  }

  function start() {
    setLoading("正在載入管理後台", "讀取公開設定並準備 LINE 身分驗證。請稍候。");
    setConnection("正在載入設定", "loading");
    setView("loading-state");

    return loadConfig()
      .then(function () {
        applyBrand();
        return boot();
      })
      .catch(handleFatalError);
  }

  function boot() {
    var thisBoot = ++bootVersion;
    isDemoSession = false;
    setLoading("正在確認管理員身分", "連線 LINE 與會員後台，請稍候。");
    setConnection("正在連線", "loading");
    setView("loading-state");

    if (hasDemoQuery()) {
      renderDemoDashboard();
      return Promise.resolve();
    }

    if (!hasCompleteConfig()) {
      setConnection("等待設定", "setup");
      setView("setup-state");
      return Promise.resolve();
    }

    if (!window.liff) {
      showError("LIFF_SDK_UNAVAILABLE", "無法載入 LINE 登入元件，請確認網路連線後再試。");
      return Promise.resolve();
    }

    isLiffInitialized = false;
    return window.liff
      .init({ liffId: String(CONFIG.LIFF_ID).trim(), withLoginOnExternalBrowser: false })
      .then(function () {
        isLiffInitialized = true;
        if (thisBoot !== bootVersion) return;
        if (!window.liff.isLoggedIn()) {
          setConnection("等待登入", "idle");
          setView("login-state");
          return;
        }
        pagination.page = 1;
        return fetchMembers(thisBoot, false);
      })
      .catch(function (error) {
        if (thisBoot !== bootVersion) return;
        handleFatalError(error);
      });
  }

  function fetchMembers(expectedBootVersion, preserveDashboard, requestedPage) {
    if (isMutationLoading) return Promise.resolve();
    var thisListRequest = ++listRequestVersion;
    var refreshButton = byId("refresh-button");
    var page = Math.max(1, Number(requestedPage) || pagination.page);
    currentIdToken = window.liff.getIDToken() || "";
    if (!currentIdToken) {
      handleFatalError(
        createError("MISSING_ID_TOKEN", "沒有取得 LINE ID Token，請確認 LIFF 已勾選 openid 權限。")
      );
      return Promise.resolve();
    }

    if (preserveDashboard) {
      setTableBusy(true);
      setButtonBusy(refreshButton, true, "同步中");
      setConnection("正在同步", "loading");
    } else {
      setLoading("正在載入會員清單", "後台正在驗證管理權限並讀取會員資料。請稍候。");
      setView("loading-state");
    }

    return sendAdminRequest("adminListMembers", {
      page: page,
      pageSize: getConfiguredPageSize(),
    })
      .then(function (response) {
        if (expectedBootVersion !== bootVersion || thisListRequest !== listRequestVersion) return;
        assertSuccessfulResponse(response);
        clearInvalidTokenRecoveryGuard();
        renderDashboard(response.data);
      })
      .catch(function (error) {
        if (expectedBootVersion !== bootVersion || thisListRequest !== listRequestVersion) return;
        if (preserveDashboard && !isAuthorizationError(error)) {
          showToast(normalizeError(error).message, "error");
          setConnection("同步失敗", "error");
          return;
        }
        handleFatalError(error);
      })
      .finally(function () {
        if (thisListRequest !== listRequestVersion) return;
        setTableBusy(false);
        setButtonBusy(refreshButton, false);
      });
  }

  function sendAdminRequest(action, fields) {
    return window.MemberApi.sendRequest({
      gasUrl: String(CONFIG.GAS_WEB_APP_URL).trim(),
      action: action,
      idToken: currentIdToken,
      context: getLiffContext(),
      fields: fields || {},
    });
  }

  function handleLogin() {
    var button = byId("login-button");
    if (!window.liff || button.disabled) return;
    if (window.liff.isLoggedIn()) {
      boot();
      return;
    }
    if (window.liff.isInClient()) {
      showError("LIFF_LOGIN_ERROR", "LINE 應用程式內沒有取得登入狀態，請關閉後從管理端 LIFF URL 重新開啟。");
      return;
    }

    setButtonBusy(button, true, "前往 LINE 登入");
    try {
      window.liff.login({ redirectUri: getCleanPageUrl() });
    } catch (error) {
      setButtonBusy(button, false);
      handleFatalError(error);
    }
  }

  function handleLogout() {
    if (isDemoSession) {
      isDemoSession = false;
      setConnection("等待設定", "setup");
      setView("setup-state");
      return;
    }
    if (!window.liff) return;

    currentIdToken = "";
    clearInvalidTokenRecoveryGuard();

    if (window.liff.isInClient()) {
      window.liff.closeWindow();
      return;
    }
    if (window.liff.isLoggedIn()) window.liff.logout();
    window.location.replace(getCleanPageUrl());
  }

  function renderDashboard(data) {
    data = data && typeof data === "object" ? data : {};
    if (!Array.isArray(data.members)) {
      throw createError("INVALID_RESPONSE", "後台回傳的會員清單格式不完整。");
    }

    members = data.members.map(normalizeMember);
    metrics = normalizeMetrics(data.metrics);
    pagination = normalizePagination(data.pagination);
    renderAdminIdentity(data.admin || {});
    renderMetrics();
    renderMemberRows();
    renderPagination();
    byId("sync-label").textContent = "最後同步：" + formatTime(new Date());
    setConnection(isDemoSession ? "展示模式" : "安全連線", isDemoSession ? "setup" : "connected");
    setView("dashboard-state");
  }

  function renderDemoDashboard() {
    isDemoSession = true;
    currentIdToken = "";
    renderDashboard({
      admin: { displayName: "管理員預覽", pictureUrl: "" },
      metrics: { all: 5, pending: 0, approved: 3, denied: 2 },
      pagination: { page: 1, pageSize: 50, total: 5, totalPages: 1 },
      members: [
        demoMember("MBR-A102938475", "林若晴", "0912 345 678", "1991-04-16", "approved", 0),
        demoMember("MBR-B564738291", "陳宇安", "+886 912 000 123", "1988-11-02", "approved", 1),
        demoMember("MBR-C019283746", "許雅文", "", "1995-07-21", "denied", 3),
        demoMember("MBR-D837465920", "江柏廷", "02-2345-6789", "", "denied", 5),
        demoMember("MBR-E746291038", "周語彤", "0988 765 432", "1993-02-08", "approved", 12),
      ],
    });
  }

  function demoMember(memberId, displayName, phone, birthday, status, daysAgo) {
    var joinedAt = new Date(Date.now() - (daysAgo + 30) * 86400000).toISOString();
    return {
      memberId: memberId,
      displayName: displayName,
      pictureUrl: "",
      phone: phone,
      birthday: birthday,
      status: status,
      joinedAt: joinedAt,
      lastLoginAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
      loginCount: daysAgo + 1,
      accessUpdatedAt: new Date().toISOString(),
    };
  }

  function renderAdminIdentity(admin) {
    var name = cleanText(admin.displayName, "管理員");
    var pictureUrl = safeImageUrl(admin.pictureUrl);
    var image = byId("admin-avatar");
    var fallback = byId("admin-avatar-fallback");
    byId("admin-name").textContent = name;
    fallback.textContent = initial(name);

    image.onload = function () {
      image.hidden = false;
      fallback.hidden = true;
    };
    image.onerror = function () {
      image.hidden = true;
      fallback.hidden = false;
      image.removeAttribute("src");
    };
    if (pictureUrl) {
      image.alt = name + " 的 LINE 頭像";
      image.referrerPolicy = "no-referrer";
      image.src = pictureUrl;
    } else {
      image.hidden = true;
      fallback.hidden = false;
      image.removeAttribute("src");
    }
  }

  function renderMetrics() {
    byId("metric-all").textContent = formatNumber(metrics.all);
    byId("metric-approved").textContent = formatNumber(metrics.approved);
    byId("metric-denied").textContent = formatNumber(metrics.denied);
  }

  function renderMemberRows() {
    var list = byId("member-list");
    var query = byId("search-input").value.trim().toLocaleLowerCase("zh-TW");
    var statusFilter = byId("status-filter").value;
    var visibleMembers = members.filter(function (member) {
      var matchesStatus = statusFilter === "all" || member.status === statusFilter;
      var haystack = [member.displayName, member.memberId, member.phone, member.birthday]
        .join(" ")
        .toLocaleLowerCase("zh-TW");
      return matchesStatus && (!query || haystack.indexOf(query) !== -1);
    });

    list.textContent = "";
    visibleMembers.forEach(function (member, index) {
      list.appendChild(createMemberRow(member, index));
    });
    byId("empty-state").hidden = visibleMembers.length !== 0;
    byId("table-wrap").hidden = visibleMembers.length === 0;
  }

  function createMemberRow(member, index) {
    var row = document.createElement("tr");
    row.dataset.memberId = member.memberId;
    row.dataset.busy = updatingMemberIds[member.memberId] ? "true" : "false";
    row.style.setProperty("--row-index", String(index));

    var memberColumn = createCell("會員");
    var memberCell = document.createElement("div");
    memberCell.className = "member-cell";
    memberCell.appendChild(createMemberAvatar(member));
    var memberText = document.createElement("div");
    appendTextElement(memberText, "strong", member.displayName);
    appendTextElement(memberText, "small", member.memberId);
    memberCell.appendChild(memberText);
    memberColumn.appendChild(memberCell);
    row.appendChild(memberColumn);

    var contactColumn = createCell("聯絡資料");
    contactColumn.classList.add("contact-cell");
    appendTextElement(contactColumn, "strong", member.phone || "電話未填寫");
    appendTextElement(
      contactColumn,
      "small",
      member.birthday ? "生日 " + formatBirthday(member.birthday) : "生日未填寫"
    );
    row.appendChild(contactColumn);

    row.appendChild(createDateCell("加入日期", member.joinedAt));
    row.appendChild(createDateCell("最後登入", member.lastLoginAt));

    var statusColumn = createCell("存取狀態");
    var badge = document.createElement("span");
    badge.className = "status-badge";
    badge.dataset.status = member.status;
    badge.textContent = statusLabel(member.status);
    statusColumn.appendChild(badge);
    row.appendChild(statusColumn);

    var actionColumn = createCell("操作");
    var actions = document.createElement("div");
    actions.className = "row-actions";
    if (member.status === "denied") {
      actions.appendChild(createActionButton("approve", "恢復使用", member));
    } else if (member.status === "approved") {
      actions.appendChild(createActionButton("deny", "停用", member));
    } else {
      appendTextElement(actions, "small", "請至 Sheet 修正狀態");
    }
    actionColumn.appendChild(actions);
    row.appendChild(actionColumn);
    return row;
  }

  function createMemberAvatar(member) {
    var wrapper = document.createElement("div");
    wrapper.className = "member-avatar";
    var pictureUrl = safeImageUrl(member.pictureUrl);
    var fallback = document.createElement("span");
    fallback.setAttribute("aria-hidden", "true");
    fallback.textContent = initial(member.displayName);
    wrapper.appendChild(fallback);
    if (pictureUrl) {
      var image = document.createElement("img");
      image.alt = member.displayName + " 的 LINE 頭像";
      image.referrerPolicy = "no-referrer";
      image.hidden = true;
      image.onload = function () {
        image.hidden = false;
        fallback.hidden = true;
      };
      image.onerror = function () {
        image.remove();
        fallback.hidden = false;
      };
      image.src = pictureUrl;
      wrapper.insertBefore(image, fallback);
    }
    return wrapper;
  }

  function createCell(label) {
    var cell = document.createElement("td");
    cell.dataset.label = label;
    return cell;
  }

  function createDateCell(label, value) {
    var cell = createCell(label);
    cell.className = "date-cell";
    var formatted = formatDate(value);
    cell.appendChild(document.createTextNode(formatted.date));
    appendTextElement(cell, "small", formatted.time);
    return cell;
  }

  function createActionButton(action, label, member) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "action-button";
    button.dataset.action = action;
    button.textContent = label;
    button.setAttribute("aria-label", label + "：" + member.displayName);
    button.disabled =
      isListLoading || isMutationLoading || Boolean(updatingMemberIds[member.memberId]);
    button.addEventListener("click", function () {
      if (action === "deny") {
        openDenyDialog(member);
      } else {
        updateMemberAccess(member, "approved");
      }
    });
    return button;
  }

  function openDenyDialog(member) {
    pendingDenyMember = member;
    byId("deny-member-name").textContent = member.displayName;
    var dialog = byId("deny-dialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDenyDialog() {
    var dialog = byId("deny-dialog");
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
    pendingDenyMember = null;
  }

  function updateMemberAccess(member, accessStatus) {
    if (!member || isListLoading || isMutationLoading || updatingMemberIds[member.memberId]) return;
    if (isDemoSession) {
      applyLocalMemberUpdate(member.memberId, accessStatus);
      closeDenyDialog();
      showToast(accessStatus === "approved" ? "預覽：已恢復會員使用" : "預覽：已停用會員");
      return;
    }

    updatingMemberIds[member.memberId] = true;
    var refreshAfterMutation = false;
    isMutationLoading = true;
    listRequestVersion += 1;
    if (accessStatus === "denied") {
      setButtonBusy(byId("confirm-deny-button"), true, "正在更新");
    }
    renderMemberRows();
    updateOperationControls();

    sendAdminRequest("adminSetMemberAccess", {
      targetMemberId: member.memberId,
      accessStatus: accessStatus,
      expectedAccessStatus: member.status,
      expectedAccessUpdatedAt: member.accessUpdatedAt,
    })
      .then(function (response) {
        assertSuccessfulResponse(response);
        if (!response.data || !response.data.member) {
          throw createError("INVALID_RESPONSE", "後台回傳的會員狀態格式不完整。");
        }
        applyLocalMemberUpdate(member.memberId, accessStatus, response.data.member);
        closeDenyDialog();
        showToast(accessStatus === "approved" ? "已恢復會員使用" : "已停用會員");
      })
      .catch(function (error) {
        if (isAuthorizationError(error)) {
          closeDenyDialog();
          handleFatalError(error);
          return;
        }
        var normalized = normalizeError(error);
        showToast(normalized.message, "error");
        if (normalized.code === "ACCESS_CONFLICT" || normalized.code === "MEMBER_NOT_FOUND") {
          closeDenyDialog();
          refreshAfterMutation = true;
        }
      })
      .finally(function () {
        delete updatingMemberIds[member.memberId];
        isMutationLoading = false;
        setButtonBusy(byId("confirm-deny-button"), false);
        updateOperationControls();
        renderMemberRows();
        if (refreshAfterMutation) fetchMembers(bootVersion, true);
      });
  }

  function applyLocalMemberUpdate(memberId, accessStatus, updatedMember) {
    var member = members.find(function (item) {
      return item.memberId === memberId;
    });
    if (!member) return;
    var previousStatus = member.status;
    var replacement = updatedMember ? normalizeMember(updatedMember) : Object.assign({}, member, {
      status: accessStatus,
      accessUpdatedAt: new Date().toISOString(),
    });
    var index = members.indexOf(member);
    members[index] = replacement;
    if (previousStatus !== replacement.status) {
      metrics[previousStatus] = Math.max(0, Number(metrics[previousStatus]) - 1);
      metrics[replacement.status] = Math.max(0, Number(metrics[replacement.status]) + 1);
    }
    renderMetrics();
    renderMemberRows();
  }

  function renderPagination() {
    var totalPages = Math.max(0, Number(pagination.totalPages) || 0);
    byId("current-page").textContent = String(totalPages === 0 ? 1 : pagination.page);
    byId("total-pages").textContent = String(Math.max(1, totalPages));
    var busy = isListLoading || isMutationLoading;
    byId("previous-page-button").disabled = busy || pagination.page <= 1;
    byId("next-page-button").disabled = busy || totalPages === 0 || pagination.page >= totalPages;
  }

  function changePage(direction) {
    var nextPage = pagination.page + direction;
    if (nextPage < 1 || (pagination.totalPages > 0 && nextPage > pagination.totalPages)) return;
    fetchMembers(bootVersion, true, nextPage);
  }

  function normalizeMember(value) {
    value = value && typeof value === "object" ? value : {};
    return {
      memberId: cleanText(value.memberId, "—"),
      displayName: cleanText(value.displayName, "LINE 會員"),
      pictureUrl: safeImageUrl(value.pictureUrl),
      phone: cleanText(value.phone, ""),
      birthday: /^\d{4}-\d{2}-\d{2}$/.test(String(value.birthday || ""))
        ? String(value.birthday)
        : "",
      status: normalizeStatus(value.status),
      joinedAt: value.joinedAt || "",
      lastLoginAt: value.lastLoginAt || "",
      loginCount: Math.max(0, Number(value.loginCount) || 0),
      accessUpdatedAt: value.accessUpdatedAt || "",
    };
  }

  function normalizeMetrics(value) {
    value = value && typeof value === "object" ? value : {};
    return {
      all: Math.max(0, Number(value.all) || 0),
      pending: Math.max(0, Number(value.pending) || 0),
      approved: Math.max(0, Number(value.approved) || 0),
      denied: Math.max(0, Number(value.denied) || 0),
    };
  }

  function normalizePagination(value) {
    value = value && typeof value === "object" ? value : {};
    var totalPages = Math.max(0, Math.floor(Number(value.totalPages) || 0));
    return {
      page: Math.max(1, Math.floor(Number(value.page) || 1)),
      pageSize: Math.max(1, Math.min(100, Math.floor(Number(value.pageSize) || getConfiguredPageSize()))),
      total: Math.max(0, Math.floor(Number(value.total) || 0)),
      totalPages: totalPages,
    };
  }

  function normalizeStatus(value) {
    var status = String(value || "").toLowerCase();
    if (status === "approved" || status === "active") return "approved";
    if (status === "denied" || status === "blocked") return "denied";
    return "pending";
  }

  function statusLabel(status) {
    if (status === "approved") return "可使用";
    if (status === "denied") return "已停用";
    return "狀態需修正";
  }

  function assertSuccessfulResponse(response) {
    if (response && response.ok) return;
    throw createError(
      response && response.code ? response.code : "BACKEND_ERROR",
      response && response.message ? response.message : "會員後台暫時無法處理這次請求。"
    );
  }

  function handleFatalError(error) {
    var normalized = normalizeError(error);

    if (
      (normalized.code === "INVALID_TOKEN" || normalized.code === "INVALID_ID_TOKEN") &&
      tryExternalTokenRecovery()
    ) {
      return;
    }

    if (normalized.code === "ADMIN_PENDING") {
      clearInvalidTokenRecoveryGuard();
      setConnection("等待核准", "setup");
      setView("pending-state");
      return;
    }
    if (normalized.code === "ADMIN_FORBIDDEN") {
      clearInvalidTokenRecoveryGuard();
      setConnection("申請已拒絕", "error");
      setView("unauthorized-state");
      return;
    }
    showError(normalized.code, normalized.message);
  }

  function tryExternalTokenRecovery() {
    if (!window.liff || !isLiffInitialized || window.liff.isInClient()) return false;

    var guardKey =
      INVALID_TOKEN_RECOVERY_PREFIX + String(CONFIG.LIFF_ID || "unknown").trim();

    try {
      if (window.sessionStorage.getItem(guardKey) === "attempted") return false;
      window.sessionStorage.setItem(guardKey, "attempted");
    } catch (_error) {
      // Without a tab-scoped guard, automatic login could redirect forever.
      return false;
    }

    currentIdToken = "";
    setConnection("正在重新登入", "loading");
    setLoading("正在更新 LINE 登入", "偵測到舊的登入憑證，正在安全地重新登入管理後台。");
    setView("loading-state");

    try {
      if (window.liff.isLoggedIn()) window.liff.logout();
      window.liff.login({ redirectUri: getCleanPageUrl() });
      return true;
    } catch (_error) {
      try {
        window.sessionStorage.removeItem(guardKey);
      } catch (_storageError) {
        // The existing error state remains the safe fallback.
      }
      return false;
    }
  }

  function clearInvalidTokenRecoveryGuard() {
    var guardKey =
      INVALID_TOKEN_RECOVERY_PREFIX + String(CONFIG.LIFF_ID || "unknown").trim();
    try {
      window.sessionStorage.removeItem(guardKey);
    } catch (_error) {
      // sessionStorage may be unavailable in privacy-restricted browsers.
    }
  }

  function normalizeError(error) {
    var code = error && (error.code || error.name) ? String(error.code || error.name) : "CONNECTION_ERROR";
    var messages = {
      ADMIN_PENDING: "管理員申請等待試算表擁有者核准。",
      ADMIN_FORBIDDEN: "此 LINE 帳號在 Admins 工作表中的狀態未獲核准。",
      INVALID_TOKEN: "LINE 登入憑證無效或已過期，請重新登入。",
      INVALID_ID_TOKEN: "LINE 登入憑證已失效，請重新登入。",
      MISSING_ID_TOKEN: "沒有取得 LINE 登入憑證，請確認 LIFF 已勾選 openid 權限。",
      ORIGIN_NOT_ALLOWED: "目前網站來源未被 GAS 允許，請檢查 ALLOWED_ORIGINS。",
      LINE_RATE_LIMITED: "LINE 驗證請求較多，請稍候一分鐘再試。",
      LINE_UNAVAILABLE: "LINE 驗證服務暫時無法使用，請稍後再試。",
      BUSY: "會員資料正在更新，請稍候幾秒後再試。",
      MEMBER_NOT_FOUND: "這位會員已不存在，請重新整理清單。",
      ACCESS_CONFLICT: "會員狀態已被其他管理員更新，清單將重新同步。",
    };
    return {
      code: code,
      message: messages[code] || (error && error.message) || "連線時發生問題，請稍後再試。",
    };
  }

  function isAuthorizationError(error) {
    var code = normalizeError(error).code;
    return (
      code === "ADMIN_PENDING" ||
      code === "ADMIN_FORBIDDEN" ||
      code === "INVALID_TOKEN" ||
      code === "INVALID_ID_TOKEN"
    );
  }

  function showError(code, message) {
    byId("error-code").textContent = String(code || "CONNECTION_ERROR").replace(/_/g, " ");
    byId("error-message").textContent = message;
    setConnection("連線失敗", "error");
    setView("error-state");
  }

  function showToast(message, tone) {
    var toast = byId("toast");
    window.clearTimeout(toastTimer);
    byId("toast-message").textContent = message;
    toast.dataset.tone = tone || "success";
    toast.hidden = false;
    toastTimer = window.setTimeout(function () {
      toast.hidden = true;
    }, 4200);
  }

  function setView(activeId) {
    STATE_IDS.forEach(function (id) {
      var element = byId(id);
      if (element) element.hidden = id !== activeId;
    });
  }

  function setLoading(title, message) {
    byId("loading-title").textContent = title;
    byId("loading-message").textContent = message;
  }

  function setConnection(label, tone) {
    byId("connection-label").textContent = label;
    byId("connection-status").dataset.tone = tone || "loading";
  }

  function setTableBusy(busy) {
    isListLoading = Boolean(busy);
    updateOperationControls();
  }

  function updateOperationControls() {
    var busy = isListLoading || isMutationLoading;
    byId("table-wrap").setAttribute("aria-busy", String(busy));
    byId("refresh-button").disabled = busy;
    document.querySelectorAll(".action-button").forEach(function (button) {
      var row = button.closest("tr");
      button.disabled = busy || Boolean(row && updatingMemberIds[row.dataset.memberId]);
    });
    renderPagination();
  }

  function setButtonBusy(button, busy, busyLabel) {
    if (!button) return;
    var label = button.querySelector("span") || button;
    if (busy) {
      if (!("originalLabel" in button.dataset)) button.dataset.originalLabel = label.textContent;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      if (busyLabel) label.textContent = busyLabel;
      return;
    }
    if ("originalLabel" in button.dataset) {
      label.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }

  function getLiffContext() {
    var context = {};
    try {
      var liffContext = window.liff.getContext() || {};
      context.type = cleanContextValue(liffContext.type);
      context.viewType = cleanContextValue(liffContext.viewType);
      context.os = cleanContextValue(window.liff.getOS());
      context.language = cleanContextValue(
        typeof window.liff.getAppLanguage === "function"
          ? window.liff.getAppLanguage()
          : window.navigator.language
      );
      context.inClient = Boolean(window.liff.isInClient());
    } catch (_error) {
      context.os = cleanContextValue(window.navigator.platform);
      context.language = cleanContextValue(window.navigator.language);
    }
    return context;
  }

  function cleanContextValue(value) {
    return String(value || "").trim().slice(0, 40);
  }

  function hasCompleteConfig() {
    var liffId = String(CONFIG.LIFF_ID || "").trim();
    if (!liffId || /YOUR_|請填入|REPLACE/i.test(liffId)) return false;
    return Boolean(window.MemberApi && window.MemberApi.isValidGasUrl(CONFIG.GAS_WEB_APP_URL));
  }

  function getConfiguredPageSize() {
    var pageSize = Math.floor(Number(CONFIG.PAGE_SIZE) || 50);
    return Math.max(1, Math.min(100, pageSize));
  }

  function getCleanPageUrl() {
    var url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function hasDemoQuery() {
    return new URLSearchParams(window.location.search).get("demo") === "1";
  }

  function applyBrand() {
    var brand = cleanText(CONFIG.BRAND_NAME, "PERSONA").slice(0, 28);
    document.querySelectorAll("[data-brand-name]").forEach(function (element) {
      element.textContent = brand;
    });
    document.title = brand + " ADMIN｜會員管理";
  }

  function cleanText(value, fallback) {
    var text = String(value == null ? "" : value).trim();
    return text || fallback;
  }

  function safeImageUrl(value) {
    if (!value) return "";
    try {
      var url = new URL(String(value));
      return url.protocol === "https:" ? url.toString() : "";
    } catch (_error) {
      return "";
    }
  }

  function initial(value) {
    return Array.from(cleanText(value, "A"))[0] || "A";
  }

  function appendTextElement(parent, tagName, text) {
    var element = document.createElement(tagName);
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function formatDate(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return { date: "—", time: "" };
    return {
      date: new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date),
      time: new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date),
    };
  }

  function formatBirthday(value) {
    var birthday = String(value || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday.replace(/-/g, "/") : "—";
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat("zh-TW", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(value);
  }

  function formatNumber(value) {
    return Math.max(0, Number(value) || 0).toLocaleString("zh-TW");
  }

  function createError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function bindInteractions() {
    byId("login-button").addEventListener("click", handleLogin);
    byId("logout-button").addEventListener("click", handleLogout);
    byId("pending-refresh-button").addEventListener("click", boot);
    byId("pending-logout-button").addEventListener("click", handleLogout);
    byId("unauthorized-logout-button").addEventListener("click", handleLogout);
    byId("retry-button").addEventListener("click", start);
    byId("preview-button").addEventListener("click", renderDemoDashboard);
    byId("refresh-button").addEventListener("click", function () {
      if (isDemoSession) {
        renderDemoDashboard();
        showToast("預覽資料已重新整理");
        return;
      }
      fetchMembers(bootVersion, true);
    });
    byId("previous-page-button").addEventListener("click", function () {
      changePage(-1);
    });
    byId("next-page-button").addEventListener("click", function () {
      changePage(1);
    });
    byId("search-input").addEventListener("input", renderMemberRows);
    byId("status-filter").addEventListener("change", renderMemberRows);
    byId("filter-form").addEventListener("submit", function (event) {
      event.preventDefault();
    });
    byId("cancel-deny-button").addEventListener("click", closeDenyDialog);
    byId("confirm-deny-button").addEventListener("click", function () {
      if (pendingDenyMember) updateMemberAccess(pendingDenyMember, "denied");
    });
    byId("deny-dialog").addEventListener("click", function (event) {
      if (event.target === byId("deny-dialog")) closeDenyDialog();
    });
    byId("deny-dialog").addEventListener("close", function () {
      pendingDenyMember = null;
    });
  }

  bindInteractions();
  byId("current-year").textContent = String(new Date().getFullYear());
  start();
})();
