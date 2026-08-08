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

test("member lottery v2 settles quickly with a continuous fast-to-slow curve", () => {
  assert.match(animator, /INITIAL_DEGREES_PER_MS\s*=\s*1\.45/);
  assert.match(animator, /FINAL_SPIN_TURNS\s*=\s*3/);
  assert.match(animator, /MIN_DURATION_MS\s*=\s*2200/);
  assert.match(animator, /MAX_DURATION_MS\s*=\s*3200/);
  assert.match(
    animator,
    /\(3\s*\*\s*rotationDelta\)\s*\/\s*INITIAL_DEGREES_PER_MS/
  );
  assert.match(
    animator,
    /eased\s*=\s*1\s*-\s*Math\.pow\(1\s*-\s*progress,\s*3\)/
  );
  assert.match(animator, /rotationDelta\s*\*\s*eased/);
  assert.match(animator, /prefers-reduced-motion:\s*reduce/);
  assert.match(animator, /function\s+prepare\s*\(/);
  assert.match(animator, /function\s+startPendingSpin\s*\(/);
  assert.doesNotMatch(animator, /startWaiting|waitingFrame|waitingLastTime/);
});

test("pending draw ids are created only by draw service and reused for retries", () => {
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

test("central draw click starts prize-agnostic motion before awaiting the authoritative result", () => {
  const spin = getFunctionContaining(controller, /function\s+handleSpin\s*\(/);
  const drawIndex = spin.indexOf("drawPromise = performDraw()");
  const pendingSpinIndex = spin.indexOf("animator.startPendingSpin()");
  const responseIndex = spin.indexOf(".then(function (response)");

  assert.ok(drawIndex >= 0, "draw service should be invoked synchronously so requestId exists first");
  assert.ok(
    pendingSpinIndex > drawIndex,
    "pending motion must start after the persistent draw request is created"
  );
  assert.ok(
    responseIndex > pendingSpinIndex,
    "pending motion must begin before the authoritative response is handled"
  );
  assert.doesNotMatch(spin, /getLotteryConfig/);
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

test("member lottery v2 cannot close while preparing, drawing, or awaiting retry", () => {
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