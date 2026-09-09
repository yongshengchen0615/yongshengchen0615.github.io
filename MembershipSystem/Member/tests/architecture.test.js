'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));
const surfaces = ['member', 'points', 'event', 'calendar', 'admin'];
const memberFacingSurfaces = ['member', 'points', 'event', 'calendar'];

test('Member module keeps every LIFF surface frontend independent', () => {
  [
    'index.html', 'config.json', 'README.md',
    'member/index.html', 'member/styles.css', 'member/common.js', 'member/membership-progress.css', 'member/membership-progress.js', 'member/app.js',
    'points/index.html', 'points/styles.css', 'points/common.js', 'points/membership-progress.css', 'points/membership-progress.js', 'points/app.js',
    'event/index.html', 'event/styles.css', 'event/common.js', 'event/membership-progress.css', 'event/membership-progress.js', 'event/app.js',
    'calendar/index.html', 'calendar/styles.css', 'calendar/common.js', 'calendar/membership-progress.css', 'calendar/membership-progress.js', 'calendar/app.js',
    'admin/index.html', 'admin/styles.css', 'admin/common.js', 'admin/app.js',
    'gas/Code.gs', 'gas/Auth.gs', 'gas/Storage.gs', 'gas/MemberService.gs', 'gas/PointCardService.gs', 'gas/EventTicketService.gs', 'gas/CalendarService.gs', 'gas/appsscript.json', 'tests/pointcard-rewards.test.js', 'tests/event-tickets.test.js', 'tests/calendar.test.js'
  ].forEach((file) => assert.equal(exists(file), true, `missing ${file}`));
  ['shared/common.js', 'shared/membership-progress.js', 'shared/membership-progress.css', 'shared/ui.css'].forEach((file) => assert.equal(exists(file), false, `shared frontend asset must not exist: ${file}`));
});

test('public config contains separate LIFF ids and no secret-shaped key', () => {
  const config = JSON.parse(read('config.json'));
  assert.equal(typeof config.gasWebAppUrl, 'string');
  assert.equal(typeof config.memberLiffId, 'string');
  assert.equal(typeof config.pointsLiffId, 'string');
  assert.equal(typeof config.adminLiffId, 'string');
  assert.equal(typeof config.eventLiffId, 'string');
  assert.equal(typeof config.calendarLiffId, 'string');
  assert.notEqual(config.memberLiffId, config.pointsLiffId);
  assert.notEqual(config.memberLiffId, config.adminLiffId);
  assert.notEqual(config.pointsLiffId, config.adminLiffId);
  assert.notEqual(config.eventLiffId, config.memberLiffId);
  assert.notEqual(config.eventLiffId, config.pointsLiffId);
  assert.notEqual(config.eventLiffId, config.adminLiffId);
  assert.notEqual(config.calendarLiffId, config.memberLiffId);
  assert.notEqual(config.calendarLiffId, config.pointsLiffId);
  assert.notEqual(config.calendarLiffId, config.eventLiffId);
  assert.notEqual(config.calendarLiffId, config.adminLiffId);
  assert.equal(Object.keys(config).some((key) => /secret|token|password/i.test(key)), false);
});

