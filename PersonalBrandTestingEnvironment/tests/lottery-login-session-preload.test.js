const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const scriptSource = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
const loaderSource = fs.readFileSync(
  path.join(root, "client/member-lottery-loader.js"),
  "utf8"
);
const controllerSource = fs.readFileSync(
  path.join(root, "client/lottery/dialog-controller.js"),
  "utf8"
);

test("authenticated member startup preloads runtime plus authoritative Lottery workspace", () => {
  assert.match(scriptSource, /MemberLotteryDialog\.prewarm\(\)/);
  assert.match(loaderSource, /function preloadSession\(\)/);
  assert.match(loaderSource, /function prewarm\(\)[\s\S]*return preloadSession\(\)/);
  assert.match(loaderSource, /rawRequest\("getLotteryConfig", \{\}, undefined\)/);
  assert.match(loaderSource, /lottery_session_preload/);
});

test("loader starts session preload when authentication appears even with zero rewards", () => {
  assert.match(loaderSource, /function armAuthenticatedSessionPreload\(\)/);
  assert.match(loaderSource, /function tryAuthenticatedSessionPreload\(\)/);
  assert.match(loaderSource, /new root\.MutationObserver/);

  const triggerMatch = loaderSource.match(
    /function tryAuthenticatedSessionPreload\(\) \{([\s\S]*?)\n  \}\n\n  function armAuthenticatedSessionPreload/
  );
  assert.ok(triggerMatch, "authenticated preload trigger should be discoverable");
  assert.match(triggerMatch[1], /currentMemberId\(\)/);
  assert.match(triggerMatch[1], /preloadSession\(\)/);
  assert.doesNotMatch(triggerMatch[1], /availableRewards|availableDraws/);

  const configureMatch = loaderSource.match(
    /function configure\(options\) \{([\s\S]*?)\n  \}\n\n  function open/
  );
  assert.ok(configureMatch, "loader configure implementation should be discoverable");
  assert.match(configureMatch[1], /armAuthenticatedSessionPreload\(\)/);
});

test("post-login getLotteryConfig is served from a member-scoped in-memory session view", () => {
  const requestMatch = loaderSource.match(
    /function sessionRequest\(action, fields, requestId\) \{([\s\S]*?)\n  \}\n\n  function loadSessionConfig/
  );
  assert.ok(requestMatch, "sessionRequest implementation should be discoverable");
  assert.match(requestMatch[1], /action === "getLotteryConfig"/);
  assert.match(requestMatch[1], /getSessionConfigView\(\)/);
  assert.match(requestMatch[1], /LOTTERY_SESSION_NOT_READY/);
  assert.doesNotMatch(requestMatch[1], /rawRequest\("getLotteryConfig"/);

  assert.match(loaderSource, /function currentMemberId\(\)/);
  assert.match(loaderSource, /sessionMemberId/);
  assert.match(loaderSource, /function getSessionConfigView\(\)/);
  assert.match(loaderSource, /getCurrentCardSummary/);
  assert.match(loaderSource, /getCurrentTotalPoints/);
});

test("ticket refresh after login is purely local and cannot start runtime or config I/O", () => {
  const refreshMatch = loaderSource.match(
    /function refreshTickets\([^)]*\) \{([\s\S]*?)\n  \}\n\n  function restorePending/
  );
  assert.ok(refreshMatch, "refreshTickets implementation should be discoverable");
  assert.doesNotMatch(
    refreshMatch[1],
    /rawRequest|getLotteryConfig|ensureLoaded|controller\.refreshTickets/
  );
  assert.match(refreshMatch[1], /getCurrentCardSummary|currentCardSummary/);
});

test("authoritative draw response advances the session snapshot without refetching config", () => {
  assert.match(loaderSource, /function updateSessionConfigFromDraw\(response\)/);
  assert.match(loaderSource, /action === "drawLottery"/);
  assert.match(loaderSource, /updateSessionConfigFromDraw\(response\)/);
  assert.match(loaderSource, /response\.data\.card/);
  assert.match(loaderSource, /response\.data\.lotteryType/);

  assert.match(controllerSource, /function performDraw\(\)/);
  assert.match(controllerSource, /drawService\.draw\(selectedTicket\)/);
  const preloadMatch = loaderSource.match(
    /function loadSessionConfig\(\) \{([\s\S]*?)\n  \}\n\n  function preloadSession/
  );
  assert.ok(preloadMatch, "loadSessionConfig implementation should be discoverable");
  assert.doesNotMatch(preloadMatch[1], /drawLottery/);
});
