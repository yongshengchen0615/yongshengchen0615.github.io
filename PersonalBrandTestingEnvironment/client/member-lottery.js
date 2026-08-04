(function () {
  "use strict";

  var REQUEST_STORAGE_PREFIX = "persona-member-lottery-round-request:";
  var SPIN_DEGREES_PER_MS = 1.45;
  var FINAL_SPIN_TURNS = 2;
  var DIALOG_STATE_IDS = [
    "member-lottery-loading-state",
    "member-lottery-error-state",
    "member-lottery-wheel-state",
    "member-lottery-result-state",
  ];
  var REQUIRED_ELEMENT_IDS = [
    "member-lottery-dialog",
    "member-lottery-dialog-description",
    "member-lottery-loading-state",
    "member-lottery-error-state",
    "member-lottery-wheel-state",
    "member-lottery-result-state",
    "member-lottery-wheel",
    "member-lottery-rotor",
    "member-lottery-spin-button",
    "member-lottery-close-button",
    "member-lottery-retry-button",
    "member-lottery-return-button",
    "member-lottery-confirm-button",
    "member-lottery-name",
    "member-lottery-ticket-detail",
    "member-lottery-spin-status",
    "member-lottery-error-code",
    "member-lottery-error-message",
    "member-lottery-result-prize",
    "member-lottery-result-detail",
    "member-lottery-result-swatch",
    "member-lottery-result-before",
    "member-lottery-result-balance",
  ];

  var options = null;
  var isConfigured = false;
  var interactionsBound = false;
  var lotteryTypes = [];
  var cardStatus = null;
  var selectedTicket = null;
  var selectedLotteryTypeId = "";
  var preparedDrawData = null;
  var pendingRequest = null;
  var pendingRequestStorageKey = "";
  var isPreparing = false;
  var isBusy = false;
  var allowHostClose = false;
  var loadVersion = 0;
  var lotteryRotation = 0;
  var settlingSpinFrame = 0;
  var spinAnimationVersion = 0;

  function byId(id) {
    return document.getElementById(id);
  }

  function configure(value) {
    value = value && typeof value === "object" ? value : {};
    if (typeof value.request !== "function") {
      throw createError(
        "INVALID_CONFIGURATION",
        "MemberLotteryDialog 需要 request(action, fields, requestId)。"
      );
    }

    options = {
      liffId: String(value.liffId || "unknown").trim() || "unknown",
      request: value.request,
      isDemo:
        typeof value.isDemo === "function"
          ? value.isDemo
          : function () {
              return false;
            },
      getCurrentCardSummary:
        typeof value.getCurrentCardSummary === "function"
          ? value.getCurrentCardSummary
          : function () {
              return null;
            },
      getCurrentTotalPoints:
        typeof value.getCurrentTotalPoints === "function"
          ? value.getCurrentTotalPoints
          : function () {
              return 0;
            },
      getMemberId:
        typeof value.getMemberId === "function"
          ? value.getMemberId
          : function () {
              return "";
            },
      onCardUpdated:
        typeof value.onCardUpdated === "function"
          ? value.onCardUpdated
          : function () {},
      onReturnToTickets:
        typeof value.onReturnToTickets === "function"
          ? value.onReturnToTickets
          : function () {},
      onAuthorizationError:
        typeof value.onAuthorizationError === "function"
          ? value.onAuthorizationError
          : null,
      normalizeError:
        typeof value.normalizeError === "function"
          ? value.normalizeError
          : defaultNormalizeError,
      showToast:
        typeof value.showToast === "function"
          ? value.showToast
          : function () {},
    };

    assertRequiredElements();
    if (
      !window.LotteryWheel ||
      typeof window.LotteryWheel.draw !== "function"
    ) {
      throw createError(
        "CLIENT_LIBRARY_ERROR",
        "無法載入轉盤繪製元件。"
      );
    }
    if (
      !window.MemberApi ||
      typeof window.MemberApi.createRequestId !== "function"
    ) {
      throw createError(
        "CLIENT_LIBRARY_ERROR",
        "無法載入會員請求元件。"
      );
    }

    isConfigured = true;
    if (!interactionsBound) bindInteractions();
    pendingRequest = null;
    pendingRequest = readPendingRequest();
    updateControls();
    return api;
  }

  function assertRequiredElements() {
    var missing = REQUIRED_ELEMENT_IDS.filter(function (id) {
      return !byId(id);
    });
    if (missing.length) {
      throw createError(
        "MISSING_LOTTERY_DIALOG",
        "轉盤視窗缺少必要元件：" + missing.join(", ")
      );
    }
  }

  function ensureConfigured() {
    if (!isConfigured || !options) {
      throw createError(
        "NOT_CONFIGURED",
        "請先設定 MemberLotteryDialog。"
      );
    }
  }

  function open(ticketValue) {
    ensureConfigured();
    var thisLoad = ++loadVersion;
    var dialog = byId("member-lottery-dialog");

    allowHostClose = false;
    showDialog(dialog);
    setDialogState("member-lottery-loading-state");
    dialog.setAttribute("aria-busy", "true");
    isPreparing = true;
    preparedDrawData = null;
    stopSpinAnimation();
    resetRotor();

    try {
      var storedRequest = readPendingRequest();
      var requestedTicket = normalizeRewardTicket(ticketValue);
      if (storedRequest) {
        selectedTicket = normalizeRewardTicket(storedRequest);
        if (
          selectedTicket.cardRoundKey !== requestedTicket.cardRoundKey ||
          selectedTicket.lotteryTypeId !== requestedTicket.lotteryTypeId
        ) {
          safeShowToast("請先完成上一次尚未確認的抽獎。");
        }
      } else {
        selectedTicket = requestedTicket;
      }
      selectedLotteryTypeId = selectedTicket.lotteryTypeId;
      renderTicketHeading();
    } catch (error) {
      isPreparing = false;
      dialog.setAttribute("aria-busy", "false");
      showError(error);
      updateControls();
      return Promise.resolve(false);
    }

    updateControls();
    return loadWorkspace(thisLoad);
  }

  function restorePending() {
    ensureConfigured();
    var storedRequest = readPendingRequest();
    if (!storedRequest) return Promise.resolve(false);
    return open(storedRequest).then(function (opened) {
      return Boolean(opened);
    });
  }

  function hasPending() {
    if (!isConfigured) return false;
    return Boolean(readPendingRequest());
  }

  function canClose() {
    if (!isConfigured || !options) return true;
    return !isBusy && !readPendingRequest();
  }

  function requestClose(closeOptions) {
    ensureConfigured();
    closeOptions =
      closeOptions && typeof closeOptions === "object" ? closeOptions : {};
    if (!canClose()) {
      safeShowToast("抽獎結果尚未確認，請先完成本次抽獎。");
      return false;
    }

    loadVersion += 1;
    isPreparing = false;
    isBusy = false;
    allowHostClose = false;
    stopSpinAnimation();
    closeDialog(byId("member-lottery-dialog"));
    byId("member-lottery-dialog").setAttribute("aria-busy", "false");
    selectedTicket = null;
    selectedLotteryTypeId = "";
    preparedDrawData = null;
    lotteryTypes = [];
    cardStatus = null;
    setText("member-lottery-spin-status", "");
    updateControls();

    if (closeOptions.returnToTickets) {
      safeCallback(options.onReturnToTickets);
    }
    return true;
  }

  function loadWorkspace(expectedLoadVersion) {
    var requestPromise = Promise.resolve().then(function () {
      if (safeIsDemo()) {
        return {
          ok: true,
          data: buildDemoWorkspace(),
        };
      }
      return options.request("getLotteryConfig", {}, undefined);
    });

    return requestPromise
      .then(function (response) {
        if (expectedLoadVersion !== loadVersion) return false;
        assertSuccessfulResponse(response);
        var workspace = normalizeWorkspace(response.data);
        lotteryTypes = workspace.lotteryTypes;
        cardStatus = workspace.card;

        var selectedType = findLotteryType(selectedLotteryTypeId);
        if (!selectedType) {
          throw createError(
            "LOTTERY_TYPE_NOT_FOUND",
            "這張抽獎券指定的轉盤目前無法使用。"
          );
        }

        var storedRequest = readPendingRequest();
        if (!storedRequest) {
          var availableTicket = cardStatus.availableRewards.find(function (
            ticket
          ) {
            return (
              ticket.cardRoundKey === selectedTicket.cardRoundKey &&
              ticket.lotteryTypeId === selectedTicket.lotteryTypeId
            );
          });
          if (!availableTicket) {
            throw createError(
              "LOTTERY_ROUND_NOT_READY",
              "這張抽獎券已使用或目前無法使用。"
            );
          }
          selectedTicket = availableTicket;
        } else if (
          storedRequest.cardRoundKey !== selectedTicket.cardRoundKey ||
          storedRequest.lotteryTypeId !== selectedTicket.lotteryTypeId
        ) {
          throw createError(
            "REQUEST_ID_CONFLICT",
            "上一次抽獎使用了不同的抽獎券。"
          );
        }

        renderTicketHeading();
        drawSelectedWheel();
        pendingRequest = ensurePendingRequest(selectedTicket);
        setText(
          "member-lottery-spin-status",
          storedRequest
            ? "正在安全取回上次抽獎結果…"
            : "正在安全準備本次抽獎結果…"
        );
        safeCardUpdated(cardStatus, workspace.totalPoints);
        updateControls();

        if (safeIsDemo()) return createDemoDrawResponse();
        return options.request(
          "drawLottery",
          {
            lotteryTypeId: selectedTicket.lotteryTypeId,
            cardRoundKey: selectedTicket.cardRoundKey,
          },
          pendingRequest.requestId
        );
      })
      .then(function (response) {
        if (expectedLoadVersion !== loadVersion) return false;
        assertSuccessfulResponse(response);
        if (
          !response.data ||
          !response.data.draw ||
          !response.data.lottery ||
          !response.data.lotteryType ||
          !response.data.card
        ) {
          throw createError(
            "INVALID_RESPONSE",
            "後台回傳的抽獎結果格式不完整。"
          );
        }

        preparedDrawData = normalizePreparedDraw(response.data);
        drawWheel(preparedDrawData.selectedType.lottery.prizes);
        resetRotor();
        isPreparing = false;
        byId("member-lottery-dialog").setAttribute("aria-busy", "false");
        setDialogState("member-lottery-wheel-state");
        setText(
          "member-lottery-spin-status",
          "轉盤已就緒，點選中央開始抽獎。"
        );
        updateControls();
        focusElement(byId("member-lottery-spin-button"));
        return true;
      })
      .catch(function (error) {
        if (expectedLoadVersion !== loadVersion) return false;
        isPreparing = false;
        preparedDrawData = null;
        byId("member-lottery-dialog").setAttribute("aria-busy", "false");
        if (delegateAuthorizationError(error)) {
          if (canClose()) requestClose();
          else {
            setDialogState("member-lottery-wheel-state");
            setText(
              "member-lottery-spin-status",
              "正在更新會員登入狀態…"
            );
            updateControls();
          }
          return false;
        }
        if (isDefinitiveNoDrawError(error)) {
          clearPendingRequest();
          refreshHostCardAfterNoDraw();
        }
        showError(error);
        updateControls();
        return false;
      });
  }

  function normalizeWorkspace(value) {
    value = value && typeof value === "object" ? value : {};
    if (
      !value.access ||
      value.access.allowed !== true ||
      !Array.isArray(value.lotteryTypes) ||
      !value.card
    ) {
      throw createError(
        "INVALID_RESPONSE",
        "後台回傳的抽獎資料格式不完整。"
      );
    }

    var normalizedTypes = normalizeLotteryTypes(value.lotteryTypes);
    lotteryTypes = normalizedTypes;
    var normalizedCard = normalizePointCardStatus(value.card);
    var totalPoints = normalizePointNumber(
      value.totalPoints == null ? value.pointBalance : value.totalPoints
    );
    if (totalPoints !== normalizedCard.totalPoints) {
      throw createError(
        "INVALID_RESPONSE",
        "累計點數與集點卡資料不一致。"
      );
    }
    return {
      lotteryTypes: normalizedTypes,
      card: normalizedCard,
      totalPoints: totalPoints,
    };
  }

  function handleDraw() {
    if (
      isBusy ||
      isPreparing ||
      !cardStatus ||
      !selectedTicket ||
      !preparedDrawData ||
      !findLotteryType(selectedLotteryTypeId) ||
      !readPendingRequest()
    ) {
      return;
    }

    isBusy = true;
    setText(
      "member-lottery-spin-status",
      "轉盤旋轉中，正在揭曉結果…"
    );
    updateControls();

    finishDraw(preparedDrawData)
      .catch(function (error) {
        isBusy = false;
        stopSpinAnimation();
        setText(
          "member-lottery-spin-status",
          "轉盤動畫未完成，請再點一次中央重新揭曉同一結果。"
        );
        updateControls();
        safeShowToast(normalizeError(error).message);
      });
  }

  function normalizePreparedDraw(data) {
    var selectedType;
    var resultLottery;
    var nextCard;
    var draw;
    var totalPoints;

    selectedType = normalizeLotteryTypes([data.lotteryType])[0];
    if (selectedType.lotteryTypeId !== selectedLotteryTypeId) {
      throw createError(
        "INVALID_RESPONSE",
        "抽獎結果與選擇的轉盤類型不一致。"
      );
    }
    resultLottery = normalizeLotteryConfig(
      data.lottery,
      selectedType.lotteryTypeId
    );
    if (
      JSON.stringify(resultLottery) !==
      JSON.stringify(selectedType.lottery)
    ) {
      throw createError(
        "INVALID_RESPONSE",
        "抽獎結果使用了不一致的轉盤設定。"
      );
    }

    replaceLotteryType(selectedType);
    nextCard = normalizePointCardStatus(data.card);
    draw = normalizeDraw(data.draw, selectedType);
    if (
      !selectedTicket ||
      draw.cardRoundKey !== selectedTicket.cardRoundKey
    ) {
      throw createError(
        "INVALID_RESPONSE",
        "抽獎結果與選擇的抽獎券不一致。"
      );
    }
    totalPoints = normalizePointNumber(
      data.totalPoints == null ? data.pointBalance : data.totalPoints
    );
    if (
      totalPoints !== draw.pointBalance ||
      nextCard.totalPoints !== draw.pointBalance
    ) {
      throw createError(
        "INVALID_RESPONSE",
        "抽獎前後累計點數不一致。"
      );
    }

    return {
      selectedType: selectedType,
      nextCard: nextCard,
      draw: draw,
      totalPoints: totalPoints,
    };
  }

  function finishDraw(prepared) {
    var selectedType = prepared.selectedType;
    var nextCard = prepared.nextCard;
    var draw = prepared.draw;
    var totalPoints = prepared.totalPoints;

    return animateToPrize(draw, selectedType.lottery).then(function () {
      cardStatus = nextCard;
      preparedDrawData = null;
      clearPendingRequest();
      isBusy = false;
      safeCardUpdated(cardStatus, totalPoints);
      renderResult(draw, selectedType);
      setText("member-lottery-spin-status", "");
      setDialogState("member-lottery-result-state");
      updateControls();
      focusElement(byId("member-lottery-confirm-button"));
      return true;
    });
  }

  function normalizeLotteryTypes(value) {
    if (!Array.isArray(value) || value.length < 1) {
      throw createError(
        "INVALID_RESPONSE",
        "目前沒有可使用的轉盤類型。"
      );
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
        throw createError(
          "INVALID_RESPONSE",
          "轉盤類型格式不正確。"
        );
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
      throw createError(
        "INVALID_RESPONSE",
        "轉盤設定格式不正確。"
      );
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
        throw createError(
          "INVALID_RESPONSE",
          "轉盤獎項格式不正確。"
        );
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
      throw createError(
        "INVALID_RESPONSE",
        "轉盤機率合計不是 100%。"
      );
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
          return normalizeRewardRule(rule);
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
      !isStrictPointSequence(
        normalized.rewardMilestones,
        normalized.targetPoints
      ) ||
      normalized.rewardRules.length !== normalized.rewardMilestones.length ||
      normalized.rewardRules.some(function (rule, index) {
        return (
          rule.points !== normalized.rewardMilestones[index] ||
          !findLotteryType(rule.lotteryTypeId)
        );
      }) ||
      !isStrictPointSequence(
        normalized.reachedMilestones,
        normalized.currentPoints,
        true
      ) ||
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
      throw createError(
        "INVALID_RESPONSE",
        "集點卡進度格式不正確。"
      );
    }
    return normalized;
  }

  function normalizeRewardRule(rule) {
    rule = rule && typeof rule === "object" ? rule : {};
    var hasVisibility = Object.prototype.hasOwnProperty.call(
      rule,
      "showPrizesOnTicket"
    );
    var showPrizesOnTicket = hasVisibility
      ? rule.showPrizesOnTicket
      : false;
    var prizeLabels = Array.isArray(rule.prizeLabels)
      ? rule.prizeLabels.map(function (label) {
          return String(label || "").trim();
        })
      : [];
    if (
      (hasVisibility && typeof showPrizesOnTicket !== "boolean") ||
      (!hasVisibility && prizeLabels.length > 0) ||
      (!showPrizesOnTicket && prizeLabels.length > 0) ||
      (showPrizesOnTicket &&
        (prizeLabels.length < 2 ||
          prizeLabels.length > 12 ||
          prizeLabels.some(function (label) {
            return !label || label.length > 40;
          })))
    ) {
      throw createError(
        "INVALID_RESPONSE",
        "抽獎券獎項顯示資料不正確。"
      );
    }
    var normalized = {
      points: Number(rule.points),
      lotteryTypeId: String(rule.lotteryTypeId || "").trim(),
    };
    if (hasVisibility) {
      normalized.showPrizesOnTicket = showPrizesOnTicket;
      normalized.prizeLabels = showPrizesOnTicket ? prizeLabels : [];
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
      ticket.milestonePoints > 9999 ||
      !/^LTY-[A-Z0-9]{10}$/.test(ticket.lotteryTypeId) ||
      ticket.cardRoundKey !==
        ticket.settingVersion +
          ":" +
          ticket.cardNumber +
          ":" +
          ticket.milestonePoints
    ) {
      throw createError(
        "INVALID_RESPONSE",
        "抽獎券資料格式不正確。"
      );
    }
    return ticket;
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
      pointsSpent: Number(
        value.pointsSpent == null ? value.ticketCost : value.pointsSpent
      ),
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
      !/^PCS-[A-Z0-9]{12}:[1-9]\d*:[1-9]\d*$/.test(draw.cardRoundKey) ||
      Number.isNaN(new Date(draw.drawnAt).getTime())
    ) {
      throw createError(
        "INVALID_RESPONSE",
        "後台回傳的抽獎結果格式不正確。"
      );
    }
    return draw;
  }

  function findLotteryType(lotteryTypeId) {
    return (
      lotteryTypes.find(function (type) {
        return type.lotteryTypeId === lotteryTypeId;
      }) || null
    );
  }

  function replaceLotteryType(nextType) {
    var existingIndex = lotteryTypes.findIndex(function (type) {
      return type.lotteryTypeId === nextType.lotteryTypeId;
    });
    if (existingIndex >= 0) lotteryTypes[existingIndex] = nextType;
    else lotteryTypes.push(nextType);
  }

  function hasUniqueRewardTickets(tickets) {
    var keys = Object.create(null);
    return tickets.every(function (ticket) {
      if (keys[ticket.cardRoundKey]) return false;
      keys[ticket.cardRoundKey] = true;
      return true;
    });
  }

  function isStrictPointSequence(values, maximum, allowEmpty) {
    if (
      !Array.isArray(values) ||
      (!allowEmpty && values.length < 1)
    ) {
      return false;
    }
    var previous = 0;
    for (var index = 0; index < values.length; index += 1) {
      if (
        !Number.isInteger(values[index]) ||
        values[index] <= previous ||
        values[index] > maximum
      ) {
        return false;
      }
      previous = values[index];
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

  function normalizePointNumber(value) {
    var number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
      throw createError(
        "INVALID_RESPONSE",
        "點數格式不正確。"
      );
    }
    return number;
  }

  function drawSelectedWheel() {
    var selectedType = findLotteryType(selectedLotteryTypeId);
    if (!selectedType) {
      throw createError(
        "LOTTERY_TYPE_NOT_FOUND",
        "找不到抽獎券指定的轉盤。"
      );
    }
    drawWheel(selectedType.lottery.prizes);
    resetRotor();
  }

  function drawWheel(prizes) {
    var drawn = window.LotteryWheel.draw(
      byId("member-lottery-wheel"),
      prizes
    );
    if (!drawn) {
      throw createError(
        "WHEEL_RENDER_ERROR",
        "目前無法繪製轉盤，請重新開啟後再試。"
      );
    }
  }

  function animateToPrize(draw, lottery) {
    stopSpinAnimation();
    var animationVersion = spinAnimationVersion;
    var prizeIndex = lottery.prizes.findIndex(function (prize) {
      return prize.prizeId === draw.prizeId;
    });
    if (prizeIndex < 0) {
      return Promise.reject(
        createError("INVALID_RESPONSE", "找不到抽中的獎項。")
      );
    }

    var sectorDegrees = 360 / lottery.prizes.length;
    var desiredRotation = -(prizeIndex + 0.5) * sectorDegrees;
    var currentModulo = ((lotteryRotation % 360) + 360) % 360;
    var desiredModulo = ((desiredRotation % 360) + 360) % 360;
    var alignment = (desiredModulo - currentModulo + 360) % 360;
    var startRotation = lotteryRotation;
    var rotationDelta = 360 * FINAL_SPIN_TURNS + alignment;
    var targetRotation = startRotation + rotationDelta;
    var rotor = byId("member-lottery-rotor");

    setText(
      "member-lottery-spin-status",
      "轉盤旋轉中，請稍候結果…"
    );
    if (prefersReducedMotion()) {
      lotteryRotation = targetRotation;
      rotor.style.transform = "rotate(" + lotteryRotation + "deg)";
      return new Promise(function (resolve) {
        window.setTimeout(function () {
          if (animationVersion === spinAnimationVersion) resolve();
        }, 30);
      });
    }

    var duration = (2 * rotationDelta) / SPIN_DEGREES_PER_MS;
    return new Promise(function (resolve) {
      var animationStartedAt =
        window.performance &&
        typeof window.performance.now === "function"
          ? window.performance.now()
          : null;

      function decelerate(timestamp) {
        if (animationVersion !== spinAnimationVersion) return;
        if (animationStartedAt === null) animationStartedAt = timestamp;
        var progress = Math.min(
          1,
          (timestamp - animationStartedAt) / duration
        );
        var quadraticEaseOut = 1 - Math.pow(1 - progress, 2);
        var smoothstepCorrection = Math.pow(
          progress * (1 - progress),
          2
        );
        var easedProgress =
          quadraticEaseOut + smoothstepCorrection;
        lotteryRotation =
          startRotation + rotationDelta * easedProgress;
        rotor.style.transform =
          "rotate(" + lotteryRotation + "deg)";

        if (progress < 1) {
          settlingSpinFrame =
            window.requestAnimationFrame(decelerate);
          return;
        }
        settlingSpinFrame = 0;
        lotteryRotation = targetRotation;
        rotor.style.transform =
          "rotate(" + lotteryRotation + "deg)";
        resolve();
      }

      settlingSpinFrame =
        window.requestAnimationFrame(decelerate);
    });
  }

  function resetRotor() {
    stopSpinAnimation();
    lotteryRotation = 0;
    var rotor = byId("member-lottery-rotor");
    if (rotor) rotor.style.transform = "rotate(0deg)";
  }

  function stopSpinAnimation() {
    if (settlingSpinFrame) {
      window.cancelAnimationFrame(settlingSpinFrame);
      settlingSpinFrame = 0;
    }
    spinAnimationVersion += 1;
  }

  function prefersReducedMotion() {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function ensurePendingRequest(ticket) {
    var storageKey = getRequestStorageKey();
    if (!storageKey) {
      throw createError(
        "LOTTERY_SESSION_NOT_READY",
        "會員身分尚未準備完成，請重新開啟抽獎券。"
      );
    }
    var stored = readPendingRequest();
    if (stored) {
      if (
        stored.lotteryTypeId !== ticket.lotteryTypeId ||
        stored.cardRoundKey !== ticket.cardRoundKey
      ) {
        throw createError(
          "REQUEST_ID_CONFLICT",
          "請先完成上一次轉盤結果確認。"
        );
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
    pendingRequestStorageKey = storageKey;
    try {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify(request)
      );
    } catch (_error) {
      // The in-memory request still makes retries idempotent in this page.
    }
    return request;
  }

  function readPendingRequest() {
    var storageKey = getRequestStorageKey();
    if (!storageKey) {
      pendingRequest = null;
      pendingRequestStorageKey = "";
      return null;
    }
    if (pendingRequestStorageKey !== storageKey) {
      pendingRequest = null;
      pendingRequestStorageKey = storageKey;
    }
    if (pendingRequest) return pendingRequest;
    try {
      var parsed = JSON.parse(
        window.sessionStorage.getItem(storageKey) || "null"
      );
      if (
        parsed &&
        /^[a-zA-Z0-9-]{10,80}$/.test(String(parsed.requestId || "")) &&
        isValidRewardTicket(parsed)
      ) {
        pendingRequest = {
          requestId: String(parsed.requestId),
          settingVersion: String(parsed.settingVersion),
          cardNumber: Number(parsed.cardNumber),
          milestonePoints: Number(parsed.milestonePoints),
          lotteryTypeId: String(parsed.lotteryTypeId),
          cardRoundKey: String(parsed.cardRoundKey),
        };
        return pendingRequest;
      }
      if (parsed) {
        window.sessionStorage.removeItem(storageKey);
      }
    } catch (_error) {
      // Invalid or unavailable session storage is treated as empty.
    }
    return null;
  }

  function isValidRewardTicket(value) {
    try {
      normalizeRewardTicket(value);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function clearPendingRequest() {
    var storageKey = pendingRequestStorageKey || getRequestStorageKey();
    pendingRequest = null;
    pendingRequestStorageKey = getRequestStorageKey();
    try {
      if (storageKey) window.sessionStorage.removeItem(storageKey);
    } catch (_error) {
      // sessionStorage may be unavailable.
    }
  }

  function getRequestStorageKey() {
    if (safeIsDemo()) {
      return REQUEST_STORAGE_PREFIX + options.liffId + ":demo";
    }
    var memberId = "";
    try {
      memberId = String(options.getMemberId() || "").trim();
    } catch (_error) {
      memberId = "";
    }
    return /^MBR-[A-Z0-9]{10}$/.test(memberId)
      ? REQUEST_STORAGE_PREFIX + options.liffId + ":" + memberId
      : "";
  }

  function renderTicketHeading() {
    if (!selectedTicket) return;
    var selectedType = findLotteryType(selectedLotteryTypeId);
    setText(
      "member-lottery-name",
      selectedType ? selectedType.name : "準備轉盤"
    );
    setText(
      "member-lottery-ticket-detail",
      "第 " +
        formatNumber(selectedTicket.cardNumber) +
        " 張集點卡 · " +
        formatNumber(selectedTicket.milestonePoints) +
        " 點節點抽獎券"
    );
  }

  function renderResult(draw, selectedType) {
    setText("member-lottery-result-prize", draw.prizeLabel);
    setText(
      "member-lottery-result-before",
      formatNumber(draw.originalPointBalance)
    );
    setText(
      "member-lottery-result-balance",
      formatNumber(draw.pointBalance)
    );
    setText(
      "member-lottery-result-detail",
      selectedType.name + " · 不扣點，本券已使用。"
    );
    byId("member-lottery-result-swatch").style.backgroundColor =
      draw.prizeColor;
  }

  function showError(errorValue) {
    var normalized = normalizeError(errorValue);
    setText(
      "member-lottery-error-code",
      normalized.code.replace(/_/g, " ")
    );
    setText("member-lottery-error-message", normalized.message);
    setDialogState("member-lottery-error-state");
  }

  function isDefinitiveNoDrawError(errorValue) {
    var code = normalizeError(errorValue).code;
    return (
      code === "LOTTERY_ROUND_NOT_READY" ||
      code === "LOTTERY_TICKET_MISMATCH" ||
      code === "INVALID_LOTTERY_TICKET"
    );
  }

  function refreshHostCardAfterNoDraw() {
    if (safeIsDemo()) return;
    Promise.resolve()
      .then(function () {
        return options.request("getLotteryConfig", {}, undefined);
      })
      .then(function (response) {
        assertSuccessfulResponse(response);
        var workspace = normalizeWorkspace(response.data);
        lotteryTypes = workspace.lotteryTypes;
        cardStatus = workspace.card;
        safeCardUpdated(cardStatus, workspace.totalPoints);
      })
      .catch(function (error) {
        if (!delegateAuthorizationError(error)) {
          safeShowToast(normalizeError(error).message);
        }
      });
  }

  function normalizeError(errorValue) {
    var normalized;
    try {
      normalized = options.normalizeError(errorValue);
    } catch (_error) {
      normalized = null;
    }
    normalized =
      normalized && typeof normalized === "object" ? normalized : {};
    return {
      code: String(
        normalized.code ||
          (errorValue && (errorValue.code || errorValue.name)) ||
          "CONNECTION_ERROR"
      ),
      message: String(
        normalized.message ||
          (errorValue && errorValue.message) ||
          "目前無法載入轉盤，請稍後再試。"
      ),
    };
  }

  function defaultNormalizeError(errorValue) {
    return {
      code:
        errorValue && (errorValue.code || errorValue.name)
          ? String(errorValue.code || errorValue.name)
          : "CONNECTION_ERROR",
      message:
        errorValue && errorValue.message
          ? String(errorValue.message)
          : "目前無法載入轉盤，請稍後再試。",
    };
  }

  function assertSuccessfulResponse(response) {
    if (response && response.ok === true) return;
    throw createError(
      response && response.code ? response.code : "BACKEND_ERROR",
      response && response.message
        ? response.message
        : "後台目前無法回應。"
    );
  }

  function updateControls() {
    if (!isConfigured) return;
    var pending = Boolean(readPendingRequest());
    var selectedType = findLotteryType(selectedLotteryTypeId);
    var canDraw =
      !isBusy &&
      !isPreparing &&
      cardStatus &&
      selectedTicket &&
      selectedType &&
      preparedDrawData &&
      pending;
    var spinButton = byId("member-lottery-spin-button");
    spinButton.disabled = !canDraw;
    spinButton.setAttribute("aria-busy", String(isBusy));
    spinButton.dataset.state = isBusy
      ? "busy"
      : isPreparing
        ? "loading"
        : canDraw
          ? "ready"
          : "disabled";
    setButtonLabel(
      spinButton,
      isBusy
        ? "抽獎中"
        : isPreparing
          ? "準備轉盤"
          : preparedDrawData
            ? "開始抽獎"
            : pending
              ? "重新準備"
              : selectedTicket
                ? "等待準備"
                : "選擇抽獎券"
    );

    var closeDisabled = !canClose();
    [
      "member-lottery-close-button",
      "member-lottery-return-button",
    ].forEach(function (id) {
      var button = byId(id);
      button.disabled = closeDisabled;
      button.setAttribute(
        "aria-disabled",
        String(closeDisabled)
      );
    });
  }

  function setButtonLabel(button, label) {
    var labelElement = button.querySelector("span");
    if (labelElement) labelElement.textContent = label;
    else button.textContent = label;
  }

  function setDialogState(activeId) {
    DIALOG_STATE_IDS.forEach(function (id) {
      byId(id).hidden = id !== activeId;
    });
    var descriptions = {
      "member-lottery-loading-state": "正在確認抽獎券與轉盤設定。",
      "member-lottery-error-state": "轉盤目前無法使用，請查看錯誤內容。",
      "member-lottery-wheel-state": "轉盤已就緒，可點選中央開始抽獎。",
      "member-lottery-result-state": "抽獎結果已顯示。",
    };
    setText(
      "member-lottery-dialog-description",
      descriptions[activeId] || "轉盤抽獎視窗。"
    );
  }

  function showDialog(dialog) {
    if (dialog.open || dialog.hasAttribute("open")) return;
    dialog.removeAttribute("hidden");
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
    if (typeof dialog.close === "function" && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  function bindInteractions() {
    interactionsBound = true;
    byId("member-lottery-spin-button").addEventListener(
      "click",
      handleDraw
    );
    byId("member-lottery-retry-button").addEventListener(
      "click",
      function () {
        if (!selectedTicket || isPreparing || isBusy) return;
        var thisLoad = ++loadVersion;
        isPreparing = true;
        setDialogState("member-lottery-loading-state");
        byId("member-lottery-dialog").setAttribute(
          "aria-busy",
          "true"
        );
        updateControls();
        loadWorkspace(thisLoad);
      }
    );
    var dialog = byId("member-lottery-dialog");
    dialog.addEventListener(
      "click",
      function (event) {
        var target =
          event.target && typeof event.target.closest === "function"
            ? event.target.closest(
                "#member-lottery-close-button, " +
                  "#member-lottery-return-button, " +
                  "#member-lottery-confirm-button"
              )
            : null;
        if (!target && event.target !== dialog) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        requestClose({
          returnToTickets:
            Boolean(target) &&
            target.id !== "member-lottery-close-button",
        });
      },
      true
    );
    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      requestClose();
    });
    dialog.addEventListener("close", function () {
      if (allowHostClose || canClose()) return;
      safeShowToast("抽獎結果尚未確認，請先完成本次抽獎。");
      window.requestAnimationFrame(function () {
        showDialog(dialog);
      });
    });
    window.addEventListener("beforeunload", function (event) {
      if (canClose()) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function buildDemoWorkspace() {
    var summary = normalizeDemoSummary(
      options.getCurrentCardSummary()
    );
    var typeIds = summary.rewardRules
      .map(function (rule) {
        return rule.lotteryTypeId;
      })
      .concat(
        summary.availableRewards.map(function (ticket) {
          return ticket.lotteryTypeId;
        })
      )
      .concat(selectedLotteryTypeId ? [selectedLotteryTypeId] : [])
      .filter(function (typeId, index, values) {
        return values.indexOf(typeId) === index;
      });
    var types = typeIds.map(createDemoLotteryType);
    lotteryTypes = types;
    var totalPoints = normalizePointNumber(
      options.getCurrentTotalPoints()
    );
    var rewardMilestones = summary.rewardRules.map(function (rule) {
      return rule.points;
    });
    var reachedMilestones = rewardMilestones.filter(function (
      milestone
    ) {
      return milestone <= summary.currentPoints;
    });
    var completedCards = Math.max(
      0,
      summary.currentCardNumber - 1
    );
    var earnedRewards =
      completedCards * rewardMilestones.length +
      reachedMilestones.length;
    earnedRewards = Math.max(earnedRewards, summary.availableDraws);
    var drawsUsed = Math.max(
      0,
      earnedRewards - summary.availableDraws
    );
    var nextMilestone = rewardMilestones.find(function (milestone) {
      return milestone > summary.currentPoints;
    });

    return {
      access: { allowed: true, status: "approved" },
      lotteryTypes: types,
      card: {
        settingVersion: summary.settingVersion,
        targetPoints: summary.targetPoints,
        expiryMode: summary.expiryMode,
        expiresOn: summary.expiresOn,
        rewardMilestones: rewardMilestones,
        rewardRules: summary.rewardRules,
        reachedMilestones: reachedMilestones,
        currentPoints: summary.currentPoints,
        nextMilestonePoints: nextMilestone,
        pointsRemaining: nextMilestone - summary.currentPoints,
        pointsToCardComplete:
          summary.targetPoints - summary.currentPoints,
        currentCardNumber: summary.currentCardNumber,
        currentRound: summary.currentCardNumber,
        completedCards: completedCards,
        completedRounds: completedCards,
        earnedRewards: earnedRewards,
        drawsUsed: drawsUsed,
        availableDraws: summary.availableDraws,
        availableRewards: summary.availableRewards,
        totalPoints: totalPoints,
      },
      pointBalance: totalPoints,
      totalPoints: totalPoints,
      canDraw: summary.availableDraws > 0,
    };
  }

  function normalizeDemoSummary(value) {
    value = value && typeof value === "object" ? value : {};
    var summary = {
      settingVersion: String(value.settingVersion || "").trim(),
      currentPoints: Number(value.currentPoints),
      targetPoints: Number(value.targetPoints),
      currentCardNumber: Number(value.currentCardNumber),
      availableDraws: Number(value.availableDraws),
      expiryMode: String(value.expiryMode || "").trim(),
      expiresOn: String(value.expiresOn || "").trim(),
      rewardRules: Array.isArray(value.rewardRules)
        ? value.rewardRules.map(function (rule) {
            return normalizeRewardRule(rule);
          })
        : [],
      availableRewards: Array.isArray(value.availableRewards)
        ? value.availableRewards.map(normalizeRewardTicket)
        : [],
    };
    if (
      !/^PCS-[A-Z0-9]{12}$/.test(summary.settingVersion) ||
      !Number.isSafeInteger(summary.currentPoints) ||
      summary.currentPoints < 0 ||
      !Number.isSafeInteger(summary.targetPoints) ||
      summary.targetPoints < 1 ||
      summary.currentPoints >= summary.targetPoints ||
      !Number.isSafeInteger(summary.currentCardNumber) ||
      summary.currentCardNumber < 1 ||
      !Number.isSafeInteger(summary.availableDraws) ||
      summary.availableDraws < 0 ||
      summary.rewardRules.length < 1 ||
      summary.rewardRules.some(function (rule, index) {
        return (
          !Number.isSafeInteger(rule.points) ||
          rule.points < 1 ||
          rule.points > summary.targetPoints ||
          (index > 0 &&
            rule.points <= summary.rewardRules[index - 1].points) ||
          !/^LTY-[A-Z0-9]{10}$/.test(rule.lotteryTypeId)
        );
      }) ||
      summary.rewardRules[summary.rewardRules.length - 1].points !==
        summary.targetPoints ||
      summary.availableRewards.length !==
        Math.min(summary.availableDraws, 50) ||
      !hasUniqueRewardTickets(summary.availableRewards) ||
      (summary.expiryMode !== "unlimited" &&
        summary.expiryMode !== "limited") ||
      (summary.expiryMode === "unlimited" && summary.expiresOn) ||
      (summary.expiryMode === "limited" &&
        !isValidPointCardDate(summary.expiresOn))
    ) {
      throw createError(
        "INVALID_RESPONSE",
        "展示用集點卡摘要格式不正確。"
      );
    }
    return summary;
  }

  function createDemoLotteryType(typeId, typeIndex) {
    var offset = typeIndex * 4;
    var prizes = [
      {
        prizeId:
          "LPR-DEMO" + String(offset + 1).padStart(6, "0"),
        label: "再接再厲",
        color: "#D9D6CC",
        probability: 55,
      },
      {
        prizeId:
          "LPR-DEMO" + String(offset + 2).padStart(6, "0"),
        label: "會員小禮",
        color: "#8DCCAA",
        probability: 25,
      },
      {
        prizeId:
          "LPR-DEMO" + String(offset + 3).padStart(6, "0"),
        label: "精選好禮",
        color: "#F0C36A",
        probability: 15,
      },
      {
        prizeId:
          "LPR-DEMO" + String(offset + 4).padStart(6, "0"),
        label: "本輪頭獎",
        color: "#0B3C2C",
        probability: 5,
      },
    ];
    return {
      lotteryTypeId: typeId,
      name:
        typeId === selectedLotteryTypeId
          ? "會員幸運轉盤"
          : "節點轉盤 " + formatNumber(typeIndex + 1),
      lottery: {
        lotteryTypeId: typeId,
        configVersion:
          "LCF-DEMO" + String(typeIndex + 1).padStart(8, "0"),
        updatedAt: "2026-01-01T00:00:00.000Z",
        prizes: prizes,
      },
    };
  }

  function createDemoDrawResponse() {
    var selectedType = findLotteryType(selectedLotteryTypeId);
    var request = readPendingRequest();
    if (!selectedType || !request || !cardStatus) {
      return Promise.reject(
        createError(
          "LOTTERY_ROUND_NOT_READY",
          "展示抽獎尚未準備完成。"
        )
      );
    }
    var prizeIndex =
      stableHash(request.cardRoundKey) %
      selectedType.lottery.prizes.length;
    var prize = selectedType.lottery.prizes[prizeIndex];
    var nextCard = copyCardStatus(cardStatus);
    var ticketWasAvailable =
      nextCard.availableRewards.some(function (ticket) {
        return ticket.cardRoundKey === request.cardRoundKey;
      });
    if (ticketWasAvailable) {
      nextCard.drawsUsed += 1;
      nextCard.availableDraws -= 1;
      nextCard.availableRewards =
        nextCard.availableRewards.filter(function (ticket) {
          return ticket.cardRoundKey !== request.cardRoundKey;
        });
    }
    var response = {
      ok: true,
      data: {
        access: { allowed: true, status: "approved" },
        lotteryType: selectedType,
        lottery: selectedType.lottery,
        draw: {
          drawId: "LDW-DEMO000000000001",
          configVersion: selectedType.lottery.configVersion,
          prizeId: prize.prizeId,
          prizeLabel: prize.label,
          prizeColor: prize.color,
          lotteryTypeId: selectedType.lotteryTypeId,
          ticketCost: 0,
          pointsSpent: 0,
          originalPointBalance: cardStatus.totalPoints,
          pointBalance: cardStatus.totalPoints,
          cardRoundKey: request.cardRoundKey,
          drawnAt: "2026-01-01T00:00:00.000Z",
        },
        card: nextCard,
        pointBalance: cardStatus.totalPoints,
        totalPoints: cardStatus.totalPoints,
      },
    };
    return new Promise(function (resolve) {
      window.setTimeout(function () {
        resolve(response);
      }, 450);
    });
  }

  function copyCardStatus(value) {
    return {
      settingVersion: value.settingVersion,
      targetPoints: value.targetPoints,
      expiryMode: value.expiryMode,
      expiresOn: value.expiresOn,
      rewardMilestones: value.rewardMilestones.slice(),
      rewardRules: value.rewardRules.map(function (rule) {
        var copy = {
          points: rule.points,
          lotteryTypeId: rule.lotteryTypeId,
        };
        if (
          Object.prototype.hasOwnProperty.call(
            rule,
            "showPrizesOnTicket"
          )
        ) {
          copy.showPrizesOnTicket = rule.showPrizesOnTicket;
          copy.prizeLabels = rule.prizeLabels.slice();
        }
        return copy;
      }),
      reachedMilestones: value.reachedMilestones.slice(),
      currentPoints: value.currentPoints,
      nextMilestonePoints: value.nextMilestonePoints,
      pointsRemaining: value.pointsRemaining,
      pointsToCardComplete: value.pointsToCardComplete,
      currentCardNumber: value.currentCardNumber,
      currentRound: value.currentRound,
      completedCards: value.completedCards,
      completedRounds: value.completedRounds,
      earnedRewards: value.earnedRewards,
      drawsUsed: value.drawsUsed,
      availableDraws: value.availableDraws,
      availableRewards: value.availableRewards.map(function (ticket) {
        return {
          settingVersion: ticket.settingVersion,
          cardNumber: ticket.cardNumber,
          milestonePoints: ticket.milestonePoints,
          lotteryTypeId: ticket.lotteryTypeId,
          cardRoundKey: ticket.cardRoundKey,
        };
      }),
      totalPoints: value.totalPoints,
    };
  }

  function stableHash(value) {
    var hash = 2166136261;
    String(value || "").split("").forEach(function (character) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    });
    return hash >>> 0;
  }

  function safeIsDemo() {
    try {
      return options.isDemo() === true;
    } catch (_error) {
      return false;
    }
  }

  function safeCardUpdated(nextCard, totalPoints) {
    try {
      options.onCardUpdated(nextCard, totalPoints);
    } catch (error) {
      safeShowToast(normalizeError(error).message);
    }
  }

  function safeShowToast(message) {
    try {
      options.showToast(String(message || ""));
    } catch (_error) {
      // Host UI errors must not change draw persistence.
    }
  }

  function safeCallback(callback) {
    try {
      callback();
    } catch (error) {
      safeShowToast(normalizeError(error).message);
    }
  }

  function delegateAuthorizationError(errorValue) {
    if (!options.onAuthorizationError) return false;
    var normalized = normalizeError(errorValue);
    if (
      normalized.code !== "INVALID_TOKEN" &&
      normalized.code !== "INVALID_ID_TOKEN" &&
      normalized.code !== "MEMBER_ACCESS_DENIED"
    ) {
      return false;
    }
    try {
      allowHostClose = true;
      options.onAuthorizationError(errorValue);
    } catch (error) {
      safeShowToast(normalizeError(error).message);
    }
    return true;
  }

  function setText(id, value) {
    var element = byId(id);
    if (element) element.textContent = String(value == null ? "" : value);
  }

  function formatNumber(value) {
    return normalizePointNumber(value).toLocaleString("zh-TW");
  }

  function focusElement(element) {
    if (!element || typeof element.focus !== "function") return;
    window.requestAnimationFrame(function () {
      try {
        element.focus({ preventScroll: true });
      } catch (_error) {
        element.focus();
      }
    });
  }

  function createError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  var api = Object.freeze({
    configure: configure,
    open: open,
    restorePending: restorePending,
    hasPending: hasPending,
    canClose: canClose,
    requestClose: requestClose,
  });

  window.MemberLotteryDialog = api;
})();
