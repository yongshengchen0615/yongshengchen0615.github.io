const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "client/lottery.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "client/styles.css"), "utf8");

test("lottery wheel settles quickly with a continuous fast-to-slow curve", () => {
  assert.match(script, /SPIN_DEGREES_PER_MS\s*=\s*1\.45/);
  assert.match(script, /FINAL_SPIN_TURNS\s*=\s*2/);
  assert.match(
    script,
    /duration\s*=\s*\(2\s*\*\s*rotationDelta\)\s*\/\s*SPIN_DEGREES_PER_MS/
  );
  assert.match(
    script,
    /quadraticEaseOut\s*=\s*1\s*-\s*Math\.pow\(1\s*-\s*progress,\s*2\)/
  );
  assert.match(
    script,
    /smoothstepCorrection\s*=\s*Math\.pow\(progress\s*\*\s*\(1\s*-\s*progress\),\s*2\)/
  );
  assert.match(
    script,
    /easedProgress\s*=\s*quadraticEaseOut\s*\+\s*smoothstepCorrection/
  );
});

test("lottery navigation is inaccessible while a draw is spinning", () => {
  assert.match(script, /setMemberRoutesLocked\(isBusy\)/);
  assert.match(
    script,
    /link\.setAttribute\(["']aria-disabled["'],\s*["']true["']\)/
  );
  assert.match(script, /link\.setAttribute\(["']tabindex["'],\s*["']-1["']\)/);
  assert.match(
    script,
    /document\.addEventListener\(["']click["'],\s*preventMemberRouteDuringSpin,\s*true\)/
  );
  assert.match(
    script,
    /window\.addEventListener\(["']beforeunload["'],\s*preventPageExitDuringSpin\)/
  );
  assert.match(
    script,
    /lottery-wheel-back-button["']\)\.setAttribute\(\s*["']aria-disabled["']/
  );
  assert.match(
    styles,
    /\.lottery-page\s+\[data-member-route\]\[aria-disabled=["']true["']\]\s*\{[^}]*pointer-events:\s*none/s
  );
});
