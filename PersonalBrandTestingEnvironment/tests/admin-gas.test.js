const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CODE = fs.readFileSync(path.join(ROOT, "gas/admin/Code.gs"), "utf8");
const ADMIN_CHANNEL_ID = "2010791619";
const ADMIN_USER_ID = `U${"a".repeat(32)}`;
const MEMBER_USER_ID = `U${"b".repeat(32)}`;

function createOutput(content) {
  return {
    content,
    mimeType: "",
    setMimeType(value) {
      this.mimeType = value;
      return this;
    },
    setXFrameOptionsMode() {
      return this;
    },
    getContent() {
      return this.content;
    },
  };
}

function createGasContext(options = {}) {
  let uuidCounter = 0;
  const propertyValues = {
    LINE_CHANNEL_ID: ADMIN_CHANNEL_ID,
    SPREADSHEET_ID: "spreadsheet-id",
    SHEET_NAME: "Members",
    ADMIN_SHEET_NAME: "Admins",
    POINT_CLAIM_SECRET: "s".repeat(64),
    ALLOWED_ORIGINS: "https://example.github.io,http://localhost:8080",
    ...options.properties,
  };
  const cache = options.cache || new Map();
  const claims = {
    iss: "https://access.line.me",
    sub: ADMIN_USER_ID,
    aud: ADMIN_CHANNEL_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    name: "管理員",
    picture: "https://profile.line-scdn.net/admin",
    email: "admin@example.com",
    ...options.claims,
  };

  const context = {
    Date,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    RegExp,
    Error,
    isNaN,
    console: { error() {} },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(name) {
            return Object.prototype.hasOwnProperty.call(propertyValues, name)
              ? propertyValues[name]
              : "";
          },
          setProperty(name, value) {
            propertyValues[name] = String(value);
            return this;
          },
        };
      },
    },
    CacheService: {
      getScriptCache() {
        return {
          get(key) {
            return cache.has(key) ? cache.get(key) : null;
          },
          put(key, value) {
            cache.set(key, String(value));
          },
        };
      },
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock() {
            return true;
          },
          releaseLock() {},
        };
      },
    },
    UrlFetchApp: {
      fetch(_url, _requestOptions) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify(claims),
        };
      },
    },
    Utilities: {
      Charset: { UTF_8: "UTF-8" },
      DigestAlgorithm: { SHA_256: "SHA_256" },
      getUuid() {
        uuidCounter += 1;
        const hex = crypto
          .createHash("sha256")
          .update(`uuid-${uuidCounter}`)
          .digest("hex")
          .slice(0, 32);
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      },
      computeHmacSha256Signature(value, key) {
        return Array.from(crypto.createHmac("sha256", key).update(value).digest(), (byte) =>
          byte > 127 ? byte - 256 : byte
        );
      },
      computeDigest(_algorithm, value) {
        return Array.from(crypto.createHash("sha256").update(value).digest(), (byte) =>
          byte > 127 ? byte - 256 : byte
        );
      },
      base64EncodeWebSafe(bytes) {
        return Buffer.from(Array.from(bytes, (byte) => (Number(byte) + 256) % 256))
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_");
      },
    },
    SpreadsheetApp: options.SpreadsheetApp || {
      openById() {
        throw new Error("Spreadsheet mock not installed");
      },
      flush() {},
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: createOutput,
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: "ALLOWALL" },
      createHtmlOutput: createOutput,
    },
    ...options.globals,
    __propertyValues: propertyValues,
  };

  vm.createContext(context);
  vm.runInContext(CODE, context, { filename: "gas/admin/Code.gs" });
  return context;
}

