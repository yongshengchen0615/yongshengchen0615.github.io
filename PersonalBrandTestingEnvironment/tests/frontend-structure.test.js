const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
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

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
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

function getTopLevelFunctionContaining(source, marker) {
  const match = marker.exec(source);
  assert.ok(match, `missing source marker ${marker}`);
  const start = source.lastIndexOf("\n  function ", match.index);
  assert.notEqual(start, -1, `marker ${marker} must be inside a top-level function`);
  const end = source.indexOf("\n  function ", match.index + match[0].length);
  return source.slice(start + 1, end === -1 ? source.length : end);
}

function getNestedFunctionContaining(source, marker, indentation = 8) {
  const match = marker.exec(source);
  assert.ok(match, `missing source marker ${marker}`);
  const boundary = `\n${" ".repeat(indentation)}function `;
  const start = source.lastIndexOf(boundary, match.index);
  assert.notEqual(start, -1, `marker ${marker} must be inside a nested function`);
  const end = source.indexOf(boundary, match.index + match[0].length);
  return source.slice(start + 1, end === -1 ? source.length : end);
}

test("HTML documents reference only existing local assets", () => {
  for (const relativePath of htmlFiles) {
    const absolutePath = path.join(root, relativePath);
    const html = fs.readFileSync(absolutePath, "utf8");
    const references = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(
      (match) => match[1]
    );
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
    const html = read(relativePath);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${relativePath} contains duplicate IDs`);
  }
});

test("member page keeps startup scripts small and defers Lottery V2 internals", () => {
  const html = read("client/index.html");
  const loader = read("client/member-lottery-loader.js");
  const startupScripts = [
    "../shared/gas-api.js",
    "../shared/liff-runtime.js",
    "../shared/lottery-wheel.js",
    "member-lottery-loader.js",
    "script.js",
  ];
  let previous = -1;
  for (const scriptPath of startupScripts) {
    const index = html.indexOf(`src="${scriptPath}"`);
    assert.notEqual(index, -1, `client/index.html must load ${scriptPath}`);
    assert.equal(index > previous, true, `${scriptPath} is out of dependency order`);
    previous = index;
  }

  for (const deferredPath of [
    "../shared/module-registry.js",
    "lottery/contracts.js",
    "lottery/pending-request-store.js",
    "lottery/workspace-service.js",
    "lottery/preparation-service.js",
    "lottery/draw-service.js",
    "lottery/workspace-mapper.js",
    "lottery/wheel-animator.js",
    "lottery/dialog-view.js",
    "lottery/demo-provider.js",
    "lottery/dialog-controller.js",
    "member-lottery-v2.js",
  ]) {
    assert.doesNotMatch(html, new RegExp(`src=["']${escapeRegExp(deferredPath)}["']`));
    assert.match(loader, new RegExp(escapeRegExp(`"${deferredPath}"`)));
  }
  assert.doesNotMatch(html, /wheel-draw-guard\.js|member-lottery\.js/);
});

test("member home exposes accessible profile, points, history, ticket, and Lottery V2 dialogs", () => {
  const html = read("client/index.html");
  for (const id of [
    "member-state",
    "member-phone",
    "member-birthday",
    "member-point-card-current",
    "member-point-card-target",
    "member-point-card-progress-track",
    "member-point-balance",
    "scan-point-button",
    "lottery-page-link",
    "member-ticket-count",
    "open-point-history-button",
    "profile-dialog",
    "point-scanner-dialog",
    "member-ticket-dialog",
    "member-lottery-dialog",
    "point-history-dialog",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  assert.match(getOpeningTagById(html, "member-lottery-dialog"), /^<dialog\b/i);
  assert.match(
    getOpeningTagById(html, "member-lottery-loading-state"),
    /role=["']status["'][^>]*aria-live=["']polite["']|aria-live=["']polite["'][^>]*role=["']status["']/i
  );
  assert.match(getOpeningTagById(html, "member-lottery-error-state"), /role=["']alert["']/i);
  assert.match(getOpeningTagById(html, "member-lottery-result-state"), /aria-live=["']polite["']/i);
  assert.match(getOpeningTagById(html, "member-lottery-spin-button"), /\bdisabled\b/i);
});

test("member profile update sends only editable phone and birthday fields", () => {
  const html = read("client/index.html");
  const script = read("client/script.js");
  assert.match(getOpeningTagById(html, "profile-phone-input"), /type=["']tel["']/i);
  assert.match(getOpeningTagById(html, "profile-birthday-input"), /type=["']date["']/i);
  assert.match(getOpeningTagById(html, "profile-phone-input"), /\brequired\b/i);
  assert.match(getOpeningTagById(html, "profile-birthday-input"), /\brequired\b/i);
  const submit = getTopLevelFunctionContaining(script, /["']updateMemberProfile["']/);
  assert.match(submit, /\bphone\s*:/);
  assert.match(submit, /\bbirthday\s*:/);
  assert.doesNotMatch(submit, /\b(?:status|adminStatus|lineUserId)\s*:/);
});

test("member point claim and history stay on the member host page", () => {
  const html = read("client/index.html");
  const script = read("client/script.js");
  const legacy = read("client/lottery.html");
  const redeem = getTopLevelFunctionContaining(script, /["']redeemPointCampaign["']/);
  const history = getTopLevelFunctionContaining(script, /["']listPointHistory["']/);

  assert.match(html, /id=["']claim-dialog["']/);
  assert.match(html, /id=["']point-history-dialog["']/);
  assert.match(redeem, /ensurePendingPointRedemptionRequestId\s*\(/);
  assert.match(history, /sendGasRequest\(["']listPointHistory["']/);
  assert.doesNotMatch(legacy, /point-history-dialog|scan-point-button|redeemPointCampaign/);
});

test("member ticket selection opens the in-place Lottery V2 dialog instead of navigating", () => {
  const script = read("client/script.js");
  const openTicket = getTopLevelFunctionContaining(
    script,
    /function\s+openMemberLotteryTicket\s*\(/
  );
  assert.match(
    openTicket,
    /closeDialog\(byId\(["']member-ticket-dialog["']\),\s*true\)[\s\S]*window\.MemberLotteryDialog\.open/
  );
  assert.doesNotMatch(openTicket, /lottery\.html|location\.(?:assign|replace)/);
});

test("Lottery V2 preparation is read-only and central spin owns the draw transition", () => {
  const preparation = read("client/lottery/preparation-service.js");
  const drawService = read("client/lottery/draw-service.js");
  const controller = read("client/lottery/dialog-controller.js");
  const open = getNestedFunctionContaining(controller, /function\s+open\s*\(ticketValue\)/);
  const prepareCurrent = getNestedFunctionContaining(
    controller,
    /function\s+prepareCurrent\s*\(/
  );
  const spin = getNestedFunctionContaining(controller, /function\s+handleSpin\s*\(/);

  assert.match(open, /view\.markPreparing/);
  assert.match(prepareCurrent, /preparationService\.prepare/);
  assert.match(prepareCurrent, /animator\.prepare\(selectedType\.lottery\)/);
  assert.doesNotMatch(preparation, /drawLottery|\.ensure\(/);
  assert.match(drawService, /store\.ensure\(ticket\)/);
  assert.match(drawService, /["']drawLottery["']/);
  assert.match(controller, /drawService\.draw\(selectedTicket\)/);
  assert.match(spin, /isBusy\s*=\s*true/);
  assert.match(spin, /animator[\s\S]*\.settle/);
  assert.doesNotMatch(spin, /getLotteryConfig|options\.request\(/);
});

test("legacy lottery deep link is compatibility-only and preserves query/hash while opening tickets", () => {
  const html = read("client/lottery.html");
  assert.match(html, /params\.set\(["']panel["'],\s*["']tickets["']\)/);
  assert.match(html, /target\.search\s*=\s*params\.toString\(\)/);
  assert.match(html, /target\.hash\s*=\s*window\.location\.hash/);
  assert.match(html, /window\.location\.replace\(target\.toString\(\)\)/);
  assert.match(html, /href=["']\.\/\?panel=tickets["']/);
  assert.doesNotMatch(html, /lottery\.js|member-lottery\.js|lottery-spin-button/);
  assert.equal(fs.existsSync(path.join(root, "client/lottery.js")), false);
  assert.equal(fs.existsSync(path.join(root, "client/member-lottery.js")), false);
  assert.equal(
    fs.existsSync(path.join(root, "client/lottery/wheel-draw-guard.js")),
    false
  );
});

test("admin separates members, points, and lottery into isolated pages", () => {
  const memberHtml = read("admin/index.html");
  const pointHtml = read("admin/points.html");
  const lotteryHtml = read("admin/lottery.html");
  const script = read("admin/script.js");

  assert.match(memberHtml, /<body\b[^>]*data-admin-page=["']members["']/i);
  assert.match(pointHtml, /<body\b[^>]*data-admin-page=["']points["']/i);
  assert.match(lotteryHtml, /<body\b[^>]*data-admin-page=["']lottery["']/i);
  for (const html of [memberHtml, pointHtml, lotteryHtml]) {
    assert.match(html, /href=["']\.\/["'][^>]*data-admin-route/i);
    assert.match(html, /href=["']points\.html["'][^>]*data-admin-route/i);
    assert.match(html, /href=["']lottery\.html["'][^>]*data-admin-route/i);
  }
  assert.match(script, /requestedAdminPage\s*===\s*["']points["']/);
  assert.match(script, /requestedAdminPage\s*===\s*["']lottery["']/);
});

test("admin point workspace exposes point rules, QR actions, and history", () => {
  const html = read("admin/points.html");
  const script = read("admin/script.js");
  for (const id of [
    "point-workspace",
    "point-type-form",
    "point-amount-input",
    "point-campaign-form",
    "point-expiry-input",
    "point-qr-dialog",
    "point-history-workspace",
    "refresh-point-history-button",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(script, /sendAdminRequest\(["']adminCreatePointType["']/);
  assert.match(script, /sendAdminRequest\(["']adminCreatePointCampaign["']/);
  assert.match(script, /sendAdminRequest\(["']adminListPointHistory["']/);
  assert.match(script, /window\.PersonaQr/);
});

test("admin lottery workspace maps point-card rewards to configured lottery types", () => {
  const html = read("admin/lottery.html");
  const script = read("admin/script.js");
  for (const id of [
    "point-card-setting-form",
    "point-card-target-input",
    "add-point-card-reward-button",
    "point-card-reward-list",
    "lottery-type-select",
    "lottery-editor",
    "lottery-config-form",
    "lottery-prize-list",
    "lottery-probability-total",
    "admin-lottery-wheel",
    "lottery-history-list",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(script, /sendAdminRequest\(["']adminGetLotteryConfig["']/);
  assert.match(script, /sendAdminRequest\(["']adminSavePointCardSetting["']/);
  assert.match(script, /sendAdminRequest\(["']adminSaveLotteryConfig["']/);
  assert.match(script, /sendAdminRequest\(["']adminListLotteryDraws["']/);
  assert.match(script, /pointCardRewards:\s*rewardRules/);
  assert.match(script, /lotteryPrizes:\s*submittedPrizes/);
});

test("generic GAS transport has explicit timeouts, request correlation, and a constrained bridge fallback", () => {
  const transport = read("shared/gas-api.js");
  const sendRequest = getTopLevelFunctionContaining(
    transport,
    /function\s+sendRequest\s*\(/
  );
  assert.match(transport, /CONFIG_TIMEOUT_MS\s*=\s*8000/);
  assert.match(transport, /FETCH_TIMEOUT_MS\s*=\s*12000/);
  assert.match(transport, /BRIDGE_TIMEOUT_MS\s*=\s*20000/);
  assert.match(sendRequest, /postWithFetch\(gasUrl,\s*request\)\.catch/);
  assert.match(sendRequest, /shouldUseBridgeFallback\(error\)/);
  assert.match(transport, /validateResponseEnvelope/);
  assert.match(transport, /requestSecret/);
  assert.match(transport, /crypto\.getRandomValues/);
  assert.doesNotMatch(transport, /\bprizeId\b|winningIndex|winningPrize/);
});

test("member configuration and generic transport do not expose secrets", () => {
  const config = JSON.parse(read("client/config.json"));
  assert.equal(typeof config.BRAND_NAME, "string");
  assert.equal(typeof config.LIFF_ID, "string");
  assert.equal(typeof config.GAS_WEB_APP_URL, "string");
  for (const key of Object.keys(config)) {
    assert.doesNotMatch(key, /secret|password|private|token/i);
  }
});

test("LIFF application pages use mobile-safe viewport and reduced-motion support", () => {
  for (const relativePath of [
    "client/index.html",
    "admin/index.html",
    "admin/points.html",
    "admin/lottery.html",
  ]) {
    const html = read(relativePath);
    assert.match(
      html,
      /<meta\b[^>]*name=["']viewport["'][^>]*interactive-widget=resizes-content/i,
      `${relativePath} must resize around the mobile keyboard`
    );
    assert.match(
      html,
      /<link\b[^>]*rel=["']preconnect["'][^>]*href=["']https:\/\/static\.line-scdn\.net["']/i,
      `${relativePath} must preconnect to LIFF SDK origin`
    );
  }
  const clientCss = read("client/styles.css");
  assert.match(clientCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(clientCss, /touch-action:\s*manipulation/);
});

test("member scanner falls back to an in-page camera and always exposes cancellation", () => {
  const html = read("client/index.html");
  const script = read("client/script.js");
  assert.match(getOpeningTagById(html, "point-scanner-video"), /\bplaysinline\b/i);
  assert.match(getOpeningTagById(html, "point-scanner-cancel-button"), /type=["']button["']/i);
  assert.match(script, /scanCodeV2\s*\(/);
  assert.match(script, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(script, /track\.stop\(\)/);
  assert.match(script, /extractPointClaimFromQr/);
});