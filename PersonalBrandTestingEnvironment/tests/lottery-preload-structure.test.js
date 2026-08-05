const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const controller = fs.readFileSync(
  path.join(root, "client/lottery/preload-controller.js"),
  "utf8"
);
const service = fs.readFileSync(
  path.join(root, "client/lottery/preparation-service.js"),
  "utf8"
);
const bootstrap = fs.readFileSync(
  path.join(root, "client/member-lottery-preload.js"),
  "utf8"
);

const internalModules = [
  "contracts.js",
  "pending-request-store.js",
  "preparation-service.js",
  "preparation-view.js",
  "wheel-draw-guard.js",
  "preload-controller.js",
].map((name) =>
  fs.readFileSync(path.join(root, "client/lottery", name), "utf8")
);

test("drawLottery is prepared during the getLotteryConfig phase", () => {
  assert.match(
    controller,
    /action\s*===\s*["']getLotteryConfig["'][\s\S]*service\.prepare\(activeTicket\)/
  );
  assert.match(
    service,
    /options\.request\(\s*["']drawLottery["'][\s\S]*request\.requestId/
  );
});

test("the wheel click path returns cached data and does not call the backend", () => {
  const drawBranch = controller.match(
    /if\s*\(action\s*===\s*["']drawLottery["']\)\s*\{([\s\S]*?)\n\s*\}/
  );
  assert.ok(drawBranch, "missing drawLottery interception");
  assert.match(drawBranch[1], /service\.resolvePrepared\(activeTicket,\s*requestId\)/);
  assert.doesNotMatch(drawBranch[1], /value\.request|options\.request/);
});

test("the composition root only wires dependencies and publishes the facade", () => {
  assert.match(bootstrap, /registry\.get\(["']lottery\.preload-controller["']\)/);
  assert.match(bootstrap, /root\.MemberLotteryDialog\s*=\s*controllerFactory\.create/);
  assert.doesNotMatch(bootstrap, /action\s*===\s*["']drawLottery["']/);
});

test("internal modules register through PersonaModules instead of leaking globals", () => {
  for (const source of internalModules) {
    assert.match(source, /registry\.define\(/);
    assert.doesNotMatch(
      source,
      /root\.MemberLottery(?:PendingRequestStore|PreparationService|PreparationView|WheelDrawGuard)\s*=/
    );
  }
});
