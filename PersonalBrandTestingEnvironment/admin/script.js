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
  var startPromise = null;
  var listRequestVersion = 0;
  var pointHistoryRequestVersion = 0;
  var lotteryRequestVersion = 0;
  var lotteryHistoryRequestVersion = 0;
  var isDemoSession = false;
  var isListLoading = false;
  var isMutationLoading = false;
  var isPointMutationLoading = false;
  var isPointHistoryLoading = false;
  var pointHistoryLoadPromise = null;
  var isPointWorkspaceAvailable = false;
  var isLotteryLoading = false;
  var lotteryConfigLoadPromise = null;
  var isLotteryMutationLoading = false;
  var isLotteryHistoryLoading = false;
  var lotteryHistoryLoadPromise = null;
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
  var ADMIN_NUMBER_FORMATTER = new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: 0,
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
      return Promise.reject(createError("CLIENT_LIBRARY_ERROR", "ç„¡æ³•è¼‰å…¥å¾Œå°é€£ç·šå…ƒä»¶ã€‚"));
    }
    return window.MemberApi
      .loadConfig("config.json", ["LIFF_ID", "GAS_WEB_APP_URL", "BRAND_NAME"])
      .then(function (config) {
        CONFIG = config;
        pagination.pageSize = getConfiguredPageSize();
      });
  }

  function start() {
    if (startPromise) return startPromise;

    setLoading("æ­£åœ¨è¼‰å…¥ç®¡ç†å¾Œå°", "è®€å–å…¬é–‹è¨­å®šä¸¦æº–å‚™ LINE èº«åˆ†é©—è­‰ã€‚è«‹ç¨å€™ã€‚");
    setConnection("æ­£åœ¨è¼‰å…¥è¨­å®š", "loading");
    setView("loading-state");

    var promise = loadConfig()
      .then(function () {
        applyBrand();
        return boot();
      })
      .catch(handleFatalError)
      .finally(function () {
        if (startPromise === promise) startPromise = null;
      });
    startPromise = promise;
    return promise;
  }

  function boot() {
    var thisBoot = ++bootVersion;
    isDemoSession = false;
    setLoading("æ­£åœ¨ç¢ºèªç®¡ç†å“¡èº«åˆ†", "é€£ç·š LINE èˆ‡æœƒå“¡å¾Œå°ï¼Œè«‹ç¨å€™ã€‚");
    setConnection("æ­£åœ¨é€£ç·š", "loading");
    setView("loading-state");

    if (hasDemoQuery()) {
      renderDemoDashboard();
      return Promise.resolve();
    }

    if (!hasCompleteConfig()) {
      setConnection("ç­‰å¾…è¨­å®š", "setup");
      setView("setup-state");
      return Promise.resolve();
    }

    if (!window.liff) {
      showError("LIFF_SDK_UNAVAILABLE", "ç„¡æ³•è¼‰å…¥ LINE ç™»å…¥å…ƒä»¶ï¼Œè«‹ç¢ºèªç¶²è·¯é€£ç·šå¾Œå†è©¦ã€‚");
      return Promise.resolve();
    }

    isLiffInitialized = false;
    return window.liff
      .init({ liffId: String(CONFIG.LIFF_ID).trim(), withLoginOnExternalBrowser: false })
      .then(function () {
        isLiffInitialized = true;
        if (thisBoot !== bootVersion) return;
        if (!window.liff.isLoggedIn()) {
          setConnection("ç­‰å¾…ç™»å…¥", "idle");
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
        createError("MISSING_ID_TOKEN", "æ²’æœ‰å–å¾— LINE ID Tokenï¼Œè«‹ç¢ºèª LIFF å·²å‹¾é¸ openid æ¬Šé™ã€‚")
      );
      return Promise.resolve();
    }

    if (preserveDashboard) {
      setTableBusy(true);
      setButtonBusy(refreshButton, true, "åŒæ­¥ä¸­");
      setConnection("æ­£åœ¨åŒæ­¥", "loading");
    } else {
      setLoading("æ­£åœ¨è¼‰å…Éæœƒå“¡æ¸…å–®", "å¾Œå°æ­£åœ¨é©—è­‰ç®¡ç†æ¬Šé™ä¸¦è®€å–æœƒå“¡è³‡æ–™ã€‚è«‹ç¨å€™ã€‚");
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
          setConnection("åŒæ­¥å¤±æ•—", "error");
          return;
  ²È="25Ñ…Ñ”¡Ù…±Õ”¤ì(€€€Ù…È‘…Ñ”€ô¹•Ü…Ñ”¡Ù…±Õ”¤ì(€€€¥˜€¡9Õµ‰•È¹¥Í9…8¡‘…Ñ”¹•ÑQ¥µ” ¤¤¤É•ÑÕÉ¸ì‘…Ñ”è€‹ŠPˆ°Ñ¥µ”è€ˆˆôì(€€€É•ÑÕÉ¸ì(€€€€€‘…Ñ”è5%9}Q}=I5QQH¹™½Éµ…Ğ¡‘…Ñ”¤°(€€€€€Ñ¥µ”è5%9}5%9UQ}=I5QQH¹™½Éµ…Ğ¡‘…Ñ”¤°(€€€ôì(€ô((€™Õ¹Ñ¥½¸™½Éµ…Ñ	¥ÉÑ¡‘…ä¡Ù…±Õ”¤ì(€€€Ù…È‰¥ÉÑ¡‘…ä€ôMÑÉ¥¹œ¡Ù…±Õ”ñğ€ˆˆ¤ì(€€€É•ÑÕÉ¸€½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹Ñ•ÍĞ¡‰¥ÉÑ¡‘…ä¤€ü‰¥ÉÑ¡‘…ä¹É•Á±…” ¼´½œ°€ˆ¼ˆ¤€è€‹ŠPˆì(€ô((€™Õ¹Ñ¥½¸™½Éµ…Ñ…Ñ•Q¥µ”¡Ù…±Õ”¤ì(€€€Ù…È‘…Ñ”€ô¹•Ü…Ñ”¡Ù…±Õ”¤ì(€€€¥˜€¡9Õµ‰•È¹¥Í9…8¡‘…Ñ”¹•ÑQ¥µ” ¤¤¤É•ÑÕÉ¸€‹ŠPˆì(€€€É•ÑÕÉ¸5%9}Q}Q%5}=I5QQH¹™½Éµ…Ğ¡‘…Ñ”¤ì(€ô((€™Õ¹Ñ¥½¸™½Éµ…ÑQ¥µ”¡Ù…±Õ”¤ì(€€€É•ÑÕÉ¸5%9}M=9}=I5QQH¹™½Éµ…Ğ¡Ù…±Õ”¤ì(€ô((€™Õ¹Ñ¥½¸™½Éµ…Ñ9Õµ‰•È¡Ù…±Õ”¤ì(€€€É•ÑÕÉ¸5%9}9U5	I}=I5QQH¹™½Éµ…Ğ¡5…Ñ ¹µ…à À°9Õµ‰•È¡Ù…±Õ”¤ñğ€À¤¤ì(€ô((€™Õ¹Ñ¥½¸É•…Ñ•ÉÉ½È¡½‘”°µ•ÍÍ…”¤ì(€€€Ù…È•ÉÉ½È€ô¹•ÜÉÉ½È¡µ•ÍÍ…”¤ì(€€€•ÉÉ½È¹½‘”€ô½‘”ì(€€€É•ÑÕÉ¸•ÉÉ½Èì(€ô((€™Õ¹Ñ¥½¸‰¥¹‘%¹Ñ•É…Ñ¥½¹Ì ¤ì(€€€‰å% ‰±½¥¸µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°¡…¹‘±•1½¥¸¤ì(€€€‰å% ‰±½½ÕĞµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°¡…¹‘±•1½½ÕĞ¤ì(€€€‰å% ‰Á•¹‘¥¹œµÉ•™É•Í µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°‰½½Ğ¤ì(€€€‰å% ‰Á•¹‘¥¹œµ±½½ÕĞµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°¡…¹‘±•1½½ÕĞ¤ì(€€€‰å% ‰Õ¹…ÕÑ¡½É¥é•µ±½½ÕĞµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°¡…¹‘±•1½½ÕĞ¤ì(€€€‰å% ‰É•ÑÉäµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°ÍÑ…ÉĞ¤ì(€€€‰å% ‰ÁÉ•Ù¥•Üµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°É•¹‘•É•µ½…Í¡‰½…É¤ì((€€€¥˜€¡5%9}A€ôôô€‰Á½¥¹ÑÌˆ¤ì(€€€€€‰å% ‰É•™É•Í µÁ½¥¹ÑÌµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€€€¥˜€¡¥Í•µ½M•ÍÍ¥½¸¤ì(€€€€€€€€€É•¹‘•É•µ½…Í¡‰½…É ¤ì(€€€€€€€€€Í¡½İQ½…ÍĞ ‹¦‚C¢š÷¢ÎšZg–ŞË¦7šZÃšVÓBˆ¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€™•Ñ¡A½¥¹ÑQåÁ•Ì¡‰½½ÑY•ÉÍ¥½¸°ÑÉÕ”¤ì(€€€€€ô¤ì(€€€€€‰å% ‰É•™É•Í µÁ½¥¹Ğµ¡¥ÍÑ½Éäµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€€€¥˜€¡¥Í•µ½M•ÍÍ¥½¸¤ì(€€€€€€€€€É•¹‘•É‘µ¥¹A½¥¹Ñ!¥ÍÑ½Éä¡‘•µ½A½¥¹Ñ!¥ÍÑ½Éä ¤°™…±Í”¤ì(€€€€€€€€€Í¡½İQ½…ÍĞ ‹¦‚C¢š÷Ò¦2–ŞË¦7šZÃšVÓBˆ¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€™•Ñ¡A½¥¹Ñ!¥ÍÑ½Éä¡‰½½ÑY•ÉÍ¥½¸°ÑÉÕ”¤ì(€€€€€ô¤ì(€€€€€‰å% ‰Á½¥¹ĞµÑåÁ”µ™½É´ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰ÍÕ‰µ¥Ğˆ°¡…¹‘±•É•…Ñ•A½¥¹ÑQåÁ”¤ì(€€€€€‰å% ‰Á½¥¹Ğµ…µÁ…¥¸µ™½É´ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰ÍÕ‰µ¥Ğˆ°¡…¹‘±•É•…Ñ•A½¥¹Ñ…µÁ…¥¸¤ì(€€€€€‰å% ‰½¹™¥É´µ‘•±•Ñ”µÁ½¥¹ĞµÑåÁ”µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰±¥¬ˆ°(€€€€€€€¡…¹‘±••±•Ñ•A½¥¹ÑQåÁ”(€€€€€€¤ì(€€€€€‰å% ‰…¹•°µ‘•±•Ñ”µÁ½¥¹ĞµÑåÁ”µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰±¥¬ˆ°(€€€€€€€±½Í••±•Ñ•A½¥¹ÑQåÁ•¥…±½œ(€€€€€€¤ì(€€€€€‰å% ‰­••ÀµÁ½¥¹ĞµÑåÁ”µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰±¥¬ˆ°(€€€€€€€±½Í••±•Ñ•A½¥¹ÑQåÁ•¥…±½œ(€€€€€€¤ì(€€€€€‰å% ‰½Áäµ±…¥´µ±¥¹¬µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°½ÁåA½¥¹Ñ±…¥µUÉ°¤ì(€€€€€‰å% ‰‘½İ¹±½…µÅÈµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°‘½İ¹±½…‘A½¥¹ÑEÈ¤ì(€€€€€‰å% ‰±½Í”µÁ½¥¹ĞµÅÈµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°±½Í•A½¥¹ÑEÉ¥…±½œ¤ì(€€€€€‰å% ‰‘½¹”µÁ½¥¹ĞµÅÈµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°±½Í•A½¥¹ÑEÉ¥…±½œ¤ì(€€€€€‰å% ‰Á½¥¹ĞµÅÈµ‘¥…±½œˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ğ¤ì(€€€€€€€¥˜€¡•Ù•¹Ğ¹Ñ…É•Ğ€ôôô‰å% ‰Á½¥¹ĞµÅÈµ‘¥…±½œˆ¤¤±½Í•A½¥¹ÑEÉ¥…±½œ ¤ì(€€€€€ô¤ì(€€€€€‰å% ‰‘•±•Ñ”µÁ½¥¹ĞµÑåÁ”µ‘¥…±½œˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ğ¤ì(€€€€€€€¥˜€¡•Ù•¹Ğ¹Ñ…É•Ğ€ôôô‰å% ‰‘•±•Ñ”µÁ½¥¹ĞµÑåÁ”µ‘¥…±½œˆ¤¤ì(€€€€€€€€€±½Í••±•Ñ•A½¥¹ÑQåÁ•¥…±½œ ¤ì(€€€€€€€ô(€€€€€ô¤ì(€€€€€‰å% ‰‘•±•Ñ”µÁ½¥¹ĞµÑåÁ”µ‘¥…±½œˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰…¹•°ˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ğ¤ì(€€€€€€€¥˜€¡•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ¹‘…Ñ…Í•Ğ¹‰ÕÍä€ôôô€‰ÑÉÕ”ˆ¤•Ù•¹Ğ¹ÁÉ•Ù•¹Ñ•™…Õ±Ğ ¤ì(€€€€€€€•±Í”Á•¹‘¥¹•±•Ñ•A½¥¹ÑQåÁ”€ô¹Õ±°ì(€€€€€ô¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€¥˜€¡5%9}A€ôôô€‰±½ÑÑ•Éäˆ¤ì(€€€€€‰å% ‰É•™É•Í µ±½ÑÑ•Éäµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€€€¥˜€¡¥Í•µ½M•ÍÍ¥½¸¤ì(€€€€€€€€€É•¹‘•É•µ½…Í¡‰½…É ¤ì(€€€€€€€€€Í¡½İQ½…ÍĞ ‹¦‚C¢š÷¢¢·–ºk–ŞË¦7šZÃšVÓBˆ¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€™•Ñ¡1½ÑÑ•Éå½¹™¥œ¡‰½½ÑY•ÉÍ¥½¸°ÑÉÕ”¤ì(€€€€€ô¤ì(€€€€€‰å% ‰É•™É•Í µ±½ÑÑ•Éäµ¡¥ÍÑ½Éäµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰±¥¬ˆ°(€€€€€€€™Õ¹Ñ¥½¸€ ¤ì(€€€€€€€€€¥˜€¡¥Í•µ½M•ÍÍ¥½¸¤ì(€€€€€€€€€€€É•¹‘•É1½ÑÑ•Éå!¥ÍÑ½Éä¡‘•µ½1½ÑÑ•ÉåÉ…İÌ ¤°™…±Í”¤ì(€€€€€€€€€€€Í¡½İQ½…ÍĞ ‹¦‚C¢š÷Ò¦2–ŞË¦7šZÃšVÓBˆ¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€ô(€€€€€€€€€™•Ñ¡1½ÑÑ•Éå!¥ÍÑ½Éä¡‰½½ÑY•ÉÍ¥½¸°ÑÉÕ”¤ì(€€€€€€€ô(€€€€€€¤ì(€€€€€‰å% ‰…‘µ±½ÑÑ•ÉäµÁÉ¥é”µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°…‘‘1½ÑÑ•ÉåAÉ¥é”¤ì(€€€€€‰å% ‰Á½¥¹Ğµ…ÉµÍ•ÑÑ¥¹œµ™½É´ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰ÍÕ‰µ¥Ğˆ°(€€€€€€€¡…¹‘±•M…Ù•A½¥¹Ñ…É‘M•ÑÑ¥¹œ(€€€€€€¤ì(€€€€€‰å% ‰…‘µÁ½¥¹Ğµ…ÉµÉ•İ…Éµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰±¥¬ˆ°(€€€€€€€…‘‘A½¥¹Ñ…É‘I•İ…É‘IÕ±”(€€€€€€¤ì(€€€€€‰å% ‰Á½¥¹Ğµ…ÉµÑ…É•Ğµ¥¹ÁÕĞˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰¥¹ÁÕĞˆ°(€€€€€€€±•…ÉA½¥¹Ñ…É‘M•ÑÑ¥¹ÉÉ½È(€€€€€€¤ì(€€€€€‘½Õµ•¹Ğ(€€€€€€€€¹ÅÕ•ÉåM•±•Ñ½É±° ‰¥¹ÁÕÑm¹…µ”ôÁ½¥¹Ñ…É‘áÁ¥Éå5½‘”tˆ¤(€€€€€€€€¹™½É… ¡™Õ¹Ñ¥½¸€¡¥¹ÁÕĞ¤ì(€€€€€€€€€¥¹ÁÕĞ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¡…¹”ˆ°Íå¹A½¥¹Ñ…É‘áÁ¥Éå½¹ÑÉ½±Ì¤ì(€€€€€€€ô¤ì(€€€€€‰å% ‰Á½¥¹Ğµ…Éµ•áÁ¥É•Ìµ½¸µ¥¹ÁÕĞˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰¥¹ÁÕĞˆ°(€€€€€€€±•…ÉA½¥¹Ñ…É‘M•ÑÑ¥¹ÉÉ½È(€€€€€€¤ì(€€€€€‰å% ‰¹•Üµ±½ÑÑ•ÉäµÑåÁ”µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰±¥¬ˆ°(€€€€€€€‰•¥¹É•…Ñ•1½ÑÑ•ÉåQåÁ”(€€€€€€¤ì(€€€€€‰å% ‰ÍÑ…ÉĞµÉ•…Ñ”µ±½ÑÑ•Éäµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰±¥¬ˆ°(€€€€€€€‰•¥¹É•…Ñ•1½ÑÑ•ÉåQåÁ”(€€€€€€¤ì(€€€€€‰å% ‰±½ÑÑ•ÉäµÑåÁ”µÍ•±•Ğˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¡…¹”ˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ğ¤ì(€€€€€€€Í•±•Ñ1½ÑÑ•ÉåQåÁ”¡•Ù•¹Ğ¹Ñ…É•Ğ¹Ù…±Õ”¤ì(€€€€€ô¤ì(€€€€€‰å% ‰±½ÑÑ•ÉäµÑåÁ”µ¹…µ”µ¥¹ÁÕĞˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¥¹ÁÕĞˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€€€É•¹‘•É1½ÑÑ•Éå9…µ•AÉ•Ù¥•Ü ¤ì(€€€€€€€±•…É1½ÑÑ•Éå½¹™¥ÉÉ½È ¤ì(€€€€€ô¤ì(€€€€€‰å% ‰‘•±•Ñ”µ±½ÑÑ•ÉäµÑåÁ”µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰±¥¬ˆ°(€€€€€€€½Á•¹•±•Ñ•1½ÑÑ•ÉåQåÁ•¥…±½œ(€€€€€€¤ì(€€€€€‰å% ‰…¹•°µ‘•±•Ñ”µ±½ÑÑ•ÉäµÑåÁ”µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€€€±½Í••±•Ñ•1½ÑÑ•ÉåQåÁ•¥…±½œ ¤ì(€€€€€ô¤ì(€€€€€‰å% ‰½¹™¥É´µ‘•±•Ñ”µ±½ÑÑ•ÉäµÑåÁ”µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰±¥¬ˆ°(€€€€€€€¡…¹‘±••±•Ñ•1½ÑÑ•ÉåQåÁ”(€€€€€€¤ì(€€€€€‰å% ‰‘•±•Ñ”µ±½ÑÑ•ÉäµÑåÁ”µ‘¥…±½œˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰…¹•°ˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ğ¤ì(€€€€€€€¥˜€¡•Ù•¹Ğ¹ÕÉÉ•¹ÑQ…É•Ğ¹‘…Ñ…Í•Ğ¹‰ÕÍä€ôôô€‰ÑÉÕ”ˆ¤•Ù•¹Ğ¹ÁÉ•Ù•¹Ñ•™…Õ±Ğ ¤ì(€€€€€€€•±Í”±•…É•±•Ñ•1½ÑÑ•ÉåQåÁ•ÉÉ½È ¤ì(€€€€€ô¤ì(€€€€€‰å% ‰±½ÑÑ•Éäµ½¹™¥œµ™½É´ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰ÍÕ‰µ¥Ğˆ°(€€€€€€€¡…¹‘±•M…Ù•1½ÑÑ•Éå½¹™¥œ(€€€€€€¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô((€€€‰å% ‰É•™É•Í µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€¥˜€¡¥Í•µ½M•ÍÍ¥½¸¤ì(€€€€€€€É•¹‘•É•µ½…Í¡‰½…É ¤ì(€€€€€€€Í¡½İQ½…ÍĞ ‹¦‚C¢š÷¢ÎšZg–ŞË¦7šZÃšVÓBˆ¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô(€€€€€™•Ñ¡5•µ‰•ÉÌ¡‰½½ÑY•ÉÍ¥½¸°ÑÉÕ”¤ì(€€€ô¤ì(€€€‰å% ‰ÁÉ•Ù¥½ÕÌµÁ…”µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€¡…¹•A…” ´Ä¤ì(€€€ô¤ì(€€€‰å% ‰¹•áĞµÁ…”µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€¡…¹•A…” Ä¤ì(€€€ô¤ì(€€€‰å% ‰Í•…É µ¥¹ÁÕĞˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¥¹ÁÕĞˆ°Í¡•‘Õ±•5•µ‰•ÉI½İÍI•¹‘•È¤ì(€€€‰å% ‰ÍÑ…ÑÕÌµ™¥±Ñ•Èˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¡…¹”ˆ°Í¡•‘Õ±•5•µ‰•ÉI½İÍI•¹‘•È¤ì(€€€‰å% ‰™¥±Ñ•Èµ™½É´ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰ÍÕ‰µ¥Ğˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ğ¤ì(€€€€€•Ù•¹Ğ¹ÁÉ•Ù•¹Ñ•™…Õ±Ğ ¤ì(€€€ô¤ì(€€€‰å% ‰…¹•°µ‘•¹äµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°±½Í••¹å¥…±½œ¤ì(€€€‰å% ‰½¹™¥É´µ‘•¹äµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€¥˜€¡Á•¹‘¥¹•¹å5•µ‰•È¤ÕÁ‘…Ñ•5•µ‰•É•ÍÌ¡Á•¹‘¥¹•¹å5•µ‰•È°€‰‘•¹¥•ˆ¤ì(€€€ô¤ì(€€€‰å% ‰‘•¹äµ‘¥…±½œˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ğ¤ì(€€€€€¥˜€¡•Ù•¹Ğ¹Ñ…É•Ğ€ôôô‰å% ‰‘•¹äµ‘¥…±½œˆ¤¤±½Í••¹å¥…±½œ ¤ì(€€€ô¤ì(€€€‰å% ‰‘•¹äµ‘¥…±½œˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±½Í”ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€Á•¹‘¥¹•¹å5•µ‰•È€ô¹Õ±°ì(€€€ô¤ì(€ô((€‰¥¹‘%¹Ñ•É…Ñ¥½¹Ì ¤ì(€‰å% ‰ÕÉÉ•¹Ğµå•…Èˆ¤¹Ñ•áÑ½¹Ñ•¹Ğ€ôMÑÉ¥¹œ¡¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¤¤ì(€ÍÑ…ÉĞ ¤ì)ô¤ ¤ì(