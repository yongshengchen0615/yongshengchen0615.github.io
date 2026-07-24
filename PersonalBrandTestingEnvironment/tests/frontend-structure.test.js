const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const htmlFiles = [
  "index.html",
  "setup.html",
  "client/index.html",
  "client/lottery.html",
  "client/privacy.html",
  "admin/index.html",
  "admin/points.html",
  "admin/lottery.html",
];

function getTopLevelFunctionContaining(source, marker) {
  const match = marker.exec(source);
  assert.ok(match, `missing source marker ${marker}`);

  const start = source.lastIndexOf("\n  function ", match.index);
  assert.notEqual(start, -1, `marker ${marker} must be inside a top-level function`);

  const end = source.indexOf("\n  function ", match.index + match[0].length);
  return source.slice(start + 1, end === -1 ? source.length : end);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getOpeningTagById(source, id) {
  const escapedId = escapeRegExp(id);
  const match = new RegExp(
    `<([a-z][\\w:-]*)\\b[^>]*\\bid=(?:"${escapedId}"|'${escapedId}')[^>]*>`,
    "i"
  ).exec(source);
  assert.ok(match, `missing element #${id}`);
  return match[0];
}

function getElementMarkupById(source, id) {
  const escapedId = escapeRegExp(id);
  const match = new RegExp(
    `<([a-z][\\w:-]*)\\b[^>]*\\bid=(?:"${escapedId}"|'${escapedId}')[^>]*>`,
    "i"
  ).exec(source);
  assert.ok(match, `missing element #${id}`);

  const closingTag = `</${match[1]}>`;
  const end = source.indexOf(closingTag, match.index + match[0].length);
  assert.notEqual(end, -1, `element #${id} must have a closing tag`);
  return source.slice(match.index, end + closingTag.length);
}

test("split client and admin entry points reference existing local assets", () => {
  for (const relativePath of htmlFiles) {
    const absolutePath = path.join(root, relativePath);
    const html = fs.readFileSync(absolutePath, "utf8");
    const references = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);

    for (const reference of references) {
      if (/^(?:#|data:|https?:|mailto:|javascript:)/.test(reference)) continue;
      const pathname = reference.split(/[?#]/, 1)[0];
      assert.equal(
        fs.existsSync(path.resolve(path.dirname(absolutePath), pathname)),
        true,
        `${relativePath} references missing local asset ${reference}`
      );
    }
  }
});

test("HTML documents do not contain duplicate IDs", () => {
  for (const relativePath of htmlFiles) {
    const html = fs.readFileSync(path.join(root, relativePath), "utf8");
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${relativePath} contains duplicate IDs`);
  }
});

test("admin separates member records, point issuance, and lottery into isolated pages", () => {
  const memberHtml = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");
  const pointHtml = fs.readFileSync(path.join(root, "admin/points.html"), "utf8");
  const lotteryHtml = fs.readFileSync(path.join(root, "admin/lottery.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");
  const boot = getTopLevelFunctionContaining(
    script,
    /withLoginOnExternalBrowser\s*:\s*false/
  );
  const routeSync = getTopLevelFunctionContaining(
    script,
    /var\s+demo\s*=\s*isDemoSession/
  );

  assert.match(memberHtml, /<body\b[^>]*data-admin-page=["']members["']/i);
  assert.match(pointHtml, /<body\b[^>]*data-admin-page=["']points["']/i);
  assert.match(lotteryHtml, /<body\b[^>]*data-admin-page=["']lottery["']/i);
  assert.match(memberHtml, /href=["']\.\/["'][^>]*aria-current=["']page["']/i);
  assert.match(pointHtml, /href=["']points\.html["'][^>]*aria-current=["']page["']/i);
  assert.match(lotteryHtml, /href=["']lottery\.html["'][^>]*aria-current=["']page["']/i);
  for (const html of [memberHtml, pointHtml, lotteryHtml]) {
    assert.match(html, /href=["']\.\/["'][^>]*data-admin-route/i);
    assert.match(html, /href=["']points\.html["'][^>]*data-admin-route/i);
    assert.match(html, /href=["']lottery\.html["'][^>]*data-admin-route/i);
    assert.match(html, />會員資料</);
    assert.match(html, />點數管理</);
    assert.match(html, />轉盤抽獎</);
  }

  for (const id of ["point-workspace", "point-type-form", "point-campaign-form", "point-qr-dialog"]) {
    assert.doesNotMatch(memberHtml, new RegExp(`id=["']${id}["']`));
  }
  for (const id of ["metric-all", "member-list", "filter-form", "deny-dialog"]) {
    assert.doesNotMatch(pointHtml, new RegExp(`id=["']${id}["']`));
    assert.doesNotMatch(lotteryHtml, new RegExp(`id=["']${id}["']`));
  }

  assert.match(script, /requestedAdminPage\s*===\s*["']points["']/);
  assert.match(script, /requestedAdminPage\s*===\s*["']lottery["']/);
  assert.match(boot, /ADMIN_PAGE\s*===\s*["']points["'][\s\S]{0,80}?fetchPointTypes\s*\(/);
  assert.match(boot, /ADMIN_PAGE\s*===\s*["']lottery["'][\s\S]{0,80}?fetchLotteryConfig\s*\(/);
  assert.match(boot, /fetchMembers\s*\(/);
  assert.match(routeSync, /isDemoSession\s*\|\|\s*hasDemoQuery\s*\(\s*\)/);
  assert.match(routeSync, /searchParams\.set\s*\(\s*["']demo["']\s*,\s*["']1["']\s*\)/);
});

test("client member profile does not display email or login metadata", () => {
  const html = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const memberState = /id="member-state"[\s\S]*?(?=<section[^>]+id="error-state")/.exec(html);

  assert.ok(memberState, "client member state must exist");
  for (const label of ["Email", "登入次數", "最後登入", "登入環境"]) {
    assert.doesNotMatch(memberState[0], new RegExp(`>${label}<`));
  }
  for (const id of [
    "member-email",
    "member-login-count",
    "member-last-login",
    "member-environment",
  ]) {
    assert.doesNotMatch(html, new RegExp(`id=["']${id}["']`));
    assert.doesNotMatch(script, new RegExp(`byId\\(["']${id}["']\\)`));
  }
});

test("client member profile displays editable phone and birthday details", () => {
  const html = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const memberState = /id="member-state"[\s\S]*?(?=<section[^>]+id="error-state")/.exec(html);
  const renderMember = getTopLevelFunctionContaining(script, /function\s+renderMember\s*\(/);

  assert.ok(memberState, "client member state must exist");
  assert.match(memberState[0], /<dt>\s*電話\s*<\/dt>/);
  assert.match(memberState[0], /<dd[^>]+id="member-phone"/);
  assert.match(memberState[0], /<dt>\s*生日\s*<\/dt>/);
  assert.match(memberState[0], /<dd[^>]+id="member-birthday"/);
  assert.match(memberState[0], /id="edit-profile-button"/);

  assert.match(renderMember, /byId\(["']member-phone["']\)/);
  assert.match(renderMember, /\bmember\.phone\b/);
  assert.match(renderMember, /byId\(["']member-birthday["']\)/);
  assert.match(renderMember, /\bmember\.birthday\b/);
});

test("client profile dialog submits phone and birthday through the profile update action", () => {
  const html = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "client/styles.css"), "utf8");
  const dialog = /<dialog\b[^>]*id="profile-dialog"[\s\S]*?<\/dialog>/.exec(html);
  const profileInputStyles =
    /\.profile-field input\s*\{([\s\S]*?)\}/.exec(styles);
  const mobileDateStyles =
    /\.profile-field input\[type=["']date["']\]\s*\{([\s\S]*?)\}/.exec(styles);

  assert.ok(dialog, "client profile edit dialog must exist");
  assert.ok(profileInputStyles, "profile inputs must have a shared layout rule");
  assert.ok(mobileDateStyles, "date input must have an iOS-safe layout rule");
  assert.match(dialog[0], /<form\b[^>]*id="profile-form"/);
  assert.match(dialog[0], /<input\b[^>]*id="profile-phone-input"[^>]*>/);
  assert.match(
    dialog[0],
    /id="profile-phone-input"[^>]*type="tel"|type="tel"[^>]*id="profile-phone-input"/
  );
  assert.match(dialog[0], /<input\b[^>]*id="profile-birthday-input"[^>]*>/);
  assert.match(
    dialog[0],
    /id="profile-birthday-input"[^>]*type="date"|type="date"[^>]*id="profile-birthday-input"/
  );
  assert.match(
    dialog[0],
    /<button\b[^>]*id="profile-save-button"[^>]*type="submit"|<button\b[^>]*type="submit"[^>]*id="profile-save-button"/
  );
  assert.match(profileInputStyles[1], /display\s*:\s*block/);
  assert.match(profileInputStyles[1], /width\s*:\s*100%/);
  assert.match(profileInputStyles[1], /min-width\s*:\s*0/);
  assert.match(profileInputStyles[1], /max-width\s*:\s*100%/);
  assert.match(profileInputStyles[1], /height\s*:\s*3\.5rem/);
  assert.match(mobileDateStyles[1], /padding-inline\s*:\s*0/);
  assert.match(mobileDateStyles[1], /text-align\s*:\s*left/);
  assert.match(mobileDateStyles[1], /text-indent\s*:\s*0\.45rem/);

  assert.match(
    script,
    /byId\(["']profile-form["']\)\.addEventListener\(["']submit["']/
  );
  const submitProfile = getTopLevelFunctionContaining(script, /["']updateMemberProfile["']/);
  assert.match(submitProfile, /["']updateMemberProfile["']/);
  assert.match(submitProfile, /\bphone\s*:/);
  assert.match(submitProfile, /\bbirthday\s*:/);
});

test("shared GAS transport allowlists member phone and birthday fields", () => {
  const transport = fs.readFileSync(path.join(root, "shared/gas-api.js"), "utf8");
  const extraFields = /var\s+EXTRA_FIELD_NAMES\s*=\s*\[([\s\S]*?)\];/.exec(transport);

  assert.ok(extraFields, "shared transport extra-field allowlist must exist");
  assert.match(extraFields[1], /["']phone["']/);
  assert.match(extraFields[1], /["']birthday["']/);
});

test("admin exposes an accessible point-type and QR campaign workspace", () => {
  const html = fs.readFileSync(path.join(root, "admin/points.html"), "utf8");
  const workspace = getOpeningTagById(html, "point-workspace");
  const pointTypeForm = getOpeningTagById(html, "point-type-form");
  const pointAmountInput = getOpeningTagById(html, "point-amount-input");
  const campaignForm = getOpeningTagById(html, "point-campaign-form");
  const expiryInput = getOpeningTagById(html, "point-expiry-input");
  const qrDialog = getOpeningTagById(html, "point-qr-dialog");
  const qrOutput = getOpeningTagById(html, "point-qr-output");
  const deleteDialog = getOpeningTagById(html, "delete-point-type-dialog");
  const copyButton = getElementMarkupById(html, "copy-claim-link-button");
  const downloadButton = getElementMarkupById(html, "download-qr-button");
  const pointHistory = getOpeningTagById(html, "point-history-workspace");

  assert.match(workspace, /aria-labelledby=(?:"[^"]+"|'[^']+')/);
  assert.match(pointTypeForm, /<form\b/i);
  assert.match(html, /<label\b[^>]*for=["']point-amount-input["']/i);
  assert.match(pointAmountInput, /\btype=["']number["']/i);
  assert.match(pointAmountInput, /\bname=["']pointAmount["']/i);
  assert.match(pointAmountInput, /\bmin=["']1["']/i);
  assert.match(pointAmountInput, /\bmax=["']9999["']/i);
  assert.match(pointAmountInput, /\bstep=["']1["']/i);
  assert.match(pointAmountInput, /\brequired(?:\s|>|=)/i);
  for (const [id, name, value] of [
    ["point-expiry-mode-limited", "expiryMode", "limited"],
    ["point-expiry-mode-unlimited", "expiryMode", "unlimited"],
    ["point-redemption-mode-once", "redemptionMode", "once_per_member"],
    ["point-redemption-mode-repeatable", "redemptionMode", "repeatable"],
    ["point-redemption-mode-single", "redemptionMode", "single_member"],
  ]) {
    const radio = getOpeningTagById(html, id);
    assert.match(radio, /\btype=["']radio["']/i);
    assert.match(radio, new RegExp(`\\bname=["']${name}["']`, "i"));
    assert.match(radio, new RegExp(`\\bvalue=["']${value}["']`, "i"));
  }
  assert.match(getOpeningTagById(html, "point-type-list"), /aria-(?:busy|live)=/i);
  assert.match(campaignForm, /<form\b/i);
  assert.match(html, /<label\b[^>]*for=["']point-expiry-input["']/i);
  assert.match(expiryInput, /\bname=["']expiresAt["']/i);
  assert.match(
    getOpeningTagById(html, "create-point-campaign-button"),
    /\btype=["']submit["']/i
  );

  assert.match(qrDialog, /<dialog\b/i);
  assert.match(qrDialog, /aria-labelledby=(?:"[^"]+"|'[^']+')/i);
  assert.match(qrDialog, /aria-describedby=(?:"[^"]+"|'[^']+')/i);
  assert.match(qrOutput, /\brole=["']img["']/i);
  assert.match(qrOutput, /aria-(?:label|labelledby)=(?:"[^"]+"|'[^']+')/i);
  assert.match(deleteDialog, /<dialog\b/i);
  assert.match(deleteDialog, /aria-labelledby=(?:"[^"]+"|'[^']+')/i);
  assert.match(
    getOpeningTagById(html, "confirm-delete-point-type-button"),
    /\btype=["']button["']/i
  );
  assert.match(copyButton, /<button\b[^>]*\btype=["']button["']/i);
  assert.match(copyButton, /複製/);
  assert.match(downloadButton, /<button\b[^>]*\btype=["']button["']/i);
  assert.match(downloadButton, /下載/);
  assert.match(pointHistory, /aria-labelledby=(?:"[^"]+"|'[^']+')/i);
  for (const id of [
    "point-history-title",
    "point-history-summary",
    "refresh-point-history-button",
    "point-history-loading",
    "admin-point-history-list",
    "point-history-empty",
    "point-history-error",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test("admin lottery page maps individually added card nodes to one configured wheel", () => {
  const html = fs.readFileSync(path.join(root, "admin/lottery.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");
  const validatePrizes = getTopLevelFunctionContaining(
    script,
    /function\s+validateLotterySubmission\s*\(/
  );

  for (const id of [
    "point-card-setting-form",
    "point-card-target-input",
    "add-point-card-reward-button",
    "point-card-reward-list",
    "point-card-reward-empty",
    "lottery-type-select",
    "new-lottery-type-button",
    "delete-lottery-type-button",
    "lottery-empty-state",
    "start-create-lottery-button",
    "lottery-editor",
    "lottery-type-name-input",
    "admin-lottery-wheel",
    "lottery-config-form",
    "lottery-prize-list",
    "lottery-probability-total",
    "add-lottery-prize-button",
    "save-lottery-button",
    "lottery-history-list",
    "lottery-history-loading",
    "lottery-history-empty",
    "lottery-history-error",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(script, /sendAdminRequest\(["']adminGetLotteryConfig["']/);
  assert.match(script, /sendAdminRequest\(["']adminSavePointCardSetting["']/);
  assert.match(script, /pointCardRewards:\s*rewardRules/);
  assert.match(script, /function\s+addPointCardRewardRule\s*\(/);
  assert.match(script, /function\s+validatePointCardRewardRules\s*\(/);
  assert.doesNotMatch(html, /id=["']point-card-milestones-input["']/);
  assert.doesNotMatch(script, /sendAdminRequest\(["']adminCreateLotteryType["']/);
  assert.match(script, /sendAdminRequest\(["']adminDeleteLotteryType["']/);
  assert.match(script, /sendAdminRequest\(["']adminSaveLotteryConfig["']/);
  assert.match(script, /lotteryTypeName:\s*lotteryTypeName/);
  assert.match(script, /lotteryPrizes:\s*submittedPrizes/);
  assert.match(script, /sendAdminRequest\(["']adminListLotteryDraws["']/);
  assert.match(script, /totalBasisPoints\s*!==\s*10000/);
  assert.match(script, /colorInput\.type\s*=\s*["']color["']/);
  assert.doesNotMatch(validatePrizes, /獎項名稱不可重複|labelKey|var\s+labels/);
});

test("member lottery opens an earned ticket on a separate view and spins from the wheel center", () => {
  const memberHtml = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
  const html = fs.readFileSync(path.join(root, "client/lottery.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "client/lottery.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "client/styles.css"), "utf8");
  const gas = fs.readFileSync(path.join(root, "gas/client/Code.gs"), "utf8");
  const spin = getTopLevelFunctionContaining(script, /function\s+handleDraw/);
  const animateSpin = getTopLevelFunctionContaining(
    script,
    /function\s+animateToPrize\s*\(/
  );
  const waitingSpin = getTopLevelFunctionContaining(
    script,
    /function\s+startWaitingSpin\s*\(/
  );
  const stopSpin = getTopLevelFunctionContaining(
    script,
    /function\s+stopSpinAnimation\s*\(/
  );
  const renderWorkspace = getTopLevelFunctionContaining(
    script,
    /function\s+renderWorkspace/
  );
  const preloadWheels = getTopLevelFunctionContaining(
    script,
    /function\s+preloadLotteryWheels/
  );
  const openTicket = getTopLevelFunctionContaining(
    script,
    /function\s+openLotteryTicket/
  );

  for (const id of [
    "point-card-progress-bar",
    "point-card-milestones",
    "point-card-current",
    "point-card-target",
    "available-draw-count",
    "scan-point-button",
    "lottery-ticket-view",
    "lottery-ticket-tabs",
    "locked-ticket-tab",
    "locked-ticket-panel",
    "locked-ticket-count",
    "locked-ticket-list",
    "locked-ticket-empty",
    "earned-ticket-tab",
    "earned-ticket-panel",
    "earned-ticket-count",
    "lottery-ticket-list",
    "lottery-ticket-empty",
    "point-history-title",
    "point-history-summary",
    "refresh-point-history-button",
    "point-history-loading",
    "point-history-list",
    "point-history-empty",
    "point-history-error",
    "lottery-wheel-view",
    "lottery-wheel-back-button",
    "member-lottery-wheel",
    "lottery-spin-button",
    "lottery-result-dialog",
    "lottery-result-title",
    "lottery-result-before",
    "lottery-result-balance",
    "lottery-result-confirm-button",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(memberHtml, /id=["']lottery-page-link["'][^>]*href=["']lottery\.html["']/);
  assert.match(memberHtml, /id=["']lottery-page-link["'][\s\S]*?<span>集點卡<\/span>/);
  assert.doesNotMatch(memberHtml, /前往集點卡抽獎/);
  assert.doesNotMatch(memberHtml, /id=["']scan-point-button["']/);
  assert.doesNotMatch(memberHtml, /id=["']lottery-result-dialog["']/);
  assert.doesNotMatch(html, /id=["']lottery-type-options["']/);
  assert.doesNotMatch(html, /id=["']point-card-current["'][^>]*>[^<]*<\/output>\s*\/\s*<output/i);
  assert.match(html, /id=["']locked-ticket-title["']>未獲得</);
  assert.match(html, /id=["']earned-ticket-title["']>已獲得</);
  assert.match(html, /抽完即使用/);
  assert.match(html, /確認並返回集點卡/);
  assert.match(getOpeningTagById(html, "lottery-ticket-tabs"), /\brole=["']tablist["']/i);
  assert.match(
    getOpeningTagById(html, "locked-ticket-tab"),
    /\brole=["']tab["'][^>]*\baria-controls=["']locked-ticket-panel["']/i
  );
  assert.match(
    getOpeningTagById(html, "earned-ticket-tab"),
    /\brole=["']tab["'][^>]*\baria-controls=["']earned-ticket-panel["']/i
  );
  assert.match(getOpeningTagById(html, "locked-ticket-panel"), /\bhidden\b/i);
  assert.doesNotMatch(getOpeningTagById(html, "earned-ticket-panel"), /\bhidden\b/i);
  assert.match(
    html,
    /class=["'][^"']*lottery-page-wheel-stage[^"']*["'][\s\S]*?<button\b[^>]*class=["'][^"']*member-lottery-hub[^"']*lottery-center-button[^"']*["'][^>]*id=["']lottery-spin-button["']/i
  );
  assert.match(
    getOpeningTagById(html, "lottery-wheel-view"),
    /\bhidden\b/i
  );
  assert.match(spin, /sendMemberRequest\(\s*["']drawLottery["']/);
  assert.match(spin, /ensurePendingRequest\s*\(/);
  assert.match(spin, /startWaitingSpin\(\);[\s\S]*sendMemberRequest\(/);
  assert.match(spin, /\blotteryTypeId\s*:/);
  assert.match(spin, /\bcardRoundKey\s*:/);
  assert.doesNotMatch(spin, /Math\.random\s*\(/);
  assert.match(script, /draw\.pointsSpent\s*!==\s*0/);
  assert.match(script, /draw\.pointBalance\s*!==\s*draw\.originalPointBalance/);
  assert.match(script, /normalizeLotteryConfig\(\s*data\.lottery/);
  assert.match(script, /animateToPrize\(draw,\s*selectedType\.lottery\)/);
  assert.match(script, /renderPointCardMilestones\(\)/);
  assert.match(script, /function\s+preloadLotteryWheels\s*\(/);
  assert.equal(
    renderWorkspace.indexOf("normalizePointCardStatus") <
      renderWorkspace.indexOf("preloadLotteryWheels"),
    true,
    "card eligibility must be known before wheel canvases are preloaded"
  );
  assert.match(preloadWheels, /cardStatus\.availableRewards/);
  assert.match(preloadWheels, /\.slice\(0,\s*WHEEL_PRELOAD_LIMIT\)/);
  assert.doesNotMatch(preloadWheels, /lotteryTypes\.forEach/);
  assert.match(openTicket, /renderSelectedLottery\(\);[\s\S]*showLotteryWheelView\(\)/);
  assert.doesNotMatch(openTicket, /requestAnimationFrame/);
  assert.match(script, /function\s+startWaitingSpin\s*\(/);
  assert.match(waitingSpin, /requestAnimationFrame\(rotate\)/);
  assert.match(
    waitingSpin,
    /\*\s*SPIN_DEGREES_PER_MS/
  );
  assert.match(waitingSpin, /Math\.min\(100,\s*timestamp\s*-\s*waitingSpinLastTime\)/);
  assert.match(
    animateSpin,
    /duration\s*=\s*\(2\s*\*\s*rotationDelta\)\s*\/\s*SPIN_DEGREES_PER_MS/
  );
  assert.match(
    animateSpin,
    /1\s*-\s*Math\.pow\(1\s*-\s*progress,\s*2\)/
  );
  assert.match(animateSpin, /if\s*\(reducedMotion\)[\s\S]*return new Promise/);
  assert.match(animateSpin, /window\.performance\.now\(\)/);
  assert.match(animateSpin, /requestAnimationFrame\(decelerate\)/);
  assert.match(stopSpin, /cancelAnimationFrame\(settlingSpinFrame\)/);
  assert.match(stopSpin, /spinAnimationVersion\s*\+=\s*1/);
  assert.doesNotMatch(
    styles,
    /\.member-lottery-rotor\s*\{[^}]*\btransition\s*:/s
  );
  assert.match(script, /cardStatus\.availableRewards\.forEach/);
  assert.match(script, /function\s+selectTicketTab\s*\(/);
  assert.match(script, /byId\(name\s*\+\s*["']-ticket-panel["']\)\.hidden\s*=\s*!selected/);
  assert.match(script, /function\s+handleTicketTabKeydown\s*\(/);
  assert.match(script, /["']keydown["'],\s*handleTicketTabKeydown/);
  assert.doesNotMatch(script, /\brewardTickets\b/);
  assert.match(script, /function\s+returnToPointCard\s*\(/);
  assert.doesNotMatch(
    getTopLevelFunctionContaining(script, /function\s+returnToPointCard\s*\(/),
    /location\.(?:assign|replace)/
  );
  assert.match(gas, /function\s+pickLotteryPrize_\s*\(/);
  assert.match(gas, /var\s+prize\s*=\s*pickLotteryPrize_\(lotteryConfig\.prizes\)/);
  assert.match(gas, /pointsSpent:\s*0/);
  assert.match(gas, /cardRoundKey/);
  assert.doesNotMatch(gas, /\brewardTickets\b/);
});

test("admin creates point types and QR campaigns from backend-issued claim URLs", () => {
  const script = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");
  const createType = getTopLevelFunctionContaining(script, /["']adminCreatePointType["']/);
  const createCampaign = getTopLevelFunctionContaining(
    script,
    /["']adminCreatePointCampaign["']/
  );

  assert.match(
    script,
    /byId\(["']point-type-form["']\)\.addEventListener\(["']submit["']/
  );
  assert.match(createType, /["']adminCreatePointType["']/);
  assert.match(createType, /\bpointAmount\s*:/);
  assert.match(createType, /\bexpiryMode\s*:/);
  assert.match(createType, /\bredemptionMode\s*:/);

  assert.match(
    script,
    /byId\(["']point-campaign-form["']\)\.addEventListener\(["']submit["']/
  );
  assert.match(createCampaign, /["']adminCreatePointCampaign["']/);
  assert.match(createCampaign, /\bpointTypeId\s*:/);
  assert.match(createCampaign, /\bexpiresAt\s*:/);
  assert.match(createCampaign, /\bresponse\.data\.claimUrl\b/);
  assert.doesNotMatch(
    createCampaign,
    /\b(?:memberId|lineUserId|idToken|currentIdToken)\b/,
    "the QR campaign handler must not build a claim from member or LINE identity data"
  );
  assert.doesNotMatch(
    createCampaign,
    /(?:new\s+URL|URLSearchParams)\s*\([^)]*(?:pointAmount|points|memberId|idToken)/i,
    "the QR campaign handler must not construct a claim URL from local point or identity data"
  );
  assert.doesNotMatch(createCampaign, /https?:\/\/(?:api\.)?(?:qr|chart|quickchart)/i);
});

test("admin point rules drive conditional expiry, QR copy, and soft deletion", () => {
  const html = fs.readFileSync(path.join(root, "admin/points.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");
  const syncRules = getTopLevelFunctionContaining(
    script,
    /expiryField\.hidden\s*=\s*isUnlimited/
  );
  const deleteType = getTopLevelFunctionContaining(
    script,
    /["']adminDeletePointType["']/
  );
  const qrDialog = getTopLevelFunctionContaining(
    script,
    /byId\(["']point-qr-rule["']\)\.textContent/
  );

  assert.match(html, /id=["']selected-point-rules["']/);
  assert.match(html, /id=["']point-expiry-field["']/);
  assert.match(html, /id=["']point-rule-notice["']/);
  assert.match(html, /id=["']point-qr-rule["']/);
  assert.match(syncRules, /expiryInput\.required\s*=\s*!isUnlimited/);
  assert.match(syncRules, /isUnlimited\s*&&\s*isRepeatable/);
  assert.match(syncRules, /反覆掃描領點/);
  assert.match(syncRules, /isSingleMember/);
  assert.match(syncRules, /只能由一位會員成功領取/);
  assert.match(deleteType, /sendAdminRequest\(["']adminDeletePointType["']/);
  assert.match(deleteType, /\bpointTypeId\s*:/);
  assert.match(qrDialog, /無期限/);
  assert.match(qrDialog, /每次重新掃描可再領一次/);
  assert.match(qrDialog, /僅限一位會員領取/);
});

test("admin member and point pages load only their own data and preflight QR creation", () => {
  const script = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");
  const fetchMembers = getTopLevelFunctionContaining(script, /["']adminListMembers["']/);
  const fetchPointTypes = getTopLevelFunctionContaining(
    script,
    /["']adminListPointTypes["']/
  );
  const fetchPointHistory = getTopLevelFunctionContaining(
    script,
    /["']adminListPointHistory["']/
  );
  const createCampaign = getTopLevelFunctionContaining(
    script,
    /["']adminCreatePointCampaign["']/
  );

  assert.match(fetchMembers, /sendAdminRequest\(["']adminListMembers["']/);
  assert.doesNotMatch(fetchMembers, /adminListPointTypes/);
  assert.match(fetchPointTypes, /sendAdminRequest\(["']adminListPointTypes["']/);
  assert.doesNotMatch(fetchPointTypes, /adminListMembers/);
  assert.match(fetchPointHistory, /sendAdminRequest\(["']adminListPointHistory["']/);
  assert.match(fetchPointHistory, /renderAdminPointHistory/);
  assert.match(script, /refresh-point-history-button["']\)\.addEventListener/);

  const qrPreflightAt = createCampaign.indexOf("window.PersonaQr");
  const mutationAt = createCampaign.indexOf(
    'sendAdminRequest("adminCreatePointCampaign"'
  );
  assert.equal(qrPreflightAt >= 0 && mutationAt > qrPreflightAt, true);
  assert.match(createCampaign, /\bisPointMutationLoading\b/);
});

test("client member pass renders a live point balance from the member response", () => {
  const html = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const memberState = /id="member-state"[\s\S]*?(?=<section[^>]+id="error-state")/.exec(html);
  const balance = getOpeningTagById(html, "member-point-balance");
  const renderMember = getTopLevelFunctionContaining(script, /function\s+renderMember\s*\(/);

  assert.ok(memberState, "client member state must exist");
  assert.match(memberState[0], /id=["']member-point-balance["']/);
  assert.match(balance, /aria-live=["']polite["']/i);
  assert.match(renderMember, /byId\(["']member-point-balance["']\)/);
  assert.match(renderMember, /\bmember\.pointBalance\b/);
});

test("client point history lives on the point-card page with complete UI states", () => {
  const memberHtml = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
  const memberScript = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "client/lottery.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "client/lottery.js"), "utf8");
  const history = getTopLevelFunctionContaining(script, /["']listPointHistory["']/);
  const loadWorkspace = getTopLevelFunctionContaining(
    script,
    /["']getLotteryConfig["']/
  );

  for (const id of [
    "point-history-title",
    "point-history-summary",
    "point-history-list",
    "point-history-loading",
    "point-history-empty",
    "point-history-error",
    "refresh-point-history-button",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.doesNotMatch(memberHtml, new RegExp(`id=["']${id}["']`));
  }
  assert.doesNotMatch(memberScript, /["']listPointHistory["']/);
  assert.match(history, /sendMemberRequest\(["']listPointHistory["']/);
  assert.match(script, /refresh-point-history-button["']\)\.addEventListener/);
  assert.match(script, /formatPointHistoryMode/);
  assert.match(script, /entryType\s*===\s*["']draw["']/);
  assert.match(script, /label\s*===\s*["']集點卡抽獎 · ["']\s*\+\s*prizeLabel/);
  assert.match(script, /entry\.entryType\s*===\s*["']draw["']\s*\?\s*["']不扣點["']/);
  assert.match(
    loadWorkspace,
    /renderWorkspace\(response\.data\);[\s\S]*loadPointHistory\(\);[\s\S]*return true/
  );
  assert.match(
    getTopLevelFunctionContaining(script, /function\s+returnToPointCard\s*\(/),
    /loadPointHistory\(\)/
  );
});

test("primary pages use concise copy and responsive text safeguards", () => {
  const clientHtml = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
  const pointHtml = fs.readFileSync(path.join(root, "admin/points.html"), "utf8");
  const clientCss = fs.readFileSync(path.join(root, "client/styles.css"), "utf8");
  const adminCss = fs.readFileSync(path.join(root, "admin/styles.css"), "utf8");

  assert.doesNotMatch(clientHtml, /歡迎回來，/);
  for (const phrase of [
    "點數與 QR 管理",
    "建立點數、期限與領取規則，再產生會員 QR 領取碼。",
    "點數類型與 QR 領取碼",
  ]) {
    assert.doesNotMatch(pointHtml, new RegExp(escapeRegExp(phrase)));
  }
  for (const css of [clientCss, adminCss]) {
    assert.match(css, /h1,[\s\S]*?text-wrap:\s*balance/);
    assert.match(css, /p,[\s\S]*?overflow-wrap:\s*anywhere/);
    assert.match(css, /p,[\s\S]*?text-wrap:\s*pretty/);
    assert.match(css, /touch-action:\s*manipulation/);
  }
  assert.match(clientCss, /\.lottery-ticket-tabs\s+button\[aria-selected=["']true["']\]/);
  assert.match(clientCss, /@media\s*\(max-width:\s*680px\)[\s\S]*?\.lottery-ticket-tabs\s+button/);
  assert.match(adminCss, /@media\s*\(max-width:\s*560px\)[\s\S]*?\.workspace-nav\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(adminCss, /\.point-card-reward-row\s+label::before/);
});

test("client claim dialog exposes automatic progress, result, duplicate, and retry states", () => {
  const html = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const dialog = getOpeningTagById(html, "claim-dialog");
  const successConfirmButton = getOpeningTagById(html, "claim-success-close-button");
  const duplicateConfirmButton = getOpeningTagById(html, "claim-duplicate-close-button");
  const retryButton = getOpeningTagById(html, "claim-retry-button");
  const loadingState = getOpeningTagById(html, "claim-loading-state");
  const successState = getOpeningTagById(html, "claim-success-state");
  const duplicateState = getOpeningTagById(html, "claim-duplicate-state");
  const errorState = getOpeningTagById(html, "claim-error-state");

  assert.match(dialog, /<dialog\b/i);
  assert.match(dialog, /aria-labelledby=(?:"[^"]+"|'[^']+')/i);
  assert.match(dialog, /aria-describedby=(?:"[^"]+"|'[^']+')/i);
  assert.match(successConfirmButton, /\btype=["']button["']/i);
  assert.match(duplicateConfirmButton, /\btype=["']button["']/i);
  assert.match(loadingState, /\brole=["']status["']/i);
  assert.match(loadingState, /aria-live=["']polite["']/i);
  assert.match(successState, /\brole=["']status["']/i);
  assert.match(successState, /aria-live=["']polite["']/i);
  assert.match(duplicateState, /\brole=["']status["']/i);
  assert.match(duplicateState, /aria-live=["']polite["']/i);
  for (const state of [
    getElementMarkupById(html, "claim-success-state"),
    getElementMarkupById(html, "claim-duplicate-state"),
  ]) {
    assert.match(state, /原本點數/);
    assert.match(state, /獲得點數/);
    assert.match(state, /目前點數/);
  }
  for (const id of [
    "claim-success-before",
    "claim-success-points",
    "claim-success-balance",
    "claim-duplicate-before",
    "claim-duplicate-points",
    "claim-duplicate-balance",
  ]) {
    assert.match(getOpeningTagById(html, id), /<(?:output|b)\b/i);
  }
  assert.match(errorState, /\brole=["']alert["']/i);
  assert.match(retryButton, /\btype=["']button["']/i);
  assert.doesNotMatch(html, /id=["']claim-(?:close|confirm)-button["']/);
  assert.doesNotMatch(html, /id=["']claim-add-friend-button["']/);
  assert.doesNotMatch(html, /id=["']claim-preview-state["']/);
  assert.match(script, /if \(dialog\.id === ["']claim-dialog["']\) return;/);
  assert.match(script, /if \(dialog\.id === ["']claim-dialog["']\) event\.preventDefault\(\);/);

  const openDialog = getTopLevelFunctionContaining(
    script,
    /dialog\.removeAttribute\(["']hidden["']\)/
  );
  assert.match(openDialog, /typeof dialog\.showModal === ["']function["']/);
  assert.match(openDialog, /catch \(_error\)[\s\S]*dialog\.setAttribute\(["']open["']/);
});

test("client captures a sanitized claim after LIFF init and redeems automatically", () => {
  const script = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const boot = getTopLevelFunctionContaining(script, /withLoginOnExternalBrowser\s*:\s*false/);
  const captureClaim = getTopLevelFunctionContaining(script, /\.get\(["']claim["']\)/);
  const captureName = /function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(captureClaim);
  const redeemClaim = getTopLevelFunctionContaining(script, /["']redeemPointCampaign["']/);
  const sync = getTopLevelFunctionContaining(script, /redeemPendingPointCampaign\(\)/);

  assert.ok(captureName, "claim capture must be a named top-level function");
  assert.match(captureClaim, /(?:window\.)?sessionStorage\.setItem\s*\(/);
  assert.match(captureClaim, /\.searchParams\.delete\(["']claim["']\)/);
  assert.match(captureClaim, /(?:window\.)?history\.replaceState\s*\(/);

  const initAt = boot.search(/(?:window\.)?liff\.init\s*\(/);
  const initThenAt = boot.indexOf(".then", initAt);
  const captureAt = boot.indexOf(captureName[1] + "(", initThenAt);
  assert.equal(initAt >= 0 && initThenAt > initAt, true);
  assert.equal(
    captureAt > initThenAt,
    true,
    "claim query capture must run only after liff.init resolves"
  );

  assert.match(redeemClaim, /["']redeemPointCampaign["']/);
  assert.match(redeemClaim, /\bclaim\s*:/);
  assert.match(redeemClaim, /openDialog\(byId\(["']claim-dialog["']\)\)/);
  assert.match(redeemClaim, /originalPointBalance/);
  assert.match(redeemClaim, /claim-success-before/);
  assert.match(redeemClaim, /claim-duplicate-before/);
  assert.match(redeemClaim, /sendPointClaimMessage\(/);
  assert.match(sync, /renderMember\(/);
  assert.match(sync, /redeemPendingPointCampaign\(\)/);
  assert.doesNotMatch(sync, /loadPointHistory\(\)/);
  assert.doesNotMatch(script, /sendGasRequest\(["']listPointHistory["']/);
  assert.doesNotMatch(script, /["']previewPointCampaign["']/);
  assert.match(
    script,
    /byId\(["']claim-retry-button["']\)\.addEventListener\(["']click["'],\s*redeemPendingPointCampaign\s*\)/
  );
  assert.equal(
    (script.match(/["']redeemPointCampaign["']/g) || []).length,
    1,
    "the member client should issue one direct redemption action"
  );
});

test("new member creation sends a privacy-bounded official account message", () => {
  const script = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const sync = getTopLevelFunctionContaining(
    script,
    /sendGasRequest\(["']upsertMember["']/
  );
  const newMemberMessage = getTopLevelFunctionContaining(
    script,
    /["']新會員加入通知\\n我已完成會員註冊/
  );
  const officialAccountMessage = getTopLevelFunctionContaining(
    script,
    /window\.liff\.sendMessages\s*\(/
  );

  assert.match(sync, /var\s+wasCreated\s*=\s*Boolean\(response\.data\.created\)/);
  assert.match(sync, /sendNewMemberJoinMessage\s*\(/);
  assert.match(sync, /redeemPendingPointCampaign\s*\(/);
  assert.equal(
    sync.indexOf("sendNewMemberJoinMessage") <
      sync.indexOf("redeemPendingPointCampaign"),
    true,
    "a first-time join message should be attempted before a pending point message"
  );
  assert.doesNotMatch(
    sync,
    /return\s+sendNewMemberJoinMessage/,
    "official-account messaging must not block login or a pending point claim"
  );
  assert.match(newMemberMessage, /if\s*\(!wasCreated\s*\|\|\s*!member\)/);
  assert.match(newMemberMessage, /member\.memberId/);
  assert.match(newMemberMessage, /member\.displayName/);
  assert.doesNotMatch(newMemberMessage, /member\.(?:phone|birthday|lineUserId)/);
  assert.match(officialAccountMessage, /messageContext\.inClient/);
  assert.match(officialAccountMessage, /messageContext\.isOneToOneChat/);
  assert.match(officialAccountMessage, /reason:\s*["']unavailable["']/);
  assert.match(officialAccountMessage, /catch\(function\s*\(\)\s*\{/);
  assert.match(officialAccountMessage, /reason:\s*["']send_failed["']/);
});

test("shared transport exposes only the bounded point and lottery fields", () => {
  const transport = fs.readFileSync(path.join(root, "shared/gas-api.js"), "utf8");
  const extraFields = /var\s+EXTRA_FIELD_NAMES\s*=\s*\[([\s\S]*?)\];/.exec(transport);

  assert.ok(extraFields, "shared transport extra-field allowlist must exist");
  for (const field of [
    "claim",
    "pointAmount",
    "pointTypeId",
    "expiresAt",
    "expiryMode",
    "redemptionMode",
    "pointCardTarget",
    "pointCardMilestones",
    "pointCardRewards",
    "lotteryTypeId",
    "cardRoundKey",
    "lotteryTypeName",
    "lotteryPrizes",
  ]) {
    assert.match(extraFields[1], new RegExp(`["']${field}["']`));
  }
  assert.match(
    transport,
    /name\s*===\s*["']lotteryPrizes["']\s*\|\|\s*name\s*===\s*["']pointCardRewards["'][\s\S]*?JSON\.stringify\(originalRequest\[name\]\)/,
    "the bridge transport must serialize prize and point-card node arrays as JSON"
  );
  assert.doesNotMatch(
    extraFields[1],
    /["'](?:points|memberId|lineUserId)["']/,
    "raw point balances and member identity fields must not cross the generic transport allowlist"
  );
});

test("LIFF pages preconnect early and use keyboard-safe mobile viewport sizing", () => {
  for (const relativePath of [
    "client/index.html",
    "client/lottery.html",
    "admin/index.html",
    "admin/points.html",
    "admin/lottery.html",
  ]) {
    const html = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.match(
      html,
      /<meta\b[^>]*name=["']viewport["'][^>]*interactive-widget=resizes-content/i,
      `${relativePath} must resize around the mobile keyboard`
    );
    assert.match(
      html,
      /<link\b[^>]*rel=["']preconnect["'][^>]*href=["']https:\/\/static\.line-scdn\.net["']/i,
      `${relativePath} must warm up the LIFF SDK origin`
    );
  }
});

test("shared GAS transport keeps fetch primary and bridge as a compatibility fallback", () => {
  const transport = fs.readFileSync(path.join(root, "shared/gas-api.js"), "utf8");
  const sendRequest = getTopLevelFunctionContaining(
    transport,
    /function\s+sendRequest\s*\(/
  );

  assert.match(sendRequest, /postWithFetch\(gasUrl,\s*request\)\.catch/);
  assert.match(sendRequest, /shouldUseBridgeFallback\(error\)/);
  assert.match(sendRequest, /return postWithBridge\(gasUrl,\s*request\)/);
  assert.doesNotMatch(transport, /shouldUseBridgeFirst/);
  assert.match(transport, /loadConfig[\s\S]*?cache:\s*["']no-cache["']/);
});

test("member point-card refresh and scanner keep interaction local and bounded", () => {
  const script = fs.readFileSync(path.join(root, "client/lottery.js"), "utf8");
  const boot = getTopLevelFunctionContaining(
    script,
    /function\s+boot\s*\(/
  );
  const loadWorkspace = getTopLevelFunctionContaining(
    script,
    /function\s+loadLotteryWorkspace\s*\(/
  );
  const confirmClaim = getTopLevelFunctionContaining(
    script,
    /function\s+confirmPointClaim\s*\(/
  );
  const prepareClaimRefresh = getTopLevelFunctionContaining(
    script,
    /function\s+preparePointClaimWorkspaceRefresh\s*\(/
  );
  const redeemClaim = getTopLevelFunctionContaining(
    script,
    /function\s+redeemScannedPointClaim\s*\(/
  );
  const nativeFallback = getTopLevelFunctionContaining(
    script,
    /function\s+isNativePointScannerUnavailableError\s*\(/
  );
  const embeddedScanner = getTopLevelFunctionContaining(
    script,
    /function\s+openEmbeddedPointScanner\s*\(/
  );
  const scanLoop = getTopLevelFunctionContaining(
    script,
    /function\s+scheduleEmbeddedPointScan\s*\(/
  );

  assert.match(loadWorkspace, /if\s*\(preserveView\)/);
  assert.match(loadWorkspace, /lotteryState\.setAttribute\(["']aria-busy["']/);
  assert.match(
    loadWorkspace,
    /authorizationError[\s\S]*closeDialog\(byId\(["']point-claim-dialog["']\)\)[\s\S]*handleFatalError/
  );
  assert.match(loadWorkspace, /loadPointHistory\(\);\s*return true;/);
  assert.doesNotMatch(loadWorkspace, /return\s+loadPointHistory\(\)/);
  assert.match(
    redeemClaim,
    /setPointClaimState\(["']point-claim-result-state["']\);[\s\S]*claimBootVersion\s*=\s*bootVersion[\s\S]*claimBootVersion\s*!==\s*bootVersion[\s\S]*preparePointClaimWorkspaceRefresh\(\)/
  );
  assert.match(
    confirmClaim,
    /preparePointClaimWorkspaceRefresh\(\)[\s\S]*\.then\(function\s*\(updated\)[\s\S]*closeDialog/
  );
  assert.doesNotMatch(confirmClaim, /loadLotteryWorkspace/);
  assert.match(
    confirmClaim,
    /pointClaimRefreshPromise\s*===\s*refreshPromise/
  );
  assert.match(
    confirmClaim,
    /expectedBootVersion\s*===\s*bootVersion[\s\S]*setButtonBusy\(button,\s*false\)/
  );
  assert.match(boot, /clearTimeout\(pointClaimRefreshTimer\)/);
  assert.match(
    boot,
    /setButtonBusy\(byId\(["']point-claim-confirm-button["']\),\s*false\)/
  );
  assert.match(
    prepareClaimRefresh,
    /if\s*\(pointClaimRefreshPromise\)\s*return pointClaimRefreshPromise/
  );
  assert.match(
    prepareClaimRefresh,
    /var\s+refreshPromise\s*=\s*loadLotteryWorkspace\(bootVersion,\s*true\)/
  );
  assert.match(
    prepareClaimRefresh,
    /pointClaimRefreshPromise\s*===\s*refreshPromise/
  );
  assert.match(prepareClaimRefresh, /集點卡尚未同步/);
  assert.match(nativeFallback, /subwindowopen is not allowed/);
  assert.match(embeddedScanner, /width:\s*\{\s*ideal:\s*960\s*\}/);
  assert.match(embeddedScanner, /height:\s*\{\s*ideal:\s*960\s*\}/);
  assert.match(scanLoop, /\},\s*280\);/);
  assert.match(scanLoop, /extractPointClaimFromQr\(scannedValue\)/);
  assert.match(scanLoop, /這不是集點 QR Code/);
  assert.match(script, /function\s+isTerminalPointClaimError\s*\(/);
  assert.match(script, /point-claim-retry-button["']\)\.hidden\s*=\s*!canRetry/);
});

test("admin surfaces local errors and coalesces expensive renders", () => {
  const html = fs.readFileSync(path.join(root, "admin/lottery.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");
  const savePointCard = getTopLevelFunctionContaining(
    script,
    /function\s+handleSavePointCardSetting\s*\(/
  );
  const deleteLottery = getTopLevelFunctionContaining(
    script,
    /function\s+handleDeleteLotteryType\s*\(/
  );
  const updateControls = getTopLevelFunctionContaining(
    script,
    /function\s+updateOperationControls\s*\(/
  );
  const memberRows = getTopLevelFunctionContaining(
    script,
    /function\s+renderMemberRows\s*\(/
  );

  assert.match(html, /id=["']point-card-setting-error["'][^>]*role=["']alert["']/);
  assert.match(html, /id=["']delete-lottery-type-error["'][^>]*role=["']alert["']/);
  assert.match(savePointCard, /showPointCardSettingError\(/);
  assert.doesNotMatch(savePointCard, /showLotteryConfigError\(/);
  assert.match(deleteLottery, /showDeleteLotteryTypeError\(/);
  assert.match(script, /function\s+scheduleAdminLotteryWheel\s*\(/);
  assert.match(script, /function\s+scheduleMemberRowsRender\s*\(/);
  assert.match(memberRows, /createDocumentFragment\(\)/);
  assert.match(memberRows, /replaceChildren\(fragment\)/);
  assert.match(script, /image\.loading\s*=\s*["']lazy["']/);
  assert.match(updateControls, /syncPointTypeControls\(\)/);
  assert.doesNotMatch(updateControls, /renderPointTypes\(\)/);
});

test("member claim UI supports unlimited and repeatable campaigns with retry idempotency", () => {
  const html = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const lotteryHtml = fs.readFileSync(path.join(root, "client/lottery.html"), "utf8");
  const lotteryScript = fs.readFileSync(path.join(root, "client/lottery.js"), "utf8");
  const transport = fs.readFileSync(path.join(root, "shared/gas-api.js"), "utf8");
  const normalizeCampaign = getTopLevelFunctionContaining(
    script,
    /var\s+validExpiry\s*=/
  );
  const redeem = getTopLevelFunctionContaining(
    script,
    /["']redeemPointCampaign["']/
  );
  const stableRequest = getTopLevelFunctionContaining(
    script,
    /var\s+stored\s*=\s*String\s*\(/
  );

  assert.match(html, /id=["']claim-success-note["']/);
  assert.match(html, /id=["']claim-success-message-status["']/);
  assert.match(html, /id=["']claim-duplicate-title["']/);
  assert.doesNotMatch(html, /id=["']scan-point-button["']/);
  assert.match(lotteryHtml, /id=["']scan-point-button["']/);
  assert.match(lotteryHtml, /掃描集點 QR Code/);
  assert.match(normalizeCampaign, /expiryMode\s*===\s*["']unlimited["']/);
  assert.match(normalizeCampaign, /redemptionMode\s*!==\s*["']repeatable["']/);
  assert.match(redeem, /ensurePendingPointRedemptionRequestId\s*\(/);
  assert.match(redeem, /sendPointClaimMessage\s*\(/);
  assert.doesNotMatch(
    redeem,
    /return\s+sendPointClaimMessage/,
    "official-account messaging must not keep the successful claim locked"
  );
  assert.match(lotteryScript, /scanCodeV2\s*\(/);
  assert.match(lotteryScript, /isApiAvailable\(["']scanCodeV2["']\)/);
  assert.match(lotteryScript, /SCAN_QR_UNAVAILABLE/);
  assert.match(lotteryScript, /extractPointClaimFromQr\s*\(/);
  assert.match(lotteryScript, /INVALID_POINT_QR/);
  assert.match(lotteryScript, /byId\(["']scan-point-button["']\)\.addEventListener/);
  assert.match(lotteryScript, /sendMessages\s*\(/);
  assert.match(lotteryScript, /context\.type\s*!==\s*["']utou["']/);
  assert.doesNotMatch(script, /getFriendship\s*\(/);
  assert.doesNotMatch(script, /OFFICIAL_ACCOUNT_FRIEND(?:SHIP_UNAVAILABLE|_NOT_FRIEND|_URL)/);
  assert.match(redeem, /duplicateReason\s*===\s*["']request_replay["']/);
  assert.match(redeem, /duplicateReason\s*===\s*["']campaign_redeemed["']/);
  assert.match(redeem, /重新掃描同一張 QR Code/);
  assert.match(stableRequest, /sessionStorage\.getItem\s*\(/);
  assert.match(stableRequest, /sessionStorage\.setItem\s*\(/);
  assert.match(transport, /options\.requestId/);
  assert.match(transport, /createRequestId:\s*createRequestId/);
});

test("member point scanner falls back to an in-page camera and always stops media tracks", () => {
  const html = fs.readFileSync(path.join(root, "client/lottery.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "client/lottery.js"), "utf8");
  const scannerDialog = getOpeningTagById(html, "point-scanner-dialog");
  const scannerVideo = getOpeningTagById(html, "point-scanner-video");
  const scannerCancel = getOpeningTagById(html, "point-scanner-cancel-button");
  const openScanner = getTopLevelFunctionContaining(
    script,
    /function\s+openPointQrScanner\s*\(/
  );
  const embeddedScanner = getTopLevelFunctionContaining(
    script,
    /function\s+openEmbeddedPointScanner\s*\(/
  );
  const stopScanner = getTopLevelFunctionContaining(
    script,
    /function\s+stopEmbeddedPointScanner\s*\(/
  );

  assert.match(scannerDialog, /<dialog\b/i);
  assert.match(scannerDialog, /aria-labelledby=["']point-scanner-title["']/i);
  assert.match(scannerDialog, /aria-describedby=["']point-scanner-description["']/i);
  assert.match(scannerVideo, /\bautoplay(?:\s|>|=)/i);
  assert.match(scannerVideo, /\bmuted(?:\s|>|=)/i);
  assert.match(scannerVideo, /\bplaysinline(?:\s|>|=)/i);
  assert.match(scannerCancel, /\btype=["']button["']/i);
  assert.match(openScanner, /scanCodeV2\s*\(/);
  assert.match(openScanner, /openEmbeddedPointScanner\s*\(/);
  assert.match(embeddedScanner, /BarcodeDetector/);
  assert.match(embeddedScanner, /getUserMedia\s*\(/);
  assert.match(embeddedScanner, /facingMode\s*:\s*\{\s*ideal\s*:\s*["']environment["']/);
  assert.match(script, /detector\.detect\s*\(\s*video\s*\)/);
  assert.match(stopScanner, /getTracks\s*\(\s*\)\.forEach/);
  assert.match(stopScanner, /track\.stop\s*\(\s*\)/);
  assert.match(script, /pagehide["']\s*,\s*stopPointScannerForPageExit/);
  assert.match(script, /visibilitychange["']\s*,\s*handleVisibilityChange/);
});

test("admin loads a local QR encoder and frontend code never calls an external QR service", () => {
  const adminHtml = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");
  const pointHtml = fs.readFileSync(path.join(root, "admin/points.html"), "utf8");
  const lotteryHtml = fs.readFileSync(path.join(root, "admin/lottery.html"), "utf8");
  const clientHtml = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
  const adminScript = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");
  const clientScript = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const qrScriptAt = pointHtml.indexOf('src="../shared/qr-code.js"');
  const adminScriptAt = pointHtml.indexOf('src="script.js"');

  assert.equal(
    adminHtml.includes('src="../shared/qr-code.js"'),
    false,
    "member administration must not load the QR encoder"
  );
  assert.equal(
    lotteryHtml.includes('src="../shared/qr-code.js"'),
    false,
    "lottery administration must not load the point-campaign QR encoder"
  );
  assert.notEqual(qrScriptAt, -1, "point administration must load the local shared QR encoder");
  assert.equal(qrScriptAt < adminScriptAt, true, "the QR encoder must load before admin script.js");
  assert.equal(
    fs.existsSync(path.join(root, "shared/qr-code.js")),
    true,
    "the local QR encoder asset must exist"
  );

  for (const html of [adminHtml, pointHtml, lotteryHtml, clientHtml]) {
    const externalScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["'](https?:[^"']+)["']/gi)]
      .map((match) => match[1])
      .filter((source) => source !== "https://static.line-scdn.net/liff/edge/2/sdk.js");
    assert.deepEqual(externalScripts, [], "QR generation must not add a third-party script");
  }

  const frontendSource = [
    adminHtml,
    pointHtml,
    lotteryHtml,
    clientHtml,
    adminScript,
    clientScript,
  ].join("\n");
  assert.doesNotMatch(
    frontendSource,
    /(?:api\.qrserver\.com|quickchart\.io|chart\.googleapis\.com|chart\.google\.com)/i,
    "claim URLs must never be sent to an external QR image API"
  );
});

test("LIFF entry points suppress referrers before loading the external SDK", () => {
  for (const relativePath of [
    "client/index.html",
    "client/lottery.html",
    "admin/index.html",
    "admin/points.html",
    "admin/lottery.html",
  ]) {
    const html = fs.readFileSync(path.join(root, relativePath), "utf8");
    const referrerAt = html.search(
      /<meta\b[^>]*name=["']referrer["'][^>]*content=["']no-referrer["'][^>]*>/i
    );
    const liffSdkAt = html.indexOf(
      'src="https://static.line-scdn.net/liff/edge/2/sdk.js"'
    );

    assert.notEqual(referrerAt, -1, `${relativePath} must set no-referrer`);
    assert.notEqual(liffSdkAt, -1, `${relativePath} must load the LIFF SDK`);
    assert.equal(
      referrerAt < liffSdkAt,
      true,
      `${relativePath} must suppress query referrers before external assets load`
    );
  }
});

test("member-facing client and admin contact search do not reference member email", () => {
  const clientHtml = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
  const clientScript = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const adminHtml = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");
  const adminScript = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");
  const renderRows = getTopLevelFunctionContaining(adminScript, /function\s+renderMemberRows\s*\(/);
  const createRow = getTopLevelFunctionContaining(adminScript, /function\s+createMemberRow\s*\(/);
  const normalizeMember = getTopLevelFunctionContaining(adminScript, /function\s+normalizeMember\s*\(/);

  assert.doesNotMatch(clientHtml, /\bEmail\b/i);
  assert.doesNotMatch(clientScript, /\bmember\.email\b/i);
  assert.doesNotMatch(adminHtml, /placeholder="[^"]*Email[^"]*"/i);
  assert.doesNotMatch(renderRows, /\bmember\.email\b/i);
  assert.doesNotMatch(createRow, /\bmember\.email\b|Email/i);
  assert.doesNotMatch(normalizeMember, /\bemail\s*:/i);
});

test("admin maps phone and birthday into member search and contact details", () => {
  const html = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");
  const renderRows = getTopLevelFunctionContaining(script, /function\s+renderMemberRows\s*\(/);
  const createRow = getTopLevelFunctionContaining(script, /function\s+createMemberRow\s*\(/);
  const normalizeMember = getTopLevelFunctionContaining(script, /function\s+normalizeMember\s*\(/);

  assert.match(html, /id="search-input"[^>]*placeholder="[^"]*電話[^"]*"/);
  assert.match(renderRows, /\bmember\.phone\b/);
  assert.match(renderRows, /\bmember\.birthday\b/);
  assert.match(createRow, /createCell\(["']聯絡資料["']\)/);
  assert.match(createRow, /\bmember\.phone\b/);
  assert.match(createRow, /\bmember\.birthday\b/);
  assert.match(normalizeMember, /\bphone\s*:\s*[^,;\n]*\bvalue\.phone\b/);
  assert.match(normalizeMember, /\bbirthday\s*:\s*[^,;\n]*\bvalue\.birthday\b/);
});

test("client and admin JSON configs expose only public frontend settings", () => {
  const clientConfig = JSON.parse(fs.readFileSync(path.join(root, "client/config.json"), "utf8"));
  const adminConfig = JSON.parse(fs.readFileSync(path.join(root, "admin/config.json"), "utf8"));

  for (const config of [clientConfig, adminConfig]) {
    assert.equal(typeof config.LIFF_ID, "string");
    assert.equal(typeof config.GAS_WEB_APP_URL, "string");
    assert.equal(typeof config.BRAND_NAME, "string");
    assert.equal("admin_status" in config, false);
    assert.equal("LINE_CHANNEL_ID" in config, false);
  }

  assert.equal(Number.isInteger(adminConfig.PAGE_SIZE), true);
  assert.equal(adminConfig.PAGE_SIZE >= 1 && adminConfig.PAGE_SIZE <= 100, true);
  assert.equal(clientConfig.LIFF_ID, "2010787602-kaiSm2eq");
  assert.equal("OFFICIAL_ACCOUNT_FRIEND_URL" in clientConfig, false);
  assert.equal(adminConfig.LIFF_ID, "2010791619-vhevCvvD");
  assert.match(clientConfig.GAS_WEB_APP_URL, /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/);
  assert.match(
    adminConfig.GAS_WEB_APP_URL,
    /^(?:YOUR_ADMIN_GAS_WEB_APP_URL|https:\/\/script\.google\.com\/macros\/s\/.+\/exec)$/
  );
  assert.notEqual(adminConfig.GAS_WEB_APP_URL, clientConfig.GAS_WEB_APP_URL);
});

test("admin access updates include both optimistic concurrency fields", () => {
  const transport = fs.readFileSync(path.join(root, "shared/gas-api.js"), "utf8");
  const adminScript = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");

  assert.match(transport, /"expectedAccessStatus"/);
  assert.match(transport, /"expectedAccessUpdatedAt"/);
  assert.match(adminScript, /expectedAccessStatus:\s*member\.status/);
  assert.match(adminScript, /expectedAccessUpdatedAt:\s*member\.accessUpdatedAt/);
});

test("both applications load shared runtime modules before their own scripts", () => {
  for (const [relativePath, scriptName] of [
    ["client/index.html", "script.js"],
    ["client/lottery.html", "lottery.js"],
    ["admin/index.html", "script.js"],
    ["admin/points.html", "script.js"],
    ["admin/lottery.html", "script.js"],
  ]) {
    const html = fs.readFileSync(path.join(root, relativePath), "utf8");
    const transportIndex = html.indexOf('../shared/gas-api.js');
    const runtimeIndex = html.indexOf('../shared/liff-runtime.js');
    const appIndex = html.indexOf(`src="${scriptName}"`);
    assert.notEqual(transportIndex, -1);
    assert.notEqual(runtimeIndex, -1);
    assert.notEqual(appIndex, -1);
    assert.equal(
      transportIndex < appIndex && runtimeIndex < appIndex,
      true,
      `${relativePath} must load shared runtime modules first`
    );
  }

  for (const relativePath of ["client/lottery.html", "admin/lottery.html"]) {
    const html = fs.readFileSync(path.join(root, relativePath), "utf8");
    const wheelIndex = html.indexOf('../shared/lottery-wheel.js');
    const appIndex = html.indexOf(
      relativePath.startsWith("client/") ? 'src="lottery.js"' : 'src="script.js"'
    );
    assert.notEqual(wheelIndex, -1);
    assert.equal(wheelIndex < appIndex, true, `${relativePath} must preload the wheel renderer`);
  }
});

test("member home no longer contains the retired embedded lottery implementation", () => {
  const html = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "client/styles.css"), "utf8");

  assert.doesNotMatch(html, /id=["']lottery-dialog["']/);
  assert.doesNotMatch(script, /function\s+(?:openLottery|handleLotterySpin|drawMemberLotteryWheel)\s*\(/);
  assert.doesNotMatch(script, /persona-member-lottery-request/);
  assert.doesNotMatch(styles, /\.lottery-modal\b/);
  assert.doesNotMatch(styles, /\.member-lottery-stage\b/);
});

test("deployment guides document two independent GAS deployments and Sheet-based admin approval", () => {
  for (const relativePath of ["README.md", "setup.html"]) {
    const guide = fs.readFileSync(path.join(root, relativePath), "utf8");

    assert.match(guide, /LINE_CHANNEL_ID/);
    assert.match(guide, /2010787602/);
    assert.match(guide, /2010791619/);
    assert.match(guide, /gas\/client\/Code\.gs/);
    assert.match(guide, /gas\/admin\/Code\.gs/);
    assert.match(guide, /PointCardSettings/);
    assert.match(guide, /LotteryTypes/);
    assert.match(guide, /https:\/\/yongshengchen0615\.github\.io/);
    assert.match(guide, /Admins/);
    assert.match(guide, /pending/);
    assert.match(guide, /approved/);
    assert.doesNotMatch(guide, /CLIENT_LINE_CHANNEL_ID|ADMIN_LINE_CHANNEL_ID/);
  }
});

test("admin UI distinguishes pending approval from forbidden access", () => {
  const script = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");

  for (const relativePath of [
    "admin/index.html",
    "admin/points.html",
    "admin/lottery.html",
  ]) {
    const html = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.match(html, /id="pending-state"/);
    assert.match(html, /id="pending-refresh-button"/);
    assert.match(html, /id="pending-logout-button"/);
    assert.match(html, /Admins/);
  }
  assert.match(script, /normalized\.code === "ADMIN_PENDING"/);
  assert.match(script, /normalized\.code === "ADMIN_FORBIDDEN"/);
  assert.match(script, /byId\("pending-refresh-button"\)\.addEventListener\("click", boot\)/);
  assert.match(script, /byId\("pending-logout-button"\)\.addEventListener\("click", handleLogout\)/);
});

test("client renews an invalid external-browser token once and guards redirect loops", () => {
  const script = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const recovery = getTopLevelFunctionContaining(
    script,
    /INVALID_TOKEN_RECOVERY_PREFIX\s*\+/
  );
  const recoveryName = /function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(recovery);

  assert.ok(recoveryName, "token recovery must be implemented as a named function");
  assert.match(script, /normalized\.code\s*===\s*["']INVALID_TOKEN["']/);

  const recoveryCalls = script.match(
    new RegExp(`\\b${recoveryName[1]}\\s*\\(`, "g")
  );
  assert.equal(
    (recoveryCalls || []).length >= 2,
    true,
    "the INVALID_TOKEN error path must call the recovery function"
  );

  const getGuardAt = recovery.search(/(?:window\.)?sessionStorage\.getItem\s*\(/);
  const setGuardAt = recovery.search(/(?:window\.)?sessionStorage\.setItem\s*\(/);
  const inClientAt = recovery.search(/(?:window\.)?liff\.isInClient\s*\(\s*\)/);
  const logoutAt = recovery.search(/(?:window\.)?liff\.logout\s*\(\s*\)/);
  const loginAt = recovery.search(/(?:window\.)?liff\.login\s*\(/);

  assert.equal(getGuardAt >= 0 && setGuardAt > getGuardAt, true);
  assert.match(recovery.slice(getGuardAt, setGuardAt), /\b(?:if|return)\b/);
  assert.equal(inClientAt >= 0 && inClientAt < logoutAt, true);
  assert.equal(logoutAt >= 0 && loginAt > logoutAt, true);
  assert.match(recovery.slice(loginAt), /redirectUri\s*:\s*getCleanPageUrl\s*\(\s*\)/);
});

test("client clears the invalid-token loop guard only after a successful member sync", () => {
  const script = fs.readFileSync(path.join(root, "client/script.js"), "utf8");

  assert.match(script, /(?:window\.)?sessionStorage\.removeItem\s*\(/);
  assert.match(
    script,
    /assertSuccessfulResponse\(response\);[\s\S]{0,400}?(?:sessionStorage\.removeItem\s*\(|clear[A-Za-z0-9_$]*(?:Token|Reauth)[A-Za-z0-9_$]*\s*\()/i
  );
});

test("client does not start automatic login or token recovery inside the LIFF browser", () => {
  const script = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const boot = getTopLevelFunctionContaining(script, /withLoginOnExternalBrowser\s*:\s*false/);
  const recovery = getTopLevelFunctionContaining(
    script,
    /INVALID_TOKEN_RECOVERY_PREFIX\s*\+/
  );
  const loginAt = recovery.search(/(?:window\.)?liff\.login\s*\(/);

  assert.match(boot, /withLoginOnExternalBrowser\s*:\s*false/);
  assert.match(
    boot,
    /if\s*\(\s*!window\.liff\.isLoggedIn\s*\(\s*\)\s*\)\s*\{[\s\S]{0,240}?setView\(["']login-state["']\);[\s\S]{0,80}?return;/
  );
  assert.doesNotMatch(boot, /(?:window\.)?liff\.login\s*\(/);
  assert.match(
    recovery.slice(0, loginAt),
    /if\s*\([\s\S]{0,160}?isInClient\s*\(\s*\)[\s\S]{0,160}?\)\s*(?:\{[\s\S]{0,160}?\breturn\b|return\b)/
  );
});

test("admin renews either invalid token error once and guards redirect loops", () => {
  const script = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");
  const recovery = getTopLevelFunctionContaining(
    script,
    /(?:window\.)?sessionStorage\.getItem\s*\(/
  );
  const recoveryName = /function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(recovery);

  assert.ok(recoveryName, "admin token recovery must be implemented as a named function");
  assert.match(script, /normalized\.code\s*===\s*["']INVALID_TOKEN["']/);
  assert.match(script, /normalized\.code\s*===\s*["']INVALID_ID_TOKEN["']/);

  const recoveryCalls = script.match(
    new RegExp(`\\b${recoveryName[1]}\\s*\\(`, "g")
  );
  assert.equal(
    (recoveryCalls || []).length >= 2,
    true,
    "the admin token error path must call the recovery function"
  );

  const getGuardAt = recovery.search(/(?:window\.)?sessionStorage\.getItem\s*\(/);
  const setGuardAt = recovery.search(/(?:window\.)?sessionStorage\.setItem\s*\(/);
  const inClientAt = recovery.search(/(?:window\.)?liff\.isInClient\s*\(\s*\)/);
  const logoutAt = recovery.search(/(?:window\.)?liff\.logout\s*\(\s*\)/);
  const loginAt = recovery.search(/(?:window\.)?liff\.login\s*\(/);

  assert.equal(getGuardAt >= 0 && setGuardAt > getGuardAt, true);
  assert.match(recovery.slice(getGuardAt, setGuardAt), /\b(?:if|return)\b/);
  assert.equal(inClientAt >= 0 && inClientAt < logoutAt, true);
  assert.equal(logoutAt >= 0 && loginAt > logoutAt, true);
  assert.match(recovery.slice(loginAt), /redirectUri\s*:\s*getCleanPageUrl\s*\(\s*\)/);
});

test("admin clears the invalid-token loop guard after an authenticated admin response", () => {
  const script = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");
  const fatalHandler = getTopLevelFunctionContaining(
    script,
    /normalized\.code\s*===\s*["']ADMIN_PENDING["']/
  );

  assert.match(script, /(?:window\.)?sessionStorage\.removeItem\s*\(/);
  assert.match(
    script,
    /assertSuccessfulResponse\(response\);[\s\S]{0,400}?(?:sessionStorage\.removeItem\s*\(|clear[A-Za-z0-9_$]*(?:Token|Reauth)[A-Za-z0-9_$]*\s*\()/i
  );
  assert.match(
    fatalHandler,
    /normalized\.code\s*===\s*["']ADMIN_PENDING["']\s*\)\s*\{\s*clearInvalidTokenRecoveryGuard\s*\(\s*\)/
  );
  assert.match(
    fatalHandler,
    /normalized\.code\s*===\s*["']ADMIN_FORBIDDEN["']\s*\)\s*\{\s*clearInvalidTokenRecoveryGuard\s*\(\s*\)/
  );
});

test("admin does not start automatic login or token recovery inside the LIFF browser", () => {
  const script = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");
  const boot = getTopLevelFunctionContaining(script, /withLoginOnExternalBrowser\s*:\s*false/);
  const recovery = getTopLevelFunctionContaining(
    script,
    /(?:window\.)?sessionStorage\.getItem\s*\(/
  );
  const loginAt = recovery.search(/(?:window\.)?liff\.login\s*\(/);

  assert.match(boot, /withLoginOnExternalBrowser\s*:\s*false/);
  assert.match(boot, /\.then\(function\s*\(\)\s*\{[\s\S]{0,120}?isLiffInitialized\s*=\s*true/);
  assert.match(
    boot,
    /if\s*\(\s*!window\.liff\.isLoggedIn\s*\(\s*\)\s*\)\s*\{[\s\S]{0,240}?setView\(["']login-state["']\);[\s\S]{0,80}?return;/
  );
  assert.doesNotMatch(boot, /(?:window\.)?liff\.login\s*\(/);
  assert.match(recovery.slice(0, loginAt), /!isLiffInitialized/);
  assert.match(
    recovery.slice(0, loginAt),
    /if\s*\([\s\S]{0,160}?isInClient\s*\(\s*\)[\s\S]{0,160}?\)\s*(?:\{[\s\S]{0,160}?\breturn\b|return\b)/
  );
});
