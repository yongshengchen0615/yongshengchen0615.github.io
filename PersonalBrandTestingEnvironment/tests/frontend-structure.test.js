const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const htmlFiles = [
  "index.html",
  "setup.html",
  "client/index.html",
  "client/privacy.html",
  "admin/index.html",
];

function getTopLevelFunctionContaining(source, marker) {
  const match = marker.exec(source);
  assert.ok(match, `missing source marker ${marker}`);

  const start = source.lastIndexOf("\n  function ", match.index);
  assert.notEqual(start, -1, `marker ${marker} must be inside a top-level function`);

  const end = source.indexOf("\n  function ", match.index + match[0].length);
  return source.slice(start + 1, end === -1 ? source.length : end);
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
  const dialog = /<dialog\b[^>]*id="profile-dialog"[\s\S]*?<\/dialog>/.exec(html);

  assert.ok(dialog, "client profile edit dialog must exist");
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

test("both applications load the shared GAS transport before their own scripts", () => {
  for (const relativePath of ["client/index.html", "admin/index.html"]) {
    const html = fs.readFileSync(path.join(root, relativePath), "utf8");
    const sharedIndex = html.indexOf('../shared/gas-api.js');
    const appIndex = html.indexOf('src="script.js"');
    assert.notEqual(sharedIndex, -1);
    assert.notEqual(appIndex, -1);
    assert.equal(sharedIndex < appIndex, true, `${relativePath} must load shared transport first`);
  }
});

test("deployment guides document two independent GAS deployments and Sheet-based admin approval", () => {
  for (const relativePath of ["README.md", "setup.html"]) {
    const guide = fs.readFileSync(path.join(root, relativePath), "utf8");

    assert.match(guide, /LINE_CHANNEL_ID/);
    assert.match(guide, /2010787602/);
    assert.match(guide, /2010791619/);
    assert.match(guide, /gas\/client\/Code\.gs/);
    assert.match(guide, /gas\/admin\/Code\.gs/);
    assert.match(guide, /https:\/\/yongshengchen0615\.github\.io/);
    assert.match(guide, /Admins/);
    assert.match(guide, /pending/);
    assert.match(guide, /approved/);
    assert.doesNotMatch(guide, /CLIENT_LINE_CHANNEL_ID|ADMIN_LINE_CHANNEL_ID/);
  }
});

test("admin UI distinguishes pending approval from forbidden access", () => {
  const html = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "admin/script.js"), "utf8");

  assert.match(html, /id="pending-state"/);
  assert.match(html, /id="pending-refresh-button"/);
  assert.match(html, /id="pending-logout-button"/);
  assert.match(html, /Admins/);
  assert.match(script, /normalized\.code === "ADMIN_PENDING"/);
  assert.match(script, /normalized\.code === "ADMIN_FORBIDDEN"/);
  assert.match(script, /byId\("pending-refresh-button"\)\.addEventListener\("click", boot\)/);
  assert.match(script, /byId\("pending-logout-button"\)\.addEventListener\("click", handleLogout\)/);
});

test("client renews an invalid external-browser token once and guards redirect loops", () => {
  const script = fs.readFileSync(path.join(root, "client/script.js"), "utf8");
  const recovery = getTopLevelFunctionContaining(
    script,
    /(?:window\.)?sessionStorage\.getItem\s*\(/
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
    /(?:window\.)?sessionStorage\.getItem\s*\(/
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
