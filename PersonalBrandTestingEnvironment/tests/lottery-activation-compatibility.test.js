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

const legacyBoundary = [
  '    <script defer src="../shared/lottery-wheel.js"></script>',
  '    <script defer src="../shared/module-registry.js"></script>',
  '    <script defer src="member-lottery.js"></script>',
  '    <script defer src="lottery/contracts.js"></script>',
  '    <script defer src="lottery/pending-request-store.js"></script>',
  '    <script defer src="lottery/preparation-service.js"></script>',
  '    <script defer src="lottery/preparation-view.js"></script>',
  '    <script defer src="lottery/wheel-draw-guard.js"></script>',
  '    <script defer src="lottery/preload-controller.js"></script>',
  '    <script defer src="member-lottery-preload.js"></script>',
  '    <script defer src="script.js"></script>',
].join("\n");

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

test("checked-in entry is either the operational legacy boundary or activated v2", () => {
  assert.ok(
    index.includes(legacyBoundary) || index.includes(v2Boundary),
    "client/index.html contains neither a valid legacy nor v2 lottery boundary"
  );
});

test("deployment workflow activates the complete v2 boundary atomically", () => {
  for (const line of v2Boundary.split("\n")) {
    assert.ok(workflow.includes(line.trim()), `workflow is missing ${line.trim()}`);
  }
  assert.match(
    workflow,
    /git add PersonalBrandTestingEnvironment\/client\/index\.html/
  );
  assert.match(workflow, /deploy: activate member lottery v2/);
});
