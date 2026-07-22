const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const code = fs.readFileSync(
  path.join(__dirname, "..", "gas", "client", "Code.gs"),
  "utf8"
);

function createProperties(values = {}) {
  const defaults = {
    LINE_CHANNEL_ID: "2010787602",
    SPREADSHEET_ID: "shared-members-sheet",
    SHEET_NAME: "Members",
    ALLOWED_ORIGINS: "https://example.github.io,http://localhost:8080",
  };
  const properties = { ...defaults, ...values };
  return {
    getProperty(name) {
      return properties[name] ?? "";
    },
  };
}

function createGasContext(overrides = {}) {
  const cache = new Map();
  const context = {
    console: { error() {} },
    Date,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    RegExp,
    Error,
    isNaN,
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput(content) {
        return {
          content,
          mimeType: "",
          setMimeType(mimeType) {
            this.mimeType = mimeType;
            return this;
          },
        };
      },
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: "ALLOWALL" },
      createHtmlOutput(content) {
        return {
          content,
          xFrameMode: "",
          setXFrameOptionsMode(mode) {
            this.xFrameMode = mode;
            return this;
          },
        };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return createProperties();
      },
    },
    LockService: {
      getScriptLock() {
        return { tryLock: () => true, releaseLock() {} };
      },
    },
    CacheService: {
      getScriptCache() {
        return {
          get: (key) => cache.get(key) ?? null,
          put: (key, value) => cache.set(key, String(value)),
        };
      },
    },
    SpreadsheetApp: { flush() {} },
    Utilities: {
      getUuid() {
        return "abcdef12-3456-7890-abcd-ef1234567890";
      },
    },
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(code, context, { filename: "gas/client/Code.gs" });
  return context;
}

function createMemberRow(gas, overrides = {}) {
  const row = new Array(gas.MEMBER_HEADERS.length).fill("");
  const values = {
    memberId: "MBR-ABCDEF1234",
    lineUserId: `U${"b".repeat(32)}`,
    displayName: "王小明",
    pictureUrl: "https://profile.line-scdn.net/member",
    email: "member@example.com",
    status: "approved",
    joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastLoginAt: new Date("2026-01-02T00:00:00.000Z"),
    loginCount: 1,
    contextType: "external",
    contextOs: "web",
    contextLanguage: "zh-TW",
    inLiffClient: false,
    viewType: "full",
    lastTokenIat: 1000,
    lastRequestId: "request-member-1",
    accessUpdatedAt: "",
    accessUpdatedBy: "",
    lastAccessRequestId: "",
    adminStatus: "",
    ...overrides,
  };

  Object.entries(values).forEach(([key, value]) => {
    row[gas.MEMBER_COLUMN[key] - 1] = value;
  });
  return row;
}

function createMemberSheet(rows, writes = []) {
  return {
    appendRow(row) {
      rows.push(row.slice());
    },
    deleteRow(rowNumber) {
      rows.splice(rowNumber - 2, 1);
    },
    getLastRow() {
      return rows.length + 1;
    },
    getRange(rowNumber, column, rowCount = 1, columnCount = 1) {
      const start = rowNumber - 2;
      return {
        getValues() {
          return Array.from({ length: rowCount }, (_, rowOffset) =>
            rows[start + rowOffset].slice(column - 1, column - 1 + columnCount)
          );
        },
        setValues(values) {
          writes.push({ rowNumber, column, rowCount, columnCount, values });
          values.forEach((valueRow, rowOffset) => {
            valueRow.forEach((value, columnOffset) => {
              rows[start + rowOffset][column - 1 + columnOffset] = value;
            });
          });
          return this;
        },
        setNumberFormat() {
          return this;
        },
        createTextFinder(searchValue) {
          return {
            matchEntireCell() {
              return this;
            },
            matchCase() {
              return this;
            },
            findNext() {
              for (let offset = 0; offset < rowCount; offset += 1) {
                if (String(rows[start + offset][column - 1]) === String(searchValue)) {
                  return { getRow: () => rowNumber + offset };
                }
              }
              return null;
            },
          };
        },
      };
    },
  };
}

function createIdentity(overrides = {}) {
  return {
    lineUserId: `U${"b".repeat(32)}`,
    displayName: "王小明",
    pictureUrl: "https://profile.line-scdn.net/member",
    email: "member@example.com",
    tokenIssuedAt: 2000,
    ...overrides,
  };
}

