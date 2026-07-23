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
  var isPointHistoryLoading = false;
  var pointHistoryRequestVersion = 0;

  function loadConfig() {
    if (!window.MemberApi) {
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
    pointHistoryRequestVersion += 1;
    isPointHistoryLoading = false;
    isDemoSession = false;
    currentMember = null;
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

        renderMember(response.data.member, Boolean(response.data.created));
        return Promise.resolve(redeemPendingPointCampaign()).then(function () {
          return loadPointHistory();
        });
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
    sendGasRequest("redeemPointCampaign", token, getLiffContext(), {
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
      })
      .catch(handlePointClaimError)
      .finally(function () {
        setPointClaimBusy(false);
      });
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

  function updateMemberPointBalance(balance, animate) {
    var normalizedBalance = normalizePointBalance(balance);
    var output = byId("member-point-balance");
    var container = output.closest(".pass-points");

    output.textContent = formatPointNumber(normalizedBalance);
    if (currentMember) currentMember.pointBalance = normalizedBalance;

    if (animate && container) {
      container.removeAttribute("data-updated");
      window.requestAnimationFrame(function () {
        container.dataset.updated = "true";
        window.setTimeout(function () {
          container.removeAttribute("data-updated");
        }, 650);
      });
    }
  }

  function loadPointHistory() {
    if (isDemoSession) return Promise.resolve();

    var token = currentIdToken || (window.liff && window.liff.getIDToken()) || "";
    if (!token) return Promise.resolve();

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
          throw createClientError("INVALID_RESPONSE", "後台回傳的點數紀錄格式不完整。");
        }

        updateMemberPointBalance(normalizePointBalance(response.data.pointBalance), false);
        renderPointHistory(response.data.history, response.data.hasMore);
      })
      .catch(function (error) {
        if (requestVersion !== pointHistoryRequestVersion) return;
        var normalized = normalizeClientError(error);
        if (
          normalized.code === "INVALID_TOKEN" ||
          normalized.code === "INVALID_ID_TOKEN" ||
          normalized.code === "MISSING_ID_TOKEN"
        ) {
          handleClientError(error);
          return;
        }
        if (normalized.code === "MEMBER_ACCESS_DENIED") {
          renderAccessState("denied", false);
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

  function normalizePointHistoryEntry(value) {
    value = value && typeof value === "object" ? value : {};
    var redemptionId = String(value.redemptionId || "").trim();
    var points = Number(value.points);
    var label = String(value.label || "").trim();
    var balanceAfter = Number(value.balanceAfter);
    var redeemedAt = String(value.redeemedAt || "").trim();
    var redemptionMode = String(value.redemptionMode || "").trim().toLowerCase();
    var source = String(value.source || "").trim().toLowerCase();
    var date = new Date(redeemedAt);
    if (
      !/^RDM-[A-Z0-9]{16}$/.test(redemptionId) ||
      !Number.isSafeInteger(points) ||
      points < 1 ||
      points > 9999 ||
      label !== points + " 點" ||
      !Number.isSafeInteger(balanceAfter) ||
      balanceAfter < points ||
      Number.isNaN(date.getTime()) ||
      (redemptionMode !== "once_per_member" &&
        redemptionMode !== "repeatable" &&
        redemptionMode !== "single_member") ||
      source !== "qr"
    ) {
      throw createClientError("INVALID_RESPONSE", "後台回傳的點數紀錄格式不正確。");
    }
    return {
      redemptionId: redemptionId,
      label: label,
      points: points,
      balanceAfter: balanceAfter,
      redeemedAt: date.toISOString(),
      redemptionMode: redemptionMode,
      source: source,
    };
  }

  function renderPointHistoryLoading() {
    isPointHistoryLoading = true;
    byId("point-history-loading").hidden = false;
    byId("point-history-error").hidden = true;
    byId("point-history-empty").hidden = true;
    byId("refresh-point-history-button").disabled = true;
    byId("point-history-list").setAttribute("aria-busy", "true");
    byId("point-history-summary").textContent = "正在更新";
  }

  function renderPointHistory(entries, hasMore) {
    var list = byId("point-history-list");
    var normalizedEntries = entries.map(normalizePointHistoryEntry);
    isPointHistoryLoading = false;
    list.textContent = "";
    list.setAttribute("aria-busy", "false");
    byId("point-history-loading").hidden = true;
    byId("point-history-error").hidden = true;
    byId("point-history-empty").hidden = normalizedEntries.length !== 0;
    byId("refresh-point-history-button").disabled = false;
    byId("point-history-summary").textContent = normalizedEntries.length
      ? "最近 " + normalizedEntries.length + " 筆" + (hasMore ? " · 還有更多" : "")
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
      marker.className = "point-history-marker";
      marker.setAttribute("aria-hidden", "true");
      content.className = "point-history-content";
      title.textContent = entry.label + " · 獲得點數";
      meta.textContent =
        formatPointHistoryDate(entry.redeemedAt) +
        " · " +
        formatPointHistoryMode(entry.redemptionMode);
      amount.className = "point-history-amount";
      amount.textContent = "+" + formatPointNumber(entry.points) + " 點";
      balance.className = "point-history-balance";
      balance.textContent = "餘額 " + formatPointNumber(entry.balanceAfter);

      content.appendChild(title);
      content.appendChild(meta);
      item.appendChild(marker);
      item.appendChild(content);
      item.appendChild(amount);
      item.appendChild(balance);
      list.appendChild(item);
    });
  }

  function renderPointHistoryError(message) {
    var list = byId("point-history-list");
    isPointHistoryLoading = false;
    list.textContent = "";
    list.setAttribute("aria-busy", "false");
    byId("point-history-loading").hidden = true;
    byId("refresh-point-history-button").disabled = false;
    byId("point-history-empty").hidden = true;
    byId("point-history-summary").textContent = "載入失敗";
    byId("point-history-error").textContent =
      message || "目前無法讀取點數紀錄，請稍後再試。";
    byId("point-history-error").hidden = false;
  }

  function formatPointHistoryDate(value) {
    var date = new Date(value);
    return new Intl.DateTimeFormat("zh-TW", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function formatPointHistoryMode(mode) {
    return mode === "repeatable"
      ? "可重複 QR"
      : mode === "single_member"
        ? "單人 QR"
        : "會員一次 QR";
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
    return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(value);
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

    resetProfileForm();
    byId("profile-birthday-input").max = getLocalTodayString();
    openDialog(byId("profile-dialog"));
  }

  function handleProfileSubmit(event) {
    event.preventDefault();
    clearProfileErrors();

    var profile;
    try {
      profile = {
        phone: normalizeMemberPhone(byId("profile-phone-input").value),
        birthday: normalizeMemberBirthday(byId("profile-birthday-input").value),
      };
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
          closeDialog(byId("profile-dialog"));
          renderAccessState(response.data.access.status, false);
          return;
        }

        if (!response.data.member) {
          throw createClientError("INVALID_RESPONSE", "後台回傳的會員資料格式不完整。");
        }

        renderMember(response.data.member, false);
        loadPointHistory();
        byId("sync-caption").textContent = "會員資料已更新";
        setProfileFormBusy(false);
        closeDialog(byId("profile-dialog"));
        showToast("會員資料已儲存");
      })
      .catch(function (error) {
        var normalized = normalizeClientError(error);
        if (normalized.code === "INVALID_TOKEN" || normalized.code === "INVALID_ID_TOKEN") {
          setProfileFormBusy(false);
          closeDialog(byId("profile-dialog"));
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
          closeDialog(byId("profile-dialog"));
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
      "管理員目前已停用這個帳號的會員系統使用權。若你認為狀態有誤，請聯絡服務人員後再重新確認。";
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
    renderPointHistoryLoading();

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
    renderPointHistory([
      {
        redemptionId: "RDM-PREVIEW00000001",
        label: "20 點",
        points: 20,
        balanceAfter: 128,
        redeemedAt: new Date(now.getTime() - 86400000).toISOString(),
        redemptionMode: "once_per_member",
        source: "qr",
      },
      {
        redemptionId: "RDM-PREVIEW00000002",
        label: "8 點",
        points: 8,
        balanceAfter: 108,
        redeemedAt: new Date(now.getTime() - 4 * 86400000).toISOString(),
        redemptionMode: "repeatable",
        source: "qr",
      },
    ], false);
    byId("sync-caption").textContent = "這是預覽資料，不會寫入後台";
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
    var knownMessages = {
      INVALID_TOKEN: "LINE 登入憑證無效或已過期，請重新登入後再試。",
      INVALID_ID_TOKEN: "LINE 登入憑證已失效，請重新登入後再試。",
      MISSING_ID_TOKEN: "沒有取得 LINE 登入憑證。請確認 LIFF 已勾選 openid 權限。",
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
      INVALID_RESPONSE: "後台回傳的資料格式不完整，請稍後再試。",
    };

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
    var gasUrl = String(CONFIG.GAS_WEB_APP_URL || "").trim();

    if (!liffId || /YOUR_|請填入|REPLACE/i.test(liffId)) return false;
    if (!gasUrl || /YOUR_|請填入|REPLACE/i.test(gasUrl)) return false;

    return Boolean(window.MemberApi && window.MemberApi.isValidGasUrl(gasUrl));
  }

  function hasDemoQuery() {
    return new URLSearchParams(window.location.search).get("demo") === "1";
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
    return new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
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

  function closeDialog(dialog) {
    if (!dialog) return;
    if (dialog.id === "profile-dialog" && dialog.dataset.busy === "true") return;
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
    byId("refresh-point-history-button").addEventListener("click", loadPointHistory);
    byId("delete-confirm-button").addEventListener("click", handleDeleteMember);
    byId("edit-profile-button").addEventListener("click", openProfileEditor);
    byId("profile-form").addEventListener("submit", handleProfileSubmit);
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
        if (dialog.id === "claim-dialog") return;
        closeDialog(dialog);
      });
      dialog.addEventListener("cancel", function (event) {
        if (dialog.id === "claim-dialog") event.preventDefault();
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
    });

    byId("profile-dialog").addEventListener("cancel", function (event) {
      if (event.currentTarget.dataset.busy === "true") event.preventDefault();
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
        return boot();
      })
      .catch(handleClientError);
  }

  start();
})();
