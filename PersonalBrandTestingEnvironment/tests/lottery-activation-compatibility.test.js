const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
const workflow = fs.readFileSync(
  path.resolve(root, "..", ".github/workflows/deploy-personal-brand-lottery.yml"),
  "utf8"
);

const v2Boundary = [
  '    <script defer src="../shared/lottery-wheel.js"></script>',
  '    <script defer src="../shared/module-registry.js"></script>',
  '    <script defer src="lottery/contracts.js"></script>',
  '    <script defer src="lottery/pending-request-store.js"></script>',
  '    <script defer src="lottery/preparation-service.js"></script>',
  '    <script defer src="lottery/wheel-draw-guard.js"></script>',
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
  assert.equal(
    index.includes('src="member-lottery.js"'),
    false,
    "client/index.html must not download the superseded legacy facade"
  );
});

test("lottery workflow validates V2 without mutating the deployment branch", () => {
  for (const scriptPath of [
    "shared/lottery-wheel.js",
    "shared/module-registry.js",
    "client/member-lottery-v2.js",
    "client/lottery/*.js",
  ]) {
    assert.ok(workflow.includes(scriptPath), `workflow is missing ${scriptPath}`);
  }
  assert.match(workflow, /node --test[\s\S]*lottery-activation-compatibility\.test\.js/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /git\s+push/);
  assert.doesNotMatch(workflow, /activate-v2:/);
});

test("V2 facade loads after its modules and before host configuration", () => {
  const registryAt = v2Boundary.indexOf('src="../shared/module-registry.js"');
  const controllerAt = v2Boundary.indexOf('src="lottery/dialog-controller.js"');
  const v2At = v2Boundary.indexOf('src="member-lottery-v2.js"');
  const hostAt = v2Boundary.indexOf('src="script.js"');
  assert.equal(
    registryAt >= 0 && controllerAt > registryAt && v2At > controllerAt && hostAt > v2At,
    true
  );
});