function createSheet(name, headers, rows = [], options = {}) {
  const data = headers ? [headers.slice(), ...rows.map((row) => row.slice())] : [];

  function ensureCell(rowIndex, columnIndex) {
    while (data.length <= rowIndex) data.push([]);
    while (data[rowIndex].length <= columnIndex) data[rowIndex].push("");
  }

  const sheet = {
    name,
    data,
    getName() {
      return name;
    },
    getLastRow() {
      return data.length;
    },
    getLastColumn() {
      return data.length ? data[0].length : 0;
    },
    getMaxRows() {
      return Math.max(100, data.length);
    },
    appendRow(row) {
      data.push(row.slice());
      return this;
    },
    setFrozenRows() {
      return this;
    },
    autoResizeColumns() {
      return this;
    },
    getRange(rowNumber, column, rowCount = 1, columnCount = 1) {
      if (options.onGetRange) {
        options.onGetRange({ rowNumber, column, rowCount, columnCount });
      }
      const range = {
        getValues() {
          return Array.from({ length: rowCount }, (_, rowOffset) =>
            Array.from({ length: columnCount }, (_, columnOffset) => {
              const row = data[rowNumber - 1 + rowOffset] || [];
              return row[column - 1 + columnOffset] ?? "";
            })
          );
        },
        getDisplayValues() {
          return this.getValues().map((row) =>
            row.map((value) => (value == null ? "" : String(value)))
          );
        },
        setValues(values) {
          if (options.beforeSetValues) {
            options.beforeSetValues({
              rowNumber,
              column,
              rowCount,
              columnCount,
              values,
              sheet,
            });
          }
          values.forEach((row, rowOffset) => {
            row.forEach((value, columnOffset) => {
              const targetRow = rowNumber - 1 + rowOffset;
              const targetColumn = column - 1 + columnOffset;
              ensureCell(targetRow, targetColumn);
              data[targetRow][targetColumn] = value;
            });
          });
          return this;
        },
        setNumberFormat() {
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
      return range;
    },
  };
  return sheet;
}

function createSpreadsheet(initialSheets = {}) {
  const sheets = { ...initialSheets };
  return {
    sheets,
    getSheetByName(name) {
      return sheets[name] || null;
    },
    insertSheet(name) {
      const sheet = createSheet(name, null);
      sheets[name] = sheet;
      return sheet;
    },
  };
}

function installSpreadsheet(gas, spreadsheet) {
  gas.SpreadsheetApp = {
    openById(id) {
      assert.equal(id, "spreadsheet-id");
      return spreadsheet;
    },
    flush() {},
  };
}

function createMemberRow(gas, overrides = {}) {
  const row = new Array(gas.MEMBER_HEADERS.length).fill("");
  const values = {
    memberId: "MBR-ABCDEF1234",
    lineUserId: MEMBER_USER_ID,
    displayName: "會員甲",
    pictureUrl: "https://profile.line-scdn.net/member",
    email: "member@example.com",
    status: "approved",
    joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    lastLoginAt: new Date("2026-01-02T00:00:00.000Z"),
    loginCount: 2,
    contextType: "external",
    contextOs: "web",
    contextLanguage: "zh-TW",
    inLiffClient: false,
    viewType: "full",
    lastTokenIat: 1000,
    lastRequestId: "request-member-old",
    accessUpdatedAt: "",
    accessUpdatedBy: "",
    lastAccessRequestId: "",
    adminStatus: "approved",
    phone: "+886912345678",
    birthday: "1990-05-20",
    ...overrides,
  };
  Object.entries(values).forEach(([key, value]) => {
    row[gas.MEMBER_COLUMN[key] - 1] = value;
  });
  return row;
}

function createAdminRow(gas, overrides = {}) {
  const row = new Array(gas.ADMIN_HEADERS.length).fill("");
  const values = {
    adminId: "ADM-ABCDEF1234",
    lineUserId: ADMIN_USER_ID,
    displayName: "管理員",
    pictureUrl: "https://profile.line-scdn.net/admin",
    email: "admin@example.com",
    status: "approved",
    requestedAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastLoginAt: new Date("2026-01-01T00:00:00.000Z"),
    loginCount: 1,
    lastTokenIat: 1000,
    lastRequestId: "request-admin-old",
    ...overrides,
  };
  Object.entries(values).forEach(([key, value]) => {
    row[gas.ADMIN_COLUMN[key] - 1] = value;
  });
  return row;
}

function createPointTypeRow(gas, overrides = {}) {
  const row = new Array(gas.POINT_TYPE_HEADERS.length).fill("");
  const values = {
    pointTypeId: "PTY-ABCDEF1234",
    label: "3 點",
    points: 3,
    status: "active",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: ADMIN_USER_ID,
    lastRequestId: "request-point-type-old",
    expiryMode: "limited",
    redemptionMode: "once_per_member",
    deletedBy: "",
    deleteRequestId: "",
    ...overrides,
  };
  Object.entries(values).forEach(([key, value]) => {
    row[gas.POINT_TYPE_COLUMN[key] - 1] = value;
  });
  return row;
}

function createPointCampaignRow(gas, overrides = {}) {
  const requestId = overrides.lastRequestId || "request-point-campaign-old";
  const campaignId = overrides.campaignId || "PCG-ABCDEF1234";
  const secret = overrides.pointClaimSecret || "s".repeat(64);
  const claim = gas.createCampaignClaim_(campaignId, requestId, secret);
  const row = new Array(gas.POINT_CAMPAIGN_HEADERS.length).fill("");
  const values = {
    campaignId,
    pointTypeId: "PTY-ABCDEF1234",
    labelSnapshot: "3 點",
    pointsSnapshot: 3,
    claimHash: gas.sha256Hex_(claim),
    status: "active",
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: ADMIN_USER_ID,
    lastRequestId: requestId,
    expiryModeSnapshot: "limited",
    redemptionModeSnapshot: "once_per_member",
    ...overrides,
  };
  delete values.pointClaimSecret;
  Object.entries(values).forEach(([key, value]) => {
    row[gas.POINT_CAMPAIGN_COLUMN[key] - 1] = value;
  });
  return { row, claim };
}

function createPointRedemptionRow(gas, overrides = {}) {
  const row = new Array(gas.POINT_REDEMPTION_HEADERS.length).fill("");
  const values = {
    redemptionId: "RDM-ABCDEF1234567890",
    campaignId: "PCG-ABCDEF1234",
    pointTypeId: "PTY-ABCDEF1234",
    memberId: "MBR-ABCDEF1234",
    lineUserId: MEMBER_USER_ID,
    points: 3,
    balanceAfter: 8,
    redeemedAt: new Date("2026-01-03T00:00:00.000Z"),
    requestId: "request-point-history",
    redemptionModeSnapshot: "once_per_member",
    ...overrides,
  };
  Object.entries(values).forEach(([key, value]) => {
    row[gas.POINT_REDEMPTION_COLUMN[key] - 1] = value;
  });
  return row;
}

function configFor(gas) {
  return {
    lineChannelId: ADMIN_CHANNEL_ID,
    spreadsheetId: "spreadsheet-id",
    sheetName: "Members",
    adminSheetName: "Admins",
    pointTypesSheetName: "PointTypes",
    pointCampaignsSheetName: "PointCampaigns",
    pointRedemptionsSheetName: "PointRedemptions",
    memberLiffUrl: "https://liff.line.me/2010787602-kaiSm2eq",
    pointClaimSecret: "s".repeat(64),
    allowedOrigins: ["https://example.github.io"],
  };
}

function identity(overrides = {}) {
  return {
    lineUserId: ADMIN_USER_ID,
    displayName: "管理員新名稱",
    pictureUrl: "https://profile.line-scdn.net/admin-new",
    email: "new-admin@example.com",
    tokenIssuedAt: 2000,
    ...overrides,
  };
}

test("administrator GAS uses the isolated channel and compatible sheet schemas", () => {
  const gas = createGasContext();
  assert.equal(gas.REQUIRED_LINE_CHANNEL_ID, ADMIN_CHANNEL_ID);
  assert.equal(gas.MEMBER_HEADERS.length, 23);
  assert.equal(gas.MEMBER_HEADERS[20], "admin_status");
  assert.equal(gas.MEMBER_HEADERS[21], "phone");
  assert.equal(gas.MEMBER_HEADERS[22], "birthday");
  assert.equal(gas.ADMIN_HEADERS.length, 12);
  assert.deepEqual(
    JSON.parse(JSON.stringify(gas.ADMIN_HEADERS)),
    [
      "admin_id",
      "line_user_id",
      "display_name",
      "picture_url",
      "email",
      "status",
      "requested_at",
      "updated_at",
      "last_login_at",
      "login_count",
      "last_token_iat",
      "last_request_id",
    ]
  );
  assert.deepEqual(Array.from(gas.POINT_TYPE_HEADERS), [
    "point_type_id",
    "label",
    "points",
    "status",
    "created_at",
    "updated_at",
    "created_by",
    "last_request_id",
    "expiry_mode",
    "redemption_mode",
    "deleted_by",
    "delete_request_id",
  ]);
  assert.deepEqual(Array.from(gas.POINT_CAMPAIGN_HEADERS), [
    "campaign_id",
    "point_type_id",
    "label_snapshot",
    "points_snapshot",
    "claim_hash",
    "status",
    "expires_at",
    "created_at",
    "created_by",
    "last_request_id",
    "expiry_mode_snapshot",
    "redemption_mode_snapshot",
  ]);
  assert.deepEqual(Array.from(gas.POINT_REDEMPTION_HEADERS), [
    "redemption_id",
    "campaign_id",
    "point_type_id",
    "member_id",
    "line_user_id",
    "points",
    "balance_after",
    "redeemed_at",
    "request_id",
    "redemption_mode_snapshot",
  ]);
});

test("configuration fails closed unless the administrator channel is exact", () => {
  const gas = createGasContext();
  const config = gas.getConfig_();
  assert.equal(config.lineChannelId, ADMIN_CHANNEL_ID);
  assert.equal(config.sheetName, "Members");
  assert.equal(config.adminSheetName, "Admins");
  assert.equal(config.pointTypesSheetName, "PointTypes");
  assert.equal(config.pointCampaignsSheetName, "PointCampaigns");
  assert.equal(config.pointRedemptionsSheetName, "PointRedemptions");
  assert.equal(config.memberLiffUrl, "https://liff.line.me/2010787602-kaiSm2eq");
  assert.equal(config.pointClaimSecret, "s".repeat(64));

  const wrongChannel = createGasContext({
    properties: { LINE_CHANNEL_ID: "2010787602" },
  });
  assert.throws(
    () => wrongChannel.getConfig_(),
    (error) => error.appCode === "CONFIG_ERROR"
  );

  const sameSheet = createGasContext({
    properties: { ADMIN_SHEET_NAME: "members" },
  });
  assert.throws(
    () => sameSheet.getConfig_(),
    (error) => error.appCode === "CONFIG_ERROR"
  );

  for (const properties of [
    { POINT_TYPE_SHEET_NAME: "admins" },
    { POINT_CAMPAIGN_SHEET_NAME: "PointTypes" },
    { POINT_REDEMPTION_SHEET_NAME: "members" },
    { MEMBER_LIFF_URL: "https://evil.example/2010787602-kaiSm2eq" },
    { MEMBER_LIFF_URL: "https://liff.line.me/2010787602-kaiSm2eq?claim=bad" },
    { POINT_CLAIM_SECRET: "" },
    { POINT_CLAIM_SECRET: "too-short" },
  ]) {
    const invalid = createGasContext({ properties });
    assert.throws(
      () => invalid.getConfig_(),
      (error) => error.appCode === "CONFIG_ERROR"
    );
  }

  const trailingSlash = createGasContext({
    properties: { MEMBER_LIFF_URL: "https://liff.line.me/2010787602-kaiSm2eq/" },
  });
  assert.equal(
    trailingSlash.getConfig_().memberLiffUrl,
    "https://liff.line.me/2010787602-kaiSm2eq"
  );
});

test("setup safely creates a claim secret and all point sheets with exact schemas", () => {
  const gas = createGasContext({ properties: { POINT_CLAIM_SECRET: "" } });
  const spreadsheet = createSpreadsheet();
  installSpreadsheet(gas, spreadsheet);

  const result = gas.setup();
  assert.match(gas.__propertyValues.POINT_CLAIM_SECRET, /^[a-f0-9]{64}$/);
  assert.equal(result.pointTypesSheetName, "PointTypes");
  assert.equal(result.pointCampaignsSheetName, "PointCampaigns");
  assert.equal(result.pointRedemptionsSheetName, "PointRedemptions");
  assert.equal(result.pointTypeColumns, 12);
  assert.equal(result.pointCampaignColumns, 12);
  assert.equal(result.pointRedemptionColumns, 10);
  assert.deepEqual(
    JSON.parse(JSON.stringify(spreadsheet.sheets.PointTypes.data[0])),
    JSON.parse(JSON.stringify(gas.POINT_TYPE_HEADERS))
  );
  assert.deepEqual(
    spreadsheet.sheets.PointCampaigns.data[0],
    Array.from(gas.POINT_CAMPAIGN_HEADERS)
  );
  assert.deepEqual(
    spreadsheet.sheets.PointRedemptions.data[0],
    Array.from(gas.POINT_REDEMPTION_HEADERS)
  );
  assert.equal(Object.prototype.hasOwnProperty.call(result, "pointClaimSecret"), false);
});

test("setup never replaces an explicitly malformed point claim secret", () => {
  const gas = createGasContext({ properties: { POINT_CLAIM_SECRET: "weak" } });
  assert.throws(
    () => gas.setup(),
    (error) => error.appCode === "CONFIG_ERROR"
  );
  assert.equal(gas.__propertyValues.POINT_CLAIM_SECRET, "weak");
});

test("LINE verification sends the exact admin client_id and validates returned claims", () => {
  let requestedUrl = "";
  let requestedOptions;
  const gas = createGasContext({
    globals: {
      UrlFetchApp: {
        fetch(url, options) {
          requestedUrl = url;
          requestedOptions = options;
          return {
            getResponseCode: () => 200,
            getContentText: () =>
              JSON.stringify({
                iss: "https://access.line.me",
                sub: ADMIN_USER_ID,
                aud: ADMIN_CHANNEL_ID,
                exp: Math.floor(Date.now() / 1000) + 300,
                iat: Math.floor(Date.now() / 1000),
                name: "管理員",
              }),
          };
        },
      },
    },
  });

  const verified = gas.verifyLineIdToken_("header.payload.signature", ADMIN_CHANNEL_ID);
  assert.equal(requestedUrl, "https://api.line.me/oauth2/v2.1/verify");
  assert.equal(requestedOptions.payload.client_id, ADMIN_CHANNEL_ID);
  assert.equal(requestedOptions.payload.id_token, "header.payload.signature");
  assert.equal(verified.lineUserId, ADMIN_USER_ID);

  const memberAudience = createGasContext({ claims: { aud: "2010787602" } });
  assert.throws(
    () => memberAudience.verifyLineIdToken_("header.payload.signature", ADMIN_CHANNEL_ID),
    (error) => error.appCode === "INVALID_TOKEN"
  );

  const malformedSubject = createGasContext({ claims: { sub: "U-not-a-real-user" } });
  assert.throws(
    () => malformedSubject.verifyLineIdToken_("header.payload.signature", ADMIN_CHANNEL_ID),
    (error) => error.appCode === "INVALID_TOKEN"
  );
});

test("only the seven administrator actions are accepted and untrusted fields are ignored", () => {
  const gas = createGasContext();
  for (const action of [
    "upsertMember",
    "updateMemberProfile",
    "deleteMember",
    "redeemPointCampaign",
  ]) {
    assert.throws(
      () =>
        gas.validateRequestEnvelope_({
          action,
          idToken: "header.payload.signature",
          requestId: `request-${action}`,
          transport: "fetch",
        }),
      (error) => error.appCode === "UNSUPPORTED_ACTION"
    );
  }

  const tokenFields = {
    idToken: "header.payload.signature",
    requestId: "request-valid-action",
    transport: "fetch",
  };
  for (const request of [
    { ...tokenFields, action: "adminListMembers", page: 1, pageSize: 50 },
    {
      ...tokenFields,
      action: "adminSetMemberAccess",
      targetMemberId: "MBR-ABCDEF1234",
      accessStatus: "denied",
      expectedAccessStatus: "approved",
      expectedAccessUpdatedAt: "",
    },
    { ...tokenFields, action: "adminListPointTypes" },
    { ...tokenFields, action: "adminListPointHistory" },
    {
      ...tokenFields,
      action: "adminCreatePointType",
      points: 3,
      expiryMode: "limited",
      redemptionMode: "once_per_member",
    },
    {
      ...tokenFields,
      action: "adminDeletePointType",
      pointTypeId: "PTY-ABCDEF1234",
    },
    {
      ...tokenFields,
      action: "adminCreatePointCampaign",
      pointTypeId: "PTY-ABCDEF1234",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
  ]) {
    gas.validateRequestEnvelope_(request);
  }

  const parsed = gas.parseRequest_({
    postData: {
      contents: JSON.stringify({
        action: "adminListMembers",
        idToken: "header.payload.signature",
        requestId: "request-admin-list-1",
        callbackOrigin: "https://example.github.io",
        page: 1,
        pageSize: 50,
        adminStatus: "approved",
        status: "approved",
        phone: "0912345678",
        birthday: "1990-05-20",
        label: "=STEAL()",
        claimHash: "secret",
        createdBy: ADMIN_USER_ID,
      }),
    },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "adminStatus"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "status"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "phone"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "birthday"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "label"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "claimHash"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "createdBy"), false);
  gas.validateRequestEnvelope_(parsed);
});

test("member actions are rejected before config, LINE verification or Sheets are touched", () => {
  const gas = createGasContext();
  let configRead = false;
  let tokenVerified = false;
  let sheetOpened = false;
  gas.getConfig_ = () => {
    configRead = true;
    throw new Error("config must not be read");
  };
  gas.verifyLineIdToken_ = () => {
    tokenVerified = true;
    throw new Error("LINE must not be called");
  };
  gas.SpreadsheetApp.openById = () => {
    sheetOpened = true;
    throw new Error("Sheet must not be opened");
  };

  for (const action of [
    "upsertMember",
    "updateMemberProfile",
    "deleteMember",
    "redeemPointCampaign",
  ]) {
    assert.throws(
      () => gas.handleAdminRequest_({ action, idToken: "header.payload.signature" }),
      (error) => error.appCode === "UNSUPPORTED_ACTION"
    );
  }
  assert.equal(configRead, false);
  assert.equal(tokenVerified, false);
  assert.equal(sheetOpened, false);
});

test("all seven administrator actions dispatch only after config and LINE verification", () => {
  const gas = createGasContext();
  const routed = [];
  let configReads = 0;
  let tokenVerifications = 0;
  gas.getConfig_ = () => {
    configReads += 1;
    return configFor(gas);
  };
  gas.verifyLineIdToken_ = () => {
    tokenVerifications += 1;
    return identity();
  };
  for (const [action, functionName] of [
    ["adminListMembers", "adminListMembers_"],
    ["adminSetMemberAccess", "adminSetMemberAccess_"],
    ["adminListPointTypes", "adminListPointTypes_"],
    ["adminListPointHistory", "adminListPointHistory_"],
    ["adminCreatePointType", "adminCreatePointType_"],
    ["adminDeletePointType", "adminDeletePointType_"],
    ["adminCreatePointCampaign", "adminCreatePointCampaign_"],
  ]) {
    gas[functionName] = (_identity, request) => {
      routed.push(request.action);
      return { data: { route: request.action } };
    };
    const result = gas.handleAdminRequest_({
      action,
      idToken: "header.payload.signature",
    });
    assert.equal(result.data.route, action);
  }
  assert.deepEqual(routed, Array.from(gas.ADMIN_ACTIONS));
  assert.equal(configReads, 7);
  assert.equal(tokenVerifications, 7);
});

test("normal requests fail closed on a missing claim secret before LINE or Sheets", () => {
  const gas = createGasContext({ properties: { POINT_CLAIM_SECRET: "" } });
  let tokenVerified = false;
  let sheetOpened = false;
  gas.verifyLineIdToken_ = () => {
    tokenVerified = true;
    return identity();
  };
  gas.SpreadsheetApp.openById = () => {
    sheetOpened = true;
    throw new Error("Sheet must not be opened");
  };
  assert.throws(
    () =>
      gas.handleAdminRequest_({
        action: "adminListPointTypes",
        idToken: "header.payload.signature",
      }),
    (error) => error.appCode === "CONFIG_ERROR"
  );
  assert.equal(tokenVerified, false);
  assert.equal(sheetOpened, false);
});

test("first verified login creates exactly one pending request and never auto-approves", () => {
  const gas = createGasContext();
  const adminSheet = createSheet("Admins", gas.ADMIN_HEADERS, []);

  assert.throws(
    () =>
      gas.requireApprovedAdmin_(
        identity(),
        { requestId: "request-first-admin" },
        adminSheet
      ),
    (error) => error.appCode === "ADMIN_PENDING"
  );

  assert.equal(adminSheet.data.length, 2);
  const row = adminSheet.data[1];
  assert.match(row[gas.ADMIN_COLUMN.adminId - 1], /^ADM-[A-Z0-9]{10}$/);
  assert.equal(row[gas.ADMIN_COLUMN.lineUserId - 1], ADMIN_USER_ID);
  assert.equal(row[gas.ADMIN_COLUMN.status - 1], "pending");
  assert.equal(row[gas.ADMIN_COLUMN.loginCount - 1], 1);

  assert.throws(
    () =>
      gas.requireApprovedAdmin_(
        identity(),
        { requestId: "request-second-admin" },
        adminSheet
      ),
    (error) => error.appCode === "ADMIN_PENDING"
  );
  assert.equal(adminSheet.data.length, 2);
  assert.equal(adminSheet.data[1][gas.ADMIN_COLUMN.status - 1], "pending");
});

test("the same pending applicant can read Members only after manual Sheet approval", () => {
  const gas = createGasContext();
  const adminSheet = createSheet("Admins", gas.ADMIN_HEADERS, []);
  const memberSheet = createSheet("Members", gas.MEMBER_HEADERS, [createMemberRow(gas)]);
  const spreadsheet = createSpreadsheet({ Admins: adminSheet, Members: memberSheet });
  installSpreadsheet(gas, spreadsheet);
  const request = { requestId: "request-lifecycle-list", page: 1, pageSize: 50 };

  assert.throws(
    () => gas.adminListMembers_(identity(), request, configFor(gas)),
    (error) => error.appCode === "ADMIN_PENDING"
  );
  assert.equal(adminSheet.data[1][gas.ADMIN_COLUMN.status - 1], "pending");

  // This assignment represents the spreadsheet owner's manual approval.
  adminSheet.data[1][gas.ADMIN_COLUMN.status - 1] = "approved";
  const result = gas.adminListMembers_(
    identity(),
    { ...request, requestId: "request-lifecycle-approved" },
    configFor(gas)
  );
  assert.equal(result.data.members.length, 1);
  assert.equal(adminSheet.data[1][gas.ADMIN_COLUMN.status - 1], "approved");
});

test("pending remains pending while denied, blank and unknown statuses fail closed", () => {
  const gas = createGasContext();
  for (const [status, expectedCode] of [
    ["pending", "ADMIN_PENDING"],
    ["denied", "ADMIN_FORBIDDEN"],
    ["", "ADMIN_FORBIDDEN"],
    ["owner", "ADMIN_FORBIDDEN"],
  ]) {
    const adminSheet = createSheet("Admins", gas.ADMIN_HEADERS, [
      createAdminRow(gas, { status }),
    ]);
    assert.throws(
      () =>
        gas.requireApprovedAdmin_(
          identity(),
          { requestId: `request-status-${status || "blank"}` },
          adminSheet
        ),
      (error) => error.appCode === expectedCode
    );
    assert.equal(adminSheet.data[1][gas.ADMIN_COLUMN.status - 1], status);
  }
});

test("approved administrator profile sync preserves a concurrent manual status edit", () => {
  const gas = createGasContext();
  let changed = false;
  const adminSheet = createSheet(
    "Admins",
    gas.ADMIN_HEADERS,
    [createAdminRow(gas, { status: "approved" })],
    {
      beforeSetValues({ column, sheet }) {
        if (!changed && column === gas.ADMIN_COLUMN.displayName) {
          sheet.data[1][gas.ADMIN_COLUMN.status - 1] = "denied";
          changed = true;
        }
      },
    }
  );

  assert.throws(
    () =>
      gas.requireApprovedAdmin_(
        identity(),
        { requestId: "request-concurrent-deny" },
        adminSheet
      ),
    (error) => error.appCode === "ADMIN_FORBIDDEN"
  );
  assert.equal(adminSheet.data[1][gas.ADMIN_COLUMN.status - 1], "denied");
});

test("approved administrator fails closed if the Sheet identity changes during sync", () => {
  const gas = createGasContext();
  let changed = false;
  const adminSheet = createSheet(
    "Admins",
    gas.ADMIN_HEADERS,
    [createAdminRow(gas, { status: "approved" })],
    {
      beforeSetValues({ column, sheet }) {
        if (!changed && column === gas.ADMIN_COLUMN.displayName) {
          sheet.data[1][gas.ADMIN_COLUMN.lineUserId - 1] = `U${"f".repeat(32)}`;
          changed = true;
        }
      },
    }
  );

  assert.throws(
    () =>
      gas.requireApprovedAdmin_(
        identity(),
        { requestId: "request-concurrent-identity-edit" },
        adminSheet
      ),
    (error) => error.appCode === "ADMIN_FORBIDDEN"
  );
});

test("duplicate administrator line_user_id rows never authorize", () => {
  const gas = createGasContext();
  const rows = [createAdminRow(gas), createAdminRow(gas, { adminId: "ADM-ZYXWVU9876" })];
  const adminSheet = createSheet("Admins", gas.ADMIN_HEADERS, rows);
  assert.throws(
    () =>
      gas.requireApprovedAdmin_(
        identity(),
        { requestId: "request-duplicate-admin" },
        adminSheet
      ),
    (error) => error.appCode === "ADMIN_FORBIDDEN"
  );
});

test("duplicate or malformed admin_id values never authorize", () => {
  const gas = createGasContext();
  for (const rows of [
    [
      createAdminRow(gas),
      createAdminRow(gas, {
        lineUserId: `U${"f".repeat(32)}`,
        status: "denied",
      }),
    ],
    [createAdminRow(gas, { adminId: "manual-owner" })],
  ]) {
    const adminSheet = createSheet("Admins", gas.ADMIN_HEADERS, rows);
    assert.throws(
      () =>
        gas.requireApprovedAdmin_(
          identity(),
          { requestId: "request-bad-admin-id" },
          adminSheet
        ),
      (error) => error.appCode === "ADMIN_FORBIDDEN"
    );
  }
});

test("pending authorization stops before the Members sheet is read", () => {
  const gas = createGasContext();
  const adminSheet = createSheet("Admins", gas.ADMIN_HEADERS, []);
  let memberRequested = false;
  const spreadsheet = {
    getSheetByName(name) {
      if (name === "Admins") return adminSheet;
      if (name === "Members") {
        memberRequested = true;
        throw new Error("Members must not be read");
      }
      return null;
    },
  };
  installSpreadsheet(gas, spreadsheet);

  assert.throws(
    () =>
      gas.adminListMembers_(
        identity(),
        { requestId: "request-pending-list", page: 1, pageSize: 50 },
        configFor(gas)
      ),
    (error) => error.appCode === "ADMIN_PENDING"
  );
  assert.equal(memberRequested, false);
});

test("pending and denied administrators cannot read or mutate point sheets", () => {
  for (const status of ["pending", "denied"]) {
    for (const action of ["list", "history", "createType", "createCampaign"]) {
      const gas = createGasContext();
      const adminSheet = createSheet("Admins", gas.ADMIN_HEADERS, [
        createAdminRow(gas, { status }),
      ]);
      let pointSheetRequested = false;
      const spreadsheet = {
        getSheetByName(name) {
          if (name === "Admins") return adminSheet;
          if (
            name === "PointTypes" ||
            name === "PointCampaigns" ||
            name === "PointRedemptions"
          ) {
            pointSheetRequested = true;
            throw new Error("Point sheets must not be read");
          }
          return null;
        },
      };
      installSpreadsheet(gas, spreadsheet);
      const request = {
        requestId: `request-${status}-${action}`,
        points: 3,
        expiryMode: "limited",
        redemptionMode: "once_per_member",
        pointTypeId: "PTY-ABCDEF1234",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };

      const invoke =
        action === "list"
          ? () => gas.adminListPointTypes_(identity(), request, configFor(gas))
          : action === "history"
            ? () => gas.adminListPointHistory_(identity(), request, configFor(gas))
          : action === "createType"
            ? () => gas.adminCreatePointType_(identity(), request, configFor(gas))
            : () => gas.adminCreatePointCampaign_(identity(), request, configFor(gas));
      assert.throws(
        invoke,
        (error) =>
          error.appCode === (status === "pending" ? "ADMIN_PENDING" : "ADMIN_FORBIDDEN")
      );
      assert.equal(pointSheetRequested, false);
    }
  }
});

test("approved member listing is bounded and omits all internal identifiers", () => {
  const gas = createGasContext();
  const internalAccessAdmin = `U${"c".repeat(32)}`;
  const members = [
    createMemberRow(gas, {
      lineUserId: MEMBER_USER_ID,
      accessUpdatedBy: internalAccessAdmin,
      lastTokenIat: 999999,
      lastRequestId: "private-login-request",
      lastAccessRequestId: "private-access-request",
      adminStatus: "approved",
    }),
    createMemberRow(gas, {
      memberId: "MBR-ZYXWVU9876",
      lineUserId: `U${"d".repeat(32)}`,
      status: "denied",
      joinedAt: new Date("2026-02-01T00:00:00.000Z"),
      adminStatus: "denied",
    }),
    new Array(gas.MEMBER_HEADERS.length).fill(""),
  ];
  const spreadsheet = createSpreadsheet({
    Admins: createSheet("Admins", gas.ADMIN_HEADERS, [createAdminRow(gas)]),
    Members: createSheet("Members", gas.MEMBER_HEADERS, members),
  });
  installSpreadsheet(gas, spreadsheet);

  const result = gas.adminListMembers_(
    identity(),
    { requestId: "request-approved-list", page: 1, pageSize: 1 },
    configFor(gas)
  );
  assert.equal(result.data.members.length, 1);
  assert.equal(result.data.pagination.total, 2);
  assert.equal(result.data.pagination.totalPages, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.metrics)), {
    all: 2,
    pending: 0,
    approved: 1,
    denied: 1,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(MEMBER_USER_ID), false);
  assert.equal(serialized.includes(internalAccessAdmin), false);
  assert.equal(serialized.includes("private-login-request"), false);
  assert.equal(serialized.includes("private-access-request"), false);
  assert.equal(serialized.includes("member@example.com"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.data.members[0], "adminStatus"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.data.members[0], "lineUserId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.data.members[0], "lastTokenIat"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.data.members[0], "email"), false);
  assert.equal(result.data.members[0].phone, "+886912345678");
  assert.equal(result.data.members[0].birthday, "1990-05-20");
});

test("member access update uses CAS, preserves profile and never returns email", () => {
  const gas = createGasContext();
  const member = createMemberRow(gas, { status: "approved", adminStatus: "legacy-value" });
  const originalProfile = member.slice(1, 5);
  const originalPhone = member[gas.MEMBER_COLUMN.phone - 1];
  const originalBirthday = member[gas.MEMBER_COLUMN.birthday - 1];
  const spreadsheet = createSpreadsheet({
    Admins: createSheet("Admins", gas.ADMIN_HEADERS, [createAdminRow(gas)]),
    Members: createSheet("Members", gas.MEMBER_HEADERS, [member]),
  });
  installSpreadsheet(gas, spreadsheet);
  const request = {
    action: "adminSetMemberAccess",
    requestId: "request-deny-member-1",
    targetMemberId: "MBR-ABCDEF1234",
    accessStatus: "denied",
    expectedAccessStatus: "approved",
    expectedAccessUpdatedAt: "",
  };

  const result = gas.adminSetMemberAccess_(identity(), request, configFor(gas));
  const updated = spreadsheet.sheets.Members.data[1];
  assert.equal(result.data.duplicate, false);
  assert.equal(updated[gas.MEMBER_COLUMN.status - 1], "denied");
  assert.deepEqual(updated.slice(1, 5), originalProfile);
  assert.equal(updated[gas.MEMBER_COLUMN.accessUpdatedBy - 1], ADMIN_USER_ID);
  assert.equal(updated[gas.MEMBER_COLUMN.lastAccessRequestId - 1], request.requestId);
  assert.equal(updated[gas.MEMBER_COLUMN.adminStatus - 1], "legacy-value");
  assert.equal(updated[gas.MEMBER_COLUMN.phone - 1], originalPhone);
  assert.equal(updated[gas.MEMBER_COLUMN.birthday - 1], originalBirthday);
  assert.ok(updated[gas.MEMBER_COLUMN.accessUpdatedAt - 1] instanceof Date);
  assert.equal(Object.prototype.hasOwnProperty.call(result.data.member, "lineUserId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.data.member, "email"), false);
  assert.equal(result.data.member.phone, originalPhone);
  assert.equal(result.data.member.birthday, originalBirthday);

  const duplicate = gas.adminSetMemberAccess_(identity(), request, configFor(gas));
  assert.equal(duplicate.data.duplicate, true);

  assert.throws(
    () =>
      gas.adminSetMemberAccess_(
        identity(),
        { ...request, accessStatus: "approved" },
        configFor(gas)
      ),
    (error) => error.appCode === "REQUEST_ID_CONFLICT"
  );
});

test("stale access updates and duplicate member IDs fail closed", () => {
  const gas = createGasContext();
  const member = createMemberRow(gas, {
    status: "denied",
    accessUpdatedAt: new Date("2026-03-01T00:00:00.000Z"),
  });
  let spreadsheet = createSpreadsheet({
    Admins: createSheet("Admins", gas.ADMIN_HEADERS, [createAdminRow(gas)]),
    Members: createSheet("Members", gas.MEMBER_HEADERS, [member]),
  });
  installSpreadsheet(gas, spreadsheet);

  assert.throws(
    () =>
      gas.adminSetMemberAccess_(
        identity(),
        {
          requestId: "request-stale-update",
          targetMemberId: "MBR-ABCDEF1234",
          accessStatus: "approved",
          expectedAccessStatus: "approved",
          expectedAccessUpdatedAt: "",
        },
        configFor(gas)
      ),
    (error) => error.appCode === "ACCESS_CONFLICT"
  );

  spreadsheet = createSpreadsheet({
    Admins: createSheet("Admins", gas.ADMIN_HEADERS, [createAdminRow(gas)]),
    Members: createSheet("Members", gas.MEMBER_HEADERS, [
      createMemberRow(gas),
      createMemberRow(gas, { lineUserId: `U${"e".repeat(32)}` }),
    ]),
  });
  installSpreadsheet(gas, spreadsheet);
  assert.throws(
    () =>
      gas.adminSetMemberAccess_(
        identity(),
        {
          requestId: "request-duplicate-member",
          targetMemberId: "MBR-ABCDEF1234",
          accessStatus: "denied",
          expectedAccessStatus: "approved",
          expectedAccessUpdatedAt: "",
        },
        configFor(gas)
      ),
    (error) => error.appCode === "MEMBER_DATA_CONFLICT"
  );
});

test("point type validation accepts only integer values from 1 through 9999", () => {
  const gas = createGasContext();
  const base = {
    action: "adminCreatePointType",
    idToken: "header.payload.signature",
    requestId: "request-point-validation",
    transport: "fetch",
    expiryMode: "limited",
    redemptionMode: "once_per_member",
  };
  for (const points of [undefined, NaN, Infinity, 0, -1, 1.5, 10000]) {
    assert.throws(
      () => gas.validateRequestEnvelope_({ ...base, points }),
      (error) => error.appCode === "INVALID_POINTS"
    );
  }
  gas.validateRequestEnvelope_({ ...base, points: 1 });
  gas.validateRequestEnvelope_({ ...base, points: "9999" });
  gas.validateRequestEnvelope_({
    ...base,
    points: 4,
    redemptionMode: "single_member",
  });
});

test("campaign validation requires an exact point type and mode-aware expiry", () => {
  const gas = createGasContext();
  const base = {
    action: "adminCreatePointCampaign",
    idToken: "header.payload.signature",
    requestId: "request-campaign-validation",
    transport: "fetch",
    pointTypeId: "PTY-ABCDEF1234",
  };
  const validExpiry = new Date(Date.now() + 86400000).toISOString();
  gas.validateRequestEnvelope_({ ...base, expiresAt: validExpiry });
  assert.equal(
    gas.parseCampaignExpiryForMode_(validExpiry, "limited").toISOString(),
    validExpiry
  );
  assert.equal(gas.parseCampaignExpiryForMode_("", "unlimited"), null);

  for (const pointTypeId of ["", "PTY-lowercase1", "MBR-ABCDEF1234"]) {
    assert.throws(
      () => gas.validateRequestEnvelope_({ ...base, pointTypeId, expiresAt: validExpiry }),
      (error) => error.appCode === "INVALID_POINT_TYPE_ID"
    );
  }
  for (const expiresAt of [
    "",
    "2027-02-30T00:00:00.000Z",
    new Date(Date.now() - 1000).toISOString(),
    new Date(Date.now() + 367 * 86400000).toISOString(),
    new Date(Date.now() + 86400000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  ]) {
    assert.throws(
      () => gas.parseCampaignExpiryForMode_(expiresAt, "limited"),
      (error) => error.appCode === "INVALID_CAMPAIGN_EXPIRY"
    );
  }
  assert.throws(
    () => gas.parseCampaignExpiryForMode_(validExpiry, "unlimited"),
    (error) => error.appCode === "INVALID_CAMPAIGN_EXPIRY"
  );
});

test("approved administrators can list sorted point types without internal audit fields", () => {
  const gas = createGasContext();
  const pointTypes = [
    createPointTypeRow(gas, {
      pointTypeId: "PTY-ZYXWVU9876",
      label: "3 點",
      points: 3,
      status: "inactive",
      createdBy: `U${"f".repeat(32)}`,
      lastRequestId: "private-type-request-3",
    }),
    createPointTypeRow(gas, {
      pointTypeId: "PTY-A102938475",
      label: "1 點",
      points: 1,
      createdBy: `U${"e".repeat(32)}`,
      lastRequestId: "private-type-request-1",
    }),
  ];
  const spreadsheet = createSpreadsheet({
    Admins: createSheet("Admins", gas.ADMIN_HEADERS, [createAdminRow(gas)]),
    PointTypes: createSheet("PointTypes", gas.POINT_TYPE_HEADERS, pointTypes),
  });
  installSpreadsheet(gas, spreadsheet);

  const result = gas.adminListPointTypes_(
    identity(),
    { requestId: "request-list-point-types" },
    configFor(gas)
  );
  assert.deepEqual(
    Array.from(result.data.pointTypes, (type) => type.points),
    [1, 3]
  );
  assert.equal(result.data.pointTypes[0].label, "1 點");
  assert.equal(result.data.pointTypes[1].status, "inactive");
  for (const type of result.data.pointTypes) {
    assert.equal(Object.prototype.hasOwnProperty.call(type, "createdBy"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(type, "lastRequestId"), false);
  }
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("private-type-request"), false);
  assert.equal(serialized.includes(`U${"e".repeat(32)}`), false);
  assert.equal(serialized.includes(`U${"f".repeat(32)}`), false);
});

test("approved administrators can list bounded point history without LINE IDs or request IDs", () => {
  const gas = createGasContext();
  const rows = Array.from({ length: 51 }, (_, index) =>
    createPointRedemptionRow(gas, {
      redemptionId: `RDM-${String(index + 1).padStart(16, "0")}`,
      redeemedAt: new Date(Date.UTC(2026, 0, 1, 0, index, 0)),
      requestId: `request-history-${String(index + 1).padStart(3, "0")}`,
      redemptionModeSnapshot: "repeatable",
      balanceAfter: index + 3,
    })
  );
  const spreadsheet = createSpreadsheet({
    Admins: createSheet("Admins", gas.ADMIN_HEADERS, [createAdminRow(gas)]),
    PointRedemptions: createSheet("PointRedemptions", gas.POINT_REDEMPTION_HEADERS, rows),
  });
  installSpreadsheet(gas, spreadsheet);

  const result = gas.adminListPointHistory_(
    identity(),
    { requestId: "request-list-point-history" },
    configFor(gas)
  );
  assert.equal(result.data.history.length, 50);
  assert.equal(result.data.hasMore, true);
  assert.equal(result.data.history[0].points, 3);
  assert.equal(result.data.history[0].memberId, "MBR-ABCDEF1234");
  assert.equal(result.data.history[0].label, "3 點");
  assert.equal(result.data.history[0].source, "qr");
  assert.equal(Object.prototype.hasOwnProperty.call(result.data.history[0], "lineUserId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.data.history[0], "requestId"), false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(MEMBER_USER_ID), false);
  assert.equal(serialized.includes("request-history-"), false);
});

test("point type creation is server-labelled, unique and idempotent", () => {
  const gas = createGasContext();
  const spreadsheet = createSpreadsheet({
    Admins: createSheet("Admins", gas.ADMIN_HEADERS, [createAdminRow(gas)]),
    PointTypes: createSheet("PointTypes", gas.POINT_TYPE_HEADERS, []),
  });
  installSpreadsheet(gas, spreadsheet);
  const request = {
    action: "adminCreatePointType",
    requestId: "request-create-three-points",
    points: 3,
    expiryMode: "limited",
    redemptionMode: "once_per_member",
    label: "=UNTRUSTED()",
  };

  const result = gas.adminCreatePointType_(identity(), request, configFor(gas));
  assert.equal(result.data.duplicate, false);
  assert.match(result.data.pointType.pointTypeId, /^PTY-[A-Z0-9]{10}$/);
  assert.equal(result.data.pointType.label, "3 點");
  assert.equal(result.data.pointType.points, 3);
  assert.equal(result.data.pointType.status, "active");
  const row = spreadsheet.sheets.PointTypes.data[1];
  assert.equal(row[gas.POINT_TYPE_COLUMN.label - 1], "3 點");
  assert.equal(row[gas.POINT_TYPE_COLUMN.createdBy - 1], ADMIN_USER_ID);
  assert.equal(row[gas.POINT_TYPE_COLUMN.lastRequestId - 1], request.requestId);
  assert.equal(JSON.stringify(result).includes(ADMIN_USER_ID), false);
  assert.equal(JSON.stringify(result).includes(request.requestId), false);

  const duplicate = gas.adminCreatePointType_(identity(), request, configFor(gas));
  assert.equal(duplicate.data.duplicate, true);
  assert.equal(
    duplicate.data.pointType.pointTypeId,
    result.data.pointType.pointTypeId
  );
  assert.equal(spreadsheet.sheets.PointTypes.data.length, 2);

  assert.throws(
    () =>
      gas.adminCreatePointType_(
        identity(),
        { ...request, points: 4 },
        configFor(gas)
      ),
    (error) => error.appCode === "REQUEST_ID_CONFLICT"
  );
  assert.throws(
    () =>
      gas.adminCreatePointType_(
        identity(),
        { ...request, requestId: "request-create-three-again" },
        configFor(gas)
      ),
    (error) => error.appCode === "POINT_TYPE_EXISTS"
  );
});

test("point type uniqueness includes expiry and redemption modes", () => {
  const gas = createGasContext();
  const spreadsheet = createSpreadsheet({
    Admins: createSheet("Admins", gas.ADMIN_HEADERS, [createAdminRow(gas)]),
    PointTypes: createSheet("PointTypes", gas.POINT_TYPE_HEADERS, [
      createPointTypeRow(gas),
    ]),
  });
  installSpreadsheet(gas, spreadsheet);

  const result = gas.adminCreatePointType_(
    identity(),
    {
      action: "adminCreatePointType",
      requestId: "request-create-permanent",
      points: 3,
      expiryMode: "unlimited",
      redemptionMode: "repeatable",
    },
    configFor(gas)
  );

  assert.equal(result.data.pointType.points, 3);
  assert.equal(result.data.pointType.expiryMode, "unlimited");
  assert.equal(result.data.pointType.redemptionMode, "repeatable");
  assert.equal(spreadsheet.sheets.PointTypes.data.length, 3);
});

test("point type deletion is idempotent, audited and never removes issued campaigns", () => {
  const gas = createGasContext();
  const campaign = createPointCampaignRow(gas).row;
  const pointTypes = [
    createPointTypeRow(gas),
    createPointTypeRow(gas, {
      pointTypeId: "PTY-SECOND1234",
      label: "4 點",
      points: 4,
      lastRequestId: "request-point-type-second",
    }),
  ];
  const spreadsheet = createSpreadsheet({
    Admins: createSheet("Admins", gas.ADMIN_HEADERS, [createAdminRow(gas)]),
    PointTypes: createSheet("PointTypes", gas.POINT_TYPE_HEADERS, pointTypes),
    PointCampaigns: createSheet("PointCampaigns", gas.POINT_CAMPAIGN_HEADERS, [
      campaign,
    ]),
  });
  installSpreadsheet(gas, spreadsheet);
  const request = {
    action: "adminDeletePointType",
    requestId: "request-delete-point-type",
    pointTypeId: "PTY-ABCDEF1234",
  };
  const campaignBefore = campaign.slice();

  const result = gas.adminDeletePointType_(identity(), request, configFor(gas));
  assert.equal(result.data.deleted, true);
  assert.equal(result.data.duplicate, false);
  assert.equal(result.data.pointType.status, "inactive");
  assert.equal(spreadsheet.sheets.PointTypes.data.length, 3);
  const deletedRow = spreadsheet.sheets.PointTypes.data[1];
  assert.equal(deletedRow[gas.POINT_TYPE_COLUMN.status - 1], "inactive");
  assert.equal(deletedRow[gas.POINT_TYPE_COLUMN.deletedBy - 1], ADMIN_USER_ID);
  assert.equal(
    deletedRow[gas.POINT_TYPE_COLUMN.deleteRequestId - 1],
    request.requestId
  );
  assert.deepEqual(campaign, campaignBefore);

  const retry = gas.adminDeletePointType_(identity(), request, configFor(gas));
  assert.equal(retry.data.duplicate, true);
  assert.throws(
    () =>
      gas.adminDeletePointType_(
        identity(),
        { ...request, pointTypeId: "PTY-SECOND1234" },
        configFor(gas)
      ),
    (error) => error.appCode === "REQUEST_ID_CONFLICT"
  );
  assert.throws(
    () =>
      gas.adminCreatePointCampaign_(
        identity(),
        {
          action: "adminCreatePointCampaign",
          requestId: "request-campaign-after-delete",
          pointTypeId: "PTY-ABCDEF1234",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        configFor(gas)
      ),
    (error) => error.appCode === "POINT_TYPE_INACTIVE"
  );
});

test("malformed or duplicate active point type rows fail closed", () => {
  const gas = createGasContext();
  for (const rows of [
    [
      createPointTypeRow(gas),
      createPointTypeRow(gas, {
        pointTypeId: "PTY-ZYXWVU9876",
        lastRequestId: "request-other-type",
      }),
    ],
    [createPointTypeRow(gas, { label: "=3 點" })],
    [createPointTypeRow(gas, { status: "owner" })],
  ]) {
    const spreadsheet = createSpreadsheet({
      Admins: createSheet("Admins", gas.ADMIN_HEADERS, [createAdminRow(gas)]),
      PointTypes: createSheet("PointTypes", gas.POINT_TYPE_HEADERS, rows),
    });
    installSpreadsheet(gas, spreadsheet);
    assert.throws(
      () =>
        gas.adminListPointTypes_(
          identity(),
          { requestId: "request-list-conflicting-types" },
          configFor(gas)
        ),
      (error) => error.appCode === "POINT_DATA_CONFLICT"
    );
  }
});

test("campaign creation snapshots the type and stores only a deterministic claim hash", () => {
  const gas = createGasContext();
  const spreadsheet = createSpreadsheet({
    Admins: createSheet("Admins", gas.ADMIN_HEADERS, [createAdminRow(gas)]),
    PointTypes: createSheet("PointTypes", gas.POINT_TYPE_HEADERS, [
      createPointTypeRow(gas),
    ]),
    PointCampaigns: createSheet("PointCampaigns", gas.POINT_CAMPAIGN_HEADERS, []),
  });
  installSpreadsheet(gas, spreadsheet);
  const request = {
    action: "adminCreatePointCampaign",
    requestId: "request-create-point-campaign",
    pointTypeId: "PTY-ABCDEF1234",
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    points: 9999,
    claimHash: "client-must-not-control-this",
  };

  const result = gas.adminCreatePointCampaign_(identity(), request, configFor(gas));
  assert.equal(result.data.duplicate, false);
  assert.match(result.data.campaign.campaignId, /^PCG-[A-Z0-9]{10}$/);
  assert.equal(result.data.campaign.pointTypeId, request.pointTypeId);
  assert.equal(result.data.campaign.label, "3 點");
  assert.equal(result.data.campaign.points, 3);
  assert.equal(result.data.campaign.status, "active");
  assert.equal(result.data.campaign.expiresAt, request.expiresAt);

  const claimUrl = new URL(result.data.claimUrl);
  assert.equal(claimUrl.origin, "https://liff.line.me");
  assert.equal(claimUrl.pathname, "/2010787602-kaiSm2eq");
  assert.deepEqual(Array.from(claimUrl.searchParams.keys()), ["claim"]);
  const claim = claimUrl.searchParams.get("claim");
  assert.match(claim, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(claimUrl.searchParams.has("points"), false);
  assert.equal(claimUrl.searchParams.has("pointTypeId"), false);

  const row = spreadsheet.sheets.PointCampaigns.data[1];
  const storedHash = row[gas.POINT_CAMPAIGN_COLUMN.claimHash - 1];
  assert.match(storedHash, /^[a-f0-9]{64}$/);
  assert.equal(storedHash, gas.sha256Hex_(claim));
  assert.notEqual(storedHash, claim);
  assert.equal(JSON.stringify(row).includes(claim), false);
  assert.equal(row[gas.POINT_CAMPAIGN_COLUMN.pointsSnapshot - 1], 3);
  assert.equal(row[gas.POINT_CAMPAIGN_COLUMN.labelSnapshot - 1], "3 點");
  assert.equal(row[gas.POINT_CAMPAIGN_COLUMN.createdBy - 1], ADMIN_USER_ID);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(storedHash), false);
  assert.equal(serialized.includes(ADMIN_USER_ID), false);
  assert.equal(serialized.includes(request.requestId), false);
  assert.equal(serialized.includes("s".repeat(64)), false);
  for (const key of ["claimHash", "createdBy", "lastRequestId"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(result.data.campaign, key), false);
  }

  const duplicate = gas.adminCreatePointCampaign_(
    identity(),
    request,
    configFor(gas)
  );
  assert.equal(duplicate.data.duplicate, true);
  assert.equal(duplicate.data.claimUrl, result.data.claimUrl);
  assert.equal(
    duplicate.data.campaign.campaignId,
    result.data.campaign.campaignId
  );
  assert.equal(spreadsheet.sheets.PointCampaigns.data.length, 2);

  assert.throws(
    () =>
      gas.adminCreatePointCampaign_(
        identity(),
        { ...request, pointTypeId: "PTY-ZYXWVU9876" },
        configFor(gas)
      ),
    (error) => error.appCode === "REQUEST_ID_CONFLICT"
  );
  assert.throws(
    () =>
      gas.adminCreatePointCampaign_(
        identity(),
        {
          ...request,
          expiresAt: new Date(Date.now() + 8 * 86400000).toISOString(),
        },
        configFor(gas)
      ),
    (error) => error.appCode === "REQUEST_ID_CONFLICT"
  );
});

test("unlimited repeatable types create permanent campaign snapshots without expiry", () => {
  const gas = createGasContext();
  const spreadsheet = createSpreadsheet({
    Admins: createSheet("Admins", gas.ADMIN_HEADERS, [createAdminRow(gas)]),
    PointTypes: createSheet("PointTypes", gas.POINT_TYPE_HEADERS, [
      createPointTypeRow(gas, {
        expiryMode: "unlimited",
        redemptionMode: "repeatable",
      }),
    ]),
    PointCampaigns: createSheet("PointCampaigns", gas.POINT_CAMPAIGN_HEADERS, []),
  });
  installSpreadsheet(gas, spreadsheet);
  const request = {
    action: "adminCreatePointCampaign",
    requestId: "request-permanent-campaign",
    pointTypeId: "PTY-ABCDEF1234",
    expiresAt: "",
  };

  const result = gas.adminCreatePointCampaign_(
    identity(),
    request,
    configFor(gas)
  );
  assert.equal(result.data.campaign.expiresAt, "");
  assert.equal(result.data.campaign.expiryMode, "unlimited");
  assert.equal(result.data.campaign.redemptionMode, "repeatable");
  const row = spreadsheet.sheets.PointCampaigns.data[1];
  assert.equal(row[gas.POINT_CAMPAIGN_COLUMN.expiresAt - 1], "");
  assert.equal(
    row[gas.POINT_CAMPAIGN_COLUMN.expiryModeSnapshot - 1],
    "unlimited"
  );
  assert.equal(
    row[gas.POINT_CAMPAIGN_COLUMN.redemptionModeSnapshot - 1],
    "repeatable"
  );

  assert.throws(
    () =>
      gas.adminCreatePointCampaign_(
        identity(),
        {
          ...request,
          requestId: "request-permanent-with-expiry",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        configFor(gas)
      ),
    (error) => error.appCode === "INVALID_CAMPAIGN_EXPIRY"
  );
});

test("campaign creation rejects missing, inactive and ambiguous point types", () => {
  for (const scenario of ["missing", "inactive", "duplicate"]) {
    const gas = createGasContext();
    let rows = [];
    if (scenario === "inactive") {
      rows = [createPointTypeRow(gas, { status: "inactive" })];
    } else if (scenario === "duplicate") {
      rows = [
        createPointTypeRow(gas),
        createPointTypeRow(gas, {
          pointTypeId: "PTY-ZYXWVU9876",
          lastRequestId: "request-duplicate-active-points",
        }),
      ];
    }
    const spreadsheet = createSpreadsheet({
      Admins: createSheet("Admins", gas.ADMIN_HEADERS, [createAdminRow(gas)]),
      PointTypes: createSheet("PointTypes", gas.POINT_TYPE_HEADERS, rows),
      PointCampaigns: createSheet("PointCampaigns", gas.POINT_CAMPAIGN_HEADERS, []),
    });
    installSpreadsheet(gas, spreadsheet);
    assert.throws(
      () =>
        gas.adminCreatePointCampaign_(
          identity(),
          {
            requestId: `request-campaign-${scenario}`,
            pointTypeId: "PTY-ABCDEF1234",
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
          configFor(gas)
        ),
      (error) =>
        error.appCode ===
        (scenario === "missing"
          ? "POINT_TYPE_NOT_FOUND"
          : scenario === "inactive"
            ? "POINT_TYPE_INACTIVE"
            : "POINT_DATA_CONFLICT")
    );
  }
});

test("campaign issuance fails closed on duplicate IDs or a tampered deterministic hash", () => {
  for (const scenario of ["duplicate-id", "tampered-hash"]) {
    const gas = createGasContext();
    const requestId =
      scenario === "tampered-hash"
        ? "request-tampered-campaign"
        : "request-new-campaign-after-conflict";
    const firstOverrides = {
      lastRequestId:
        scenario === "tampered-hash"
          ? requestId
          : "request-existing-campaign-one",
      expiresAt: new Date(Date.now() + 86400000),
    };
    if (scenario === "tampered-hash") {
      firstOverrides.claimHash = "0".repeat(64);
    }
    const first = createPointCampaignRow(gas, firstOverrides).row;
    if (scenario === "tampered-hash") {
      first[gas.POINT_CAMPAIGN_COLUMN.claimHash - 1] = "0".repeat(64);
    }
    const campaignRows =
      scenario === "duplicate-id"
        ? [
            first,
            createPointCampaignRow(gas, {
              campaignId: "PCG-ABCDEF1234",
              lastRequestId: "request-existing-campaign-two",
              expiresAt: new Date(Date.now() + 2 * 86400000),
            }).row,
          ]
        : [first];
    const spreadsheet = createSpreadsheet({
      Admins: createSheet("Admins", gas.ADMIN_HEADERS, [createAdminRow(gas)]),
      PointTypes: createSheet("PointTypes", gas.POINT_TYPE_HEADERS, [
        createPointTypeRow(gas),
      ]),
      PointCampaigns: createSheet(
        "PointCampaigns",
        gas.POINT_CAMPAIGN_HEADERS,
        campaignRows
      ),
    });
    installSpreadsheet(gas, spreadsheet);
    assert.throws(
      () =>
        gas.adminCreatePointCampaign_(
          identity(),
          {
            requestId,
            pointTypeId: "PTY-ABCDEF1234",
            expiresAt:
              scenario === "tampered-hash"
                ? first[gas.POINT_CAMPAIGN_COLUMN.expiresAt - 1].toISOString()
                : new Date(Date.now() + 3 * 86400000).toISOString(),
          },
          configFor(gas)
        ),
      (error) => error.appCode === "POINT_DATA_CONFLICT"
    );
  }
});

test("fetch and bridge parse identical point fields without accepting snapshots or claims", () => {
  const gas = createGasContext();
  const payload = {
    action: "adminCreatePointCampaign",
    idToken: "header.payload.signature",
    requestId: "request-bridge-point-campaign",
    callbackOrigin: "https://example.github.io/",
    pointTypeId: "PTY-ABCDEF1234",
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    pointsSnapshot: 9999,
    labelSnapshot: "9999 點",
    claimHash: "forged",
  };
  const fetchRequest = gas.parseRequest_({
    postData: { contents: JSON.stringify(payload) },
  });
  const bridgeRequest = gas.parseRequest_({
    parameter: {
      ...payload,
      transport: "bridge",
      requestSecret: "a".repeat(48),
    },
  });
  for (const field of [
    "action",
    "idToken",
    "requestId",
    "callbackOrigin",
    "pointTypeId",
    "expiresAt",
  ]) {
    assert.equal(fetchRequest[field], bridgeRequest[field]);
  }
  for (const request of [fetchRequest, bridgeRequest]) {
    assert.equal(Object.prototype.hasOwnProperty.call(request, "pointsSnapshot"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(request, "labelSnapshot"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(request, "claimHash"), false);
    gas.validateRequestEnvelope_(request);
  }

  const pointTypePayload = {
    ...payload,
    action: "adminCreatePointType",
    requestId: "request-bridge-point-type",
    pointAmount: "3",
    points: "9999",
    expiryMode: "unlimited",
    redemptionMode: "repeatable",
  };
  const parsedPointType = gas.parseRequest_({
    postData: { contents: JSON.stringify(pointTypePayload) },
  });
  const parsedBridgePointType = gas.parseRequest_({
    parameter: {
      ...pointTypePayload,
      transport: "bridge",
      requestSecret: "b".repeat(48),
    },
  });
  assert.equal(parsedPointType.points, 3);
  assert.equal(parsedBridgePointType.points, 3);
  assert.equal(parsedPointType.expiryMode, "unlimited");
  assert.equal(parsedBridgePointType.redemptionMode, "repeatable");
  gas.validateRequestEnvelope_(parsedPointType);
  gas.validateRequestEnvelope_(parsedBridgePointType);
});

test("fetch and bridge parse identical CAS fields and bind bridge state", () => {
  const gas = createGasContext();
  const payload = {
    action: "adminSetMemberAccess",
    idToken: "header.payload.signature",
    requestId: "request-bridge-cas",
    callbackOrigin: "https://example.github.io/",
    targetMemberId: "MBR-ABCDEF1234",
    accessStatus: "denied",
    expectedAccessStatus: "approved",
    expectedAccessUpdatedAt: "2026-01-01T00:00:00.000Z",
  };
  const fetchRequest = gas.parseRequest_({ postData: { contents: JSON.stringify(payload) } });
  const bridgeRequest = gas.parseRequest_({
    parameter: {
      ...payload,
      transport: "bridge",
      requestSecret: "a".repeat(48),
    },
  });
  for (const field of [
    "action",
    "idToken",
    "requestId",
    "callbackOrigin",
    "targetMemberId",
    "accessStatus",
    "expectedAccessStatus",
    "expectedAccessUpdatedAt",
  ]) {
    assert.equal(fetchRequest[field], bridgeRequest[field]);
  }
  gas.validateRequestEnvelope_(fetchRequest);
  gas.validateRequestEnvelope_(bridgeRequest);

  const output = gas.bridgeResponse_(
    { ok: false, message: "</script><script>alert(1)</script>" },
    bridgeRequest
  );
  assert.equal(output.content.includes("</script><script>alert(1)</script>"), false);
  assert.equal(output.content.includes("MEMBER_GAS_RESPONSE"), true);
  assert.equal(output.content.includes("a".repeat(48)), true);
});

test("origin checks are exact and do not treat path or suffix as authority", () => {
  const gas = createGasContext();
  assert.equal(gas.isAllowedRequestOrigin_("https://example.github.io"), true);
  assert.equal(gas.isAllowedRequestOrigin_("https://example.github.io/evil"), false);
  assert.equal(gas.isAllowedRequestOrigin_("https://example.github.io.evil.test"), false);
  assert.equal(gas.isAllowedRequestOrigin_("http://example.github.io"), false);
  assert.equal(gas.isAllowedRequestOrigin_("http://localhost:8080"), true);
});

test("17, 20 and 21-column Members headers upgrade to the shared 23-column profile schema", () => {
  const gas = createGasContext();
  const previousSchemas = [
    Array.from(gas.LEGACY_MEMBER_HEADERS),
    Array.from(gas.ACCESS_AUDIT_MEMBER_HEADERS),
    Array.from(gas.ACCESS_AUDIT_MEMBER_HEADERS).concat(["admin_status"]),
  ];
  for (const headers of previousSchemas) {
    const memberSheet = createSheet("Members", headers, []);
    const spreadsheet = createSpreadsheet({ Members: memberSheet });
    gas.getOrCreateMemberSheet_(spreadsheet, configFor(gas));
    assert.deepEqual(
      JSON.parse(JSON.stringify(memberSheet.data[0])),
      JSON.parse(JSON.stringify(gas.MEMBER_HEADERS))
    );
  }

  const badAdminHeaders = gas.ADMIN_HEADERS.slice();
  badAdminHeaders[5] = "role";
  const badAdminSheet = createSheet("Admins", badAdminHeaders, []);
  const badSpreadsheet = createSpreadsheet({ Admins: badAdminSheet });
  assert.throws(
    () => gas.getOrCreateAdminSheet_(badSpreadsheet, configFor(gas)),
    (error) => error.appCode === "ADMIN_SCHEMA_MISMATCH"
  );

  for (const [sheetName, headers, getterName, expectedCode] of [
    [
      "PointTypes",
      Array.from(gas.POINT_TYPE_HEADERS),
      "getOrCreatePointTypeSheet_",
      "POINT_TYPE_SCHEMA_MISMATCH",
    ],
    [
      "PointCampaigns",
      Array.from(gas.POINT_CAMPAIGN_HEADERS),
      "getOrCreatePointCampaignSheet_",
      "POINT_CAMPAIGN_SCHEMA_MISMATCH",
    ],
    [
      "PointRedemptions",
      Array.from(gas.POINT_REDEMPTION_HEADERS),
      "getOrCreatePointRedemptionSheet_",
      "POINT_REDEMPTION_SCHEMA_MISMATCH",
    ],
  ]) {
    headers[0] = "wrong_header";
    const sheet = createSheet(sheetName, headers, []);
    const spreadsheet = createSpreadsheet({ [sheetName]: sheet });
    assert.throws(
      () => gas[getterName](spreadsheet, configFor(gas)),
      (error) => error.appCode === expectedCode
    );
  }
});

test("legacy point sheets migrate by appending policy snapshots and preserving old cells", () => {
  const gas = createGasContext();
  const legacyTypeRow = createPointTypeRow(gas).slice(
    0,
    gas.LEGACY_POINT_TYPE_HEADERS.length
  );
  const legacyCampaignRow = createPointCampaignRow(gas).row.slice(
    0,
    gas.LEGACY_POINT_CAMPAIGN_HEADERS.length
  );
  const legacyRedemptionRow = [
    "RDM-ABCDEF1234567890",
    "PCG-ABCDEF1234",
    "PTY-ABCDEF1234",
    "MBR-ABCDEF1234",
    MEMBER_USER_ID,
    3,
    3,
    new Date("2026-01-01T00:00:00.000Z"),
    "request-legacy-redeem",
  ];
  const spreadsheet = createSpreadsheet({
    PointTypes: createSheet(
      "PointTypes",
      gas.LEGACY_POINT_TYPE_HEADERS,
      [legacyTypeRow]
    ),
    PointCampaigns: createSheet(
      "PointCampaigns",
      gas.LEGACY_POINT_CAMPAIGN_HEADERS,
      [legacyCampaignRow]
    ),
    PointRedemptions: createSheet(
      "PointRedemptions",
      gas.LEGACY_POINT_REDEMPTION_HEADERS,
      [legacyRedemptionRow]
    ),
  });

  gas.getOrCreatePointTypeSheet_(spreadsheet, configFor(gas));
  gas.getOrCreatePointCampaignSheet_(spreadsheet, configFor(gas));
  gas.getOrCreatePointRedemptionSheet_(spreadsheet, configFor(gas));

  assert.deepEqual(
    JSON.parse(JSON.stringify(spreadsheet.sheets.PointTypes.data[0])),
    JSON.parse(JSON.stringify(gas.POINT_TYPE_HEADERS))
  );
  assert.deepEqual(
    spreadsheet.sheets.PointTypes.data[1].slice(0, legacyTypeRow.length),
    legacyTypeRow
  );
  assert.deepEqual(
    spreadsheet.sheets.PointTypes.data[1].slice(legacyTypeRow.length),
    ["limited", "once_per_member", "", ""]
  );
  assert.deepEqual(
    spreadsheet.sheets.PointCampaigns.data[1].slice(legacyCampaignRow.length),
    ["limited", "once_per_member"]
  );
  assert.deepEqual(
    spreadsheet.sheets.PointRedemptions.data[1].slice(legacyRedemptionRow.length),
    ["once_per_member"]
  );
});

test("health identifies the isolated service without exposing configuration", () => {
  const gas = createGasContext();
  const output = gas.doGet({ parameter: { action: "health", requestId: "health-123" } });
  const response = JSON.parse(output.content);
  assert.equal(response.ok, true);
  assert.equal(response.requestId, "health-123");
  assert.equal(response.data.service, "member-admin-api");
  assert.equal(response.data.version, "1.3.0");
  assert.equal(JSON.stringify(response).includes("spreadsheet-id"), false);
  assert.equal(JSON.stringify(response).includes(ADMIN_CHANNEL_ID), false);
});

test("verification rate limiting remains bounded by Script Property", () => {
  const gas = createGasContext({ properties: { MAX_VERIFY_REQUESTS_PER_MINUTE: "1" } });
  gas.enforceLineVerificationRateLimit_();
  assert.throws(
    () => gas.enforceLineVerificationRateLimit_(),
    (error) => error.appCode === "LINE_RATE_LIMITED"
  );
});

test("administrator manifest grants only spreadsheet and LINE verification scopes", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "gas/admin/appsscript.json"), "utf8")
  );
  assert.deepEqual(manifest.urlFetchWhitelist, [
    "https://api.line.me/oauth2/v2.1/verify",
  ]);
  assert.deepEqual(manifest.oauthScopes, [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request",
  ]);
  assert.equal(manifest.webapp.access, "ANYONE_ANONYMOUS");
  assert.equal(manifest.webapp.executeAs, "USER_DEPLOYING");
});
