const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("ticket preparation uses authoritative workspace with only a bounded fresh reuse window", () => {
  const source = read("client/lottery/preparation-service.js");
  const performPrepare = source.slice(
    source.indexOf("function performPrepare"),
    source.indexOf("function prepare(ticketValue")
  );

  assert.match(
    performPrepare,
    /\.load\(\{\s*force:\s*true,\s*maxAgeMs:\s*selectionMaxAgeMs\s*\}\)/
  );
  assert.match(source, /DEFAULT_SELECTION_MAX_AGE_MS\s*=\s*2000/);
  assert.doesNotMatch(performPrepare, /allowStale/);
  assert.doesNotMatch(performPrepare, /drawLottery|\.ensure\(/);
});

test("workspace service bounds stale preview reuse without weakening explicit refresh", () => {
  const source = read("client/lottery/workspace-service.js");

  assert.match(source, /allowStale = loadOptions\.allowStale === true/);
  assert.match(source, /allowStale && isUsableStale\(\)/);
  assert.match(source, /DEFAULT_MAX_STALE_MS/);
  assert.match(source, /force = loadOptions\.force === true/);
  assert.match(source, /maxAgeMs = Number\(loadOptions\.maxAgeMs\)/);
  assert.match(source, /options\.request\("getLotteryConfig"/);
  assert.match(source, /persona:lottery-performance/);
});

test("preparation UI states explicitly say no draw occurs before ready", () => {
  const source = read("client/lottery/dialog-view.js");

  [
    "正在確認抽獎券",
    "正在取得最新獎項",
    "此階段不會開獎",
    "不會使用抽獎券",
    "只有點選中央後才會正式送出抽獎請求",
  ].forEach((text) => assert.match(source, new RegExp(text)));
  assert.match(source, /ticket_to_ready/);
  assert.match(source, /persona:lottery-phase/);
});

test("canvas preparation reports bounded diagnostics without backend calls", () => {
  const source = read("client/lottery/wheel-animator.js");

  assert.match(source, /canvas_draw/);
  assert.match(source, /wheel_prepare/);
  assert.doesNotMatch(source, /getLotteryConfig|drawLottery/);
});

test("wheel click delegates mutation to draw service without reloading config", () => {
  const source = read("client/lottery/dialog-controller.js");
  const handleSpin = source.slice(
    source.indexOf("function handleSpin"),
    source.indexOf("function retry()")
  );

  assert.match(source, /drawService\.draw\(selectedTicket\)/);
  assert.doesNotMatch(handleSpin, /getLotteryConfig|options\.request/);
});