test('LIFF surfaces load only their own frontend assets', () => {
  const memberHtml = read('member/index.html');
  const pointsHtml = read('points/index.html');
  const adminHtml = read('admin/index.html');
  assert.match(memberHtml, /\.\/styles\.css/);
  assert.match(memberHtml, /\.\/app\.js/);
  assert.match(pointsHtml, /\.\/styles\.css/);
  assert.match(pointsHtml, /\.\/app\.js/);
  const eventHtml = read('event/index.html');
  const eventApp = read('event/app.js');
  const calendarHtml = read('calendar/index.html');
  const calendarApp = read('calendar/app.js');
  assert.match(eventHtml, /\.\/styles\.css/);
  assert.match(eventHtml, /\.\/app\.js/);
  assert.match(eventApp, /user\.event\.bootstrap/);
  assert.match(calendarHtml, /\.\/styles\.css/);
  assert.match(calendarHtml, /\.\/common\.js\?v=calendar-sync-cache-\d{8}/);
  assert.match(calendarHtml, /\.\/app\.js\?v=calendar-incremental-payload-\d{8}/);
  assert.match(calendarApp, /user\.calendar\.bootstrap/);
  assert.match(adminHtml, /\.\/styles\.css/);
  assert.match(adminHtml, /\.\/app\.js/);
  assert.match(adminHtml, /membersPanel/);
  assert.match(adminHtml, /cardsPanel/);
  surfaces.forEach((surface) => assert.doesNotMatch(read(`${surface}/index.html`), /\.\.\/shared\//));
});

test('all LIFF surfaces preserve native viewport scrolling and ticket dialogs restore focus', () => {
  surfaces.forEach((surface) => {
    const html = read(`${surface}/index.html`);
    const styles = read(`${surface}/styles.css`);
    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /<meta name="theme-color"/);
    assert.doesNotMatch(styles, /html, body \{[^}]*overflow-/);
    assert.doesNotMatch(styles, /touch-action: none/);
  });
  ['points/app.js', 'event/app.js'].forEach((file) => {
    const app = read(file);
    assert.match(app, /ticketModalOpener/);
    assert.match(app, /document\.contains\(opener\)/);
  });
});

test('member card omits the removed member-exclusive content section', () => {
  const memberHtml = read('member/index.html');
  const memberApp = read('member/app.js');
  const memberStyles = read('member/styles.css');
  assert.doesNotMatch(memberHtml, /會員專屬內容|會員權益|benefitList|statusTitle|statusMessage|statusLineText|syncedAt/);
  assert.doesNotMatch(memberApp, /benefitList|statusTitle|statusMessage|statusLineText|syncedAt/);
  assert.doesNotMatch(memberStyles, /member-details|benefits-panel|status-panel/);
});

test('member card collects first-visit contact details and displays accumulated service time', () => {
  const memberHtml = read('member/index.html');
  const memberApp = read('member/app.js');
  const adminHtml = read('admin/index.html');
  const adminApp = read('admin/app.js');
  const adminStyles = read('admin/styles.css');
  assert.match(memberHtml, /profileBirthday/);
  assert.match(memberHtml, /profilePhone/);
  assert.match(memberHtml, /memberBirthday/);
  assert.match(memberHtml, /memberPhone/);
  assert.match(memberHtml, /id="membershipProgress"/);
  assert.match(memberHtml, /data-membership-current-tier/);
  assert.match(memberHtml, /data-membership-summary/);
  assert.match(memberHtml, /data-membership-remaining/);
  assert.match(memberHtml, /membership-progress\.js/);
  assert.match(memberHtml, /profileDetailsTitle/);
  assert.match(memberApp, /user\.member\.profile\.save/);
  assert.match(memberApp, /MembershipProgress\.render\(els\.membershipProgress, profile\)/);
  assert.doesNotMatch(memberApp, /function renderTierProgress/);
  assert.doesNotMatch(memberApp, /小時/);
  assert.match(adminHtml, /grantModal/);
  assert.match(adminHtml, /grantStampsEnabled/);
  assert.match(adminHtml, /grantServiceTimeEnabled/);
  assert.match(adminHtml, /grantSuccessNotice/);
  assert.match(adminHtml, /class="operation-notice hidden"/);
  assert.match(adminHtml, /aria-atomic="true"/);
  assert.match(adminApp, /admin\.member-grants\.add/);
  assert.match(adminApp, /showGrantSuccess\(details\)/);
  assert.match(adminApp, /發放完成/);
  assert.match(adminApp, /function showOperationProgress\(message\)/);
  assert.match(adminApp, /function showOperationSuccess\(message\)/);
  assert.match(adminApp, /showOperationSuccess\(successMessage\)/);
  ['正在儲存會員等級門檻', '正在儲存集點卡', '正在封存集點卡', '正在永久刪除集點卡', '正在儲存票券', '正在儲存活動票券', '正在刪除活動票券', '正在儲存會員狀態', '正在發放集點與服務時間'].forEach((message) => assert.match(adminApp, new RegExp(message)));
  assert.match(adminStyles, /\.operation-notice\.is-processing::before/);
  assert.match(adminStyles, /@keyframes operation-spin/);
  assert.doesNotMatch(adminApp, /admin\.stamps\.add|admin\.service_minutes\.add/);
  assert.doesNotMatch(adminApp, /小時/);
});

test('admin derives fixed membership tiers from service-time thresholds instead of editing members individually', () => {
  const adminHtml = read('admin/index.html');
  const adminApp = read('admin/app.js');
  const memberService = read('gas/MemberService.gs');
  const code = read('gas/Code.gs');
  assert.match(adminHtml, /tierSettingsForm/);
  assert.match(adminHtml, /tierGeneralMinutes/);
  assert.match(adminHtml, /tierSilverMinutes/);
  assert.match(adminHtml, /tierGoldMinutes/);
  assert.match(adminHtml, /tierPlatinumMinutes/);
  ['tierGeneralStyle', 'tierSilverStyle', 'tierGoldStyle', 'tierPlatinumStyle'].forEach((id) => assert.match(adminHtml, new RegExp(id)));
  assert.equal((adminHtml.match(/<option value="(?:forest|midnight|ocean|sunset|lavender|rose|gold|platinum|mint|cherry)">/g) || []).length, 40);
  assert.doesNotMatch(adminHtml, /<input id="memberTier"/);
  assert.match(adminApp, /admin\.member-tiers\.save/);
  assert.doesNotMatch(adminApp, /tier:\s*String\(els\.memberTier/);
  assert.match(code, /'admin\.member-tiers\.save'/);
  assert.match(memberService, /function membershipTierForServiceMinutes_/);
  assert.match(memberService, /function membershipTierProgressForServiceMinutes_/);
  assert.match(memberService, /function handleMembershipTierSettingsSave_/);
  assert.match(memberService, /MEMBERSHIP_TIER_STYLE_DEFINITIONS_/);
  assert.match(memberService, /tierStyleKey/);
});

test('admin requires explicit grant actions and status choices while exposing card style previews', () => {
  const adminApp = read('admin/app.js');
  const adminHtml = read('admin/index.html');
  const adminStyles = read('admin/styles.css');
  const storage = read('gas/Storage.gs');
  const pointService = read('gas/PointCardService.gs');
  const pointsApp = read('points/app.js');
  const pointsStyles = read('points/styles.css');
  assert.match(adminApp, /function prepareExplicitStatusOptions/);
  assert.match(adminApp, /option\.value = ''; option\.disabled = true/);
  ['cardStatus', 'ticketStatus', 'eventTicketStatus', 'calendarItemStatus'].forEach((field) => assert.match(adminApp, new RegExp(`els\\.${field}\\.value = ''`)));
  assert.match(adminApp, /els\.grantPointRows\.replaceChildren\(\)/);
  assert.match(adminApp, /els\.grantModal\.classList\.remove\('hidden'\)[\s\S]*?window\.requestAnimationFrame/);
  assert.match(adminStyles, /#grantModal \{[^}]*backdrop-filter: none;[^}]*-webkit-backdrop-filter: none;/);
  assert.match(adminApp, /els\.grantStampsEnabled\.checked = false/);
  assert.match(adminApp, /els\.grantServiceTimeEnabled\.checked = false/);
  assert.match(adminApp, /els\.grantServiceTimeMinutes\.value = ''/);
  assert.match(adminApp, /placeholder\.textContent = '請選擇集點卡'/);
  assert.match(adminApp, /function prepareTierStylePreviews/);
  assert.match(adminApp, /function preparePointCardStyleEditor/);
  assert.match(adminApp, /id = 'cardStyle'/);
  assert.match(adminStyles, /\.style-preview/);
  assert.match(adminHtml, /tierGeneralStyle/);
  assert.match(storage, /PointCards:.*style_key/);
  assert.match(pointService, /styleKey: pointCardStyleKey_\(card\.style_key\)/);
  assert.match(pointService, /POINT_CARD_STYLE_KEYS_/);
  assert.match(pointsApp, /dataset\.cardStyle = safeCardStyle/);
  assert.match(pointsStyles, /\.active-card\[data-card-style/);
});

test('all browser JavaScript and GAS files parse as JavaScript', () => {
  const files = surfaces.flatMap((surface) => [`${surface}/common.js`, `${surface}/app.js`])
    .concat(memberFacingSurfaces.map((surface) => `${surface}/membership-progress.js`), ['gas/Code.gs', 'gas/Auth.gs', 'gas/Storage.gs', 'gas/MemberService.gs', 'gas/PointCardService.gs', 'gas/EventTicketService.gs', 'gas/CalendarService.gs']);
  files.forEach((file) => assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), file));
});

test('combined GAS deployment bundle has no duplicate declarations', () => {
  const files = ['gas/Code.gs', 'gas/Auth.gs', 'gas/Storage.gs', 'gas/MemberService.gs', 'gas/PointCardService.gs', 'gas/EventTicketService.gs', 'gas/CalendarService.gs'];
  assert.doesNotThrow(() => new vm.Script(files.map(read).join('\n'), { filename: 'membership-gas-combined.js' }));
});

test('transport distinguishes an uncertain write outcome from a failed read response', async () => {
  const context = {
    window: {},
    fetch: async () => ({ text: async () => '<html>temporary response</html>' })
  };
  vm.createContext(context);
  vm.runInContext(read('admin/common.js'), context, { filename: 'admin/common.js' });
  const request = context.window.MemberSystem.request;
  await assert.rejects(
    () => request({ gasWebAppUrl: 'https://example.invalid' }, 'admin', 'id-token', 'admin.stamps.add'),
    (error) => error && error.code === 'API_RESPONSE_UNCERTAIN'
  );
  await assert.rejects(
    () => request({ gasWebAppUrl: 'https://example.invalid' }, 'admin', 'id-token', 'admin.bootstrap'),
    (error) => error && error.code === 'API_RESPONSE_ERROR'
  );

  let readAttempts = 0;
  context.fetch = async () => {
    readAttempts += 1;
    return readAttempts === 1
      ? { status: 502, text: async () => '<html>temporary response</html>' }
      : { status: 200, text: async () => JSON.stringify({ ok: true, data: { members: [] } }) };
  };
  await assert.doesNotReject(
    () => request({ gasWebAppUrl: 'https://example.invalid' }, 'admin', 'id-token', 'admin.bootstrap')
  );
  assert.equal(readAttempts, 2, 'read requests retry once after a non-JSON response');

  let writeAttempts = 0;
  context.fetch = async () => {
    writeAttempts += 1;
    return { status: 502, text: async () => '<html>temporary response</html>' };
  };
  await assert.rejects(
    () => request({ gasWebAppUrl: 'https://example.invalid' }, 'admin', 'id-token', 'admin.stamps.add'),
    (error) => error && error.code === 'API_RESPONSE_UNCERTAIN'
  );
  assert.equal(writeAttempts, 1, 'write requests must not retry after an uncertain response');

  context.fetch = async () => { throw new Error('network interrupted'); };
  await assert.rejects(
    () => request({ gasWebAppUrl: 'https://example.invalid' }, 'admin', 'id-token', 'admin.stamps.add'),
    (error) => error && error.code === 'API_RESPONSE_UNCERTAIN'
  );

  let configAttempts = 0;
  context.fetch = async () => {
    configAttempts += 1;
    if (configAttempts === 1) throw new Error('temporary network failure');
    return { ok: true, text: async () => JSON.stringify({ gasWebAppUrl: 'https://example.invalid' }) };
  };
  const config = await context.window.MemberSystem.loadConfig();
  assert.equal(config.gasWebAppUrl, 'https://example.invalid');
  assert.equal(configAttempts, 2, 'public config reads retry once on a transient failure');

  let stalledBodyAttempts = 0;
  const timeoutContext = {
    window: {
      setTimeout(callback) { setImmediate(callback); return 1; },
      clearTimeout() {}
    },
    fetch: async () => {
      stalledBodyAttempts += 1;
      return { ok: true, text: () => new Promise(() => {}) };
    }
  };
  vm.createContext(timeoutContext);
  vm.runInContext(read('admin/common.js'), timeoutContext, { filename: 'admin/common.js' });
  await assert.rejects(
    () => timeoutContext.window.MemberSystem.loadConfig(),
    (error) => error && error.code === 'CONFIG_ERROR'
  );
  assert.equal(stalledBodyAttempts, 2, 'a stalled response body times out and retries even without AbortController');

  const transport = read('admin/common.js');
  assert.match(transport, /READ_REQUEST_TIMEOUT_MS = 9000/);
  assert.match(transport, /ADMIN_FULL_BOOTSTRAP_TIMEOUT_MS = 30000/);
  assert.match(transport, /isFullAdminBootstrap/);
  assert.match(transport, /WRITE_REQUEST_TIMEOUT_MS = 30000/);
  assert.match(transport, /Promise\.race/);
});

test('uncertain writes lock the affected UI and expose a reload confirmation path', () => {
  const memberHtml = read('member/index.html');
  const memberApp = read('member/app.js');
  const pointsHtml = read('points/index.html');
  const pointsApp = read('points/app.js');
  const eventHtml = read('event/index.html');
  const eventApp = read('event/app.js');
  const adminApp = read('admin/app.js');

  assert.match(memberHtml, /id="refreshProfileButton"/);
  assert.match(memberApp, /profileSaveLocked/);
  assert.match(memberApp, /showUncertainSaveMessage/);
  assert.match(pointsHtml, /id="refreshTicketButton"/);
  assert.match(pointsApp, /uncertainTicketId/);
  assert.match(pointsApp, /ticketId === state\.uncertainTicketId/);
  assert.match(eventHtml, /id="refreshTicketButton"/);
  assert.match(eventApp, /uncertainEventTicketId/);
  assert.match(eventApp, /const canAct = !state\.actionLocked/);
  assert.match(adminApp, /writeConfirmationRequired/);
  assert.match(adminApp, /function requireRefreshBeforeWrite/);
  assert.match(adminApp, /function lockAdminWrites/);
  assert.match(adminApp, /重新整理確認/);
  [memberApp, pointsApp, eventApp, adminApp].forEach((source) => assert.match(source, /window\.location\.reload\(\)/));
});

test('storage schema checks are cached and point-card bootstrap has a snapshot read path', () => {
  const storage = read('gas/Storage.gs');
  const code = read('gas/Code.gs');
  const pointService = read('gas/PointCardService.gs');
  assert.match(storage, /MEMBERSHIP_STORAGE_SCHEMA_CACHE_SECONDS_/);
  assert.match(storage, /membershipSchemaCacheKey_/);
  assert.match(storage, /schemaCache\.get\(schemaCacheKey\) === 'ready'/);
  assert.match(storage, /function resetMembershipSystemDataForNewEnvironment\(\)/);
  assert.match(storage, /sheet\.deleteRows\(2, rowCount\)/);
  assert.match(storage, /rotateMembershipDataCacheEpoch_\(\)/);
  assert.match(storage, /entry_type/);
  assert.match(storage, /reference_type/);
  assert.match(storage, /reference_id/);
  assert.doesNotMatch(code, /case 'admin\.membership\.reset'|case 'user\.membership\.reset'/);
  assert.match(pointService, /function readPointCardSnapshot_\(lineUserId\)/);
  assert.match(storage, /function readRecordsByExactField_\(sheetName, keyField, keyValue\)/);
  assert.match(storage, /PointMutations:/);
  assert.match(pointService, /function reconcilePendingPointMutationsForMember_\(lineUserId\)/);
  assert.match(pointService, /function pointCardTicketIssuanceRequired_\(lineUserId, snapshot\)/);
  assert.match(pointService, /const lockedSnapshot = readPointCardSnapshot_\(identity\.lineUserId\)/);
  assert.match(pointService, /ensurePointCardTicketsForMember_\(identity\.lineUserId, lockedSnapshot\)/);
  assert.match(pointService, /visiblePointCardsForMember_\(identity\.lineUserId, snapshot\)/);
});

test('storage schema cache skips repeated schema checks for the same spreadsheet and schema', () => {
  const entries = new Map();
  const context = {
    CacheService: { getScriptCache: () => ({ get: (key) => entries.get(key) || null, put: (key, value) => entries.set(key, value) }) },
    Utilities: { computeDigest: () => Array.from({ length: 8 }, (_, index) => index), DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' } }
  };
  vm.createContext(context);
  vm.runInContext(read('gas/Storage.gs'), context, { filename: 'gas/Storage.gs' });
  let schemaChecks = 0;
  context.resolveMembershipSpreadsheet_ = () => ({ getId: () => 'sheet-1' });
  context.ensureSheetSchema_ = () => { schemaChecks += 1; };
  context.ensureMembershipTierSettings_ = () => {};
  context.ensureMembershipStorage_();
  context.ensureMembershipStorage_();
  assert.ok(schemaChecks > 0);
  assert.equal(schemaChecks, 18);
});


test('admin mobile layout contains LINE WebView overflow guards', () => {
  const adminHtml = read('admin/index.html');
  const adminStyles = read('admin/styles.css');
  assert.match(adminHtml, /styles\.css\?v=admin-performance-20260909/);
  assert.match(adminStyles, /html, body \{ width: 100%; max-width: 100%; \}/);
  assert.match(adminStyles, /#cardListItems, #ticketListItems, #eventTicketListItems \{ display: flex;/);
  assert.match(adminStyles, /\.editor-actions \.button, \.modal-actions \.button \{ flex: 1 1 140px;/);
  assert.match(adminStyles, /\.surface-nav \{ max-width: 100%; overflow-x: auto;/);
  assert.match(adminStyles, /\.table-wrap td \{ display: grid; grid-template-columns: minmax\(92px, \.78fr\) minmax\(0, 1\.22fr\);/);
  assert.match(adminStyles, /\.table-wrap td:nth-child\(6\)::before \{ content: '操作'; \}/);
  assert.match(adminStyles, /\.table-wrap thead \{ position: absolute;/);
  assert.match(adminStyles, /\.date-range-heading \{ align-items: stretch; flex-direction: column; gap: 9px; \}/);
  assert.match(adminStyles, /\.date-range-summary \{ flex: none; width: 100%; max-width: none;/);
  assert.match(adminStyles, /@media \(max-width: 560px\) \{/);
  assert.match(adminStyles, /Native date controls retain a minimum visual width in embedded WebViews/);
  assert.match(adminStyles, /@media \(max-width: 900px\) \{/);
  assert.match(adminStyles, /\.date-input-shell \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(adminStyles, /\.date-picker-button \{ width: 100%; max-width: 100%; min-width: 0;/);
  assert.match(adminStyles, /\.date-input-shell input\[type="date"\] \{ display: block; box-sizing: border-box; inline-size: 100%; min-inline-size: 0; max-inline-size: 100%; \}/);
  assert.match(adminStyles, /::-webkit-datetime-edit-fields-wrapper/);
  assert.ok(
    adminStyles.indexOf('@media (max-width: 900px) {\n  .date-settings-grid')
      > adminStyles.indexOf('@media (max-width: 760px) {\n  .date-range-control'),
    'the LINE-safe parent layout must follow the narrow date layout'
  );
  assert.doesNotMatch(adminStyles, /grid-template-columns: minmax\(0, 1fr\) 104px/);
  assert.doesNotMatch(adminStyles, /\.card-list > div:last-child \{ display: flex; overflow-x: auto;/);
});

test('member profile date input is LINE-safe and touch-friendly', () => {
  const memberHtml = read('member/index.html');
  const memberApp = read('member/app.js');
  const memberStyles = read('member/styles.css');
  assert.match(memberHtml, /styles\.css\?v=member-performance-20260909/);
  assert.match(memberHtml, /<label for="profileBirthdayPickerButton">生日<\/label>/);
  assert.match(memberHtml, /id="profileBirthdayPickerButton" class="date-picker-trigger"[^>]*aria-haspopup="dialog"/);
  assert.match(memberHtml, /id="profileBirthday" type="date"[^>]*aria-describedby="profileBirthdayHint"[^>]*tabindex="-1"/);
  assert.match(memberHtml, /id="profileBirthdayDisplay" class="date-input-display"/);
  assert.match(memberHtml, /id="profileBirthdayPickerModal" class="profile-date-modal hidden"[^>]*role="dialog"/);
  assert.match(memberHtml, /id="profileBirthdayYear"/);
  assert.match(memberHtml, /id="profileBirthdayMonth"/);
  assert.match(memberHtml, /id="profileBirthdayDay"/);
  assert.match(memberApp, /function openBirthdayPicker/);
  assert.match(memberApp, /function confirmBirthdayPicker/);
  assert.match(memberApp, /function updateBirthdayPickerState/);
  assert.match(memberStyles, /\.profile-form, \.profile-field, \.date-input-shell \{ min-width: 0; max-width: 100%; \}/);
  assert.match(memberStyles, /\.date-input-shell \{ position: relative;[\s\S]*overflow: hidden;/);
  assert.match(memberStyles, /\.date-picker-trigger \{ display: flex;[\s\S]*touch-action: manipulation;/);
  assert.match(memberStyles, /\.date-input-shell input\[type="date"\] \{ position: absolute; width: 1px; height: 1px;[\s\S]*clip-path: inset\(50%\);/);
  assert.match(memberStyles, /\.profile-date-modal \{ position: fixed; inset: 0;[\s\S]*overflow/);
  assert.match(memberStyles, /@media \(max-width: 620px\) \{[\s\S]*\.date-input-shell \{ min-height: 54px;/);
});

test('point-card usage history starts collapsed and renders only the latest five records', () => {
  const pointsHtml = read('points/index.html');
  const pointsApp = read('points/app.js');
  const pointsStyles = read('points/styles.css');
  assert.match(pointsHtml, /<details id="ticketHistoryDisclosure" class="ticket-history-disclosure">/);
  assert.match(pointsHtml, /<ul id="ticketHistoryList" class="ticket-history-list"><\/ul>/);
  assert.match(pointsHtml, /展開後顯示最新 5 筆資料/);
  assert.match(pointsApp, /const latestHistory = history\.slice\(0, 5\)/);
  assert.match(pointsApp, /document\.createElement\('li'\)/);
  assert.match(pointsStyles, /\.ticket-history-summary \{ display: flex;/);
});

test('all user feature surfaces provide a membership join path', () => {
  surfaces.forEach((surface) => {
    const common = read(`${surface}/common.js`);
    assert.match(common, /function openMemberJoin\(config\)/);
    assert.match(common, /window\.liff\.openWindow/);
  });
  ['points', 'event', 'calendar'].forEach((surface) => {
    const html = read(`${surface}/index.html`);
    const app = read(`${surface}/app.js`);
    assert.match(html, /id="joinMemberButton"/);
    assert.match(app, /MEMBERSHIP_REQUIRED/);
    assert.match(app, /openMemberJoin\(state\.config\)/);
  });
  const memberService = read('gas/MemberService.gs');
  assert.match(memberService, /membership_status: 'pending'/);
  assert.match(memberService, /record\.membership_status = 'active'/);
  assert.match(memberService, /function assertMemberJoined_\(member\)/);
  ['PointCardService.gs', 'EventTicketService.gs', 'CalendarService.gs'].forEach((file) => assert.match(read(`gas/${file}`), /assertMemberJoined_/));
});

test('point-card administration exposes persisted sorting and batch grant controls', () => {
  const adminApp = read('admin/app.js');
  const pointService = read('gas/PointCardService.gs');
  const storage = read('gas/Storage.gs');
  assert.match(adminApp, /prepareCardSortControls/);
  assert.match(adminApp, /handleCardSortPointerDown/);
  assert.match(adminApp, /function saveCardSort/);
  assert.match(adminApp, /admin\.pointcards\.reorder/);
  assert.match(adminApp, /data-card-sort-item/);
  assert.match(adminApp, /data-card-sort-move/);
  assert.match(adminApp, /function adjustCardSortPosition/);
  assert.match(adminApp, /event\.pointerType && event\.pointerType !== 'mouse'/);
  assert.match(adminApp, /cardSortDirty/);
  assert.doesNotMatch(adminApp, /cardSortButton/);
  assert.doesNotMatch(adminApp, /prepareCardSortOrderEditor/);
  const adminStyles = read('admin/styles.css');
  assert.match(adminStyles, /#cardListItems \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: 7px; overflow: visible;/);
  assert.match(adminStyles, /\.card-sort-item \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*touch-action: pan-y;/);
  assert.doesNotMatch(adminStyles, /touch-action: none/);
  assert.match(adminStyles, /\.card-sort-move \{ width: 44px; height: 44px;/);
  assert.match(adminApp, /payload\.points = points/);
  assert.match(adminApp, /addGrantPointRow/);
  assert.match(pointService, /sort_order/);
  assert.match(pointService, /comparePointCards_/);
  assert.match(pointService, /function handlePointCardReorder_/);
  assert.match(storage, /LineNotificationLogs/);
});

test('admin content editors open in bounded dialogs and long ticket choices remain readable', () => {
  const adminApp = read('admin/app.js');
  const adminStyles = read('admin/styles.css');
  assert.match(adminApp, /prepareEditorModals/);
  assert.match(adminApp, /openEditorModal\('card'\)/);
  assert.match(adminApp, /openEditorModal\('eventTicket'\)/);
  assert.match(adminApp, /openEditorModal\('calendar'\)/);
  assert.match(adminStyles, /\.editor-modal-card/);
  assert.match(adminStyles, /\.editor-modal-host/);
  assert.match(adminStyles, /grid-template-columns: minmax\(110px, \.65fr\) minmax\(0, 1\.35fr\)/);
  assert.match(adminStyles, /\.reward-row-summary[^\n]*overflow-wrap: anywhere/);
});

test('all LIFF frontends use a centered, contextual login progress view', () => {
  const loginTargets = { member: '會員卡', points: '集點卡', event: '活動票券', calendar: '活動日曆', admin: '管理端' };
  const syncProgressCeilings = { member: 92, points: 92, event: 92, calendar: 92, admin: 96 };
  surfaces.forEach((surface) => {
    const html = read(`${surface}/index.html`);
    const app = read(`${surface}/app.js`);
    const styles = read(`${surface}/styles.css`);
    const loading = html.match(/<section id="loadingView"[\s\S]*?<\/section>/);
    assert.ok(loading, `${surface} must include its loading view`);
    assert.match(loading[0], /class="state-view login-loading"/);
    assert.match(loading[0], new RegExp(`<h1>正在登入${loginTargets[surface]}<\\/h1>`));
    assert.match(loading[0], /id="loadingProgress" class="login-progress" role="progressbar"[^>]*aria-label="登入進度"/);
    assert.match(loading[0], /id="loadingProgressBar" class="login-progress-bar"/);
    assert.match(loading[0], /id="loadingProgressText" class="login-progress-value"[^>]*>8%<\/p>/);
    assert.match(loading[0], /id="loadingStatus" class="login-status" role="status">正在準備安全登入…<\/p>/);
    assert.doesNotMatch(loading[0], /loader-mark|kicker/);
    const syncProgressPattern = new RegExp(`startLoginProgress\\('正在取得開啟設定…', 18\\)[\\s\\S]*?startLoginProgress\\('正在驗證 LINE 身分…', 48\\)[\\s\\S]*?startLoginProgress\\([^)]*, ${syncProgressCeilings[surface]}\\)[\\s\\S]*?await completeLoginProgress\\(`);
    assert.match(app, syncProgressPattern);
    assert.match(app, /function startLoginProgress\(status, ceiling\)[\s\S]*?window\.setInterval[\s\S]*?Math\.min\(maximum/);
    assert.match(app, /function completeLoginProgress\(status\)[\s\S]*?setLoginProgress\(100, status\)[\s\S]*?Promise\.resolve\(\)/);
    assert.match(app, /function stopLoginProgress\(\)[\s\S]*?window\.clearInterval/);
    assert.match(app, /function setLoginProgress\(value, status\)[\s\S]*?aria-valuenow[\s\S]*?aria-valuetext[\s\S]*?loadingProgressBar\.style\.width[\s\S]*?loadingProgressText\.textContent[\s\S]*?loadingStatus\.textContent/);
    assert.match(styles, /\.login-loading \{[^}]*100dvh[^}]*margin-inline: auto/);
    assert.match(styles, /\.login-progress \{[^}]*height: 6px/);
    assert.match(styles, /\.login-status::before \{[^}]*animation: login-status-spin/);
    assert.match(styles, /\.login-progress-bar::after \{[^}]*animation: login-progress-shimmer/);
    assert.match(styles, /\.login-progress-bar \{[^}]*transition: width \.45s cubic-bezier/);
    assert.match(styles, /\.state-view\.login-loading \.login-progress-value \{[^}]*tabular-nums/);
  });
});

test('every surface protects responsive text layout and busts its updated stylesheet cache', () => {
  const surfaces = [
    ['member', 'member-performance-20260909', 'member-performance-20260909', 'member-sync-cache-20260909'],
    ['points', 'points-performance-20260909', 'points-incremental-payload-20260909', 'points-sync-cache-20260909'],
    ['event', 'event-performance-20260909', 'event-incremental-payload-20260909', 'event-sync-cache-20260909'],
    ['calendar', 'calendar-performance-20260909', 'calendar-incremental-payload-20260909', 'calendar-sync-cache-20260909'],
    ['admin', 'admin-performance-20260909', 'admin-performance-20260909', 'admin-local-client-20260909']
  ];

  surfaces.forEach(([surface, styleVersion, appVersion, commonVersion]) => {
    const html = read(`${surface}/index.html`);
    const styles = read(`${surface}/styles.css`);
    assert.match(html, new RegExp(`styles\\.css\\?v=${styleVersion}`));
    assert.match(html, new RegExp(`app\\.js\\?v=${appVersion}`));
    assert.match(html, new RegExp(`common\\.js\\?v=${commonVersion}`));
    assert.match(html, /rel="preconnect" href="https:\/\/static\.line-scdn\.net" crossorigin/);
    assert.doesNotMatch(html, /\.\.\/shared\//);
    assert.match(styles, /overflow-wrap: anywhere/);
    assert.match(styles, /max-width: 100%/);
  });

  [['member', 'member-tier-style-20260908'], ['points', 'points-tier-style-20260908'], ['event', 'event-tier-style-20260908'], ['calendar', 'calendar-tier-style-20260908']].forEach(([surface, version]) => {
    assert.match(read(`${surface}/index.html`), new RegExp(`membership-progress\\.css\\?v=${version}`));
    assert.match(read(`${surface}/membership-progress.css`), /Membership copy is server-derived/);
  });
  assert.match(read('member/styles.css'), /@media \(max-width: 420px\)/);
  assert.match(read('points/styles.css'), /\.milestone-item strong, \.milestone-item small, \.milestone-item p/);
  assert.match(read('event/styles.css'), /\.event-ticket-action \{ align-items: stretch; flex-direction: column; \}/);
  assert.match(read('calendar/styles.css'), /@media \(max-width: 380px\)/);
  assert.match(read('admin/styles.css'), /@media \(max-width: 360px\)/);
});

test('incremental member surfaces use identity-scoped IndexedDB snapshots and server-authorized detail reads', () => {
  const storage = read('gas/Storage.gs');
  const code = read('gas/Code.gs');
  assert.match(storage, /MEMBERSHIP_SYNC_PROPERTY_PREFIX_/);
  assert.match(storage, /membershipClientCacheScope_/);
  assert.match(storage, /knownCacheScope === cacheScope/);
  assert.match(storage, /membershipSyncBumpForWrite_/);
  ['points', 'event', 'calendar'].forEach((surface) => {
    const common = read(`${surface}/common.js`);
    const app = read(`${surface}/app.js`);
    assert.match(common, /indexedDB\.open\('MembershipSystemSyncCache', 1\)/);
    assert.match(common, /expiresAt: now \+ 24 \* 60 \* 60 \* 1000/);
    assert.match(common, /clearSyncSnapshots\(\)\.finally/);
    assert.doesNotMatch(common, /localStorage|sessionStorage/);
    assert.match(app, /knownRevision = cached\.revision; payload\.knownCacheScope = cached\.cacheScope/);
    assert.match(app, /compact: true/);
  });
  assert.match(code, /case 'user\.pointcard\.detail'/);
  assert.match(code, /case 'user\.event\.ticket\.detail'/);
  assert.match(code, /case 'user\.calendar\.date\.details'/);
});

