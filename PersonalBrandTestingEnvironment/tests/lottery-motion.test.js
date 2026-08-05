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
const service = fs.readFileSync(
  path.join(root, "client/lottery/preparation-service.js"),
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
const legacyScript = fs.readFileSync(path.join(root, "client/lottery.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "client/styles.css"), "utf8");

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
  assert.match(animator, /SPIN_DEGREES_PER_MS\s*=\s*1\.45/);
  assert.match(animator, /FINAL_SPIN_TURNS\s*=\s*2/);
  assert.match(
    animator,
    /duration\s*=\s*\(2\s*\*\s*rotationDelta\)\s*\/\s*SPIN_DEGREES_PER_MS/
  );
  assert.match(
    animator,
    /quadraticEaseOut\s*=\s*1\s*-\s*Math\.pow\(1\s*-\s*progress,\s*2\)/
  );
  assert.match(
    animator,
    /smoothstepCorrection\s*=\s*Math\.pow\(progress\s*\*\s*\(1\s*-\s*progress\),\s*2\)/
  );
  assert.match(
    animator,
    /rotationDelta\s*\*\s*\(quadraticEaseOut\s*\+\s*smoothstepCorrection\)/
  );
  assert.match(animator, /prefers-reduced-motion:\s*reduce/);
});

test("member lottery v2 retries a pending draw with the same persisted request id", () => {
  const ensurePending = getFunctionContaining(store, /function\s+ensure\s*\(/);
  const readPending = getFunctionContaining(store, /function\s+read\s*\(/);
  const prepare = getFunctionContaining(service, /function\s+prepare\s*\(/);
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
  assert.match(
    prepare,
    /request\s*=\s*options\.store\.ensure\(ticket\)[\s\S]*options\.request\(\s*["']drawLottery["'][\s\S]*request\.requestId/
  );
  assert.match(
    spin,
    /preparationService\.resolvePrepared\(\s*selectedTicket,\s*pending\.requestId/
  );
  assert.doesNotMatch(spin, /options\.request\(|["']drawLottery["']/);
});

test("member lottery v2 releases only definitive no-draw failures and refreshes the card", () => {
  const definitiveFailure = getFunctionContaining(
    contracts,
    /function\s+isDefinitiveNoDrawError\s*\(/
  );
  const refreshCard = getFunctionContaining(
    service,
    /function\s+refreshHostCard\s*\(/
  );
  const prepare = getFunctionContaining(service, /function\s+prepare\s*\(/);

  assert.match(definitiveFailure, /LOTTERY_ROUND_NOT_READY/);
  assert.match(definitiveFailure, /LOTTERY_TICKET_MISMATCH/);
  assert.match(definitiveFailure, /INVALID_LOTTERY_TICKET/);
  assert.doesNotMatch(definitiveFailure, /BACKEND_TIMEOUT|BUSY|INVALID_RESPONSE/);
  assert.match(refreshCard, /options\.request\(["']getLotteryConfig["']/);
  assert.match(
    refreshCard,
    /response\.data[\s\S]*response\.data\.card[\s\S]*safeCardUpdated\(response\.data\.card,\s*totalPoints\)/
  );
  assert.match(
    prepare,
    /contracts\.isDefinitiveNoDrawError\(error\)[\s\S]*options\.store\.clear\(\)[\s\S]*options\.guard\.clear\(\)[\s\S]*refreshHostCard\(\)/
  );
});

test("member lottery v2 cannot close or leave while spinning or awaiting confirmation", () => {
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

  assert.match(canClose, /return\s+!isBusy\s*&&\s*!getPending\(\)/);
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

test("legacy lottery page still locks all navigation during a draw", () => {
  assert.match(legacyScript, /setMemberRoutesLocked\(isBusy\)/);
  assert.match(
    legacyScript,
    /link\.setAttribute\(["']aria-disabled["'],\s*["']true["']\)/
  );
  assert.match(
    legacyScript,
    /document\.addEventListener\(["']click["'],\s*preventMemberRouteDuringSpin,\s*true\)/
  );
  assert.match(
    legacyScript,
    /window\.addEventListener\(["']beforeunload["'],\s*preventPageExitDuringSpin\)/
  );
  assert.match(
    styles,
    /\.lottery-page\s+\[data-member-route\]\[aria-disabled=["']true["']\]\s*\{[^}]*pointer-events:\s*none/s
  );
});
