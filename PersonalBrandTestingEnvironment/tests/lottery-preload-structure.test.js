const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const preparation = fs.readFileSync(
  path.join(root, "client/lottery/preparation-service.js"),
  "utf8"
);
const drawService = fs.readFileSync(
  path.join(root, "client/lottery/draw-service.js"),
  "utf8"
);
const controller = fs.readFileSync(
  path.join(root, "client/lottery/dialog-controller.js"),
  "utf8"
);
const bootstrap = fs.readFileSync(
  path.join(root, "client/member-lottery-v2.js"),
  "utf8"
);
const loader = fs.readFileSync(
  path.join(root, "client/member-lottery-loader.js"),
  "utf8"
);
const memberHtml = fs.readFileSync(path.join(root, "client/index.html"), "utf8");

const moduleNames = [
  "contracts.js",
  "pending-request-store.js",
  "workspace-service.js",
  "preparation-service.js",
  "draw-service.js",
  "workspace-mapper.js",
  "wheel-animator.js",
  "dialog-view.js",
  "demo-provider.js",
  "dialog-controller.js",
];

test("ticket preparation requires authoritative workspace validation without creating a draw transaction", () => {
  assert.match(
    preparation,
    /\.load\(\{\s*force:\s*true,\s*maxAgeMs:\s*selectionMaxAgeMs\s*\}\)/
  );
  assert.match(preparation, /DEFAULT_SELECTION_MAX_AGE_MS\s*=\s*2000/);
  assert.match(preparation, /validateWorkspace/);
  assert.doesNotMatch(preparation, /["']drawLottery["']/);
  assert.doesNotMatch(preparation, /\.ensure\(/);
  assert.doesNotMatch(preparation, /requestId/);
});

test("draw mutation and persistent request creation belong to draw-service", () => {
  assert.match(drawService, /options\.store\.ensure\(ticket\)/);
  assert.match(
    drawService,
    /options\.request\(\s*["']drawLottery["'][\s\S]*request\.requestId/
  );
  assert.match(drawService, /if\s*\(activePromise\)/);
  assert.match(drawService, /contracts\.isDefinitiveNoDrawError\(error\)/);
});

test("dialog controller reaches READY from preparation and invokes DrawService only from spin", () => {
  const prepareStart = controller.indexOf("function prepareCurrent");
  const openStart = controller.indexOf("function open(ticketValue)", prepareStart);
  const spinStart = controller.indexOf("function handleSpin");
  const retryStart = controller.indexOf("function retry()", spinStart);
  assert.notEqual(prepareStart, -1);
  assert.notEqual(openStart, -1);
  assert.notEqual(spinStart, -1);
  assert.notEqual(retryStart, -1);

  const prepareBody = controller.slice(prepareStart, openStart);
  const spinBody = controller.slice(spinStart, retryStart);
  assert.match(prepareBody, /preparationService\.prepare/);
  assert.match(prepareBody, /animator\.prepare\(selectedType\.lottery\)/);
  assert.match(prepareBody, /view\.markReady/);
  assert.doesNotMatch(prepareBody, /drawService\.draw|drawLottery/);
  assert.match(spinBody, /isBusy\s*=\s*true/);
  assert.match(spinBody, /performDraw/);
  assert.doesNotMatch(spinBody, /getLotteryConfig|options\.request/);
});

test("V2 composition root pre-draws during login preload and keeps HTML on the lazy facade", () => {
  assert.match(bootstrap, /registry\.get\(["']lottery\.dialog-controller["']\)/);
  assert.match(bootstrap, /createPreparedFacade\(controllerFactory\)/);
  assert.match(bootstrap, /sourceRequest\(\s*["']drawLottery["']/);
  assert.match(
    bootstrap,
    /if \(action === ["']drawLottery["'] && !safeIsDemo\(\)\)/
  );
  assert.match(
    bootstrap,
    /root\.MemberLotteryDialog\s*=\s*createPreparedFacade\(controllerFactory\)/
  );
  assert.match(memberHtml, /src=["']member-lottery-loader\.js["']/);
  assert.doesNotMatch(memberHtml, /src=["']lottery\/draw-service\.js["']/);
  assert.match(loader, /"lottery\/draw-service\.js"/);
  assert.match(loader, /"member-lottery-v2\.js"/);
  assert.doesNotMatch(memberHtml, /wheel-draw-guard|member-lottery\.js/);
  assert.equal(fs.existsSync(path.join(root, "client/lottery/wheel-draw-guard.js")), false);
});

test("current internal lottery modules register without leaking public globals", () => {
  for (const name of moduleNames) {
    const source = fs.readFileSync(path.join(root, "client/lottery", name), "utf8");
    assert.match(source, /registry\.define\(/, `${name} is not registered`);
    assert.doesNotMatch(
      source,
      /root\.MemberLottery[A-Za-z]+\s*=/,
      `${name} leaks an internal MemberLottery global`
    );
  }
});
