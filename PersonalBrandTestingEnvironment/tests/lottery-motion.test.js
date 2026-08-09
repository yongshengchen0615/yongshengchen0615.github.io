const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const contracts = fs.readFileSync(
  path.join(root, "client/lottery/contracts.js"),
  "utf8"
);
const animator = fs.readFileSync(
  path.join(root, "client/lottery/wheel-animator.js"),
  "utf8"
);
const store = fs.readFileSync(
  path.join(root, "client/lottery/pending-request-store.js"),
  "utf8"
);
const preparationService = fs.readFileSync(
  path.join(root, "client/lottery/preparation-service.js"),
  "utf8"
);
const drawService = fs.readFileSync(
  path.join(root, "client/lottery/draw-service.js"),
  "utf8"
);
const controller = fs.readFileSync(
  path.join(root, "client/lottery/dialog-controller.js"),
  "utf8"
);
const view = fs.readFileSync(
  path.join(root, "client/lottery/dialog-view.js"),
  "utf8"
);
const hostScript = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
const legacyHtml = fs.readFileSync(path.join(root, "client/lottery.html"), "utf8");

function getFunctionContaining(source, marker) {
  const match = marker.exec(source);
  assert.ok(match, `missing source marker ${marker}`);

  const functionIndex = source.lastIndexOf("function ", match.index);
  assert.notEqual(functionIndex, -1, `missing function for marker ${marker}`);
  const lineStart = source.lastIndexOf("\n", functionIndex) + 1;
  const indentation = source.slice(lineStart, functionIndex);
  assert.match(indentation, /^\s*$/, `function ${marker} has invalid indentation`);

  const nextFunction = source.indexOf(
    `\n${indentation}function `,
    match.index + match[0].length
  );
  return source.slice(lineStart, nextFunction === -1 ? source.length : nextFunction);
}

