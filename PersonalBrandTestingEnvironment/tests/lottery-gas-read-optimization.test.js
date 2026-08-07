const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const code = fs.readFileSync(path.join(root, "gas", "client", "Code.gs"), "utf8");
const diagnostics = fs.readFileSync(
  path.join(root, "gas", "client", "PerformanceDiagnostics.gs"),
  "utf8"
);

function functionSlice(source, startName, endName) {
  const start = source.indexOf(`function ${startName}`);
  const end = source.indexOf(`function ${endName}`, start + 1);
  assert.notEqual(start, -1, `missing ${startName}`);
  assert.notEqual(end, -1, `missing ${endName}`);
  return source.slice(start, end);
}

test("getLotteryConfig reuses the card-status settings read instead of scanning settings twice", () => {
  const getConfig = functionSlice(
    code,
    "getLotteryConfig_(identity, request, config)",
    "drawLotteryReplayResponse_"
  );
  const cardStatus = functionSlice(
    code,
    "getMemberPointCardStatus_",
    "isEligiblePointCardRewardOrdinal_"
  );

  assert.match(code, /var API_VERSION = "1\.10\.2"/);
  assert.doesNotMatch(getConfig, /var settings\s*=\s*readPointCardSettings_/);
  assert.match(getConfig, /getMemberPointCardStatus_\(/);
  assert.match(getConfig, /cardStatus\.rewardRules\.forEach/);
  assert.match(getConfig, /cardStatus\.availableRewards\.forEach/);
  assert.match(cardStatus, /var settings\s*=\s*readPointCardSettings_\(settingSheet\)/);
});

test("drawLottery keeps fresh server-side revalidation before mutation", () => {
  const draw = functionSlice(
    code,
    "drawLottery_(identity, request, config)",
    "resolveAvailablePointCardReward_"
  );

  assert.match(draw, /Recheck access and the append-only ledger immediately before mutation/);
  assert.match(draw, /drawRecords\s*=\s*readAllLotteryDraws_\(drawSheet\)/);
  assert.match(draw, /getMemberPointCardStatus_\(/);
  assert.match(draw, /readLatestLotteryConfig_\(/);
  assert.match(draw, /pickLotteryPrize_\(lotteryConfig\.prizes\)/);
  assert.match(draw, /drawSheet\.appendRow\(/);
});

test("GAS scale diagnostics reflect one PointCardSettings scan for getLotteryConfig", () => {
  const configEstimateStart = diagnostics.indexOf("getLotteryConfig:");
  const recommendationStart = diagnostics.indexOf("var recommendations", configEstimateStart);
  assert.notEqual(configEstimateStart, -1);
  assert.notEqual(recommendationStart, -1);
  const estimate = diagnostics.slice(configEstimateStart, recommendationStart);

  assert.match(estimate, /byKey\.pointCardSettings\.estimatedCells\s*\+/);
  assert.doesNotMatch(estimate, /pointCardSettings\.estimatedCells\s*\*\s*2/);
});
