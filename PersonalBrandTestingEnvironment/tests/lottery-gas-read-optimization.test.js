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

function sliceBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(start, -1, `missing ${startText}`);
  assert.notEqual(end, -1, `missing ${endText}`);
  return source.slice(start, end);
}

test("getLotteryConfig reuses one complete point-card settings snapshot", () => {
  const getConfig = sliceBetween(
    code,
    "function getLotteryConfig_(identity, request, config) {",
    "function drawLotteryReplayResponse_("
  );
  const cardStatus = sliceBetween(
    code,
    "function getMemberPointCardStatus_(",
    "function isEligiblePointCardRewardOrdinal_("
  );

  assert.match(code, /var API_VERSION = "1\.10\.2"/);
  assert.match(getConfig, /var settings\s*=\s*readPointCardSettings_\(settingSheet\)/);
  assert.match(
    getConfig,
    /getMemberPointCardStatus_\([\s\S]*drawRecords,\s*settings\s*\)/
  );
  assert.match(getConfig, /settings\.forEach\(function \(setting\)/);
  assert.match(getConfig, /setting\.rewardRules\.forEach/);
  assert.match(cardStatus, /settingsSnapshot/);
  assert.match(
    cardStatus,
    /Array\.isArray\(settingsSnapshot\)[\s\S]*settingsSnapshot[\s\S]*readPointCardSettings_\(settingSheet\)/
  );
});

test("drawLottery keeps fresh server-side revalidation without a shared settings snapshot", () => {
  const draw = sliceBetween(
    code,
    "function drawLottery_(identity, request, config) {",
    "function resolveAvailablePointCardReward_("
  );

  assert.match(draw, /Recheck access and the append-only ledger immediately before mutation/);
  assert.match(draw, /drawRecords\s*=\s*readAllLotteryDraws_\(drawSheet\)/);
  assert.match(draw, /getMemberPointCardStatus_\(/);
  assert.doesNotMatch(draw, /getMemberPointCardStatus_\([\s\S]*drawRecords,\s*settings\s*\)/);
  assert.match(draw, /readLatestLotteryConfig_\(/);
  assert.match(draw, /pickLotteryPrize_\(lotteryConfig\.prizes\)/);
  assert.match(draw, /drawSheet\.appendRow\(/);
});

test("GAS scale diagnostics reflect one PointCardSettings scan for getLotteryConfig", () => {
  const multiplierStart = diagnostics.indexOf("var getLotteryConfigScanMultipliers");
  const drawMultiplierStart = diagnostics.indexOf(
    "var drawLotterySuccessfulScanMultipliers",
    multiplierStart
  );
  assert.notEqual(multiplierStart, -1);
  assert.notEqual(drawMultiplierStart, -1);
  const multipliers = diagnostics.slice(multiplierStart, drawMultiplierStart);

  assert.match(multipliers, /pointCardSettings:\s*1/);
  assert.doesNotMatch(multipliers, /pointCardSettings:\s*[2-9]/);
});
