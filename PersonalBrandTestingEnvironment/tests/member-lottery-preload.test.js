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

test("lottery result is prepared before the central spin action", () => {
  assert.match(source, /request\(\s*"drawLottery"/);
  assert.match(source, /prepared\[pending\.requestId\]/);
  assert.match(source, /action !== "drawLottery"/);
  assert.match(source, /REVEAL_DELAY_MS = 1250/);
  assert.match(source, /正在安全準備抽獎結果/);
  assert.match(source, /轉盤已就緒，點選中央直接揭曉結果/);
});

test("unknown preparation results retain the same pending request id", () => {
  assert.match(source, /window\.sessionStorage\.setItem\(key, JSON\.stringify\(value\)\)/);
  assert.match(source, /requestId: window\.MemberApi\.createRequestId\(\)/);
  assert.match(source, /request\([\s\S]*pending\.requestId/);
  assert.match(source, /if \(definitive\) clearPending\(\)/);
});
