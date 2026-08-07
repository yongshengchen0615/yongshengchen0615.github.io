const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const html = read("client/index.html");
const host = read("client/script.js");
const loader = read("client/member-lottery-loader.js");

test("member startup keeps wheel and internal lottery runtime off the initial HTML path", () => {
  assert.match(html, /src=["']member-lottery-loader\.js["']/);
  assert.doesNotMatch(html, /src=["']\.\.\/shared\/lottery-wheel\.js["']/);
  assert.doesNotMatch(html, /src=["']lottery\//);
  assert.match(loader, /REGISTRY_SOURCE\s*=\s*["']\.\.\/shared\/module-registry\.js["']/);
  assert.match(loader, /["']\.\.\/shared\/lottery-wheel\.js["']/);
});

test("host prewarms runtime only after a real member has at least one available reward", () => {
  const start = host.indexOf("function prewarmLotteryRuntime");
  const end = host.indexOf("function formatMemberCardDate", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = host.slice(start, end);

  assert.match(host, /renderMemberTicketPanels\(normalized\);\s*prewarmLotteryRuntime\(normalized\);/);
  assert.match(body, /isDemoSession/);
  assert.match(body, /Array\.isArray\(summary\.availableRewards\)/);
  assert.match(body, /summary\.availableRewards\.length\s*<\s*1/);
  assert.match(body, /MemberLotteryDialog\.prewarm\(\)/);
  assert.doesNotMatch(body, /refreshTickets|getLotteryConfig|drawLottery|createRequestId|requestId/);
});

test("loader prewarm is runtime-only and preserves user-triggered authoritative refresh", () => {
  const start = loader.indexOf("function prewarm()") ;
  const end = loader.indexOf("function getPendingStorageKey", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = loader.slice(start, end);

  assert.match(body, /ensureLoaded\(\)/);
  assert.match(body, /requestIdleCallback/);
  assert.match(body, /setTimeout\(startPrewarm,\s*250\)/);
  assert.doesNotMatch(body, /refreshTickets|getLotteryConfig|drawLottery|\brequestId\b/);

  const refreshStart = loader.indexOf("function refreshTickets(options)");
  const refreshEnd = loader.indexOf("function restorePending", refreshStart);
  const refreshBody = loader.slice(refreshStart, refreshEnd);
  assert.match(refreshBody, /ensureLoaded\(\)/);
  assert.match(refreshBody, /controller\.refreshTickets\(options\)/);
});

test("loader uses registry-first parallel definitions and an entry-last composition phase", () => {
  const start = loader.indexOf("function ensureLoaded()") ;
  const end = loader.indexOf("function prewarm()", start);
  const body = loader.slice(start, end);

  assert.match(body, /loadScript\(REGISTRY_SOURCE\)/);
  assert.match(body, /Promise\.all\(/);
  assert.match(body, /RUNTIME_SOURCES\.map/);
  assert.match(body, /loadScript\(ENTRY_SOURCE\)/);
  assert.match(body, /lottery_runtime_load/);
});

test("host startup no longer requires LotteryWheel before lazy runtime activation", () => {
  const start = host.indexOf("function configureMemberLotteryDialog()") ;
  const end = host.indexOf("function openPointHistoryDialog", start);
  const body = host.slice(start, end);

  assert.match(body, /if\s*\(!window\.MemberLotteryDialog\)/);
  assert.doesNotMatch(body, /!window\.LotteryWheel/);
});
