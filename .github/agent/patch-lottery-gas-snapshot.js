const fs = require("node:fs");
const path = require("node:path");

// One-shot guarded branch patch. Removed before the Draft PR is finalized.
// It is intentionally idempotent so a workflow retry cannot double-apply edits.
function read(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function write(relativePath, source) {
  fs.writeFileSync(path.resolve(relativePath), source);
}

function replaceOnceOrVerify(source, label, before, after) {
  const first = source.indexOf(before);
  if (first >= 0) {
    if (source.indexOf(before, first + 1) >= 0) {
      throw new Error(`${label}: source block matched more than once`);
    }
    return source.slice(0, first) + after + source.slice(first + before.length);
  }
  if (source.indexOf(after) < 0) {
    throw new Error(`${label}: neither source nor patched block was found`);
  }
  return source;
}

function patchFile(relativePath, patches) {
  let source = read(relativePath);
  for (const patch of patches) {
    source = replaceOnceOrVerify(source, patch.label, patch.before, patch.after);
  }
  write(relativePath, source);
}

patchFile("PersonalBrandTestingEnvironment/gas/client/Code.gs", [
  {
    label: "card-status optional settings snapshot",
    before: `function getMemberPointCardStatus_(
  redemptionSheet,
  drawSheet,
  settingSheet,
  lineUserId,
  drawRecords
) {
  var ledger = readMemberPointLedger_(redemptionSheet, lineUserId);
  var settings = readPointCardSettings_(settingSheet);`,
    after: `function getMemberPointCardStatus_(
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
    : readPointCardSettings_(settingSheet);`,
  },
  {
    label: "getLotteryConfig request-scoped settings reuse",
    before: `    var drawRecords = readAllLotteryDraws_(drawSheet);
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
    after: `    var drawRecords = readAllLotteryDraws_(drawSheet);
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
    });`,
  },
]);

patchFile("PersonalBrandTestingEnvironment/tests/client-gas.test.js", [
  {
    label: "member GAS API version expectation",
    before: `  assert.equal(health.data.version, "1.10.1");`,
    after: `  assert.equal(health.data.version, "1.10.2");`,
  },
]);

patchFile("PersonalBrandTestingEnvironment/tests/frontend-structure.test.js", [
  {
    label: "startup script list keeps wheel lazy",
    before: `    "../shared/liff-runtime.js",
    "../shared/lottery-wheel.js",
    "member-lottery-loader.js",`,
    after: `    "../shared/liff-runtime.js",
    "member-lottery-loader.js",`,
  },
  {
    label: "wheel belongs to deferred boundary",
    before: `  for (const deferredPath of [
    "../shared/module-registry.js",`,
    after: `  for (const deferredPath of [
    "../shared/module-registry.js",
    "../shared/lottery-wheel.js",`,
  },
]);

patchFile("PersonalBrandTestingEnvironment/tests/lottery-activation-compatibility.test.js", [
  {
    label: "activation lazy boundary includes wheel",
    before: `const lazyBoundary = [
  "../shared/module-registry.js",`,
    after: `const lazyBoundary = [
  "../shared/module-registry.js",
  "../shared/lottery-wheel.js",`,
  },
  {
    label: "activation expects wheel off initial HTML",
    before: `  assert.match(index, /src=["']\\.\\.\\/shared\\/lottery-wheel\\.js["']/);
  assert.match(index, /src=["']member-lottery-loader\\.js["']/);`,
    after: `  assert.doesNotMatch(index, /src=["']\\.\\.\\/shared\\/lottery-wheel\\.js["']/);
  assert.match(loader, /["']\\.\\.\\/shared\\/lottery-wheel\\.js["']/);
  assert.match(index, /src=["']member-lottery-loader\\.js["']/);`,
  },
]);

patchFile("PersonalBrandTestingEnvironment/tests/project-quality.test.js", [
  {
    label: "quality expects wheel lazy",
    before: `  assert.match(html, /src=["']\\.\\.\\/shared\\/lottery-wheel\\.js["']/);
  assert.doesNotMatch(html, /src=["']member-lottery-v2\\.js["']/);`,
    after: `  assert.doesNotMatch(html, /src=["']\\.\\.\\/shared\\/lottery-wheel\\.js["']/);
  assert.match(loader, /["']\\.\\.\\/shared\\/lottery-wheel\\.js["']/);
  assert.doesNotMatch(html, /src=["']member-lottery-v2\\.js["']/);`,
  },
]);

patchFile("PersonalBrandTestingEnvironment/tests/member-lottery-loader.test.js", [
  {
    label: "parallel loader test yields through Promise.all completion",
    before: `  RUNTIME_SOURCES.forEach((source) => harness.emitScript(source));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.appendedSources.at(-1), ENTRY_SOURCE);`,
    after: `  RUNTIME_SOURCES.forEach((source) => harness.emitScript(source));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.appendedSources.at(-1), ENTRY_SOURCE);`,
  },
]);

patchFile("PersonalBrandTestingEnvironment/tests/member-lottery-runtime-prewarm.test.js", [
  {
    label: "requestId static guard does not match requestIdleCallback",
    before: `  assert.doesNotMatch(body, /refreshTickets|getLotteryConfig|drawLottery|requestId/);`,
    after: `  assert.doesNotMatch(body, /refreshTickets|getLotteryConfig|drawLottery|\\brequestId\\b/);`,
  },
]);

const gas = read("PersonalBrandTestingEnvironment/gas/client/Code.gs");
if (!/var API_VERSION = "1\.10\.2";/.test(gas)) {
  throw new Error("unexpected member GAS API version");
}
