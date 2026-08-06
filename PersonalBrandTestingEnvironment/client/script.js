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
  var isPointHistoryLoading = false;
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
        createClientError("CLIENT_LIBRARY_ERROR", "無法載入會員資料連線元件，請重新整理頁面。")
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
    setConnection("正在連線", "loading");

    if (hasDemoQuery()) {
      renderDemoMember();
      return Promise.resolve();
    }

    if (!hasCompleteConfig()) {
      setConnection("等待設定", "setup");
      setView("setup-state");
      return Promise.resolve();
    }

    if (!window.liff) {
      showError(
        "LIFF_SDK_UNAVAILABLE",
        "無法載入 LINE 登入元件。請確認網路連線，或稍後重新整理頁面。"
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
          setConnection("等待登入", "idle");
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
    setConnection("驗證會員身分", "loading");
    setLoadingCopy("正在驗證會員身分", "後台正向 LINE 核對本次登入，請稍候。");
    setView("loading-state");

    currentIdToken = window.liff.getIDToken() || "";
    if (!currentIdToken) {
      throw createClientError(
        "MISSING_ID_TOKEN",
        "沒有取得 LINE ID Token。請確認 LIFF 已勾選 openid 權限後重新登入。"
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
          throw createClientError("INVALID_RESPONSE", "後台回傳的會員存取狀態格式不完整。");
        }

        if (!response.data.access.allowed) {
          renderAccessState(response.data.access.status, Boolean(response.data.created));
          return;
        }

        if (!response.data.member) {
          throw createClientError("INVALID_RESPONSE", "後台回傳的會員資料格式不完整。");
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
        try {
          window.sessionStorage.setItem(getPointClaimStorageKey(), normalizedClaim);
          isPointClaimPersisted = true;
        } catch (_error) {
          // getCleanPageUrl() carries the validated claim through a required
          // external login redirect when tab storage is unavailable.
          isPointClaimPersisted = false;
        }
      } else {
        pendingPointClaim = "";
        pendingPointClaimError = "這張 QR 的領點憑證格式不正確，請向服務人員索取新的 QR Code。";
        isPointClaimPersisted = false;
        clearPendingPointRedemptionRequest();
        clearStoredPointClaim();
      }
    } else {
      try {
        var storedClaim = getStoredPointClaim();
        if (/^[A-Za-z0-9_-]{43}$/.test(storedClaim)) {
          pendingPointClaim = storedClaim;
          pendingPointClaimError = "";
          isPointClaimPersisted = true;
        } else if (storedClaim) {
          isPointClaimPersisted = false;
          clearStoredPointClaim();
        } else if (!pendingPointClaim) {
          isPointClaimPersisted = false;
        }
      } catch (_error) {
        // sessionStorage may be unavailable in privacy-restricted browsers.
      }
    }

    if (urlChanged) {
      window.history.replaceState(window.history.state, "", pageUrl.toString());
    }
  }

  function capturePendingMemberPanel() {
    var pageUrl = new URL(window.location.href);
    var directPanel = String(pageUrl.searchParams.get("panel") || "").trim();
    var liffState = pageUrl.searchParams.get("liff.state");
    var stateUrl = null;
    var statePanel = "";
    var urlChanged = pageUrl.searchParams.has("panel");

    if (liffState) {
      try {
        stateUrl = new URL(liffState, window.location.origin);
        statePanel = String(stateUrl.searchParams.get("panel") || "").trim();
      } catch (_error) {
        stateUrl = null;
      }
    }

    var incomingPanel = directPanel || statePanel;
    if (incomingPanel === "tickets" || incomingPanel === "history") {
      pendingMemberPanel = incomingPanel;
    }
    pageUrl.searchParams.delete("panel");

    if (stateUrl && stateUrl.searchParams.has("panel")) {
      stateUrl.searchParams.delete("panel");
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

    if (urlChanged && window.history && window.history.replaceState) {
      window.history.replaceState(
        window.history.state,
        document.title,
        pageUrl.toString()
      );
    }
  }

  function openPendingMemberPanel() {
    if (byId("member-state").hidden) return;
    if (document.querySelector("dialog[open]")) return;
    if (
      !isDemoSession &&
      window.MemberLotteryDialog &&
      window.MemberLotteryDialog.hasPending()
    ) {
      window.MemberLotteryDialog.restorePending();
      return;
    }
    if (!pendingMemberPanel) return;
    var panel = pendingMemberPanel;
    pendingMemberPanel = "";
    if (panel === "tickets") openMemberTicketDialog();
    if (panel === "history") openPointHistoryDialog();
  }

  function redeemPendingPointCampaign() {
    if (isPointClaimBusy || isDemoSession) return Promise.resolve();

    if (pendingPointClaimError) {
      setClaimError(pendingPointClaimError, false);
      openDialog(byId("claim-dialog"));
      return Promise.resolve();
    }

    if (!pendingPointClaim) return Promise.resolve();

    var token = currentIdToken || (window.liff && window.liff.getIDToken()) || "";
    if (!token) {
      handlePointClaimError(
        createClientError("MISSING_ID_TOKEN", "登入狀態已失效，請重新登入後再掃描 QR Code。")
      );
      return;
    }

    openDialog(byId("claim-dialog"));
    setPointClaimBusy(true);
    setClaimLoadingCopy("正在加入會員點數", "請保持此頁開啟，完成前請勿離開。");
    setClaimState("claim-loading-state");

    var redemptionRequestId = ensurePendingPointRedemptionRequestId();
    return sendGasRequest("redeemPointCampaign", token, getLiffContext(), {
      claim: pendingPointClaim,
    }, redemptionRequestId)
      .then(function (response) {
        assertSuccessfulResponse(response);
        clearInvalidTokenRecoveryGuard();

        if (
          !response.data ||
          !response.data.access ||
          response.data.access.allowed !== true ||
          typeof response.data.duplicate !== "boolean" ||
          typeof response.data.redeemed !== "boolean"
        ) {
          throw createClientError("INVALID_RESPONSE", "後台回傳的領點結果格式不完整。");
        }

        var pointBalance = normalizePointBalance(response.data.pointBalance);
        var campaign = normalizePointCampaign(response.data.campaign);
        var awardedPoints = Number(response.data.awardedPoints);
        if (!Number.isSafeInteger(awardedPoints) || awardedPoints < 0) {
          throw createClientError("INVALID_RESPONSE", "後台回傳的獲得點數格式不正確。");
        }
        var originalPointBalance = pointBalance - awardedPoints;
        if (originalPointBalance < 0) {
          throw createClientError("INVALID_RESPONSE", "後台回傳的點數變動資料不一致。");
        }
        updateMemberPointBalance(pointBalance, true);
        renderMemberCardSummary(response.data.cardSummary, true);
        isPointHistoryDirty = true;

        if (response.data.duplicate) {
          byId("claim-duplicate-before").textContent = formatPointNumber(originalPointBalance);
          byId("claim-duplicate-points").textContent = formatPointNumber(awardedPoints);
          byId("claim-duplicate-balance").textContent = formatPointNumber(pointBalance);
          if (response.data.duplicateReason === "request_replay") {
            byId("claim-duplicate-title").textContent = "本次領取已完成";
            byId("claim-duplicate-message").textContent =
              "後台已處理先前請求，沒有再次加點";
          } else if (response.data.duplicateReason === "already_redeemed") {
            byId("claim-duplicate-title").textContent = "這張 QR 已領取過";
            byId("claim-duplicate-message").textContent = "沒有重複加點";
          } else if (response.data.duplicateReason === "campaign_redeemed") {
            byId("claim-duplicate-title").textContent = "這張 QR 已被領取";
            byId("claim-duplicate-message").textContent =
              "這張 QR 只能由一位會員領取，沒有重複加點";
          } else {
            throw createClientError("INVALID_RESPONSE", "後台回傳的重複領取原因不正確。");
          }
          clearPendingPointClaim();
          setClaimState("claim-duplicate-state");
          return;
        }

        if (!response.data.redeemed) {
          throw createClientError("INVALID_RESPONSE", "後台未確認這次點數領取。");
        }

        if (
          !Number.isSafeInteger(awardedPoints) ||
          awardedPoints !== campaign.points
        ) {
          throw createClientError("INVALID_RESPONSE", "後台回傳的點數資料不一致。");
        }

        byId("claim-success-before").textContent = formatPointNumber(originalPointBalance);
        byId("claim-success-points").textContent = formatPointNumber(awardedPoints);
        byId("claim-success-balance").textContent = formatPointNumber(pointBalance);
        byId("claim-success-note").textContent =
          campaign.redemptionMode === "repeatable"
            ? "如需再次領取，請重新掃描同一張 QR Code。"
            : campaign.redemptionMode === "single_member"
              ? "這張 QR 僅限一位會員領取，完成後即失效。"
              : "這張 QR 對本會員已完成領取。";
        clearPendingPointClaim();
        setClaimState("claim-success-state");
        setClaimMessageStatus({ pending: true });
        sendPointClaimMessage(
          getPointMessageContext(),
          originalPointBalance,
          awardedPoints,
          pointBalance
        ).then(
          function (messageResult) {
            setClaimMessageStatus(messageResult);
          }
        );
      })
      .catch(handlePointClaimError)
      .finally(function () {
        setPointClaimBusy(false);
      });
  }

  function getPointMessageContext() {
    var liffContext = getLiffContext();
    return {
      inClient: liffContext.inClient === true,
      isOneToOneChat: liffContext.type === "utou",
    };
  }

  function sendPointClaimMessage(
    messageContext,
    originalPointBalance,
    awardedPoints,
    pointBalance
  ) {
    var message =
      "會員點數通知\n原本點數：" +
      formatPointNumber(originalPointBalance) +
      " 點\n獲得點數：+" +
      formatPointNumber(awardedPoints) +
      " 點\n目前點數：" +
      formatPointNumber(pointBalance) +
      " 點";

    return sendOfficialAccountMessage(messageContext, message);
  }

  function sendNewMemberJoinMessage(messageContext, member, wasCreated) {
    if (!wasCreated || !member) {
      return Promise.resolve({ sent: false, reason: "not_new_member" });
    }

    var message =
      "新會員加入通知\n我已完成會員註冊\n會員編號：" +
      cleanDisplayText(member.memberId, "—") +
      "\n會員名稱：" +
      cleanDisplayText(member.displayName, "LINE 會員");

    return sendOfficialAccountMessage(messageContext, message);
  }

  function sendOfficialAccountMessage(messageContext, message) {
    if (
      !messageContext ||
      !messageContext.inClient ||
      !messageContext.isOneToOneChat ||
      !window.liff ||
      typeof window.liff.sendMessages !== "function"
    ) {
      return Promise.resolve({ sent: false, reason: "unavailable" });
    }

    var sendResult;
    try {
      sendResult = window.liff.sendMessages([{ type: "text", text: message }]);
    } catch (_error) {
      return Promise.resolve({ sent: false, reason: "send_failed" });
    }

    return Promise.resolve(sendResult)
      .then(function () {
        return { sent: true };
      })
      .catch(function () {
        return { sent: false, reason: "send_failed" };
      });
  }

  function setClaimMessageStatus(result) {
    var status = byId("claim-success-message-status");
    if (!status) return;

    status.hidden = false;
    status.dataset.tone = result && result.pending
      ? "pending"
      : result && result.sent
        ? "success"
        : "muted";
    status.textContent = result && result.pending
        ? "正在將領點通知傳送給官方帳號…"
        : result && result.sent
          ? "已將領點通知傳送給官方帳號。"
          : result && result.reason === "unavailable"
          ? "點數已發放；目前環境未啟用官方帳號通知。"
          : "點數已發放，但領點通知未能傳送給官方帳號。";
  }

  function normalizePointCampaign(campaign) {
    var points = campaign && Number(campaign.points);
    var label = cleanDisplayText(campaign && campaign.label, "");
    var expiresAt = campaign && String(campaign.expiresAt || "").trim();
    var expiryMode = campaign && String(campaign.expiryMode || "").trim().toLowerCase();
    var redemptionMode =
      campaign && String(campaign.redemptionMode || "").trim().toLowerCase();
    var expiry = expiresAt ? new Date(expiresAt) : null;
    var validExpiry =
      expiryMode === "unlimited"
        ? expiresAt === ""
        : expiryMode === "limited" &&
          Boolean(expiresAt) &&
          expiry &&
          !Number.isNaN(expiry.getTime());

    if (
      !campaign ||
      !Number.isInteger(points) ||
      points < 1 ||
      points > 9999 ||
      label !== points + " 點" ||
      !validExpiry ||
      (redemptionMode !== "once_per_member" &&
        redemptionMode !== "repeatable" &&
        redemptionMode !== "single_member")
    ) {
      throw createClientError("INVALID_RESPONSE", "後台回傳的點數活動格式不完整。");
    }

    return {
      label: label,
      points: points,
      expiryMode: expiryMode,
      redemptionMode: redemptionMode,
      expiresAt: expiry ? expiry.toISOString() : "",
    };
  }

  function normalizePointBalance(value) {
    var balance = Number(value);
    if (!Number.isSafeInteger(balance) || balance < 0) {
      throw createClientError("INVALID_RESPONSE", "後台回傳的會員點數格式不正確。");
    }
    return balance;
  }

  function normalizeMemberCardSummary(summary) {
    var currentPoints = summary && Number(summary.currentPoints);
    var targetPoints = summary && Number(summary.targetPoints);
    var availableDraws = summary && Number(summary.availableDraws);
    var currentCardNumber = summary && Number(summary.currentCardNumber);
    var settingVersion = String((summary && summary.settingVersion) || "").trim();
    var expiryMode = String((summary && summary.expiryMode) || "").trim();
    var expiresOn = String((summary && summary.expiresOn) || "").trim();
    var rewardRules =
      summary && Array.isArray(summary.rewardRules)
        ? summary.rewardRules.map(function (rule) {
            return {
              points: Number(rule && rule.points),
              lotteryTypeId: String((rule && rule.lotteryTypeId) || "").trim(),
            };
          })
        : [];
    var availableRewards =
      summary && Array.isArray(summary.availableRewards)
        ? summary.availableRewards.map(normalizeMemberRewardTicket)
        : [];
    if (
      !summary ||
      !/^PCS-[A-Z0-9]{12}$/.test(settingVersion) ||
      !Number.isSafeInteger(currentPoints) ||
      currentPoints < 0 ||
      !Number.isSafeInteger(targetPoints) ||
      targetPoints < 1 ||
      currentPoints >= targetPoints ||
      !Number.isSafeInteger(currentCardNumber) ||
      currentCardNumber < 1 ||
      !Number.isSafeInteger(availableDraws) ||
      availableDraws < 0 ||
      rewardRules.length < 1 ||
      rewardRules.length > 20 ||
      rewardRules.some(function (rule, index) {
        return (
          !Number.isSafeInteger(rule.points) ||
          rule.points < 1 ||
          rule.points > targetPoints ||
          (index > 0 && rule.points <= rewardRules[index - 1].points) ||
          !/^LTY-[A-Z0-9]{10}$/.test(rule.lotteryTypeId)
        );
      }) ||
      rewardRules[rewardRules.length - 1].points !== targetPoints ||
      availableRewards.length !== Math.min(availableDraws, 50) ||
      !hasUniqueMemberRewardTickets(availableRewards) ||
      (expiryMode !== "unlimited" && expiryMode !== "limited") ||
      (expiryMode === "unlimited" && expiresOn) ||
      (expiryMode === "limited" && !isValidMemberCardDate(expiresOn))
    ) {
      throw createClientError("INVALID_RESPONSE", "後台回傳的集點卡摘要格式不正確。");
    }
    return {
      settingVersion: settingVersion,
      currentPoints: currentPoints,
      targetPoints: targetPoints,
      currentCardNumber: currentCardNumber,
      availableDraws: availableDraws,
      rewardRules: rewardRules,
      availableRewards: availableRewards,
      expiryMode: expiryMode,
      expiresOn: expiresOn,
    };
  }

  function normalizeMemberRewardTicket(value) {
    value = value && typeof value === "object" ? value : {};
    var ticket = {
      settingVersion: String(value.settingVersion || "").trim(),
      cardNumber: Number(value.cardNumber),
      milestonePoints: Number(value.milestonePoints),
      lotteryTypeId: String(value.lotteryTypeId || "").trim(),
      cardRoundKey: String(value.cardRoundKey || "").trim(),
    };
    if (
      !/^PCS-[A-Z0-9]{12}$/.test(ticket.settingVersion) ||
      !Number.isSafeInteger(ticket.cardNumber) ||
      ticket.cardNumber < 1 ||
      !Number.isSafeInteger(ticket.milestonePoints) ||
      ticket.milestonePoints < 1 ||
      ticket.milestonePoints > 9999 ||
      !/^LTY-[A-Z0-9]{10}$/.test(ticket.lotteryTypeId) ||
      ticket.cardRoundKey !==
        ticket.settingVersion +
          ":" +
          ticket.cardNumber +
          ":" +
          ticket.milestonePoints
    ) {
      throw createClientError("INVALID_RESPONSE", "後台回傳的抽獎券格式不正確。");
    }
    return ticket;
  }

  function hasUniqueMemberRewardTickets(tickets) {
    var keys = Object.create(null);
    return tickets.every(function (ticket) {
      if (keys[ticket.cardRoundKey]) return false;
      keys[ticket.cardRoundKey] = true;
      return true;
    });
  }

  function isValidMemberCardDate(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return false;
    var date = new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    );
    return (
      date.getUTCFullYear() === Number(match[1]) &&
      date.getUTCMonth() === Number(match[2]) - 1 &&
      date.getUTCDate() === Number(match[3])
    );
  }

  function renderMemberCardSummary(summary, animate) {
    var normalized = normalizeMemberCardSummary(summary);
    var currentOutput = byId("member-point-card-current");
    var targetOutput = byId("member-point-card-target");
    var progressTrack = byId("member-point-card-progress-track");
    var progress = byId("member-point-card-progress");
    var ticketCount = byId("member-ticket-count");
    var ticketLink = byId("lottery-page-link");
    var pointsContainer = currentOutput.closest(".pass-points");
    var progressPercent = Math.min(
      100,
      Math.max(0, (normalized.currentPoints / normalized.targetPoints) * 100)
    );

    currentMemberCardSummary = normalized;
    currentOutput.textContent = formatPointNumber(normalized.currentPoints);
    targetOutput.textContent = formatPointNumber(normalized.targetPoints);
    byId("member-point-card-expiry").textContent =
      normalized.expiryMode === "limited"
        ? "集點期限至 " + formatMemberCardDate(normalized.expiresOn)
        : "集點卡無期限";
    progressTrack.setAttribute("aria-valuemax", String(normalized.targetPoints));
    progressTrack.setAttribute("aria-valuenow", String(normalized.currentPoints));
    progress.style.width = progressPercent.toFixed(2) + "%";

    ticketCount.value = String(normalized.availableDraws);
    ticketCount.textContent =
      normalized.availableDraws > 99
        ? "99+"
        : formatPointNumber(normalized.availableDraws);
    ticketCount.hidden = normalized.availableDraws === 0;
    ticketLink.setAttribute(
      "aria-label",
      normalized.availableDraws > 0
        ? "抽獎券，" + formatPointNumber(normalized.availableDraws) + " 張可用"
        : "抽獎券，目前沒有可用票券"
    );
    renderMemberTicketPanels(normalized);

    if (animate && pointsContainer) {
      pointsContainer.removeAttribute("data-updated");
      window.requestAnimationFrame(function () {
        pointsContainer.dataset.updated = "true";
        window.setTimeout(function () {
          pointsContainer.removeAttribute("data-updated");
        }, 650);
      });
    }
  }

  function formatMemberCardDate(value) {
    return String(value || "").replace(/-/g, ".");
  }

  function renderMemberTicketPanels(summary) {
    var earnedList = byId("member-earned-ticket-list");
    var lockedList = byId("member-locked-ticket-list");
    var earnedFragment = document.createDocumentFragment();
    var lockedFragment = document.createDocumentFragment();
    var lockedRules = summary.rewardRules.filter(function (rule) {
      return rule.points > summary.currentPoints;
    });

    summary.availableRewards.forEach(function (ticket, index) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "lottery-ticket-button";
      button.dataset.cardRoundKey = ticket.cardRoundKey;
      appendMemberTicketText(
        button,
        "lottery-ticket-number",
        "可用抽獎券 " + String(index + 1).padStart(2, "0")
      );
      appendMemberTicketText(
        button,
        "lottery-ticket-name",
        formatPointNumber(ticket.milestonePoints) + " 點節點抽獎券"
      );
      appendMemberTicketText(
        button,
        "lottery-ticket-meta",
        "第 " + formatPointNumber(ticket.cardNumber) + " 張集點卡"
      );
      appendMemberTicketText(button, "lottery-ticket-action", "開啟轉盤 →");
      button.setAttribute(
        "aria-label",
        "第 " +
          ticket.cardNumber +
          " 張集點卡，" +
          ticket.milestonePoints +
          " 點節點抽獎券，開啟轉盤"
      );
      button.addEventListener("click", function () {
        openMemberLotteryTicket(ticket);
      });
      earnedFragment.appendChild(button);
    });

    lockedRules.forEach(function (rule) {
      var item = document.createElement("article");
      item.className = "lottery-locked-ticket";
      appendMemberTicketText(
        item,
        "lottery-ticket-number",
        "尚差 " + formatPointNumber(rule.points - summary.currentPoints) + " 點"
      );
      appendMemberTicketText(
        item,
        "lottery-ticket-name",
        formatPointNumber(rule.points) + " 點節點抽獎券"
      );
      appendMemberTicketText(
        item,
        "lottery-ticket-meta",
        "本張卡達到 " + formatPointNumber(rule.points) + " 點後獲得"
      );
      appendMemberTicketText(item, "lottery-ticket-action", "未獲得");
      lockedFragment.appendChild(item);
    });

    earnedList.replaceChildren(earnedFragment);
    lockedList.replaceChildren(lockedFragment);
    byId("member-earned-ticket-count").textContent = formatPointNumber(
      summary.availableDraws
    );
    byId("member-locked-ticket-count").textContent = formatPointNumber(
      lockedRules.length
    );
    byId("member-earned-ticket-empty").hidden =
      summary.availableRewards.length > 0;
    byId("member-locked-ticket-empty").hidden = lockedRules.length > 0;
    byId("member-ticket-limit-note").hidden =
      summary.availableDraws <= summary.availableRewards.length;
    selectMemberTicketTab(
      activeMemberTicketTab ||
        (summary.availableRewards.length > 0 ? "earned" : "locked"),
      false
    );
  }

  function appendMemberTicketText(parent, className, value) {
    var element = document.createElement("span");
    element.className = className;
    element.textContent = value;
    parent.appendChild(element);
  }

  function selectMemberTicketTab(tabName, shouldFocus) {
    var selectedName = tabName === "locked" ? "locked" : "earned";
    activeMemberTicketTab = selectedName;
    ["locked", "earned"].forEach(function (name) {
      var selected = name === selectedName;
      var tab = byId("member-" + name + "-ticket-tab");
      var panel = byId("member-" + name + "-ticket-panel");
      panel.hidden = !selected;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && shouldFocus) tab.focus();
    });
  }

  function handleMemberTicketTabKeydown(event) {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    selectMemberTicketTab(
      event.key === "ArrowLeft" || event.key === "Home" ? "locked" : "earned",
      true
    );
  }

  function openMemberTicketDialog() {
    if (!currentMemberCardSummary) return;
    selectMemberTicketTab(
      currentMemberCardSummary.availableRewards.length > 0
        ? "earned"
        : "locked",
      false
    );
    openDialog(byId("member-ticket-dialog"));
    window.requestAnimationFrame(function () {
      byId("member-" + activeMemberTicketTab + "-ticket-tab").focus();
    });
  }

  function openMemberLotteryTicket(ticket) {
    var normalizedTicket = normalizeMemberRewardTicket(ticket);
    if (!window.MemberLotteryDialog) {
      showToast("轉盤元件尚未載入，請重新整理後再試。", "error");
      return;
    }
    closeDialog(byId("member-ticket-dialog"), true);
    window.MemberLotteryDialog.open(normalizedTicket);
  }

  function configureMemberLotteryDialog() {
    if (!window.MemberLotteryDialog || !window.LotteryWheel) {
      throw createClientError(
        "CLIENT_LIBRARY_ERROR",
        "無法載入轉盤元件，請重新整理頁面。"
      );
    }

    window.MemberLotteryDialog.configure({
      liffId: String(CONFIG.LIFF_ID || "").trim(),
      request: function (action, fields, requestId) {
        var token =
          currentIdToken || (window.liff && window.liff.getIDToken()) || "";
        if (!token) {
          return Promise.reject(
            createClientError(
              "MISSING_ID_TOKEN",
              "登入狀態已失效，請重新登入後再抽獎。"
            )
          );
        }
        return sendGasRequest(
          action,
          token,
          getLiffContext(),
          fields,
          requestId
        ).then(function (response) {
          assertSuccessfulResponse(response);
          clearInvalidTokenRecoveryGuard();
          return response;
        });
      },
      isDemo: function () {
        return isDemoSession;
      },
      getCurrentCardSummary: function () {
        return currentMemberCardSummary;
      },
      getCurrentTotalPoints: function () {
        return currentMember ? currentMember.pointBalance : 0;
      },
      getMemberId: function () {
        return currentMember ? currentMember.memberId : "";
      },
      onCardUpdated: function (card, totalPoints) {
        updateMemberPointBalance(totalPoints, true);
        renderMemberCardSummary(card, true);
        isPointHistoryDirty = true;
      },
      onReturnToTickets: function () {
        pendingMemberPanel = "";
        window.requestAnimationFrame(openMemberTicketDialog);
      },
      onAuthorizationError: function (error) {
        closeDialog(byId("member-lottery-dialog"), true);
        handleClientError(error);
      },
      normalizeError: normalizeClientError,
      showToast: showToast,
    });
  }

  function openPointHistoryDialog() {
    openDialog(byId("point-history-dialog"));
    if (isDemoSession) {
      if (!hasLoadedPointHistory) renderDemoPointHistory();
      return;
    }
    if (!hasLoadedPointHistory || isPointHistoryDirty) loadPointHistory();
  }

  function loadPointHistory() {
    if (isPointHistoryLoading) return Promise.resolve();
    if (isDemoSession) {
      renderDemoPointHistory();
      return Promise.resolve();
    }
    var token = currentIdToken || (window.liff && window.liff.getIDToken()) || "";
    if (!token) {
      renderPointHistoryError("登入狀態已失效，請重新登入後再查看紀錄。");
      return Promise.resolve();
    }

    var requestVersion = ++pointHistoryRequestVersion;
    isPointHistoryLoading = true;
    renderPointHistoryLoading();
    return sendGasRequest("listPointHistory", token, getLiffContext())
      .then(function (response) {
        if (requestVersion !== pointHistoryRequestVersion) return;
        assertSuccessfulResponse(response);
        if (
          !response.data ||
          !response.data.access ||
          response.data.access.allowed !== true ||
          !Array.isArray(response.data.history) ||
          typeof response.data.hasMore !== "boolean"
        ) {
          throw createClientError(
            "INVALID_RESPONSE",
            "後台回傳的點數紀錄格式不完整。"
          );
        }
        normalizePointBalance(response.data.pointBalance);
        renderPointHistory(response.data.history, response.data.hasMore);
        hasLoadedPointHistory = true;
        isPointHistoryDirty = false;
      })
      .catch(function (error) {
        if (requestVersion !== pointHistoryRequestVersion) return;
        var normalized = normalizeClientError(error);
        if (
          normalized.code === "INVALID_TOKEN" ||
          normalized.code === "INVALID_ID_TOKEN" ||
          normalized.code === "MISSING_ID_TOKEN" ||
          normalized.code === "MEMBER_ACCESS_DENIED"
        ) {
          closeDialog(byId("point-history-dialog"), true);
          handleClientError(error);
          return;
        }
        renderPointHistoryError(normalized.message);
      })
      .finally(function () {
        if (requestVersion !== pointHistoryRequestVersion) return;
        isPointHistoryLoading = false;
        byId("refresh-point-history-button").disabled = false;
        byId("point-history-loading").hidden = true;
      });
  }

  function renderDemoPointHistory() {
    var now = Date.now();
    renderPointHistory(
      [
        {
          historyId: "RDM-PREVIEW000000001",
          entryType: "earn",
          redemptionId: "RDM-PREVIEW000000001",
          drawId: "",
          points: 2,
          label: "2 點",
          balanceAfter: 128,
          redeemedAt: new Date(now - 35 * 60 * 1000).toISOString(),
          redemptionMode: "once_per_member",
          source: "qr",
          prizeLabel: "",
          prizeColor: "",
        },
        {
          historyId: "LDW-PREVIEW000000001",
          entryType: "draw",
          redemptionId: "",
          drawId: "LDW-PREVIEW000000001",
          points: 0,
          label: "集點卡抽獎 · 品牌小禮",
          balanceAfter: 126,
          redeemedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
          redemptionMode: "lottery",
          source: "lottery",
          prizeLabel: "品牌小禮",
          prizeColor: "#06C755",
        },
      ],
      false
    );
    hasLoadedPointHistory = true;
    isPointHistoryDirty = false;
  }

  function normalizePointHistoryEntry(value) {
    value = value && typeof value === "object" ? value : {};
    var historyId = String(value.historyId || "").trim();
    var entryType = String(value.entryType || "").trim().toLowerCase();
    var redemptionId = String(value.redemptionId || "").trim();
    var drawId = String(value.drawId || "").trim();
    var points = Number(value.points);
    var label = String(value.label || "").trim();
    var balanceAfter = Number(value.balanceAfter);
    var redeemedAt = String(value.redeemedAt || "").trim();
    var redemptionMode = String(value.redemptionMode || "").trim().toLowerCase();
    var source = String(value.source || "").trim().toLowerCase();
    var prizeLabel = String(value.prizeLabel || "").trim();
    var prizeColor = String(value.prizeColor || "").trim().toUpperCase();
    var date = new Date(redeemedAt);
    var validEarn =
      entryType === "earn" &&
      source === "qr" &&
      /^RDM-[A-Z0-9]{16}$/.test(redemptionId) &&
      historyId === redemptionId &&
      Number.isSafeInteger(points) &&
      points >= 1 &&
      points <= 9999 &&
      label === points + " 點" &&
      Number.isSafeInteger(balanceAfter) &&
      balanceAfter >= points &&
      (redemptionMode === "once_per_member" ||
        redemptionMode === "repeatable" ||
        redemptionMode === "single_member");
    var validLegacyLottery =
      entryType === "spend" &&
      points === -5 &&
      label === "5 點抽獎券 · " + prizeLabel;
    var validRoundLottery =
      entryType === "draw" &&
      points === 0 &&
      label === "集點卡抽獎 · " + prizeLabel;
    var validLottery =
      (validLegacyLottery || validRoundLottery) &&
      source === "lottery" &&
      /^LDW-[A-Z0-9]{16}$/.test(drawId) &&
      historyId === drawId &&
      prizeLabel &&
      prizeLabel.length <= 40 &&
      /^#[0-9A-F]{6}$/.test(prizeColor) &&
      Number.isSafeInteger(balanceAfter) &&
      balanceAfter >= 0 &&
      redemptionMode === "lottery";

    if ((!validEarn && !validLottery) || Number.isNaN(date.getTime())) {
      throw createClientError(
        "INVALID_RESPONSE",
        "後台回傳的點數紀錄格式不正確。"
      );
    }
    return {
      entryType: entryType,
      points: points,
      label: label,
      balanceAfter: balanceAfter,
      redeemedAt: date.toISOString(),
      redemptionMode: redemptionMode,
      prizeLabel: prizeLabel,
    };
  }

  function renderPointHistoryLoading() {
    var list = byId("point-history-list");
    var hasRenderedItems = list.childElementCount > 0;
    byId("point-history-loading").hidden = hasRenderedItems;
    byId("point-history-error").hidden = true;
    byId("point-history-empty").hidden = true;
    byId("refresh-point-history-button").disabled = true;
    list.setAttribute("aria-busy", "true");
    byId("point-history-summary").textContent = "更新中";
  }

  function renderPointHistory(entries, hasMore) {
    var list = byId("point-history-list");
    var fragment = document.createDocumentFragment();
    var normalizedEntries = entries.map(normalizePointHistoryEntry);
    list.setAttribute("aria-busy", "false");
    byId("point-history-loading").hidden = true;
    byId("point-history-error").hidden = true;
    byId("point-history-empty").hidden = normalizedEntries.length !== 0;
    byId("refresh-point-history-button").disabled = false;
    byId("point-history-summary").textContent = normalizedEntries.length
      ? normalizedEntries.length + " 筆" + (hasMore ? " · 顯示最新紀錄" : "")
      : "尚無紀錄";

    normalizedEntries.forEach(function (entry) {
      var item = document.createElement("li");
      var marker = document.createElement("span");
      var content = document.createElement("div");
      var title = document.createElement("strong");
      var meta = document.createElement("small");
      var amount = document.createElement("b");
      var balance = document.createElement("span");

      item.className = "point-history-item";
      item.dataset.entryType = entry.entryType;
      marker.className = "point-history-marker";
      marker.setAttribute("aria-hidden", "true");
      content.className = "point-history-content";
      title.textContent =
        entry.entryType === "earn"
          ? "獲得 " + entry.label
          : "抽中 " + entry.prizeLabel;
      meta.textContent =
        formatPointHistoryDate(entry.redeemedAt) +
        " · " +
        (entry.entryType === "spend"
          ? "舊版抽獎券"
          : entry.entryType === "draw"
            ? "集點卡抽獎"
            : formatPointHistoryMode(entry.redemptionMode));
      amount.className =
        "point-history-amount" +
        (entry.entryType === "spend" ? " point-history-amount-spend" : "");
      amount.textContent =
        entry.entryType === "draw"
          ? "不扣點"
          : (entry.points > 0 ? "+" : "−") +
            formatPointNumber(Math.abs(entry.points)) +
            " 點";
      balance.className = "point-history-balance";
      balance.textContent = "累計 " + formatPointNumber(entry.balanceAfter);

      content.appendChild(title);
      content.appendChild(meta);
      item.appendChild(marker);
      item.appendChild(content);
      item.appendChild(amount);
      item.appendChild(balance);
      fragment.appendChild(item);
    });
    list.replaceChildren(fragment);
  }

  function renderPointHistoryError(message) {
    var list = byId("point-history-list");
    list.setAttribute("aria-busy", "false");
    byId("point-history-loading").hidden = true;
    byId("refresh-point-history-button").disabled = false;
    byId("point-history-empty").hidden = true;
    byId("point-history-summary").textContent = hasLoadedPointHistory
      ? "更新失敗"
      : "載入失敗";
    byId("point-history-error").textContent =
      message || "目前無法讀取點數紀錄。";
    byId("point-history-error").hidden = false;
  }

  function formatPointHistoryDate(value) {
    return POINT_HISTORY_DATE_FORMATTER.format(new Date(value));
  }

  function formatPointHistoryMode(mode) {
    return mode === "repeatable"
      ? "可重複領取"
      : mode === "single_member"
        ? "單人領取"
        : "每位會員一次";
  }

  function updateMemberPointBalance(balance, animate) {
    var normalizedBalance = normalizePointBalance(balance);
    var output = byId("member-point-balance");
    var container = output.closest(".pass-points");

    output.textContent = formatPointNumber(normalizedBalance);
    if (currentMember) currentMember.pointBalance = normalizedBalance;

    if (animate && container) {
      container.removeAttribute("data-balance-updated");
      window.requestAnimationFrame(function () {
        container.dataset.balanceUpdated = "true";
        window.setTimeout(function () {
          container.removeAttribute("data-balance-updated");
        }, 650);
      });
    }
  }

  function setClaimState(activeId) {
    [
      "claim-loading-state",
      "claim-success-state",
      "claim-duplicate-state",
      "claim-error-state",
    ].forEach(function (id) {
      byId(id).hidden = id !== activeId;
    });
    var messageStatus = byId("claim-success-message-status");
    if (messageStatus && activeId !== "claim-success-state") {
      messageStatus.hidden = true;
    }

    var focusTargetId = {
      "claim-success-state": "claim-success-close-button",
      "claim-duplicate-state": "claim-duplicate-close-button",
      "claim-error-state": byId("claim-retry-button").hidden
        ? "claim-error-close-button"
        : "claim-retry-button",
    }[activeId];
    if (focusTargetId) {
      window.requestAnimationFrame(function () {
        var target = byId(focusTargetId);
        if (byId(activeId).hidden || !byId("claim-dialog").open) return;
        target.focus();
      });
    }
  }

  function setClaimLoadingCopy(title, message) {
    var state = byId("claim-loading-state");
    state.querySelector("strong").textContent = title;
    state.querySelector("p").textContent = message;
  }

  function setPointClaimBusy(busy) {
    isPointClaimBusy = Boolean(busy);
    var dialog = byId("claim-dialog");
    dialog.dataset.busy = busy ? "true" : "false";
    [
      "claim-retry-button",
      "claim-success-close-button",
      "claim-duplicate-close-button",
      "claim-error-close-button",
    ].forEach(function (id) {
      byId(id).disabled = Boolean(busy);
    });
  }

  function handlePointClaimError(error) {
    var normalized = normalizeClientError(error);
    var authenticationError =
      normalized.code === "INVALID_TOKEN" ||
      normalized.code === "INVALID_ID_TOKEN" ||
      normalized.code === "MISSING_ID_TOKEN";

    if (authenticationError) {
      setPointClaimBusy(false);
      closeDialog(byId("claim-dialog"));
      handleClientError(error);
      return;
    }

    if (normalized.code === "MEMBER_ACCESS_DENIED") {
      setPointClaimBusy(false);
      closeDialog(byId("claim-dialog"));
      renderAccessState("denied", false);
      return;
    }

    var terminalError =
      normalized.code === "INVALID_POINT_CLAIM" ||
      normalized.code === "POINT_CAMPAIGN_NOT_FOUND" ||
      normalized.code === "POINT_CAMPAIGN_INACTIVE" ||
      normalized.code === "POINT_CAMPAIGN_EXPIRED";

    if (terminalError) clearPendingPointClaim();
    setClaimError(normalized.message, !terminalError && Boolean(pendingPointClaim));
    openDialog(byId("claim-dialog"));
  }

  function setClaimError(message, canRetry) {
    byId("claim-error-message").textContent =
      message || "這張 QR 目前無法領取，請稍後再試。";
    byId("claim-retry-button").hidden = !canRetry;
    setClaimState("claim-error-state");
  }

  function getPointClaimStorageKey() {
    return POINT_CLAIM_STORAGE_PREFIX + String(CONFIG.LIFF_ID || "unknown").trim();
  }

  function getPointRedemptionRequestStorageKey() {
    return (
      POINT_REDEMPTION_REQUEST_STORAGE_PREFIX +
      String(CONFIG.LIFF_ID || "unknown").trim()
    );
  }

  function clearStoredPointClaim() {
    try {
      window.sessionStorage.removeItem(getPointClaimStorageKey());
    } catch (_error) {
      // sessionStorage may be unavailable in privacy-restricted browsers.
    }
  }

  function clearPendingPointClaim() {
    pendingPointClaim = "";
    pendingPointClaimError = "";
    isPointClaimPersisted = false;
    clearPendingPointRedemptionRequest();
    clearStoredPointClaim();
  }

  function formatPointNumber(value) {
    return POINT_NUMBER_FORMATTER.format(value);
  }

  function handleScanPointQr() {
    var button = byId("scan-point-button");
    if (
      !button ||
      isPointScannerBusy ||
      isPointClaimBusy ||
      isProfileOnboardingRequired
    ) {
      return;
    }
    if (isDemoSession) {
      showToast("預覽模式無法使用相機掃描", "error");
      return;
    }

    isPointScannerBusy = true;
    setButtonBusy(button, true, "正在開啟掃描");
    openPointQrScanner()
      .then(function (scannedValue) {
        var claim = extractPointClaimFromQr(scannedValue);
        if (!claim) {
          throw createClientError(
            "INVALID_POINT_QR",
            "這不是有效的會員點數 QR Code，請掃描管理員提供的集點碼。"
          );
        }
        setScannedPointClaim(claim);
        return redeemPendingPointCampaign();
      })
      .catch(function (error) {
        if (isPointScanCancelled(error)) {
          showToast("已取消掃描");
          return;
        }
        showToast(normalizeClientError(error).message, "error");
      })
      .finally(function () {
        isPointScannerBusy = false;
        setButtonBusy(button, false);
      });
  }

  function setScannedPointClaim(claim) {
    if (claim !== pendingPointClaim) clearPendingPointRedemptionRequest();
    pendingPointClaim = claim;
    pendingPointClaimError = "";
    try {
      window.sessionStorage.setItem(getPointClaimStorageKey(), claim);
      isPointClaimPersisted = true;
    } catch (_error) {
      isPointClaimPersisted = false;
    }
  }

  function openPointQrScanner() {
    if (!isPointScannerAvailable()) return openEmbeddedPointScanner();
    return Promise.resolve()
      .then(function () {
        return window.liff.scanCodeV2();
      })
      .then(function (result) {
        return result && result.value;
      })
      .catch(function (error) {
        if (isPointScanCancelled(error)) throw error;
        if (!isNativePointScannerUnavailableError(error)) throw error;
        return openEmbeddedPointScanner();
      });
  }

  function isPointScannerAvailable() {
    if (!window.liff || typeof window.liff.scanCodeV2 !== "function") {
      return false;
    }
    if (typeof window.liff.isApiAvailable !== "function") return true;
    try {
      return window.liff.isApiAvailable("scanCodeV2") === true;
    } catch (_error) {
      return false;
    }
  }

  function isNativePointScannerUnavailableError(error) {
    var code = String((error && (error.code || error.name)) || "").toUpperCase();
    var message = String((error && error.message) || "").toLowerCase();
    return (
      normalizeClientError(error).code === "SCAN_QR_UNAVAILABLE" ||
      code === "FORBIDDEN" ||
      code === "EXCEPTION_IN_SUBWINDOW" ||
      message.indexOf("subwindowopen is not allowed") !== -1
    );
  }

  function openEmbeddedPointScanner() {
    if (pointScannerReject) {
      return Promise.reject(
        createClientError("BUSY", "QR 掃描器正在使用中，請稍候。")
      );
    }
    setEmbeddedPointScannerStatus("正在啟動相機…");
    openDialog(byId("point-scanner-dialog"));
    return new Promise(function (resolve, reject) {
      pointScannerResolve = resolve;
      pointScannerReject = reject;
      createEmbeddedPointBarcodeDetector()
        .then(function (detector) {
          if (
            !window.navigator.mediaDevices ||
            typeof window.navigator.mediaDevices.getUserMedia !== "function"
          ) {
            throw createClientError(
              "CAMERA_UNAVAILABLE",
              "目前瀏覽器無法開啟相機，請更新 LINE 或改用手機瀏覽器。"
            );
          }
          return window.navigator.mediaDevices
            .getUserMedia({
              audio: false,
              video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 960 },
                height: { ideal: 960 },
              },
            })
            .then(function (stream) {
              return { detector: detector, stream: stream };
            });
        })
        .then(function (scanner) {
          if (!pointScannerReject) {
            scanner.stream.getTracks().forEach(function (track) {
              track.stop();
            });
            return;
          }
          pointScannerStream = scanner.stream;
          var video = byId("point-scanner-video");
          video.srcObject = scanner.stream;
          return Promise.resolve(video.play()).then(function () {
            setEmbeddedPointScannerStatus(
              "將 QR Code 對準框線，辨識成功後會自動領點。"
            );
            var label = byId("scan-point-button").querySelector("span");
            if (label) label.textContent = "正在掃描";
            scheduleEmbeddedPointScan(scanner.detector);
          });
        })
        .catch(function (error) {
          if (!pointScannerReject) return;
          finishEmbeddedPointScanner(
            "",
            normalizeEmbeddedPointScannerError(error)
          );
        });
    });
  }

  function createEmbeddedPointBarcodeDetector() {
    if (typeof window.BarcodeDetector !== "function") {
      return Promise.reject(
        createClientError(
          "SCAN_QR_UNAVAILABLE",
          "目前瀏覽器沒有 QR 辨識功能，請更新 LINE 或改用手機瀏覽器。"
        )
      );
    }
    var supportedFormats =
      typeof window.BarcodeDetector.getSupportedFormats === "function"
        ? window.BarcodeDetector.getSupportedFormats()
        : Promise.resolve(["qr_code"]);
    return Promise.resolve(supportedFormats).then(function (formats) {
      if (!Array.isArray(formats) || formats.indexOf("qr_code") === -1) {
        throw createClientError(
          "SCAN_QR_UNAVAILABLE",
          "目前瀏覽器不支援 QR Code 辨識，請更新 LINE 或改用手機瀏覽器。"
        );
      }
      return new window.BarcodeDetector({ formats: ["qr_code"] });
    });
  }

  function scheduleEmbeddedPointScan(detector) {
    window.clearTimeout(pointScannerTimer);
    if (!pointScannerReject) return;
    pointScannerTimer = window.setTimeout(function () {
      var video = byId("point-scanner-video");
      if (!pointScannerReject) return;
      if (!video || video.readyState < 2 || pointScannerDetecting) {
        scheduleEmbeddedPointScan(detector);
        return;
      }
      pointScannerDetecting = true;
      Promise.resolve(detector.detect(video))
        .then(function (barcodes) {
          if (!pointScannerReject || !Array.isArray(barcodes)) return;
          var match = barcodes.find(function (barcode) {
            return barcode && String(barcode.rawValue || "").trim();
          });
          if (match) {
            var scannedValue = String(match.rawValue).trim();
            if (extractPointClaimFromQr(scannedValue)) {
              finishEmbeddedPointScanner(scannedValue);
            } else {
              setEmbeddedPointScannerStatus(
                "這不是集點 QR Code，請改掃管理員提供的條碼。"
              );
            }
          }
        })
        .catch(function () {
          // A single frame can fail while the camera focuses.
        })
        .finally(function () {
          pointScannerDetecting = false;
          if (pointScannerReject) scheduleEmbeddedPointScan(detector);
        });
    }, 280);
  }

  function cancelEmbeddedPointScanner() {
    if (!pointScannerReject) {
      stopEmbeddedPointScanner();
      closeDialog(byId("point-scanner-dialog"));
      return;
    }
    finishEmbeddedPointScanner(
      "",
      createClientError("POINT_SCAN_CANCELLED", "已取消掃描。")
    );
  }

  function finishEmbeddedPointScanner(value, error) {
    var resolve = pointScannerResolve;
    var reject = pointScannerReject;
    pointScannerResolve = null;
    pointScannerReject = null;
    stopEmbeddedPointScanner();
    closeDialog(byId("point-scanner-dialog"));
    if (value && resolve) resolve(value);
    else if (reject) {
      reject(
        error ||
          createClientError("CAMERA_UNAVAILABLE", "QR 掃描器已停止。")
      );
    }
  }

  function stopEmbeddedPointScanner() {
    window.clearTimeout(pointScannerTimer);
    pointScannerTimer = 0;
    pointScannerDetecting = false;
    if (pointScannerStream) {
      pointScannerStream.getTracks().forEach(function (track) {
        track.stop();
      });
      pointScannerStream = null;
    }
    var video = byId("point-scanner-video");
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }

  function stopPointScannerForPageExit() {
    if (!pointScannerReject) {
      stopEmbeddedPointScanner();
      return;
    }
    finishEmbeddedPointScanner(
      "",
      createClientError(
        "POINT_SCAN_CANCELLED",
        "頁面已離開，掃描已停止。"
      )
    );
  }

  function handleVisibilityChange() {
    if (document.hidden) stopPointScannerForPageExit();
  }

  function setEmbeddedPointScannerStatus(message) {
    byId("point-scanner-status").textContent = message;
  }

  function normalizeEmbeddedPointScannerError(error) {
    var name = String((error && (error.name || error.code)) || "").toUpperCase();
    if (name === "NOTALLOWEDERROR" || name === "SECURITYERROR") {
      return createClientError(
        "CAMERA_PERMISSION_DENIED",
        "相機權限被拒絕，請在 LINE 或瀏覽器設定中允許相機後重試。"
      );
    }
    if (name === "NOTFOUNDERROR" || name === "OVERCONSTRAINEDERROR") {
      return createClientError("CAMERA_NOT_FOUND", "找不到可使用的相機。");
    }
    if (name === "NOTREADABLEERROR" || name === "ABORTERROR") {
      return createClientError(
        "CAMERA_UNAVAILABLE",
        "相機目前無法使用，請關閉其他使用相機的程式後重試。"
      );
    }
    return error && error.code
      ? error
      : createClientError(
          "CAMERA_UNAVAILABLE",
          "目前無法啟動相機，請更新 LINE 或改用手機瀏覽器。"
        );
  }

  function extractPointClaimFromQr(value) {
    var scannedValue = String(value || "").trim();
    if (!scannedValue) return "";
    var url;
    try {
      url = new URL(scannedValue);
    } catch (_error) {
      return "";
    }
    var expectedPath = "/" + String(CONFIG.LIFF_ID || "").trim();
    var claim = url.searchParams.get("claim") || "";
    var keys = Array.from(url.searchParams.keys());
    if (
      url.protocol !== "https:" ||
      url.hostname !== "liff.line.me" ||
      url.pathname.replace(/\/+$/, "") !== expectedPath ||
      url.hash ||
      keys.length !== 1 ||
      keys[0] !== "claim" ||
      !/^[A-Za-z0-9_-]{43}$/.test(claim)
    ) {
      return "";
    }
    return claim;
  }

  function isPointScanCancelled(error) {
    return /CANCEL/.test(
      [error && error.code, error && error.name, error && error.message]
        .join(" ")
        .toUpperCase()
    );
  }

  function handleLogin() {
    var button = byId("login-button");
    if (!window.liff || button.disabled) return;

    if (window.liff.isLoggedIn()) {
      boot();
      return;
    }

    if (window.liff.isInClient()) {
      showError("LIFF_LOGIN_ERROR", "LINE 應用程式內沒有取得登入狀態，請關閉頁面後從 LIFF 網址重新開啟。");
      return;
    }

    setButtonBusy(button, true, "前往 LINE 登入");

    try {
      window.liff.login({ redirectUri: getCleanPageUrl() });
    } catch (error) {
      setButtonBusy(button, false);
      handleClientError(error);
    }
  }

  function handleLogout() {
    if (isDemoSession) {
      isDemoSession = false;
      currentMember = null;
      setConnection("等待設定", "setup");
      setView("setup-state");
      showToast("已離開預覽模式");
      return;
    }

    if (!window.liff) return;

    currentIdToken = "";
    currentMember = null;
    isProfileOnboardingRequired = false;
    stopPointScannerForPageExit();
    closeDialog(byId("profile-dialog"), true);
    clearInvalidTokenRecoveryGuard();
    clearPendingPointClaim();

    if (window.liff.isInClient()) {
      window.liff.closeWindow();
      return;
    }

    if (window.liff.isLoggedIn()) {
      window.liff.logout();
    }

    window.location.replace(getCleanPageUrl());
  }

  function openProfileEditor() {
    if (!currentMember) return;

    setProfileDialogMode("edit");
    resetProfileForm();
    byId("profile-birthday-input").max = getLocalTodayString();
    openDialog(byId("profile-dialog"));
  }

  function openProfileOnboarding() {
    if (!currentMember || isMemberProfileComplete(currentMember)) return;

    isProfileOnboardingRequired = true;
    setProfileDialogMode("onboarding");
    resetProfileForm();
    byId("profile-birthday-input").max = getLocalTodayString();
    openDialog(byId("profile-dialog"));
    window.requestAnimationFrame(function () {
      var target = currentMember.phone
        ? byId("profile-birthday-input")
        : byId("profile-phone-input");
      target.focus();
    });
  }

  function setProfileDialogMode(mode) {
    var onboarding = mode === "onboarding";
    var dialog = byId("profile-dialog");
    dialog.dataset.mode = onboarding ? "onboarding" : "edit";
    byId("profile-eyebrow").textContent = onboarding
      ? "COMPLETE MEMBER PROFILE"
      : "EDIT MEMBER PROFILE";
    byId("profile-title").textContent = onboarding
      ? "完成會員資料"
      : "編輯會員資料";
    byId("profile-description").textContent = onboarding
      ? "首次使用請填寫電話與生日，完成後即可開始集點。"
      : "你可以隨時更新電話與生日。";
    byId("profile-close-button").hidden = onboarding;
    byId("profile-cancel-button").hidden = onboarding;
    byId("profile-save-button").querySelector("span").textContent = onboarding
      ? "完成加入會員"
      : "儲存資料";
  }

  function handleProfileSubmit(event) {
    event.preventDefault();
    clearProfileErrors();

    var onboarding =
      isProfileOnboardingRequired ||
      byId("profile-dialog").dataset.mode === "onboarding";
    var profile;
    try {
      profile = {
        phone: normalizeMemberPhone(byId("profile-phone-input").value),
        birthday: normalizeMemberBirthday(byId("profile-birthday-input").value),
      };
      assertCompleteMemberProfile(profile);
    } catch (error) {
      showProfileValidationError(error);
      return;
    }

    if (isDemoSession) {
      renderMember(Object.assign({}, currentMember, profile), false);
      byId("sync-caption").textContent = "這是預覽資料，不會寫入後台";
      closeDialog(byId("profile-dialog"));
      showToast("預覽：會員資料已更新");
      return;
    }

    var token = currentIdToken || (window.liff && window.liff.getIDToken()) || "";
    if (!token) {
      showProfileFormError("登入狀態已失效，請重新登入後再試。");
      return;
    }

    setProfileFormBusy(true);
    sendGasRequest("updateMemberProfile", token, getLiffContext(), {
      phone: profile.phone,
      birthday: profile.birthday,
    })
      .then(function (response) {
        assertSuccessfulResponse(response);
        clearInvalidTokenRecoveryGuard();

        if (
          !response.data ||
          !response.data.access ||
          typeof response.data.access.allowed !== "boolean"
        ) {
          throw createClientError("INVALID_RESPONSE", "後台回傳的會員資料格式不完整。");
        }

        if (!response.data.access.allowed) {
          setProfileFormBusy(false);
          isProfileOnboardingRequired = false;
          closeDialog(byId("profile-dialog"), true);
          renderAccessState(response.data.access.status, false);
          return;
        }

        if (!response.data.member) {
          throw createClientError("INVALID_RESPONSE", "後台回傳的會員資料格式不完整。");
        }
        if (onboarding && !isMemberProfileComplete(response.data.member)) {
          throw createClientError("INVALID_RESPONSE", "後台未完整保存電話與生日。");
        }

        renderMember(response.data.member, false);
        byId("sync-caption").textContent = "會員資料已更新";
        setProfileFormBusy(false);
        isProfileOnboardingRequired = false;
        setProfileDialogMode("edit");
        closeDialog(byId("profile-dialog"), true);
        showToast(onboarding ? "會員資料完成，可以開始集點" : "會員資料已儲存");
        if (onboarding) return redeemPendingPointCampaign();
      })
      .catch(function (error) {
        var normalized = normalizeClientError(error);
        if (normalized.code === "INVALID_TOKEN" || normalized.code === "INVALID_ID_TOKEN") {
          setProfileFormBusy(false);
          isProfileOnboardingRequired = false;
          closeDialog(byId("profile-dialog"), true);
          handleClientError(error);
          return;
        }

        if (normalized.code === "INVALID_PHONE" || normalized.code === "INVALID_BIRTHDAY") {
          showProfileValidationError(
            createClientError(normalized.code, normalized.message)
          );
          return;
        }

        if (normalized.code === "MEMBER_ACCESS_DENIED") {
          setProfileFormBusy(false);
          isProfileOnboardingRequired = false;
          closeDialog(byId("profile-dialog"), true);
          renderAccessState("denied", false);
          return;
        }

        showProfileFormError(normalized.message);
      })
      .finally(function () {
        setProfileFormBusy(false);
      });
  }

  function setProfileFormBusy(busy) {
    var dialog = byId("profile-dialog");
    dialog.dataset.busy = busy ? "true" : "false";
    setButtonBusy(byId("profile-save-button"), busy, "正在儲存");
    byId("profile-cancel-button").disabled = busy;
    byId("profile-close-button").disabled = busy;
    byId("profile-phone-input").disabled = busy;
    byId("profile-birthday-input").disabled = busy;
  }

  function resetProfileForm() {
    clearProfileErrors();
    byId("profile-phone-input").value = currentMember ? currentMember.phone || "" : "";
    byId("profile-birthday-input").value = currentMember ? currentMember.birthday || "" : "";
  }

  function assertCompleteMemberProfile(profile) {
    if (!profile || !profile.phone) {
      throw createClientError("INVALID_PHONE", "請填寫電話後再儲存。");
    }
    if (!profile.birthday) {
      throw createClientError("INVALID_BIRTHDAY", "請選擇生日後再儲存。");
    }
  }

  function isMemberProfileComplete(member) {
    return Boolean(
      member &&
      String(member.phone || "").trim() &&
      normalizeBirthdayDisplayValue(member.birthday)
    );
  }

  function clearProfileErrors() {
    ["phone", "birthday"].forEach(function (field) {
      var input = byId("profile-" + field + "-input");
      var error = byId("profile-" + field + "-error");
      input.setAttribute("aria-invalid", "false");
      error.textContent = "";
      error.hidden = true;
    });
    byId("profile-form-error").textContent = "";
    byId("profile-form-error").hidden = true;
  }

  function showProfileValidationError(error) {
    var field = error && error.code === "INVALID_BIRTHDAY" ? "birthday" : "phone";
    var input = byId("profile-" + field + "-input");
    var output = byId("profile-" + field + "-error");
    input.setAttribute("aria-invalid", "true");
    output.textContent = (error && error.message) || "請檢查欄位內容。";
    output.hidden = false;
    input.focus();
  }

  function showProfileFormError(message) {
    var output = byId("profile-form-error");
    output.textContent = message || "無法儲存會員資料，請稍後再試。";
    output.hidden = false;
    output.focus();
  }

  function normalizeMemberPhone(value) {
    var phone = String(value || "").trim();
    if (!phone) return "";

    var digitCount = phone.replace(/\D/g, "").length;
    if (
      phone.length > 30 ||
      !/^[0-9+().\- #xX]+$/.test(phone) ||
      digitCount < 6 ||
      digitCount > 20
    ) {
      throw createClientError(
        "INVALID_PHONE",
        "請輸入 6 至 20 位數字，可使用空格、+、-、括號或分機符號。"
      );
    }
    return phone;
  }

  function normalizeMemberBirthday(value) {
    var birthday = String(value || "").trim();
    if (!birthday) return "";

    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
    if (!match) {
      throw createClientError("INVALID_BIRTHDAY", "請選擇有效的生日。");
    }
    var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (
      date.getUTCFullYear() !== Number(match[1]) ||
      date.getUTCMonth() !== Number(match[2]) - 1 ||
      date.getUTCDate() !== Number(match[3]) ||
      birthday > getLocalTodayString()
    ) {
      throw createClientError("INVALID_BIRTHDAY", "生日必須是有效日期，且不可晚於今天。");
    }
    return birthday;
  }

  function getLocalTodayString() {
    var now = new Date();
    var local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function handleDeleteMember() {
    var button = byId("delete-confirm-button");
    if (button.disabled) return;

    if (isDemoSession) {
      closeDialog(byId("delete-dialog"));
      showToast("預覽模式不會建立或刪除真實資料");
      return;
    }

    var token = currentIdToken || (window.liff && window.liff.getIDToken()) || "";
    if (!token) {
      closeDialog(byId("delete-dialog"));
      showError("MISSING_ID_TOKEN", "登入狀態已失效，請重新登入後再刪除會員資料。");
      return;
    }

    setButtonBusy(button, true, "正在刪除");

    sendGasRequest("deleteMember", token, getLiffContext())
      .then(function (response) {
        assertSuccessfulResponse(response);
        clearInvalidTokenRecoveryGuard();
        closeDialog(byId("delete-dialog"));
        showToast("會員資料已永久刪除");

        window.setTimeout(function () {
          handleLogout();
        }, 900);
      })
      .catch(function (error) {
        closeDialog(byId("delete-dialog"));
        handleClientError(error);
      })
      .finally(function () {
        setButtonBusy(button, false);
      });
  }

  function sendGasRequest(action, idToken, context, fields, requestId) {
    return window.MemberApi.sendRequest({
      gasUrl: String(CONFIG.GAS_WEB_APP_URL).trim(),
      action: action,
      idToken: idToken,
      context: context || {},
      fields: fields || {},
      requestId: requestId,
    });
  }

  function assertSuccessfulResponse(response) {
    if (response && response.ok) return;

    var code = response && response.code ? response.code : "BACKEND_ERROR";
    var message = response && response.message ? response.message : "會員後台暫時無法處理這次請求。";
    throw createClientError(code, message);
  }

  function renderAccessState(status, wasCreated) {
    byId("access-icon").textContent = "×";
    byId("access-badge").textContent = "已停用";
    byId("access-title").textContent = "目前無法進入會員中心";
    byId("access-message").textContent =
      "此帳號已停用。如有疑問，請聯絡服務人員。";
    byId("access-state").dataset.status = "denied";
    byId("access-logout-button").textContent =
      window.liff && window.liff.isInClient() ? "關閉會員中心" : "登出目前裝置";

    setConnection("已停用", "error");
    setView("access-state");

    if (wasCreated) {
      showToast("會員資料已建立，但目前無法使用", "error");
    }
  }

  function renderMember(member, wasCreated) {
    var name = cleanDisplayText(member.displayName, "LINE 會員");
    var pictureUrl = getSafeImageUrl(member.pictureUrl);
    var phone = cleanDisplayText(member.phone, "");
    var birthday = normalizeBirthdayDisplayValue(member.birthday);
    var pointBalance = normalizePointBalance(
      member.pointBalance == null ? 0 : member.pointBalance
    );

    currentMember = Object.assign({}, member, {
      phone: phone,
      birthday: birthday,
      pointBalance: pointBalance,
    });

    byId("member-greeting-name").textContent = name;
    byId("member-display-name").textContent = name;
    byId("member-avatar-fallback").textContent = getInitial(name);
    byId("member-id").textContent = cleanDisplayText(member.memberId, "—");
    byId("member-since").textContent = formatShortDate(member.joinedAt);
    byId("member-phone").textContent = phone || "尚未填寫";
    byId("member-birthday").textContent = birthday
      ? formatBirthday(birthday)
      : "尚未填寫";
    byId("member-point-balance").textContent = formatPointNumber(pointBalance);
    byId("sync-caption").textContent = wasCreated ? "會員建立完成" : "會員資料已同步";

    var avatar = byId("member-avatar");
    var fallback = byId("member-avatar-fallback");
    avatar.onload = function () {
      fallback.hidden = true;
      avatar.hidden = false;
    };
    avatar.onerror = function () {
      avatar.hidden = true;
      fallback.hidden = false;
      avatar.removeAttribute("src");
    };

    if (pictureUrl) {
      avatar.alt = name + " 的 LINE 頭像";
      avatar.referrerPolicy = "no-referrer";
      avatar.src = pictureUrl;
    } else {
      avatar.hidden = true;
      fallback.hidden = false;
      avatar.removeAttribute("src");
    }

    var logoutButton = byId("logout-button");
    logoutButton.textContent =
      window.liff && window.liff.isInClient() ? "關閉會員中心" : "登出目前裝置";

    setConnection(isDemoSession ? "展示模式" : "安全連線", isDemoSession ? "setup" : "connected");
    setView("member-state");

    if (wasCreated) {
      showToast("會員資料建立完成，歡迎加入");
    }
  }

  function renderDemoMember() {
    isDemoSession = true;
    var now = new Date();
    renderMember(
      {
        memberId: "MBR-PREVIEW",
        displayName: "王小明",
        pictureUrl: "",
        phone: "0912 345 678",
        birthday: "1992-06-18",
        pointBalance: 128,
        joinedAt: new Date(now.getFullYear(), 0, 18).toISOString(),
      },
      false
    );
    renderMemberCardSummary(
      {
        settingVersion: "PCS-PREVIEW00001",
        currentPoints: 12,
        targetPoints: 20,
        currentCardNumber: 2,
        availableDraws: 1,
        rewardRules: [
          { points: 5, lotteryTypeId: "LTY-PREVIEW001" },
          { points: 10, lotteryTypeId: "LTY-PREVIEW001" },
          { points: 15, lotteryTypeId: "LTY-PREVIEW001" },
          { points: 20, lotteryTypeId: "LTY-PREVIEW001" },
        ],
        availableRewards: [
          {
            settingVersion: "PCS-PREVIEW00001",
            cardNumber: 2,
            milestonePoints: 10,
            lotteryTypeId: "LTY-PREVIEW002",
            cardRoundKey: "PCS-PREVIEW00001:2:10",
          },
        ],
        expiryMode: "limited",
        expiresOn: "2026-12-31",
      },
      false
    );
    byId("sync-caption").textContent = "這是預覽資料，不會寫入後台";
    openPendingMemberPanel();
  }

  function setView(activeId) {
    STATE_IDS.forEach(function (id) {
      var element = byId(id);
      if (element) element.hidden = id !== activeId;
    });
  }

  function setConnection(label, tone) {
    byId("connection-label").textContent = label;
    byId("connection-status").dataset.tone = tone || "loading";
  }

  function setLoadingCopy(title, message) {
    byId("loading-title").textContent = title;
    var copy = byId("loading-state").querySelector(":scope > p:last-child");
    if (copy) copy.textContent = message;
  }

  function showError(code, message) {
    byId("error-code").textContent = String(code || "CONNECTION_ERROR").replace(/_/g, " ");
    byId("error-message").textContent = message || "連線時發生問題，請稍後再試。";
    setConnection("連線失敗", "error");
    setView("error-state");
  }

  function handleClientError(error) {
    var normalized = normalizeClientError(error);
    console.error("Member app error:", normalized.code, error);

    if (
      (normalized.code === "INVALID_TOKEN" || normalized.code === "INVALID_ID_TOKEN") &&
      tryExternalTokenRecovery()
    ) {
      return;
    }

    showError(normalized.code, normalized.message);
  }

  function tryExternalTokenRecovery() {
    if (!window.liff || window.liff.isInClient()) return false;

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
    setLoadingCopy("正在更新 LINE 登入", "偵測到舊的登入憑證，正在安全地重新登入。");
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

  function getStoredPointClaim() {
    try {
      return String(
        window.sessionStorage.getItem(getPointClaimStorageKey()) || ""
      ).trim();
    } catch (_error) {
      return "";
    }
  }

  function ensurePendingPointRedemptionRequestId() {
    if (/^[a-zA-Z0-9-]{10,80}$/.test(pendingPointRedemptionRequestId)) {
      return pendingPointRedemptionRequestId;
    }
    try {
      var stored = String(
        window.sessionStorage.getItem(getPointRedemptionRequestStorageKey()) || ""
      );
      if (/^[a-zA-Z0-9-]{10,80}$/.test(stored)) {
        pendingPointRedemptionRequestId = stored;
        return stored;
      }
    } catch (_error) {
      // sessionStorage may be unavailable in privacy-restricted browsers.
    }
    pendingPointRedemptionRequestId = window.MemberApi.createRequestId();
    try {
      window.sessionStorage.setItem(
        getPointRedemptionRequestStorageKey(),
        pendingPointRedemptionRequestId
      );
    } catch (_error) {
      // The in-memory value still protects retries during this page session.
    }
    return pendingPointRedemptionRequestId;
  }

  function clearPendingPointRedemptionRequest() {
    pendingPointRedemptionRequestId = "";
    try {
      window.sessionStorage.removeItem(getPointRedemptionRequestStorageKey());
    } catch (_error) {
      // sessionStorage may be unavailable in privacy-restricted browsers.
    }
  }

  function normalizeClientError(error) {
    var code = error && (error.code || error.name);
    var message = error && error.message;
    var errorText = String(code || "") + " " + String(message || "");
    var knownMessages = {
      INVALID_TOKEN: "LINE 登入憑證無效或已過期，請重新登入後再試。",
      INVALID_ID_TOKEN: "LINE 登入憑證已失效，請重新登入後再試。",
      MISSING_ID_TOKEN: "沒有取得 LINE 登入憑證。請確認 LIFF 已勾選 openid 權限。",
      INVALID_POINT_QR: "這不是有效的會員點數 QR Code，請重新掃描。",
      SCAN_QR_UNAVAILABLE:
        "目前 LIFF 未開放 QR 掃描，請在 LINE Developers 開啟 Scan QR，並將 LIFF Size 設為 Full。",
      CONFIG_ERROR: "GAS 後台尚未完成設定，請檢查 Script Properties。",
      ORIGIN_NOT_ALLOWED: "目前網站來源未被 GAS 允許，請檢查 ALLOWED_ORIGINS。",
      SPREADSHEET_ERROR: "會員試算表目前無法使用，請檢查試算表 ID 與權限。",
      BUSY: "會員資料正在同步，請稍候幾秒後再試。",
      LINE_RATE_LIMITED: "LINE 驗證請求較多，請稍候一分鐘再試。",
      LINE_UNAVAILABLE: "LINE 驗證服務暫時無法使用，請稍後再試。",
      MEMBER_DELETED: "會員資料剛完成刪除，請重新登入後再建立會員。",
      MEMBER_NOT_FOUND: "找不到會員資料，請重新登入後再試。",
      MEMBER_ACCESS_DENIED: "目前帳號已停用，無法修改會員資料。",
      INVALID_PHONE: "電話格式不正確，請檢查後再試。",
      INVALID_BIRTHDAY: "生日格式不正確，且不可晚於今天。",
      INVALID_POINT_CLAIM: "這張 QR 的領點憑證格式不正確。",
      POINT_CAMPAIGN_NOT_FOUND: "找不到這個點數活動，請確認 QR Code。",
      POINT_CAMPAIGN_INACTIVE: "這個點數活動目前未開放領取。",
      POINT_CAMPAIGN_EXPIRED: "這個點數活動已經結束。",
      POINT_DATA_ERROR: "點數資料目前無法使用，請聯絡服務人員。",
      POINT_SCHEMA_MISMATCH: "點數資料表格式不正確，請聯絡管理員。",
      POINT_CARD_NOT_CONFIGURED: "管理員尚未完成集點卡設定。",
      POINT_CARD_DATA_ERROR: "集點卡資料目前無法使用，請聯絡管理員。",
      LOTTERY_NOT_CONFIGURED: "管理員尚未設定轉盤獎項，請稍後再試。",
      INSUFFICIENT_POINTS: "目前點數不足，需要 5 點才能抽獎。",
      LOTTERY_DATA_ERROR: "轉盤或抽獎紀錄目前無法使用，請聯絡服務人員。",
      LOTTERY_SCHEMA_MISMATCH: "轉盤資料表格式不正確，請聯絡管理員。",
      INVALID_RESPONSE: "後台回傳的資料格式不完整，請稍後再試。",
    };

    if (/(subwindowopen|scancodev2|no permission for liff)/i.test(errorText)) {
      code = "SCAN_QR_UNAVAILABLE";
    }

    if (knownMessages[code]) message = knownMessages[code];

    return {
      code: code || "CONNECTION_ERROR",
      message: message || "連線時發生問題，請稍後再試。",
    };
  }

  function createClientError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function getLiffContext() {
    return window.LiffRuntime.getContext(window.liff, window.navigator);
  }

  function hasCompleteConfig() {
    return window.LiffRuntime.hasCompleteConfig(CONFIG, window.MemberApi);
  }

  function hasDemoQuery() {
    return window.LiffRuntime.hasDemoQuery(window.location.search);
  }

  function getCleanPageUrl() {
    var url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    if (
      pendingPointClaim &&
      !isPointClaimPersisted &&
      /^[A-Za-z0-9_-]{43}$/.test(pendingPointClaim)
    ) {
      url.searchParams.set("claim", pendingPointClaim);
    }
    if (
      typeof pendingMemberPanel !== "undefined" &&
      (pendingMemberPanel === "tickets" || pendingMemberPanel === "history")
    ) {
      url.searchParams.set("panel", pendingMemberPanel);
    }
    return url.toString();
  }

  function cleanDisplayText(value, fallback) {
    var text = String(value == null ? "" : value).trim();
    return text || fallback;
  }

  function getInitial(name) {
    return Array.from(String(name || "M").trim())[0] || "M";
  }

  function getSafeImageUrl(value) {
    if (!value) return "";
    try {
      var url = new URL(String(value));
      return url.protocol === "https:" ? url.toString() : "";
    } catch (_error) {
      return "";
    }
  }

  function formatShortDate(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return MEMBER_SHORT_DATE_FORMATTER
      .format(date)
      .replace(/\//g, ".");
  }

  function normalizeBirthdayDisplayValue(value) {
    var birthday = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : "";
  }

  function formatBirthday(value) {
    var birthday = normalizeBirthdayDisplayValue(value);
    return birthday ? birthday.replace(/-/g, ".") : "尚未填寫";
  }

  function setButtonBusy(button, busy, busyLabel) {
    if (!button) return;
    var label = button.querySelector("span") || button;

    if (busy) {
      button.dataset.originalLabel = label.textContent;
      button.dataset.originalDisabled = String(button.disabled);
      button.disabled = true;
      label.textContent = busyLabel || "處理中";
      button.setAttribute("aria-busy", "true");
      return;
    }

    if (!("originalLabel" in button.dataset)) {
      button.removeAttribute("aria-busy");
      return;
    }

    button.disabled = button.dataset.originalDisabled === "true";
    label.textContent = button.dataset.originalLabel || label.textContent;
    button.removeAttribute("aria-busy");
    delete button.dataset.originalLabel;
    delete button.dataset.originalDisabled;
  }

  function openDialog(dialog) {
    if (!dialog) return;
    if (dialog.open || dialog.hasAttribute("open")) return;
    dialog.removeAttribute("hidden");
    if (typeof dialog.showModal === "function") {
      try {
        dialog.showModal();
      } catch (_error) {
        dialog.setAttribute("open", "");
      }
      if (!dialog.open && !dialog.hasAttribute("open")) {
        dialog.setAttribute("open", "");
      }
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeDialog(dialog, force) {
    if (!dialog) return;
    if (
      dialog.id === "member-lottery-dialog" &&
      window.MemberLotteryDialog &&
      !window.MemberLotteryDialog.canClose() &&
      !force
    ) {
      return;
    }
    if (
      dialog.id === "profile-dialog" &&
      dialog.dataset.busy === "true" &&
      !force
    ) {
      return;
    }
    if (
      dialog.id === "profile-dialog" &&
      dialog.dataset.mode === "onboarding" &&
      !force
    ) {
      return;
    }
    if (dialog.id === "claim-dialog" && dialog.dataset.busy === "true") return;
    if (dialog.id === "delete-dialog") resetDeleteConfirmation();
    if (dialog.id === "profile-dialog") resetProfileForm();
    if (typeof dialog.close === "function" && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  function resetDeleteConfirmation() {
    var button = byId("delete-confirm-button");
    setButtonBusy(button, false);
    byId("delete-confirm-input").value = "";
    button.disabled = true;
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

  function applyBrand() {
    var brand = cleanDisplayText(CONFIG.BRAND_NAME, "PERSONA").slice(0, 28);
    document.querySelectorAll("[data-brand-name]").forEach(function (element) {
      element.textContent = brand;
    });
    document.title = brand + " MEMBERS｜會員中心";
  }

  function bindInteractions() {
    byId("login-button").addEventListener("click", handleLogin);
    byId("logout-button").addEventListener("click", handleLogout);
    byId("access-refresh-button").addEventListener("click", boot);
    byId("access-logout-button").addEventListener("click", handleLogout);
    byId("retry-button").addEventListener("click", start);
    byId("preview-button").addEventListener("click", renderDemoMember);
    byId("delete-confirm-button").addEventListener("click", handleDeleteMember);
    byId("edit-profile-button").addEventListener("click", openProfileEditor);
    byId("profile-form").addEventListener("submit", handleProfileSubmit);
    byId("scan-point-button").addEventListener("click", handleScanPointQr);
    byId("lottery-page-link").addEventListener("click", openMemberTicketDialog);
    byId("open-point-history-button").addEventListener(
      "click",
      openPointHistoryDialog
    );
    byId("refresh-point-history-button").addEventListener(
      "click",
      loadPointHistory
    );
    ["locked", "earned"].forEach(function (name) {
      byId("member-" + name + "-ticket-tab").addEventListener(
        "click",
        function () {
          selectMemberTicketTab(name, false);
        }
      );
      byId("member-" + name + "-ticket-tab").addEventListener(
        "keydown",
        handleMemberTicketTabKeydown
      );
    });
    byId("point-scanner-cancel-button").addEventListener(
      "click",
      cancelEmbeddedPointScanner
    );
    byId("claim-retry-button").addEventListener("click", redeemPendingPointCampaign);
    [
      "claim-success-close-button",
      "claim-duplicate-close-button",
      "claim-error-close-button",
    ].forEach(function (id) {
      byId(id).addEventListener("click", function () {
        closeDialog(byId("claim-dialog"));
      });
    });

    document.querySelectorAll("[data-open-dialog]").forEach(function (button) {
      button.addEventListener("click", function () {
        openDialog(byId(button.dataset.openDialog));
      });
    });

    document.querySelectorAll("[data-close-dialog]").forEach(function (button) {
      button.addEventListener("click", function () {
        closeDialog(button.closest("dialog"));
      });
    });

    document.querySelectorAll("dialog").forEach(function (dialog) {
      dialog.addEventListener("click", function (event) {
        if (event.target !== dialog) return;
        if (dialog.id === "claim-dialog" || dialog.id === "point-scanner-dialog") {
          return;
        }
        closeDialog(dialog);
      });
      dialog.addEventListener("cancel", function (event) {
        if (
          dialog.id === "claim-dialog" ||
          dialog.id === "point-scanner-dialog" ||
          (dialog.id === "profile-dialog" &&
            dialog.dataset.mode === "onboarding")
        ) {
          event.preventDefault();
        }
      });
    });

    byId("delete-confirm-input").addEventListener("input", function (event) {
      byId("delete-confirm-button").disabled = event.target.value.trim() !== "刪除";
    });

    byId("delete-dialog").addEventListener("close", function () {
      resetDeleteConfirmation();
    });

    byId("profile-dialog").addEventListener("close", function () {
      resetProfileForm();
      window.requestAnimationFrame(openPendingMemberPanel);
    });

    byId("claim-dialog").addEventListener("close", function () {
      window.requestAnimationFrame(openPendingMemberPanel);
    });

    byId("profile-dialog").addEventListener("cancel", function (event) {
      if (
        event.currentTarget.dataset.busy === "true" ||
        event.currentTarget.dataset.mode === "onboarding"
      ) {
        event.preventDefault();
      }
    });

    byId("point-scanner-dialog").addEventListener("cancel", function (event) {
      event.preventDefault();
      cancelEmbeddedPointScanner();
    });

    byId("claim-dialog").addEventListener("cancel", function (event) {
      if (event.currentTarget.dataset.busy === "true") event.preventDefault();
    });

    ["phone", "birthday"].forEach(function (field) {
      byId("profile-" + field + "-input").addEventListener("input", function () {
        var input = byId("profile-" + field + "-input");
        var output = byId("profile-" + field + "-error");
        input.setAttribute("aria-invalid", "false");
        output.textContent = "";
        output.hidden = true;
        byId("profile-form-error").hidden = true;
      });
    });

    window.addEventListener("pagehide", stopPointScannerForPageExit);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  bindInteractions();
  byId("current-year").textContent = String(new Date().getFullYear());

  function start() {
    setConnection("正在載入設定", "loading");
    setLoadingCopy("正在載入會員系統", "讀取公開設定並準備 LINE 登入服務。請稍候。");
    setView("loading-state");

    return loadConfig()
      .then(function () {
        applyBrand();
        configureMemberLotteryDialog();
        return boot();
      })
      .catch(handleClientError);
  }

  start();
})();
