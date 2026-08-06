const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

function functionBody(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] || "";
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

test("member and administrator startup calls share one in-flight promise", () => {
  const member = read("client/script.js");
  const admin = read("admin/script.js");
  for (const source of [member, admin]) {
    const start = functionBody(source, "start");
    assert.match(start, /if \(startPromise\) return startPromise/);
    assert.match(start, /startPromise = promise/);
    assert.match(start, /if \(startPromise === promise\) startPromise = null/);
  }
});

test("history and lottery reads return the active promise instead of resolving early", () => {
  const member = read("client/script.js");
  const admin = read("admin/script.js");
  assert.match(
    functionBody(member, "loadPointHistory"),
    /if \(pointHistoryLoadPromise\) return pointHistoryLoadPromise/
  );
  assert.match(
    functionBody(admin, "fetchPointHistory"),
    /if \(pointHistoryLoadPromise\) return pointHistoryLoadPromise/
  );
  assert.match(
    functionBody(admin, "fetchLotteryConfig"),
    /if \(lotteryConfigLoadPromise\) return lotteryConfigLoadPromise/
  );
  assert.match(
    functionBody(admin, "fetchLotteryHistory"),
    /if \(lotteryHistoryLoadPromise\) return lotteryHistoryLoadPromise/
  );
});

test("member history initialization lock is released before ledger scanning", () => {
  const gas = read("gas/client/Code.gs");
  const list = functionBody(gas, "listPointHistory_");
  assert.match(list, /initializationLock\.tryLock\(4000\)/);
  assert.ok(
    list.indexOf("initializationLock.releaseLock()") <
      list.indexOf("getMemberPointBalance_("),
    "the read-only history scan must run after the initialization lock is released"
  );
});

test("member history validates ownership before parsing owner-specific records", () => {
  const gas = read("gas/client/Code.gs");
  const points = functionBody(gas, "readMemberPointHistory_");
  const draws = functionBody(gas, "readMemberLotteryHistory_");

  assert.ok(
    points.indexOf("if (storedLineUserId !== lineUserId) return") <
      points.indexOf("var redemptionId ="),
    "another member's malformed redemption payload must not block this member"
  );
  assert.ok(
    draws.indexOf("if (storedLineUserId !== lineUserId) return") <
      draws.indexOf("lotteryDrawRecordFromRow_(row)"),
    "another member's malformed draw payload must not block this member"
  );
});

test("administrator history locks cover authorization only, not sorting and formatting", () => {
  const gas = read("gas/admin/Code.gs");
  for (const name of ["adminListPointHistory_", "adminListLotteryDraws_"]) {
    const body = functionBody(gas, name);
    assert.match(body, /authorizationLock\.tryLock\(4000\)/);
    const releaseAt = body.indexOf("authorizationLock.releaseLock()");
    const heavyReadAt = Math.max(
      body.indexOf("readAdminPointHistory_("),
      body.indexOf("readAdminLotteryDraws_(")
    );
    assert.ok(releaseAt >= 0 && heavyReadAt > releaseAt, `${name} keeps a long read inside the lock`);
  }
});
