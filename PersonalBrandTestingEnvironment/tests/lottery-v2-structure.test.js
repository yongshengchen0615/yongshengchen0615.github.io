const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const hostScript = fs.readFileSync(
  path.join(root, "client/script.js"),
  "utf8"
);
const controller = fs.readFileSync(
  path.join(root, "client/lottery/dialog-controller.js"),
  "utf8"
);
const preparationService = fs.readFileSync(
  path.join(root, "client/lottery/preparation-service.js"),
  "utf8"
);
const drawService = fs.readFileSync(
  path.join(root, "client/lottery/draw-service.js"),
  "utf8"
);
const bootstrap = fs.readFileSync(
  path.join(root, "client/member-lottery-v2.js"),
  "utf8"
);
const moduleNames = [
  "workspace-service.js",
  "preparation-service.js",
  "draw-service.js",
  "workspace-mapper.js",
  "wheel-animator.js",
  "dialog-view.js",
  "demo-provider.js",
  "dialog-controller.js",
];

test("preparation is read-only and draw mutation is isolated in draw service", () => {
  assert.match(preparationService, /getLotteryConfig/);
  assert.doesNotMatch(preparationService, /["']drawLottery["']/);
  assert.doesNotMatch(preparationService, /\.ensure\(/);
  assert.match(
    preparationService,
    /\.load\(\{\s*force:\s*true,\s*maxAgeMs:\s*selectionMaxAgeMs\s*\}\)/
  );

  assert.match(
    drawService,
    /options\.request\(\s*["']drawLottery["'][\s\S]*request\.requestId/
  );
  assert.match(controller, /drawService\.draw\(selectedTicket\)/);

  const spinBody = controller.match(
    /function handleSpin\(\) \{([\s\S]*?)\n        function retry\(\)/
  );
  assert.ok(spinBody, "missing handleSpin implementation");
  assert.doesNotMatch(spinBody[1], /options\.request\(/);
});

test("background ticket refresh stays non-blocking while selection keeps its own lock", () => {
  assert.doesNotMatch(
    hostScript,
    /isMemberTicketRefreshing\s*\|\|\s*isMemberTicketSelectionBusy/
  );
  assert.match(hostScript, /button\.disabled\s*=\s*isMemberTicketSelectionBusy/);

  const refreshStateBody = hostScript.match(
    /function setMemberTicketRefreshState\([\s\S]*?\n  \}/
  );
  assert.ok(refreshStateBody, "missing ticket refresh state function");
  assert.match(
    refreshStateBody[0],
    /button\.disabled\s*=\s*isMemberTicketSelectionBusy/
  );

  const openTicketBody = hostScript.match(
    /function openMemberLotteryTicket\(ticket\) \{([\s\S]*?)\n  \}/
  );
  assert.ok(openTicketBody, "missing ticket selection function");
  assert.match(openTicketBody[1], /if \(isMemberTicketSelectionBusy\)/);
  assert.doesNotMatch(openTicketBody[1], /if \(isMemberTicketRefreshing/);
  assert.match(
    openTicketBody[1],
    /isMemberTicketSelectionBusy\s*=\s*true[\s\S]*MemberLotteryDialog\.open/
  );
});

test("stale ticket recovery can update the host snapshot without an extra request", () => {
  assert.match(controller, /function syncLatestWorkspaceSnapshot\(\)/);
  assert.match(controller, /workspaceService\.peek\(\)/);
  assert.match(
    controller,
    /if \(definitive\) syncLatestWorkspaceSnapshot\(\)/
  );
});

test("v2 composition root only publishes the existing public facade", () => {
  assert.match(bootstrap, /registry\.get\(["']lottery\.dialog-controller["']\)/);
  assert.match(bootstrap, /root\.MemberLotteryDialog\s*=\s*controllerFactory\.create/);
  assert.doesNotMatch(bootstrap, /getLotteryConfig|drawLottery|sessionStorage/);
});

test("internal lottery modules register through PersonaModules without new globals", () => {
  for (const fileName of moduleNames) {
    const source = fs.readFileSync(
      path.join(root, "client/lottery", fileName),
      "utf8"
    );
    assert.match(source, /registry\.define\(/, `${fileName} is not registered`);
    assert.doesNotMatch(
      source,
      /root\.MemberLottery[A-Za-z]+\s*=/,
      `${fileName} leaks a MemberLottery global`
    );
  }
});
