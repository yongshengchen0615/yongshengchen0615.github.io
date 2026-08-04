const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "client/member-lottery.js"), "utf8");
const hostScript = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
const legacyScript = fs.readFileSync(path.join(root, "client/lottery.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "client/styles.css"), "utf8");

function getTopLevelFunctionContaining(source, marker) {
  const match = marker.exec(source);
  assert.ok(match, `missing source marker ${marker}`);

  const start = source.lastIndexOf("\n  function ", match.index);
  assert.notEqual(start, -1, `marker ${marker} must be inside a top-level function`);

  const end = source.indexOf("\n  function ", match.index + match[0].length);
  return source.slice(start + 1, end === -1 ? source.length : end);
}

test("in-place member lottery runs five seconds with a continuous fast-to-slow curve", () => {
  assert.match(script, /SPIN_DURATION_MS\s*=\s*5000/);
  assert.match(script, /FINAL_SPIN_TURNS\s*=\s*8/);
  assert.match(
    script,
    /easeOutCubic\s*=\s*1\s*-\s*Math\.pow\(1\s*-\s*progress,\s*3\)/
  );
  assert.match(
    script,
    /easedProgress\s*=\s*easeOutCubic/
  );
});

test("member lottery retries a pending draw with the same persisted request id", () => {
  const ensurePending = getTopLevelFunctionContaining(
    script,
    /function\s+ensurePendingRequest\s*\(/
  );
  const readPending = getTopLevelFunctionContaining(
    script,
    /function\s+readPendingRequest\s*\(/
  );
  const handleDraw = getTopLevelFunctionContaining(
    script,
    /function\s+handleDraw\s*\(/
  );
  const loadWorkspace = getTopLevelFunctionContaining(
    script,
    /function\s+loadWorkspace\s*\(/
  );
  const finishDraw = getTopLevelFunctionContaining(
    script,
    /function\s+finishDraw\s*\(/
  );
  const storageKey = getTopLevelFunctionContaining(
    script,
    /function\s+getRequestStorageKey\s*\(/
  );

  assert.match(ensurePending, /var\s+storageKey\s*=\s*getRequestStorageKey\(\)/);
  assert.match(ensurePending, /var\s+stored\s*=\s*readPendingRequest\(\)/);
  assert.match(
    ensurePending,
    /stored\.lotteryTypeId\s*!==\s*ticket\.lotteryTypeId[\s\S]*stored\.cardRoundKey\s*!==\s*ticket\.cardRoundKey/
  );
  assert.match(
    ensurePending,
    /return\s+stored[\s\S]*window\.MemberApi\.createRequestId\(\)/
  );
  assert.match(ensurePending, /window\.sessionStorage\.setItem\(/);
  assert.match(readPending, /window\.sessionStorage\.getItem\(/);
  assert.match(
    readPending,
    /pendingRequestStorageKey\s*!==\s*storageKey[\s\S]*pendingRequest\s*=\s*null/
  );
  assert.match(storageKey, /if\s*\(safeIsDemo\(\)\)/);
  assert.match(storageKey, /options\.liffId\s*\+\s*["']:demo["']/);
  assert.match(storageKey, /\/\^MBR-\[A-Z0-9\]\{10\}\$\//);
  assert.match(
    storageKey,
    /REQUEST_STORAGE_PREFIX\s*\+\s*options\.liffId\s*\+\s*["']:["']\s*\+\s*memberId/
  );
  assert.match(
    loadWorkspace,
    /pendingRequest\s*=\s*ensurePendingRequest\(selectedTicket\)[\s\S]*options\.request\(\s*["']prepareLotteryDraw["'][\s\S]*pendingRequest\.requestId/
  );
  assert.match(handleDraw, /finishDraw\(preparedDrawData\)/);
  assert.doesNotMatch(handleDraw, /options\.request|startWaitingSpin/);
  assert.match(
    finishDraw,
    /animateToPrize\([^)]*\)\.then\([\s\S]*clearPendingRequest\(\)/
  );
});

test("member lottery releases only definitive preparation failures and refreshes the card", () => {
  const loadWorkspace = getTopLevelFunctionContaining(
    script,
    /function\s+loadWorkspace\s*\(/
  );
  const definitiveFailure = getTopLevelFunctionContaining(
    script,
    /function\s+isDefinitiveNoDrawError\s*\(/
  );
  const refreshCard = getTopLevelFunctionContaining(
    script,
    /function\s+refreshHostCardAfterNoDraw\s*\(/
  );

  assert.match(
    loadWorkspace,
    /isDefinitiveNoDrawError\(error\)[\s\S]*clearPendingRequest\(\)[\s\S]*refreshHostCardAfterNoDraw\(\)/
  );
  assert.match(definitiveFailure, /LOTTERY_ROUND_NOT_READY/);
  assert.match(definitiveFailure, /LOTTERY_TICKET_MISMATCH/);
  assert.match(definitiveFailure, /INVALID_LOTTERY_TICKET/);
  assert.doesNotMatch(definitiveFailure, /BACKEND_TIMEOUT|BUSY|INVALID_RESPONSE/);
  assert.match(refreshCard, /options\.request\(["']getLotteryConfig["']/);
  assert.match(
    refreshCard,
    /normalizeWorkspace\(response\.data\)[\s\S]*safeCardUpdated\(cardStatus,\s*workspace\.totalPoints\)/
  );
});

test("member lottery cannot close or leave while spinning or awaiting confirmation", () => {
  const canClose = getTopLevelFunctionContaining(
    script,
    /function\s+canClose\s*\(/
  );
  const requestClose = getTopLevelFunctionContaining(
    script,
    /function\s+requestClose\s*\(/
  );
  const updateControls = getTopLevelFunctionContaining(
    script,
    /function\s+updateControls\s*\(/
  );
  const bindInteractions = getTopLevelFunctionContaining(
    script,
    /function\s+bindInteractions\s*\(/
  );

  assert.match(canClose, /!isBusy\s*&&\s*!readPendingRequest\(\)/);
  assert.match(
    requestClose,
    /if\s*\(!canClose\(\)\)[\s\S]*return false/
  );
  assert.match(updateControls, /var\s+closeDisabled\s*=\s*!canClose\(\)/);
  assert.match(updateControls, /member-lottery-close-button/);
  assert.match(updateControls, /member-lottery-return-button/);
  assert.match(updateControls, /button\.disabled\s*=\s*closeDisabled/);
  assert.match(
    bindInteractions,
    /dialog\.addEventListener\(["']cancel["'][\s\S]*event\.preventDefault\(\)[\s\S]*requestClose\(\)/
  );
  assert.match(
    bindInteractions,
    /dialog\.addEventListener\(\s*["']click["'][\s\S]*event\.target\s*!==\s*dialog[\s\S]*requestClose\(/
  );
  assert.match(
    bindInteractions,
    /window\.addEventListener\(["']beforeunload["'][\s\S]*if\s*\(canClose\(\)\)\s*return[\s\S]*event\.preventDefault\(\)[\s\S]*event\.returnValue\s*=\s*["']["']/
  );
  assert.match(
    hostScript,
    /dialog\.id\s*===\s*["']member-lottery-dialog["'][\s\S]*!window\.MemberLotteryDialog\.canClose\(\)[\s\S]*!force[\s\S]*return/
  );
  assert.match(script, /typeof\s+dialog\.showModal\s*===\s*["']function["']/);
});

test("legacy lottery page still locks all navigation during a draw", () => {
  assert.match(
    legacyScript,
    /setMemberRoutesLocked\(\s*lockedByPreparedTransaction\s*\)/
  );
  assert.match(
    legacyScript,
    /link\.setAttribute\(\s*["']aria-disabled["'],\s*["']true["']\s*\)/
  );
  assert.match(
    legacyScript,
    /document\.addEventListener\(\s*["']click["'],\s*preventMemberRouteDuringSpin,\s*true\s*\)/
  );
  assert.match(
    legacyScript,
    /window\.addEventListener\(\s*["']beforeunload["'],\s*preventPageExitDuringSpin\s*\)/
  );
  assert.match(
    styles,
    /\.lottery-page\s+\[data-member-route\]\[aria-disabled=["']true["']\]\s*\{[^}]*pointer-events:\s*none/s
  );
});
