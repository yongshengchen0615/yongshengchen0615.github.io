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
  var isBusy = false;
  var isDemoSession = false;
  var pendingRequest = null;
  var toastTimer = null;
  var bootVersion = 0;
  var wheelRenderCache = Object.create(null);
  var isWheelPreparing = false;
  var isPointScannerBusy = false;
  var pointScannerStream = null;
  var pointScannerTimer = 0;
  var pointScannerResolve = null;
  var pointScannerReject = null;
  var pointScannerDetecting = false;
  var pendingPointClaim = "";
  var pendingPointClaimRequestId = "";
  var isPointClaimBusy = false;
  var STATE_IDS = [
    "loading-state",
    "login-state",
    "setup-state",
    "error-state",
    "lottery-state",
  ];
  var REQUEST_STORAGE_PREFIX = "persona-member-lottery-round-request:";
  var POINT_REDEMPTION_REQUEST_STORAGE_PREFIX =
    "persona-member-point-redemption-request:";
  var INVALID_TOKEN_RECOVERY_PREFIX = "persona-member-lottery-token-recovery:";

  function byId(id) {
    return document.getElementById(id);
  }

  function start() {
    setView("loading-state");
    setLoading("正在讀取集點卡", "確認本張卡進度與目前獲得的抽獎券。");
    return loadConfig()
      .then(function () {
        applyBrand();
        return boot();
      })
      .catch(handleFatalError);
  }

  function loadConfig() {
    if (!window.MemberApi) {
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
    isDemoSession = hasDemoQuery();
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

  function loadLotteryWorkspace(expectedBootVersion) {
    setView("loading-state");
    setLoading("正在讀取集點卡", "確認本張卡進度、抽獎資格與轉盤設定。");
    return sendMemberRequest("getLotteryConfig", {})
      .then(function (response) {
        if (expectedBootVersion !== bootVersion) return;
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
      })
      .catch(function (error) {
        if (expectedBootVersion !== bootVersion) return;
        handleFatalError(error);
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
    preloadLotteryWheels();
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

    renderPointCard();
    renderLotteryTickets();
    setView("lottery-state");
    showLotteryTicketView();
    if (selectedRewardTicket) openLotteryTicket(selectedRewardTicket);
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
      !Number.isInteger(normalized.availableDraws) ||
      normalized.availableDraws < 0 ||
      normalized.availableDraws !== normalized.earnedRewards - normalized.drawsUsed ||
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
    list.textContent = "";
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
      list.appendChild(item);
    });
  }

  function renderLotteryTickets() {
    var container = byId("lottery-ticket-list");
    var empty = byId("lottery-ticket-empty");
    var lockedContainer = byId("locked-ticket-list");
    var lockedEmpty = byId("locked-ticket-empty");
    container.textContent = "";
    lockedContainer.textContent = "";
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
      container.appendChild(button);
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
      lockedContainer.appendChild(item);
    });
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
    window.requestAnimationFrame(function () {
      renderSelectedLottery();
      window.requestAnimationFrame(function () {
        showLotteryWheelView();
        isWheelPreparing = false;
        byId("lottery-spin-status").textContent =
          "轉盤資料已載入，點選中央開始抽獎。";
        updateControls();
      });
    });
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
    showLotteryTicketView();
    updateControls();
  }

  function preloadLotteryWheels() {
    wheelRenderCache = Object.create(null);
    lotteryTypes.forEach(function (type) {
      var canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = 720;
      if (renderWheelCanvas(canvas, type.lottery.prizes)) {
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
    renderWheelCanvas(canvas, prizes);
  }

  function renderWheelCanvas(canvas, prizes) {
    if (!canvas || typeof canvas.getContext !== "function") return false;
    var context = canvas.getContext("2d");
    if (!context) return false;
    var size = 720;
    var center = size / 2;
    var radius = center - 12;
    var sector = (Math.PI * 2) / prizes.length;
    canvas.width = size;
    canvas.height = size;
    context.clearRect(0, 0, size, size);
    prizes.forEach(function (prize, index) {
      var start = -Math.PI / 2 + index * sector;
      context.beginPath();
      context.moveTo(center, center);
      context.arc(center, center, radius, start, start + sector);
      context.closePath();
      context.fillStyle = prize.color;
      context.fill();
      context.strokeStyle = "rgba(243, 240, 231, 0.92)";
      context.lineWidth = 5;
      context.stroke();
      context.save();
      context.translate(center, center);
      context.rotate(start + sector / 2);
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.font = prizes.length > 8 ? "600 22px sans-serif" : "600 28px sans-serif";
      context.fillStyle = lotteryTextColor(prize.color);
      context.fillText(prize.label.slice(0, 10), radius - 44, 0);
      context.restore();
    });
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.strokeStyle = "#0B3C2C";
    context.lineWidth = 10;
    context.stroke();
    return true;
  }

  function lotteryTextColor(color) {
    var match = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(color);
    if (!match) return "#0B3C2C";
    var luminance =
      Number.parseInt(match[1], 16) * 0.299 +
      Number.parseInt(match[2], 16) * 0.587 +
      Number.parseInt(match[3], 16) * 0.114;
    return luminance < 145 ? "#FFFFFF" : "#0B3C2C";
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
        stopWaitingSpin();
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
      stopWaitingSpin();
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
    stopWaitingSpin();
    var prizeIndex = lottery.prizes.findIndex(function (prize) {
      return prize.prizeId === draw.prizeId;
    });
    var sectorDegrees = 360 / lottery.prizes.length;
    var desiredRotation = -(prizeIndex + 0.5) * sectorDegrees;
    var currentModulo = ((lotteryRotation % 360) + 360) % 360;
    var desiredModulo = ((desiredRotation % 360) + 360) % 360;
    var alignment = (desiredModulo - currentModulo + 360) % 360;
    lotteryRotation += 360 * 5 + alignment;
    var rotor = byId("member-lottery-rotor");
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rotor.style.transitionDuration = reducedMotion ? "0.01ms" : "4.2s";
    rotor.style.transform = "rotate(" + lotteryRotation + "deg)";
    byId("lottery-spin-status").textContent = "轉盤旋轉中，請稍候結果…";
    return new Promise(function (resolve) {
      window.setTimeout(resolve, reducedMotion ? 30 : 4300);
    });
  }

  function resetRotor() {
    stopWaitingSpin();
    lotteryRotation = 0;
    var rotor = byId("member-lottery-rotor");
    rotor.style.transitionDuration = "0ms";
    rotor.style.transform = "rotate(0deg)";
    window.requestAnimationFrame(function () {
      rotor.style.transitionDuration = "";
    });
  }

  function startWaitingSpin() {
    stopWaitingSpin();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var rotor = byId("member-lottery-rotor");
    rotor.style.transitionDuration = "0ms";
    waitingSpinLastTime = 0;
    function rotate(timestamp) {
      if (!isBusy) {
        stopWaitingSpin();
        return;
      }
      if (waitingSpinLastTime) {
        lotteryRotation +=
          Math.min(40, timestamp - waitingSpinLastTime) * 0.34;
        rotor.style.transform = "rotate(" + lotteryRotation + "deg)";
      }
      waitingSpinLastTime = timestamp;
      waitingSpinFrame = window.requestAnimationFrame(rotate);
    }
    waitingSpinFrame = window.requestAnimationFrame(rotate);
  }

  function stopWaitingSpin() {
    if (waitingSpinFrame) {
      window.cancelAnimationFrame(waitingSpinFrame);
      waitingSpinFrame = 0;
    }
    waitingSpinLastTime = 0;
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
    byId("lottery-wheel-back-button").disabled =
      isBusy || isWheelPreparing || Boolean(pendingRequest);
    document.querySelectorAll(".lottery-ticket-button").forEach(function (ticket) {
      ticket.disabled =
        isBusy ||
        isWheelPreparing ||
        Boolean(pendingRequest);
    });
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
    selectedRewardTicket = null;
    selectedLotteryTypeId = "";
    showLotteryTicketView();
    updateControls();
    window.requestAnimationFrame(function () {
      byId("scan-point-button").focus({ preventScroll: true });
      window.scrollTo({
        top: byId("lottery-ticket-list").offsetTop - 120,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
  }

  function handleScanPointQr() {
    var button = byId("scan-point-button");
    if (isPointScannerBusy || isPointClaimBusy || !button) return;
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
          throw createError(
            "INVALID_POINT_QR",
            "這不是有效的會員點數 QR Code，請掃描管理員產生的點數 QR。"
          );
        }
        if (claim !== pendingPointClaim) clearPendingPointRedemptionRequest();
        pendingPointClaim = claim;
        return redeemScannedPointClaim();
      })
      .catch(function (error) {
        if (isPointScanCancelled(error)) {
          showToast("已取消掃描");
          return;
        }
        showToast(normalizeError(error).message, "error");
      })
      .finally(function () {
        isPointScannerBusy = false;
        setButtonBusy(button, false);
      });
  }

  function redeemScannedPointClaim() {
    if (isPointClaimBusy || !pendingPointClaim) return Promise.resolve();
    isPointClaimBusy = true;
    setPointClaimState("point-claim-loading-state");
    openDialog(byId("point-claim-dialog"));
    var requestId = ensurePendingPointRedemptionRequest();

    return sendMemberRequest(
      "redeemPointCampaign",
      { claim: pendingPointClaim },
      requestId
    )
      .then(function (response) {
        assertSuccessfulResponse(response);
        if (
          !response.data ||
          !response.data.access ||
          response.data.access.allowed !== true ||
          typeof response.data.duplicate !== "boolean" ||
          typeof response.data.redeemed !== "boolean"
        ) {
          throw createError("INVALID_RESPONSE", "後台回傳的領點結果格式不完整。");
        }
        var pointBalance = normalizePointNumber(response.data.pointBalance);
        var awardedPoints = normalizePointNumber(response.data.awardedPoints);
        var campaign = normalizePointCampaign(response.data.campaign);
        var originalPointBalance = pointBalance - awardedPoints;
        if (originalPointBalance < 0) {
          throw createError("INVALID_RESPONSE", "後台回傳的點數變動資料不一致。");
        }

        if (response.data.duplicate) {
          if (
            response.data.redeemed ||
            awardedPoints !== 0 ||
            ["request_replay", "already_redeemed", "campaign_redeemed"].indexOf(
              response.data.duplicateReason
            ) === -1
          ) {
            throw createError("INVALID_RESPONSE", "後台回傳的重複領取資料不一致。");
          }
          byId("point-claim-symbol").textContent = "✓";
          byId("point-claim-symbol").className = "claim-symbol claim-symbol-muted";
          byId("point-claim-kicker").textContent =
            response.data.duplicateReason === "campaign_redeemed"
              ? "這張 QR 已由其他會員領取"
              : "這張 QR 已領取過";
          byId("point-claim-title").textContent = "沒有重複加點";
          byId("point-claim-note").textContent =
            "會員點數維持不變，集點卡會重新整理最新狀態。";
        } else {
          if (!response.data.redeemed || awardedPoints !== campaign.points) {
            throw createError("INVALID_RESPONSE", "後台未確認這次點數領取。");
          }
          byId("point-claim-symbol").textContent = "+";
          byId("point-claim-symbol").className = "claim-symbol";
          byId("point-claim-kicker").textContent = "點數領取完成";
          byId("point-claim-title").textContent =
            "獲得 " + formatNumber(awardedPoints) + " 點";
          byId("point-claim-note").textContent =
            campaign.redemptionMode === "repeatable"
              ? "如需再次領取，請重新掃描同一張 QR Code。"
              : campaign.redemptionMode === "single_member"
                ? "這張 QR 僅限一位會員領取，完成後即失效。"
                : "這張 QR 對本會員已完成領取。";
          sendPointClaimMessage(
            originalPointBalance,
            awardedPoints,
            pointBalance
          ).catch(function () {
            showToast("點數已加入，但未能傳送官方帳號通知。", "error");
          });
        }

        byId("point-claim-before").textContent = formatNumber(
          originalPointBalance
        );
        byId("point-claim-awarded").textContent = formatNumber(awardedPoints);
        byId("point-claim-balance").textContent = formatNumber(pointBalance);
        pendingPointClaim = "";
        clearPendingPointRedemptionRequest();
        setPointClaimState("point-claim-result-state");
      })
      .catch(function (error) {
        if (isAuthorizationError(error)) {
          closeDialog(byId("point-claim-dialog"));
          handleFatalError(error);
          return;
        }
        var normalized = normalizeError(error);
        byId("point-claim-error-message").textContent = normalized.message;
        setPointClaimState("point-claim-error-state");
      })
      .finally(function () {
        isPointClaimBusy = false;
      });
  }

  function normalizePointCampaign(campaign) {
    campaign = campaign && typeof campaign === "object" ? campaign : {};
    var points = Number(campaign.points);
    var label = String(campaign.label || "").trim();
    var expiryMode = String(campaign.expiryMode || "").trim().toLowerCase();
    var redemptionMode = String(campaign.redemptionMode || "")
      .trim()
      .toLowerCase();
    var expiresAt = String(campaign.expiresAt || "").trim();
    var expiry = expiresAt ? new Date(expiresAt) : null;
    var validExpiry =
      expiryMode === "unlimited"
        ? !expiresAt
        : expiryMode === "limited" &&
          Boolean(expiry) &&
          !Number.isNaN(expiry.getTime());
    if (
      !Number.isInteger(points) ||
      points < 1 ||
      points > 9999 ||
      label !== points + " 點" ||
      !validExpiry ||
      ["once_per_member", "repeatable", "single_member"].indexOf(
        redemptionMode
      ) === -1
    ) {
      throw createError("INVALID_RESPONSE", "後台回傳的點數活動格式不完整。");
    }
    return {
      points: points,
      redemptionMode: redemptionMode,
    };
  }

  function setPointClaimState(activeId) {
    [
      "point-claim-loading-state",
      "point-claim-result-state",
      "point-claim-error-state",
    ].forEach(function (id) {
      byId(id).hidden = id !== activeId;
    });
  }

  function confirmPointClaim() {
    closeDialog(byId("point-claim-dialog"));
    return loadLotteryWorkspace(bootVersion);
  }

  function sendPointClaimMessage(
    originalPointBalance,
    awardedPoints,
    pointBalance
  ) {
    var context = getLiffContext();
    if (
      context.inClient !== true ||
      context.type !== "utou" ||
      !window.liff ||
      typeof window.liff.sendMessages !== "function"
    ) {
      return Promise.resolve({ sent: false });
    }
    var message =
      "會員點數通知\n原本點數：" +
      formatNumber(originalPointBalance) +
      " 點\n獲得點數：+" +
      formatNumber(awardedPoints) +
      " 點\n目前點數：" +
      formatNumber(pointBalance) +
      " 點";
    return window.liff.sendMessages([{ type: "text", text: message }]);
  }

  function ensurePendingPointRedemptionRequest() {
    if (pendingPointClaimRequestId) return pendingPointClaimRequestId;
    try {
      var stored = String(
        window.sessionStorage.getItem(getPointRedemptionRequestStorageKey()) ||
          ""
      );
      if (/^[a-zA-Z0-9-]{10,80}$/.test(stored)) {
        pendingPointClaimRequestId = stored;
        return stored;
      }
    } catch (_error) {
      // The in-memory request ID still protects retries on this page.
    }
    pendingPointClaimRequestId = window.MemberApi.createRequestId();
    try {
      window.sessionStorage.setItem(
        getPointRedemptionRequestStorageKey(),
        pendingPointClaimRequestId
      );
    } catch (_error) {
      // The in-memory request ID still protects retries on this page.
    }
    return pendingPointClaimRequestId;
  }

  function clearPendingPointRedemptionRequest() {
    pendingPointClaimRequestId = "";
    try {
      window.sessionStorage.removeItem(getPointRedemptionRequestStorageKey());
    } catch (_error) {
      // sessionStorage may be unavailable.
    }
  }

  function getPointRedemptionRequestStorageKey() {
    return (
      POINT_REDEMPTION_REQUEST_STORAGE_PREFIX +
      String(CONFIG.LIFF_ID || "unknown")
    );
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
    var code = String(error && (error.code || error.name) || "").toUpperCase();
    return (
      normalizeError(error).code === "SCAN_QR_UNAVAILABLE" ||
      code === "FORBIDDEN" ||
      code === "EXCEPTION_IN_SUBWINDOW"
    );
  }

  function openEmbeddedPointScanner() {
    if (pointScannerReject) {
      return Promise.reject(createError("BUSY", "QR 掃描器正在使用中，請稍候。"));
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
            throw createError(
              "CAMERA_UNAVAILABLE",
              "目前瀏覽器無法開啟相機，請更新 LINE 或改用手機瀏覽器。"
            );
          }
          return window.navigator.mediaDevices
            .getUserMedia({
              audio: false,
              video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 1280 },
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
        createError(
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
        throw createError(
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
            finishEmbeddedPointScanner(String(match.rawValue).trim());
          }
        })
        .catch(function () {
          // A single frame can fail while the camera focuses.
        })
        .finally(function () {
          pointScannerDetecting = false;
          if (pointScannerReject) scheduleEmbeddedPointScan(detector);
        });
    }, 160);
  }

  function cancelEmbeddedPointScanner() {
    if (!pointScannerReject) {
      stopEmbeddedPointScanner();
      closeDialog(byId("point-scanner-dialog"));
      return;
    }
    finishEmbeddedPointScanner(
      "",
      createError("POINT_SCAN_CANCELLED", "已取消掃描。")
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
      reject(error || createError("CAMERA_UNAVAILABLE", "QR 掃描器已停止。"));
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

  function setEmbeddedPointScannerStatus(message) {
    byId("point-scanner-status").textContent = message;
  }

  function normalizeEmbeddedPointScannerError(error) {
    var name = String(error && (error.name || error.code) || "").toUpperCase();
    if (name === "NOTALLOWEDERROR" || name === "SECURITYERROR") {
      return createError(
        "CAMERA_PERMISSION_DENIED",
        "相機權限被拒絕，請在 LINE 或瀏覽器設定中允許相機後重試。"
      );
    }
    if (name === "NOTFOUNDERROR" || name === "OVERCONSTRAINEDERROR") {
      return createError("CAMERA_NOT_FOUND", "找不到可使用的相機。");
    }
    if (name === "NOTREADABLEERROR" || name === "ABORTERROR") {
      return createError(
        "CAMERA_UNAVAILABLE",
        "相機目前無法使用，請關閉其他使用相機的程式後重試。"
      );
    }
    return error && error.code
      ? error
      : createError(
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

  function setButtonBusy(button, busy, busyLabel) {
    if (!button) return;
    var label = button.querySelector("span");
    if (busy) {
      button.dataset.originalDisabled = String(button.disabled);
      button.dataset.originalLabel = label ? label.textContent : "";
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      if (label && busyLabel) label.textContent = busyLabel;
      return;
    }
    button.disabled = button.dataset.originalDisabled === "true";
    if (label && button.dataset.originalLabel) {
      label.textContent = button.dataset.originalLabel;
    }
    button.removeAttribute("aria-busy");
    delete button.dataset.originalDisabled;
    delete button.dataset.originalLabel;
  }

  function openDialog(dialog) {
    if (!dialog || dialog.open || dialog.hasAttribute("open")) return;
    if (typeof dialog.showModal === "function") {
      try {
        dialog.showModal();
      } catch (_error) {
        dialog.setAttribute("open", "");
      }
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
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
      INVALID_POINT_QR: "這不是有效的會員點數 QR Code。",
      POINT_CAMPAIGN_NOT_FOUND: "這張集點 QR Code 不存在。",
      POINT_CAMPAIGN_EXPIRED: "這張集點 QR Code 已過期。",
      POINT_CAMPAIGN_INACTIVE: "這張集點 QR Code 已停用。",
      POINT_CAMPAIGN_REDEEMED: "這張集點 QR Code 已被領取。",
      SCAN_QR_UNAVAILABLE: "目前環境無法掃描 QR Code，請更新 LINE 或瀏覽器。",
      CAMERA_PERMISSION_DENIED: "相機權限被拒絕，請允許相機後重試。",
      CAMERA_NOT_FOUND: "找不到可使用的相機。",
      CAMERA_UNAVAILABLE: "相機目前無法使用，請稍後再試。",
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
    return (
      liffId &&
      !/YOUR_|請填入|REPLACE/i.test(liffId) &&
      window.MemberApi.isValidGasUrl(CONFIG.GAS_WEB_APP_URL)
    );
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

  function getCleanPageUrl() {
    var url = new URL(window.location.href);
    url.hash = "";
    return url.toString();
  }

  function hasDemoQuery() {
    return new URLSearchParams(window.location.search).get("demo") === "1";
  }

  function createError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function bindInteractions() {
    byId("login-button").addEventListener("click", handleLogin);
    byId("retry-button").addEventListener("click", boot);
    byId("scan-point-button").addEventListener("click", handleScanPointQr);
    byId("point-scanner-cancel-button").addEventListener(
      "click",
      cancelEmbeddedPointScanner
    );
    byId("lottery-wheel-back-button").addEventListener(
      "click",
      closeLotteryWheelView
    );
    byId("lottery-spin-button").addEventListener("click", function () {
      try {
        handleDraw();
      } catch (error) {
        isBusy = false;
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
    byId("point-scanner-dialog").addEventListener("cancel", function (event) {
      event.preventDefault();
      cancelEmbeddedPointScanner();
    });
    byId("point-claim-dialog").addEventListener("cancel", function (event) {
      event.preventDefault();
    });
    byId("point-claim-confirm-button").addEventListener(
      "click",
      confirmPointClaim
    );
    byId("point-claim-error-close-button").addEventListener(
      "click",
      function () {
        closeDialog(byId("point-claim-dialog"));
      }
    );
    byId("point-claim-retry-button").addEventListener(
      "click",
      redeemScannedPointClaim
    );
    window.addEventListener("pagehide", stopEmbeddedPointScanner);
  }

  byId("current-year").textContent = String(new Date().getFullYear());
  bindInteractions();
  start();
})();
