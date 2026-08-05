(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) return;

  registry.define(
    "lottery.dialog-view",
    ["lottery.contracts", "lottery.workspace-mapper"],
    function (contracts, mapper) {
      var STATE_IDS = [
        "member-lottery-loading-state",
        "member-lottery-error-state",
        "member-lottery-wheel-state",
        "member-lottery-result-state",
      ];
      var REQUIRED_IDS = [
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

      function create(options) {
        options = options && typeof options === "object" ? options : {};
        var runtime = options.root || root;
        var documentValue = options.document || runtime.document;
        var normalizeError =
          typeof options.normalizeError === "function"
            ? options.normalizeError
            : function (errorValue) {
                return {
                  code: String(
                    (errorValue && (errorValue.code || errorValue.name)) ||
                      "CONNECTION_ERROR"
                  ),
                  message: String(
                    (errorValue && errorValue.message) ||
                      "目前無法載入轉盤，請稍後再試。"
                  ),
                };
              };
        var handlers = null;
        var bound = false;
        var hostCloseAllowed = false;

        function byId(id) {
          return documentValue.getElementById(id);
        }

        function assertReady() {
          var missing = REQUIRED_IDS.filter(function (id) {
            return !byId(id);
          });
          if (missing.length) {
            throw contracts.createError(
              "MISSING_LOTTERY_DIALOG",
              "轉盤視窗缺少必要元件：" + missing.join(", ")
            );
          }
        }

        function setText(id, value) {
          var element = byId(id);
          if (element) element.textContent = String(value == null ? "" : value);
        }

        function setButtonLabel(button, label) {
          if (!button) return;
          var labelElement = button.querySelector("span");
          if (labelElement) labelElement.textContent = label;
          else button.textContent = label;
        }

        function setState(activeId) {
          STATE_IDS.forEach(function (id) {
            byId(id).hidden = id !== activeId;
          });
          var descriptions = {
            "member-lottery-loading-state": "正在確認抽獎券、獎項與抽獎結果。",
            "member-lottery-error-state": "轉盤目前無法使用，請查看錯誤內容。",
            "member-lottery-wheel-state": "轉盤已就緒，可點選中央揭曉結果。",
            "member-lottery-result-state": "抽獎結果已顯示。",
          };
          setText(
            "member-lottery-dialog-description",
            descriptions[activeId] || "轉盤抽獎視窗。"
          );
        }

        function showDialog() {
          var dialog = byId("member-lottery-dialog");
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

        function closeDialog() {
          var dialog = byId("member-lottery-dialog");
          hostCloseAllowed = true;
          if (typeof dialog.close === "function" && dialog.open) {
            dialog.close();
          } else {
            dialog.removeAttribute("open");
            hostCloseAllowed = false;
          }
        }

        function allowHostClose() {
          hostCloseAllowed = true;
        }

        function focus(element) {
          if (!element || typeof element.focus !== "function") return;
          runtime.requestAnimationFrame(function () {
            try {
              element.focus({ preventScroll: true });
            } catch (_error) {
              element.focus();
            }
          });
        }

        function renderHeading(ticket, typeName) {
          if (!ticket) return;
          setText("member-lottery-name", typeName || "準備轉盤");
          setText(
            "member-lottery-ticket-detail",
            "第 " +
              mapper.formatNumber(ticket.cardNumber) +
              " 張集點卡 · " +
              mapper.formatNumber(ticket.milestonePoints) +
              " 點節點抽獎券"
          );
        }

        function markPreparing(ticket, typeName) {
          showDialog();
          if (ticket) {
            renderHeading(ticket, typeName);
          } else {
            setText("member-lottery-name", typeName || "準備轉盤");
            setText("member-lottery-ticket-detail", "正在確認抽獎券。");
          }
          setState("member-lottery-loading-state");
          byId("member-lottery-dialog").setAttribute("aria-busy", "true");
          setStatus("正在準備轉盤，確認最新獎項與本次抽獎結果…");
        }

        function markReady(ticket, selectedType, pending) {
          renderHeading(ticket, selectedType && selectedType.name);
          byId("member-lottery-dialog").setAttribute("aria-busy", "false");
          setState("member-lottery-wheel-state");
          setStatus(
            pending
              ? "上次結果尚未確認，點選中央直接揭曉結果。"
              : "轉盤已就緒，點選中央直接揭曉結果。"
          );
          focus(byId("member-lottery-spin-button"));
        }

        function setStatus(message) {
          setText("member-lottery-spin-status", message);
        }

        function showError(errorValue) {
          var normalized = normalizeError(errorValue);
          byId("member-lottery-dialog").setAttribute("aria-busy", "false");
          setText(
            "member-lottery-error-code",
            String(normalized.code || "CONNECTION_ERROR").replace(/_/g, " ")
          );
          setText(
            "member-lottery-error-message",
            normalized.message || "目前無法載入轉盤。"
          );
          setState("member-lottery-error-state");
        }

        function showResult(draw, selectedType) {
          setText("member-lottery-result-prize", draw.prizeLabel);
          setText(
            "member-lottery-result-before",
            mapper.formatNumber(draw.originalPointBalance)
          );
          setText(
            "member-lottery-result-balance",
            mapper.formatNumber(draw.pointBalance)
          );
          setText(
            "member-lottery-result-detail",
            selectedType.name + " · 不扣點，本券已使用。"
          );
          byId("member-lottery-result-swatch").style.backgroundColor =
            draw.prizeColor;
          setStatus("");
          setState("member-lottery-result-state");
          focus(byId("member-lottery-confirm-button"));
        }

        function updateControls(stateValue) {
          var state =
            stateValue && typeof stateValue === "object" ? stateValue : {};
          var spinButton = byId("member-lottery-spin-button");
          var canDraw = state.canDraw === true;
          spinButton.disabled = !canDraw;
          spinButton.setAttribute("aria-busy", String(state.isBusy === true));
          spinButton.dataset.state = state.isBusy
            ? "busy"
            : state.isPreparing
              ? "loading"
              : canDraw
                ? "ready"
                : "disabled";
          setButtonLabel(
            spinButton,
            state.isBusy
              ? "抽獎中"
              : state.isPreparing
                ? "載入轉盤"
                : state.pending
                  ? "揭曉結果"
                  : state.hasTicket
                    ? "點我抽獎"
                    : "選擇抽獎券"
          );

          [
            "member-lottery-close-button",
            "member-lottery-return-button",
          ].forEach(function (id) {
            var button = byId(id);
            button.disabled = state.canClose !== true;
            button.setAttribute("aria-disabled", String(state.canClose !== true));
          });
        }

        function bind(nextHandlers) {
          if (bound) return;
          handlers = nextHandlers || {};
          bound = true;
          byId("member-lottery-spin-button").addEventListener("click", function () {
            if (typeof handlers.onSpin === "function") handlers.onSpin();
          });
          byId("member-lottery-retry-button").addEventListener("click", function () {
            if (typeof handlers.onRetry === "function") handlers.onRetry();
          });

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
              if (typeof handlers.onClose === "function") {
                handlers.onClose({
                  returnToTickets:
                    Boolean(target) && target.id !== "member-lottery-close-button",
                });
              }
            },
            true
          );
          dialog.addEventListener("cancel", function (event) {
            event.preventDefault();
            if (typeof handlers.onClose === "function") handlers.onClose({});
          });
          dialog.addEventListener("close", function () {
            if (hostCloseAllowed) {
              hostCloseAllowed = false;
              return;
            }
            if (
              typeof handlers.canClose === "function" &&
              handlers.canClose()
            ) {
              return;
            }
            if (typeof handlers.onBlockedClose === "function") {
              handlers.onBlockedClose();
            }
            runtime.requestAnimationFrame(showDialog);
          });
          runtime.addEventListener("beforeunload", function (event) {
            if (
              typeof handlers.canClose !== "function" ||
              handlers.canClose()
            ) {
              return;
            }
            event.preventDefault();
            event.returnValue = "";
          });
        }

        assertReady();
        return Object.freeze({
          bind: bind,
          markPreparing: markPreparing,
          markReady: markReady,
          setStatus: setStatus,
          showError: showError,
          showResult: showResult,
          updateControls: updateControls,
          close: closeDialog,
          allowHostClose: allowHostClose,
          getCanvas: function () {
            return byId("member-lottery-wheel");
          },
          getRotor: function () {
            return byId("member-lottery-rotor");
          },
        });
      }

      return Object.freeze({ create: create });
    }
  );
})(window);
