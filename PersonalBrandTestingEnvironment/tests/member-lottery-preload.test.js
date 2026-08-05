const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "client/member-lottery-preload.js"),
  "utf8"
);

test("lottery preload module is valid JavaScript and wraps the existing dialog", () => {
  new vm.Script(source, { filename: "client/member-lottery-preload.js" });
  assert.match(source, /window\.MemberLotteryDialog = api/);
  assert.match(source, /original\.open\(ticket\)/);
  assert.match(source, /original\.restorePending\(\)/);
});

test("wheel data and draw result are prepared before the central spin action", () => {
  assert.match(source, /request\(\s*"drawLottery"/);
  assert.match(source, /prepared\[pending\.requestId\]/);
  assert.match(source, /action !== "drawLottery"/);
  assert.match(source, /正在準備轉盤資料與抽獎結果/);
  assert.match(source, /轉盤資料已準備完成/);
});

test("central spin returns the prepared response immediately without artificial delay", () => {
  assert.match(source, /suppressNextWheelDraw = true/);
  assert.match(source, /return Promise\.resolve\(item\.response\)/);
  assert.doesNotMatch(source, /REVEAL_DELAY_MS/);
  assert.doesNotMatch(source, /setTimeout\([\s\S]{0,120}item\.response/);
});

test("prepared result suppresses exactly one redundant wheel canvas redraw", () => {
  assert.match(source, /function installWheelDrawGuard\s*\(/);
  assert.match(source, /if \(suppressNextWheelDraw\)/);
  assert.match(source, /suppressNextWheelDraw = false/);
  assert.match(source, /return originalDraw\.apply/);
});

test("unknown preparation results retain the same pending request id", () => {
  assert.match(
    source,
    /window\.sessionStorage\.setItem\(key, JSON\.stringify\(value\)\)/
  );
  assert.match(source, /requestId: window\.MemberApi\.createRequestId\(\)/);
  assert.match(source, /request\([\s\S]*pending\.requestId/);
  assert.match(source, /if \(definitive\) clearPending\(\)/);
});
