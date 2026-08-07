const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
const legacyPage = fs.readFileSync(path.join(root, "client/lottery.html"), "utf8");
const workflow = fs.readFileSync(
  path.resolve(root, "..", ".github/workflows/validate-personal-brand-lottery.yml"),
  "utf8"
);

const v2Boundary = [
  '    <script defer src="../shared/lottery-wheel.js"></script>',
  '    <script defer src="../shared/module-registry.js"></script>',
  '    <script defer src="lottery/contracts.js"></script>',
  '    <script defer src="lottery/pending-request-store.js"></script>',
  '    <script defer src="lottery/workspace-service.js"></script>',
  '    <script defer src="lottery/preparation-service.js"></script>',
  '    <script defer src="lottery/draw-service.js"></script>',
  '    <script defer src="lottery/workspace-mapper.js"></script>',
  '    <script defer src="lottery/wheel-animator.js"></script>',
  '    <script defer src="lottery/dialog-view.js"></script>',
  '    <script defer src="lottery/demo-provider.js"></script>',
  '    <script defer src="lottery/dialog-controller.js"></script>',
  '    <script defer src="member-lottery-v2.js"></script>',
  '    <script defer src="script.js"></script>',
].join("\n");

test("checked-in member entry uses the direct V2 dependency boundary", () => {
  assert.ok(index.includes(v2Boundary), "client/index.html is missing the V2 lottery boundary");
  assert.equal(index.includes('src="member-lottery.js"'), false);
  assert.equal(index.includes('src="lottery/wheel-draw-guard.js"'), false);
});

test("legacy lottery deep link redirects to the V2 ticket panel", () => {
  assert.match(legacyPage, /params\.set\(["']panel["'],\s*["']tickets["']\)/);
  assert.match(legacyPage, /window\.location\.replace\(target\.toString\(\)\)/);
  assert.equal(fs.existsSync(path.join(root, "client/lottery.js")), false);
  assert.equal(fs.existsSync(path.join(root, "client/member-lottery.js")), false);
});

test("lottery workflow validates V2 without mutating the deployment branch", () => {
  for (const scriptPath of [
    "shared/lottery-wheel.js",
    "shared/module-registry.js",
    "client/member-lottery-v2.js",
    "client/lottery/*.js",
    "tests/lottery-draw-service.test.js",
  ]) {
    assert.ok(workflow.includes(scriptPath), `workflow is missing ${scriptPath}`);
  }
  assert.match(workflow, /node --test[\s\S]*lottery-activation-compatibility\.test\.js/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /git\s+push/);
});

test("V2 facade loads after its modules and before host configuration", () => {
  const registryAt = v2Boundary.indexOf('src="../shared/module-registry.js"');
  const drawAt = v2Boundary.indexOf('src="lottery/draw-service.js"');
  const controllerAt = v2Boundary.indexOf('src="lottery/dialog-controller.js"');
  const v2At = v2Boundary.indexOf('src="member-lottery-v2.js"');
  const hostAt = v2Boundary.indexOf('src="script.js"');
  assert.equal(
    registryAt >= 0 && drawAt > registryAt && controllerAt > drawAt && v2At > controllerAt && hostAt > v2At,
    true
  );
});
