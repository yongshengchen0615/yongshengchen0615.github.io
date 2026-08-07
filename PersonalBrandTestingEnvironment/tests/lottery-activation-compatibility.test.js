const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
const loader = fs.readFileSync(
  path.join(root, "client/member-lottery-loader.js"),
  "utf8"
);
const legacyPage = fs.readFileSync(path.join(root, "client/lottery.html"), "utf8");
const workflow = fs.readFileSync(
  path.resolve(root, "..", ".github/workflows/validate-personal-brand-lottery.yml"),
  "utf8"
);

const lazyBoundary = [
  "../shared/module-registry.js",
  "../shared/lottery-wheel.js",
  "lottery/contracts.js",
  "lottery/pending-request-store.js",
  "lottery/workspace-service.js",
  "lottery/preparation-service.js",
  "lottery/draw-service.js",
  "lottery/workspace-mapper.js",
  "lottery/wheel-animator.js",
  "lottery/dialog-view.js",
  "lottery/demo-provider.js",
  "lottery/dialog-controller.js",
  "member-lottery-v2.js",
];

test("checked-in member entry exposes only the lazy V2 facade at startup", () => {
  assert.doesNotMatch(index, /src=["']\.\.\/shared\/lottery-wheel\.js["']/);
  assert.match(loader, /["']\.\.\/shared\/lottery-wheel\.js["']/);
  assert.match(index, /src=["']member-lottery-loader\.js["']/);
  assert.match(index, /src=["']script\.js["']/);
  for (const source of lazyBoundary) {
    assert.equal(index.includes(`src="${source}"`), false, `${source} must be lazy`);
    assert.ok(loader.includes(`"${source}"`), `loader is missing ${source}`);
  }
  assert.equal(index.includes('src="member-lottery.js"'), false);
  assert.equal(index.includes('src="lottery/wheel-draw-guard.js"'), false);
});

test("legacy lottery deep link redirects to the V2 ticket panel", () => {
  assert.match(legacyPage, /params\.set\(["']panel["'],\s*["']tickets["']\)/);
  assert.match(legacyPage, /window\.location\.replace\(target\.toString\(\)\)/);
  assert.equal(fs.existsSync(path.join(root, "client/lottery.js")), false);
  assert.equal(fs.existsSync(path.join(root, "client/member-lottery.js")), false);
});

test("lottery workflow validates the lazy V2 boundary without mutating deployment", () => {
  for (const scriptPath of [
    "shared/lottery-wheel.js",
    "shared/module-registry.js",
    "client/member-lottery-loader.js",
    "client/member-lottery-v2.js",
    "client/lottery/*.js",
    "tests/member-lottery-loader.test.js",
    "tests/lottery-draw-service.test.js",
  ]) {
    assert.ok(workflow.includes(scriptPath), `workflow is missing ${scriptPath}`);
  }
  assert.match(workflow, /node --test[\s\S]*lottery-activation-compatibility\.test\.js/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /git\s+push/);
});

test("lazy V2 facade preserves deterministic module dependency order", () => {
  let previous = -1;
  for (const source of lazyBoundary) {
    const current = loader.indexOf(`"${source}"`);
    assert.notEqual(current, -1, `missing ${source}`);
    assert.equal(current > previous, true, `${source} is out of dependency order`);
    previous = current;
  }
  assert.match(loader, /root\.MemberLotteryDialog\s*=\s*facade/);
});
