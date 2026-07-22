const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const code = fs.readFileSync(path.join(__dirname, "..", "gas", "Code.gs"), "utf8");

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
  const gas = createGasContext({
    UrlFetchApp: {
      fetch() {
        return {
          getResponseCode: () => 400,
          getContentText: () => "sensitive provider response",
        };
      },
    },
  });

  assert.throws(
    () => gas.verifyLineIdToken_("expired-token", "1234567890"),
    (error) => error.appCode === "INVALID_TOKEN" && !error.message.includes("sensitive")
  );
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
  assert.equal(created.data.member.loginCount, 1);

  const retried = gas.upsertMember_(identity, firstRequest, {});
  assert.equal(retried.data.created, true);
  assert.equal(retried.data.member.loginCount, 1);

  const secondRequest = { action: "upsertMember", requestId: "request-second-2", context };
  const sameSession = gas.upsertMember_(identity, secondRequest, {});
  assert.equal(sameSession.data.created, false);
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

  gas.markMemberDeleted_(identity.lineUserId, 2000);
  rows.splice(0, rows.length);
  assert.throws(
    () =>
      gas.upsertMember_(
        { ...identity, tokenIssuedAt: 2000 },
        { action: "upsertMember", requestId: "request-delayed-4", context },
        {}
      ),
    (error) => error.appCode === "MEMBER_DELETED"
  );

  const recreatedWithNewToken = gas.upsertMember_(
    { ...identity, tokenIssuedAt: 3000 },
    { action: "upsertMember", requestId: "request-new-token-5", context },
    {}
  );
  assert.equal(recreatedWithNewToken.data.created, true);
  assert.equal(recreatedWithNewToken.data.member.loginCount, 1);

  assert.throws(
    () =>
      gas.upsertMember_(
        { ...identity, displayName: "延遲舊資料", tokenIssuedAt: 2000 },
        { action: "upsertMember", requestId: "request-old-after-new-6", context },
        {}
      ),
    (error) => error.appCode === "MEMBER_DELETED"
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0][gas.MEMBER_COLUMN.displayName - 1], identity.displayName);
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