test("member lottery v2 uses one deterministic accelerate-cruise-decelerate reveal", () => {
  assert.match(animator, /FULL_SPIN_TURNS\s*=\s*8/);
  assert.match(animator, /ACCEL_DURATION_MS\s*=\s*320/);
  assert.match(animator, /CRUISE_DURATION_MS\s*=\s*760/);
  assert.match(animator, /DECEL_DURATION_MS\s*=\s*2400/);
  assert.match(animator, /function\s+rampDistance\s*\(/);
  assert.match(animator, /function\s+decelDistance\s*\(/);
  assert.match(animator, /peakVelocity\s*=\s*rotationDelta\s*\/\s*weightedDuration/);
  assert.match(animator, /function\s+spinTo\s*\(/);
  assert.match(animator, /function\s+settle\s*\([\s\S]*return spinTo\(/);
  assert.match(animator, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(animator, /startPendingSpin|PENDING_DEGREES_PER_MS|pendingFrame|pendingLastTime/);
  assert.doesNotMatch(animator, /startWaiting|waitingFrame|waitingLastTime/);
});

test("pending reveal ids are created only by draw service and reused for retries", () => {
  const ensurePending = getFunctionContaining(store, /function\s+ensure\s*\(/);
  const readPending = getFunctionContaining(store, /function\s+read\s*\(/);
  const prepare = getFunctionContaining(
    preparationService,
    /function\s+performPrepare\s*\(/
  );
  const draw = getFunctionContaining(drawService, /function\s+draw\s*\(/);
  const spin = getFunctionContaining(controller, /function\s+handleSpin\s*\(/);

  assert.match(ensurePending, /var\s+stored\s*=\s*read\(\)/);
  assert.match(
    ensurePending,
    /stored\.cardRoundKey\s*!==\s*ticket\.cardRoundKey[\s\S]*stored\.lotteryTypeId\s*!==\s*ticket\.lotteryTypeId/
  );
  assert.match(ensurePending, /return\s+stored/);
  assert.match(ensurePending, /options\.createRequestId\(\)/);
  assert.match(ensurePending, /storage\.setItem\(storageKey,\s*JSON\.stringify\(request\)\)/);
  assert.match(readPending, /storage\.getItem\(storageKey\)/);
  assert.match(store, /if\s*\(safeIsDemo\(\)\)/);
  assert.match(store, /REQUEST_STORAGE_PREFIX\s*\+\s*liffId\s*\+\s*["']:demo["']/);
  assert.match(store, /\/\^MBR-\[A-Z0-9\]\{10\}\$\//);

  assert.doesNotMatch(prepare, /\.ensure\(|drawLottery/);
  assert.match(
    draw,
    /request\s*=\s*options\.store\.ensure\(ticket\)[\s\S]*options\.request\(\s*["']drawLottery["'][\s\S]*request\.requestId/
  );
  assert.match(spin, /performDraw/);
  assert.doesNotMatch(spin, /options\.request\(/);
});

test("central reveal click has no prize-agnostic waiting spin or backend-status copy", () => {
  const spin = getFunctionContaining(controller, /function\s+handleSpin\s*\(/);
  const drawIndex = spin.indexOf("drawPromise = performDraw()");
  const responseIndex = spin.indexOf(".then(function (response)");
  const settleIndex = spin.indexOf(".settle(result.draw, result.selectedType.lottery)");

  assert.ok(drawIndex >= 0, "draw service should create or reuse the reveal request id");
  assert.ok(responseIndex > drawIndex, "prepared result should be normalized after draw service resolves");
  assert.ok(settleIndex > responseIndex, "wheel motion should start only after the prepared result is known");
  assert.doesNotMatch(spin, /startPendingSpin|getLotteryConfig|options\.request/);
  assert.doesNotMatch(spin, /向後端確認/);
  assert.match(spin, /正在揭曉抽獎結果/);
});

test("only definitive no-draw failures release the persisted request", () => {
  const definitiveFailure = getFunctionContaining(
    contracts,
    /function\s+isDefinitiveNoDrawError\s*\(/
  );
  const draw = getFunctionContaining(drawService, /function\s+draw\s*\(/);

  assert.match(definitiveFailure, /LOTTERY_ROUND_NOT_READY/);
  assert.match(definitiveFailure, /LOTTERY_TICKET_MISMATCH/);
  assert.match(definitiveFailure, /INVALID_LOTTERY_TICKET/);
  assert.doesNotMatch(definitiveFailure, /BACKEND_TIMEOUT|BUSY|INVALID_RESPONSE/);
  assert.match(
    draw,
    /contracts\.isDefinitiveNoDrawError\(error\)[\s\S]*clear\(\)/
  );
});

test("member lottery v2 cannot close while preparing, revealing, or awaiting retry", () => {
  const canClose = getFunctionContaining(controller, /function\s+canClose\s*\(/);
  const requestClose = getFunctionContaining(
    controller,
    /function\s+requestClose\s*\(/
  );
  const updateControls = getFunctionContaining(
    view,
    /function\s+updateControls\s*\(/
  );
  const bind = getFunctionContaining(view, /function\s+bind\s*\(/);

  assert.match(
    canClose,
    /return\s+!isPreparing\s*&&\s*!isBusy\s*&&\s*!getPending\(\)/
  );
  assert.match(
    requestClose,
    /if\s*\(!canClose\(\)\)[\s\S]*return false/
  );
  assert.match(requestClose, /揭曉動畫正在播放中/);
  assert.match(updateControls, /member-lottery-close-button/);
  assert.match(updateControls, /member-lottery-return-button/);
  assert.match(updateControls, /button\.disabled\s*=\s*state\.canClose\s*!==\s*true/);
  assert.match(
    bind,
    /dialog\.addEventListener\(["']cancel["'][\s\S]*event\.preventDefault\(\)[\s\S]*handlers\.onClose/
  );
  assert.match(
    bind,
    /dialog\.addEventListener\(\s*["']click["'][\s\S]*event\.target\s*!==\s*dialog[\s\S]*handlers\.onClose/
  );
  assert.match(
    bind,
    /runtime\.addEventListener\(["']beforeunload["'][\s\S]*handlers\.canClose\(\)[\s\S]*event\.preventDefault\(\)[\s\S]*event\.returnValue\s*=\s*["']["']/
  );
  assert.match(
    hostScript,
    /dialog\.id\s*===\s*["']member-lottery-dialog["'][\s\S]*!window\.MemberLotteryDialog\.canClose\(\)[\s\S]*!force[\s\S]*return/
  );
  assert.match(view, /typeof\s+dialog\.showModal\s*===\s*["']function["']/);
});

test("legacy lottery URL is compatibility-only and no second lottery implementation remains", () => {
  assert.match(legacyHtml, /searchParams|URLSearchParams/);
  assert.match(legacyHtml, /params\.set\(["']panel["'],\s*["']tickets["']\)/);
  assert.match(legacyHtml, /window\.location\.replace\(target\.toString\(\)\)/);
  assert.equal(fs.existsSync(path.join(root, "client/lottery.js")), false);
  assert.equal(fs.existsSync(path.join(root, "client/member-lottery.js")), false);
  assert.equal(
    fs.existsSync(path.join(root, "client/lottery/wheel-draw-guard.js")),
    false
  );
});