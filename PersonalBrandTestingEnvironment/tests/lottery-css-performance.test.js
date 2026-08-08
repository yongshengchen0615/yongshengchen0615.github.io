const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const baseStyles = fs.readFileSync(path.join(root, "client", "styles.css"), "utf8");
const runtimeStyles = fs.readFileSync(
  path.join(root, "client", "runtime-optimizations.css"),
  "utf8"
);

test("runtime optimization layer releases the idle Lottery rotor compositing hint", () => {
  assert.match(
    baseStyles,
    /\.member-lottery-rotor\s*\{[\s\S]*?will-change:\s*transform;/,
    "baseline visual stylesheet still requests the transform hint"
  );
  assert.match(
    runtimeStyles,
    /\.member-lottery-rotor\s*\{\s*will-change:\s*auto;\s*\}/,
    "the later optimization stylesheet must release the hint while the rotor is idle"
  );
});
