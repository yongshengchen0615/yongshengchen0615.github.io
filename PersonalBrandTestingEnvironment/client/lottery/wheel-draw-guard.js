(function (root) {
  "use strict";

  var registry = root.PersonaModules;
  if (!registry) {
    throw new Error("PersonaModules must load before wheel draw guard.");
  }

  registry.define(
    "lottery.wheel-draw-guard",
    ["lottery.contracts"],
    function (contracts) {
      function create() {
        var prepared = null;

        function matches(ticketValue, requestIdValue) {
          if (!prepared) return false;
          var ticket = contracts.normalizeTicket(ticketValue);
          var requestId = contracts.normalizeRequestId(requestIdValue);
          return (
            prepared.cardRoundKey === ticket.cardRoundKey &&
            prepared.lotteryTypeId === ticket.lotteryTypeId &&
            prepared.requestId === requestId
          );
        }

        function save(ticketValue, requestValue, response) {
          var ticket = contracts.normalizeTicket(ticketValue);
          var requestId = contracts.normalizeRequestId(
            requestValue && requestValue.requestId
          );
          prepared = Object.freeze({
            cardRoundKey: ticket.cardRoundKey,
            lotteryTypeId: ticket.lotteryTypeId,
            requestId: requestId,
            response: response,
          });
          return response;
        }

        function resolve(ticketValue, requestIdValue) {
          try {
            if (matches(ticketValue, requestIdValue)) {
              return Promise.resolve(prepared.response);
            }
          } catch (_error) {
            // Normalize all mismatches to the same user-facing state error.
          }

          return Promise.reject(
            contracts.createError(
              "LOTTERY_RESULT_NOT_PREPARED",
              "抽獎結果尚未準備完成，請重新開啟轉盤。"
            )
          );
        }

        function has(ticketValue, requestIdValue) {
          try {
            return matches(ticketValue, requestIdValue);
          } catch (_error) {
            return false;
          }
        }

        function clear() {
          prepared = null;
        }

        return Object.freeze({
          save: save,
          resolve: resolve,
          has: has,
          clear: clear,
        });
      }

      return Object.freeze({ create: create });
    }
  );
})(window);
