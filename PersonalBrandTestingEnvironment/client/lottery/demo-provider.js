(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) return;

  registry.define(
    "lottery.demo-provider",
    ["lottery.contracts", "lottery.workspace-mapper"],
    function (contracts, mapper) {
      function create(options) {
        options = options && typeof options === "object" ? options : {};
        var runtime = options.root || root;
        var getSummary =
          typeof options.getCurrentCardSummary === "function"
            ? options.getCurrentCardSummary
            : function () {
                return null;
              };
        var getTotalPoints =
          typeof options.getCurrentTotalPoints === "function"
            ? options.getCurrentTotalPoints
            : function () {
                return 0;
              };

        function normalizeSummary(value) {
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
              ? value.rewardRules.map(function (ruleValue) {
                  var rule =
                    ruleValue && typeof ruleValue === "object"
                      ? ruleValue
                      : {};
                  return {
                    points: Number(rule.points),
                    lotteryTypeId: String(rule.lotteryTypeId || "").trim(),
                  };
                })
              : [],
            availableRewards: Array.isArray(value.availableRewards)
              ? value.availableRewards.map(contracts.normalizeTicket)
              : [],
          };
          var ticketKeys = Object.create(null);

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
                (index > 0 && rule.points <= summary.rewardRules[index - 1].points) ||
                !/^LTY-[A-Z0-9]{10}$/.test(rule.lotteryTypeId)
              );
            }) ||
            summary.rewardRules[summary.rewardRules.length - 1].points !==
              summary.targetPoints ||
            summary.availableRewards.length !==
              Math.min(summary.availableDraws, 50) ||
            summary.availableRewards.some(function (ticket) {
              if (ticketKeys[ticket.cardRoundKey]) return true;
              ticketKeys[ticket.cardRoundKey] = true;
              return false;
            }) ||
            (summary.expiryMode !== "unlimited" &&
              summary.expiryMode !== "limited") ||
            (summary.expiryMode === "unlimited" && summary.expiresOn)
          ) {
            throw contracts.createError(
              "INVALID_RESPONSE",
              "展示用集點卡摘要格式不正確。"
            );
          }
          return summary;
        }

        function createLotteryType(typeId, typeIndex, selectedTypeId) {
          var offset = typeIndex * 4;
          var prizes = [
            {
              prizeId: "LPR-DEMO" + String(offset + 1).padStart(6, "0"),
              label: "再接再厲",
              color: "#D9D6CC",
              probability: 55,
            },
            {
              prizeId: "LPR-DEMO" + String(offset + 2).padStart(6, "0"),
              label: "會員小禮",
              color: "#8DCCAA",
              probability: 25,
            },
            {
              prizeId: "LPR-DEMO" + String(offset + 3).padStart(6, "0"),
              label: "精選好禮",
              color: "#F0C36A",
              probability: 15,
            },
            {
              prizeId: "LPR-DEMO" + String(offset + 4).padStart(6, "0"),
              label: "本輪頭獎",
              color: "#0B3C2C",
              probability: 5,
            },
          ];
          return {
            lotteryTypeId: typeId,
            name:
              typeId === selectedTypeId
                ? "會員幸運轉盤"
                : "節點轉盤 " + mapper.formatNumber(typeIndex + 1),
            lottery: {
              lotteryTypeId: typeId,
              configVersion:
                "LCF-DEMO" + String(typeIndex + 1).padStart(8, "0"),
              updatedAt: "2026-01-01T00:00:00.000Z",
              prizes: prizes,
            },
          };
        }

        function buildWorkspace(ticket) {
          var summary = normalizeSummary(getSummary());
          var typeIds = summary.rewardRules
            .map(function (rule) {
              return rule.lotteryTypeId;
            })
            .concat(
              summary.availableRewards.map(function (reward) {
                return reward.lotteryTypeId;
              })
            )
            .concat(ticket.lotteryTypeId)
            .filter(function (typeId, index, values) {
              return values.indexOf(typeId) === index;
            });
          var lotteryTypes = typeIds.map(function (typeId, index) {
            return createLotteryType(typeId, index, ticket.lotteryTypeId);
          });
          var totalPoints = mapper.normalizePointNumber(getTotalPoints());
          var rewardMilestones = summary.rewardRules.map(function (rule) {
            return rule.points;
          });
          var reachedMilestones = rewardMilestones.filter(function (milestone) {
            return milestone <= summary.currentPoints;
          });
          var completedCards = Math.max(0, summary.currentCardNumber - 1);
          var earnedRewards =
            completedCards * rewardMilestones.length + reachedMilestones.length;
          earnedRewards = Math.max(earnedRewards, summary.availableDraws);
          var drawsUsed = Math.max(0, earnedRewards - summary.availableDraws);
          var nextMilestone = rewardMilestones.find(function (milestone) {
            return milestone > summary.currentPoints;
          });

          return {
            access: { allowed: true, status: "approved" },
            lotteryTypes: lotteryTypes,
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
              pointsToCardComplete: summary.targetPoints - summary.currentPoints,
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
          };
        }

        function copyCard(card) {
          return JSON.parse(JSON.stringify(card));
        }

        function stableHash(value) {
          var hash = 2166136261;
          String(value || "")
            .split("")
            .forEach(function (character) {
              hash ^= character.charCodeAt(0);
              hash = Math.imul(hash, 16777619);
            });
          return hash >>> 0;
        }

        function createDrawResponse(workspace, ticket) {
          var selectedType = workspace.lotteryTypes.find(function (type) {
            return type.lotteryTypeId === ticket.lotteryTypeId;
          });
          if (!selectedType) {
            throw contracts.createError(
              "LOTTERY_TYPE_NOT_FOUND",
              "展示轉盤類型不存在。"
            );
          }
          var prize =
            selectedType.lottery.prizes[
              stableHash(ticket.cardRoundKey) % selectedType.lottery.prizes.length
            ];
          var nextCard = copyCard(workspace.card);
          var available = nextCard.availableRewards.some(function (reward) {
            return reward.cardRoundKey === ticket.cardRoundKey;
          });
          if (!available) {
            throw contracts.createError(
              "LOTTERY_ROUND_NOT_READY",
              "這張展示抽獎券已使用。"
            );
          }
          nextCard.drawsUsed += 1;
          nextCard.availableDraws -= 1;
          nextCard.availableRewards = nextCard.availableRewards.filter(function (
            reward
          ) {
            return reward.cardRoundKey !== ticket.cardRoundKey;
          });

          return {
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
                originalPointBalance: workspace.totalPoints,
                pointBalance: workspace.totalPoints,
                cardRoundKey: ticket.cardRoundKey,
                drawnAt: "2026-01-01T00:00:00.000Z",
              },
              card: nextCard,
              pointBalance: workspace.totalPoints,
              totalPoints: workspace.totalPoints,
            },
          };
        }

        function prepare(ticketValue) {
          var ticket = contracts.normalizeTicket(ticketValue);
          var workspace = buildWorkspace(ticket);
          return new Promise(function (resolve) {
            runtime.setTimeout(function () {
              resolve({ ok: true, data: workspace });
            }, 120);
          });
        }

        function draw(ticketValue, workspaceValue, store) {
          var ticket = contracts.normalizeTicket(ticketValue);
          if (!store || typeof store.ensure !== "function") {
            return Promise.reject(
              contracts.createError(
                "INVALID_CONFIGURATION",
                "展示抽獎缺少 pending request store。"
              )
            );
          }
          store.ensure(ticket);
          return new Promise(function (resolve, reject) {
            runtime.setTimeout(function () {
              try {
                resolve(createDrawResponse(workspaceValue, ticket));
              } catch (error) {
                reject(error);
              }
            }, 80);
          });
        }

        return Object.freeze({ prepare: prepare, draw: draw });
      }

      return Object.freeze({ create: create });
    }
  );
})(window);
