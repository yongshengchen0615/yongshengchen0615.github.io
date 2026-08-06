(function () {
  "use strict";

  var CONFIG = Object.freeze({});
  var STATE_IDS = [
    "loading-state",
    "login-state",
    "setup-state",
    "access-state",
    "member-state",
    "error-state",
  ];
  var currentIdToken = "";
  var currentMember = null;
  var currentMemberCardSummary = null;
  var isDemoSession = false;
  var toastTimer = null;
  var bootVersion = 0;
  var startPromise = null;
  var INVALID_TOKEN_RECOVERY_PREFIX = "persona-member-invalid-token-recovery:";
  var POINT_CLAIM_STORAGE_PREFIX = "persona-member-point-claim:";
  var POINT_REDEMPTION_REQUEST_STORAGE_PREFIX =
    "persona-member-point-redemption-request:";
  var pendingPointClaim = "";
  var pendingPointClaimError = "";
  var pendingPointRedemptionRequestId = "";
  var isPointClaimPersisted = false;
  var isPointClaimBusy = false;
  var isProfileOnboardingRequired = false;
  var isPointScannerBusy = false;
  var pointScannerStream = null;
  var pointScannerTimer = 0;
  var pointScannerResolve = null;
  var pointScannerReject = null;
  var pointScannerDetecting = false;
  var activeMemberTicketTab = "";
  var isMemberTicketRefreshing = false;
  var memberTicketRefreshPromise = null;
  var isMemberTicketSelectionBusy = false;
  var isPointHistoryLoading = false;
  var pointHistoryLoadPromise = null;
  var hasLoadedPointHistory = false;
  var isPointHistoryDirty = true;
  var pointHistoryRequestVersion = 0;
  var pendingMemberPanel = "";
  var POINT_HISTORY_DATE_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  var POINT_NUMBER_FORMATTER = new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: 0,
  });
  var MEMBER_SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  function loadConfig() {
    if (!window.MemberApi || !window.LiffRuntime) {
      return Promise.reject(
        createClientError("CLIENT_LIBRARY_ERROR", "ç„¡æ³•è¼‰å…¥æœƒå“¡è³‡æ–™é€£ç·šå…ƒä»¶ï¼Œè«‹é‡æ–°æ•´ç†é é¢ã€‚")
      );
    }

    return window.MemberApi
      .loadConfig("config.json", ["LIFF_ID", "GAS_WEB_APP_URL", "BRAND_NAME"])
      .then(function (config) {
        CONFIG = config;
      });
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function boot() {
    var thisBoot = ++bootVersion;
    isDemoSession = false;
    currentMember = null;
    currentMemberCardSummary = null;
    isProfileOnboardingRequired = false;
    isPointHistoryDirty = true;
    pointHistoryRequestVersion += 1;
    isPointHistoryLoading = false;
    capturePendingMemberPanel();
    stopPointScannerForPageExit();
    isPointScannerBusy = false;
    setButtonBusy(byId("scan-point-button"), false);
    setProfileFormBusy(false);
    closeDialog(byId("profile-dialog"), true);
    setView("loading-state");
    setConnection("æ­£åœ¨é€£ç·š", "loading");

    if (hasDemoQuery()) {
      renderDemoMember();
      return Promise.resolve();
    }

    if (!hasCompleteConfig()) {
      setConnection("ç­‰å¾…è¨­å®š", "setup");
      setView("setup-state");
      return Promise.resolve();
    }

    if (!window.liff) {
      showError(
        "LIFF_SDK_UNAVAILABLE",
        "ç„¡æ³•è¼‰å…¥ LINE ç™»å…¥å…ƒä»¶ã€‚è«‹ç¢ºèªç¶²è·¯é€£ç·šï¼Œæˆ–ç¨å¾Œé‡æ–°æ•´ç†é é¢ã€‚"
      );
      return Promise.resolve();
    }

    return window.liff.init({
        liffId: String(CONFIG.LIFF_ID).trim(),
        withLoginOnExternalBrowser: false,
      })
      .then(function () {
        if (thisBoot !== bootVersion) return;
        capturePendingPointClaim();

        if (!window.liff.isLoggedIn()) {
          setConnection("ç­‰å¾…ç™»å…¥", "idle");
          setView("login-state");
          return;
        }

        return syncMember(thisBoot);
      })
      .catch(function (error) {
        if (thisBoot !== bootVersion) return;
        handleClientError(error);
      });
  }

  function syncMember(expectedBootVersion) {
    setConnection("é©—è­‰æœƒå“¡èº«åˆ†", "loading");
    setLoadingCopy("æ­£åœ¨é©—è­‰æœƒå“¡èº«åˆ†", "å¾Œå°æ­£å‘ LINE æ ¸å°æœ¬æ¬¡ç™»å…¥ï¼Œè«‹ç¨å€™ã€‚");
    setView("loading-state");

    currentIdToken = window.liff.getIDToken() || "";
    if (!currentIdToken) {
      throw createClientError(
        "MISSING_ID_TOKEN",
        "æ²’æœ‰å–å¾— LINE ID Tokenã€‚è«‹ç¢ºèª LIFF å·²å‹¾é¸ openid æ¬Šé™å¾Œé‡æ–°ç™»å…¥ã€‚"
      );
    }

    return sendGasRequest("upsertMember", currentIdToken, getLiffContext())
      .then(function (response) {
        if (expectedBootVersion !== bootVersion) return;
        assertSuccessfulResponse(response);
        clearInvalidTokenRecoveryGuard();

        if (
          !response.data ||
          !response.data.access ||
          typeof response.data.access.allowed !== "boolean"
        ) {
          throw createClientError("INVALID_RESPONSE", "å¾Œå°å›žå‚³çš„æœƒå“¡å­˜å–ç‹€æ…‹æ ¼å¼ä¸å®Œæ•´ã€‚");
        }

        if (!response.data.access.allowed) {
          renderAccessState(response.data.access.status, Boolean(response.data.created));
          return;
        }

        if (!response.data.member) {
          throw createClientError("INVALID_RESPONSE", "å¾Œå°å›žå‚³çš„æœƒå“¡è³‡æ–™æ ¼å¼ä¸å®Œæ•´ã€‚");
        }

        var wasCreated = Boolean(response.data.created);
        renderMember(response.data.member, wasCreated);
        renderMemberCardSummary(response.data.cardSummary, false);
        sendNewMemberJoinMessage(
          getPointMessageContext(),
          response.data.member,
          wasCreated
        );
        if (!isMemberProfileComplete(response.data.member)) {
          openProfileOnboarding();
          return;
        }
        return redeemPendingPointCampaign().then(openPendingMemberPanel);
      })
      .catch(function (error) {
        if (expectedBootVersion !== bootVersion) return;
        throw error;
      });
  }

  function capturePendingPointClaim() {
    var pageUrl = new URL(window.location.href);
    var directClaim = pageUrl.searchParams.get("claim");
    var liffState = pageUrl.searchParams.get("liff.state");
    var stateUrl = null;
    var stateClaim = null;
    var urlChanged = directClaim !== null;

    if (liffState) {
      try {
        stateUrl = new URL(liffState, window.location.origin);
        stateClaim = stateUrl.searchParams.get("claim");
      } catch (_error) {
        stateUrl = null;
      }
    }

    var incomingClaim = directClaim !== null ? directClaim : stateClaim;

    if (directClaim !== null) {
      pageUrl.searchParams.delete("claim");
    }

    if (stateUrl && stateClaim !== null) {
      stateUrl.searchParams.delete("claim");
      urlChanged = true;

      if (
        (stateUrl.pathname === "/" || stateUrl.pathname === pageUrl.pathname) &&
        !stateUrl.search &&
        !stateUrl.hash
      ) {
        pageUrl.searchParams.delete("liff.state");
      } else {
        pageUrl.searchParams.set(
          "liff.state",
          stateUrl.pathname + stateUrl.search + stateUrl.hash
        );
      }
    }

    if (incomingClaim !== null) {
      var normalizedClaim = String(incomingClaim || "").trim();
      if (/^[A-Za-z0-9_-]{43}$/.test(normalizedClaim)) {
        if (
          normalizedClaim !== pendingPointClaim &&
          normalizedClaim !== getStoredPointClaim()
        ) {
          clearPendingPointRedemptionRequest();
        }
        pendingPointClaim = normalizedClaim;
        pendingPointClaimError = "";
 ²È="25‘¥…±½œ¹É•µ½Ù•ÑÑÉ¥‰ÕÑ” ‰¡¥‘‘•¸ˆ¤ì(€€€¥˜€¡ÑåÁ•½˜‘¥…±½œ¹Í¡½Ý5½‘…°€ôôô€‰™Õ¹Ñ¥½¸ˆ¤ì(€€€€€ÑÉäì(€€€€€€€‘¥…±½œ¹Í¡½Ý5½‘…° ¤ì(€€€€€ô…Ñ €¡}•ÉÉ½È¤ì(€€€€€€€‘¥…±½œ¹Í•ÑÑÑÉ¥‰ÕÑ” ‰½Á•¸ˆ°€ˆˆ¤ì(€€€€€ô(€€€€€¥˜€ …‘¥…±½œ¹½Á•¸€˜˜€…‘¥…±½œ¹¡…ÍÑÑÉ¥‰ÕÑ” ‰½Á•¸ˆ¤¤ì(€€€€€€€‘¥…±½œ¹Í•ÑÑÑÉ¥‰ÕÑ” ‰½Á•¸ˆ°€ˆˆ¤ì(€€€€€ô(€€€ô•±Í”ì(€€€€€‘¥…±½œ¹Í•ÑÑÑÉ¥‰ÕÑ” ‰½Á•¸ˆ°€ˆˆ¤ì(€€€ô(€ô((€™Õ¹Ñ¥½¸±½Í•¥…±½œ¡‘¥…±½œ°™½É”¤ì(€€€¥˜€ …‘¥…±½œ¤É•ÑÕÉ¸ì(€€€¥˜€ (€€€€€‘¥…±½œ¹¥€ôôô€‰µ•µ‰•Èµ±½ÑÑ•Éäµ‘¥…±½œˆ€˜˜(€€€€€Ý¥¹‘½Ü¹5•µ‰•É1½ÑÑ•Éå¥…±½œ€˜˜(€€€€€€…Ý¥¹‘½Ü¹5•µ‰•É1½ÑÑ•Éå¥…±½œ¹…¹±½Í” ¤€˜˜(€€€€€€…™½É”(€€€€¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€ (€€€€€‘¥…±½œ¹¥€ôôô€‰ÁÉ½™¥±”µ‘¥…±½œˆ€˜˜(€€€€€‘¥…±½œ¹‘…Ñ…Í•Ð¹‰ÕÍä€ôôô€‰ÑÉÕ”ˆ€˜˜(€€€€€€…™½É”(€€€€¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€ (€€€€€‘¥…±½œ¹¥€ôôô€‰ÁÉ½™¥±”µ‘¥…±½œˆ€˜˜(€€€€€‘¥…±½œ¹‘…Ñ…Í•Ð¹µ½‘”€ôôô€‰½¹‰½…É‘¥¹œˆ€˜˜(€€€€€€…™½É”(€€€€¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€¡‘¥…±½œ¹¥€ôôô€‰±…¥´µ‘¥…±½œˆ€˜˜‘¥…±½œ¹‘…Ñ…Í•Ð¹‰ÕÍä€ôôô€‰ÑÉÕ”ˆ¤É•ÑÕÉ¸ì(€€€¥˜€¡‘¥…±½œ¹¥€ôôô€‰‘•±•Ñ”µ‘¥…±½œˆ¤É•Í•Ñ•±•Ñ•½¹™¥Éµ…Ñ¥½¸ ¤ì(€€€¥˜€¡‘¥…±½œ¹¥€ôôô€‰ÁÉ½™¥±”µ‘¥…±½œˆ¤É•Í•ÑAÉ½™¥±•½É´ ¤ì(€€€¥˜€¡ÑåÁ•½˜‘¥…±½œ¹±½Í”€ôôô€‰™Õ¹Ñ¥½¸ˆ€˜˜‘¥…±½œ¹½Á•¸¤ì(€€€€€‘¥…±½œ¹±½Í” ¤ì(€€€ô•±Í”ì(€€€€€‘¥…±½œ¹É•µ½Ù•ÑÑÉ¥‰ÕÑ” ‰½Á•¸ˆ¤ì(€€€ô(€ô((€™Õ¹Ñ¥½¸É•Í•Ñ•±•Ñ•½¹™¥Éµ…Ñ¥½¸ ¤ì(€€€Ù…È‰ÕÑÑ½¸€ô‰å% ‰‘•±•Ñ”µ½¹™¥É´µ‰ÕÑÑ½¸ˆ¤ì(€€€Í•Ñ	ÕÑÑ½¹	ÕÍä¡‰ÕÑÑ½¸°™…±Í”¤ì(€€€‰å% ‰‘•±•Ñ”µ½¹™¥É´µ¥¹ÁÕÐˆ¤¹Ù…±Õ”€ô€ˆˆì(€€€‰ÕÑÑ½¸¹‘¥Í…‰±•€ôÑÉÕ”ì(€ô((€™Õ¹Ñ¥½¸Í¡½ÝQ½…ÍÐ¡µ•ÍÍ…”°Ñ½¹”¤ì(€€€Ù…ÈÑ½…ÍÐ€ô‰å% ‰Ñ½…ÍÐˆ¤ì(€€€Ý¥¹‘½Ü¹±•…ÉQ¥µ•½ÕÐ¡Ñ½…ÍÑQ¥µ•È¤ì(€€€‰å% ‰Ñ½…ÍÐµµ•ÍÍ…”ˆ¤¹Ñ•áÑ½¹Ñ•¹Ð€ôµ•ÍÍ…”ì(€€€Ñ½…ÍÐ¹‘…Ñ…Í•Ð¹Ñ½¹”€ôÑ½¹”ñð€‰ÍÕ•ÍÌˆì(€€€Ñ½…ÍÐ¹¡¥‘‘•¸€ô™…±Í”ì(€€€Ñ½…ÍÑQ¥µ•È€ôÝ¥¹‘½Ü¹Í•ÑQ¥µ•½ÕÐ¡™Õ¹Ñ¥½¸€ ¤ì(€€€€€Ñ½…ÍÐ¹¡¥‘‘•¸€ôÑÉÕ”ì(€€€ô°€ÐÈÀÀ¤ì(€ô((€™Õ¹Ñ¥½¸…ÁÁ±å	É…¹ ¤ì(€€€Ù…È‰É…¹€ô±•…¹¥ÍÁ±…åQ•áÐ¡=9%¹	I9}95°€‰AIM=9ˆ¤¹Í±¥” À°€Èà¤ì(€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰m‘…Ñ„µ‰É…¹µ¹…µ•tˆ¤¹™½É… ¡™Õ¹Ñ¥½¸€¡•±•µ•¹Ð¤ì(€€€€€•±•µ•¹Ð¹Ñ•áÑ½¹Ñ•¹Ð€ô‰É…¹ì(€€€ô¤ì(€€€‘½Õµ•¹Ð¹Ñ¥Ñ±”€ô‰É…¹€¬€ˆ55	IO¾ösšr–N‡’â·–þˆì(€ô((€™Õ¹Ñ¥½¸‰¥¹‘%¹Ñ•É…Ñ¥½¹Ì ¤ì(€€€‰å% ‰±½¥¸µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°¡…¹‘±•1½¥¸¤ì(€€€‰å% ‰±½½ÕÐµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°¡…¹‘±•1½½ÕÐ¤ì(€€€‰å% ‰…•ÍÌµÉ•™É•Í µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°‰½½Ð¤ì(€€€‰å% ‰…•ÍÌµ±½½ÕÐµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°¡…¹‘±•1½½ÕÐ¤ì(€€€‰å% ‰É•ÑÉäµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°ÍÑ…ÉÐ¤ì(€€€‰å% ‰ÁÉ•Ù¥•Üµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°É•¹‘•É•µ½5•µ‰•È¤ì(€€€‰å% ‰‘•±•Ñ”µ½¹™¥É´µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°¡…¹‘±••±•Ñ•5•µ‰•È¤ì(€€€‰å% ‰•‘¥ÐµÁÉ½™¥±”µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°½Á•¹AÉ½™¥±•‘¥Ñ½È¤ì(€€€‰å% ‰ÁÉ½™¥±”µ™½É´ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰ÍÕ‰µ¥Ðˆ°¡…¹‘±•AÉ½™¥±•MÕ‰µ¥Ð¤ì(€€€‰å% ‰Í…¸µÁ½¥¹Ðµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°¡…¹‘±•M…¹A½¥¹ÑEÈ¤ì(€€€‰å% ‰±½ÑÑ•ÉäµÁ…”µ±¥¹¬ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°½Á•¹5•µ‰•ÉQ¥­•Ñ¥…±½œ¤ì(€€€‰å% ‰µ•µ‰•Èµ•…É¹•µÑ¥­•Ðµ±¥ÍÐˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€‰±¥¬ˆ°(€€€€€¡…¹‘±•5•µ‰•ÉQ¥­•Ñ1¥ÍÑ±¥¬(€€€€¤ì(€€€‰å% ‰½Á•¸µÁ½¥¹Ðµ¡¥ÍÑ½Éäµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€‰±¥¬ˆ°(€€€€€½Á•¹A½¥¹Ñ!¥ÍÑ½Éå¥…±½œ(€€€€¤ì(€€€‰å% ‰É•™É•Í µÁ½¥¹Ðµ¡¥ÍÑ½Éäµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€‰±¥¬ˆ°(€€€€€±½…‘A½¥¹Ñ!¥ÍÑ½Éä(€€€€¤ì(€€€l‰±½­•ˆ°€‰•…É¹•‰t¹™½É… ¡™Õ¹Ñ¥½¸€¡¹…µ”¤ì(€€€€€‰å% ‰µ•µ‰•È´ˆ€¬¹…µ”€¬€ˆµÑ¥­•ÐµÑ…ˆˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰±¥¬ˆ°(€€€€€€€™Õ¹Ñ¥½¸€ ¤ì(€€€€€€€€€Í•±•Ñ5•µ‰•ÉQ¥­•ÑQ…ˆ¡¹…µ”°™…±Í”¤ì(€€€€€€€ô(€€€€€€¤ì(€€€€€‰å% ‰µ•µ‰•È´ˆ€¬¹…µ”€¬€ˆµÑ¥­•ÐµÑ…ˆˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€€€‰­•å‘½Ý¸ˆ°(€€€€€€€¡…¹‘±•5•µ‰•ÉQ¥­•ÑQ…‰-•å‘½Ý¸(€€€€€€¤ì(€€€ô¤ì(€€€‰å% ‰Á½¥¹ÐµÍ…¹¹•Èµ…¹•°µ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È (€€€€€€‰±¥¬ˆ°(€€€€€…¹•±µ‰•‘‘•‘A½¥¹ÑM…¹¹•È(€€€€¤ì(€€€‰å% ‰±…¥´µÉ•ÑÉäµ‰ÕÑÑ½¸ˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°É•‘••µA•¹‘¥¹A½¥¹Ñ…µÁ…¥¸¤ì(€€€l(€€€€€€‰±…¥´µÍÕ•ÍÌµ±½Í”µ‰ÕÑÑ½¸ˆ°(€€€€€€‰±…¥´µ‘ÕÁ±¥…Ñ”µ±½Í”µ‰ÕÑÑ½¸ˆ°(€€€€€€‰±…¥´µ•ÉÉ½Èµ±½Í”µ‰ÕÑÑ½¸ˆ°(€€€t¹™½É… ¡™Õ¹Ñ¥½¸€¡¥¤ì(€€€€€‰å%¡¥¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€€€±½Í•¥…±½œ¡‰å% ‰±…¥´µ‘¥…±½œˆ¤¤ì(€€€€€ô¤ì(€€€ô¤ì((€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰m‘…Ñ„µ½Á•¸µ‘¥…±½tˆ¤¹™½É… ¡™Õ¹Ñ¥½¸€¡‰ÕÑÑ½¸¤ì(€€€€€‰ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€€€½Á•¹¥…±½œ¡‰å%¡‰ÕÑÑ½¸¹‘…Ñ…Í•Ð¹½Á•¹¥…±½œ¤¤ì(€€€€€ô¤ì(€€€ô¤ì((€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰m‘…Ñ„µ±½Í”µ‘¥…±½tˆ¤¹™½É… ¡™Õ¹Ñ¥½¸€¡‰ÕÑÑ½¸¤ì(€€€€€‰ÕÑÑ½¸¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€€€±½Í•¥…±½œ¡‰ÕÑÑ½¸¹±½Í•ÍÐ ‰‘¥…±½œˆ¤¤ì(€€€€€ô¤ì(€€€ô¤ì((€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° ‰‘¥…±½œˆ¤¹™½É… ¡™Õ¹Ñ¥½¸€¡‘¥…±½œ¤ì(€€€€€‘¥…±½œ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±¥¬ˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ð¤ì(€€€€€€€¥˜€¡•Ù•¹Ð¹Ñ…É•Ð€„ôô‘¥…±½œ¤É•ÑÕÉ¸ì(€€€€€€€¥˜€¡‘¥…±½œ¹¥€ôôô€‰±…¥´µ‘¥…±½œˆñð‘¥…±½œ¹¥€ôôô€‰Á½¥¹ÐµÍ…¹¹•Èµ‘¥…±½œˆ¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€±½Í•¥…±½œ¡‘¥…±½œ¤ì(€€€€€ô¤ì(€€€€€‘¥…±½œ¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰…¹•°ˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ð¤ì(€€€€€€€¥˜€ (€€€€€€€€€‘¥…±½œ¹¥€ôôô€‰±…¥´µ‘¥…±½œˆñð(€€€€€€€€€‘¥…±½œ¹¥€ôôô€‰Á½¥¹ÐµÍ…¹¹•Èµ‘¥…±½œˆñð(€€€€€€€€€€¡‘¥…±½œ¹¥€ôôô€‰ÁÉ½™¥±”µ‘¥…±½œˆ€˜˜(€€€€€€€€€€€‘¥…±½œ¹‘…Ñ…Í•Ð¹µ½‘”€ôôô€‰½¹‰½…É‘¥¹œˆ¤(€€€€€€€€¤ì(€€€€€€€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€€€€€ô(€€€€€ô¤ì(€€€ô¤ì((€€€‰å% ‰‘•±•Ñ”µ½¹™¥É´µ¥¹ÁÕÐˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¥¹ÁÕÐˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ð¤ì(€€€€€‰å% ‰‘•±•Ñ”µ½¹™¥É´µ‰ÕÑÑ½¸ˆ¤¹‘¥Í…‰±•€ô•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¹ÑÉ¥´ ¤€„ôô€‹–"«¦fˆì(€€€ô¤ì((€€€‰å% ‰‘•±•Ñ”µ‘¥…±½œˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±½Í”ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€É•Í•Ñ•±•Ñ•½¹™¥Éµ…Ñ¥½¸ ¤ì(€€€ô¤ì((€€€‰å% ‰ÁÉ½™¥±”µ‘¥…±½œˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±½Í”ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€É•Í•ÑAÉ½™¥±•½É´ ¤ì(€€€€€Ý¥¹‘½Ü¹É•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡½Á•¹A•¹‘¥¹5•µ‰•ÉA…¹•°¤ì(€€€ô¤ì((€€€‰å% ‰±…¥´µ‘¥…±½œˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰±½Í”ˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€Ý¥¹‘½Ü¹É•ÅÕ•ÍÑ¹¥µ…Ñ¥½¹É…µ”¡½Á•¹A•¹‘¥¹5•µ‰•ÉA…¹•°¤ì(€€€ô¤ì((€€€‰å% ‰ÁÉ½™¥±”µ‘¥…±½œˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰…¹•°ˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ð¤ì(€€€€€¥˜€ (€€€€€€€•Ù•¹Ð¹ÕÉÉ•¹ÑQ…É•Ð¹‘…Ñ…Í•Ð¹‰ÕÍä€ôôô€‰ÑÉÕ”ˆñð(€€€€€€€•Ù•¹Ð¹ÕÉÉ•¹ÑQ…É•Ð¹‘…Ñ…Í•Ð¹µ½‘”€ôôô€‰½¹‰½…É‘¥¹œˆ(€€€€€€¤ì(€€€€€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€€€ô(€€€ô¤ì((€€€‰å% ‰Á½¥¹ÐµÍ…¹¹•Èµ‘¥…±½œˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰…¹•°ˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ð¤ì(€€€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€€€…¹•±µ‰•‘‘•‘A½¥¹ÑM…¹¹•È ¤ì(€€€ô¤ì((€€€‰å% ‰±…¥´µ‘¥…±½œˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰…¹•°ˆ°™Õ¹Ñ¥½¸€¡•Ù•¹Ð¤ì(€€€€€¥˜€¡•Ù•¹Ð¹ÕÉÉ•¹ÑQ…É•Ð¹‘…Ñ…Í•Ð¹‰ÕÍä€ôôô€‰ÑÉÕ”ˆ¤•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€ô¤ì((€€€l‰Á¡½¹”ˆ°€‰‰¥ÉÑ¡‘…ä‰t¹™½É… ¡™Õ¹Ñ¥½¸€¡™¥•±¤ì(€€€€€‰å% ‰ÁÉ½™¥±”´ˆ€¬™¥•±€¬€ˆµ¥¹ÁÕÐˆ¤¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰¥¹ÁÕÐˆ°™Õ¹Ñ¥½¸€ ¤ì(€€€€€€€Ù…È¥¹ÁÕÐ€ô‰å% ‰ÁÉ½™¥±”´ˆ€¬™¥•±€¬€ˆµ¥¹ÁÕÐˆ¤ì(€€€€€€€Ù…È½ÕÑÁÕÐ€ô‰å% ‰ÁÉ½™¥±”´ˆ€¬™¥•±€¬€ˆµ•ÉÉ½Èˆ¤ì(€€€€€€€¥¹ÁÕÐ¹Í•ÑÑÑÉ¥‰ÕÑ” ‰…É¥„µ¥¹Ù…±¥ˆ°€‰™…±Í”ˆ¤ì(€€€€€€€½ÕÑÁÕÐ¹Ñ•áÑ½¹Ñ•¹Ð€ô€ˆˆì(€€€€€€€½ÕÑÁÕÐ¹¡¥‘‘•¸€ôÑÉÕ”ì(€€€€€€€‰å% ‰ÁÉ½™¥±”µ™½É´µ•ÉÉ½Èˆ¤¹¡¥‘‘•¸€ôÑÉÕ”ì(€€€€€ô¤ì(€€€ô¤ì((€€€Ý¥¹‘½Ü¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰Á…•¡¥‘”ˆ°ÍÑ½ÁA½¥¹ÑM…¹¹•É½ÉA…•á¥Ð¤ì(€€€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‰Ù¥Í¥‰¥±¥Ñå¡…¹”ˆ°¡…¹‘±•Y¥Í¥‰¥±¥Ñå¡…¹”¤ì(€ô((€‰¥¹‘%¹Ñ•É…Ñ¥½¹Ì ¤ì(€‰å% ‰ÕÉÉ•¹Ðµå•…Èˆ¤¹Ñ•áÑ½¹Ñ•¹Ð€ôMÑÉ¥¹œ¡¹•Ü…Ñ” ¤¹•ÑÕ±±e•…È ¤¤ì((€™Õ¹Ñ¥½¸ÍÑ…ÉÐ ¤ì(€€€¥˜€¡ÍÑ…ÉÑAÉ½µ¥Í”¤É•ÑÕÉ¸ÍÑ…ÉÑAÉ½µ¥Í”ì((€€€Í•Ñ½¹¹•Ñ¥½¸ ‹š¶–r£¢ò'–—¢¢·–ºhˆ°€‰±½…‘¥¹œˆ¤ì(€€€Í•Ñ1½…‘¥¹½Áä ‹š¶–r£¢ò'–—šr–N‡žÎïžÖÄˆ°€‹¢º–>[–³¦Z/¢¢·–ºk’â›šê[–
d1%9ƒžfï–—šr7–.gŽ¢®/ž¢7–gŽˆ¤ì(€€€Í•ÑY¥•Ü ‰±½…‘¥¹œµÍÑ…Ñ”ˆ¤ì((€€€Ù…ÈÁÉ½µ¥Í”€ô±½…‘½¹™¥œ ¤(€€€€€€¹Ñ¡•¸¡™Õ¹Ñ¥½¸€ ¤ì(€€€€€€€…ÁÁ±å	É…¹ ¤ì(€€€€€€€½¹™¥ÕÉ•5•µ‰•É1½ÑÑ•Éå¥…±½œ ¤ì(€€€€€€€É•ÑÕÉ¸‰½½Ð ¤ì(€€€€€ô¤(€€€€€€¹…Ñ ¡¡…¹‘±•±¥•¹ÑÉÉ½È¤(€€€€€€¹™¥¹…±±ä¡™Õ¹Ñ¥½¸€ ¤ì(€€€€€€€¥˜€¡ÍÑ…ÉÑAÉ½µ¥Í”€ôôôÁÉ½µ¥Í”¤ÍÑ…ÉÑAÉ½µ¥Í”€ô¹Õ±°ì(€€€€€ô¤ì(€€€ÍÑ…ÉÑAÉ½µ¥Í”€ôÁÉ½µ¥Í”ì(€€€É•ÑÕÉ¸ÁÉ½µ¥Í”ì(€ô((€ÍÑ…ÉÐ ¤ì)ô¤ ¤ì(