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

test("member startup keeps wheel and internal lottery runtime off the unauthenticated HTML path", () => {
  assert.match(html, /src=["']member-lottery-loader\.js["']/);
  assert.doesNotMatch(html, /src=["']\.\.\/shared\/lottery-wheel\.js["']/);
  assert.doesNotMatch(html, /src=["']lottery\//);
  assert.match(loader, /REGISTRY_SOURCE\s*=\s*["']\.\.\/shared\/module-registry\.js["']/);
  assert.match(loader, /["']\.\.\/shared\/lottery-wheel\.js["']/);
});

test("host triggers Lottery session preload after an authenticated member has a usable reward", () => {
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
  assert.doesNotMatch(body, /drawLottery|createRequestId|requestId/);
});

test("loader prewarm loads runtime plus one authoritative session workspace", () => {
  const loadStart = loader.indexOf("function loadSessionConfig()");
  const loadEnd = loader.indexOf("function preloadSession", loadStart);
  assert.notEqual(loadStart, -1);
  assert.notEqual(loadEnd, -1);
  const loadBody = loader.slice(loadStart, loadEnd);

  assert.match(loadBody, /rawRequest\("getLotteryConfig", \{\}, undefined\)/);
  assert.match(loadBody, /sessionConfigResponse/);
  assert.doesNotMatch(loadBody, /drawLottery|createRequestId|\brequestId\b/);

  const preloadStart = loader.indexOf("function preloadSession()");
  const preloadEnd = loader.indexOf("function prewarm()", preloadStart);
  assert.notEqual(preloadStart, -1);
  assert.notEqual(preloadEnd, -1);
  const preloadBody = loader.slice(preloadStart, preloadEnd);

  assert.match(preloadBody, /ensureLoaded\(\)/);
  assert.match(preloadBody, /loadSessionConfig\(\)/);
  assert.match(preloadBody, /controller\.refreshTickets\(\{ force: true \}\)/);
  assert.doesNotMatch(preloadBody, /drawLottery|createRequestId|\brequestId\b/);
  assert.match(loader, /function prewarm\(\)[\s\S]*return preloadSession\(\)/);

  const refreshStart = loader.indexOf("function refreshTickets()");
  const refreshEnd = loader.indexOf("function restorePending", refreshStart);
  assert.notEqual(refreshStart, -1);
  assert.notEqual(refreshEnd, -1);
  const refreshBody = loader.slice(refreshStart, refreshEnd);
  assert.doesNotMatch(
    refreshBody,
    /rawRequest|getLotteryConfig|ensureLoaded|controller\.refreshTickets/
  );
  assert.match(refreshBody, /currentCardSummary\(\)/);
});

test("loader uses registry-first parallel definitions and an entry-last composition phase", () => {
  const start = loader.indexOf("function ensureLoaded()");
  const end = loader.indexOf("function getSessionConfigView", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = loader.slice(start, end);

  assert.match(body, /loadScript\(REGISTRY_SOURCE\)/);
  assert.match(body, /Promise\.all\(/);
  assert.match(body, /RUNTIME_SOURCES\.map/);
  assert.match(body, /loadScript\(ENTRY_SOURCE\)/);
  assert.match(body, /lottery_runtime_load/);
});

test("host startup no longer requires LotteryWheel before lazy runtime activation", () => {
  const start = host.indexOf("function configureMemberLotteryDialog()");
  const end = host.indexOf("function openPointHistoryDialog", start);
  const body = host.slice(start, end);

  assert.match(body, /if\s*\(!window\.MemberLotteryDialog\)/);
  assert.doesNotMatch(body, /!window\.LotteryWheel/);
});
