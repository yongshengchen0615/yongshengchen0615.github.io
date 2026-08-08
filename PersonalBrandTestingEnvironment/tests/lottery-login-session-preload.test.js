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

test("authenticated member card prewarm now loads runtime plus authoritative Lottery workspace", () => {
  assert.match(scriptSource, /MemberLotteryDialog\.prewarm\(\)/);
  assert.match(loaderSource, /function preloadSession\(\)/);
  assert.match(loaderSource, /function prewarm\(\)[\s\S]*return preloadSession\(\)/);
  assert.match(loaderSource, /rawRequest\("getLotteryConfig", \{\}, undefined\)/);
  assert.match(loaderSource, /lottery_session_preload/);
});

test("post-login getLotteryConfig calls are served from the in-memory session snapshot", () => {
  const requestMatch = loaderSource.match(
    /function sessionRequest\(action, fields, requestId\) \{([\s\S]*?)\n  \}\n\n  function loadSessionConfig/
  );
  assert.ok(requestMatch, "sessionRequest implementation should be discoverable");
  assert.match(requestMatch[1], /action === "getLotteryConfig"/);
  assert.match(requestMatch[1], /sessionConfigResponse/);
  assert.match(requestMatch[1], /Promise\.resolve\(sessionConfigResponse\)/);
  assert.match(requestMatch[1], /LOTTERY_SESSION_NOT_READY/);
});

test("ticket refresh after login cannot start another authoritative config request", () => {
  const refreshMatch = loaderSource.match(
    /function refreshTickets\(options\) \{([\s\S]*?)\n  \}\n\n  function restorePending/
  );
  assert.ok(refreshMatch, "refreshTickets implementation should be discoverable");
  assert.doesNotMatch(refreshMatch[1], /rawRequest|getLotteryConfig/);
  assert.match(refreshMatch[1], /sessionConfigResponse/);
});

test("formal draw stays in DrawService and bypasses the config snapshot", () => {
  assert.match(loaderSource, /return rawRequest\(action, fields, requestId\)/);
  assert.match(controllerSource, /function performDraw\(\)/);
  assert.match(controllerSource, /drawService\.draw\(selectedTicket\)/);
  const preloadMatch = loaderSource.match(
    /function loadSessionConfig\(\) \{([\s\S]*?)\n  \}\n\n  function preloadSession/
  );
  assert.ok(preloadMatch, "loadSessionConfig implementation should be discoverable");
  assert.doesNotMatch(preloadMatch[1], /drawLottery/);
});