test("client manifest is a standalone V8 web app with only required scopes", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "gas", "client", "appsscript.json"), "utf8")
  );

  assert.equal(manifest.runtimeVersion, "V8");
  assert.equal(manifest.webapp.access, "ANYONE_ANONYMOUS");
  assert.deepEqual(manifest.urlFetchWhitelist, ["https://api.line.me/oauth2/v2.1/verify"]);
  assert.deepEqual(manifest.oauthScopes, [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request",
  ]);
});

test("client config uses its own LINE_CHANNEL_ID and fails closed when incomplete", () => {
  const gas = createGasContext();
  const config = gas.getConfig_();

  assert.equal(config.lineChannelId, "2010787602");
  assert.equal(config.spreadsheetId, "shared-members-sheet");
  assert.deepEqual(Array.from(config.allowedOrigins), [
    "https://example.github.io",
    "http://localhost:8080",
  ]);

  for (const invalidProperties of [
    { LINE_CHANNEL_ID: "2010787602-kaiSm2eq" },
    { LINE_CHANNEL_ID: "" },
    { SPREADSHEET_ID: "" },
    { ALLOWED_ORIGINS: "https://example.github.io/path" },
  ]) {
    const invalidGas = createGasContext({
      PropertiesService: {
        getScriptProperties: () => createProperties(invalidProperties),
      },
    });
    assert.throws(
      () => invalidGas.getConfig_(),
      (error) => error.appCode === "CONFIG_ERROR"
    );
  }
});

test("LINE ID token verification sends the member channel and validates claims", () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "https://access.line.me",
    sub: `U${"c".repeat(32)}`,
    aud: "2010787602",
    exp: now + 3600,
    iat: now,
    name: "會員",
  };
  let options;
  const gas = createGasContext({
    UrlFetchApp: {
      fetch(url, requestOptions) {
        assert.equal(url, "https://api.line.me/oauth2/v2.1/verify");
        options = requestOptions;
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify(claims),
        };
      },
    },
  });

  const identity = gas.verifyLineIdToken_("header.payload.signature", "2010787602");
  assert.equal(identity.lineUserId, claims.sub);
  assert.equal(options.payload.client_id, "2010787602");
  assert.equal(options.payload.id_token, "header.payload.signature");

  claims.aud = "2010791619";
  assert.throws(
    () => gas.verifyLineIdToken_("header.payload.signature", "2010787602"),
    (error) => error.appCode === "INVALID_TOKEN"
  );
});

test("LINE provider errors are public-safe and distinguish throttling", () => {
  let responseCode = 400;
  const gas = createGasContext({
    UrlFetchApp: {
      fetch() {
        return {
          getResponseCode: () => responseCode,
          getContentText: () => "sensitive provider response",
        };
      },
    },
  });

  assert.throws(
    () => gas.verifyLineIdToken_("header.payload.signature", "2010787602"),
    (error) => error.appCode === "INVALID_TOKEN" && !error.message.includes("sensitive")
  );
  responseCode = 429;
  assert.throws(
    () => gas.verifyLineIdToken_("header.payload.signature", "2010787602"),
    (error) => error.appCode === "LINE_RATE_LIMITED"
  );
});

test("admin actions are unsupported before config, origin, or token verification", () => {
  const gas = createGasContext();
  let configRead = false;
  let tokenVerified = false;
  gas.getConfig_ = () => {
    configRead = true;
    throw new Error("must not run");
  };
  gas.verifyLineIdToken_ = () => {
    tokenVerified = true;
    throw new Error("must not run");
  };

  for (const action of ["adminListMembers", "adminSetMemberAccess"]) {
    assert.throws(
      () =>
        gas.validateRequestEnvelope_({
          action,
          idToken: "",
          requestId: "bad",
          transport: "fetch",
        }),
      (error) => error.appCode === "UNSUPPORTED_ACTION"
    );
    assert.throws(
      () => gas.handleMemberRequest_({ action, idToken: "header.payload.signature" }),
      (error) => error.appCode === "UNSUPPORTED_ACTION"
    );
  }

  assert.equal(configRead, false);
  assert.equal(tokenVerified, false);
});

