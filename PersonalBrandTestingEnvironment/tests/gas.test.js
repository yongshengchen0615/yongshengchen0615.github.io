const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const code = fs.readFileSync(path.join(__dirname, "..", "gas", "Code.gs"), "utf8");
const ADMIN_LINE_USER_ID = `U${"a".repeat(32)}`;

function createGasContext(overrides = {}) {
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
        return {
          getProperty(name) {
            if (name === "ALLOWED_ORIGINS") return "https://example.github.io,http://localhost:8080";
            return "";
          },
        };
      },
    },
    ...overrides,
  };

  vm.createContext(context);
  vm.runInContext(code, context, { filename: "Code.gs" });
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
    status: "pending",
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

function createRowSheet(rows, options = {}) {
  return {
    getLastRow() {
      return rows.length + 1;
    },
    deleteRow(rowNumber) {
      rows.splice(rowNumber - 2, 1);
    },
    getRange(rowNumber, column, rowCount = 1, columnCount = 1) {
      const startIndex = rowNumber - 2;
      return {
        getValues() {
          return Array.from({ length: rowCount }, (_, rowOffset) =>
            rows[startIndex + rowOffset].slice(column - 1, column - 1 + columnCount)
          );
        },
        setValues(values) {
          if (options.beforeSetValues) {
            options.beforeSetValues({ rowNumber, column, rowCount, columnCount, values, rows });
          }
          values.forEach((valuesRow, rowOffset) => {
            valuesRow.forEach((value, columnOffset) => {
              rows[startIndex + rowOffset][column - 1 + columnOffset] = value;
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
                if (String(rows[startIndex + offset][column - 1]) === String(searchValue)) {
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

test("safeSheetText_ neutralizes spreadsheet formula prefixes", () => {
  const gas = createGasContext();
  assert.equal(gas.safeSheetText_("=IMPORTXML(...)"), "'=IMPORTXML(...)");
  assert.equal(gas.safeSheetText_("+123"), "'+123");
  assert.equal(gas.safeSheetText_("-123"), "'-123");
  assert.equal(gas.safeSheetText_("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(gas.safeSheetText_("王小明"), "王小明");
});

test("verifyLineIdToken_ accepts only current claims for the expected channel", () => {
  const claims = {
    iss: "https://access.line.me",
    sub: "U1234567890",
    aud: "1234567890",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    name: "王小明",
    picture: "https://profile.line-scdn.net/example",
    email: "member@example.com",
  };
  let requestOptions;
  const gas = createGasContext({
    UrlFetchApp: {
      fetch(url, options) {
        assert.equal(url, "https://api.line.me/oauth2/v2.1/verify");
        requestOptions = options;
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify(claims),
        };
      },
    },
  });

  const identity = gas.verifyLineIdToken_("header.payload.signature", "1234567890");
  assert.equal(identity.lineUserId, claims.sub);
  assert.equal(identity.displayName, claims.name);
  assert.equal(identity.tokenIssuedAt, claims.iat);
  assert.equal(requestOptions.payload.client_id, "1234567890");
  assert.equal(requestOptions.payload.id_token, "header.payload.signature");

  claims.aud = "9999999999";
  assert.throws(
    () => gas.verifyLineIdToken_("header.payload.signature", "1234567890"),
    (error) => error.appCode === "INVALID_TOKEN"
  );
});

test("verifyLineIdToken_ rejects a non-200 response without exposing the response body", () => {
  let fetchCalled = false;
  const gas = createGasContext({
    UrlFetchApp: {
      fetch() {
        fetchCalled = true;
        return {
          getResponseCode: () => 400,
          getContentText: () => "sensitive provider response",
        };
      },
    },
  });

  assert.throws(
    () => gas.verifyLineIdToken_("header.payload.signature", "1234567890"),
    (error) => error.appCode === "INVALID_TOKEN" && !error.message.includes("sensitive")
  );
  assert.equal(fetchCalled, true);
});

test("verifyLineIdToken_ distinguishes provider rate limits from invalid tokens", () => {
  const gas = createGasContext({
    UrlFetchApp: {
      fetch() {
        return {
          getResponseCode: () => 429,
          getContentText: () => "rate limited",
        };
      },
    },
  });

  assert.throws(
    () => gas.verifyLineIdToken_("header.payload.signature", "1234567890"),
    (error) => error.appCode === "LINE_RATE_LIMITED"
  );
});

test("bridge origins require an exact configured origin", () => {
  const gas = createGasContext();
  assert.equal(gas.isAllowedRequestOrigin_("https://example.github.io"), true);
  assert.equal(gas.isAllowedRequestOrigin_("http://localhost:8080"), true);
  assert.equal(gas.isAllowedRequestOrigin_("https://example.github.io.attacker.test"), false);
  assert.equal(gas.isAllowedRequestOrigin_("https://attacker.test"), false);
  assert.equal(gas.isAllowedRequestOrigin_("javascript:alert(1)"), false);
});

test("bridgeResponse_ safely serializes untrusted profile text", () => {
  const gas = createGasContext();
  const response = gas.bridgeResponse_(
    {
      ok: true,
      requestId: "request-123456",
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
  assert.equal(response.content.includes('"https://example.github.io"'), true);
});

test("doPost returns a request-bound JSON envelope", () => {
  const gas = createGasContext();
  gas.handleMemberRequest_ = () => ({ data: { created: true } });
  const request = {
    action: "upsertMember",
    idToken: "header.payload.signature",
    requestId: "request-123456",
    callbackOrigin: "https://example.github.io",
    context: { os: "web" },
    transport: "fetch",
  };

  const output = gas.doPost({ postData: { contents: JSON.stringify(request) }, parameter: {} });
  const payload = JSON.parse(output.content);

  assert.equal(output.mimeType, "application/json");
  assert.equal(payload.ok, true);
  assert.equal(payload.requestId, request.requestId);
  assert.equal(payload.data.created, true);
});

test("doPost rejects a fetch origin before any member mutation", () => {
  const gas = createGasContext();
  let mutationCalled = false;
  gas.handleMemberRequest_ = () => {
    mutationCalled = true;
    return { data: {} };
  };
  const request = {
    action: "deleteMember",
    idToken: "header.payload.signature",
    requestId: "request-123456",
    callbackOrigin: "https://attacker.test",
    context: {},
    transport: "fetch",
  };

  const output = gas.doPost({ postData: { contents: JSON.stringify(request) }, parameter: {} });
  const payload = JSON.parse(output.content);

  assert.equal(payload.ok, false);
  assert.equal(payload.code, "ORIGIN_NOT_ALLOWED");
  assert.equal(mutationCalled, false);
});

test("doPost handles JSON primitives as an invalid request", () => {
  const gas = createGasContext();
  const output = gas.doPost({ postData: { contents: "null" }, parameter: {} });
  const payload = JSON.parse(output.content);

  assert.equal(payload.ok, false);
  assert.equal(payload.code, "INVALID_REQUEST");
});

test("administrator authorization comes from one exact Members row with admin_status approved", () => {
  const gas = createGasContext();
  const rows = [
    createMemberRow(gas, {
      lineUserId: ADMIN_LINE_USER_ID,
      status: "denied",
      adminStatus: " APPROVED ",
    }),
  ];
  const sheet = createRowSheet(rows);

  assert.equal(gas.requireAdmin_({ lineUserId: ADMIN_LINE_USER_ID }, {}, sheet), 2);
  assert.throws(
    () => gas.requireAdmin_({ lineUserId: ADMIN_LINE_USER_ID.toUpperCase() }, {}, sheet),
    (error) => error.appCode === "ADMIN_FORBIDDEN"
  );

  rows[0][gas.MEMBER_COLUMN.adminStatus - 1] = "denied";
  assert.throws(
    () => gas.requireAdmin_({ lineUserId: ADMIN_LINE_USER_ID }, {}, sheet),
    (error) => error.appCode === "ADMIN_FORBIDDEN"
  );

  rows[0][gas.MEMBER_COLUMN.adminStatus - 1] = "approved";
  rows.push(
    createMemberRow(gas, {
      memberId: "MBR-DUPLICATE1",
      lineUserId: ADMIN_LINE_USER_ID,
      adminStatus: "approved",
    })
  );
  assert.throws(
    () => gas.requireAdmin_({ lineUserId: ADMIN_LINE_USER_ID }, {}, sheet),
    (error) => error.appCode === "ADMIN_FORBIDDEN"
  );
});

test("backend configuration no longer reads an administrator LINE ID allowlist", () => {
  const gas = createGasContext({
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(name) {
            if (name === "LINE_CHANNEL_ID") return "1234567890";
            if (name === "SPREADSHEET_ID") return "spreadsheet-id";
            if (name === "SHEET_NAME") return "Members";
            if (name === "ALLOWED_ORIGINS") return "https://example.github.io";
            return "";
          },
        };
      },
    },
  });

  const config = gas.getConfig_();
  assert.equal("adminLineUserIds" in config, false);
  assert.equal("adminConfigValid" in config, false);
});

test("admin actions verify the token before rejecting a non-admin without reading member data", () => {
  let wideMemberRead = false;
  const gas = createGasContext({
    LockService: {
      getScriptLock() {
        return { tryLock: () => true, releaseLock() {} };
      },
    },
  });
  let verified = false;
  gas.getConfig_ = () => ({
    lineChannelId: "1234567890",
  });
  const rows = [createMemberRow(gas)];
  const baseSheet = createRowSheet(rows);
  gas.getOrCreateMemberSheet_ = () => ({
    ...baseSheet,
    getRange(rowNumber, column, rowCount, columnCount) {
      if (column === 1 && columnCount === gas.MEMBER_HEADERS.length) wideMemberRead = true;
      return baseSheet.getRange(rowNumber, column, rowCount, columnCount);
    },
  });

  gas.verifyLineIdToken_ = () => {
    verified = true;
    return { lineUserId: `U${"c".repeat(32)}` };
  };

  assert.throws(
    () =>
      gas.handleMemberRequest_({
        action: "adminListMembers",
        idToken: "header.payload.signature",
        requestId: "request-admin-list-1",
        page: 1,
        pageSize: 50,
      }),
    (error) => error.appCode === "ADMIN_FORBIDDEN"
  );
  assert.equal(verified, true);
  assert.equal(wideMemberRead, false);
});

test("fetch and bridge requests parse and validate administrator fields consistently", () => {
  const gas = createGasContext();
  const payload = {
    action: "adminSetMemberAccess",
    idToken: "header.payload.signature",
    requestId: "request-admin-set-1",
    callbackOrigin: "https://example.github.io",
    targetMemberId: "MBR-ABCDEF1234",
    accessStatus: "APPROVED",
    expectedAccessStatus: "DENIED",
    expectedAccessUpdatedAt: "2026-07-22T01:02:03.000Z",
    page: "2",
    pageSize: "25",
  };
  const fetchRequest = gas.parseRequest_({
    postData: { contents: JSON.stringify(payload) },
    parameter: {},
  });
  const bridgeRequest = gas.parseRequest_({
    parameter: {
      ...payload,
      transport: "bridge",
      requestSecret: "a".repeat(48),
    },
  });

  for (const request of [fetchRequest, bridgeRequest]) {
    assert.equal(request.targetMemberId, "MBR-ABCDEF1234");
    assert.equal(request.accessStatus, "approved");
    assert.equal(request.expectedAccessStatus, "denied");
    assert.equal(request.expectedAccessUpdatedAt, "2026-07-22T01:02:03.000Z");
    assert.equal(request.page, 2);
    assert.equal(request.pageSize, 25);
    assert.doesNotThrow(() => gas.validateRequestEnvelope_(request));
  }

  const listRequest = { ...fetchRequest, action: "adminListMembers", page: 1, pageSize: 100 };
  assert.doesNotThrow(() => gas.validateRequestEnvelope_(listRequest));
  assert.throws(
    () => gas.validateRequestEnvelope_({ ...listRequest, pageSize: 101 }),
    (error) => error.appCode === "INVALID_PAGE_SIZE"
  );
  assert.throws(
    () =>
      gas.validateRequestEnvelope_({
        ...fetchRequest,
        accessStatus: "pending",
      }),
    (error) => error.appCode === "INVALID_ACCESS_STATUS"
  );
  assert.throws(
    () =>
      gas.validateRequestEnvelope_({
        ...fetchRequest,
        expectedAccessStatus: "pending",
      }),
    (error) => error.appCode === "INVALID_ACCESS_VERSION"
  );
  assert.throws(
    () =>
      gas.validateRequestEnvelope_({
        ...fetchRequest,
        expectedAccessUpdatedAt: "not-a-version",
      }),
    (error) => error.appCode === "INVALID_ACCESS_VERSION"
  );
});

test("upsertMember_ is retry-idempotent and counts distinct token sessions", () => {
  const rows = [];
  const requestCache = new Map();
  const sheet = {
    appendRow(row) {
      rows.push(row.slice());
    },
    getLastRow() {
      return rows.length + 1;
    },
    getRange(rowNumber, column, _rowCount, columnCount = 1) {
      const rowIndex = rowNumber - 2;
      return {
        getValues() {
          return [rows[rowIndex].slice(column - 1, column - 1 + columnCount)];
        },
        setValues(values) {
          values[0].forEach((value, index) => {
            rows[rowIndex][column - 1 + index] = value;
          });
          return this;
        },
        setNumberFormat() {
          return this;
        },
      };
    },
  };
  const gas = createGasContext({
    CacheService: {
      getScriptCache() {
        return {
          get: (key) => requestCache.get(key) || null,
          put: (key, value) => requestCache.set(key, value),
          remove: (key) => requestCache.delete(key),
        };
      },
    },
    LockService: {
      getScriptLock() {
        return { tryLock: () => true, releaseLock() {} };
      },
    },
    SpreadsheetApp: { flush() {} },
    Utilities: { getUuid: () => "12345678-1234-1234-1234-123456789abc" },
  });
  gas.getOrCreateMemberSheet_ = () => sheet;
  gas.applyMemberRowFormats_ = () => {};
  gas.findMemberRow_ = (_sheet, lineUserId) => {
    const rowIndex = rows.findIndex((row) => row[gas.MEMBER_COLUMN.lineUserId - 1] === lineUserId);
    return rowIndex < 0 ? 0 : rowIndex + 2;
  };

  const identity = {
    lineUserId: "U1234567890",
    displayName: "王小明",
    pictureUrl: "https://profile.line-scdn.net/example",
    email: "member@example.com",
    tokenIssuedAt: 1000,
  };
  const context = { type: "external", os: "web", language: "zh-TW", inClient: false };
  const firstRequest = { action: "upsertMember", requestId: "request-first-1", context };

  const created = gas.upsertMember_(identity, firstRequest, {});
  assert.equal(created.data.created, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(created.data.access)),
    { status: "approved", allowed: true }
  );
  assert.equal(created.data.member.status, "approved");
  assert.equal(rows[0][gas.MEMBER_COLUMN.loginCount - 1], 1);

  const retried = gas.upsertMember_(identity, firstRequest, {});
  assert.equal(retried.data.created, true);
  assert.equal(retried.data.access.status, "approved");
  assert.equal(retried.data.member.status, "approved");
  assert.equal(rows[0][gas.MEMBER_COLUMN.loginCount - 1], 1);

  rows[0][gas.MEMBER_COLUMN.status - 1] = "pending";

  const secondRequest = { action: "upsertMember", requestId: "request-second-2", context };
  const sameSession = gas.upsertMember_(identity, secondRequest, {});
  assert.equal(sameSession.data.created, false);
  assert.equal(sameSession.data.access.status, "approved");
  assert.equal(sameSession.data.access.allowed, true);
  assert.equal(sameSession.data.member.loginCount, 1);

  const retriedUpdate = gas.upsertMember_(identity, secondRequest, {});
  assert.equal(retriedUpdate.data.created, false);
  assert.equal(retriedUpdate.data.member.loginCount, 1);

  const newSession = gas.upsertMember_(
    { ...identity, tokenIssuedAt: 2000 },
    { action: "upsertMember", requestId: "request-third-3", context },
    {}
  );
  assert.equal(newSession.data.created, false);
  assert.equal(newSession.data.member.loginCount, 2);

  rows[0][gas.MEMBER_COLUMN.status - 1] = "denied";
  const denied = gas.upsertMember_(
    { ...identity, tokenIssuedAt: 2500 },
    { action: "upsertMember", requestId: "request-denied-4", context },
    {}
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(denied.data.access)),
    { status: "denied", allowed: false }
  );
  assert.equal(denied.data.member, null);
  assert.equal(rows[0][gas.MEMBER_COLUMN.status - 1], "denied");

  rows[0][gas.MEMBER_COLUMN.status - 1] = "active";
  const legacyActive = gas.upsertMember_(
    { ...identity, tokenIssuedAt: 2600 },
    { action: "upsertMember", requestId: "request-legacy-5", context },
    {}
  );
  assert.equal(legacyActive.data.access.status, "approved");
  assert.equal(legacyActive.data.access.allowed, true);
  assert.equal(legacyActive.data.member.status, "approved");
  assert.equal(rows[0][gas.MEMBER_COLUMN.status - 1], "active");

  gas.markMemberDeleted_(identity.lineUserId, 2600);
  rows.splice(0, rows.length);
  assert.throws(
    () =>
      gas.upsertMember_(
        { ...identity, tokenIssuedAt: 2600 },
        { action: "upsertMember", requestId: "request-delayed-6", context },
        {}
      ),
    (error) => error.appCode === "MEMBER_DELETED"
  );

  const recreatedWithNewToken = gas.upsertMember_(
    { ...identity, tokenIssuedAt: 3000 },
    { action: "upsertMember", requestId: "request-new-token-7", context },
    {}
  );
  assert.equal(recreatedWithNewToken.data.created, true);
  assert.equal(recreatedWithNewToken.data.access.status, "approved");
  assert.equal(recreatedWithNewToken.data.member.status, "approved");
  assert.equal(rows[0][gas.MEMBER_COLUMN.loginCount - 1], 1);

  assert.throws(
    () =>
      gas.upsertMember_(
        { ...identity, displayName: "延遲舊資料", tokenIssuedAt: 2600 },
        { action: "upsertMember", requestId: "request-old-after-new-8", context },
        {}
      ),
    (error) => error.appCode === "MEMBER_DELETED"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0][gas.MEMBER_COLUMN.displayName - 1], identity.displayName);
});

test("member login field updates preserve concurrent manual status and admin_status edits", () => {
  const requestCache = new Map();
  const gas = createGasContext({
    CacheService: {
      getScriptCache() {
        return {
          get: (key) => requestCache.get(key) || null,
          put: (key, value) => requestCache.set(key, value),
        };
      },
    },
    LockService: {
      getScriptLock() {
        return { tryLock: () => true, releaseLock() {} };
      },
    },
    SpreadsheetApp: { flush() {} },
  });
  const lineUserId = `U${"d".repeat(32)}`;
  const rows = [
    createMemberRow(gas, {
      lineUserId,
      status: "approved",
      adminStatus: "",
      lastTokenIat: 1000,
    }),
  ];
  let manualEditInjected = false;
  const sheet = createRowSheet(rows, {
    beforeSetValues({ rowNumber }) {
      if (rowNumber !== 2 || manualEditInjected) return;
      manualEditInjected = true;
      rows[0][gas.MEMBER_COLUMN.status - 1] = "denied";
      rows[0][gas.MEMBER_COLUMN.adminStatus - 1] = "approved";
    },
  });
  gas.getOrCreateMemberSheet_ = () => sheet;
  gas.applyMemberRowFormats_ = () => {};

  const result = gas.upsertMember_(
    {
      lineUserId,
      displayName: "更新名稱",
      pictureUrl: "https://profile.line-scdn.net/new",
      email: "new@example.com",
      tokenIssuedAt: 2000,
    },
    {
      action: "upsertMember",
      requestId: "request-field-level-1",
      context: { type: "external", os: "web", language: "zh-TW", inClient: false },
    },
    {}
  );

  assert.equal(manualEditInjected, true);
  assert.equal(rows[0][gas.MEMBER_COLUMN.status - 1], "denied");
  assert.equal(rows[0][gas.MEMBER_COLUMN.adminStatus - 1], "approved");
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.access)), {
    status: "denied",
    allowed: false,
  });
  assert.equal(result.data.member, null);
});

test("administrator access updates are audited, durable, and conflict-safe", () => {
  const cache = new Map();
  let flushCount = 0;
  const gas = createGasContext({
    LockService: {
      getScriptLock() {
        return { tryLock: () => true, releaseLock() {} };
      },
    },
    SpreadsheetApp: {
      flush() {
        flushCount += 1;
      },
    },
    CacheService: {
      getScriptCache() {
        return {
          get: (key) => cache.get(key) || null,
          put: (key, value) => cache.set(key, value),
        };
      },
    },
  });
  const rows = [
    createMemberRow(gas),
    createMemberRow(gas, {
      memberId: "MBR-ADMIN00001",
      lineUserId: ADMIN_LINE_USER_ID,
      displayName: "管理員",
      status: "denied",
      adminStatus: "approved",
    }),
  ];
  const originalLineUserId = rows[0][gas.MEMBER_COLUMN.lineUserId - 1];
  let manualAdminEditInjected = false;
  const sheet = createRowSheet(rows, {
    beforeSetValues({ rowNumber }) {
      if (rowNumber !== 2 || manualAdminEditInjected) return;
      manualAdminEditInjected = true;
      rows[0][gas.MEMBER_COLUMN.adminStatus - 1] = "approved";
    },
  });
  gas.getOrCreateMemberSheet_ = () => sheet;
  gas.applyMemberRowFormats_ = () => {};

  const admin = {
    lineUserId: ADMIN_LINE_USER_ID,
    displayName: "管理員",
    pictureUrl: "https://profile.line-scdn.net/admin",
  };
  const config = {};
  const request = {
    action: "adminSetMemberAccess",
    requestId: "request-admin-approve-1",
    targetMemberId: "MBR-ABCDEF1234",
    accessStatus: "approved",
    expectedAccessStatus: "approved",
    expectedAccessUpdatedAt: "",
  };

  const approved = gas.adminSetMemberAccess_(admin, request, config);
  assert.equal(approved.data.member.status, "approved");
  assert.equal(approved.data.duplicate, false);
  assert.equal(rows[0][gas.MEMBER_COLUMN.status - 1], "approved");
  assert.equal(rows[0][gas.MEMBER_COLUMN.accessUpdatedBy - 1], ADMIN_LINE_USER_ID);
  assert.equal(rows[0][gas.MEMBER_COLUMN.lastAccessRequestId - 1], request.requestId);
  assert.equal(rows[0][gas.MEMBER_COLUMN.lineUserId - 1], originalLineUserId);
  assert.equal(rows[0][gas.MEMBER_COLUMN.adminStatus - 1], "approved");
  assert.equal(manualAdminEditInjected, true);
  assert.equal(flushCount, 1);

  const retried = gas.adminSetMemberAccess_(admin, request, config);
  assert.equal(retried.data.duplicate, true);
  assert.equal(retried.data.member.status, "approved");
  assert.equal(flushCount, 1);

  assert.throws(
    () => gas.adminSetMemberAccess_(admin, { ...request, accessStatus: "denied" }, config),
    (error) => error.appCode === "REQUEST_ID_CONFLICT"
  );
  assert.equal(rows[0][gas.MEMBER_COLUMN.status - 1], "approved");
  assert.equal(flushCount, 1);

  const denied = gas.adminSetMemberAccess_(
    admin,
    {
      ...request,
      requestId: "request-admin-deny-2",
      accessStatus: "denied",
      expectedAccessStatus: "approved",
      expectedAccessUpdatedAt: approved.data.member.accessUpdatedAt,
    },
    config
  );
  assert.equal(denied.data.member.status, "denied");
  assert.equal(rows[0][gas.MEMBER_COLUMN.status - 1], "denied");
  assert.equal(flushCount, 2);

  rows[0][gas.MEMBER_COLUMN.status - 1] = "approved";
  assert.throws(
    () =>
      gas.adminSetMemberAccess_(
        admin,
        {
          ...request,
          requestId: "request-admin-manual-conflict-3",
          accessStatus: "approved",
          expectedAccessStatus: "denied",
          expectedAccessUpdatedAt: denied.data.member.accessUpdatedAt,
        },
        config
      ),
    (error) => error.appCode === "ACCESS_CONFLICT"
  );
  rows[0][gas.MEMBER_COLUMN.status - 1] = "denied";

  assert.throws(
    () => gas.adminSetMemberAccess_(admin, request, config),
    (error) => error.appCode === "ACCESS_CONFLICT"
  );
  assert.equal(rows[0][gas.MEMBER_COLUMN.status - 1], "denied");
  assert.equal(flushCount, 2);

  assert.throws(
    () =>
      gas.adminSetMemberAccess_(
        admin,
        { ...request, requestId: "request-admin-missing-3", targetMemberId: "MBR-0000000000" },
        config
      ),
    (error) => error.appCode === "MEMBER_NOT_FOUND"
  );
});

test("administrator listing is bounded, normalized, and omits internal identifiers", () => {
  const gas = createGasContext({
    LockService: {
      getScriptLock() {
        return { tryLock: () => true, releaseLock() {} };
      },
    },
  });
  const rows = [
    createMemberRow(gas, {
      memberId: "MBR-AAAAAAAAAA",
      lineUserId: ADMIN_LINE_USER_ID,
      status: "active",
      adminStatus: "approved",
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
    createMemberRow(gas, {
      memberId: "MBR-BBBBBBBBBB",
      status: "denied",
      joinedAt: new Date("2026-02-01T00:00:00.000Z"),
    }),
    createMemberRow(gas, {
      memberId: "MBR-CCCCCCCCCC",
      status: "unexpected-value",
      joinedAt: new Date("2026-03-01T00:00:00.000Z"),
    }),
  ];
  gas.getOrCreateMemberSheet_ = () => createRowSheet(rows);

  const result = gas.adminListMembers_(
    {
      lineUserId: ADMIN_LINE_USER_ID,
      displayName: "管理員",
      pictureUrl: "https://profile.line-scdn.net/admin",
    },
    { page: 1, pageSize: 2 },
    {}
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(result.data.metrics)),
    { all: 3, pending: 1, approved: 1, denied: 1 }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.data.pagination)),
    { page: 1, pageSize: 2, total: 3, totalPages: 2 }
  );
  assert.equal(result.data.members.length, 2);
  assert.equal(result.data.members[0].memberId, "MBR-CCCCCCCCCC");
  assert.equal(result.data.members[0].status, "pending");
  assert.equal(result.data.members[1].status, "denied");
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.data.admin)),
    {
      displayName: "管理員",
      pictureUrl: "https://profile.line-scdn.net/admin",
    }
  );
  for (const member of result.data.members) {
    assert.equal("lineUserId" in member, false);
    assert.equal("lastTokenIat" in member, false);
    assert.equal("lastRequestId" in member, false);
    assert.equal("lastAccessRequestId" in member, false);
    assert.equal("accessUpdatedBy" in member, false);
    assert.equal("adminStatus" in member, false);
  }
});

