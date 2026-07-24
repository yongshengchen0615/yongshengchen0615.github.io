(function () {
  "use strict";

  var CONFIG = Object.freeze({});
  var requestedAdminPage =
    document.body && String(document.body.dataset.adminPage || "");
  var ADMIN_PAGE =
    requestedAdminPage === "points" || requestedAdminPage === "lottery"
      ? requestedAdminPage
      : "members";
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
  var pointTypes = [];
  var pointHistory = [];
  var pointHistoryHasMore = false;
  var lotteryConfig = null;
  var pointCardSetting = null;
  var pointCardRewardRules = [];
  var lotteryTypes = [];
  var selectedLotteryTypeId = "";
  var isCreatingLotteryType = false;
  var lotteryPrizes = [];
  var lotteryDraws = [];
  var lotteryDrawsHaveMore = false;
  var lotteryAdminIdentity = null;
  var metrics = { all: 0, pending: 0, approved: 0, denied: 0 };
  var pagination = { page: 1, pageSize: 50, total: 0, totalPages: 0 };
  var currentIdToken = "";
  var selectedPointTypeId = "";
  var currentClaimUrl = "";
  var currentPointCampaign = null;
  var pendingDeletePointType = null;
  var pendingDenyMember = null;
  var updatingMemberIds = Object.create(null);
  var toastTimer = null;
  var bootVersion = 0;
  var listRequestVersion = 0;
  var pointHistoryRequestVersion = 0;
  var lotteryRequestVersion = 0;
  var lotteryHistoryRequestVersion = 0;
  var isDemoSession = false;
  var isListLoading = false;
  var isMutationLoading = false;
  var isPointMutationLoading = false;
  var isPointHistoryLoading = false;
  var isPointWorkspaceAvailable = false;
  var isLotteryLoading = false;
  var isLotteryMutationLoading = false;
  var isLotteryHistoryLoading = false;
  var isLiffInitialized = false;
  var memberSearchFrame = 0;
  var adminWheelRenderFrame = 0;
  var ADMIN_DATE_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  var ADMIN_MINUTE_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  var ADMIN_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  var ADMIN_SECOND_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  var INVALID_TOKEN_RECOVERY_PREFIX = "persona-admin-invalid-token-recovery:";
  var MEMBER_LIFF_PATH = "/2010787602-kaiSm2eq";

  function byId(id) {
    return document.getElementById(id);
  }

  function loadConfig() {
    if (
      !window.MemberApi ||
      !window.LiffRuntime ||
      (ADMIN_PAGE === "lottery" && !window.LotteryWheel)
    ) {
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
        if (ADMIN_PAGE === "points") {
          return fetchPointTypes(thisBoot, false).then(function () {
            if (
              thisBoot !== bootVersion ||
              isDemoSession ||
              !isPointWorkspaceAvailable
            ) {
              return;
            }
            return fetchPointHistory(thisBoot, true);
          });
        }
        if (ADMIN_PAGE === "lottery") {
          return fetchLotteryConfig(thisBoot, false).then(function () {
            if (thisBoot !== bootVersion || isDemoSession) return;
            return fetchLotteryHistory(thisBoot, true);
          });
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
    if (isListLoading || isMutationLoading) return Promise.resolve();
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

  function fetchPointTypes(expectedBootVersion, preserveDashboard) {
    if (isListLoading || isPointMutationLoading) return Promise.resolve();
    var thisListRequest = ++listRequestVersion;
    var refreshButton = byId("refresh-points-button");
    currentIdToken = window.liff.getIDToken() || "";
    if (!currentIdToken) {
      handleFatalError(
        createError("MISSING_ID_TOKEN", "沒有取得 LINE ID Token，請確認 LIFF 已勾選 openid 權限。")
      );
      return Promise.resolve();
    }

    isListLoading = true;
    updateOperationControls();
    if (preserveDashboard) {
      setButtonBusy(refreshButton, true, "同步中");
      setConnection("正在同步", "loading");
    } else {
      setLoading("正在載入點數管理", "後台正在驗證管理權限並讀取點數類型。請稍候。");
      setView("loading-state");
    }

    return sendAdminRequest("adminListPointTypes", {})
      .then(function (response) {
        if (expectedBootVersion !== bootVersion || thisListRequest !== listRequestVersion) return;
        assertSuccessfulResponse(response);
        clearInvalidTokenRecoveryGuard();
        renderPointDashboard(response.data);
      })
      .catch(function (error) {
        if (expectedBootVersion !== bootVersion || thisListRequest !== listRequestVersion) return;
        if (preserveDashboard && !isAuthorizationError(error)) {
          renderPointWorkspaceError(error);
          showToast(normalizeError(error).message, "error");
          setConnection("同步失敗", "error");
          return;
        }
        handleFatalError(error);
      })
      .finally(function () {
        if (thisListRequest !== listRequestVersion) return;
        isListLoading = false;
        updateOperationControls();
        setButtonBusy(refreshButton, false);
      });
  }

  function fetchPointHistory(expectedBootVersion, preserveDashboard) {
    if (isPointHistoryLoading || isPointMutationLoading) return Promise.resolve();
    var thisHistoryRequest = ++pointHistoryRequestVersion;
    var refreshButton = byId("refresh-point-history-button");
    if (!currentIdToken && window.liff && typeof window.liff.getIDToken === "function") {
      currentIdToken = window.liff.getIDToken() || "";
    }
    if (!currentIdToken) {
      var missingTokenError = createError(
        "MISSING_ID_TOKEN",
        "沒有取得 LINE ID Token，請確認 LIFF 已勾選 openid 權限。"
      );
      renderAdminPointHistoryError(missingTokenError);
      handleFatalError(missingTokenError);
      return Promise.resolve();
    }

    isPointHistoryLoading = true;
    renderAdminPointHistoryLoading();
    updateOperationControls();
    if (preserveDashboard) {
      setButtonBusy(refreshButton, true, "同步中");
      setConnection("正在同步紀錄", "loading");
    }

    return sendAdminRequest("adminListPointHistory", {})
      .then(function (response) {
        if (
          expectedBootVersion !== bootVersion ||
          thisHistoryRequest !== pointHistoryRequestVersion
        ) {
          return;
        }
        assertSuccessfulResponse(response);
        if (!response.data || !Array.isArray(response.data.history)) {
          throw createError("INVALID_RESPONSE", "後台回傳的點數使用紀錄格式不完整。");
        }
        clearInvalidTokenRecoveryGuard();
        renderAdminPointHistory(response.data.history, response.data.hasMore);
        setConnection(isDemoSession ? "展示模式" : "安全連線", isDemoSession ? "setup" : "connected");
      })
      .catch(function (error) {
        if (
          expectedBootVersion !== bootVersion ||
          thisHistoryRequest !== pointHistoryRequestVersion
        ) {
          return;
        }
        if (preserveDashboard && !isAuthorizationError(error)) {
          renderAdminPointHistoryError(error);
          showToast(normalizeError(error).message, "error");
          setConnection("紀錄同步失敗", "error");
          return;
        }
        handleFatalError(error);
      })
      .finally(function () {
        if (thisHistoryRequest !== pointHistoryRequestVersion) return;
        isPointHistoryLoading = false;
        setButtonBusy(refreshButton, false);
        updateOperationControls();
      });
  }

  function fetchLotteryConfig(expectedBootVersion, preserveDashboard) {
    if (isLotteryLoading || isLotteryMutationLoading) return Promise.resolve();
    var thisRequest = ++lotteryRequestVersion;
    var refreshButton = byId("refresh-lottery-button");
    currentIdToken = window.liff.getIDToken() || "";
    if (!currentIdToken) {
      handleFatalError(
        createError("MISSING_ID_TOKEN", "沒有取得 LINE ID Token，請確認 LIFF 已勾選 openid 權限。")
      );
      return Promise.resolve();
    }

    isLotteryLoading = true;
    updateOperationControls();
    if (preserveDashboard) {
      setButtonBusy(refreshButton, true, "同步中");
      setConnection("正在同步轉盤", "loading");
    } else {
      setLoading("正在載入轉盤設定", "後台正在驗證權限並讀取目前獎項。請稍候。");
      setView("loading-state");
    }

    return sendAdminRequest("adminGetLotteryConfig", {})
      .then(function (response) {
        if (
          expectedBootVersion !== bootVersion ||
          thisRequest !== lotteryRequestVersion
        ) {
          return;
        }
        assertSuccessfulResponse(response);
        clearInvalidTokenRecoveryGuard();
        renderLotteryDashboard(response.data);
      })
      .catch(function (error) {
        if (
          expectedBootVersion !== bootVersion ||
          thisRequest !== lotteryRequestVersion
        ) {
          return;
        }
        if (preserveDashboard && !isAuthorizationError(error)) {
          showLotteryConfigError(normalizeError(error).message);
          showToast(normalizeError(error).message, "error");
          setConnection("同步失敗", "error");
          return;
        }
        handleFatalError(error);
      })
      .finally(function () {
        if (thisRequest !== lotteryRequestVersion) return;
        isLotteryLoading = false;
        setButtonBusy(refreshButton, false);
        updateOperationControls();
      });
  }

  function fetchLotteryHistory(expectedBootVersion, preserveDashboard) {
    if (isLotteryHistoryLoading || isLotteryMutationLoading) {
      return Promise.resolve();
    }
    var thisRequest = ++lotteryHistoryRequestVersion;
    var refreshButton = byId("refresh-lottery-history-button");
    if (!currentIdToken && window.liff && typeof window.liff.getIDToken === "function") {
      currentIdToken = window.liff.getIDToken() || "";
    }
    if (!currentIdToken) {
      var missingTokenError = createError(
        "MISSING_ID_TOKEN",
        "沒有取得 LINE ID Token，請確認 LIFF 已勾選 openid 權限。"
      );
      renderLotteryHistoryError(missingTokenError);
      handleFatalError(missingTokenError);
      return Promise.resolve();
    }

    isLotteryHistoryLoading = true;
    renderLotteryHistoryLoading();
    updateOperationControls();
    if (preserveDashboard) {
      setButtonBusy(refreshButton, true, "同步中");
      setConnection("正在同步紀錄", "loading");
    }

    return sendAdminRequest("adminListLotteryDraws", {})
      .then(function (response) {
        if (
          expectedBootVersion !== bootVersion ||
          thisRequest !== lotteryHistoryRequestVersion
        ) {
          return;
        }
        assertSuccessfulResponse(response);
        if (!response.data || !Array.isArray(response.data.draws)) {
          throw createError("INVALID_RESPONSE", "後台回傳的抽獎紀錄格式不完整。");
        }
        clearInvalidTokenRecoveryGuard();
        renderLotteryHistory(response.data.draws, response.data.hasMore);
        if (preserveDashboard) {
          setConnection(
            isDemoSession ? "展示模式" : "安全連線",
            isDemoSession ? "setup" : "connected"
          );
        }
      })
      .catch(function (error) {
        if (
          expectedBootVersion !== bootVersion ||
          thisRequest !== lotteryHistoryRequestVersion
        ) {
          return;
        }
        if (preserveDashboard && !isAuthorizationError(error)) {
          renderLotteryHistoryError(error);
          showToast(normalizeError(error).message, "error");
          setConnection("紀錄同步失敗", "error");
          return;
        }
        handleFatalError(error);
      })
      .finally(function () {
        if (thisRequest !== lotteryHistoryRequestVersion) return;
        isLotteryHistoryLoading = false;
        setButtonBusy(refreshButton, false);
        updateOperationControls();
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
      syncAdminRoutes();
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
    updateOperationControls();
    byId("sync-label").textContent = "最後同步：" + formatTime(new Date());
    setConnection(isDemoSession ? "展示模式" : "安全連線", isDemoSession ? "setup" : "connected");
    setView("dashboard-state");
  }

  function renderPointDashboard(pointData) {
    pointData = pointData && typeof pointData === "object" ? pointData : {};
    if (!Array.isArray(pointData.pointTypes)) {
      throw createError("INVALID_RESPONSE", "後台回傳的點數類型格式不完整。");
    }

    pointTypes = pointData.pointTypes.map(normalizePointType);
    isPointWorkspaceAvailable = true;
    renderAdminIdentity(getCurrentAdminIdentity());
    if (
      !pointTypes.some(function (pointType) {
        return pointType.pointTypeId === selectedPointTypeId && pointType.status === "active";
      })
    ) {
      var firstActiveType = pointTypes.find(function (pointType) {
        return pointType.status === "active";
      });
      selectedPointTypeId = firstActiveType ? firstActiveType.pointTypeId : "";
    }
    clearPointFormError("point-type-error");
    clearPointFormError("point-campaign-error");
    setDefaultPointExpiry();
    renderPointTypes();
    if (Array.isArray(pointData.history)) {
      renderAdminPointHistory(pointData.history, pointData.hasMore);
    }
    updateOperationControls();
    setConnection(isDemoSession ? "展示模式" : "安全連線", isDemoSession ? "setup" : "connected");
    setView("dashboard-state");
  }

  function renderPointWorkspaceError(error) {
    pointTypes = [];
    selectedPointTypeId = "";
    isPointWorkspaceAvailable = false;
    renderPointTypes();
    updateOperationControls();
    showPointFormError(
      "point-type-error",
      "點數功能載入失敗：" + normalizeError(error).message
    );
  }

  function renderLotteryDashboard(data) {
    data = data && typeof data === "object" ? data : {};
    pointCardSetting = normalizePointCardSetting(data.pointCardSetting);
    pointCardRewardRules = pointCardSetting.rewardRules.map(function (rule) {
      return {
        points: rule.points,
        lotteryTypeId: rule.lotteryTypeId,
      };
    });
    lotteryTypes = normalizeLotteryTypes(data.lotteryTypes);
    isCreatingLotteryType = false;
    if (
      !selectedLotteryTypeId ||
      !lotteryTypes.some(function (type) {
        return type.lotteryTypeId === selectedLotteryTypeId;
      })
    ) {
      selectedLotteryTypeId = lotteryTypes.length
        ? lotteryTypes[0].lotteryTypeId
        : "";
    }
    var selectedType = getSelectedLotteryType();
    lotteryConfig = selectedType
      ? selectedType.lottery
      : normalizeLotteryConfig({ lotteryTypeId: "", configVersion: "", updatedAt: "", prizes: [] });
    lotteryAdminIdentity = data.admin || lotteryAdminIdentity || getCurrentAdminIdentity();
    lotteryPrizes = lotteryConfig.prizes.length
      ? lotteryConfig.prizes.map(copyLotteryPrizeForEditor)
      : defaultLotteryPrizes();
    renderAdminIdentity(lotteryAdminIdentity);
    renderPointCardSetting();
    renderLotteryTypes();
    byId("lottery-type-name-input").value = selectedType ? selectedType.name : "";
    renderLotteryNamePreview();
    renderLotteryEditorState();
    renderLotteryConfigMeta();
    renderLotteryPrizeRows();
    clearLotteryConfigError();
    clearPointCardSettingError();
    clearDeleteLotteryTypeError();
    updateOperationControls();
    setConnection(
      isDemoSession ? "展示模式" : "安全連線",
      isDemoSession ? "setup" : "connected"
    );
    setView("dashboard-state");
  }

  function renderDemoDashboard() {
    isDemoSession = true;
    currentIdToken = "";
    syncAdminRoutes();
    if (ADMIN_PAGE === "points") {
      renderPointDashboard({
        pointTypes: [
          demoPointType("PTY-PREVIEW001", 1, "limited", "once_per_member"),
          demoPointType("PTY-PREVIEW002", 2, "unlimited", "once_per_member"),
          demoPointType("PTY-PREVIEW003", 3, "unlimited", "repeatable"),
          demoPointType("PTY-PREVIEW004", 4, "limited", "single_member"),
        ],
        history: demoPointHistory(),
        hasMore: false,
      });
      renderAdminIdentity({ displayName: "管理員預覽", pictureUrl: "" });
      return;
    }
    if (ADMIN_PAGE === "lottery") {
      renderLotteryDashboard({
        admin: { displayName: "管理員預覽", pictureUrl: "" },
        pointCardSetting: {
          settingVersion: "PCS-PREVIEW00001",
          targetPoints: 20,
          rewardMilestones: [5, 10, 15, 20],
          rewardRules: [
            { points: 5, lotteryTypeId: "" },
            { points: 10, lotteryTypeId: "" },
            { points: 15, lotteryTypeId: "" },
            { points: 20, lotteryTypeId: "" },
          ],
          effectiveAt: new Date().toISOString(),
        },
        lotteryTypes: [],
      });
      renderLotteryHistory(demoLotteryDraws(), false);
      return;
    }
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

  function getCurrentAdminIdentity() {
    var claims = {};
    try {
      if (window.liff && typeof window.liff.getDecodedIDToken === "function") {
        claims = window.liff.getDecodedIDToken() || {};
      }
    } catch (_error) {
      claims = {};
    }
    return {
      displayName: cleanText(claims.name, "管理員"),
      pictureUrl: safeImageUrl(claims.picture),
    };
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

  function demoPointType(pointTypeId, points, expiryMode, redemptionMode) {
    return {
      pointTypeId: pointTypeId,
      label: points + " 點",
      points: points,
      status: "active",
      expiryMode: expiryMode || "limited",
      redemptionMode: redemptionMode || "once_per_member",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function demoPointHistory() {
    var now = Date.now();
    return [
      {
        redemptionId: "RDM-PREVIEW000000001",
        campaignId: "PCG-PREVIEW001",
        pointTypeId: "PTY-PREVIEW003",
        memberId: "MBR-A102938475",
        label: "3 點",
        points: 3,
        balanceAfter: 18,
        redeemedAt: new Date(now - 18 * 60000).toISOString(),
        redemptionMode: "repeatable",
        source: "qr",
      },
      {
        redemptionId: "RDM-PREVIEW000000002",
        campaignId: "PCG-PREVIEW002",
        pointTypeId: "PTY-PREVIEW002",
        memberId: "MBR-B564738291",
        label: "2 點",
        points: 2,
        balanceAfter: 9,
        redeemedAt: new Date(now - 2 * 3600000).toISOString(),
        redemptionMode: "once_per_member",
        source: "qr",
      },
      {
        redemptionId: "RDM-PREVIEW000000003",
        campaignId: "PCG-PREVIEW004",
        pointTypeId: "PTY-PREVIEW004",
        memberId: "MBR-E746291038",
        label: "4 點",
        points: 4,
        balanceAfter: 22,
        redeemedAt: new Date(now - 86400000).toISOString(),
        redemptionMode: "single_member",
        source: "qr",
      },
    ];
  }

  function defaultLotteryPrizes() {
    return [
      { prizeId: "", label: "銘謝惠顧", color: "#D9D6CC", probability: 50 },
      { prizeId: "", label: "小禮物", color: "#8DCCAA", probability: 30 },
      { prizeId: "", label: "精選獎", color: "#F0C36A", probability: 15 },
      { prizeId: "", label: "頭獎", color: "#0B3C2C", probability: 5 },
    ];
  }

  function demoLotteryDraws() {
    var now = Date.now();
    return [
      {
        drawId: "LDW-PREVIEW000000001",
        configVersion: "LCF-PREVIEW00001",
        prizeId: "LPR-PREVIEW002",
        prizeLabel: "小禮物",
        prizeColor: "#8DCCAA",
        lotteryTypeId: "LTY-PREVIEW001",
        lotteryTypeName: "經典轉盤",
        memberId: "MBR-A102938475",
        memberDisplayName: "林若晴",
        ticketCost: 0,
        originalPointBalance: 18,
        pointBalance: 18,
        drawnAt: new Date(now - 18 * 60000).toISOString(),
      },
      {
        drawId: "LDW-PREVIEW000000002",
        configVersion: "LCF-PREVIEW00001",
        prizeId: "LPR-PREVIEW001",
        prizeLabel: "銘謝惠顧",
        prizeColor: "#D9D6CC",
        lotteryTypeId: "LTY-PREVIEW001",
        lotteryTypeName: "經典轉盤",
        memberId: "MBR-B564738291",
        memberDisplayName: "陳宇安",
        ticketCost: 0,
        originalPointBalance: 9,
        pointBalance: 9,
        drawnAt: new Date(now - 3 * 3600000).toISOString(),
      },
    ];
  }

  function normalizePointCardSetting(value) {
    value = value && typeof value === "object" ? value : {};
    var settingVersion = String(value.settingVersion || "").trim();
    var targetPoints = Number(value.targetPoints);
    var rewardMilestones = normalizePointCardMilestones(
      value.rewardMilestones,
      targetPoints
    );
    var rawRewardRules = Array.isArray(value.rewardRules)
      ? value.rewardRules
      : rewardMilestones.map(function (points) {
          return { points: points, lotteryTypeId: "" };
        });
    if (rawRewardRules.length !== rewardMilestones.length) {
      throw createError("INVALID_RESPONSE", "後台回傳的節點轉盤設定不正確。");
    }
    var rewardRules = rawRewardRules.map(function (rule, index) {
      rule = rule && typeof rule === "object" ? rule : {};
      var points = Number(rule.points);
      var lotteryTypeId = String(rule.lotteryTypeId || "").trim();
      if (
        points !== rewardMilestones[index] ||
        (lotteryTypeId && !/^LTY-[A-Z0-9]{10}$/.test(lotteryTypeId))
      ) {
        throw createError("INVALID_RESPONSE", "後台回傳的節點轉盤設定不正確。");
      }
      return {
        points: points,
        lotteryTypeId: lotteryTypeId,
      };
    });
    var effectiveAt = String(value.effectiveAt || "").trim();
    if (
      !/^PCS-[A-Z0-9]{12}$/.test(settingVersion) ||
      !Number.isInteger(targetPoints) ||
      targetPoints < 1 ||
      targetPoints > 9999 ||
      Number.isNaN(new Date(effectiveAt).getTime())
    ) {
      throw createError("INVALID_RESPONSE", "後台回傳的集點卡規則格式不正確。");
    }
    return {
      settingVersion: settingVersion,
      targetPoints: targetPoints,
      rewardMilestones: rewardMilestones,
      rewardRules: rewardRules,
      effectiveAt: effectiveAt,
    };
  }

  function normalizePointCardMilestones(value, targetPoints) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
      throw createError("INVALID_RESPONSE", "後台回傳的抽獎節點格式不正確。");
    }
    var previous = 0;
    var milestones = value.map(function (item) {
      var milestone = Number(item);
      if (
        !Number.isInteger(milestone) ||
        milestone <= previous ||
        milestone > targetPoints
      ) {
        throw createError("INVALID_RESPONSE", "後台回傳的抽獎節點格式不正確。");
      }
      previous = milestone;
      return milestone;
    });
    if (milestones[milestones.length - 1] !== targetPoints) {
      throw createError("INVALID_RESPONSE", "最後一個抽獎節點必須等於集點卡總點數。");
    }
    return milestones;
  }

  function normalizeLotteryTypes(value) {
    if (!Array.isArray(value)) {
      throw createError("INVALID_RESPONSE", "後台回傳的轉盤類型格式不正確。");
    }
    var ids = Object.create(null);
    var names = Object.create(null);
    return value.map(function (item) {
      item = item && typeof item === "object" ? item : {};
      var lotteryTypeId = String(item.lotteryTypeId || "").trim();
      var name = String(item.name || "").trim();
      if (
        !/^LTY-[A-Z0-9]{10}$/.test(lotteryTypeId) ||
        !name ||
        name.length > 40 ||
        item.status !== "active" ||
        ids[lotteryTypeId] ||
        names[name.toLowerCase()]
      ) {
        throw createError("INVALID_RESPONSE", "後台回傳的轉盤類型資料不正確。");
      }
      ids[lotteryTypeId] = true;
      names[name.toLowerCase()] = true;
      return {
        lotteryTypeId: lotteryTypeId,
        name: name,
        status: "active",
        createdAt: String(item.createdAt || ""),
        lottery: normalizeLotteryConfig(item.lottery, lotteryTypeId),
      };
    });
  }

  function normalizeLotteryConfig(value, expectedLotteryTypeId) {
    value = value && typeof value === "object" ? value : {};
    var lotteryTypeId = String(value.lotteryTypeId || expectedLotteryTypeId || "").trim();
    var configVersion = String(value.configVersion || "").trim();
    var updatedAt = String(value.updatedAt || "").trim();
    var rawPrizes = Array.isArray(value.prizes) ? value.prizes : null;
    if (
      (lotteryTypeId && !/^LTY-[A-Z0-9]{10}$/.test(lotteryTypeId)) ||
      (expectedLotteryTypeId && lotteryTypeId !== expectedLotteryTypeId) ||
      !rawPrizes ||
      (configVersion && !/^LCF-[A-Z0-9]{12}$/.test(configVersion)) ||
      (!configVersion && (updatedAt || rawPrizes.length)) ||
      (configVersion && Number.isNaN(new Date(updatedAt).getTime())) ||
      rawPrizes.length > 12 ||
      (rawPrizes.length > 0 && rawPrizes.length < 2)
    ) {
      throw createError("INVALID_RESPONSE", "後台回傳的轉盤設定格式不正確。");
    }
    var prizes = rawPrizes.map(normalizeLotteryPrize);
    var total = prizes.reduce(function (sum, prize) {
      return sum + Math.round(prize.probability * 100);
    }, 0);
    if (prizes.length && total !== 10000) {
      throw createError("INVALID_RESPONSE", "後台回傳的轉盤機率合計不是 100%。");
    }
    return {
      lotteryTypeId: lotteryTypeId,
      configVersion: configVersion,
      updatedAt: updatedAt,
      prizes: prizes,
    };
  }

  function getSelectedLotteryType() {
    return lotteryTypes.find(function (type) {
      return type.lotteryTypeId === selectedLotteryTypeId;
    }) || null;
  }

  function renderPointCardSetting() {
    if (!pointCardSetting) return;
    byId("point-card-target-input").value = String(pointCardSetting.targetPoints);
    byId("point-card-setting-current").textContent =
      pointCardSetting.targetPoints +
      " 點一張 · " +
      pointCardSetting.rewardMilestones.join(" / ") +
      " 點抽獎";
    byId("point-card-setting-effective").textContent =
      formatDateTime(pointCardSetting.effectiveAt);
    renderPointCardRewardRows();
  }

  function getConfiguredLotteryTypes() {
    return lotteryTypes.filter(function (type) {
      return Boolean(
        type.lottery &&
          type.lottery.configVersion &&
          type.lottery.prizes.length >= 2
      );
    });
  }

  function renderPointCardRewardRows() {
    var list = byId("point-card-reward-list");
    var configuredTypes = getConfiguredLotteryTypes();
    var fragment = document.createDocumentFragment();
    pointCardRewardRules.sort(function (left, right) {
      return Number(left.points) - Number(right.points);
    });
    pointCardRewardRules.forEach(function (rule, index) {
      var item = document.createElement("li");
      var order = document.createElement("span");
      var pointsLabel = document.createElement("label");
      var pointsInput = document.createElement("input");
      var typeLabel = document.createElement("label");
      var typeSelect = document.createElement("select");
      var removeButton = document.createElement("button");

      item.className = "point-card-reward-row";
      order.className = "point-card-reward-order";
      order.textContent = String(index + 1).padStart(2, "0");
      pointsLabel.dataset.label = "達到點數";
      pointsInput.type = "number";
      pointsInput.min = "1";
      pointsInput.max = "9999";
      pointsInput.step = "1";
      pointsInput.inputMode = "numeric";
      pointsInput.value = String(rule.points || "");
      pointsInput.setAttribute("aria-label", "第 " + (index + 1) + " 個抽獎節點點數");
      pointsLabel.appendChild(pointsInput);

      typeLabel.dataset.label = "指定轉盤";
      var placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = configuredTypes.length
        ? "選擇這個節點的轉盤"
        : "尚無已完成設定的轉盤";
      typeSelect.appendChild(placeholder);
      configuredTypes.forEach(function (type) {
        var option = document.createElement("option");
        option.value = type.lotteryTypeId;
        option.textContent = type.name;
        option.selected = type.lotteryTypeId === rule.lotteryTypeId;
        typeSelect.appendChild(option);
      });
      typeSelect.value = rule.lotteryTypeId;
      typeSelect.setAttribute("aria-label", "第 " + (index + 1) + " 個節點指定轉盤");
      typeLabel.appendChild(typeSelect);

      removeButton.type = "button";
      removeButton.className = "point-card-reward-remove";
      removeButton.textContent = "移除";
      removeButton.disabled = pointCardRewardRules.length <= 1;
      removeButton.setAttribute("aria-label", "移除第 " + (index + 1) + " 個抽獎節點");

      pointsInput.addEventListener("input", function () {
        pointCardRewardRules[index].points = Number(pointsInput.value);
        clearPointCardSettingError();
      });
      typeSelect.addEventListener("change", function () {
        pointCardRewardRules[index].lotteryTypeId = typeSelect.value;
        clearPointCardSettingError();
      });
      removeButton.addEventListener("click", function () {
        if (pointCardRewardRules.length <= 1) return;
        pointCardRewardRules.splice(index, 1);
        clearPointCardSettingError();
        renderPointCardRewardRows();
        updateOperationControls();
      });

      item.appendChild(order);
      item.appendChild(pointsLabel);
      item.appendChild(typeLabel);
      item.appendChild(removeButton);
      fragment.appendChild(item);
    });
    list.replaceChildren(fragment);
    byId("point-card-reward-empty").hidden = configuredTypes.length > 0;
  }

  function addPointCardRewardRule() {
    if (isLotteryMutationLoading || pointCardRewardRules.length >= 20) return;
    var targetPoints = Number(byId("point-card-target-input").value);
    if (!Number.isInteger(targetPoints) || targetPoints < 1) targetPoints = 5;
    var used = Object.create(null);
    pointCardRewardRules.forEach(function (rule) {
      used[rule.points] = true;
    });
    var suggestedPoints = targetPoints;
    for (var candidate = 1; candidate <= targetPoints; candidate += 1) {
      if (!used[candidate]) {
        suggestedPoints = candidate;
        break;
      }
    }
    var configuredTypes = getConfiguredLotteryTypes();
    pointCardRewardRules.push({
      points: suggestedPoints,
      lotteryTypeId:
        configuredTypes.length === 1 ? configuredTypes[0].lotteryTypeId : "",
    });
    clearPointCardSettingError();
    renderPointCardRewardRows();
    updateOperationControls();
  }

  function validatePointCardRewardRules(targetPoints) {
    var configuredTypeIds = Object.create(null);
    getConfiguredLotteryTypes().forEach(function (type) {
      configuredTypeIds[type.lotteryTypeId] = true;
    });
    var rules = pointCardRewardRules.map(function (rule) {
      return {
        points: Number(rule.points),
        lotteryTypeId: String(rule.lotteryTypeId || "").trim(),
      };
    });
    rules.sort(function (left, right) {
      return left.points - right.points;
    });
    normalizePointCardMilestones(
      rules.map(function (rule) {
        return rule.points;
      }),
      targetPoints
    );
    if (
      rules.some(function (rule) {
        return !configuredTypeIds[rule.lotteryTypeId];
      })
    ) {
      throw createError(
        "INVALID_POINT_CARD_REWARDS",
        "每個抽獎節點都必須選擇一個已完成設定的轉盤。"
      );
    }
    return rules;
  }

  function renderLotteryTypes() {
    var select = byId("lottery-type-select");
    select.textContent = "";
    if (isCreatingLotteryType) {
      var draftOption = document.createElement("option");
      draftOption.value = "";
      draftOption.textContent = "新增轉盤（尚未儲存）";
      draftOption.selected = true;
      select.appendChild(draftOption);
    } else if (lotteryTypes.length === 0) {
      var emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "尚未建立轉盤";
      emptyOption.selected = true;
      select.appendChild(emptyOption);
    }
    lotteryTypes.forEach(function (type) {
      var option = document.createElement("option");
      option.value = type.lotteryTypeId;
      option.textContent = type.name;
      option.selected = type.lotteryTypeId === selectedLotteryTypeId;
      select.appendChild(option);
    });
    renderLotteryEditorState();
  }

  function renderLotteryEditorState() {
    var hasEditor = isCreatingLotteryType || Boolean(getSelectedLotteryType());
    byId("lottery-editor").hidden = !hasEditor;
    byId("lottery-empty-state").hidden =
      hasEditor || lotteryTypes.length > 0;
    byId("lottery-rule-workspace").hidden = lotteryTypes.length === 0;
    byId("lottery-config-title").textContent = isCreatingLotteryType
      ? "新增完整轉盤"
      : "完整轉盤設定";
    byId("save-lottery-button").querySelector("span").textContent =
      isCreatingLotteryType ? "儲存並啟用轉盤" : "儲存完整轉盤";
  }

  function renderLotteryNamePreview() {
    var name = String(byId("lottery-type-name-input").value || "").trim();
    byId("lottery-preview-name").textContent =
      name || "尚未命名的轉盤";
  }

  function selectLotteryType(lotteryTypeId) {
    isCreatingLotteryType = false;
    selectedLotteryTypeId = String(lotteryTypeId || "");
    var selectedType = getSelectedLotteryType();
    lotteryConfig = selectedType
      ? selectedType.lottery
      : normalizeLotteryConfig({ lotteryTypeId: "", configVersion: "", updatedAt: "", prizes: [] });
    lotteryPrizes = lotteryConfig.prizes.length
      ? lotteryConfig.prizes.map(copyLotteryPrizeForEditor)
      : defaultLotteryPrizes();
    byId("lottery-type-name-input").value = selectedType ? selectedType.name : "";
    renderLotteryNamePreview();
    renderLotteryTypes();
    renderLotteryConfigMeta();
    renderLotteryPrizeRows();
    renderPointCardRewardRows();
    clearLotteryConfigError();
    updateOperationControls();
  }

  function beginCreateLotteryType() {
    if (isLotteryLoading || isLotteryMutationLoading) return;
    isCreatingLotteryType = true;
    selectedLotteryTypeId = "";
    lotteryConfig = normalizeLotteryConfig({
      lotteryTypeId: "",
      configVersion: "",
      updatedAt: "",
      prizes: [],
    });
    lotteryPrizes = defaultLotteryPrizes();
    byId("lottery-type-name-input").value = "";
    renderLotteryNamePreview();
    renderLotteryTypes();
    renderLotteryConfigMeta();
    renderLotteryPrizeRows();
    clearLotteryConfigError();
    updateOperationControls();
    byId("lottery-type-name-input").focus();
  }

  function normalizeLotteryPrize(value) {
    value = value && typeof value === "object" ? value : {};
    var prizeId = String(value.prizeId || "").trim();
    var label = String(value.label || "").trim();
    var color = String(value.color || "").trim().toUpperCase();
    var probability = Number(value.probability);
    if (
      !/^LPR-[A-Z0-9]{10}$/.test(prizeId) ||
      !label ||
      label.length > 40 ||
      !/^#[0-9A-F]{6}$/.test(color) ||
      !Number.isFinite(probability) ||
      probability <= 0 ||
      probability >= 100 ||
      Math.abs(Math.round(probability * 100) / 100 - probability) > 0.000001
    ) {
      throw createError("INVALID_RESPONSE", "後台回傳的轉盤獎項格式不正確。");
    }
    return {
      prizeId: prizeId,
      label: label,
      color: color,
      probability: probability,
    };
  }

  function copyLotteryPrizeForEditor(prize) {
    return {
      prizeId: String(prize.prizeId || ""),
      label: String(prize.label || ""),
      color: String(prize.color || "#D9D6CC").toUpperCase(),
      probability: Number(prize.probability) || 0,
    };
  }

  function renderLotteryConfigMeta() {
    byId("lottery-config-version").textContent =
      lotteryConfig && lotteryConfig.configVersion
        ? lotteryConfig.configVersion
        : "尚未儲存";
    byId("lottery-config-updated-at").textContent =
      lotteryConfig && lotteryConfig.updatedAt
        ? formatDateTime(lotteryConfig.updatedAt)
        : "—";
  }

  function renderLotteryPrizeRows() {
    var list = byId("lottery-prize-list");
    var fragment = document.createDocumentFragment();
    lotteryPrizes.forEach(function (prize, index) {
      var item = document.createElement("li");
      var order = document.createElement("span");
      var label = document.createElement("label");
      var labelInput = document.createElement("input");
      var colorLabel = document.createElement("label");
      var colorInput = document.createElement("input");
      var colorText = document.createElement("span");
      var probabilityLabel = document.createElement("label");
      var probabilityInput = document.createElement("input");
      var probabilitySuffix = document.createElement("span");
      var removeButton = document.createElement("button");

      item.className = "lottery-prize-row";
      item.dataset.index = String(index);
      order.className = "lottery-prize-order";
      order.textContent = String(index + 1).padStart(2, "0");

      label.className = "lottery-prize-name";
      label.dataset.label = "獎項名稱";
      labelInput.type = "text";
      labelInput.maxLength = 40;
      labelInput.value = prize.label;
      labelInput.placeholder = "獎項名稱";
      labelInput.setAttribute("aria-label", "第 " + (index + 1) + " 個獎項名稱");
      label.appendChild(labelInput);

      colorLabel.className = "lottery-prize-color";
      colorLabel.dataset.label = "區塊顏色";
      colorInput.type = "color";
      colorInput.value = prize.color;
      colorInput.setAttribute("aria-label", "第 " + (index + 1) + " 個獎項顏色");
      colorText.textContent = prize.color;
      colorLabel.appendChild(colorInput);
      colorLabel.appendChild(colorText);

      probabilityLabel.className = "lottery-prize-probability";
      probabilityLabel.dataset.label = "中獎機率";
      probabilityInput.type = "number";
      probabilityInput.inputMode = "decimal";
      probabilityInput.min = "0.01";
      probabilityInput.max = "99.99";
      probabilityInput.step = "0.01";
      probabilityInput.value = String(prize.probability);
      probabilityInput.setAttribute(
        "aria-label",
        "第 " + (index + 1) + " 個獎項中獎機率"
      );
      probabilitySuffix.textContent = "%";
      probabilityLabel.appendChild(probabilityInput);
      probabilityLabel.appendChild(probabilitySuffix);

      removeButton.className = "lottery-prize-remove";
      removeButton.type = "button";
      removeButton.textContent = "移除";
      removeButton.disabled = lotteryPrizes.length <= 2;
      removeButton.setAttribute("aria-label", "移除獎項 " + (prize.label || index + 1));
      removeButton.addEventListener("click", function () {
        removeLotteryPrize(index);
      });

      [labelInput, colorInput, probabilityInput].forEach(function (input) {
        input.addEventListener("input", function () {
          lotteryPrizes[index] = {
            prizeId: lotteryPrizes[index].prizeId,
            label: labelInput.value,
            color: colorInput.value.toUpperCase(),
            probability: Number(probabilityInput.value),
          };
          colorText.textContent = colorInput.value.toUpperCase();
          updateLotteryProbabilityTotal();
          scheduleAdminLotteryWheel();
          clearLotteryConfigError();
        });
      });

      item.appendChild(order);
      item.appendChild(label);
      item.appendChild(colorLabel);
      item.appendChild(probabilityLabel);
      item.appendChild(removeButton);
      fragment.appendChild(item);
    });
    list.replaceChildren(fragment);
    updateLotteryProbabilityTotal();
    scheduleAdminLotteryWheel();
  }

  function addLotteryPrize() {
    if (
      isLotteryLoading ||
      isLotteryMutationLoading ||
      lotteryPrizes.length >= 12
    ) {
      if (lotteryPrizes.length >= 12) {
        showLotteryConfigError("轉盤最多可設定 12 個獎項。");
      }
      return;
    }
    var colors = ["#C87965", "#82A7A0", "#A89CC8", "#E2A35B", "#557B64"];
    lotteryPrizes.push({
      prizeId: "",
      label: "新獎項",
      color: colors[(lotteryPrizes.length - 4 + colors.length) % colors.length],
      probability: 1,
    });
    renderLotteryPrizeRows();
    var inputs = byId("lottery-prize-list").querySelectorAll(
      ".lottery-prize-name input"
    );
    if (inputs.length) {
      inputs[inputs.length - 1].focus();
      inputs[inputs.length - 1].select();
    }
  }

  function removeLotteryPrize(index) {
    if (isLotteryMutationLoading || lotteryPrizes.length <= 2) return;
    lotteryPrizes.splice(index, 1);
    renderLotteryPrizeRows();
  }

  function updateLotteryProbabilityTotal() {
    var totalBasisPoints = lotteryPrizes.reduce(function (sum, prize) {
      var probability = Number(prize.probability);
      return sum + (Number.isFinite(probability) ? Math.round(probability * 100) : 0);
    }, 0);
    var output = byId("lottery-probability-total");
    output.textContent = (totalBasisPoints / 100).toFixed(2);
    output.closest(".lottery-probability-total").dataset.valid =
      totalBasisPoints === 10000 ? "true" : "false";
    return totalBasisPoints;
  }

  function validateLotterySubmission() {
    if (lotteryPrizes.length < 2 || lotteryPrizes.length > 12) {
      throw createError("INVALID_LOTTERY_PRIZES", "轉盤必須設定 2 到 12 個獎項。");
    }
    var totalBasisPoints = 0;
    var normalized = lotteryPrizes.map(function (prize) {
      var label = String(prize.label || "").trim();
      var color = String(prize.color || "").trim().toUpperCase();
      var probability = Number(prize.probability);
      var basisPoints = Math.round(probability * 100);
      if (!label || label.length > 40) {
        throw createError("INVALID_LOTTERY_PRIZES", "獎項名稱必須是 1 到 40 個字元。");
      }
      if (!/^#[0-9A-F]{6}$/.test(color)) {
        throw createError("INVALID_LOTTERY_COLOR", "請為每個獎項選擇有效顏色。");
      }
      if (
        !Number.isFinite(probability) ||
        probability <= 0 ||
        probability >= 100 ||
        Math.abs(basisPoints / 100 - probability) > 0.000001
      ) {
        throw createError(
          "INVALID_LOTTERY_PROBABILITY",
          "每個獎項機率必須介於 0.01% 到 99.99%，最多兩位小數。"
        );
      }
      totalBasisPoints += basisPoints;
      return { label: label, color: color, probability: basisPoints / 100 };
    });
    if (totalBasisPoints !== 10000) {
      throw createError("INVALID_LOTTERY_TOTAL", "所有獎項機率合計必須是 100%。");
    }
    return normalized;
  }

  function handleSaveLotteryConfig(event) {
    event.preventDefault();
    if (isLotteryLoading || isLotteryMutationLoading) return;
    if (!isCreatingLotteryType && !selectedLotteryTypeId) {
      showLotteryConfigError("請先新增或選擇一個轉盤。");
      return;
    }
    clearLotteryConfigError();
    var nameInput = byId("lottery-type-name-input");
    var lotteryTypeName = String(nameInput.value || "").trim();
    if (!lotteryTypeName || lotteryTypeName.length > 40) {
      showLotteryConfigError("轉盤名稱必須是 1 到 40 個字元。");
      nameInput.focus();
      return;
    }
    if (
      lotteryTypes.some(function (type) {
        return (
          type.lotteryTypeId !== selectedLotteryTypeId &&
          type.name.toLowerCase() === lotteryTypeName.toLowerCase()
        );
      })
    ) {
      showLotteryConfigError("已有相同名稱的轉盤。");
      nameInput.focus();
      return;
    }
    var submittedPrizes;
    try {
      submittedPrizes = validateLotterySubmission();
    } catch (error) {
      showLotteryConfigError(normalizeError(error).message);
      return;
    }

    if (isDemoSession) {
      var now = new Date().toISOString();
      var selectedDemoType = getSelectedLotteryType();
      var savedLotteryTypeId = selectedDemoType
        ? selectedDemoType.lotteryTypeId
        : "LTY-PREVIEW" + String(lotteryTypes.length + 1).padStart(3, "0");
      var savedLottery = normalizeLotteryConfig({
          lotteryTypeId: savedLotteryTypeId,
          configVersion: "LCF-PREVIEW00002",
          updatedAt: now,
          prizes: submittedPrizes.map(function (prize, index) {
            return {
              prizeId:
                "LPR-PREVIEW" + String(index + 1).padStart(3, "0"),
              label: prize.label,
              color: prize.color,
              probability: prize.probability,
            };
          }),
        }, savedLotteryTypeId);
      if (selectedDemoType) {
        selectedDemoType.name = lotteryTypeName;
        selectedDemoType.lottery = savedLottery;
      } else {
        lotteryTypes.push({
          lotteryTypeId: savedLotteryTypeId,
          name: lotteryTypeName,
          status: "active",
          createdAt: now,
          lottery: savedLottery,
        });
      }
      selectLotteryType(savedLotteryTypeId);
      showToast(
        selectedDemoType
          ? "預覽：完整轉盤已更新"
          : "預覽：第一個轉盤已建立"
      );
      return;
    }

    isLotteryMutationLoading = true;
    setButtonBusy(byId("save-lottery-button"), true, "正在儲存");
    updateOperationControls();
    sendAdminRequest("adminSaveLotteryConfig", {
      lotteryTypeId: selectedLotteryTypeId,
      lotteryTypeName: lotteryTypeName,
      lotteryPrizes: submittedPrizes,
    })
      .then(function (response) {
        assertSuccessfulResponse(response);
        if (
          !response.data ||
          !response.data.lottery ||
          !response.data.lotteryType
        ) {
          throw createError("INVALID_RESPONSE", "後台回傳的完整轉盤資料不正確。");
        }
        var savedType = normalizeLotteryTypes([
          response.data.lotteryType,
        ])[0];
        var existingIndex = lotteryTypes.findIndex(function (type) {
          return type.lotteryTypeId === savedType.lotteryTypeId;
        });
        if (existingIndex >= 0) lotteryTypes[existingIndex] = savedType;
        else lotteryTypes.push(savedType);
        selectLotteryType(savedType.lotteryTypeId);
        showToast(
          response.data.duplicate
            ? "完整轉盤已儲存，未重複建立"
            : response.data.created
              ? "轉盤已新增並啟用"
              : "完整轉盤設定已更新"
        );
      })
      .catch(function (error) {
        showLotteryConfigError(normalizeError(error).message);
      })
      .finally(function () {
        isLotteryMutationLoading = false;
        setButtonBusy(byId("save-lottery-button"), false);
        updateOperationControls();
      });
  }

  function handleSavePointCardSetting(event) {
    event.preventDefault();
    if (isLotteryMutationLoading) return;
    var input = byId("point-card-target-input");
    var targetPoints = Number(input.value);
    clearPointCardSettingError();
    if (!Number.isInteger(targetPoints) || targetPoints < 1 || targetPoints > 9999) {
      showPointCardSettingError(
        "集點卡總點數必須是 1 到 9999 的整數。",
        input
      );
      input.focus();
      return;
    }
    var rewardRules;
    try {
      rewardRules = validatePointCardRewardRules(targetPoints);
    } catch (_error) {
      showPointCardSettingError(
        normalizeError(_error).message ||
          "抽獎節點必須是不重複的整數，最後一個節點需等於 " +
          targetPoints +
          " 點。"
      );
      byId("point-card-setting-error").focus();
      return;
    }
    var rewardMilestones = rewardRules.map(function (rule) {
      return rule.points;
    });
    if (isDemoSession) {
      pointCardSetting = {
        settingVersion: "PCS-PREVIEW00002",
        targetPoints: targetPoints,
        rewardMilestones: rewardMilestones,
        rewardRules: rewardRules,
        effectiveAt: new Date().toISOString(),
      };
      pointCardRewardRules = rewardRules.map(function (rule) {
        return {
          points: rule.points,
          lotteryTypeId: rule.lotteryTypeId,
        };
      });
      renderPointCardSetting();
      clearPointCardSettingError();
      showToast("預覽：集點卡規則已更新");
      return;
    }
    isLotteryMutationLoading = true;
    setButtonBusy(byId("save-point-card-setting-button"), true, "正在儲存");
    updateOperationControls();
    sendAdminRequest("adminSavePointCardSetting", {
      pointCardTarget: targetPoints,
      pointCardRewards: rewardRules,
    })
      .then(function (response) {
        assertSuccessfulResponse(response);
        if (!response.data || !response.data.pointCardSetting) {
          throw createError("INVALID_RESPONSE", "後台回傳的集點卡規則格式不完整。");
        }
        pointCardSetting = normalizePointCardSetting(response.data.pointCardSetting);
        pointCardRewardRules = pointCardSetting.rewardRules.map(function (rule) {
          return {
            points: rule.points,
            lotteryTypeId: rule.lotteryTypeId,
          };
        });
        renderPointCardSetting();
        clearPointCardSettingError();
        showToast(
          response.data.changed === false
            ? "集點卡規則未變更"
            : "新的集點卡與抽獎節點已啟用"
        );
      })
      .catch(function (error) {
        showPointCardSettingError(normalizeError(error).message);
        byId("point-card-setting-error").focus();
      })
      .finally(function () {
        isLotteryMutationLoading = false;
        setButtonBusy(byId("save-point-card-setting-button"), false);
        updateOperationControls();
      });
  }

  function openDeleteLotteryTypeDialog() {
    var selectedType = getSelectedLotteryType();
    if (!selectedType || isLotteryMutationLoading) return;
    clearDeleteLotteryTypeError();
    byId("delete-lottery-type-name").textContent = selectedType.name;
    openDialog(byId("delete-lottery-type-dialog"));
  }

  function closeDeleteLotteryTypeDialog() {
    clearDeleteLotteryTypeError();
    closeDialog(byId("delete-lottery-type-dialog"));
  }

  function handleDeleteLotteryType() {
    var selectedType = getSelectedLotteryType();
    if (!selectedType || isLotteryMutationLoading) return;
    if (isDemoSession) {
      lotteryTypes = lotteryTypes.filter(function (type) {
        return type.lotteryTypeId !== selectedType.lotteryTypeId;
      });
      selectedLotteryTypeId = lotteryTypes.length ? lotteryTypes[0].lotteryTypeId : "";
      closeDeleteLotteryTypeDialog();
      renderLotteryTypes();
      selectLotteryType(selectedLotteryTypeId);
      showToast("預覽：轉盤類型已刪除");
      return;
    }
    isLotteryMutationLoading = true;
    byId("delete-lottery-type-dialog").dataset.busy = "true";
    setButtonBusy(byId("confirm-delete-lottery-type-button"), true, "正在刪除");
    updateOperationControls();
    sendAdminRequest("adminDeleteLotteryType", {
      lotteryTypeId: selectedType.lotteryTypeId,
    })
      .then(function (response) {
        assertSuccessfulResponse(response);
        if (
          !response.data ||
          response.data.deleted !== true ||
          response.data.lotteryTypeId !== selectedType.lotteryTypeId
        ) {
          throw createError("INVALID_RESPONSE", "後台未確認轉盤類型已刪除。");
        }
        lotteryTypes = lotteryTypes.filter(function (type) {
          return type.lotteryTypeId !== selectedType.lotteryTypeId;
        });
        selectedLotteryTypeId = lotteryTypes.length ? lotteryTypes[0].lotteryTypeId : "";
        closeDeleteLotteryTypeDialog();
        renderLotteryTypes();
        selectLotteryType(selectedLotteryTypeId);
        showToast("轉盤類型已刪除，歷史抽獎紀錄仍保留");
      })
      .catch(function (error) {
        showDeleteLotteryTypeError(normalizeError(error).message);
        showToast("無法刪除轉盤，請查看對話框說明", "error");
        byId("delete-lottery-type-error").focus();
      })
      .finally(function () {
        isLotteryMutationLoading = false;
        byId("delete-lottery-type-dialog").dataset.busy = "false";
        setButtonBusy(byId("confirm-delete-lottery-type-button"), false);
        updateOperationControls();
      });
  }

  function drawAdminLotteryWheel() {
    var canvas = byId("admin-lottery-wheel");
    window.LotteryWheel.draw(canvas, lotteryPrizes, {
      separatorColor: "rgba(243, 240, 231, 0.9)",
    });
  }

  function scheduleAdminLotteryWheel() {
    if (adminWheelRenderFrame) return;
    adminWheelRenderFrame = window.requestAnimationFrame(function () {
      adminWheelRenderFrame = 0;
      drawAdminLotteryWheel();
    });
  }

  function showLotteryConfigError(message) {
    var error = byId("lottery-config-error");
    error.textContent = message;
    error.hidden = false;
  }

  function clearLotteryConfigError() {
    var error = byId("lottery-config-error");
    error.textContent = "";
    error.hidden = true;
  }

  function showPointCardSettingError(message, invalidControl) {
    var error = byId("point-card-setting-error");
    error.textContent = message;
    error.hidden = false;
    if (invalidControl) invalidControl.setAttribute("aria-invalid", "true");
  }

  function clearPointCardSettingError() {
    var error = byId("point-card-setting-error");
    error.textContent = "";
    error.hidden = true;
    byId("point-card-target-input").removeAttribute("aria-invalid");
  }

  function showDeleteLotteryTypeError(message) {
    var error = byId("delete-lottery-type-error");
    error.textContent = message;
    error.hidden = false;
  }

  function clearDeleteLotteryTypeError() {
    var error = byId("delete-lottery-type-error");
    error.textContent = "";
    error.hidden = true;
  }

  function normalizeLotteryDraw(value) {
    value = value && typeof value === "object" ? value : {};
    var drawId = String(value.drawId || "").trim();
    var configVersion = String(value.configVersion || "").trim();
    var prizeId = String(value.prizeId || "").trim();
    var prizeLabel = String(value.prizeLabel || "").trim();
    var prizeColor = String(value.prizeColor || "").trim().toUpperCase();
    var memberId = String(value.memberId || "").trim();
    var memberDisplayName = String(value.memberDisplayName || "LINE 會員").trim();
    var lotteryTypeId = String(value.lotteryTypeId || "").trim();
    var lotteryTypeName = String(value.lotteryTypeName || "").trim();
    var ticketCost = Number(value.ticketCost);
    var originalPointBalance = Number(value.originalPointBalance);
    var pointBalance = Number(value.pointBalance);
    var drawnAt = String(value.drawnAt || "").trim();
    if (
      !/^LDW-[A-Z0-9]{16}$/.test(drawId) ||
      !/^LCF-[A-Z0-9]{12}$/.test(configVersion) ||
      !/^LPR-[A-Z0-9]{10}$/.test(prizeId) ||
      !prizeLabel ||
      prizeLabel.length > 40 ||
      !/^#[0-9A-F]{6}$/.test(prizeColor) ||
      !/^MBR-[A-Z0-9]{10}$/.test(memberId) ||
      !memberDisplayName ||
      !/^LTY-[A-Z0-9]{10}$/.test(lotteryTypeId) ||
      !lotteryTypeName ||
      lotteryTypeName.length > 40 ||
      (ticketCost !== 0 && ticketCost !== 5) ||
      !Number.isSafeInteger(originalPointBalance) ||
      !Number.isSafeInteger(pointBalance) ||
      originalPointBalance < ticketCost ||
      pointBalance !== originalPointBalance - ticketCost ||
      Number.isNaN(new Date(drawnAt).getTime())
    ) {
      throw createError("INVALID_RESPONSE", "後台回傳的抽獎紀錄格式不正確。");
    }
    return {
      drawId: drawId,
      configVersion: configVersion,
      prizeId: prizeId,
      prizeLabel: prizeLabel,
      prizeColor: prizeColor,
      memberId: memberId,
      memberDisplayName: memberDisplayName.slice(0, 100),
      lotteryTypeId: lotteryTypeId,
      lotteryTypeName: lotteryTypeName,
      ticketCost: ticketCost,
      originalPointBalance: originalPointBalance,
      pointBalance: pointBalance,
      drawnAt: drawnAt,
    };
  }

  function renderLotteryHistoryLoading() {
    var list = byId("lottery-history-list");
    var hasItems = list.childElementCount > 0;
    byId("lottery-history-loading").hidden = hasItems;
    list.hidden = !hasItems;
    list.setAttribute("aria-busy", "true");
    byId("lottery-history-empty").hidden = true;
    byId("lottery-history-error").hidden = true;
  }

  function renderLotteryHistoryError(errorValue) {
    var list = byId("lottery-history-list");
    byId("lottery-history-loading").hidden = true;
    list.hidden = list.childElementCount === 0;
    list.setAttribute("aria-busy", "false");
    byId("lottery-history-empty").hidden = true;
    byId("lottery-history-error").textContent =
      "抽獎紀錄載入失敗：" + normalizeError(errorValue).message;
    byId("lottery-history-error").hidden = false;
  }

  function renderLotteryHistory(draws, hasMore) {
    lotteryDraws = (Array.isArray(draws) ? draws : []).map(normalizeLotteryDraw);
    lotteryDrawsHaveMore = Boolean(hasMore);
    var list = byId("lottery-history-list");
    var fragment = document.createDocumentFragment();
    byId("lottery-history-loading").hidden = true;
    byId("lottery-history-error").hidden = true;
    list.hidden = lotteryDraws.length === 0;
    list.setAttribute("aria-busy", "false");
    byId("lottery-history-empty").hidden = lotteryDraws.length !== 0;
    byId("lottery-history-summary").textContent = lotteryDraws.length
      ? "最近 " +
        lotteryDraws.length +
        " 筆抽獎紀錄" +
        (lotteryDrawsHaveMore ? "（僅顯示最新 50 筆）" : "")
      : "查看會員使用集點卡節點資格的抽獎結果。";

    lotteryDraws.forEach(function (draw) {
      var item = document.createElement("li");
      var swatch = document.createElement("span");
      var main = document.createElement("div");
      var member = document.createElement("strong");
      var detail = document.createElement("small");
      var prize = document.createElement("strong");
      var meta = document.createElement("div");
      var time = document.createElement("time");
      var balance = document.createElement("span");
      item.className = "lottery-history-row";
      swatch.className = "lottery-history-swatch";
      swatch.style.backgroundColor = draw.prizeColor;
      main.className = "lottery-history-main";
      member.textContent = draw.memberDisplayName;
      detail.textContent =
        draw.memberId + " · " + draw.lotteryTypeName + " · " + draw.drawId;
      prize.className = "lottery-history-prize";
      prize.textContent = draw.prizeLabel;
      time.dateTime = draw.drawnAt;
      time.textContent = formatDateTime(draw.drawnAt);
      balance.textContent =
        draw.ticketCost === 0
          ? "累計 " + formatNumber(draw.pointBalance) + " 點 · 節點資格已使用"
          : formatNumber(draw.originalPointBalance) +
            " → " +
            formatNumber(draw.pointBalance) +
            " 點";
      main.appendChild(member);
      main.appendChild(detail);
      meta.appendChild(time);
      meta.appendChild(balance);
      item.appendChild(swatch);
      item.appendChild(main);
      item.appendChild(prize);
      item.appendChild(meta);
      fragment.appendChild(item);
    });
    list.replaceChildren(fragment);
  }

  function handleCreatePointType(event) {
    event.preventDefault();
    if (isPointMutationLoading || !isPointWorkspaceAvailable) return;
    clearPointFormError("point-type-error");
    var input = byId("point-amount-input");
    var pointAmount = Number(input.value);
    var expiryMode = getCheckedValue("expiryMode");
    var redemptionMode = getCheckedValue("redemptionMode");

    if (
      !Number.isInteger(pointAmount) ||
      pointAmount < 1 ||
      pointAmount > 9999
    ) {
      showPointFormError("point-type-error", "請輸入 1 至 9999 的整數點數。");
      input.focus();
      return;
    }

    if (
      pointTypes.some(function (pointType) {
        return (
          pointType.points === pointAmount &&
          pointType.expiryMode === expiryMode &&
          pointType.redemptionMode === redemptionMode &&
          pointType.status === "active"
        );
      })
    ) {
      showPointFormError("point-type-error", "這個點數類型已經存在。");
      return;
    }

    if (isDemoSession) {
      var previewType = demoPointType(
        "PTY-PREVIEW" + String(pointTypes.length + 1).padStart(3, "0"),
        pointAmount,
        expiryMode,
        redemptionMode
      );
      pointTypes.unshift(normalizePointType(previewType));
      selectedPointTypeId = previewType.pointTypeId;
      input.value = "";
      renderPointTypes();
      showToast("預覽：已新增 " + pointAmount + " 點類型");
      return;
    }

    isPointMutationLoading = true;
    setButtonBusy(byId("create-point-type-button"), true, "正在新增");
    updateOperationControls();

    sendAdminRequest("adminCreatePointType", {
      pointAmount: pointAmount,
      expiryMode: expiryMode,
      redemptionMode: redemptionMode,
    })
      .then(function (response) {
        assertSuccessfulResponse(response);
        if (!response.data || !response.data.pointType) {
          throw createError("INVALID_RESPONSE", "後台回傳的點數類型格式不完整。");
        }
        var pointType = normalizePointType(response.data.pointType);
        var existingIndex = pointTypes.findIndex(function (item) {
          return item.pointTypeId === pointType.pointTypeId;
        });
        if (existingIndex >= 0) pointTypes[existingIndex] = pointType;
        else pointTypes.unshift(pointType);
        selectedPointTypeId = pointType.pointTypeId;
        input.value = "";
        renderPointTypes();
        showToast("已新增 " + pointType.label);
      })
      .catch(function (error) {
        if (isAuthorizationError(error)) {
          handleFatalError(error);
          return;
        }
        showPointFormError("point-type-error", normalizeError(error).message);
      })
      .finally(function () {
        isPointMutationLoading = false;
        setButtonBusy(byId("create-point-type-button"), false);
        updateOperationControls();
      });
  }

  function handleCreatePointCampaign(event) {
    event.preventDefault();
    if (isPointMutationLoading || !isPointWorkspaceAvailable) return;
    clearPointFormError("point-campaign-error");
    var pointType = getSelectedPointType();
    if (!pointType || pointType.status !== "active") {
      showPointFormError("point-campaign-error", "請先選擇可使用的點數類型。");
      return;
    }

    var expiryDate = null;
    if (pointType.expiryMode === "limited") {
      var expiryInput = byId("point-expiry-input");
      expiryDate = new Date(expiryInput.value);
      if (
        !expiryInput.value ||
        Number.isNaN(expiryDate.getTime()) ||
        expiryDate.getTime() <= Date.now() + 5 * 60 * 1000 ||
        expiryDate.getTime() > Date.now() + 366 * 86400000
      ) {
        showPointFormError(
          "point-campaign-error",
          "領取期限需晚於現在至少 5 分鐘，且不可超過一年。"
        );
        expiryInput.focus();
        return;
      }
    }

    if (isDemoSession) {
      showPointQrDialog(
        {
          label: pointType.label,
          points: pointType.points,
          expiryMode: pointType.expiryMode,
          redemptionMode: pointType.redemptionMode,
          expiresAt: expiryDate ? expiryDate.toISOString() : "",
        },
        "",
        true
      );
      return;
    }

    if (
      !window.PersonaQr ||
      typeof window.PersonaQr.renderSvg !== "function" ||
      typeof window.PersonaQr.toPngDataUrl !== "function"
    ) {
      showPointFormError(
        "point-campaign-error",
        "QR 產生元件尚未載入，請重新整理頁面後再試。"
      );
      return;
    }

    isPointMutationLoading = true;
    setButtonBusy(byId("create-point-campaign-button"), true, "正在產生");
    updateOperationControls();

    sendAdminRequest("adminCreatePointCampaign", {
      pointTypeId: pointType.pointTypeId,
      expiresAt: expiryDate ? expiryDate.toISOString() : "",
    })
      .then(function (response) {
        assertSuccessfulResponse(response);
        if (
          !response.data ||
          !response.data.campaign ||
          !response.data.claimUrl
        ) {
          throw createError("INVALID_RESPONSE", "後台回傳的 QR 活動格式不完整。");
        }
        showPointQrDialog(
          response.data.campaign,
          response.data.claimUrl,
          false
        );
        showToast("點數 QR Code 已產生");
      })
      .catch(function (error) {
        if (isAuthorizationError(error)) {
          handleFatalError(error);
          return;
        }
        showPointFormError("point-campaign-error", normalizeError(error).message);
      })
      .finally(function () {
        isPointMutationLoading = false;
        setButtonBusy(byId("create-point-campaign-button"), false);
        updateOperationControls();
      });
  }

  function normalizePointType(value) {
    value = value && typeof value === "object" ? value : {};
    var pointTypeId = String(value.pointTypeId || "");
    var points = Number(value.points);
    var label = String(value.label || "").trim();
    var status = String(value.status || "").trim().toLowerCase();
    var expiryMode = String(value.expiryMode || "").trim().toLowerCase();
    var redemptionMode = String(value.redemptionMode || "").trim().toLowerCase();
    if (
      !/^PTY-[A-Z0-9]{10}$/.test(pointTypeId) ||
      !Number.isInteger(points) ||
      points < 1 ||
      points > 9999 ||
      label !== points + " 點" ||
      (status !== "active" && status !== "inactive") ||
      (expiryMode !== "limited" && expiryMode !== "unlimited") ||
      (redemptionMode !== "once_per_member" &&
        redemptionMode !== "repeatable" &&
        redemptionMode !== "single_member")
    ) {
      throw createError("INVALID_RESPONSE", "後台回傳的點數類型格式不正確。");
    }
    return {
      pointTypeId: pointTypeId,
      label: label,
      points: points,
      status: status,
      expiryMode: expiryMode,
      redemptionMode: redemptionMode,
      createdAt: value.createdAt || "",
      updatedAt: value.updatedAt || "",
    };
  }

  function normalizePointHistoryEntry(value) {
    value = value && typeof value === "object" ? value : {};
    var redemptionId = String(value.redemptionId || "").trim();
    var campaignId = String(value.campaignId || "").trim();
    var pointTypeId = String(value.pointTypeId || "").trim();
    var memberId = String(value.memberId || "").trim();
    var points = Number(value.points);
    var balanceAfter = Number(value.balanceAfter);
    var label = String(value.label || "").trim();
    var redeemedAt = String(value.redeemedAt || "").trim();
    var redemptionMode = String(value.redemptionMode || "").trim().toLowerCase();
    var source = String(value.source || "").trim().toLowerCase();
    if (
      !/^RDM-[A-Z0-9]{16}$/.test(redemptionId) ||
      !/^PCG-[A-Z0-9]{10}$/.test(campaignId) ||
      !/^PTY-[A-Z0-9]{10}$/.test(pointTypeId) ||
      !/^MBR-[A-Z0-9]{10}$/.test(memberId) ||
      !Number.isInteger(points) ||
      points < 1 ||
      points > 9999 ||
      !Number.isSafeInteger(balanceAfter) ||
      balanceAfter < points ||
      label !== points + " 點" ||
      Number.isNaN(new Date(redeemedAt).getTime()) ||
      (redemptionMode !== "once_per_member" &&
        redemptionMode !== "repeatable" &&
        redemptionMode !== "single_member") ||
      source !== "qr"
    ) {
      throw createError("INVALID_RESPONSE", "後台回傳的點數使用紀錄格式不正確。");
    }
    return {
      redemptionId: redemptionId,
      campaignId: campaignId,
      pointTypeId: pointTypeId,
      memberId: memberId,
      label: label,
      points: points,
      balanceAfter: balanceAfter,
      redeemedAt: redeemedAt,
      redemptionMode: redemptionMode,
      source: source,
    };
  }

  function renderAdminPointHistoryLoading() {
    var loading = byId("point-history-loading");
    var list = byId("admin-point-history-list");
    var empty = byId("point-history-empty");
    var error = byId("point-history-error");
    var hasItems = list.childElementCount > 0;
    loading.hidden = hasItems;
    list.hidden = !hasItems;
    list.setAttribute("aria-busy", "true");
    empty.hidden = true;
    error.hidden = true;
  }

  function renderAdminPointHistoryError(errorValue) {
    var loading = byId("point-history-loading");
    var list = byId("admin-point-history-list");
    var empty = byId("point-history-empty");
    var error = byId("point-history-error");
    var message = normalizeError(errorValue).message;
    loading.hidden = true;
    list.hidden = list.childElementCount === 0;
    list.setAttribute("aria-busy", "false");
    empty.hidden = true;
    error.textContent = "點數使用紀錄載入失敗：" + message;
    error.hidden = false;
  }

  function renderAdminPointHistory(history, hasMore) {
    var loading = byId("point-history-loading");
    var list = byId("admin-point-history-list");
    var empty = byId("point-history-empty");
    var error = byId("point-history-error");
    var summary = byId("point-history-summary");
    var fragment = document.createDocumentFragment();
    pointHistory = (Array.isArray(history) ? history : []).map(normalizePointHistoryEntry);
    pointHistoryHasMore = Boolean(hasMore);
    loading.hidden = true;
    error.hidden = true;
    list.hidden = pointHistory.length === 0;
    list.setAttribute("aria-busy", "false");
    empty.hidden = pointHistory.length !== 0;

    if (pointHistory.length === 0) {
      list.replaceChildren();
      summary.textContent = "查看會員透過 QR 領取的最新紀錄。";
      return;
    }

    summary.textContent =
      "最近 " +
      pointHistory.length +
      " 筆領取紀錄" +
      (pointHistoryHasMore ? "（僅顯示最新 50 筆）" : "");
    pointHistory.forEach(function (entry) {
      var item = document.createElement("li");
      var main = document.createElement("div");
      var member = document.createElement("strong");
      var details = document.createElement("small");
      var amount = document.createElement("strong");
      var meta = document.createElement("div");
      var time = document.createElement("time");
      var balance = document.createElement("span");
      var mode = document.createElement("span");
      item.className = "admin-point-history-row";
      main.className = "admin-point-history-main";
      member.className = "admin-point-history-member";
      details.className = "admin-point-history-details";
      amount.className = "admin-point-history-amount";
      meta.className = "admin-point-history-meta";
      member.textContent = entry.memberId;
      details.textContent = entry.campaignId + " · " + entry.pointTypeId;
      amount.textContent = "+" + formatNumber(entry.points) + " 點";
      time.dateTime = entry.redeemedAt;
      time.textContent = formatDateTime(entry.redeemedAt);
      balance.textContent = "領取後 " + formatNumber(entry.balanceAfter) + " 點";
      mode.textContent = formatPointHistoryMode(entry.redemptionMode);
      main.appendChild(member);
      main.appendChild(details);
      meta.appendChild(time);
      meta.appendChild(balance);
      meta.appendChild(mode);
      item.appendChild(main);
      item.appendChild(amount);
      item.appendChild(meta);
      fragment.appendChild(item);
    });
    list.replaceChildren(fragment);
  }

  function formatPointHistoryMode(mode) {
    if (mode === "repeatable") return "可重複";
    if (mode === "single_member") return "單一會員";
    return "每位會員一次";
  }

  function renderPointTypes() {
    var list = byId("point-type-list");
    var fragment = document.createDocumentFragment();
    var activePointTypes = pointTypes.filter(function (pointType) {
      return pointType.status === "active";
    });

    if (activePointTypes.length === 0) {
      var empty = document.createElement("li");
      empty.className = "point-type-empty";
      empty.textContent = isPointWorkspaceAvailable
        ? "尚未建立點數類型，請先輸入 1、2、3 等整數點數。"
        : "點數功能目前無法使用，請稍後重新整理；會員資料頁不受影響。";
      fragment.appendChild(empty);
    } else {
      activePointTypes.forEach(function (pointType) {
        var item = document.createElement("li");
        var button = document.createElement("button");
        var deleteButton = document.createElement("button");
        var label = document.createElement("strong");
        var status = document.createElement("small");
        item.className = "point-type-row";
        button.type = "button";
        button.className = "point-type-option";
        button.dataset.pointTypeId = pointType.pointTypeId;
        button.setAttribute(
          "aria-pressed",
          String(pointType.pointTypeId === selectedPointTypeId)
        );
        button.disabled =
          isListLoading ||
          isPointMutationLoading ||
          !isPointWorkspaceAvailable ||
          pointType.status !== "active";
        label.textContent = pointType.label;
        status.textContent = formatPointTypeRules(pointType);
        button.appendChild(label);
        button.appendChild(status);
        button.addEventListener("click", function () {
          selectPointType(pointType.pointTypeId);
        });
        deleteButton.type = "button";
        deleteButton.className = "point-type-delete-button";
        deleteButton.dataset.pointTypeId = pointType.pointTypeId;
        deleteButton.textContent = "刪除";
        deleteButton.setAttribute("aria-label", "刪除 " + pointType.label + " 點數類型");
        deleteButton.disabled =
          isListLoading || isPointMutationLoading || !isPointWorkspaceAvailable;
        deleteButton.addEventListener("click", function () {
          openDeletePointTypeDialog(pointType);
        });
        item.appendChild(button);
        item.appendChild(deleteButton);
        fragment.appendChild(item);
      });
    }
    list.replaceChildren(fragment);

    var selected = getSelectedPointType();
    byId("selected-point-label").textContent = selected
      ? selected.label
      : "尚未建立點數類型";
    byId("selected-point-rules").textContent = selected
      ? formatPointTypeRules(selected)
      : "建立類型後即可產生 QR Code。";
    syncPointCampaignFields(selected);
    byId("create-point-campaign-button").disabled =
      !selected ||
      selected.status !== "active" ||
      isListLoading ||
      isPointMutationLoading ||
      !isPointWorkspaceAvailable;
    syncPointTypeControls();
  }

  function syncPointTypeControls() {
    var list = byId("point-type-list");
    var busy = isListLoading || isPointMutationLoading;
    list.setAttribute("aria-busy", String(isPointMutationLoading));
    list.querySelectorAll(".point-type-option").forEach(function (button) {
      var pointType = pointTypes.find(function (item) {
        return item.pointTypeId === button.dataset.pointTypeId;
      });
      button.disabled =
        busy ||
        !isPointWorkspaceAvailable ||
        !pointType ||
        pointType.status !== "active";
    });
    list.querySelectorAll(".point-type-delete-button").forEach(function (button) {
      button.disabled = busy || !isPointWorkspaceAvailable;
    });
    var selected = getSelectedPointType();
    byId("create-point-campaign-button").disabled =
      !selected ||
      selected.status !== "active" ||
      busy ||
      !isPointWorkspaceAvailable;
  }

  function selectPointType(pointTypeId) {
    var match = pointTypes.find(function (pointType) {
      return pointType.pointTypeId === pointTypeId && pointType.status === "active";
    });
    if (!match) return;
    selectedPointTypeId = match.pointTypeId;
    clearPointFormError("point-campaign-error");
    renderPointTypes();
  }

  function getCheckedValue(name) {
    var checked = document.querySelector('input[name="' + name + '"]:checked');
    return checked ? String(checked.value || "") : "";
  }

  function formatPointTypeRules(pointType) {
    if (!pointType) return "";
    return (
      (pointType.expiryMode === "unlimited" ? "無期限" : "有期限") +
      " · " +
      (pointType.redemptionMode === "repeatable"
        ? "可重複領取"
        : pointType.redemptionMode === "single_member"
          ? "僅限一位會員領取"
          : "每位會員限領一次")
    );
  }

  function syncPointCampaignFields(pointType) {
    var expiryField = byId("point-expiry-field");
    var expiryInput = byId("point-expiry-input");
    var notice = byId("point-rule-notice");
    var isUnlimited = Boolean(pointType && pointType.expiryMode === "unlimited");
    var isRepeatable = Boolean(pointType && pointType.redemptionMode === "repeatable");
    var isSingleMember = Boolean(
      pointType && pointType.redemptionMode === "single_member"
    );

    expiryField.hidden = isUnlimited;
    expiryInput.required = !isUnlimited;
    expiryInput.disabled =
      isUnlimited ||
      isListLoading ||
      isPointMutationLoading ||
      !isPointWorkspaceAvailable;
    notice.dataset.tone = isUnlimited && isRepeatable ? "warning" : "default";
    if (!pointType) {
      notice.textContent = "請先建立並選擇一個點數類型。";
    } else if (isSingleMember) {
      notice.textContent = "這張 QR 只能由一位會員成功領取，第一位領取後即失效。";
    } else if (isUnlimited && isRepeatable) {
      notice.textContent =
        "永久重複領取 QR：不需設定日期，產生後任何可登入會員都可反覆掃描領點。";
    } else if (isRepeatable) {
      notice.textContent = "到期前，會員每次重新掃描並確認都可再次領取。";
    } else if (isUnlimited) {
      notice.textContent = "QR 永久有效，但每位會員只能成功領取一次。";
    } else {
      notice.textContent = "到期前，每位會員只能成功領取一次。";
    }
  }

  function openDeletePointTypeDialog(pointType) {
    if (!pointType || pointType.status !== "active" || isPointMutationLoading) return;
    pendingDeletePointType = pointType;
    byId("delete-point-type-label").textContent =
      pointType.label + "｜" + formatPointTypeRules(pointType);
    var dialog = byId("delete-point-type-dialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDeletePointTypeDialog() {
    var dialog = byId("delete-point-type-dialog");
    if (dialog.dataset.busy === "true") return;
    pendingDeletePointType = null;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  function handleDeletePointType() {
    if (!pendingDeletePointType || isPointMutationLoading) return;
    var pointType = pendingDeletePointType;

    if (isDemoSession) {
      pointType.status = "inactive";
      pendingDeletePointType = null;
      byId("delete-point-type-dialog").removeAttribute("open");
      selectFirstActivePointType();
      renderPointTypes();
      showToast("預覽：已刪除 " + pointType.label + " 類型");
      return;
    }

    isPointMutationLoading = true;
    byId("delete-point-type-dialog").dataset.busy = "true";
    setButtonBusy(byId("confirm-delete-point-type-button"), true, "正在刪除");
    updateOperationControls();
    sendAdminRequest("adminDeletePointType", {
      pointTypeId: pointType.pointTypeId,
    })
      .then(function (response) {
        assertSuccessfulResponse(response);
        if (!response.data || !response.data.pointType) {
          throw createError("INVALID_RESPONSE", "後台回傳的刪除結果格式不完整。");
        }
        var deletedType = normalizePointType(response.data.pointType);
        if (deletedType.status !== "inactive") {
          throw createError("INVALID_RESPONSE", "後台未確認點數類型已刪除。");
        }
        var index = pointTypes.findIndex(function (item) {
          return item.pointTypeId === deletedType.pointTypeId;
        });
        if (index >= 0) pointTypes[index] = deletedType;
        pendingDeletePointType = null;
        delete byId("delete-point-type-dialog").dataset.busy;
        closeDeletePointTypeDialog();
        selectFirstActivePointType();
        renderPointTypes();
        showToast("已刪除 " + deletedType.label + " 類型");
      })
      .catch(function (error) {
        if (isAuthorizationError(error)) {
          handleFatalError(error);
          return;
        }
        showToast(normalizeError(error).message, "error");
      })
      .finally(function () {
        isPointMutationLoading = false;
        delete byId("delete-point-type-dialog").dataset.busy;
        setButtonBusy(byId("confirm-delete-point-type-button"), false);
        updateOperationControls();
      });
  }

  function selectFirstActivePointType() {
    var selected = getSelectedPointType();
    if (selected && selected.status === "active") return;
    var firstActive = pointTypes.find(function (pointType) {
      return pointType.status === "active";
    });
    selectedPointTypeId = firstActive ? firstActive.pointTypeId : "";
  }

  function getSelectedPointType() {
    return pointTypes.find(function (pointType) {
      return pointType.pointTypeId === selectedPointTypeId;
    }) || null;
  }

  function setDefaultPointExpiry() {
    var input = byId("point-expiry-input");
    var now = new Date();
    var minimum = new Date(now.getTime() + 5 * 60 * 1000);
    var defaultExpiry = new Date(now.getTime() + 30 * 86400000);
    input.min = toLocalDateTimeValue(minimum);
    input.max = toLocalDateTimeValue(new Date(now.getTime() + 366 * 86400000));
    if (!input.value || new Date(input.value).getTime() <= now.getTime()) {
      input.value = toLocalDateTimeValue(defaultExpiry);
    }
  }

  function toLocalDateTimeValue(value) {
    var date = new Date(value);
    var local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function showPointFormError(id, message) {
    var output = byId(id);
    output.textContent = message || "目前無法處理點數操作，請稍後再試。";
    output.hidden = false;
  }

  function clearPointFormError(id) {
    var output = byId(id);
    output.textContent = "";
    output.hidden = true;
  }

  function showPointQrDialog(campaign, claimUrl, preview) {
    campaign = campaign && typeof campaign === "object" ? campaign : {};
    var campaignPoints = Number(campaign.points);
    var campaignLabel = String(campaign.label || "").trim();
    var campaignExpiry = String(campaign.expiresAt || "").trim();
    var expiryMode = String(campaign.expiryMode || "").trim().toLowerCase();
    var redemptionMode = String(campaign.redemptionMode || "").trim().toLowerCase();
    var expiryIsValid =
      expiryMode === "unlimited"
        ? campaignExpiry === ""
        : expiryMode === "limited" &&
          Boolean(campaignExpiry) &&
          !Number.isNaN(new Date(campaignExpiry).getTime());
    if (
      !Number.isInteger(campaignPoints) ||
      campaignPoints < 1 ||
      campaignPoints > 9999 ||
      campaignLabel !== campaignPoints + " 點" ||
      !expiryIsValid ||
      (redemptionMode !== "once_per_member" &&
        redemptionMode !== "repeatable" &&
        redemptionMode !== "single_member")
    ) {
      throw createError("INVALID_RESPONSE", "後台回傳的 QR 活動格式不正確。");
    }
    currentPointCampaign = {
      label: campaignLabel,
      points: campaignPoints,
      expiryMode: expiryMode,
      redemptionMode: redemptionMode,
      expiresAt: campaignExpiry,
    };
    currentClaimUrl = String(claimUrl || "");

    byId("point-qr-label").textContent = currentPointCampaign.label;
    byId("point-qr-expiry").textContent =
      currentPointCampaign.expiryMode === "unlimited"
        ? "無期限"
        : formatDateTime(currentPointCampaign.expiresAt);
    byId("point-qr-rule").textContent =
      currentPointCampaign.redemptionMode === "repeatable"
        ? "每次重新掃描可再領一次"
        : currentPointCampaign.redemptionMode === "single_member"
          ? "僅限一位會員領取"
          : "每位會員限領一次";
    byId("point-qr-description").textContent =
      currentPointCampaign.redemptionMode === "repeatable"
        ? "提供給會員掃描並確認領取；每次重新掃描都可再次領點。"
        : currentPointCampaign.redemptionMode === "single_member"
          ? "提供給會員掃描並確認領取；第一位成功領取後，其他會員無法再使用。"
          : "提供給會員掃描並確認領取；同一會員重複掃描不會再次增加點數。";
    byId("point-claim-url").value = currentClaimUrl;
    byId("point-qr-preview-message").hidden = !preview;
    byId("point-qr-output").hidden = Boolean(preview);
    byId("copy-claim-link-button").disabled = Boolean(preview);
    byId("download-qr-button").disabled = Boolean(preview);

    if (!preview) {
      var url;
      try {
        url = new URL(currentClaimUrl);
      } catch (_error) {
        throw createError("INVALID_RESPONSE", "後台回傳的領取連結格式不正確。");
      }
      if (
        url.protocol !== "https:" ||
        url.hostname !== "liff.line.me" ||
        url.pathname.replace(/\/+$/, "") !== MEMBER_LIFF_PATH ||
        Array.from(url.searchParams.keys()).length !== 1 ||
        !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("claim") || "") ||
        !window.PersonaQr
      ) {
        throw createError("INVALID_RESPONSE", "後台回傳的領取連結格式不正確。");
      }
      window.PersonaQr.renderSvg(byId("point-qr-output"), currentClaimUrl, {
        label: "領取 " + currentPointCampaign.label + " 的 QR Code",
        foreground: "#10271d",
      });
    }

    var dialog = byId("point-qr-dialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closePointQrDialog() {
    var dialog = byId("point-qr-dialog");
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  function copyPointClaimUrl() {
    if (!currentClaimUrl) return;
    var copyPromise =
      window.navigator.clipboard &&
      typeof window.navigator.clipboard.writeText === "function"
        ? window.navigator.clipboard.writeText(currentClaimUrl)
        : null;

    if (copyPromise) {
      copyPromise
        .then(function () {
          showToast("領取連結已複製");
        })
        .catch(function () {
          fallbackCopyPointClaimUrl();
        });
      return;
    }
    fallbackCopyPointClaimUrl();
  }

  function fallbackCopyPointClaimUrl() {
    var input = byId("point-claim-url");
    input.focus();
    input.select();
    try {
      if (!document.execCommand("copy")) throw new Error("copy failed");
      showToast("領取連結已複製");
    } catch (_error) {
      showToast("無法自動複製，請手動複製連結", "error");
    }
  }

  function downloadPointQr() {
    if (!currentClaimUrl || !currentPointCampaign || !window.PersonaQr) return;
    try {
      var link = document.createElement("a");
      link.href = window.PersonaQr.toPngDataUrl(currentClaimUrl, { scale: 16 });
      link.download =
        "point-" + String(currentPointCampaign.points || "reward") + "-qr.png";
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast("QR 圖片已下載");
    } catch (error) {
      showToast(normalizeError(error).message, "error");
    }
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
    var fragment = document.createDocumentFragment();
    var query = byId("search-input").value.trim().toLocaleLowerCase("zh-TW");
    var statusFilter = byId("status-filter").value;
    var visibleMembers = members.filter(function (member) {
      var matchesStatus = statusFilter === "all" || member.status === statusFilter;
      var haystack = [member.displayName, member.memberId, member.phone, member.birthday]
        .join(" ")
        .toLocaleLowerCase("zh-TW");
      return matchesStatus && (!query || haystack.indexOf(query) !== -1);
    });

    visibleMembers.forEach(function (member, index) {
      fragment.appendChild(createMemberRow(member, index));
    });
    list.replaceChildren(fragment);
    byId("empty-state").hidden = visibleMembers.length !== 0;
    byId("table-wrap").hidden = visibleMembers.length === 0;
  }

  function scheduleMemberRowsRender() {
    if (memberSearchFrame) return;
    memberSearchFrame = window.requestAnimationFrame(function () {
      memberSearchFrame = 0;
      renderMemberRows();
    });
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
      image.loading = "lazy";
      image.decoding = "async";
      image.width = 48;
      image.height = 48;
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
    var busy = isListLoading || isMutationLoading || isPointMutationLoading;
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
      INVALID_POINTS: "點數必須是 1 至 9999 的整數。",
      POINT_TYPE_EXISTS: "這個點數類型已經存在。",
      POINT_TYPE_NOT_FOUND: "找不到選擇的點數類型，請重新整理後再試。",
      POINT_TYPE_INACTIVE: "這個點數類型已停用，無法產生新的 QR。",
      INVALID_POINT_TYPE_ID: "點數類型識別碼無效，請重新整理後再試。",
      INVALID_EXPIRY_MODE: "點數類型的期限規則無效，請重新選擇。",
      INVALID_REDEMPTION_MODE: "點數類型的領取規則無效，請重新選擇。",
      INVALID_CAMPAIGN_EXPIRY: "領取期限需晚於現在，且不可超過一年。",
      POINT_DATA_CONFLICT: "點數試算表資料不一致，請先檢查工作表內容。",
      INVALID_POINT_CARD_TARGET: "集點卡總點數必須是 1 至 9999 的整數。",
      INVALID_POINT_CARD_MILESTONES:
        "抽獎節點必須是遞增整數，且最後一個節點等於集點卡總點數。",
      POINT_CARD_DATA_ERROR: "集點卡設定資料不一致，請先檢查工作表內容。",
      INVALID_LOTTERY_PRIZES: "請設定 2 至 12 個有效的轉盤獎項。",
      INVALID_LOTTERY_TYPE_ID: "轉盤類型識別碼無效，請重新整理後再試。",
      INVALID_LOTTERY_TYPE_NAME: "轉盤類型名稱必須是 1 至 40 個字元。",
      LOTTERY_TYPE_EXISTS: "已有相同名稱的轉盤類型。",
      LOTTERY_TYPE_NOT_FOUND: "找不到可使用的轉盤類型，請重新整理後再試。",
      INVALID_LOTTERY_COLOR: "獎項顏色格式不正確，請重新選擇。",
      INVALID_LOTTERY_PROBABILITY: "每個獎項機率需介於 0.01% 至 99.99%。",
      INVALID_LOTTERY_TOTAL: "所有獎項機率合計必須是 100%。",
      LOTTERY_DATA_ERROR: "轉盤或抽獎工作表資料不一致，請先檢查內容。",
      LOTTERY_SCHEMA_MISMATCH: "轉盤工作表欄位版本不符，請重新執行 setup()。",
      REQUEST_ID_CONFLICT: "同一請求已被用於不同操作，請重新整理後再試。",
      CONFIG_ERROR: "管理後台尚未完成設定，請重新執行管理 GAS setup()。",
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

  function openDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
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
    var busy =
      isListLoading ||
      isMutationLoading ||
      isPointMutationLoading ||
      isLotteryLoading ||
      isLotteryMutationLoading;
    if (ADMIN_PAGE === "points") {
      byId("refresh-points-button").disabled = busy;
      byId("refresh-point-history-button").disabled = busy || isPointHistoryLoading;
      byId("point-amount-input").disabled = busy || !isPointWorkspaceAvailable;
      document.querySelectorAll(".point-rule-fieldset input").forEach(function (input) {
        input.disabled = busy || !isPointWorkspaceAvailable;
      });
      byId("create-point-type-button").disabled = busy || !isPointWorkspaceAvailable;
      syncPointTypeControls();
      return;
    }
    if (ADMIN_PAGE === "lottery") {
      var hasLotteryEditor =
        isCreatingLotteryType || Boolean(getSelectedLotteryType());
      byId("refresh-lottery-button").disabled = busy;
      byId("refresh-lottery-history-button").disabled =
        busy || isLotteryHistoryLoading;
      byId("add-lottery-prize-button").disabled =
        busy || !hasLotteryEditor || lotteryPrizes.length >= 12;
      byId("save-lottery-button").disabled = busy || !hasLotteryEditor;
      byId("point-card-target-input").disabled = busy;
      byId("add-point-card-reward-button").disabled =
        busy ||
        pointCardRewardRules.length >= 20 ||
        getConfiguredLotteryTypes().length === 0;
      byId("point-card-reward-list")
        .querySelectorAll("input, select, button")
        .forEach(function (control) {
          control.disabled =
            busy ||
            (control.classList.contains("point-card-reward-remove") &&
              pointCardRewardRules.length <= 1);
        });
      byId("save-point-card-setting-button").disabled = busy;
      byId("lottery-type-select").disabled =
        busy || lotteryTypes.length === 0 || isCreatingLotteryType;
      byId("lottery-type-name-input").disabled = busy || !hasLotteryEditor;
      byId("new-lottery-type-button").disabled =
        busy || isCreatingLotteryType;
      byId("start-create-lottery-button").disabled = busy;
      byId("delete-lottery-type-button").disabled =
        busy || !selectedLotteryTypeId || isCreatingLotteryType;
      byId("lottery-config-form")
        .querySelectorAll("input, .lottery-prize-remove")
        .forEach(function (control) {
          control.disabled =
            busy ||
            !hasLotteryEditor ||
            (control.classList.contains("lottery-prize-remove") &&
              lotteryPrizes.length <= 2);
        });
      return;
    }

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
    return window.LiffRuntime.getContext(window.liff, window.navigator);
  }

  function hasCompleteConfig() {
    return window.LiffRuntime.hasCompleteConfig(CONFIG, window.MemberApi);
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
    return window.LiffRuntime.hasDemoQuery(window.location.search);
  }

  function applyBrand() {
    var brand = cleanText(CONFIG.BRAND_NAME, "PERSONA").slice(0, 28);
    document.querySelectorAll("[data-brand-name]").forEach(function (element) {
      element.textContent = brand;
    });
    document.title =
      brand +
      " ADMIN｜" +
      (ADMIN_PAGE === "points"
        ? "點數管理"
        : ADMIN_PAGE === "lottery"
          ? "轉盤抽獎"
          : "會員管理");
    syncAdminRoutes();
  }

  function syncAdminRoutes() {
    var demo = isDemoSession || hasDemoQuery();
    document.querySelectorAll("[data-admin-route]").forEach(function (link) {
      var url = new URL(link.getAttribute("href"), window.location.href);
      if (demo) url.searchParams.set("demo", "1");
      else url.searchParams.delete("demo");
      link.href = url.toString();
    });
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
      date: ADMIN_DATE_FORMATTER.format(date),
      time: ADMIN_MINUTE_FORMATTER.format(date),
    };
  }

  function formatBirthday(value) {
    var birthday = String(value || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday.replace(/-/g, "/") : "—";
  }

  function formatDateTime(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return ADMIN_DATE_TIME_FORMATTER.format(date);
  }

  function formatTime(value) {
    return ADMIN_SECOND_FORMATTER.format(value);
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

    if (ADMIN_PAGE === "points") {
      byId("refresh-points-button").addEventListener("click", function () {
        if (isDemoSession) {
          renderDemoDashboard();
          showToast("預覽資料已重新整理");
          return;
        }
        fetchPointTypes(bootVersion, true);
      });
      byId("refresh-point-history-button").addEventListener("click", function () {
        if (isDemoSession) {
          renderAdminPointHistory(demoPointHistory(), false);
          showToast("預覽紀錄已重新整理");
          return;
        }
        fetchPointHistory(bootVersion, true);
      });
      byId("point-type-form").addEventListener("submit", handleCreatePointType);
      byId("point-campaign-form").addEventListener("submit", handleCreatePointCampaign);
      byId("confirm-delete-point-type-button").addEventListener(
        "click",
        handleDeletePointType
      );
      byId("cancel-delete-point-type-button").addEventListener(
        "click",
        closeDeletePointTypeDialog
      );
      byId("keep-point-type-button").addEventListener(
        "click",
        closeDeletePointTypeDialog
      );
      byId("copy-claim-link-button").addEventListener("click", copyPointClaimUrl);
      byId("download-qr-button").addEventListener("click", downloadPointQr);
      byId("close-point-qr-button").addEventListener("click", closePointQrDialog);
      byId("done-point-qr-button").addEventListener("click", closePointQrDialog);
      byId("point-qr-dialog").addEventListener("click", function (event) {
        if (event.target === byId("point-qr-dialog")) closePointQrDialog();
      });
      byId("delete-point-type-dialog").addEventListener("click", function (event) {
        if (event.target === byId("delete-point-type-dialog")) {
          closeDeletePointTypeDialog();
        }
      });
      byId("delete-point-type-dialog").addEventListener("cancel", function (event) {
        if (event.currentTarget.dataset.busy === "true") event.preventDefault();
        else pendingDeletePointType = null;
      });
      return;
    }

    if (ADMIN_PAGE === "lottery") {
      byId("refresh-lottery-button").addEventListener("click", function () {
        if (isDemoSession) {
          renderDemoDashboard();
          showToast("預覽設定已重新整理");
          return;
        }
        fetchLotteryConfig(bootVersion, true);
      });
      byId("refresh-lottery-history-button").addEventListener(
        "click",
        function () {
          if (isDemoSession) {
            renderLotteryHistory(demoLotteryDraws(), false);
            showToast("預覽紀錄已重新整理");
            return;
          }
          fetchLotteryHistory(bootVersion, true);
        }
      );
      byId("add-lottery-prize-button").addEventListener("click", addLotteryPrize);
      byId("point-card-setting-form").addEventListener(
        "submit",
        handleSavePointCardSetting
      );
      byId("add-point-card-reward-button").addEventListener(
        "click",
        addPointCardRewardRule
      );
      byId("point-card-target-input").addEventListener(
        "input",
        clearPointCardSettingError
      );
      byId("new-lottery-type-button").addEventListener(
        "click",
        beginCreateLotteryType
      );
      byId("start-create-lottery-button").addEventListener(
        "click",
        beginCreateLotteryType
      );
      byId("lottery-type-select").addEventListener("change", function (event) {
        selectLotteryType(event.target.value);
      });
      byId("lottery-type-name-input").addEventListener("input", function () {
        renderLotteryNamePreview();
        clearLotteryConfigError();
      });
      byId("delete-lottery-type-button").addEventListener(
        "click",
        openDeleteLotteryTypeDialog
      );
      byId("cancel-delete-lottery-type-button").addEventListener("click", function () {
        closeDeleteLotteryTypeDialog();
      });
      byId("confirm-delete-lottery-type-button").addEventListener(
        "click",
        handleDeleteLotteryType
      );
      byId("delete-lottery-type-dialog").addEventListener("cancel", function (event) {
        if (event.currentTarget.dataset.busy === "true") event.preventDefault();
        else clearDeleteLotteryTypeError();
      });
      byId("lottery-config-form").addEventListener(
        "submit",
        handleSaveLotteryConfig
      );
      return;
    }

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
    byId("search-input").addEventListener("input", scheduleMemberRowsRender);
    byId("status-filter").addEventListener("change", scheduleMemberRowsRender);
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
