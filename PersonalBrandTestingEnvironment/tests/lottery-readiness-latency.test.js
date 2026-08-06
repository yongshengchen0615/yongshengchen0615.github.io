const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("ticket preparation reuses the already loaded workspace before the authoritative draw", () => {
  const source = read("client/lottery/preparation-service.js");
  const performPrepare = source.slice(
    source.indexOf("function performPrepare"),
    source.indexOf("function prepare(ticketValue)")
  );

  assert.match(performPrepare, /\.load\(\{ allowStale: true \}\)/);
  assert.doesNotMatch(performPrepare, /\.load\(\{ force: true \}\)/);
  assert.equal(
    (performPrepare.match(/\.request\(\s*"drawLottery"/g) || []).length,
    1
  );
});

test("workspace service supports stale preview reuse without weakening explicit refresh", () => {
  const source = read("client/lottery/workspace-service.js");

  assert.match(source, /allowStale = loadOptions\.allowStale === true/);
  assert.match(source, /allowStale && cachedResponse/);
  assert.match(source, /force = loadOptions\.force === true/);
  assert.match(source, /options\.request\("getLotteryConfig"/);
  assert.match(source, /persona:lottery-performance/);
});

test("preparation UI exposes actionable stages and a slow-network recovery message", () => {
  const source = read("client/lottery/dialog-view.js");

  [
    "正在確認抽獎券",
    "正在取得最新獎項",
    "正在保存抽獎結果",
    "正在建立轉盤",
    "網路較慢，仍在安全確認",
    "不會重複使用抽獎券",
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

test("wheel click remains an in-memory-only path", () => {
  const source = read("client/lottery/dialog-controller.js");
  const handleSpin = source.slice(
    source.indexOf("function handleSpin"),
    source.indexOf("function retry()")
  );

  assert.match(handleSpin, /resolvePrepared/);
  assert.doesNotMatch(handleSpin, /getLotteryConfig|drawLottery|options\.request/);
});