test("doPost returns UNSUPPORTED_ACTION for admin requests without touching origin or handler", () => {
  const gas = createGasContext();
  let originChecked = false;
  let handled = false;
  gas.isAllowedRequestOrigin_ = () => {
    originChecked = true;
    return true;
  };
  gas.handleMemberRequest_ = () => {
    handled = true;
    return { data: {} };
  };

  const output = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: "adminListMembers",
        idToken: "header.payload.signature",
        requestId: "request-admin-1",
        callbackOrigin: "https://example.github.io",
      }),
    },
    parameter: {},
  });
  const payload = JSON.parse(output.content);

  assert.equal(payload.ok, false);
  assert.equal(payload.code, "UNSUPPORTED_ACTION");
  assert.equal(originChecked, false);
  assert.equal(handled, false);
});

test("supported actions always verify against config, never a request-provided channel", () => {
  const gas = createGasContext();
  const channels = [];
  gas.getConfig_ = () => ({ lineChannelId: "2010787602" });
  gas.verifyLineIdToken_ = (_token, channelId) => {
    channels.push(channelId);
    return createIdentity();
  };
  gas.upsertMember_ = () => ({ data: { action: "upsert" } });
  gas.deleteMember_ = () => ({ data: { action: "delete" } });

  gas.handleMemberRequest_({
    action: "upsertMember",
    idToken: "header.payload.signature",
    lineChannelId: "2010791619",
  });
  gas.handleMemberRequest_({
    action: "deleteMember",
    idToken: "header.payload.signature",
    lineChannelId: "2010791619",
  });

  assert.deepEqual(channels, ["2010787602", "2010787602"]);
});

test("origins are exact and bridge output safely serializes profile text", () => {
  const gas = createGasContext();
  assert.equal(gas.isAllowedRequestOrigin_("https://example.github.io"), true);
  assert.equal(gas.isAllowedRequestOrigin_("http://localhost:8080"), true);
  assert.equal(gas.isAllowedRequestOrigin_("https://example.github.io.attacker.test"), false);
  assert.equal(gas.isAllowedRequestOrigin_("javascript:alert(1)"), false);

  const response = gas.bridgeResponse_(
    {
      ok: true,
      data: { displayName: "</script><img src=x onerror=alert(1)>" },
    },
    {
      requestId: "request-123456",
      requestSecret: "a".repeat(48),
      callbackOrigin: "https://example.github.io",
    }
  );
  assert.equal(response.xFrameMode, "ALLOWALL");
  assert.equal(response.content.includes("<img src=x"), false);
  assert.equal(response.content.includes("\\u003cimg src=x"), true);
});

test("doPost rejects an unlisted origin before member mutation", () => {
  const gas = createGasContext();
  let handled = false;
  gas.handleMemberRequest_ = () => {
    handled = true;
    return { data: {} };
  };
  const output = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: "upsertMember",
        idToken: "header.payload.signature",
        requestId: "request-123456",
        callbackOrigin: "https://attacker.test",
        context: {},
      }),
    },
    parameter: {},
  });
  const payload = JSON.parse(output.content);

  assert.equal(payload.ok, false);
  assert.equal(payload.code, "ORIGIN_NOT_ALLOWED");
  assert.equal(handled, false);
});

test("new member rows use the shared 21-column schema and are approved", () => {
  const gas = createGasContext();
  const rows = [];
  const sheet = createMemberSheet(rows);
  gas.getOrCreateMemberSheet_ = () => sheet;

  const result = gas.upsertMember_(
    createIdentity({ displayName: "=IMPORTXML(1)" }),
    {
      action: "upsertMember",
      requestId: "request-create-1",
      context: { type: "utou", os: "ios", language: "zh-TW", inClient: true },
    },
    {}
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, 21);
  assert.equal(rows[0][gas.MEMBER_COLUMN.status - 1], "approved");
  assert.equal(rows[0][gas.MEMBER_COLUMN.adminStatus - 1], "");
  assert.equal(rows[0][gas.MEMBER_COLUMN.displayName - 1], "'=IMPORTXML(1)");
  assert.equal(result.data.created, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.access)), {
    status: "approved",
    allowed: true,
  });
});

