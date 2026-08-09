(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before member-lottery-v2.js.");
  }

  var PREPARED_STORAGE_PREFIX = "persona-member-lottery-prepared:";
  var REQUEST_STORAGE_PREFIX = "persona-member-lottery-round-request:";
  var PREPARED_STORAGE_VERSION = 1;
  var MAX_PREPARED_DRAWS = 50;
  var MEMBER_ID_PATTERN = /^MBR-[A-Z0-9]{10}$/;
  var LOTTERY_TYPE_ID_PATTERN = /^LTY-[A-Z0-9]{10}$/;
  var CARD_ROUND_KEY_PATTERN =
    /^PCS-[A-Z0-9]{12}:[1-9]\d{0,15}:[1-9]\d{0,3}$/;
  var REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{10,80}$/;

  var ticketRefreshUiVersion = 0;

  function isDialogOpen(dialog) {
    if (!dialog) return false;
    if (dialog.open === true) return true;
    return Boolean(
      typeof dialog.hasAttribute === "function" && dialog.hasAttribute("open")
    );
  }

  function schedule(callback) {
    if (typeof root.setTimeout === "function") {
      root.setTimeout(callback, 0);
      return;
    }
    Promise.resolve().then(callback);
  }

  function scheduleTicketRefreshUi(detail) {
    detail = detail && typeof detail === "object" ? detail : {};
    var state = String(detail.state || "");
    if (state !== "loading" && state !== "ready" && state !== "error") {
      return;
    }
    if (detail.source !== "network" || detail.current === false) return;

    var version = ++ticketRefreshUiVersion;
    schedule(function () {
      if (version !== ticketRefreshUiVersion) return;
      var documentValue = root.document;
      if (!documentValue || typeof documentValue.getElementById !== "function") {
        return;
      }

      var dialog = documentValue.getElementById("member-ticket-dialog");
      var status = documentValue.getElementById("member-ticket-refresh-status");
      if (!dialog || !status || !isDialogOpen(dialog)) return;

      if (state === "loading") {
        dialog.setAttribute("aria-busy", "true");
        status.textContent = "正在整理登入時預載的抽獎資料…";
        status.dataset.tone = "loading";
        return;
      }

      dialog.setAttribute("aria-busy", "false");
      if (state === "ready") {
        status.textContent =
          "抽獎資料已完成登入預載；開券與轉盤動畫不會再呼叫後端。";
        status.dataset.tone = "ready";
        return;
      }

      status.textContent =
        "登入預載暫時失敗；為避免抽獎途中連線，請重新整理後再試。";
      status.dataset.tone = "warning";
    });
  }

  if (typeof root.addEventListener === "function") {
    root.addEventListener("persona:lottery-workspace-state", function (event) {
      scheduleTicketRefreshUi(event && event.detail);
    });
  }

  function createPreparedFacade(controllerFactory) {
    var inner = controllerFactory.create({
      root: root,
      document: root.document,
      memberApi: root.MemberApi,
      wheelRenderer: root.LotteryWheel,
    });

    var configured = false;
    var options = null;
    var sourceRequest = null;
    var sourceCardUpdated = null;
    var preparedEntries = [];
    var preparedMemberId = "";
    var workspaceResponse = null;
    var backendCard = null;
    var preloadPromise = null;
    var preparedReady = false;

    function createError(code, message) {
      var error = new Error(message);
      error.code = code;
      return error;
    }

    function safeIsDemo() {
      try {
        return Boolean(options && options.isDemo && options.isDemo() === true);
      } catch (_error) {
        return false;
      }
    }

    function currentMemberId() {
      if (!options || typeof options.getMemberId !== "function") return "";
      try {
        var value = String(options.getMemberId() || "").trim();
        return MEMBER_ID_PATTERN.test(value) ? value : "";
      } catch (_error) {
        return "";
      }
    }

    function liffId() {
      return String((options && options.liffId) || "unknown").trim() || "unknown";
    }

    function ticketKey(ticket) {
      return ticket
        ? String(ticket.cardRoundKey || "") +
            "|" +
            String(ticket.lotteryTypeId || "")
        : "";
    }

    function normalizeTicket(value) {
      value = value && typeof value === "object" ? value : {};
      var ticket = {
        settingVersion: String(value.settingVersion || "").trim(),
        cardNumber: Number(value.cardNumber),
        milestonePoints: Number(value.milestonePoints),
        lotteryTypeId: String(value.lotteryTypeId || "").trim(),
        cardRoundKey: String(value.cardRoundKey || "").trim(),
      };
      if (
        !CARD_ROUND_KEY_PATTERN.test(ticket.cardRoundKey) ||
        !LOTTERY_TYPE_ID_PATTERN.test(ticket.lotteryTypeId) ||
        !Number.isInteger(ticket.cardNumber) ||
        ticket.cardNumber < 1 ||
        !Number.isInteger(ticket.milestonePoints) ||
        ticket.milestonePoints < 1
      ) {
        throw createError(
          "INVALID_LOTTERY_TICKET",
          "登入預載的抽獎券格式不正確。"
        );
      }
      return ticket;
    }

    function preparedStorageKey(memberId) {
      return memberId
        ? PREPARED_STORAGE_PREFIX + liffId() + ":" + memberId
        : "";
    }

    function pendingStorageKey(memberId) {
      return memberId
        ? REQUEST_STORAGE_PREFIX + liffId() + ":" + memberId
        : "";
    }

    function isPreparedEntryValid(entry) {
      if (!entry || typeof entry !== "object") return false;
      try {
        var ticket = normalizeTicket(entry.ticket);
        var draw = entry.draw && typeof entry.draw === "object" ? entry.draw : {};
        var type =
          entry.lotteryType && typeof entry.lotteryType === "object"
            ? entry.lotteryType
            : {};
        var lottery =
          type.lottery && typeof type.lottery === "object" ? type.lottery : {};
        var pendingRequestId = String(entry.pendingRequestId || "");
        return Boolean(
          String(draw.cardRoundKey || "") === ticket.cardRoundKey &&
            String(draw.lotteryTypeId || "") === ticket.lotteryTypeId &&
            String(type.lotteryTypeId || "") === ticket.lotteryTypeId &&
            String(lottery.lotteryTypeId || "") === ticket.lotteryTypeId &&
            Array.isArray(lottery.prizes) &&
            lottery.prizes.length >= 2 &&
            Number.isSafeInteger(Number(entry.totalPoints)) &&
            Number(entry.totalPoints) >= 0 &&
            (!pendingRequestId || REQUEST_ID_PATTERN.test(pendingRequestId))
        );
      } catch (_error) {
        return false;
      }
    }

    function restorePreparedEntries(memberId) {
      preparedEntries = [];
      if (!memberId || !root.sessionStorage) return;
      try {
        var raw = root.sessionStorage.getItem(preparedStorageKey(memberId));
        if (!raw) return;
        var parsed = JSON.parse(raw);
        if (
          !parsed ||
          parsed.version !== PREPARED_STORAGE_VERSION ||
          String(parsed.memberId || "") !== memberId ||
          !Array.isArray(parsed.entries)
        ) {
          root.sessionStorage.removeItem(preparedStorageKey(memberId));
          return;
        }
        preparedEntries = parsed.entries
          .filter(isPreparedEntryValid)
          .slice(0, MAX_PREPARED_DRAWS)
          .map(function (entry) {
            return {
              ticket: normalizeTicket(entry.ticket),
              draw: entry.draw,
              lotteryType: entry.lotteryType,
              totalPoints: Number(entry.totalPoints),
              pendingRequestId: String(entry.pendingRequestId || ""),
            };
          });
      } catch (_error) {
        preparedEntries = [];
        try {
          root.sessionStorage.removeItem(preparedStorageKey(memberId));
        } catch (_storageError) {
          // Storage may be unavailable in privacy-restricted browsers.
        }
      }
    }

    function persistPreparedEntries() {
      if (!preparedMemberId || !root.sessionStorage) return;
      try {
        var key = preparedStorageKey(preparedMemberId);
        if (!preparedEntries.length) {
          root.sessionStorage.removeItem(key);
          return;
        }
        root.sessionStorage.setItem(
          key,
          JSON.stringify({
            version: PREPARED_STORAGE_VERSION,
            memberId: preparedMemberId,
            entries: preparedEntries,
          })
        );
      } catch (_error) {
        // Memory cache still supports the current page lifetime.
      }
    }

    function readLegacyPending(memberId) {
      if (!memberId || !root.sessionStorage) return null;
      try {
        var raw = root.sessionStorage.getItem(pendingStorageKey(memberId));
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        if (
          !parsed ||
          !REQUEST_ID_PATTERN.test(String(parsed.requestId || "")) ||
          !CARD_ROUND_KEY_PATTERN.test(String(parsed.cardRoundKey || "")) ||
          !LOTTERY_TYPE_ID_PATTERN.test(String(parsed.lotteryTypeId || ""))
        ) {
          return null;
        }
        return parsed;
      } catch (_error) {
        return null;
      }
    }

    function findPrepared(ticket) {
      var key = ticketKey(ticket);
      for (var index = 0; index < preparedEntries.length; index += 1) {
        if (ticketKey(preparedEntries[index].ticket) === key) {
          return preparedEntries[index];
        }
      }
      return null;
    }

    function mergeLotteryType(lotteryType) {
      if (
        !workspaceResponse ||
        !workspaceResponse.data ||
        !lotteryType ||
        typeof lotteryType !== "object"
      ) {
        return;
      }
      var id = String(lotteryType.lotteryTypeId || "");
      if (!id) return;
      var previous = Array.isArray(workspaceResponse.data.lotteryTypes)
        ? workspaceResponse.data.lotteryTypes
        : [];
      var replaced = false;
      var next = previous.map(function (type) {
        if (String((type && type.lotteryTypeId) || "") !== id) return type;
        replaced = true;
        return lotteryType;
      });
      if (!replaced) next.push(lotteryType);
      workspaceResponse = Object.assign({}, workspaceResponse, {
        data: Object.assign({}, workspaceResponse.data, {
          lotteryTypes: next,
        }),
      });
    }

    function virtualTickets(excludedKey) {
      return preparedEntries
        .filter(function (entry) {
          return ticketKey(entry.ticket) !== String(excludedKey || "");
        })
        .map(function (entry) {
          return Object.assign({}, entry.ticket);
        });
    }

    function buildVirtualCard(excludedKey) {
      var source =
        (backendCard && typeof backendCard === "object" ? backendCard : null) ||
        (workspaceResponse &&
        workspaceResponse.data &&
        workspaceResponse.data.card
          ? workspaceResponse.data.card
          : null) ||
        (options &&
        typeof options.getCurrentCardSummary === "function"
          ? options.getCurrentCardSummary()
          : null);
      if (!source || typeof source !== "object") return source || null;

      var card = Object.assign({}, source);
      var tickets = virtualTickets(excludedKey);
      card.availableRewards = tickets;
      card.availableDraws = tickets.length;
      var earnedRewards = Number(card.earnedRewards);
      if (Number.isInteger(earnedRewards) && earnedRewards >= tickets.length) {
        card.drawsUsed = earnedRewards - tickets.length;
      }
      return card;
    }

    function buildWorkspaceResponse() {
      if (!workspaceResponse || !workspaceResponse.data) {
        throw createError(
          "LOTTERY_SESSION_NOT_READY",
          "登入預載尚未完成，無法開啟抽獎券。"
        );
      }
      var data = workspaceResponse.data;
      var totalPoints = Number(
        data.totalPoints == null ? data.pointBalance : data.totalPoints
      );
      return Object.assign({}, workspaceResponse, {
        data: Object.assign({}, data, {
          card: buildVirtualCard(""),
          pointBalance: totalPoints,
          totalPoints: totalPoints,
          canDraw: preparedEntries.length > 0,
        }),
      });
    }

    function compactPrepared(ticket, response, pendingRequestId) {
      if (
        !response ||
        response.ok !== true ||
        !response.data ||
        !response.data.draw ||
        !response.data.lotteryType ||
        !response.data.lotteryType.lottery ||
        !response.data.card
      ) {
        throw createError(
          "INVALID_RESPONSE",
          "登入預抽獎回傳資料不完整。"
        );
      }
      var normalizedTicket = normalizeTicket(ticket);
      var data = response.data;
      if (
        String(data.draw.cardRoundKey || "") !== normalizedTicket.cardRoundKey ||
        String(data.draw.lotteryTypeId || "") !==
          normalizedTicket.lotteryTypeId ||
        String(data.lotteryType.lotteryTypeId || "") !==
          normalizedTicket.lotteryTypeId
      ) {
        throw createError(
          "INVALID_RESPONSE",
          "登入預抽獎結果與抽獎券不一致。"
        );
      }
      var totalPoints = Number(
        data.totalPoints == null ? data.pointBalance : data.totalPoints
      );
      if (!Number.isSafeInteger(totalPoints) || totalPoints < 0) {
        throw createError(
          "INVALID_RESPONSE",
          "登入預抽獎點數格式不正確。"
        );
      }
      return {
        ticket: normalizedTicket,
        draw: data.draw,
        lotteryType: data.lotteryType,
        totalPoints: totalPoints,
        pendingRequestId: String(pendingRequestId || ""),
      };
    }

    function upsertPrepared(entry) {
      var key = ticketKey(entry.ticket);
      var replaced = false;
      preparedEntries = preparedEntries.map(function (existing) {
        if (ticketKey(existing.ticket) !== key) return existing;
        replaced = true;
        return entry;
      });
      if (!replaced) preparedEntries.push(entry);
      preparedEntries = preparedEntries.slice(0, MAX_PREPARED_DRAWS);
      mergeLotteryType(entry.lotteryType);
      persistPreparedEntries();
    }

    function createPredrawRequestId() {
      if (
        root.MemberApi &&
        typeof root.MemberApi.createRequestId === "function"
      ) {
        var requestId = String(root.MemberApi.createRequestId() || "").trim();
        if (REQUEST_ID_PATTERN.test(requestId)) return requestId;
      }
      throw createError(
        "CLIENT_LIBRARY_ERROR",
        "無法建立登入預抽獎請求識別碼。"
      );
    }

    function predraw(ticket, requestId, pendingRequestId) {
      var normalizedTicket = normalizeTicket(ticket);
      return Promise.resolve(
        sourceRequest(
          "drawLottery",
          {
            lotteryTypeId: normalizedTicket.lotteryTypeId,
            cardRoundKey: normalizedTicket.cardRoundKey,
          },
          requestId
        )
      ).then(function (response) {
        if (currentMemberId() !== preparedMemberId) {
          throw createError(
            "LOTTERY_SESSION_CHANGED",
            "會員狀態已變更，請重新載入抽獎資料。"
          );
        }
        var entry = compactPrepared(
          normalizedTicket,
          response,
          pendingRequestId
        );
        backendCard = response.data.card;
        upsertPrepared(entry);
        return response;
      });
    }

    function prepareWorkspace() {
      if (safeIsDemo()) return Promise.resolve(null);

      var memberId = currentMemberId();
      if (!memberId) {
        return Promise.reject(
          createError(
            "LOTTERY_MEMBER_NOT_READY",
            "會員登入尚未完成，無法準備抽獎結果。"
          )
        );
      }
      if (preparedReady && preparedMemberId === memberId) {
        return Promise.resolve(buildVirtualCard(""));
      }
      if (preloadPromise && preparedMemberId === memberId) {
        return preloadPromise;
      }

      preparedMemberId = memberId;
      preparedReady = false;
      workspaceResponse = null;
      backendCard = null;
      restorePreparedEntries(memberId);

      var promise = Promise.resolve(
        sourceRequest("getLotteryConfig", {}, undefined)
      )
        .then(function (response) {
          if (!response || response.ok !== true || !response.data) {
            throw createError(
              "INVALID_RESPONSE",
              "登入預載的抽獎設定格式不完整。"
            );
          }
          if (currentMemberId() !== memberId) {
            throw createError(
              "LOTTERY_SESSION_CHANGED",
              "會員狀態已變更，請重新載入抽獎資料。"
            );
          }
          workspaceResponse = response;
          backendCard = response.data.card || null;
          preparedEntries.forEach(function (entry) {
            mergeLotteryType(entry.lotteryType);
          });

          var legacyPending = readLegacyPending(memberId);
          var chain = Promise.resolve();
          if (legacyPending && !findPrepared(legacyPending)) {
            chain = chain.then(function () {
              return predraw(
                legacyPending,
                String(legacyPending.requestId),
                String(legacyPending.requestId)
              );
            });
          } else if (legacyPending) {
            var existing = findPrepared(legacyPending);
            if (
              existing.pendingRequestId &&
              existing.pendingRequestId !== String(legacyPending.requestId)
            ) {
              throw createError(
                "REQUEST_ID_CONFLICT",
                "舊版待確認抽獎與預載結果不一致。"
              );
            }
            existing.pendingRequestId = String(legacyPending.requestId);
            persistPreparedEntries();
          }

          var rewards =
            response.data.card &&
            Array.isArray(response.data.card.availableRewards)
              ? response.data.card.availableRewards
              : [];
          rewards.slice(0, MAX_PREPARED_DRAWS).forEach(function (ticket) {
            if (legacyPending && ticketKey(ticket) === ticketKey(legacyPending)) {
              return;
            }
            if (findPrepared(ticket)) return;
            chain = chain.then(function () {
              return predraw(ticket, createPredrawRequestId(), "");
            });
          });

          return chain;
        })
        .then(function () {
          preparedReady = true;
          var card = buildVirtualCard("");
          var totalPoints =
            workspaceResponse && workspaceResponse.data
              ? Number(
                  workspaceResponse.data.totalPoints == null
                    ? workspaceResponse.data.pointBalance
                    : workspaceResponse.data.totalPoints
                )
              : 0;
          sourceCardUpdated(card, totalPoints);
          return card;
        })
        .finally(function () {
          if (preloadPromise === promise) preloadPromise = null;
        });

      preloadPromise = promise;
      return promise;
    }

    function finalizePreparedFromCard(card) {
      if (!card || !Array.isArray(card.availableRewards)) return;
      var available = Object.create(null);
      card.availableRewards.forEach(function (ticket) {
        available[ticketKey(ticket)] = true;
      });
      var changed = false;
      preparedEntries = preparedEntries.filter(function (entry) {
        if (!entry.pendingRequestId) return true;
        if (available[ticketKey(entry.ticket)]) return true;
        changed = true;
        return false;
      });
      if (changed) persistPreparedEntries();
    }

    function localRequest(action, fields, requestId) {
      if (action === "getLotteryConfig" && !safeIsDemo()) {
        try {
          return Promise.resolve(buildWorkspaceResponse());
        } catch (error) {
          return Promise.reject(error);
        }
      }

      if (action === "drawLottery" && !safeIsDemo()) {
        fields = fields && typeof fields === "object" ? fields : {};
        var key =
          String(fields.cardRoundKey || "") +
          "|" +
          String(fields.lotteryTypeId || "");
        var entry = findPrepared(fields);
        if (!entry) {
          return Promise.reject(
            createError(
              "LOTTERY_PREPARED_DRAW_NOT_FOUND",
              "這張抽獎券沒有登入時預先準備的結果，請重新整理後再試。"
            )
          );
        }
        var normalizedRequestId = String(requestId || "").trim();
        if (!REQUEST_ID_PATTERN.test(normalizedRequestId)) {
          return Promise.reject(
            createError("INVALID_REQUEST_ID", "揭曉請求識別碼格式不正確。")
          );
        }
        if (
          entry.pendingRequestId &&
          entry.pendingRequestId !== normalizedRequestId
        ) {
          return Promise.reject(
            createError(
              "REQUEST_ID_CONFLICT",
              "同一張預抽獎券不可更換揭曉請求識別碼。"
            )
          );
        }
        entry.pendingRequestId = normalizedRequestId;
        persistPreparedEntries();

        var totalPoints = Number(entry.totalPoints);
        return Promise.resolve({
          ok: true,
          requestId: normalizedRequestId,
          data: {
            access:
              (workspaceResponse &&
                workspaceResponse.data &&
                workspaceResponse.data.access) ||
              { allowed: true },
            duplicate: true,
            draw: entry.draw,
            lottery: entry.lotteryType.lottery,
            lotteryType: entry.lotteryType,
            card: buildVirtualCard(key),
            pointBalance: totalPoints,
            totalPoints: totalPoints,
          },
        });
      }

      return sourceRequest(action, fields, requestId);
    }

    function configure(value) {
      value = value && typeof value === "object" ? value : {};
      if (typeof value.request !== "function") {
        throw createError(
          "INVALID_CONFIGURATION",
          "MemberLotteryDialog 需要 request(action, fields, requestId)。"
        );
      }

      sourceRequest = value.request;
      sourceCardUpdated =
        typeof value.onCardUpdated === "function"
          ? value.onCardUpdated
          : function () {};
      options = value;
      configured = true;
      preparedEntries = [];
      preparedMemberId = "";
      workspaceResponse = null;
      backendCard = null;
      preloadPromise = null;
      preparedReady = false;

      inner.configure(
        Object.assign({}, value, {
          request: localRequest,
          onCardUpdated: function (card, totalPoints) {
            finalizePreparedFromCard(card);
            sourceCardUpdated(card, totalPoints);
          },
        })
      );
      return facade;
    }

    function ensureConfigured() {
      if (!configured) {
        throw createError("NOT_CONFIGURED", "請先設定 MemberLotteryDialog。");
      }
    }

    function refreshTickets() {
      ensureConfigured();
      if (safeIsDemo()) return inner.refreshTickets({ force: true });
      return prepareWorkspace();
    }

    function prepareForOpen(ticket) {
      ensureConfigured();
      if (!safeIsDemo() && !preparedReady) {
        return Promise.reject(
          createError(
            "LOTTERY_SESSION_NOT_READY",
            "登入預抽獎尚未完成，請重新整理後再試。"
          )
        );
      }
      if (!safeIsDemo() && !findPrepared(ticket)) {
        return Promise.reject(
          createError(
            "LOTTERY_PREPARED_DRAW_NOT_FOUND",
            "這張抽獎券沒有可揭曉的預抽結果。"
          )
        );
      }
      return inner.prepareForOpen(ticket);
    }

    function open(ticket) {
      ensureConfigured();
      return inner.open(ticket);
    }

    function restorePending() {
      ensureConfigured();
      if (!safeIsDemo() && !preparedReady) return Promise.resolve(false);
      return inner.restorePending();
    }

    function hasPending() {
      return inner.hasPending();
    }

    function canClose() {
      return inner.canClose();
    }

    function requestClose(closeOptions) {
      return inner.requestClose(closeOptions);
    }

    var facade = Object.freeze({
      configure: configure,
      prepareForOpen: prepareForOpen,
      open: open,
      refreshTickets: refreshTickets,
      restorePending: restorePending,
      hasPending: hasPending,
      canClose: canClose,
      requestClose: requestClose,
    });

    return facade;
  }

  var controllerFactory = registry.get("lottery.dialog-controller");
  root.MemberLotteryDialog = createPreparedFacade(controllerFactory);
})(window);
