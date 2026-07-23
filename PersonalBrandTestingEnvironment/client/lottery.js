(function () {
  "use strict";

  var CONFIG = Object.freeze({});
  var currentIdToken = "";
  var lotteryTypes = [];
  var selectedLotteryTypeId = "";
  var cardStatus = null;
  var lotteryRotation = 0;
  var isBusy = false;
  var isDemoSession = false;
  var pendingRequest = null;
  var toastTimer = null;
  var bootVersion = 0;
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
    setLoading("正在讀取集點卡", "確認本輪進度與可使用的轉盤類型。");
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
    setLoading("正在讀取集點卡", "確認本輪進度、抽獎資格與轉盤設定。");
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
    cardStatus = normalizePointCardStatus(data.card);
    var totalPoints = normalizePointNumber(
      data.totalPoints == null ? data.pointBalance : data.totalPoints
    );
    if (totalPoints !== cardStatus.totalPoints) {
      throw createError("INVALID_RESPONSE", "累計點數與集點卡資料不一致。");
    }
    pendingRequest = readPendingRequest();
    if (
      pendingRequest &&
      lotteryTypes.some(function (type) {
        return type.lotteryTypeId === pendingRequest.lotteryTypeId;
      })
    ) {
      selectedLotteryTypeId = pendingRequest.lotteryTypeId;
    } else {
      if (pendingRequest) clearPendingRequest();
      selectedLotteryTypeId = lotteryTypes[0].lotteryTypeId;
    }

    renderPointCard();
    renderLotteryTypeOptions();
    renderSelectedLottery();
    setView("lottery-state");
    updateControls();
  }

  function renderDemo() {
    currentIdToken = "";
    var now = new Date().toISOString();
    renderWorkspace({
      access: { allowed: true, status: "approved" },
      totalPoints: 12,
      card: {
        settingVersion: "PCS-PREVIEW00001",
        targetPoints: 5,
        currentPoints: 2,
        pointsRemaining: 3,
        currentRound: 3,
        completedRounds: 2,
        drawsUsed: 1,
        availableDraws: 1,
        totalPoints: 12,
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
    var normalized = {
      settingVersion: String(value.settingVersion || "").trim(),
      targetPoints: Number(value.targetPoints),
      currentPoints: Number(value.currentPoints),
      pointsRemaining: Number(value.pointsRemaining),
      currentRound: Number(value.currentRound),
      completedRounds: Number(value.completedRounds),
      drawsUsed: Number(value.drawsUsed),
      availableDraws: Number(value.availableDraws),
      totalPoints: Number(value.totalPoints),
    };
    if (
      !/^PCS-[A-Z0-9]{12}$/.test(normalized.settingVersion) ||
      !Number.isInteger(normalized.targetPoints) ||
      normalized.targetPoints < 1 ||
      !Number.isInteger(normalized.currentPoints) ||
      normalized.currentPoints < 0 ||
      normalized.currentPoints >= normalized.targetPoints ||
      normalized.pointsRemaining !== normalized.targetPoints - normalized.currentPoints ||
      !Number.isInteger(normalized.currentRound) ||
      normalized.currentRound < 1 ||
      !Number.isInteger(normalized.completedRounds) ||
      normalized.completedRounds < 0 ||
      !Number.isInteger(normalized.drawsUsed) ||
      normalized.drawsUsed < 0 ||
      !Number.isInteger(normalized.availableDraws) ||
      normalized.availableDraws < 0 ||
      normalized.availableDraws !== normalized.completedRounds - normalized.drawsUsed ||
      !Number.isSafeInteger(normalized.totalPoints) ||
      normalized.totalPoints < 0
    ) {
      throw createError("INVALID_RESPONSE", "集點卡進度格式不正確。");
    }
    return normalized;
  }

  function renderPointCard() {
    byId("lottery-total-points").textContent = formatNumber(cardStatus.totalPoints);
    byId("point-card-round").textContent = formatNumber(cardStatus.currentRound);
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
    byId("point-card-progress-message").textContent =
      cardStatus.availableDraws > 0
        ? "已有 " + cardStatus.availableDraws + " 個完成輪次可以抽獎。"
        : "再獲得 " + cardStatus.pointsRemaining + " 點即可完成本輪。";
  }

  function renderLotteryTypeOptions() {
    var container = byId("lottery-type-options");
    container.textContent = "";
    lotteryTypes.forEach(function (type) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "lottery-type-option";
      button.dataset.lotteryTypeId = type.lotteryTypeId;
      button.setAttribute("role", "radio");
      button.setAttribute(
        "aria-checked",
        String(type.lotteryTypeId === selectedLotteryTypeId)
      );
      button.textContent = type.name;
      button.addEventListener("click", function () {
        if (isBusy || pendingRequest) return;
        selectedLotteryTypeId = type.lotteryTypeId;
        renderLotteryTypeOptions();
        renderSelectedLottery();
      });
      container.appendChild(button);
    });
  }

  function getSelectedLotteryType() {
    return lotteryTypes.find(function (type) {
      return type.lotteryTypeId === selectedLotteryTypeId;
    }) || null;
  }

  function renderSelectedLottery() {
    var selected = getSelectedLotteryType();
    if (!selected) return;
    byId("selected-lottery-name").textContent = selected.name;
    drawWheel(selected.lottery.prizes);
    resetRotor();
  }

  function drawWheel(prizes) {
    var canvas = byId("member-lottery-wheel");
    if (!canvas || typeof canvas.getContext !== "function") return;
    var context = canvas.getContext("2d");
    if (!context) return;
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
    if (isBusy || !cardStatus || cardStatus.availableDraws < 1) return;
    var selected = getSelectedLotteryType();
    if (!selected) return;
    isBusy = true;
    pendingRequest = ensurePendingRequest(selected.lotteryTypeId);
    updateControls();
    byId("lottery-spin-status").textContent =
      "GAS 正在鎖定本輪資格並決定抽獎結果…";

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
            cardRoundKey: cardStatus.settingVersion + ":2",
            drawnAt: new Date().toISOString(),
          },
          card: {
            settingVersion: cardStatus.settingVersion,
            targetPoints: cardStatus.targetPoints,
            currentPoints: cardStatus.currentPoints,
            pointsRemaining: cardStatus.pointsRemaining,
            currentRound: cardStatus.currentRound,
            completedRounds: cardStatus.completedRounds,
            drawsUsed: cardStatus.drawsUsed + 1,
            availableDraws: cardStatus.availableDraws - 1,
            totalPoints: cardStatus.totalPoints,
          },
          totalPoints: cardStatus.totalPoints,
        });
      }, 450);
      return;
    }

    sendMemberRequest(
      "drawLottery",
      { lotteryTypeId: selected.lotteryTypeId },
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
        updateControls();
        byId("lottery-spin-status").textContent =
          "尚未確認結果；請按同一按鈕安全重試，不會重複使用資格。";
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
      !/^PCS-[A-Z0-9]{12}:[1-9]\d*$/.test(draw.cardRoundKey) ||
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
        normalizePointNumber(
          data.totalPoints == null ? data.pointBalance : data.totalPoints
        ) !== draw.pointBalance ||
        nextCard.totalPoints !== draw.pointBalance
      ) {
        throw createError("INVALID_RESPONSE", "抽獎前後累計點數不一致。");
      }
    } catch (error) {
      isBusy = false;
      updateControls();
      showToast(normalizeError(error).message, "error");
      return;
    }

    var existingIndex = lotteryTypes.findIndex(function (type) {
      return type.lotteryTypeId === selectedType.lotteryTypeId;
    });
    if (existingIndex >= 0) lotteryTypes[existingIndex] = selectedType;
    cardStatus = nextCard;
    drawWheel(selectedType.lottery.prizes);
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
      updateControls();
      byId("lottery-spin-status").textContent = "";
      openResultDialog();
    });
  }

  function animateToPrize(draw, lottery) {
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
    lotteryRotation = 0;
    var rotor = byId("member-lottery-rotor");
    rotor.style.transitionDuration = "0ms";
    rotor.style.transform = "rotate(0deg)";
    window.requestAnimationFrame(function () {
      rotor.style.transitionDuration = "";
    });
  }

  function updateControls() {
    var canDraw =
      !isBusy &&
      cardStatus &&
      cardStatus.availableDraws > 0 &&
      Boolean(getSelectedLotteryType());
    var button = byId("lottery-spin-button");
    button.disabled = !canDraw;
    button.setAttribute("aria-busy", String(isBusy));
    var label = button.querySelector("span");
    label.textContent = isBusy
      ? "正在決定抽獎結果"
      : cardStatus && cardStatus.availableDraws > 0
        ? "使用本輪資格開始抽獎"
        : "完成本輪集點後即可抽獎";
    document.querySelectorAll(".lottery-type-option").forEach(function (option) {
      option.disabled = isBusy || Boolean(pendingRequest);
    });
  }

  function ensurePendingRequest(lotteryTypeId) {
    var stored = readPendingRequest();
    if (stored) {
      if (stored.lotteryTypeId !== lotteryTypeId) {
        throw createError("REQUEST_ID_CONFLICT", "請先完成上一次轉盤結果確認。");
      }
      return stored;
    }
    var request = {
      requestId: window.MemberApi.createRequestId(),
      lotteryTypeId: lotteryTypeId,
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
        /^LTY-[A-Z0-9]{10}$/.test(parsed.lotteryTypeId)
      ) {
        pendingRequest = parsed;
        return pendingRequest;
      }
    } catch (_error) {
      // Invalid or unavailable storage is treated as empty.
    }
    return null;
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

  function returnToMemberPage() {
    var link = document.querySelector("[data-member-route]");
    window.location.assign(link ? link.href : "./");
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
      LOTTERY_ROUND_NOT_READY: "本輪尚未集滿，或本輪抽獎資格已使用。",
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
      returnToMemberPage
    );
    byId("lottery-result-dialog").addEventListener("cancel", function (event) {
      event.preventDefault();
    });
  }

  byId("current-year").textContent = String(new Date().getFullYear());
  bindInteractions();
  start();
})();