test("existing member upsert preserves status and admin_status with field-level writes", () => {
  const gas = createGasContext();
  const rows = [
    createMemberRow(gas, {
      status: "denied",
      adminStatus: "approved",
      lastTokenIat: 1000,
      lastRequestId: "request-old-1",
    }),
  ];
  const writes = [];
  gas.getOrCreateMemberSheet_ = () => createMemberSheet(rows, writes);

  const result = gas.upsertMember_(
    createIdentity({ tokenIssuedAt: 2000, displayName: "更新名稱" }),
    {
      action: "upsertMember",
      requestId: "request-update-2",
      context: { type: "external", os: "web", language: "zh-TW" },
    },
    {}
  );

  assert.equal(rows[0][gas.MEMBER_COLUMN.status - 1], "denied");
  assert.equal(rows[0][gas.MEMBER_COLUMN.adminStatus - 1], "approved");
  assert.equal(rows[0][gas.MEMBER_COLUMN.displayName - 1], "更新名稱");
  assert.equal(result.data.access.status, "denied");
  assert.equal(result.data.access.allowed, false);
  assert.equal(result.data.member, null);

  const valueWrites = writes.filter((write) => write.values);
  assert.equal(
    valueWrites.some(
      ({ column, columnCount }) =>
        column <= gas.MEMBER_COLUMN.status &&
        column + columnCount - 1 >= gas.MEMBER_COLUMN.status
    ),
    false
  );
  assert.equal(
    valueWrites.some(
      ({ column, columnCount }) =>
        column <= gas.MEMBER_COLUMN.adminStatus &&
        column + columnCount - 1 >= gas.MEMBER_COLUMN.adminStatus
    ),
    false
  );
});

test("upsert retries are idempotent and distinct token sessions increment once", () => {
  const gas = createGasContext();
  const rows = [];
  gas.getOrCreateMemberSheet_ = () => createMemberSheet(rows);
  const identity = createIdentity({ tokenIssuedAt: 2000 });
  const request = {
    action: "upsertMember",
    requestId: "request-session-1",
    context: {},
  };

  const first = gas.upsertMember_(identity, request, {});
  const retry = gas.upsertMember_(identity, request, {});
  assert.equal(first.data.created, true);
  assert.equal(retry.data.created, true);
  assert.equal(rows[0][gas.MEMBER_COLUMN.loginCount - 1], 1);

  gas.upsertMember_(
    identity,
    { ...request, requestId: "request-session-2" },
    {}
  );
  assert.equal(rows[0][gas.MEMBER_COLUMN.loginCount - 1], 1);

  gas.upsertMember_(
    { ...identity, tokenIssuedAt: 3000 },
    { ...request, requestId: "request-session-3" },
    {}
  );
  assert.equal(rows[0][gas.MEMBER_COLUMN.loginCount - 1], 2);
});

test("deleteMember is retry-idempotent and prevents recreation with the same token", () => {
  const gas = createGasContext();
  const rows = [createMemberRow(gas)];
  gas.getOrCreateMemberSheet_ = () => createMemberSheet(rows);
  const identity = createIdentity({ tokenIssuedAt: 2000 });
  const request = { action: "deleteMember", requestId: "request-delete-1" };

  const first = gas.deleteMember_(identity, request, {});
  const retry = gas.deleteMember_(identity, request, {});
  assert.equal(first.data.deleted, true);
  assert.deepEqual(JSON.parse(JSON.stringify(retry.data)), {
    deleted: true,
    duplicate: true,
  });
  assert.equal(rows.length, 0);

  assert.throws(
    () =>
      gas.upsertMember_(
        identity,
        { action: "upsertMember", requestId: "request-recreate-2", context: {} },
        {}
      ),
    (error) => error.appCode === "MEMBER_DELETED"
  );
});