test("exact 17- and 20-column member schemas append admin_status and migrate default access", () => {
  const gas = createGasContext();
  function migrateFrom(sourceHeaders) {
    const headers = Array.from(sourceHeaders);
    const statuses = ["pending", "", "denied", "active", "unexpected-value"];
    let formatted = false;
    let flushCount = 0;
    const sheet = {
      getName: () => "Members",
      getLastRow: () => statuses.length + 1,
      getLastColumn: () => headers.length,
      getRange(row, column, rowCount, columnCount = 1) {
        return {
          getDisplayValues() {
            return [headers.slice(column - 1, column - 1 + columnCount)];
          },
          getValues() {
            if (row >= 2 && column === gas.MEMBER_COLUMN.status) {
              return [[statuses[row - 2]]];
            }
            return [[]];
          },
          setValues(values) {
            if (row === 1) {
              values[0].forEach((value, index) => {
                headers[column - 1 + index] = value;
              });
            } else if (row >= 2 && column === gas.MEMBER_COLUMN.status) {
              statuses[row - 2] = values[0][0];
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
        };
      },
      autoResizeColumns() {},
    };
    gas.SpreadsheetApp = {
      openById() {
        return { getSheetByName: () => sheet };
      },
      flush() {
        flushCount += 1;
      },
    };
    gas.applySheetColumnFormats_ = () => {
      formatted = true;
    };

    assert.equal(
      gas.getOrCreateMemberSheet_({ spreadsheetId: "sheet", sheetName: "Members" }),
      sheet
    );
    assert.deepEqual(Array.from(headers), Array.from(gas.MEMBER_HEADERS));
    assert.deepEqual(statuses, ["approved", "approved", "denied", "active", "unexpected-value"]);
    assert.equal(formatted, true);
    assert.equal(flushCount, 1);
  }

  migrateFrom(gas.LEGACY_MEMBER_HEADERS);
  migrateFrom(gas.ACCESS_AUDIT_MEMBER_HEADERS);

  const invalidHeaders = Array.from(gas.LEGACY_MEMBER_HEADERS);
  invalidHeaders[5] = "manually_changed";
  const invalidSheet = {
    getLastRow: () => 1,
    getLastColumn: () => invalidHeaders.length,
    getRange(_row, column, _rowCount, columnCount) {
      return {
        getDisplayValues: () => [invalidHeaders.slice(column - 1, column - 1 + columnCount)],
      };
    },
  };
  gas.SpreadsheetApp = {
    openById: () => ({ getSheetByName: () => invalidSheet }),
  };
  assert.throws(
    () => gas.getOrCreateMemberSheet_({ spreadsheetId: "sheet", sheetName: "Members" }),
    (error) => error.appCode === "SCHEMA_MISMATCH"
  );
});

test("pending and denied members retain the right to delete their own records", () => {
  for (const status of ["pending", "denied"]) {
    const cache = new Map();
    let flushCount = 0;
    const gas = createGasContext({
      LockService: {
        getScriptLock() {
          return { tryLock: () => true, releaseLock() {} };
        },
      },
      CacheService: {
        getScriptCache() {
          return {
            get: (key) => cache.get(key) || null,
            put: (key, value) => cache.set(key, value),
          };
        },
      },
      SpreadsheetApp: {
        flush() {
          flushCount += 1;
        },
      },
    });
    const identity = {
      lineUserId: `U${"b".repeat(32)}`,
      tokenIssuedAt: 1000,
    };
    const rows = [createMemberRow(gas, { status, lineUserId: identity.lineUserId })];
    gas.getOrCreateMemberSheet_ = () => createRowSheet(rows);

    const result = gas.deleteMember_(
      identity,
      { action: "deleteMember", requestId: `request-delete-${status}` },
      {}
    );
    assert.equal(result.data.deleted, true);
    assert.equal(rows.length, 0);
    assert.equal(flushCount, 1);
  }
});

test("verification rate limiter bounds LINE fetch attempts per minute", () => {
  const cache = new Map();
  const gas = createGasContext({
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(name) {
            if (name === "MAX_VERIFY_REQUESTS_PER_MINUTE") return "1";
            return "";
          },
        };
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
          get: (key) => cache.get(key) || null,
          put: (key, value) => cache.set(key, value),
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

test("doGet exposes only a harmless health response", () => {
  const gas = createGasContext();
  const output = gas.doGet({ parameter: { action: "health", requestId: "health-123" } });
  const payload = JSON.parse(output.content);

  assert.equal(payload.ok, true);
  assert.equal(payload.requestId, "health-123");
  assert.equal(payload.data.service, "member-api");
  assert.equal("lineChannelId" in payload.data, false);
  assert.equal("spreadsheetId" in payload.data, false);
});
