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
const preparationSource = fs.readFileSync(
  path.join(root, "client/lottery/preparation-service.js"),
  "utf8"
);

test("member login preloads Lottery runtime and authoritative workspace", () => {
  assert.match(scriptSource, /MemberLotteryDialog\.preloadSession\(\)/);
  assert.match(loaderSource, /function preloadSession\(\)/);
  assert.match(loaderSource, /controller\.preloadSession\(\)/);
  assert.match(controllerSource, /function preloadSession\(\)/);
  assert.match(controllerSource, /workspaceService\s*\.load\(\{ force: true \}\)/);
});

test("post-login preparation consumes the session snapshot without another workspace read", () => {
  assert.match(controllerSource, /sessionWorkspaceResponse/);
  assert.match(controllerSource, /workspaceResponse:\s*sessionWorkspaceResponse/);
  assert.match(preparationSource, /prepareOptions\.workspaceResponse/);
  assert.match(preparationSource, /validateWorkspace\(\s*prepareOptions\.workspaceResponse/);
});

test("ticket refresh after login is local-only", () => {
  const refreshMatch = controllerSource.match(
    /function refreshTickets\(refreshOptions\) \{([\s\S]*?)\n        \}\n\n        function restorePending/
  );
  assert.ok(refreshMatch, "refreshTickets implementation should be discoverable");
  assert.doesNotMatch(refreshMatch[1], /workspaceService\s*\.load\(/);
  assert.match(refreshMatch[1], /sessionWorkspaceResponse|workspace/);
});

test("session preload stays read-only and formal draw remains separate", () => {
  const preloadMatch = controllerSource.match(
    /function preloadSession\(\) \{([\s\S]*?)\n        \}\n\n        function prepareCurrent/
  );
  assert.ok(preloadMatch, "preloadSession implementation should be discoverable");
  assert.doesNotMatch(preloadMatch[1], /drawLottery|performDraw|drawService\.draw/);
  assert.match(controllerSource, /function performDraw\(\)/);
  assert.match(controllerSource, /drawService\.draw\(selectedTicket\)/);
});
