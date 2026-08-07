const fs = require("node:fs");
const path = require("node:path");

// One-shot guarded branch patch. Removed before the Draft PR is finalized.
const file = path.resolve(
  "PersonalBrandTestingEnvironment/gas/client/Code.gs"
);
let source = fs.readFileSync(file, "utf8");

function replaceExactlyOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (source.indexOf(before, first + 1) >= 0) {
    throw new Error(`${label}: source block matched more than once`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceExactlyOnce(
  "card-status optional settings snapshot",
  `function getMemberPointCardStatus_(
  redemptionSheet,
  drawSheet,
  settingSheet,
  lineUserId,
  drawRecords
) {
  var ledger = readMemberPointLedger_(redemptionSheet, lineUserId);
  var settings = readPointCardSettings_(settingSheet);`,
  `function getMemberPointCardStatus_(
  redemptionSheet,
  drawSheet,
  settingSheet,
  lineUserId,
  drawRecords,
  settingsSnapshot
) {
  var ledger = readMemberPointLedger_(redemptionSheet, lineUserId);
  var settings = Array.isArray(settingsSnapshot)
    ? settingsSnapshot
    : readPointCardSettings_(settingSheet);`
);

replaceExactlyOnce(
  "getLotteryConfig request-scoped settings reuse",
  `    var drawRecords = readAllLotteryDraws_(drawSheet);
    var cardStatus = getMemberPointCardStatus_(
      redemptionSheet,
      drawSheet,
      settingSheet,
      identity.lineUserId,
      drawRecords
    );
    var requiredTypeIds = Object.create(null);
    cardStatus.rewardRules.forEach(function (rule) {
      if (rule.lotteryTypeId) {
        requiredTypeIds[rule.lotteryTypeId] = true;
      }
    });
    cardStatus.availableRewards.forEach(function (reward) {
      if (reward.lotteryTypeId) {
        requiredTypeIds[reward.lotteryTypeId] = true;
      }
    });`,
  `    var drawRecords = readAllLotteryDraws_(drawSheet);
    var settings = readPointCardSettings_(settingSheet);
    var cardStatus = getMemberPointCardStatus_(
      redemptionSheet,
      drawSheet,
      settingSheet,
      identity.lineUserId,
      drawRecords,
      settings
    );
    var requiredTypeIds = Object.create(null);
    settings.forEach(function (setting) {
      setting.rewardRules.forEach(function (rule) {
        if (rule.lotteryTypeId) {
          requiredTypeIds[rule.lotteryTypeId] = true;
        }
      });
    });`
);

if (!/var API_VERSION = "1\.10\.2";/.test(source)) {
  throw new Error("unexpected member GAS API version");
}

fs.writeFileSync(file, source);
