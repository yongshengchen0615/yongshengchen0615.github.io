(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) return;

  registry.define(
    "lottery.workspace-mapper",
    ["lottery.contracts"],
    function (contracts) {
      var LOTTERY_TYPE_ID_PATTERN = /^LTY-[A-Z0-9]{10}$/;
      var LOTTERY_CONFIG_ID_PATTERN = /^LCF-[A-Z0-9]{12}$/;
      var LOTTERY_PRIZE_ID_PATTERN = /^LPR-[A-Z0-9]{10}$/;
      var LOTTERY_DRAW_ID_PATTERN = /^LDW-[A-Z0-9]{16}$/;

      function normalizePointNumber(value) {
        var number = Number(value);
        if (!Number.isSafeInteger(number) || number < 0) {
          throw contracts.createError("INVALID_RESPONSE", "點數格式不正確。");
        }
        return number;
      }

      function normalizeLotteryConfig(value, expectedTypeId) {
        value = value && typeof value === "object" ? value : {};
        var lotteryTypeId = String(value.lotteryTypeId || "").trim();
        var configVersion = String(value.configVersion || "").trim();
        var updatedAt = String(value.updatedAt || "").trim();
        var rawPrizes = Array.isArray(value.prizes) ? value.prizes : [];

        if (
          lotteryTypeId !== expectedTypeId ||
          !LOTTERY_CONFIG_ID_PATTERN.test(configVersion) ||
          Number.isNaN(new Date(updatedAt).getTime()) ||
          rawPrizes.length < 2 ||
          rawPrizes.length > 12
        ) {
          throw contracts.createError(
            "INVALID_RESPONSE",
            "轉盤設定格式不正確。"
          );
        }

        var ids = Object.create(null);
        var totalBasisPoints = 0;
        var prizes = rawPrizes.map(function (prizeValue) {
          var prize =
            prizeValue && typeof prizeValue === "object" ? prizeValue : {};
          var prizeId = String(prize.prizeId || "").trim();
          var label = String(prize.label || "").trim();
          var color = String(prize.color || "").trim().toUpperCase();
          var probability = Number(prize.probability);
          var basisPoints = Math.round(probability * 100);

          if (
            !LOTTERY_PRIZE_ID_PATTERN.test(prizeId) ||
            ids[prizeId] ||
            !label ||
            label.length > 40 ||
            !/^#[0-9A-F]{6}$/.test(color) ||
            !Number.isFinite(probability) ||
            probability <= 0 ||
            probability >= 100 ||
            Math.abs(basisPoints / 100 - probability) > 0.000001
          ) {
            throw contracts.createError(
              "INVALID_RESPONSE",
              "轉盤獎項格式不正確。"
            );
          }

          ids[prizeId] = true;
          totalBasisPoints += basisPoints;
          return Object.freeze({
            prizeId: prizeId,
            label: label,
            color: color,
            probability: probability,
          });
        });

        if (totalBasisPoints !== 10000) {
          throw contracts.createError(
            "INVALID_RESPONSE",
            "轉盤機率合計不是 100%。"
          );
        }

        return Object.freeze({
          lotteryTypeId: lotteryTypeId,
          configVersion: configVersion,
          updatedAt: updatedAt,
          prizes: Object.freeze(prizes),
        });
      }

      function normalizeLotteryTypes(value) {
        if (!Array.isArray(value) || value.length < 1) {
          throw contracts.createError(
            "INVALID_RESPONSE",
            "目前沒有可使用的轉盤類型。"
          );
        }

        var ids = Object.create(null);
        return Object.freeze(
          value.map(function (itemValue) {
            var item =
              itemValue && typeof itemValue === "object" ? itemValue : {};
            var lotteryTypeId = String(item.lotteryTypeId || "").trim();
            var name = String(item.name || "").trim();

            if (
              !LOTTERY_TYPE_ID_PATTERN.test(lotteryTypeId) ||
              ids[lotteryTypeId] ||
              !name ||
              name.length > 40
            ) {
              throw contracts.createError(
                "INVALID_RESPONSE",
                "轉盤類型格式不正確。"
              );
            }

            ids[lotteryTypeId] = true;
            return Object.freeze({
              lotteryTypeId: lotteryTypeId,
              name: name,
              lottery: normalizeLotteryConfig(item.lottery, lotteryTypeId),
            });
          })
        );
      }

      function findLotteryType(types, lotteryTypeId) {
        return (
          (Array.isArray(types) ? types : []).find(function (type) {
            return type.lotteryTypeId === String(lotteryTypeId || "");
          }) || null
        );
      }

      function isValidDate(value) {
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

      function isStrictSequence(values, maximum, allowEmpty) {
        if (!Array.isArray(values) || (!allowEmpty && values.length < 1)) {
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
        return Boolean(allowEmpty) || values[values.length - 1] === maximum;
      }

      function arraysEqual(left, right) {
        return (
          left.length === right.length &&
          left.every(function (value, index) {
            return value === right[index];
          })
        );
      }

      function normalizeCard(value, lotteryTypes) {
        value = value && typeof value === "object" ? value : {};
        var rewardMilestones = Array.isArray(value.rewardMilestones)
          ? value.rewardMilestones.map(Number)
          : [];
        var rewardRules = Array.isArray(value.rewardRules)
          ? value.rewardRules.map(function (ruleValue) {
              var rule =
                ruleValue && typeof ruleValue === "object" ? ruleValue : {};
              return Object.freeze({
                points: Number(rule.points),
                lotteryTypeId: String(rule.lotteryTypeId || "").trim(),
              });
            })
          : [];
        var reachedMilestones = Array.isArray(value.reachedMilestones)
          ? value.reachedMilestones.map(Number)
          : [];
        var availableRewards = Array.isArray(value.availableRewards)
          ? value.availableRewards.map(contracts.normalizeTicket)
          : [];
        var card = {
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
        var expectedReached = rewardMilestones.filter(function (milestone) {
          return milestone <= card.currentPoints;
        });
        var nextMilestone = rewardMilestones.find(function (milestone) {
          return milestone > card.currentPoints;
        });
        var uniqueTickets = Object.create(null);

        if (
          !/^PCS-[A-Z0-9]{12}$/.test(card.settingVersion) ||
          !Number.isInteger(card.targetPoints) ||
          card.targetPoints < 1 ||
          (card.expiryMode !== "unlimited" && card.expiryMode !== "limited") ||
          (card.expiryMode === "unlimited" && card.expiresOn) ||
          (card.expiryMode === "limited" && !isValidDate(card.expiresOn)) ||
          !isStrictSequence(rewardMilestones, card.targetPoints, false) ||
          rewardRules.length !== rewardMilestones.length ||
          rewardRules.some(function (rule, index) {
            return (
              rule.points !== rewardMilestones[index] ||
              !findLotteryType(lotteryTypes, rule.lotteryTypeId)
            );
          }) ||
          !Number.isInteger(card.currentPoints) ||
          card.currentPoints < 0 ||
          card.currentPoints >= card.targetPoints ||
          !isStrictSequence(reachedMilestones, card.currentPoints, true) ||
          !arraysEqual(reachedMilestones, expectedReached) ||
          card.nextMilestonePoints !== nextMilestone ||
          card.pointsRemaining !== nextMilestone - card.currentPoints ||
          card.pointsToCardComplete !== card.targetPoints - card.currentPoints ||
          !Number.isInteger(card.currentCardNumber) ||
          card.currentCardNumber < 1 ||
          card.currentRound !== card.currentCardNumber ||
          !Number.isInteger(card.completedCards) ||
          card.completedCards < 0 ||
          card.completedRounds !== card.completedCards ||
          !Number.isInteger(card.earnedRewards) ||
          card.earnedRewards < 0 ||
          !Number.isInteger(card.drawsUsed) ||
          card.drawsUsed < 0 ||
          card.drawsUsed > card.earnedRewards ||
          !Number.isInteger(card.availableDraws) ||
          card.availableDraws < 0 ||
          card.availableDraws > card.earnedRewards - card.drawsUsed ||
          availableRewards.length !== Math.min(card.availableDraws, 50) ||
          availableRewards.some(function (ticket) {
            if (
              uniqueTickets[ticket.cardRoundKey] ||
              !findLotteryType(lotteryTypes, ticket.lotteryTypeId)
            ) {
              return true;
            }
            uniqueTickets[ticket.cardRoundKey] = true;
            return false;
          }) ||
          !Number.isSafeInteger(card.totalPoints) ||
          card.totalPoints < 0
        ) {
          throw contracts.createError(
            "INVALID_RESPONSE",
            "集點卡進度格式不正確。"
          );
        }

        return Object.freeze({
          settingVersion: card.settingVersion,
          targetPoints: card.targetPoints,
          expiryMode: card.expiryMode,
          expiresOn: card.expiresOn,
          rewardMilestones: Object.freeze(rewardMilestones),
          rewardRules: Object.freeze(rewardRules),
          reachedMilestones: Object.freeze(reachedMilestones),
          currentPoints: card.currentPoints,
          nextMilestonePoints: card.nextMilestonePoints,
          pointsRemaining: card.pointsRemaining,
          pointsToCardComplete: card.pointsToCardComplete,
          currentCardNumber: card.currentCardNumber,
          currentRound: card.currentRound,
          completedCards: card.completedCards,
          completedRounds: card.completedRounds,
          earnedRewards: card.earnedRewards,
          drawsUsed: card.drawsUsed,
          availableDraws: card.availableDraws,
          availableRewards: Object.freeze(availableRewards),
          totalPoints: card.totalPoints,
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
          throw contracts.createError(
            "INVALID_RESPONSE",
            "後台回傳的抽獎資料格式不完整。"
          );
        }

        var lotteryTypes = normalizeLotteryTypes(value.lotteryTypes);
        var card = normalizeCard(value.card, lotteryTypes);
        var totalPoints = normalizePointNumber(
          value.totalPoints == null ? value.pointBalance : value.totalPoints
        );

        if (totalPoints !== card.totalPoints) {
          throw contracts.createError(
            "INVALID_RESPONSE",
            "累計點數與集點卡資料不一致。"
          );
        }

        return Object.freeze({
          lotteryTypes: lotteryTypes,
          card: card,
          totalPoints: totalPoints,
        });
      }

      function normalizeDraw(value, selectedType, ticket) {
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
          !LOTTERY_DRAW_ID_PATTERN.test(draw.drawId) ||
          draw.configVersion !== selectedType.lottery.configVersion ||
          draw.lotteryTypeId !== selectedType.lotteryTypeId ||
          draw.cardRoundKey !== ticket.cardRoundKey ||
          !prize ||
          prize.label !== draw.prizeLabel ||
          prize.color !== draw.prizeColor ||
          draw.pointsSpent !== 0 ||
          !Number.isSafeInteger(draw.originalPointBalance) ||
          draw.pointBalance !== draw.originalPointBalance ||
          Number.isNaN(new Date(draw.drawnAt).getTime())
        ) {
          throw contracts.createError(
            "INVALID_RESPONSE",
            "後台回傳的抽獎結果格式不正確。"
          );
        }

        return Object.freeze(draw);
      }

      function normalizeDrawResult(dataValue, workspace, ticket) {
        var data =
          dataValue && typeof dataValue === "object" ? dataValue : {};
        if (!data.draw || !data.lottery || !data.lotteryType || !data.card) {
          throw contracts.createError(
            "INVALID_RESPONSE",
            "後台回傳的抽獎結果格式不完整。"
          );
        }

        var resultTypes = normalizeLotteryTypes([data.lotteryType]);
        var selectedType = resultTypes[0];
        if (selectedType.lotteryTypeId !== ticket.lotteryTypeId) {
          throw contracts.createError(
            "INVALID_RESPONSE",
            "抽獎結果與選擇的轉盤類型不一致。"
          );
        }

        var resultLottery = normalizeLotteryConfig(
          data.lottery,
          selectedType.lotteryTypeId
        );
        if (JSON.stringify(resultLottery) !== JSON.stringify(selectedType.lottery)) {
          throw contracts.createError(
            "INVALID_RESPONSE",
            "抽獎結果使用了不一致的轉盤設定。"
          );
        }

        var nextTypes = workspace.lotteryTypes
          .filter(function (type) {
            return type.lotteryTypeId !== selectedType.lotteryTypeId;
          })
          .concat(selectedType);
        var nextCard = normalizeCard(data.card, nextTypes);
        var draw = normalizeDraw(data.draw, selectedType, ticket);
        var totalPoints = normalizePointNumber(
          data.totalPoints == null ? data.pointBalance : data.totalPoints
        );

        if (
          totalPoints !== draw.pointBalance ||
          nextCard.totalPoints !== draw.pointBalance
        ) {
          throw contracts.createError(
            "INVALID_RESPONSE",
            "抽獎前後累計點數不一致。"
          );
        }

        return Object.freeze({
          selectedType: selectedType,
          draw: draw,
          card: nextCard,
          totalPoints: totalPoints,
          lotteryTypes: Object.freeze(nextTypes),
        });
      }

      function formatNumber(value) {
        return normalizePointNumber(value).toLocaleString("zh-TW");
      }

      return Object.freeze({
        normalizePointNumber: normalizePointNumber,
        normalizeLotteryTypes: normalizeLotteryTypes,
        normalizeLotteryConfig: normalizeLotteryConfig,
        normalizeWorkspace: normalizeWorkspace,
        normalizeDrawResult: normalizeDrawResult,
        findLotteryType: findLotteryType,
        formatNumber: formatNumber,
      });
    }
  );
})(window);
