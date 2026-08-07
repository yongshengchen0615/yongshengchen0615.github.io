const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
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
