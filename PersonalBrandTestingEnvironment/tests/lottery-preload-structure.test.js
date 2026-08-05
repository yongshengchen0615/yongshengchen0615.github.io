const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const preload = fs.readFileSync(
  path.join(root, "client/member-lottery-preload.js"),
  "utf8"
);
const service = fs.readFileSync(
  path.join(root, "client/lottery/preparation-service.js"),
  "utf8"
);

test("drawLottery is prepared during the getLotteryConfig phase", () => {
  assert.match(
    preload,
    /action\s*===\s*["']getLotteryConfig["'][\s\S]*service\.prepare\(activeTicket\)/
  );
  assert.match(
    service,
    /options\.request\(\s*["']drawLottery["'][\s\S]*request\.requestId/
  );
});

test("the wheel click path returns cached data and does not call the backend", () => {
  const drawBranch = preload.match(
    /if\s*\(action\s*===\s*["']drawLottery["']\)\s*\{([\s\S]*?)\n\s*\}/
  );
  assert.ok(drawBranch, "missing drawLottery interception");
  assert.match(drawBranch[1], /service\.resolvePrepared\(activeTicket,\s*requestId\)/);
  assert.doesNotMatch(drawBranch[1], /value\.request|options\.request/);
});
