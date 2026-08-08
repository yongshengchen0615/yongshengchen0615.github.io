const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "gas", "client", "PerformanceDiagnostics.gs"),
  "utf8"
);

test("GAS scale diagnostics remain aggregate-only and read-only", () => {
  assert.match(source, /function\s+diagnoseMemberGasScale\s*\(/);
  assert.match(source, /getLastRow\(\)/);
  assert.match(source, /getSheetByName\(/);
  assert.doesNotMatch(source, /getValues\(|getDisplayValues\(/);
  assert.doesNotMatch(source, /setValues\(|appendRow\(|deleteRow\(|SpreadsheetApp\.flush/);
  assert.doesNotMatch(source, /line_user_id|request_id|prize_label|claim_hash/i);
});

test("GAS scale diagnostic reports Lottery operation scan pressure without row values", () => {
  const rows = {
    Members: 101,
    PointRedemptions: 6001,
    PointCardSettings: 4,
    LotteryTypes: 3,
    LotteryPrizes: 13,
    LotteryDraws: 25001,
  };
  const logged = [];
  const context = {
    Date,
    JSON,
    Math,
    Number,
    Object,
    console: {
      log(value) {
        logged.push(String(value));
      },
    },
    MEMBER_HEADERS: new Array(23),
    POINT_REDEMPTION_HEADERS: new Array(10),
    POINT_CARD_SETTING_HEADERS: new Array(9),
    LOTTERY_TYPE_HEADERS: new Array(9),
    LOTTERY_PRIZE_HEADERS: new Array(11),
    LOTTERY_DRAW_HEADERS: new Array(16),
    getConfig_() {
      return {
        spreadsheetId: "sheet-id",
        sheetName: "Members",
        pointRedemptionSheetName: "PointRedemptions",
        pointCardSettingSheetName: "PointCardSettings",
        lotteryTypeSheetName: "LotteryTypes",
        lotteryPrizeSheetName: "LotteryPrizes",
        lotteryDrawSheetName: "LotteryDraws",
      };
    },
    SpreadsheetApp: {
      openById(id) {
        assert.equal(id, "sheet-id");
        return {
          getSheetByName(name) {
            assert.ok(Object.hasOwn(rows, name));
            return {
              getLastRow() {
                return rows[name];
              },
            };
          },
        };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "PerformanceDiagnostics.gs" });

  const snapshot = context.diagnoseMemberGasScale();
  const normalized = JSON.parse(JSON.stringify(snapshot));
  const byKey = Object.fromEntries(normalized.tables.map((item) => [item.key, item]));

  assert.equal(byKey.members.rows, 100);
  assert.equal(byKey.pointRedemptions.rows, 6000);
  assert.equal(byKey.pointRedemptions.risk, "warning");
  assert.equal(byKey.lotteryDraws.rows, 25000);
  assert.equal(byKey.lotteryDraws.risk, "critical");
  assert.equal(normalized.thresholds.warningRows, 5000);
  assert.equal(normalized.thresholds.criticalRows, 20000);

  assert.ok(normalized.lotteryOperations);
  assert.deepEqual(normalized.lotteryOperations.getLotteryConfig.scanMultipliers, {
    members: 1,
    pointRedemptions: 1,
    pointCardSettings: 1,
    lotteryTypes: 1,
    lotteryPrizes: 1,
    lotteryDraws: 1,
  });
  assert.deepEqual(normalized.lotteryOperations.drawLotterySuccessful.scanMultipliers, {
    members: 1,
    pointRedemptions: 3,
    pointCardSettings: 3,
    lotteryTypes: 1,
    lotteryPrizes: 2,
    lotteryDraws: 2,
  });
  assert.equal(
    normalized.lotteryOperations.getLotteryConfig.estimatedReadCells,
    normalized.estimatedReadCells.getLotteryConfig
  );
  assert.equal(
    normalized.lotteryOperations.drawLotterySuccessful.estimatedReadCells >
      normalized.lotteryOperations.getLotteryConfig.estimatedReadCells,
    true
  );
  assert.equal(normalized.recommendations.length >= 2, true);
  assert.equal(logged.length, 1);
  assert.doesNotMatch(logged[0], /MBR-|U[0-9a-f]{32}|request-/i);
});