test("legacy schema migration appends headers and promotes pending access without touching other fields", () => {
  for (const legacyLength of [17, 20]) {
    const gas = createGasContext();
    const headers = Array.from(
      legacyLength === 17 ? gas.LEGACY_MEMBER_HEADERS : gas.ACCESS_AUDIT_MEMBER_HEADERS
    );
    const member = new Array(legacyLength).fill("");
    member[gas.MEMBER_COLUMN.status - 1] = "pending";
    if (legacyLength >= 20) member[gas.MEMBER_COLUMN.lastAccessRequestId - 1] = "audit-request";
    const before = member.slice();
    const sheet = {
      getLastRow: () => 2,
      getLastColumn: () => headers.length,
      getMaxRows: () => 10,
      getRange(rowNumber, column, _rowCount = 1, columnCount = 1) {
        return {
          getDisplayValues() {
            return [headers.slice(column - 1, column - 1 + columnCount)];
          },
          getValues() {
            return [member.slice(column - 1, column - 1 + columnCount)];
          },
          setValues(values) {
            if (rowNumber === 1) {
              values[0].forEach((value, offset) => {
                headers[column - 1 + offset] = value;
              });
            } else {
              values[0].forEach((value, offset) => {
                member[column - 1 + offset] = value;
              });
            }
            return this;
          },
          setBackground() {
            return this;
          },
          setFontColor() {
            return this;
          },
          setFontWeight() {
            return this;
          },
          setNumberFormat() {
            return this;
          },
        };
      },
      autoResizeColumns() {},
    };
    const spreadsheet = { getSheetByName: () => sheet };
    gas.SpreadsheetApp.openById = () => spreadsheet;

    const result = gas.getOrCreateMemberSheet_({
      spreadsheetId: "shared-members-sheet",
      sheetName: "Members",
    });

    assert.equal(result, sheet);
    assert.deepEqual(headers, Array.from(gas.MEMBER_HEADERS));
    assert.equal(member[gas.MEMBER_COLUMN.status - 1], "approved");
    assert.deepEqual(
      member.filter((_value, index) => index !== gas.MEMBER_COLUMN.status - 1),
      before.filter((_value, index) => index !== gas.MEMBER_COLUMN.status - 1)
    );
  }
});

test("default access migration uses status-only writes and preserves admin_status", () => {
  const gas = createGasContext();
  const rows = [
    createMemberRow(gas, { memberId: "MBR-AAAAAAAAAA", status: "", adminStatus: "approved" }),
    createMemberRow(gas, { memberId: "MBR-BBBBBBBBBB", status: "pending", adminStatus: "denied" }),
    createMemberRow(gas, { memberId: "MBR-CCCCCCCCCC", status: "denied", adminStatus: "approved" }),
    createMemberRow(gas, { memberId: "MBR-DDDDDDDDDD", status: "approved", adminStatus: "denied" }),
  ];
  const writes = [];
  const changed = gas.migrateDefaultMemberAccess_(createMemberSheet(rows, writes));

  assert.equal(changed, 2);
  assert.deepEqual(
    rows.map((row) => row[gas.MEMBER_COLUMN.status - 1]),
    ["approved", "approved", "denied", "approved"]
  );
  assert.deepEqual(
    rows.map((row) => row[gas.MEMBER_COLUMN.adminStatus - 1]),
    ["approved", "denied", "approved", "denied"]
  );
  assert.deepEqual(
    writes.map(({ column, columnCount }) => [column, columnCount]),
    [
      [gas.MEMBER_COLUMN.status, 1],
      [gas.MEMBER_COLUMN.status, 1],
    ]
  );
});

test("health and setup responses never expose LINE channel configuration", () => {
  const gas = createGasContext();
  const health = JSON.parse(
    gas.doGet({ parameter: { action: "health", requestId: "health-123" } }).content
  );
  assert.equal(health.ok, true);
  assert.equal(health.data.service, "member-client-api");
  assert.equal("lineChannelId" in health.data, false);
  assert.equal(JSON.stringify(health).includes("2010787602"), false);

  gas.getConfig_ = () => ({
    lineChannelId: "2010787602",
    spreadsheetId: "shared-members-sheet",
    sheetName: "Members",
  });
  gas.getOrCreateMemberSheet_ = () => ({ getName: () => "Members" });
  gas.migrateDefaultMemberAccess_ = () => 0;
  gas.applySheetColumnFormats_ = () => {};
  const setup = gas.setup();
  assert.equal("lineChannelId" in setup, false);
  assert.equal(JSON.stringify(setup).includes("2010787602"), false);
});

test("verification rate limit rejects excess requests", () => {
  const cache = new Map();
  const gas = createGasContext({
    PropertiesService: {
      getScriptProperties: () => createProperties({ MAX_VERIFY_REQUESTS_PER_MINUTE: "1" }),
    },
    CacheService: {
      getScriptCache() {
        return {
          get: (key) => cache.get(key) ?? null,
          put: (key, value) => cache.set(key, String(value)),
        };
      },
    },
  });

  gas.enforceLineVerificationRateLimit_();
  assert.throws(
    () => gas.enforceLineVerificationRateLimit_(),
    (error) => error.appCode === "LINE_RATE_LIMITED"
  );
});
