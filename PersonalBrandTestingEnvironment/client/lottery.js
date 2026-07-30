(function () {
  "use strict";

  var CONFIG = Object.freeze({});
  var currentIdToken = "";
  var lotteryTypes = [];
  var selectedLotteryTypeId = "";
  var selectedRewardTicket = null;
  var cardStatus = null;
  var lotteryRotation = 0;
  var waitingSpinFrame = 0;
  var waitingSpinLastTime = 0;
  var settlingSpinFrame = 0;
  var spinAnimationVersion = 0;
  var isBusy = false;
  var isDemoSession = false;
  var pendingRequest = null;
  var toastTimer = null;
  var bootVersion = 0;
  var wheelRenderCache = Object.create(null);
  var isWheelPreparing = false;
  var activeTicketTab = "";
  var requestedCardRoundKey = "";
  var requestedTicketError = "";
  var SPIN_DEGREES_PER_MS = 1.45;
  var FINAL_SPIN_TURNS = 2;
  var WHEEL_PRELOAD_LIMIT = 8;
  var STATE_IDS = [
    "loading-state",
    "login-state",
    "setup-state",
    "error-state",
    "lottery-state",
  ];
  var REQUEST_STORAGE_PREFIX = "persona-member-lottery-round-request:";
  var INVALID_TOKEN_RECOVERY_PREFIX = "persona-member-lottery-token-recovery:";

  function byId(id) {
    return document.getElementById(id);
  }

  function start() {
    setView("loading-state");
    setLoading("正在準備轉盤", "確認抽獎券與獎項設定。");
    return loadConfig()
      .then(function () {
        applyBrand();
        return boot();
      })
      .catch(handleFatalError);
  }

  function loadConfig() {
    if (!window.MemberApi || !window.LiffRuntime || !window.LotteryWheel) {
      return Promise.reject(createError("CLIENT_LIBRARY_ERROR", "無法載入會員連線元件。"));
    }
    return window.MemberApi
      .loadConfig("config.json", ["LIFF_ID", "GAS_WEB_APP_URL", "BRAND_NAME"])
      .then(function (config) {
        CONFIG = config;
      });
  }

  function boot() {
    var thisBoot = ++bootVersion;
    isBusy = false;
    stopSpinAnimation();
    byId("lottery-state").setAttribute("aria-busy", "false");
    activeTicketTab = "";
    isDemoSession = hasDemoQuery();
    captureRequestedCardRoundKey();
    syncMemberRoutes();
    setView("loading-state");
    setLoading("正在確認會員身分", "連線 LINE 並讀取集點卡進度。");

    if (isDemoSession) {
      renderDemo();
      return Promise.resolve();
    }
    if (!hasCompleteConfig()) {
      setView("setup-state");
      return Promise.resolve();
    }
    if (!window.liff) {
      handleFatalError(createError("LIFF_SDK_UNAVAILABLE", "無法載入 LINE 登入元件。"));
      return Promise.resolve();
    }

    return window.liff
      .init({
        liffId: String(CONFIG.LIFF_ID).trim(),
        withLoginOnExternalBrowser: false,
      })
      .then(function () {
        if (thisBoot !== bootVersion) return;
        if (!window.liff.isLoggedIn()) {
          setView("login-state");
          return;
        }
        currentIdToken = window.liff.getIDToken() || "";
        if (!currentIdToken) {
          throw createError("MISSING_ID_TOKEN", "沒有取得 LINE 登入憑證。");
        }
        return loadLotteryWorkspace(thisBoot);
      })
      .catch(function (error) {
        if (thisBoot !== bootVersion) return;
        handleFatalError(error);
      });
  }

  function loadLotteryWorkspace(expectedBootVersion, preserveView) {
    var lotteryState = byId("lottery-state");
    if (preserveView) {
      lotteryState.setAttribute("aria-busy", "true");
    } else {
      setView("loading-state");
      setLoading("正在準備轉盤", "確認抽獎資格與轉盤設定。");
    }
    return sendMemberRequest("getLotteryConfig", {})
      .then(function (response) {
        if (expectedBootVersion !== bootVersion) return false;
        assertSuccessfulResponse(response);
        if (
          !response.data ||
          !response.data.access ||
          response.data.access.allowed !== true ||
          !Array.isArray(response.data.lotteryTypes) ||
          !response.data.card
        ) {
          throw createError("INVALID_RESPONSE", "後台回傳的抽獎資料格式不完整。");
        }
        clearInvalidTokenRecoveryGuard();
        renderWorkspace(response.data);
        return true;
      })
      .catch(function (error) {
        if (expectedBootVersion !== bootVersion) return false;
        var authorizationError = isAuthorizationError(error);
        if (!preserveView || authorizationError) {
          handleFatalError(error);
          return false;
        }
        showToast(normalizeError(error).message, "error");
        return false;
      })
      .finally(function () {
        if (!preserveView || expectedBootVersion !== bootVersion) return;
        lotteryState.setAttribute("aria-busy", "false");
      });
  }

  function sendMemberRequest(action, fields, requestId) {
    return window.MemberApi.sendRequest({
      gasUrl: String(CONFIG.GAS_WEB_APP_URL).trim(),
      action: action,
      idToken: currentIdToken,
      context: getLiffContext(),
      fields: fields || {},
      requestId: requestId,
    });
  }

  function renderWorkspace(data) {
    lotteryTypes = normalizeLotteryTypes(data.lotteryTypes);
    cardStatus = normalizePointCardStatus(data.card);
    var totalPoints = normalizePointNumber(
      data.totalPoints == null ? data.pointBalance : data.totalPoints
    );
    if (totalPoints !== cardStatus.totalPoints) {
      throw createError("INVALID_RESPONSE", "累計點數與集點卡資料不一致。");
    }
    pendingRequest = readPendingRequest();
    if (pendingRequest && isRestorablePendingTicket(pendingRequest)) {
      selectedRewardTicket = pendingTicketResponse(pendingRequest);
      selectedLotteryTypeId = pendingRequest.lotteryTypeId;
    } else {
      if (pendingRequest) clearPendingRequest();
      selectedRewardTicket = null;
      selectedLotteryTypeId = "";
    }
    if (!selectedRewardTicket && requestedCardRoundKey) {
      selectedRewardTicket =
        cardStatus.availableRewards.find(function (ticket) {
          return ticket.cardRoundKey === requestedCardRoundKey;
        }) || null;
      if (selectedRewardTicket) {
        selectedLotteryTypeId = selectedRewardTicket.lotteryTypeId;
      } else {
        requestedTicketError = "這張抽獎券已使用或不存在，請返回會員資料重新選擇。";
      }
    }
    requestedCardRoundKey = "";
    clearRequestedTicketFromUrl();
    preloadLotteryWheels();

    renderPointCard();
    renderLotteryTickets();
    setView("lottery-state");
    showLotteryTicketView();
    if (selectedRewardTicket) openLotteryTicket(selectedRewardTicket);
    else if (requestedTicketError) {
      showToast(requestedTicketError, "error");
      requestedTicketError = "";
    }
    updateControls();
  }

  function renderDemo() {
    currentIdToken = "";
    var now = new Date().toISOString();
    renderWorkspace({
      access: { allowed: true, status: "approved" },
      totalPoints: 32,
      card: {
        settingVersion: "PCS-PREVIEW00001",
        targetPoints: 20,
        expiryMode: "limited",
        expiresOn: "2026-12-31",
        rewardMilestones: [5, 10, 15, 20],
        rewardRules: [
          { points: 5, lotteryTypeId: "LTY-PREVIEW001" },
          { points: 10, lotteryTypeId: "LTY-PREVIEW002" },
          { points: 15, lotteryTypeId: "LTY-PREVIEW001" },
          { points: 20, lotteryTypeId: "LTY-PREVIEW002" },
        ],
        reachedMilestones: [5, 10],
        currentPoints: 12,
        nextMilestonePoints: 15,
        pointsRemaining: 3,
        pointsToCardComplete: 8,
        currentCardNumber: 2,
        currentRound: 2,
        completedCards: 1,
        completedRounds: 1,
        earnedRewards: 6,
        drawsUsed: 5,
        availableDraws: 1,
        availableRewards: [
          {
            settingVersion: "PCS-PREVIEW00001",
            cardNumber: 2,
            milestonePoints: 10,
            lotteryTypeId: "LTY-PREVIEW002",
            cardRoundKey: "PCS-PREVIEW00001:2:10",
          },
        ],
        totalPoints: 32,
      },
      lotteryTypes: [
        {
          lotteryTypeId: "LTY-PREVIEW001",
          name: "經典轉盤",
          lottery: {
            lotteryTypeId: "LTY-PREVIEW001",
            configVersion: "LCF-PREVIEW00001",
            updatedAt: now,
            prizes: [
              { prizeId: "LPR-PREVIEW001", label: "銘謝惠顧", color: "#D9D6CC", probability: 50 },
              { prizeId: "LPR-PREVIEW002", label: "小禮物", color: "#8DCCAA", probability: 30 },
              { prizeId: "LPR-PREVIEW003", label: "精選獎", color: "#F0C36A", probability: 15 },
              { prizeId: "LPR-PREVIEW004", label: "頭獎", color: "#0B3C2C", probability: 5 },
            ],
          },
        },
        {
          lotteryTypeId: "LTY-PREVIEW002",
          name: "生日限定",
          lottery: {
            lotteryTypeId: "LTY-PREVIEW002",
            configVersion: "LCF-PREVIEW00002",
            updatedAt: now,
            prizes: [
              { prizeId: "LPR-PREVIEW005", label: "生日祝福", color: "#C87965", probability: 60 },
              { prizeId: "LPR-PREVIEW006", label: "限定禮物", color: "#A89CC8", probability: 30 },
              { prizeId: "LPR-PREVIEW007", label: "生日頭獎", color: "#0B3C2C", probability: 10 },
            ],
          },
        },
      ],
    });
  }

  function normalizeLotteryTypes(value) {
    if (!Array.isArray(value) || value.length < 1) {
      throw createError("INVALID_RESPONSE", "目前沒有可使用的轉盤類型。");
    }
    var ids = Object.create(null);
    return value.map(function (item) {
      item = item && typeof item === "object" ? item : {};
      var lotteryTypeId = String(item.lotteryTypeId || "").trim();
      var name = String(item.name || "").trim();
      if (
        !/^LTY-[A-Z0-9]{10}$/.test(lotteryTypeId) ||
        ids[lotteryTypeId] ||
        !name ||
        name.length > 40
      ) {
        throw createError("INVALID_RESPONSE", "轉盤類型格式不正確。");
      }
      ids[lotteryTypeId] = true;
      return {
        lotteryTypeId: lotteryTypeId,
        name: name,
        lottery: normalizeLotteryConfig(item.lottery, lotteryTypeId),
      };
    });
  }

  function normalizeLotteryConfig(value, expectedTypeId) {
    value = value && typeof value === "object" ? value : {};
    var lotteryTypeId = String(value.lotteryTypeId || "").trim();
    var configVersion = String(value.configVersion || "").trim();
    var updatedAt = String(value.updatedAt || "").trim();
    var rawPrizes = Array.isArray(value.prizes) ? value.prizes : [];
    if (
      lotteryTypeId !== expectedTypeId ||
      !/^LCF-[A-Z0-9]{12}$/.test(configVersion) ||
      Number.isNaN(new Date(updatedAt).getTime()) ||
      rawPrizes.length < 2 ||
      rawPrizes.length > 12
    ) {
      throw createError("INVALID_RESPONSE", "轉盤設定格式不正確。");
    }
    var prizeIds = Object.create(null);
    var totalBasisPoints = 0;
    var prizes = rawPrizes.map(function (prize) {
      prize = prize && typeof prize === "object" ? prize : {};
      var prizeId = String(prize.prizeId || "").trim();
      var label = String(prize.label || "").trim();
      var color = String(prize.color || "").trim().toUpperCase();
      var probability = Number(prize.probability);
      var basisPoints = Math.round(probability * 100);
      if (
        !/^LPR-[A-Z0-9]{10}$/.test(prizeId) ||
        prizeIds[prizeId] ||
        !label ||
        label.length > 40 ||
        !/^#[0-9A-F]{6}$/.test(color) ||
        !Number.isFinite(probability) ||
        probability <= 0 ||
        probability >= 100 ||
        Math.abs(basisPoints / 100 - probability) > 0.000001
      ) {
        throw createError("INVALID_RESPONSE", "轉盤獎項格式不正確。");
      }
      prizeIds[prizeId] = true;
      totalBasisPoints += basisPoints;
      return {
        prizeId: prizeId,
        label: label,
        color: color,
        probability: probability,
      };
    });
    if (totalBasisPoints !== 10000) {
      throw createError("INVALID_RESPONSE", "轉盤機率合計不是 100%。");
    }
    return {
      lotteryTypeId: lotteryTypeId,
      configVersion: configVersion,
      updatedAt: updatedAt,
      prizes: prizes,
    };
  }

  function normalizePointCardStatus(value) {
    value = value && typeof value === "object" ? value : {};
    var rewardMilestones = Array.isArray(value.rewardMilestones)
      ? value.rewardMilestones.map(Number)
      : [];
    var rewardRules = Array.isArray(value.rewardRules)
      ? value.rewardRules.map(function (rule) {
          rule = rule && typeof rule === "object" ? rule : {};
          return {
            points: Number(rule.points),
            lotteryTypeId: String(rule.lotteryTypeId || "").trim(),
          };
        })
      : [];
    var reachedMilestones = Array.isArray(value.reachedMilestones)
      ? value.reachedMilestones.map(Number)
      : [];
    var availableRewards = Array.isArray(value.availableRewards)
      ? value.availableRewards.map(normalizeRewardTicket)
      : [];
    var normalized = {
      settingVersion: String(value.settingVersion || "").trim(),
      targetPoints: Number(value.targetPoints),
      expiryMode: String(value.expiryMode || "").trim(),
      expiresOn: String(value.expiresOn || "").trim(),
      rewardMilestones: rewardMilestones,
      rewardRules: rewardRules,
      reachedMilestones: reachedMilestones,
      currentPoints: Number(value.currentPoints),
      nextMilestonePoints: Number(value.nextMilestonePoints),
      pointsRemaining: Number(value.pointsRemaining),
      pointsToCardComplete: Number(value.pointsToCardComplete),
      currentCardNumber: Number(value.currentCardNumber),
      currentRound: Number(value.currentRound),
      completedCards: Number(value.completedCards),
      completedRounds: Number(value.completedRounds),
      earnedRewards: Number(value.earnedRewards),
      drawsUsed: Number(value.drawsUsed),
      availableDraws: Number(value.availableDraws),
      availableRewards: availableRewards,
      totalPoints: Number(value.totalPoints),
    };
    if (
      !/^PCS-[A-Z0-9]{12}$/.test(normalized.settingVersion) ||
      !Number.isInteger(normalized.targetPoints) ||
      normalized.targetPoints < 1 ||
      (normalized.expiryMode !== "unlimited" &&
        normalized.expiryMode !== "limited") ||
      (normalized.expiryMode === "unlimited" && normalized.expiresOn) ||
      (normalized.expiryMode === "limited" &&
        !isValidPointCardDate(normalized.expiresOn)) ||
      !isStrictPointSequence(normalized.rewardMilestones, normalized.targetPoints) ||
      normalized.rewardRules.length !== normalized.rewardMilestones.length ||
      normalized.rewardRules.some(function (rule, index) {
        return (
          rule.points !== normalized.rewardMilestones[index] ||
          !findLotteryType(rule.lotteryTypeId)
        );
      }) ||
      !isStrictPointSequence(normalized.reachedMilestones, normalized.currentPoints, true) ||
      normalized.reachedMilestones.some(function (milestone) {
        return normalized.rewardMilestones.indexOf(milestone) === -1;
      }) ||
      !pointSequencesEqual(
        normalized.reachedMilestones,
        normalized.rewardMilestones.filter(function (milestone) {
          return milestone <= normalized.currentPoints;
        })
      ) ||
      !Number.isInteger(normalized.currentPoints) ||
      normalized.currentPoints < 0 ||
      normalized.currentPoints >= normalized.targetPoints ||
      normalized.nextMilestonePoints !==
        normalized.rewardMilestones.find(function (milestone) {
          return milestone > normalized.currentPoints;
        }) ||
      normalized.pointsRemaining !==
        normalized.nextMilestonePoints - normalized.currentPoints ||
      normalized.pointsToCardComplete !==
        normalized.targetPoints - normalized.currentPoints ||
      !Number.isInteger(normalized.currentCardNumber) ||
      normalized.currentCardNumber < 1 ||
      !Number.isInteger(normalized.currentRound) ||
      normalized.currentRound !== normalized.currentCardNumber ||
      !Number.isInteger(normalized.completedCards) ||
      normalized.completedCards < 0 ||
      !Number.isInteger(normalized.completedRounds) ||
      normalized.completedRounds !== normalized.completedCards ||
      !Number.isInteger(normalized.earnedRewards) ||
      normalized.earnedRewards < 0 ||
      !Number.isInteger(normalized.drawsUsed) ||
      normalized.drawsUsed < 0 ||
      normalized.drawsUsed > normalized.earnedRewards ||
      !Number.isInteger(normalized.availableDraws) ||
      normalized.availableDraws < 0 ||
      normalized.availableDraws >
        normalized.earnedRewards - normalized.drawsUsed ||
      normalized.availableRewards.length !==
        Math.min(normalized.availableDraws, 50) ||
      !hasUniqueRewardTickets(normalized.availableRewards) ||
      normalized.availableRewards.some(function (ticket) {
        return !findLotteryType(ticket.lotteryTypeId);
      }) ||
      !Number.isSafeInteger(normalized.totalPoints) ||
      normalized.totalPoints < 0
    ) {
      throw createError("INVALID_RESPONSE", "集點卡進度格式不正確。");
    }
    return normalized;
  }

  function isValidPointCardDate(value) {
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

  function normalizeRewardTicket(value) {
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
      !/^LTY-[A-Z0-9]{10}$/.test(ticket.lotteryTypeId) ||
      ticket.cardRoundKey !==
        ticket.settingVersion +
          ":" +
          ticket.cardNumber +
          ":" +
          ticket.milestonePoints
    ) {
      throw createError("INVALID_RESPONSE", "抽獎券資料格式不正確。");
    }
    return ticket;
  }

  function hasUniqueRewardTickets(tickets) {
    var keys = Object.create(null);
    return tickets.every(function (ticket) {
      if (keys[ticket.cardRoundKey]) return false;
      keys[ticket.cardRoundKey] = true;
      return true;
    });
  }

  function findLotteryType(lotteryTypeId) {
    return lotteryTypes.find(function (type) {
      return type.lotteryTypeId === lotteryTypeId;
    }) || null;
  }

  function isStrictPointSequence(values, maximum, allowEmpty) {
    if (!Array.isArray(values) || (!allowEmpty && values.length < 1)) return false;
    var previous = 0;
    for (var i = 0; i < values.length; i += 1) {
      if (
        !Number.isInteger(values[i]) ||
        values[i] <= previous ||
        values[i] > maximum
      ) {
        return false;
      }
      previous = values[i];
    }
    return allowEmpty || values[values.length - 1] === maximum;
  }

  function pointSequencesEqual(left, right) {
    return (
      left.length === right.length &&
      left.every(function (value, index) {
        return value === right[index];
      })
    );
  }

  function renderPointCard() {
    byId("lottery-total-points").textContent = formatNumber(cardStatus.totalPoints);
    byId("point-card-round").textContent = formatNumber(
      cardStatus.currentCardNumber
    );
    byId("point-card-current").textContent = formatNumber(cardStatus.currentPoints);
    byId("point-card-target").textContent = formatNumber(cardStatus.targetPoints);
    byId("point-card-expiry").textContent =
      cardStatus.expiryMode === "limited"
        ? "有效至 " + cardStatus.expiresOn.replace(/-/g, ".")
        : "集點卡無期限";
    byId("available-draw-count").textContent = formatNumber(cardStatus.availableDraws);
    var progress = Math.min(
      100,
      Math.max(0, (cardStatus.currentPoints / cardStatus.targetPoints) * 100)
    );
    byId("point-card-progress-bar").style.width = progress + "%";
    var track = byId("point-card-progress-bar").parentElement;
    track.setAttribute("aria-valuemax", String(cardStatus.targetPoints));
    track.setAttribute("aria-valuenow", String(cardStatus.currentPoints));
    renderPointCardMilestones();
    byId("point-card-progress-message").textContent =
      cardStatus.availableDraws > 0
        ? "已有 " + cardStatus.availableDraws + " 張節點抽獎券可使用。"
        : "再獲得 " +
          cardStatus.pointsRemaining +
          " 點，到 " +
          cardStatus.nextMilestonePoints +
          " 點可獲得抽獎券。";
  }

  function renderPointCardMilestones() {
    var list = byId("point-card-milestones");
    var fragment = document.createDocumentFragment();
    list.classList.toggle(
      "is-dense",
      cardStatus.rewardMilestones.length > 8
    );
    cardStatus.rewardMilestones.forEach(function (milestone) {
      var item = document.createElement("li");
      var reached = cardStatus.reachedMilestones.indexOf(milestone) !== -1;
      var next = milestone === cardStatus.nextMilestonePoints;
      item.className = reached ? "is-reached" : next ? "is-next" : "";
      item.style.left = (milestone / cardStatus.targetPoints) * 100 + "%";
      item.innerHTML =
        "<span aria-hidden=\"true\">" +
        (reached ? "✓" : "★") +
        "</span><small>" +
        formatNumber(milestone) +
        " 點</small>";
      item.setAttribute(
        "aria-label",
        milestone +
          " 點抽獎節點，" +
          (reached ? "本張卡已到達" : next ? "下一個節點" : "尚未到達")
      );
      fragment.appendChild(item);
    });
    list.replaceChildren(fragment);
  }

  function renderLotteryTickets() {
    var container = byId("lottery-ticket-list");
    var empty = byId("lottery-ticket-empty");
    var lockedContainer = byId("locked-ticket-list");
    var lockedEmpty = byId("locked-ticket-empty");
    var earnedFragment = document.createDocumentFragment();
    var lockedFragment = document.createDocumentFragment();
    empty.hidden = cardStatus.availableRewards.length > 0;
    byId("earned-ticket-count").textContent = formatNumber(
      cardStatus.availableDraws
    );
    cardStatus.availableRewards.forEach(function (ticket, index) {
      var type = findLotteryType(ticket.lotteryTypeId);
      if (!type) return;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "lottery-ticket-button";
      button.dataset.cardRoundKey = ticket.cardRoundKey;
      appendTicketText(
        button,
        "lottery-ticket-number",
        "可用抽獎券 " + String(index + 1).padStart(2, "0")
      );
      appendTicketText(button, "lottery-ticket-name", type.name);
      appendTicketText(
        button,
        "lottery-ticket-meta",
        "第 " +
          formatNumber(ticket.cardNumber) +
          " 張卡 · " +
          formatNumber(ticket.milestonePoints) +
          " 點節點"
      );
      appendTicketText(button, "lottery-ticket-action", "開啟轉盤 →");
      button.setAttribute(
        "aria-label",
        type.name +
          "，第 " +
          ticket.cardNumber +
          " 張卡 " +
          ticket.milestonePoints +
          " 點節點，開啟轉盤"
      );
      button.addEventListener("click", function () {
        if (isBusy || isWheelPreparing || pendingRequest) return;
        openLotteryTicket(ticket);
      });
      earnedFragment.appendChild(button);
    });

    var lockedRules = cardStatus.rewardRules.filter(function (rule) {
      return rule.points > cardStatus.currentPoints;
    });
    byId("locked-ticket-count").textContent = formatNumber(lockedRules.length);
    lockedEmpty.hidden = lockedRules.length > 0;
    lockedRules.forEach(function (rule) {
      var type = findLotteryType(rule.lotteryTypeId);
      if (!type) return;
      var item = document.createElement("article");
      item.className = "lottery-locked-ticket";
      appendTicketText(
        item,
        "lottery-ticket-number",
        "尚差 " +
          formatNumber(rule.points - cardStatus.currentPoints) +
          " 點"
      );
      appendTicketText(item, "lottery-ticket-name", type.name);
      appendTicketText(
        item,
        "lottery-ticket-meta",
        "本張卡達到 " + formatNumber(rule.points) + " 點後獲得"
      );
      appendTicketText(item, "lottery-ticket-action", "未獲得");
      lockedFragment.appendChild(item);
    });
    container.replaceChildren(earnedFragment);
    lockedContainer.replaceChildren(lockedFragment);
    selectTicketTab(
      activeTicketTab ||
        (cardStatus.availableRewards.length > 0 ? "earned" : "locked"),
      false
    );
  }

  function selectTicketTab(tabName, shouldFocus) {
    var selectedName = tabName === "locked" ? "locked" : "earned";
    activeTicketTab = selectedName;
    ["locked", "earned"].forEach(function (name) {
      var selected = name === selectedName;
      var tab = byId(name + "-ticket-tab");
      byId(name + "-ticket-panel").hidden = !selected;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && shouldFocus) tab.focus();
    });
  }

  function handleTicketTabKeydown(event) {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    var nextTab =
      event.key === "ArrowLeft" || event.key === "Home" ? "locked" : "earned";
    selectTicketTab(nextTab, true);
  }

  function appendTicketText(parent, className, value) {
    var element = document.createElement("span");
    element.className = className;
    element.textContent = value;
    parent.appendChild(element);
  }

  function getSelectedLotteryType() {
    return findLotteryType(selectedLotteryTypeId);
  }

  function openLotteryTicket(ticket) {
    var normalizedTicket = normalizeRewardTicket(ticket);
    selectedRewardTicket = normalizedTicket;
    selectedLotteryTypeId = selectedRewardTicket.lotteryTypeId;
    isWheelPreparing = true;
    byId("lottery-spin-status").textContent = "轉盤資料載入中…";
    updateControls();
    try {
      renderSelectedLottery();
      showLotteryWheelView();
      byId("lottery-spin-status").textContent =
        "轉盤已就緒，點選中央開始抽獎。";
    } catch (error) {
      selectedRewardTicket = null;
      selectedLotteryTypeId = "";
      showLotteryTicketView();
      showToast(normalizeError(error).message, "error");
    } finally {
      isWheelPreparing = false;
      updateControls();
    }
  }

  function renderSelectedLottery() {
    var selected = getSelectedLotteryType();
    if (!selected || !selectedRewardTicket) return;
    byId("selected-lottery-name").textContent = selected.name;
    byId("selected-ticket-detail").textContent =
      "第 " +
      formatNumber(selectedRewardTicket.cardNumber) +
      " 張集點卡 · " +
      formatNumber(selectedRewardTicket.milestonePoints) +
      " 點節點抽獎券";
    drawWheel(selected.lottery.prizes, selected.lotteryTypeId);
    resetRotor();
  }

  function showLotteryTicketView() {
    byId("lottery-ticket-view").hidden = false;
    byId("lottery-wheel-view").hidden = true;
    byId("lottery-spin-status").textContent = "";
  }

  function showLotteryWheelView() {
    byId("lottery-ticket-view").hidden = true;
    byId("lottery-wheel-view").hidden = false;
    window.requestAnimationFrame(function () {
      try {
        byId("lottery-spin-button").focus({ preventScroll: true });
      } catch (_error) {
        byId("lottery-spin-button").focus();
      }
    });
  }

  function closeLotteryWheelView() {
    if (isBusy || isWheelPreparing || pendingRequest) return;
    selectedRewardTicket = null;
    selectedLotteryTypeId = "";
    navigateToMemberPanel("tickets");
  }

  function preloadLotteryWheels() {
    wheelRenderCache = Object.create(null);
    var typeIds = cardStatus.availableRewards
      .map(function (ticket) {
        return ticket.lotteryTypeId;
      })
      .concat(selectedLotteryTypeId ? [selectedLotteryTypeId] : [])
      .filter(function (typeId, index, values) {
        return values.indexOf(typeId) === index;
      })
      .slice(0, WHEEL_PRELOAD_LIMIT);

    typeIds.forEach(function (typeId) {
      var type = findLotteryType(typeId);
      if (!type) return;
      var canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = 720;
      if (window.LotteryWheel.draw(canvas, type.lottery.prizes)) {
        wheelRenderCache[type.lotteryTypeId] = canvas;
      }
    });
  }

  function drawWheel(prizes, lotteryTypeId) {
    var canvas = byId("member-lottery-wheel");
    if (!canvas || typeof canvas.getContext !== "function") return;
    var context = canvas.getContext("2d");
    if (!context) return;
    var cached = wheelRenderCache[lotteryTypeId];
    if (cached) {
      canvas.width = 720;
      canvas.height = 720;
      context.clearRect(0, 0, 720, 720);
      context.drawImage(cached, 0, 0);
      return;
    }
    window.LotteryWheel.draw(canvas, prizes);
  }

  function handleDraw() {
    if (
      isBusy ||
      !cardStatus ||
      !selectedRewardTicket ||
      (!pendingRequest && cardStatus.availableDraws < 1)
    ) {
      return;
    }
    var selected = getSelectedLotteryType();
    if (!selected) return;
    isBusy = true;
    pendingRequest = ensurePendingRequest(selectedRewardTicket);
    startWaitingSpin();
    updateControls();
    byId("lottery-spin-status").textContent =
      "轉盤已開始，正在安全確認抽獎結果…";

    if (isDemoSession) {
      var previewPrize = selected.lottery.prizes[1] || selected.lottery.prizes[0];
      window.setTimeout(function () {
        finishDraw({
          lotteryType: selected,
          lottery: selected.lottery,
          draw: {
            drawId: "LDW-PREVIEW000000001",
            configVersion: selected.lottery.configVersion,
            prizeId: previewPrize.prizeId,
            prizeLabel: previewPrize.label,
            prizeColor: previewPrize.color,
            lotteryTypeId: selected.lotteryTypeId,
            ticketCost: 0,
            pointsSpent: 0,
            originalPointBalance: cardStatus.totalPoints,
            pointBalance: cardStatus.totalPoints,
            cardRoundKey: selectedRewardTicket.cardRoundKey,
            drawnAt: new Date().toISOString(),
          },
          card: {
            settingVersion: cardStatus.settingVersion,
            targetPoints: cardStatus.targetPoints,
            expiryMode: cardStatus.expiryMode,
            expiresOn: cardStatus.expiresOn,
            rewardMilestones: cardStatus.rewardMilestones.slice(),
            rewardRules: cardStatus.rewardRules.slice(),
            reachedMilestones: cardStatus.reachedMilestones.slice(),
            currentPoints: cardStatus.currentPoints,
            nextMilestonePoints: cardStatus.nextMilestonePoints,
            pointsRemaining: cardStatus.pointsRemaining,
            pointsToCardComplete: cardStatus.pointsToCardComplete,
            currentCardNumber: cardStatus.currentCardNumber,
            currentRound: cardStatus.currentRound,
            completedCards: cardStatus.completedCards,
            completedRounds: cardStatus.completedRounds,
            earnedRewards: cardStatus.earnedRewards,
            drawsUsed: cardStatus.drawsUsed + 1,
            availableDraws: cardStatus.availableDraws - 1,
            availableRewards: cardStatus.availableRewards.filter(function (ticket) {
              return ticket.cardRoundKey !== selectedRewardTicket.cardRoundKey;
            }),
            totalPoints: cardStatus.totalPoints,
          },
          totalPoints: cardStatus.totalPoints,
        });
      }, 450);
      return;
    }

    sendMemberRequest(
      "drawLottery",
      {
        lotteryTypeId: selected.lotteryTypeId,
        cardRoundKey: selectedRewardTicket.cardRoundKey,
      },
      pendingRequest.requestId
    )
      .then(function (response) {
        assertSuccessfulResponse(response);
        if (
          !response.data ||
          !response.data.draw ||
          !response.data.lottery ||
          !response.data.lotteryType ||
          !response.data.card
        ) {
          throw createError("INVALID_RESPONSE", "後台回傳的抽獎結果格式不完整。");
        }
        finishDraw(response.data);
      })
      .catch(function (error) {
        isBusy = false;
        stopSpinAnimation();
        updateControls();
        byId("lottery-spin-status").textContent =
          "尚未確認結果；請再點一次轉盤中央安全重試，不會重複使用抽獎券。";
        if (isAuthorizationError(error)) handleFatalError(error);
        else showToast(normalizeError(error).message, "error");
      });
  }

  function normalizeDraw(value, selectedType) {
    value = value && typeof value === "object" ? value : {};
    var draw = {
      drawId: String(value.drawId || "").trim(),
      configVersion: String(value.configVersion || "").trim(),
      prizeId: String(value.prizeId || "").trim(),
      prizeLabel: String(value.prizeLabel || "").trim(),
      prizeColor: String(value.prizeColor || "").trim().toUpperCase(),
      lotteryTypeId: String(value.lotteryTypeId || "").trim(),
      pointsSpent: Number(value.pointsSpent == null ? value.ticketCost : value.pointsSpent),
      originalPointBalance: Number(value.originalPointBalance),
      pointBalance: Number(value.pointBalance),
      cardRoundKey: String(value.cardRoundKey || "").trim(),
      drawnAt: String(value.drawnAt || "").trim(),
    };
    var prize = selectedType.lottery.prizes.find(function (item) {
      return item.prizeId === draw.prizeId;
    });
    if (
      !/^LDW-[A-Z0-9]{16}$/.test(draw.drawId) ||
      draw.configVersion !== selectedType.lottery.configVersion ||
      draw.lotteryTypeId !== selectedType.lotteryTypeId ||
      !prize ||
      prize.label !== draw.prizeLabel ||
      prize.color !== draw.prizeColor ||
      draw.pointsSpent !== 0 ||
      !Number.isSafeInteger(draw.originalPointBalance) ||
      draw.pointBalance !== draw.originalPointBalance ||
      !/^PCS-[A-Z0-9]{12}:[1-9]\d*(?::[1-9]\d*)?$/.test(draw.cardRoundKey) ||
      Number.isNaN(new Date(draw.drawnAt).getTime())
    ) {
      throw createError("INVALID_RESPONSE", "後台回傳的抽獎結果格式不正確。");
    }
    return draw;
  }

  function finishDraw(data) {
    var selectedType;
    var resultLottery;
    var nextCard;
    var draw;
    try {
      var normalizedTypes = normalizeLotteryTypes([data.lotteryType]);
      selectedType = normalizedTypes[0];
      if (selectedType.lotteryTypeId !== selectedLotteryTypeId) {
        throw createError("INVALID_RESPONSE", "抽獎結果與選擇的轉盤類型不一致。");
      }
      resultLottery = normalizeLotteryConfig(
        data.lottery,
        selectedType.lotteryTypeId
      );
      if (
        JSON.stringify(resultLottery) !==
        JSON.stringify(selectedType.lottery)
      ) {
        throw createError("INVALID_RESPONSE", "抽獎結果使用了不一致的轉盤設定。");
      }
      nextCard = normalizePointCardStatus(data.card);
      draw = normalizeDraw(data.draw, selectedType);
      if (
        !selectedRewardTicket ||
        draw.cardRoundKey !== selectedRewardTicket.cardRoundKey
      ) {
        throw createError("INVALID_RESPONSE", "抽獎結果與選擇的抽獎券不一致。");
      }
      if (
        normalizePointNumber(
          data.totalPoints == null ? data.pointBalance : data.totalPoints
        ) !== draw.pointBalance ||
        nextCard.totalPoints !== draw.pointBalance
      ) {
        throw createError("INVALID_RESPONSE", "抽獎前後累計點數不一致。");
      }
    } catch (error) {
      isBusy = false;
      stopSpinAnimation();
      updateControls();
      showToast(normalizeError(error).message, "error");
      return;
    }

    var existingIndex = lotteryTypes.findIndex(function (type) {
      return type.lotteryTypeId === selectedType.lotteryTypeId;
    });
    if (existingIndex >= 0) lotteryTypes[existingIndex] = selectedType;
    cardStatus = nextCard;
    animateToPrize(draw, selectedType.lottery).then(function () {
      byId("lottery-result-swatch").style.backgroundColor = draw.prizeColor;
      byId("lottery-result-title").textContent = draw.prizeLabel;
      byId("lottery-result-type").textContent = selectedType.name + " · 本次抽中";
      byId("lottery-result-before").textContent = formatNumber(
        draw.originalPointBalance
      );
      byId("lottery-result-balance").textContent = formatNumber(draw.pointBalance);
      clearPendingRequest();
      isBusy = false;
      renderPointCard();
      renderLotteryTickets();
      updateControls();
      byId("lottery-spin-status").textContent = "";
      openResultDialog();
    });
  }

  function animateToPrize(draw, lottery) {
    stopSpinAnimation();
    var animationVersion = spinAnimationVersion;
    var prizeIndex = lottery.prizes.findIndex(function (prize) {
      return prize.prizeId === draw.prizeId;
    });
    var sectorDegrees = 360 / lottery.prizes.length;
    var desiredRotation = -(prizeIndex + 0.5) * sectorDegrees;
    var currentModulo = ((lotteryRotation % 360) + 360) % 360;
    var desiredModulo = ((desiredRotation % 360) + 360) % 360;
    var alignment = (desiredModulo - currentModulo + 360) % 360;
    var startRotation = lotteryRotation;
    var rotationDelta = 360 * FINAL_SPIN_TURNS + alignment;
    var targetRotation = startRotation + rotationDelta;
    var rotor = byId("member-lottery-rotor");
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    byId("lottery-spin-status").textContent = "轉盤旋轉中，請稍候結果…";
    if (reducedMotion) {
      lotteryRotation = targetRotation;
      rotor.style.transform = "rotate(" + lotteryRotation + "deg)";
      return new Promise(function (resolve) {
        window.setTimeout(function () {
          if (animationVersion === spinAnimationVersion) resolve();
        }, 30);
      });
    }

    // Keep the first-frame velocity equal to the waiting spin. Adding the
    // smoothstep correction also keeps acceleration continuous at both ends,
    // so the wheel eases from fast to slow without an abrupt speed change.
    var duration = (2 * rotationDelta) / SPIN_DEGREES_PER_MS;
    return new Promise(function (resolve) {
      var animationStartedAt =
        window.performance && typeof window.performance.now === "function"
          ? window.performance.now()
          : null;
      function decelerate(timestamp) {
        if (animationVersion !== spinAnimationVersion) return;
        if (animationStartedAt === null) animationStartedAt = timestamp;
        var progress = Math.min(1, (timestamp - animationStartedAt) / duration);
        var quadraticEaseOut = 1 - Math.pow(1 - progress, 2);
        var smoothstepCorrection = Math.pow(progress * (1 - progress), 2);
        var easedProgress = quadraticEaseOut + smoothstepCorrection;
        lotteryRotation = startRotation + rotationDelta * easedProgress;
        rotor.style.transform = "rotate(" + lotteryRotation + "deg)";
        if (progress < 1) {
          settlingSpinFrame = window.requestAnimationFrame(decelerate);
          return;
        }
        settlingSpinFrame = 0;
        lotteryRotation = targetRotation;
        rotor.style.transform = "rotate(" + lotteryRotation + "deg)";
        resolve();
      }
      settlingSpinFrame = window.requestAnimationFrame(decelerate);
    });
  }

  function resetRotor() {
    stopSpinAnimation();
    lotteryRotation = 0;
    var rotor = byId("member-lottery-rotor");
    rotor.style.transform = "rotate(0deg)";
  }

  function startWaitingSpin() {
    stopSpinAnimation();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var rotor = byId("member-lottery-rotor");
    waitingSpinLastTime = 0;
    function rotate(timestamp) {
      if (!isBusy) {
        stopSpinAnimation();
        return;
      }
      if (waitingSpinLastTime) {
        lotteryRotation +=
          Math.min(100, timestamp - waitingSpinLastTime) * SPIN_DEGREES_PER_MS;
        rotor.style.transform = "rotate(" + lotteryRotation + "deg)";
      }
      waitingSpinLastTime = timestamp;
      waitingSpinFrame = window.requestAnimationFrame(rotate);
    }
    waitingSpinFrame = window.requestAnimationFrame(rotate);
  }

  function stopSpinAnimation() {
    if (waitingSpinFrame) {
      window.cancelAnimationFrame(waitingSpinFrame);
      waitingSpinFrame = 0;
    }
    if (settlingSpinFrame) {
      window.cancelAnimationFrame(settlingSpinFrame);
      settlingSpinFrame = 0;
    }
    waitingSpinLastTime = 0;
    spinAnimationVersion += 1;
  }

  function updateControls() {
    var canDraw =
      !isBusy &&
      !isWheelPreparing &&
      cardStatus &&
      selectedRewardTicket &&
      (cardStatus.availableDraws > 0 || Boolean(pendingRequest)) &&
      Boolean(getSelectedLotteryType());
    var button = byId("lottery-spin-button");
    button.disabled = !canDraw;
    button.setAttribute("aria-busy", String(isBusy));
    button.dataset.state =
      isBusy ? "busy" : isWheelPreparing ? "loading" : canDraw ? "ready" : "disabled";
    var label = button.querySelector("span");
    label.textContent = isBusy
      ? "抽獎中"
      : isWheelPreparing
        ? "載入轉盤"
      : selectedRewardTicket
        ? pendingRequest
          ? "點我重試"
          : "點我抽獎"
        : "選擇抽獎券";
    var wheelBackDisabled =
      isBusy || isWheelPreparing || Boolean(pendingRequest);
    byId("lottery-wheel-back-button").disabled = wheelBackDisabled;
    byId("lottery-wheel-back-button").setAttribute(
      "aria-disabled",
      String(wheelBackDisabled)
    );
    setMemberRoutesLocked(isBusy);
    document.querySelectorAll(".lottery-ticket-button").forEach(function (ticket) {
      ticket.disabled =
        isBusy ||
        isWheelPreparing ||
        Boolean(pendingRequest);
    });
  }

  function setMemberRoutesLocked(locked) {
    document.querySelectorAll("[data-member-route]").forEach(function (link) {
      if (locked) {
        if (!link.hasAttribute("data-unlocked-tabindex")) {
          link.setAttribute(
            "data-unlocked-tabindex",
            link.hasAttribute("tabindex")
              ? String(link.getAttribute("tabindex"))
              : "none"
          );
        }
        link.setAttribute("aria-disabled", "true");
        link.setAttribute("tabindex", "-1");
        return;
      }

      var originalTabIndex = link.getAttribute("data-unlocked-tabindex");
      link.removeAttribute("aria-disabled");
      link.removeAttribute("data-unlocked-tabindex");
      if (originalTabIndex === "none" || originalTabIndex === null) {
        link.removeAttribute("tabindex");
      } else {
        link.setAttribute("tabindex", originalTabIndex);
      }
    });
  }

  function preventMemberRouteDuringSpin(event) {
    var link =
      event.target && typeof event.target.closest === "function"
        ? event.target.closest("[data-member-route]")
        : null;
    if (!link || !isBusy) return;
    event.preventDefault();
    event.stopPropagation();
    showToast("轉盤正在開獎，結果顯示後即可離開。", "error");
  }

  function preventPageExitDuringSpin(event) {
    if (!isBusy) return;
    event.preventDefault();
    event.returnValue = "";
  }

  function ensurePendingRequest(ticket) {
    var stored = readPendingRequest();
    if (stored) {
      if (
        stored.lotteryTypeId !== ticket.lotteryTypeId ||
        stored.cardRoundKey !== ticket.cardRoundKey
      ) {
        throw createError("REQUEST_ID_CONFLICT", "請先完成上一次轉盤結果確認。");
      }
      return stored;
    }
    var request = {
      requestId: window.MemberApi.createRequestId(),
      settingVersion: ticket.settingVersion,
      cardNumber: ticket.cardNumber,
      milestonePoints: ticket.milestonePoints,
      lotteryTypeId: ticket.lotteryTypeId,
      cardRoundKey: ticket.cardRoundKey,
    };
    pendingRequest = request;
    try {
      window.sessionStorage.setItem(
        getRequestStorageKey(),
        JSON.stringify(request)
      );
    } catch (_error) {
      // The in-memory value still protects retries in this page session.
    }
    return request;
  }

  function readPendingRequest() {
    if (pendingRequest) return pendingRequest;
    try {
      var parsed = JSON.parse(
        window.sessionStorage.getItem(getRequestStorageKey()) || "null"
      );
      if (
        parsed &&
        /^[a-zA-Z0-9-]{10,80}$/.test(parsed.requestId) &&
        isValidPendingTicket(parsed)
      ) {
        pendingRequest = parsed;
        return pendingRequest;
      }
    } catch (_error) {
      // Invalid or unavailable storage is treated as empty.
    }
    return null;
  }

  function isValidPendingTicket(value) {
    try {
      normalizeRewardTicket(value);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function isRestorablePendingTicket(value) {
    return (
      isValidPendingTicket(value) &&
      Boolean(findLotteryType(value.lotteryTypeId))
    );
  }

  function pendingTicketResponse(value) {
    return normalizeRewardTicket(value);
  }

  function clearPendingRequest() {
    pendingRequest = null;
    try {
      window.sessionStorage.removeItem(getRequestStorageKey());
    } catch (_error) {
      // sessionStorage may be unavailable.
    }
  }

  function getRequestStorageKey() {
    return REQUEST_STORAGE_PREFIX + String(CONFIG.LIFF_ID || "unknown");
  }

  function openResultDialog() {
    var dialog = byId("lottery-result-dialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    byId("lottery-result-confirm-button").focus();
  }

  function returnToPointCard() {
    var dialog = byId("lottery-result-dialog");
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
    navigateToMemberPanel("tickets");
  }

  function navigateToMemberPanel(panel) {
    if (isBusy) return;
    var url = new URL("./", window.location.href);
    if (panel === "tickets" || panel === "history") {
      url.searchParams.set("panel", panel);
    }
    if (isDemoSession || hasDemoQuery()) url.searchParams.set("demo", "1");
    window.location.assign(url.toString());
  }

  function handleLogin() {
    if (!window.liff) return;
    if (window.liff.isLoggedIn()) {
      boot();
      return;
    }
    window.liff.login({ redirectUri: getCleanPageUrl() });
  }

  function handleFatalError(errorValue) {
    var normalized = normalizeError(errorValue);
    if (recoverInvalidToken(normalized)) return;
    byId("error-code").textContent = normalized.code.replace(/_/g, " ");
    byId("error-message").textContent = normalized.message;
    setView("error-state");
  }

  function recoverInvalidToken(error) {
    if (
      error.code !== "INVALID_TOKEN" &&
      error.code !== "INVALID_ID_TOKEN"
    ) {
      return false;
    }
    if (
      !window.liff ||
      (typeof window.liff.isInClient === "function" && window.liff.isInClient())
    ) {
      return false;
    }
    var key =
      INVALID_TOKEN_RECOVERY_PREFIX + String(CONFIG.LIFF_ID || "unknown");
    try {
      if (window.sessionStorage.getItem(key) === "1") return false;
      window.sessionStorage.setItem(key, "1");
    } catch (_error) {
      return false;
    }
    currentIdToken = "";
    setView("loading-state");
    setLoading("正在更新 LINE 登入", "偵測到舊憑證，正在重新登入抽獎頁。");
    try {
      if (window.liff.isLoggedIn()) window.liff.logout();
      window.liff.login({ redirectUri: getCleanPageUrl() });
      return true;
    } catch (_error) {
      return false;
    }
  }

  function clearInvalidTokenRecoveryGuard() {
    try {
      window.sessionStorage.removeItem(
        INVALID_TOKEN_RECOVERY_PREFIX + String(CONFIG.LIFF_ID || "unknown")
      );
    } catch (_error) {
      // sessionStorage may be unavailable.
    }
  }

  function assertSuccessfulResponse(response) {
    if (!response || response.ok !== true) {
      throw createError(
        response && response.code ? response.code : "BACKEND_ERROR",
        response && response.message ? response.message : "後台目前無法回應。"
      );
    }
  }

  function normalizeError(errorValue) {
    var code =
      errorValue && (errorValue.code || errorValue.name)
        ? String(errorValue.code || errorValue.name)
        : "CONNECTION_ERROR";
    var messages = {
      INVALID_TOKEN: "LINE 登入憑證無效或已過期，請重新登入。",
      INVALID_ID_TOKEN: "LINE 登入憑證已失效，請重新登入。",
      MISSING_ID_TOKEN: "沒有取得 LINE 登入憑證，請確認 LIFF openid 權限。",
      MEMBER_NOT_FOUND: "請先返回會員資料頁完成會員登入。",
      MEMBER_ACCESS_DENIED: "目前會員帳號已停用，無法使用抽獎功能。",
      LOTTERY_NOT_CONFIGURED: "管理員尚未完成轉盤設定。",
      LOTTERY_TYPE_NOT_FOUND: "選擇的轉盤類型已停用，請重新整理。",
      LOTTERY_ROUND_NOT_READY: "尚未到達新的抽獎節點，或現有資格已使用。",
      INVALID_LOTTERY_TICKET: "這張抽獎券格式不正確，請重新整理。",
      LOTTERY_TICKET_MISMATCH: "這張抽獎券只能使用管理員指定的轉盤。",
      POINT_CARD_NOT_CONFIGURED: "管理員尚未設定集點卡規則。",
      POINT_CARD_DATA_ERROR: "集點卡資料目前無法使用，請聯絡管理員。",
      LOTTERY_DATA_ERROR: "抽獎紀錄目前無法使用，請聯絡管理員。",
      REQUEST_ID_CONFLICT: "上一次抽獎仍在確認中，請使用同一轉盤重試。",
      ORIGIN_NOT_ALLOWED: "目前網站來源未被 GAS 允許。",
      LINE_RATE_LIMITED: "LINE 驗證請求較多，請稍候一分鐘再試。",
      LINE_UNAVAILABLE: "LINE 驗證服務暫時無法使用。",
      BUSY: "抽獎資料正在更新，請稍候幾秒再試。",
      CONFIG_ERROR: "會員 GAS 尚未完成集點卡設定。",
    };
    return {
      code: code,
      message:
        messages[code] ||
        (errorValue && errorValue.message) ||
        "連線時發生問題，請稍後再試。",
    };
  }

  function isAuthorizationError(errorValue) {
    var code = String(errorValue && errorValue.code ? errorValue.code : "");
    return (
      code === "INVALID_TOKEN" ||
      code === "INVALID_ID_TOKEN" ||
      code === "MEMBER_ACCESS_DENIED" ||
      code === "MEMBER_NOT_FOUND"
    );
  }

  function getLiffContext() {
    return window.LiffRuntime.getContext(window.liff, window.navigator);
  }

  function hasCompleteConfig() {
    return window.LiffRuntime.hasCompleteConfig(CONFIG, window.MemberApi);
  }

  function applyBrand() {
    var brand = String(CONFIG.BRAND_NAME || "PERSONA").trim().slice(0, 28);
    document.querySelectorAll("[data-brand-name]").forEach(function (element) {
      element.textContent = brand;
    });
    document.title = brand + " MEMBERS｜集點卡抽獎";
    syncMemberRoutes();
  }

  function syncMemberRoutes() {
    var demo = isDemoSession || hasDemoQuery();
    document.querySelectorAll("[data-member-route]").forEach(function (link) {
      var url = new URL(link.getAttribute("href"), window.location.href);
      if (demo) url.searchParams.set("demo", "1");
      else url.searchParams.delete("demo");
      link.href = url.toString();
    });
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

  function normalizePointNumber(value) {
    var number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
      throw createError("INVALID_RESPONSE", "點數格式不正確。");
    }
    return number;
  }

  function formatNumber(value) {
    return normalizePointNumber(value).toLocaleString("zh-TW");
  }

  function captureRequestedCardRoundKey() {
    var pageUrl = new URL(window.location.href);
    var directTicket = pageUrl.searchParams.get("ticket");
    var liffState = pageUrl.searchParams.get("liff.state");
    var stateUrl = null;
    var stateTicket = null;
    var urlChanged = directTicket !== null;

    if (liffState) {
      try {
        stateUrl = new URL(liffState, window.location.origin);
        stateTicket = stateUrl.searchParams.get("ticket");
      } catch (_error) {
        stateUrl = null;
      }
    }

    var incomingTicket =
      directTicket !== null ? directTicket : stateTicket;
    if (incomingTicket !== null) {
      var normalizedTicket = String(incomingTicket || "").trim();
      if (
        /^PCS-[A-Z0-9]{12}:[1-9]\d{0,15}:[1-9]\d{0,3}$/.test(
          normalizedTicket
        )
      ) {
        requestedCardRoundKey = normalizedTicket;
        requestedTicketError = "";
      } else {
        requestedCardRoundKey = "";
        requestedTicketError = "抽獎券連結格式不正確，請返回會員資料重新選擇。";
      }
    }

    pageUrl.searchParams.delete("ticket");
    if (stateUrl && stateTicket !== null) {
      stateUrl.searchParams.delete("ticket");
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

  function clearRequestedTicketFromUrl() {
    var pageUrl = new URL(window.location.href);
    if (!pageUrl.searchParams.has("ticket")) return;
    pageUrl.searchParams.delete("ticket");
    if (window.history && window.history.replaceState) {
      window.history.replaceState(
        window.history.state,
        document.title,
        pageUrl.toString()
      );
    }
  }

  function getCleanPageUrl() {
    var url = new URL(window.location.href);
    url.hash = "";
    if (requestedCardRoundKey) {
      url.searchParams.set("ticket", requestedCardRoundKey);
    }
    return url.toString();
  }

  function hasDemoQuery() {
    return window.LiffRuntime.hasDemoQuery(window.location.search);
  }

  function createError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function bindInteractions() {
    document.addEventListener("click", preventMemberRouteDuringSpin, true);
    window.addEventListener("beforeunload", preventPageExitDuringSpin);
    byId("login-button").addEventListener("click", handleLogin);
    byId("retry-button").addEventListener("click", boot);
    ["locked", "earned"].forEach(function (name) {
      byId(name + "-ticket-tab").addEventListener("click", function () {
        selectTicketTab(name, false);
      });
      byId(name + "-ticket-tab").addEventListener(
        "keydown",
        handleTicketTabKeydown
      );
    });
    byId("lottery-wheel-back-button").addEventListener(
      "click",
      closeLotteryWheelView
    );
    byId("lottery-spin-button").addEventListener("click", function () {
        try {
          handleDraw();
        } catch (error) {
          isBusy = false;
          stopSpinAnimation();
          updateControls();
        showToast(normalizeError(error).message, "error");
      }
    });
    byId("lottery-result-confirm-button").addEventListener(
      "click",
      returnToPointCard
    );
    byId("lottery-result-dialog").addEventListener("cancel", function (event) {
      event.preventDefault();
    });
  }

  byId("current-year").textContent = String(new Date().getFullYear());
  bindInteractions();
  start();
})();
