const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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

function createDataSheet(name, initialHeaders = [], initialRows = [], writes = []) {
  const headers = initialHeaders.slice();
  const rows = initialRows;
  let frozenRows = 0;

  function getRow(rowNumber) {
    if (rowNumber === 1) return headers;
    return rows[rowNumber - 2] || [];
  }

  return {
    appendRow(row) {
      rows.push(row.slice());
    },
    deleteRow(rowNumber) {
      rows.splice(rowNumber - 2, 1);
    },
    getName() {
      return name;
    },
    getLastRow() {
      return headers.length || rows.length ? rows.length + 1 : 0;
    },
    getLastColumn() {
      return headers.length;
    },
    getMaxRows() {
      return Math.max(rows.length + 1, 20);
    },
    setFrozenRows(count) {
      frozenRows = count;
    },
    autoResizeColumns() {},
    get frozenRows() {
      return frozenRows;
    },
    get headers() {
      return headers;
    },
    get rows() {
      return rows;
    },
    getRange(rowNumber, column, rowCount = 1, columnCount = 1) {
      return {
        getValues() {
          return Array.from({ length: rowCount }, (_, rowOffset) =>
            Array.from({ length: columnCount }, (_unused, columnOffset) => {
              const source = getRow(rowNumber + rowOffset);
              return source[column - 1 + columnOffset] ?? "";
            })
          );
        },
        getDisplayValues() {
          return this.getValues().map((row) => row.map((value) => String(value ?? "")));
        },
        setValues(values) {
          writes.push({ rowNumber, column, rowCount, columnCount, values });
          for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
            const targetRowNumber = rowNumber + rowOffset;
            let target;
            if (targetRowNumber === 1) {
              target = headers;
            } else {
              while (rows.length < targetRowNumber - 1) rows.push([]);
              target = rows[targetRowNumber - 2];
            }
            for (let columnOffset = 0; columnOffset < columnCount; columnOffset += 1) {
              target[column - 1 + columnOffset] = values[rowOffset][columnOffset];
            }
          }
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
    },
  };
}

function createGasContext(overrides = {}) {
  const cache = new Map();
  const sheets = new Map();
  let uuidCounter = 0;
  const spreadsheet = {
    getSheetByName(name) {
      return sheets.get(name) || null;
    },
    insertSheet(name) {
      const sheet = createDataSheet(name);
      sheets.set(name, sheet);
      return sheet;
    },
  };
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
    SpreadsheetApp: {
      flush() {},
      openById() {
        return spreadsheet;
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" },
      Charset: { UTF_8: "UTF_8" },
      computeDigest(_algorithm, value) {
        return Array.from(crypto.createHash("sha256").update(String(value)).digest());
      },
      getUuid() {
        uuidCounter += 1;
        const hex = crypto
          .createHash("sha256")
          .update(`client-uuid-${uuidCounter}`)
          .digest("hex")
          .slice(0, 32);
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      },
      formatDate(date, _timeZone, pattern) {
        assert.equal(pattern, "yyyy-MM-dd");
        return date.toISOString().slice(0, 10);
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
    phone: "+886912345678",
    birthday: "1990-05-20",
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

const POINT_CLAIM = "A".repeat(43);

function pointClaimHash(claim = POINT_CLAIM) {
  return crypto.createHash("sha256").update(claim).digest("hex");
}

function createPointCampaignRow(gas, overrides = {}) {
  const row = new Array(gas.POINT_CAMPAIGN_HEADERS.length).fill("");
  const values = {
    campaignId: "PCG-ABCDEF1234",
    pointTypeId: "PTY-ABCDEF1234",
    labelSnapshot: "3 點",
    pointsSnapshot: 3,
    claimHash: pointClaimHash(),
    status: "active",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date("2026-07-23T00:00:00.000Z"),
    createdBy: `U${"a".repeat(32)}`,
    lastRequestId: "request-campaign-1",
    expiryModeSnapshot: "limited",
    redemptionModeSnapshot: "once_per_member",
    ...overrides,
  };
  Object.entries(values).forEach(([key, value]) => {
    row[gas.POINT_CAMPAIGN_COLUMN[key] - 1] = value;
  });
  return row;
}

function createPointRedemptionRow(gas, overrides = {}) {
  const row = new Array(gas.POINT_REDEMPTION_HEADERS.length).fill("");
  const values = {
    redemptionId: "RDM-ABCDEF1234567890",
    campaignId: "PCG-ABCDEF1234",
    pointTypeId: "PTY-ABCDEF1234",
    memberId: "MBR-ABCDEF1234",
    lineUserId: `U${"b".repeat(32)}`,
    points: 3,
    balanceAfter: 3,
    redeemedAt: new Date("2026-07-23T00:00:00.000Z"),
    requestId: "request-redeem-1",
    redemptionModeSnapshot: "once_per_member",
    ...overrides,
  };
  Object.entries(values).forEach(([key, value]) => {
    row[gas.POINT_REDEMPTION_COLUMN[key] - 1] = value;
  });
  return row;
}

function createLotteryPrizeRows(gas, overrides = {}) {
  const configVersion = overrides.configVersion || "LCF-ABCDEF123456";
  const updatedAt =
    overrides.updatedAt || new Date("2026-07-23T00:00:00.000Z");
  const lastRequestId =
    overrides.lastRequestId || "request-lottery-config-1";
  const prizes = overrides.prizes || [
    {
      prizeId: "LPR-ABCDEF1234",
      label: "小禮物",
      color: "#8DCCAA",
      probabilityBasisPoints: 7000,
    },
    {
      prizeId: "LPR-ZYXWVU9876",
      label: "頭獎",
      color: "#0B3C2C",
      probabilityBasisPoints: 3000,
    },
  ];
  return prizes.map((prize, index) => {
    const row = new Array(gas.LOTTERY_PRIZE_HEADERS.length).fill("");
    const values = {
      configVersion,
      prizeId: prize.prizeId,
      label: prize.label,
      color: prize.color,
      probabilityBasisPoints: prize.probabilityBasisPoints,
      sortOrder: index + 1,
      status: "active",
      updatedAt,
      updatedBy: "ADM-ABCDEF1234",
      lastRequestId,
    };
    Object.entries(values).forEach(([key, value]) => {
      row[gas.LOTTERY_PRIZE_COLUMN[key] - 1] = value;
    });
    return row;
  });
}

function installPointSheets(
  gas,
  {
    memberRows = [],
    campaignRows = [],
    redemptionRows = [],
    redemptionWrites = [],
    lotteryPrizeRows = [],
    lotteryDrawRows = [],
    lotteryDrawWrites = [],
  } = {}
) {
  const memberSheet = createMemberSheet(memberRows);
  const campaignSheet = createDataSheet(
    "PointCampaigns",
    Array.from(gas.POINT_CAMPAIGN_HEADERS),
    campaignRows
  );
  const redemptionSheet = createDataSheet(
    "PointRedemptions",
    Array.from(gas.POINT_REDEMPTION_HEADERS),
    redemptionRows,
    redemptionWrites
  );
  const lotteryPrizeSheet = createDataSheet(
    "LotteryPrizes",
    Array.from(gas.LOTTERY_PRIZE_HEADERS),
    lotteryPrizeRows
  );
  const lotteryDrawSheet = createDataSheet(
    "LotteryDraws",
    Array.from(gas.LOTTERY_DRAW_HEADERS),
    lotteryDrawRows,
    lotteryDrawWrites
  );
  gas.getOrCreateMemberSheet_ = () => memberSheet;
  gas.getOrCreatePointCampaignSheet_ = () => campaignSheet;
  gas.getOrCreatePointRedemptionSheet_ = () => redemptionSheet;
  gas.getOrCreateLotteryPrizeSheet_ = () => lotteryPrizeSheet;
  gas.getOrCreateLotteryDrawSheet_ = () => lotteryDrawSheet;
  return {
    memberSheet,
    campaignSheet,
    redemptionSheet,
    lotteryPrizeSheet,
    lotteryDrawSheet,
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
  assert.equal(config.pointTypeSheetName, "PointTypes");
  assert.equal(config.pointCampaignSheetName, "PointCampaigns");
  assert.equal(config.pointRedemptionSheetName, "PointRedemptions");
  assert.deepEqual(Array.from(config.allowedOrigins), [
    "https://example.github.io",
    "http://localhost:8080",
  ]);

  for (const invalidProperties of [
    { LINE_CHANNEL_ID: "2010787602-kaiSm2eq" },
    { LINE_CHANNEL_ID: "" },
    { SPREADSHEET_ID: "" },
    { ALLOWED_ORIGINS: "https://example.github.io/path" },
    { POINT_TYPE_SHEET_NAME: "members" },
    {
      POINT_TYPE_SHEET_NAME: "PointData",
      POINT_CAMPAIGN_SHEET_NAME: "pointdata",
    },
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
  gas.updateMemberProfile_ = () => ({ data: { action: "profile" } });
  gas.listPointHistory_ = () => ({ data: { action: "history" } });
  gas.previewPointCampaign_ = () => ({ data: { action: "preview" } });
  gas.redeemPointCampaign_ = () => ({ data: { action: "redeem" } });
  gas.deleteMember_ = () => ({ data: { action: "delete" } });

  const upsertResult = gas.handleMemberRequest_({
    action: "upsertMember",
    idToken: "header.payload.signature",
    lineChannelId: "2010791619",
  });
  const profileResult = gas.handleMemberRequest_({
    action: "updateMemberProfile",
    idToken: "header.payload.signature",
    lineChannelId: "2010791619",
    phone: "0912345678",
    birthday: "1990-05-20",
  });
  const deleteResult = gas.handleMemberRequest_({
    action: "deleteMember",
    idToken: "header.payload.signature",
    lineChannelId: "2010791619",
  });
  const historyResult = gas.handleMemberRequest_({
    action: "listPointHistory",
    idToken: "header.payload.signature",
    lineChannelId: "2010791619",
  });
  const previewResult = gas.handleMemberRequest_({
    action: "previewPointCampaign",
    idToken: "header.payload.signature",
    lineChannelId: "2010791619",
    claim: POINT_CLAIM,
  });
  const redeemResult = gas.handleMemberRequest_({
    action: "redeemPointCampaign",
    idToken: "header.payload.signature",
    lineChannelId: "2010791619",
    claim: POINT_CLAIM,
  });

  assert.deepEqual(channels, [
    "2010787602",
    "2010787602",
    "2010787602",
    "2010787602",
    "2010787602",
    "2010787602",
  ]);
  assert.equal(upsertResult.data.action, "upsert");
  assert.equal(profileResult.data.action, "profile");
  assert.equal(historyResult.data.action, "history");
  assert.equal(deleteResult.data.action, "delete");
  assert.equal(previewResult.data.action, "preview");
  assert.equal(redeemResult.data.action, "redeem");
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

test("new member rows use the shared 23-column schema, omit legacy email and are approved", () => {
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
  assert.equal(rows[0].length, 23);
  assert.equal(rows[0][gas.MEMBER_COLUMN.status - 1], "approved");
  assert.equal(rows[0][gas.MEMBER_COLUMN.adminStatus - 1], "");
  assert.equal(rows[0][gas.MEMBER_COLUMN.email - 1], "");
  assert.equal(rows[0][gas.MEMBER_COLUMN.phone - 1], "");
  assert.equal(rows[0][gas.MEMBER_COLUMN.birthday - 1], "");
  assert.equal(rows[0][gas.MEMBER_COLUMN.displayName - 1], "'=IMPORTXML(1)");
  assert.equal(result.data.created, true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.data.member, "email"), false);
  assert.equal(result.data.member.phone, "");
  assert.equal(result.data.member.birthday, "");
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.access)), {
    status: "approved",
    allowed: true,
  });
});

test("existing member upsert preserves legacy email, editable profile and access fields", () => {
  const gas = createGasContext();
  const rows = [
    createMemberRow(gas, {
      status: "denied",
      adminStatus: "approved",
      email: "legacy@example.com",
      phone: "0911222333",
      birthday: "1988-08-08",
      lastTokenIat: 1000,
      lastRequestId: "request-old-1",
    }),
  ];
  const writes = [];
  gas.getOrCreateMemberSheet_ = () => createMemberSheet(rows, writes);

  const result = gas.upsertMember_(
    createIdentity({
      tokenIssuedAt: 2000,
      displayName: "更新名稱",
      email: "new-token-email@example.com",
    }),
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
  assert.equal(rows[0][gas.MEMBER_COLUMN.email - 1], "legacy@example.com");
  assert.equal(rows[0][gas.MEMBER_COLUMN.phone - 1], "0911222333");
  assert.equal(rows[0][gas.MEMBER_COLUMN.birthday - 1], "1988-08-08");
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
  for (const protectedColumn of [
    gas.MEMBER_COLUMN.email,
    gas.MEMBER_COLUMN.phone,
    gas.MEMBER_COLUMN.birthday,
  ]) {
    assert.equal(
      valueWrites.some(
        ({ column, columnCount }) =>
          column <= protectedColumn && column + columnCount - 1 >= protectedColumn
      ),
      false
    );
  }
});

test("profile update parses fetch and bridge fields and validates phone and birthday", () => {
  const gas = createGasContext();
  const payload = {
    action: "updateMemberProfile",
    idToken: "header.payload.signature",
    requestId: "request-profile-parse-1",
    callbackOrigin: "https://example.github.io/",
    phone: "+886 912-345-678",
    birthday: "2000-02-29",
    lineUserId: `U${"f".repeat(32)}`,
    targetMemberId: "MBR-ATTACKER00",
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

  for (const field of ["action", "idToken", "requestId", "callbackOrigin", "phone", "birthday"]) {
    assert.equal(fetchRequest[field], bridgeRequest[field]);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(fetchRequest, "lineUserId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fetchRequest, "targetMemberId"), false);
  gas.validateRequestEnvelope_(fetchRequest);
  gas.validateRequestEnvelope_(bridgeRequest);

  for (const phone of ["123", "0912<script>", "=IMPORTXML(1)", "1".repeat(31)]) {
    assert.throws(
      () => gas.validateRequestEnvelope_({ ...fetchRequest, phone }),
      (error) => error.appCode === "INVALID_PHONE"
    );
  }
  for (const birthday of ["2000-02-30", "20-01-01", "2999-01-01"]) {
    assert.throws(
      () => gas.validateRequestEnvelope_({ ...fetchRequest, birthday }),
      (error) => error.appCode === "INVALID_BIRTHDAY"
    );
  }

  gas.validateRequestEnvelope_({ ...fetchRequest, phone: "", birthday: "" });
});

test("point campaign requests parse only a fixed base64url claim for fetch and bridge", () => {
  const gas = createGasContext();

  for (const action of ["previewPointCampaign", "redeemPointCampaign"]) {
    const payload = {
      action,
      idToken: "header.payload.signature",
      requestId: `request-${action}-parse`,
      callbackOrigin: "https://example.github.io/",
      claim: POINT_CLAIM,
      points: 9999,
      campaignId: "CMP-FORGED",
      memberId: "MBR-FORGED",
      lineUserId: `U${"f".repeat(32)}`,
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

    for (const field of ["action", "idToken", "requestId", "callbackOrigin", "claim"]) {
      assert.equal(fetchRequest[field], bridgeRequest[field]);
    }
    for (const forgedField of ["points", "campaignId", "memberId", "lineUserId"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(fetchRequest, forgedField), false);
      assert.equal(Object.prototype.hasOwnProperty.call(bridgeRequest, forgedField), false);
    }
    gas.validateRequestEnvelope_(fetchRequest);
    gas.validateRequestEnvelope_(bridgeRequest);

    for (const invalidClaim of [
      "",
      "A".repeat(42),
      "A".repeat(44),
      "A".repeat(42) + "+",
      "<script>".repeat(6),
    ]) {
      assert.throws(
        () => gas.validateRequestEnvelope_({ ...fetchRequest, claim: invalidClaim }),
        (error) => error.appCode === "INVALID_POINT_CLAIM"
      );
    }
  }
});

test("profile update is token-bound, idempotent, narrow and never returns email", () => {
  const gas = createGasContext();
  const rows = [
    createMemberRow(gas, {
      email: "legacy-private@example.com",
      phone: "0911000000",
      birthday: "1991-01-01",
      adminStatus: "legacy-value",
      accessUpdatedBy: `U${"c".repeat(32)}`,
    }),
  ];
  const before = rows[0].slice();
  const writes = [];
  gas.getOrCreateMemberSheet_ = () => createMemberSheet(rows, writes);
  const request = {
    action: "updateMemberProfile",
    requestId: "request-profile-save-1",
    phone: "+886912345678",
    birthday: "2000-02-29",
  };

  const result = gas.updateMemberProfile_(createIdentity(), request, {});

  assert.equal(rows[0][gas.MEMBER_COLUMN.phone - 1], "'+886912345678");
  assert.equal(rows[0][gas.MEMBER_COLUMN.birthday - 1], "2000-02-29");
  assert.equal(rows[0][gas.MEMBER_COLUMN.lastRequestId - 1], request.requestId);
  assert.ok(rows[0][gas.MEMBER_COLUMN.updatedAt - 1] instanceof Date);
  for (let index = 0; index < rows[0].length; index += 1) {
    if (
      [
        gas.MEMBER_COLUMN.updatedAt - 1,
        gas.MEMBER_COLUMN.lastRequestId - 1,
        gas.MEMBER_COLUMN.phone - 1,
        gas.MEMBER_COLUMN.birthday - 1,
      ].includes(index)
    ) {
      continue;
    }
    assert.equal(rows[0][index], before[index], `profile update changed protected column ${index + 1}`);
  }
  for (const write of writes) {
    for (let column = write.column; column < write.column + write.columnCount; column += 1) {
      assert.equal(
        [
          gas.MEMBER_COLUMN.updatedAt,
          gas.MEMBER_COLUMN.lastRequestId,
          gas.MEMBER_COLUMN.phone,
          gas.MEMBER_COLUMN.birthday,
        ].includes(column),
        true,
        `profile update wrote protected column ${column}`
      );
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(result.data.access)), {
    status: "approved",
    allowed: true,
  });
  assert.equal(result.data.member.phone, "+886912345678");
  assert.equal(result.data.member.birthday, "2000-02-29");
  assert.equal(Object.prototype.hasOwnProperty.call(result.data.member, "email"), false);

  const writeCount = writes.length;
  const retry = gas.updateMemberProfile_(createIdentity(), request, {});
  assert.equal(retry.data.duplicate, true);
  assert.equal(writes.length, writeCount);
});

test("profile update rejects missing or disabled token owner without writing", () => {
  const gas = createGasContext();
  const rows = [createMemberRow(gas, { status: "denied" })];
  const writes = [];
  gas.getOrCreateMemberSheet_ = () => createMemberSheet(rows, writes);
  const request = {
    action: "updateMemberProfile",
    requestId: "request-profile-denied-1",
    phone: "0912345678",
    birthday: "1990-05-20",
  };

  assert.throws(
    () => gas.updateMemberProfile_(createIdentity(), request, {}),
    (error) => error.appCode === "MEMBER_ACCESS_DENIED"
  );
  assert.equal(writes.length, 0);

  assert.throws(
    () =>
      gas.updateMemberProfile_(
        createIdentity({ lineUserId: `U${"d".repeat(32)}` }),
        {
          ...request,
          requestId: "request-profile-missing-2",
          lineUserId: `U${"b".repeat(32)}`,
          targetMemberId: "MBR-ABCDEF1234",
        },
        {}
      ),
    (error) => error.appCode === "MEMBER_NOT_FOUND"
  );
  assert.equal(writes.length, 0);
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

test("point campaign preview is token-owner only and returns public campaign data", () => {
  const gas = createGasContext();
  const memberRows = [createMemberRow(gas)];
  const campaignRows = [createPointCampaignRow(gas)];
  const redemptionRows = [
    createPointRedemptionRow(gas, {
      campaignId: "PCG-OLDER00000",
      pointTypeId: "PTY-OLDER00000",
      points: 2,
      balanceAfter: 2,
    }),
  ];
  installPointSheets(gas, { memberRows, campaignRows, redemptionRows });

  const result = gas.previewPointCampaign_(
    createIdentity(),
    { action: "previewPointCampaign", requestId: "request-preview-1", claim: POINT_CLAIM },
    {}
  );

  assert.equal(result.data.access.allowed, true);
  assert.equal(result.data.campaign.label, "3 點");
  assert.equal(result.data.campaign.points, 3);
  assert.match(result.data.campaign.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.data.pointBalance, 2);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(POINT_CLAIM), false);
  assert.equal(serialized.includes(pointClaimHash()), false);
  assert.equal(serialized.includes(createIdentity().lineUserId), false);
});

test("point redemption trusts campaign snapshot, persists once and is permanently idempotent", () => {
  const gas = createGasContext();
  const memberRows = [createMemberRow(gas)];
  const campaignRows = [createPointCampaignRow(gas, { pointsSnapshot: 3 })];
  const redemptionRows = [
    createPointRedemptionRow(gas, {
      redemptionId: "RDM-OLDER00000000000",
      campaignId: "PCG-OLDER00000",
      pointTypeId: "PTY-OLDER00000",
      points: 2,
      balanceAfter: 2,
      requestId: "request-older-1",
    }),
  ];
  const { redemptionSheet } = installPointSheets(gas, {
    memberRows,
    campaignRows,
    redemptionRows,
  });
  const identity = createIdentity();
  const forgedRequest = {
    action: "redeemPointCampaign",
    requestId: "request-redeem-new-1",
    claim: POINT_CLAIM,
    points: 9999,
    campaignId: "CMP-FORGED",
    memberId: "MBR-FORGED",
    lineUserId: `U${"f".repeat(32)}`,
  };

  const first = gas.redeemPointCampaign_(identity, forgedRequest, {});
  assert.equal(first.data.redeemed, true);
  assert.equal(first.data.duplicate, false);
  assert.equal(first.data.awardedPoints, 3);
  assert.equal(first.data.pointBalance, 5);
  assert.equal(redemptionRows.length, 2);
  const saved = redemptionRows[1];
  assert.equal(saved[gas.POINT_REDEMPTION_COLUMN.campaignId - 1], "PCG-ABCDEF1234");
  assert.equal(saved[gas.POINT_REDEMPTION_COLUMN.memberId - 1], "MBR-ABCDEF1234");
  assert.equal(saved[gas.POINT_REDEMPTION_COLUMN.lineUserId - 1], identity.lineUserId);
  assert.equal(saved[gas.POINT_REDEMPTION_COLUMN.points - 1], 3);
  assert.equal(saved[gas.POINT_REDEMPTION_COLUMN.balanceAfter - 1], 5);
  assert.equal(saved[gas.POINT_REDEMPTION_COLUMN.requestId - 1], forgedRequest.requestId);

  campaignRows[0][gas.POINT_CAMPAIGN_COLUMN.status - 1] = "inactive";
  const sameRequestRetry = gas.redeemPointCampaign_(identity, forgedRequest, {});
  const newRequestRetry = gas.redeemPointCampaign_(
    identity,
    { ...forgedRequest, requestId: "request-redeem-new-2" },
    {}
  );
  for (const retry of [sameRequestRetry, newRequestRetry]) {
    assert.equal(retry.data.redeemed, false);
    assert.equal(retry.data.duplicate, true);
    assert.equal(retry.data.awardedPoints, 0);
    assert.equal(retry.data.pointBalance, 5);
  }
  assert.equal(sameRequestRetry.data.duplicateReason, "request_replay");
  assert.equal(newRequestRetry.data.duplicateReason, "already_redeemed");
  assert.equal(redemptionSheet.rows.length, 2);

  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes(POINT_CLAIM), false);
  assert.equal(serialized.includes(pointClaimHash()), false);
  assert.equal(serialized.includes(identity.lineUserId), false);
});

test("unlimited repeatable campaigns award distinct requests and replay one request only once", () => {
  const gas = createGasContext();
  const campaignRows = [
    createPointCampaignRow(gas, {
      expiresAt: "",
      expiryModeSnapshot: "unlimited",
      redemptionModeSnapshot: "repeatable",
    }),
  ];
  const redemptionRows = [];
  installPointSheets(gas, {
    memberRows: [createMemberRow(gas)],
    campaignRows,
    redemptionRows,
  });
  const identity = createIdentity();
  const firstRequest = {
    action: "redeemPointCampaign",
    requestId: "request-repeatable-one",
    claim: POINT_CLAIM,
  };

  const first = gas.redeemPointCampaign_(identity, firstRequest, {});
  const replay = gas.redeemPointCampaign_(identity, firstRequest, {});
  const second = gas.redeemPointCampaign_(
    identity,
    { ...firstRequest, requestId: "request-repeatable-two" },
    {}
  );

  assert.equal(first.data.redeemed, true);
  assert.equal(first.data.pointBalance, 3);
  assert.equal(replay.data.redeemed, false);
  assert.equal(replay.data.duplicate, true);
  assert.equal(replay.data.duplicateReason, "request_replay");
  assert.equal(replay.data.pointBalance, 3);
  assert.equal(second.data.redeemed, true);
  assert.equal(second.data.pointBalance, 6);
  assert.equal(redemptionRows.length, 2);
  assert.deepEqual(
    redemptionRows.map(
      (row) => row[gas.POINT_REDEMPTION_COLUMN.redemptionModeSnapshot - 1]
    ),
    ["repeatable", "repeatable"]
  );

  const preview = gas.previewPointCampaign_(
    identity,
    {
      action: "previewPointCampaign",
      requestId: "request-repeatable-preview",
      claim: POINT_CLAIM,
    },
    {}
  );
  assert.equal(preview.data.campaign.expiryMode, "unlimited");
  assert.equal(preview.data.campaign.redemptionMode, "repeatable");
  assert.equal(preview.data.campaign.expiresAt, "");
  assert.equal(preview.data.pointBalance, 6);
});

test("single-member campaigns award the first member and reject every later member", () => {
  const gas = createGasContext();
  const secondLineUserId = `U${"c".repeat(32)}`;
  const campaignRows = [
    createPointCampaignRow(gas, {
      redemptionModeSnapshot: "single_member",
    }),
  ];
  const redemptionRows = [];
  installPointSheets(gas, {
    memberRows: [
      createMemberRow(gas),
      createMemberRow(gas, {
        memberId: "MBR-SECOND0000",
        lineUserId: secondLineUserId,
        displayName: "第二位會員",
      }),
    ],
    campaignRows,
    redemptionRows,
  });

  const first = gas.redeemPointCampaign_(
    createIdentity(),
    {
      action: "redeemPointCampaign",
      requestId: "request-single-member-one",
      claim: POINT_CLAIM,
    },
    {}
  );
  const second = gas.redeemPointCampaign_(
    createIdentity({ lineUserId: secondLineUserId, displayName: "第二位會員" }),
    {
      action: "redeemPointCampaign",
      requestId: "request-single-member-two",
      claim: POINT_CLAIM,
    },
    {}
  );

  assert.equal(first.data.redeemed, true);
  assert.equal(first.data.duplicate, false);
  assert.equal(first.data.campaign.redemptionMode, "single_member");
  assert.equal(second.data.redeemed, false);
  assert.equal(second.data.duplicate, true);
  assert.equal(second.data.duplicateReason, "campaign_redeemed");
  assert.equal(second.data.pointBalance, 0);
  assert.equal(redemptionRows.length, 1);
});

test("different members can redeem one campaign and one member can redeem different campaigns", () => {
  const gas = createGasContext();
  const otherClaim = "B".repeat(43);
  const secondLineUserId = `U${"c".repeat(32)}`;
  const memberRows = [
    createMemberRow(gas),
    createMemberRow(gas, {
      memberId: "MBR-SECOND0000",
      lineUserId: secondLineUserId,
      displayName: "第二位會員",
    }),
  ];
  const campaignRows = [
    createPointCampaignRow(gas),
    createPointCampaignRow(gas, {
      campaignId: "PCG-SECOND1234",
      pointTypeId: "PTY-SECOND1234",
      labelSnapshot: "2 點",
      pointsSnapshot: 2,
      claimHash: pointClaimHash(otherClaim),
    }),
  ];
  const redemptionRows = [];
  installPointSheets(gas, { memberRows, campaignRows, redemptionRows });

  const firstMember = createIdentity();
  const secondMember = createIdentity({
    lineUserId: secondLineUserId,
    displayName: "第二位會員",
  });
  gas.redeemPointCampaign_(
    firstMember,
    { action: "redeemPointCampaign", requestId: "request-multi-1", claim: POINT_CLAIM },
    {}
  );
  const secondMemberResult = gas.redeemPointCampaign_(
    secondMember,
    { action: "redeemPointCampaign", requestId: "request-multi-2", claim: POINT_CLAIM },
    {}
  );
  const secondCampaignResult = gas.redeemPointCampaign_(
    firstMember,
    { action: "redeemPointCampaign", requestId: "request-multi-3", claim: otherClaim },
    {}
  );

  assert.equal(redemptionRows.length, 3);
  assert.equal(secondMemberResult.data.pointBalance, 3);
  assert.equal(secondCampaignResult.data.pointBalance, 5);
  assert.equal(
    redemptionRows.filter(
      (row) =>
        row[gas.POINT_REDEMPTION_COLUMN.lineUserId - 1] === firstMember.lineUserId
    ).length,
    2
  );
});

test("point preview and redemption reject missing or disabled members without ledger writes", () => {
  for (const action of ["previewPointCampaign", "redeemPointCampaign"]) {
    for (const memberRows of [
      [],
      [createMemberRow(createGasContext(), { status: "denied" })],
    ]) {
      const gas = createGasContext();
      const normalizedMemberRows = memberRows.map((row) => Array.from(row));
      const campaignRows = [createPointCampaignRow(gas)];
      const redemptionRows = [];
      installPointSheets(gas, {
        memberRows: normalizedMemberRows,
        campaignRows,
        redemptionRows,
      });
      const invoke =
        action === "previewPointCampaign"
          ? gas.previewPointCampaign_.bind(gas)
          : gas.redeemPointCampaign_.bind(gas);

      assert.throws(
        () =>
          invoke(
            createIdentity(),
            { action, requestId: `request-${action}-denied`, claim: POINT_CLAIM },
            {}
          ),
        (error) =>
          error.appCode ===
          (normalizedMemberRows.length ? "MEMBER_ACCESS_DENIED" : "MEMBER_NOT_FOUND")
      );
      assert.equal(redemptionRows.length, 0);
    }
  }
});

test("point campaign preview and redemption require active, expiring, safe snapshots", () => {
  const cases = [
    {
      campaignRows: [],
      code: "POINT_CAMPAIGN_NOT_FOUND",
    },
    {
      campaignRows: [{ status: "inactive" }],
      code: "POINT_CAMPAIGN_INACTIVE",
    },
    {
      campaignRows: [{ expiresAt: new Date(Date.now() - 1000) }],
      code: "POINT_CAMPAIGN_EXPIRED",
    },
    {
      campaignRows: [{ expiresAt: new Date(0) }],
      code: "POINT_CAMPAIGN_EXPIRED",
    },
    {
      campaignRows: [{ expiresAt: "" }],
      code: "POINT_DATA_ERROR",
    },
    {
      campaignRows: [{ pointsSnapshot: 0 }],
      code: "POINT_DATA_ERROR",
    },
    {
      campaignRows: [{ pointsSnapshot: 10000 }],
      code: "POINT_DATA_ERROR",
    },
    {
      campaignRows: [{ campaignId: "not-a-production-id" }],
      code: "POINT_DATA_ERROR",
    },
    {
      campaignRows: [{ pointTypeId: "also-invalid" }],
      code: "POINT_DATA_ERROR",
    },
    {
      campaignRows: [{ labelSnapshot: "custom 3 points" }],
      code: "POINT_DATA_ERROR",
    },
  ];

  for (const testCase of cases) {
    for (const action of ["previewPointCampaign", "redeemPointCampaign"]) {
      const gas = createGasContext();
      const campaignRows = testCase.campaignRows.map((overrides) =>
        createPointCampaignRow(gas, overrides)
      );
      const redemptionRows = [];
      installPointSheets(gas, {
        memberRows: [createMemberRow(gas)],
        campaignRows,
        redemptionRows,
      });
      const invoke =
        action === "previewPointCampaign"
          ? gas.previewPointCampaign_.bind(gas)
          : gas.redeemPointCampaign_.bind(gas);

      assert.throws(
        () =>
          invoke(
            createIdentity(),
            {
              action,
              requestId: `request-invalid-${action}-${testCase.code}`,
              claim: POINT_CLAIM,
            },
            {}
          ),
        (error) => error.appCode === testCase.code
      );
      assert.equal(redemptionRows.length, 0);
    }
  }
});

test("point redemption fails closed when the mutation lock is busy", () => {
  const gas = createGasContext({
    LockService: {
      getScriptLock() {
        return { tryLock: () => false, releaseLock() {} };
      },
    },
  });
  let sheetOpened = false;
  gas.getOrCreateMemberSheet_ = () => {
    sheetOpened = true;
    throw new Error("must not open");
  };

  assert.throws(
    () =>
      gas.redeemPointCampaign_(
        createIdentity(),
        {
          action: "redeemPointCampaign",
          requestId: "request-busy-redeem",
          claim: POINT_CLAIM,
        },
        {}
      ),
    (error) => error.appCode === "BUSY"
  );
  assert.equal(sheetOpened, false);
});

test("point redemption rechecks member access immediately before appending", () => {
  const gas = createGasContext();
  const memberRows = [createMemberRow(gas)];
  const baseMemberSheet = createMemberSheet(memberRows);
  let fullRowReads = 0;
  const memberSheet = {
    ...baseMemberSheet,
    getRange(rowNumber, column, rowCount = 1, columnCount = 1) {
      const range = baseMemberSheet.getRange(rowNumber, column, rowCount, columnCount);
      if (column === 1 && columnCount === gas.MEMBER_HEADERS.length) {
        const originalGetValues = range.getValues.bind(range);
        range.getValues = () => {
          fullRowReads += 1;
          const values = originalGetValues();
          if (fullRowReads >= 2) {
            values[0][gas.MEMBER_COLUMN.status - 1] = "denied";
          }
          return values;
        };
      }
      return range;
    },
  };
  const campaignRows = [createPointCampaignRow(gas)];
  const redemptionRows = [];
  const campaignSheet = createDataSheet(
    "PointCampaigns",
    Array.from(gas.POINT_CAMPAIGN_HEADERS),
    campaignRows
  );
  const redemptionSheet = createDataSheet(
    "PointRedemptions",
    Array.from(gas.POINT_REDEMPTION_HEADERS),
    redemptionRows
  );
  gas.getOrCreateMemberSheet_ = () => memberSheet;
  gas.getOrCreatePointCampaignSheet_ = () => campaignSheet;
  gas.getOrCreatePointRedemptionSheet_ = () => redemptionSheet;

  assert.throws(
    () =>
      gas.redeemPointCampaign_(
        createIdentity(),
        {
          action: "redeemPointCampaign",
          requestId: "request-access-race",
          claim: POINT_CLAIM,
        },
        {}
      ),
    (error) => error.appCode === "MEMBER_ACCESS_DENIED"
  );
  assert.equal(fullRowReads, 2);
  assert.equal(redemptionRows.length, 0);
});

test("point redemption rechecks campaign status immediately before appending", () => {
  const gas = createGasContext();
  const campaignRows = [createPointCampaignRow(gas)];
  const baseCampaignSheet = createDataSheet(
    "PointCampaigns",
    Array.from(gas.POINT_CAMPAIGN_HEADERS),
    campaignRows
  );
  let campaignReads = 0;
  const campaignSheet = {
    ...baseCampaignSheet,
    getRange(rowNumber, column, rowCount = 1, columnCount = 1) {
      const range = baseCampaignSheet.getRange(rowNumber, column, rowCount, columnCount);
      if (rowNumber === 2 && column === 1 && columnCount === gas.POINT_CAMPAIGN_HEADERS.length) {
        const originalGetValues = range.getValues.bind(range);
        range.getValues = () => {
          campaignReads += 1;
          if (campaignReads === 2) {
            campaignRows[0][gas.POINT_CAMPAIGN_COLUMN.status - 1] = "inactive";
          }
          return originalGetValues();
        };
      }
      return range;
    },
  };
  const redemptionRows = [];
  gas.getOrCreateMemberSheet_ = () => createMemberSheet([createMemberRow(gas)]);
  gas.getOrCreatePointCampaignSheet_ = () => campaignSheet;
  gas.getOrCreatePointRedemptionSheet_ = () =>
    createDataSheet(
      "PointRedemptions",
      Array.from(gas.POINT_REDEMPTION_HEADERS),
      redemptionRows
    );

  assert.throws(
    () =>
      gas.redeemPointCampaign_(
        createIdentity(),
        {
          action: "redeemPointCampaign",
          requestId: "request-campaign-race",
          claim: POINT_CLAIM,
        },
        {}
      ),
    (error) => error.appCode === "POINT_CAMPAIGN_INACTIVE"
  );
  assert.equal(campaignReads, 2);
  assert.equal(redemptionRows.length, 0);
});

test("duplicate persisted campaign redemption keys fail closed", () => {
  for (const action of ["previewPointCampaign", "redeemPointCampaign"]) {
    const gas = createGasContext();
    const redemptionRows = [
      createPointRedemptionRow(gas),
      createPointRedemptionRow(gas, {
        redemptionId: "RDM-DUPLICATE0000000",
        requestId: "request-redeem-duplicate",
      }),
    ];
    installPointSheets(gas, {
      memberRows: [createMemberRow(gas)],
      campaignRows: [createPointCampaignRow(gas)],
      redemptionRows,
    });
    const invoke =
      action === "previewPointCampaign"
        ? gas.previewPointCampaign_.bind(gas)
        : gas.redeemPointCampaign_.bind(gas);

    assert.throws(
      () =>
        invoke(
          createIdentity(),
          {
            action,
            requestId: `request-duplicate-ledger-${action}`,
            claim: POINT_CLAIM,
          },
          {}
        ),
      (error) => error.appCode === "POINT_DATA_ERROR"
    );
    assert.equal(redemptionRows.length, 2);
  }
});

test("point ledger permits repeatable campaigns but rejects duplicate request and redemption IDs", () => {
  const gas = createGasContext();
  const repeatableRows = [
    createPointRedemptionRow(gas, {
      redemptionModeSnapshot: "repeatable",
    }),
    createPointRedemptionRow(gas, {
      redemptionId: "RDM-SECOND0000000000",
      requestId: "request-redeem-second",
      balanceAfter: 6,
      redemptionModeSnapshot: "repeatable",
    }),
  ];
  const repeatableSheet = createDataSheet(
    "PointRedemptions",
    Array.from(gas.POINT_REDEMPTION_HEADERS),
    repeatableRows
  );
  assert.equal(
    gas.getMemberPointBalance_(repeatableSheet, createIdentity().lineUserId),
    6
  );

  repeatableRows[1][gas.POINT_REDEMPTION_COLUMN.requestId - 1] =
    "request-redeem-1";
  assert.throws(
    () => gas.getMemberPointBalance_(repeatableSheet, createIdentity().lineUserId),
    (error) => error.appCode === "POINT_DATA_ERROR"
  );

  const duplicateIdRows = [
    createPointRedemptionRow(gas),
    createPointRedemptionRow(gas, {
      lineUserId: `U${"c".repeat(32)}`,
      requestId: "request-other-member",
    }),
  ];
  assert.throws(
    () =>
      gas.getMemberPointBalance_(
        createDataSheet(
          "PointRedemptions",
          Array.from(gas.POINT_REDEMPTION_HEADERS),
          duplicateIdRows
        ),
        createIdentity().lineUserId
      ),
    (error) => error.appCode === "POINT_DATA_ERROR"
  );
});

test("upsert and profile responses derive pointBalance from the redemption ledger", () => {
  const gas = createGasContext();
  const memberRows = [createMemberRow(gas, { lastTokenIat: 2000 })];
  const redemptionRows = [
    createPointRedemptionRow(gas, { points: 3, balanceAfter: 3 }),
    createPointRedemptionRow(gas, {
      redemptionId: "RDM-SECOND0000000000",
      campaignId: "PCG-SECOND1234",
      pointTypeId: "PTY-SECOND1234",
      points: 2,
      balanceAfter: 5,
      requestId: "request-redeem-2",
    }),
    createPointRedemptionRow(gas, {
      redemptionId: "RDM-OTHER00000000000",
      campaignId: "PCG-OTHER12345",
      lineUserId: `U${"d".repeat(32)}`,
      points: 9,
      balanceAfter: 9,
    }),
  ];
  installPointSheets(gas, { memberRows, redemptionRows });

  const upsert = gas.upsertMember_(
    createIdentity(),
    { action: "upsertMember", requestId: "request-balance-upsert", context: {} },
    {}
  );
  const profile = gas.updateMemberProfile_(
    createIdentity(),
    {
      action: "updateMemberProfile",
      requestId: "request-balance-profile",
      phone: "0912345678",
      birthday: "1990-05-20",
      context: {},
    },
    {}
  );

  assert.equal(upsert.data.member.pointBalance, 5);
  assert.equal(profile.data.member.pointBalance, 5);
});

test("member point history is token-bound, newest-first and hides other members", () => {
  const gas = createGasContext();
  const memberRows = [createMemberRow(gas)];
  const redemptionRows = [
    createPointRedemptionRow(gas, {
      redeemedAt: new Date("2026-07-20T00:00:00.000Z"),
      balanceAfter: 3,
    }),
    createPointRedemptionRow(gas, {
      redemptionId: "RDM-SECOND0000000000",
      campaignId: "PCG-SECOND1234",
      pointTypeId: "PTY-SECOND1234",
      points: 2,
      balanceAfter: 5,
      redeemedAt: new Date("2026-07-23T00:00:00.000Z"),
      requestId: "request-redeem-2",
      redemptionModeSnapshot: "repeatable",
    }),
    createPointRedemptionRow(gas, {
      redemptionId: "RDM-OTHER00000000000",
      campaignId: "PCG-OTHER12345",
      pointTypeId: "PTY-OTHER12345",
      lineUserId: `U${"d".repeat(32)}`,
      memberId: "MBR-OTHER12345",
      requestId: "request-redeem-other",
      balanceAfter: 9,
    }),
  ];
  installPointSheets(gas, { memberRows, redemptionRows });

  const result = gas.listPointHistory_(
    createIdentity(),
    { action: "listPointHistory", requestId: "request-history-1" },
    {}
  );

  assert.equal(result.data.access.allowed, true);
  assert.equal(result.data.pointBalance, 5);
  assert.equal(result.data.hasMore, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.data.history)),
    [
      {
        historyId: "RDM-SECOND0000000000",
        entryType: "earn",
        redemptionId: "RDM-SECOND0000000000",
        label: "2 點",
        points: 2,
        balanceAfter: 5,
        redeemedAt: "2026-07-23T00:00:00.000Z",
        redemptionMode: "repeatable",
        source: "qr",
      },
      {
        historyId: "RDM-ABCDEF1234567890",
        entryType: "earn",
        redemptionId: "RDM-ABCDEF1234567890",
        label: "3 點",
        points: 3,
        balanceAfter: 3,
        redeemedAt: "2026-07-20T00:00:00.000Z",
        redemptionMode: "once_per_member",
        source: "qr",
      },
    ]
  );
});

test("lottery draw deducts five points, returns the server result, and replays idempotently", () => {
  const gas = createGasContext();
  const memberRows = [createMemberRow(gas)];
  const redemptionRows = [
    createPointRedemptionRow(gas, {
      points: 8,
      balanceAfter: 8,
      redeemedAt: new Date("2026-07-22T00:00:00.000Z"),
    }),
  ];
  const sheets = installPointSheets(gas, {
    memberRows,
    redemptionRows,
    lotteryPrizeRows: createLotteryPrizeRows(gas),
  });
  const request = {
    action: "drawLottery",
    requestId: "request-lottery-draw-1",
  };

  const first = gas.drawLottery_(createIdentity(), request, {});
  const replay = gas.drawLottery_(createIdentity(), request, {});

  assert.equal(first.data.duplicate, false);
  assert.equal(replay.data.duplicate, true);
  assert.match(first.data.draw.drawId, /^LDW-[A-Z0-9]{16}$/);
  assert.equal(first.data.draw.ticketCost, 5);
  assert.equal(first.data.draw.originalPointBalance, 8);
  assert.equal(first.data.draw.pointBalance, 3);
  assert.equal(first.data.pointBalance, 3);
  assert.equal(first.data.lottery.ticketCost, 5);
  assert.equal(replay.data.draw.drawId, first.data.draw.drawId);
  assert.equal(sheets.lotteryDrawSheet.rows.length, 1);

  const history = gas.listPointHistory_(
    createIdentity(),
    { action: "listPointHistory", requestId: "request-lottery-history-1" },
    {}
  );
  assert.equal(history.data.pointBalance, 3);
  assert.equal(history.data.history[0].entryType, "spend");
  assert.equal(history.data.history[0].points, -5);
  assert.equal(history.data.history[0].drawId, first.data.draw.drawId);

  assert.throws(
    () =>
      gas.drawLottery_(
        createIdentity(),
        { action: "drawLottery", requestId: "request-lottery-draw-2" },
        {}
      ),
    (error) => error.appCode === "INSUFFICIENT_POINTS"
  );
  assert.equal(sheets.lotteryDrawSheet.rows.length, 1);
});

test("deleteMember is retry-idempotent and prevents recreation with the same token", () => {
  const gas = createGasContext();
  const rows = [
    createMemberRow(gas),
    createMemberRow(gas, { memberId: "MBR-DUPLICATE1" }),
  ];
  gas.getOrCreateMemberSheet_ = () => createMemberSheet(rows);
  const redemptionRows = [
    createPointRedemptionRow(gas),
    createPointRedemptionRow(gas, {
      redemptionId: "RDM-SECOND0000000000",
      campaignId: "PCG-SECOND1234",
    }),
    createPointRedemptionRow(gas, {
      redemptionId: "RDM-OTHER00000000000",
      campaignId: "PCG-OTHER12345",
      lineUserId: `U${"d".repeat(32)}`,
    }),
  ];
  const redemptionSheet = createDataSheet(
    "PointRedemptions",
    Array.from(gas.POINT_REDEMPTION_HEADERS),
    redemptionRows
  );
  gas.getOrCreatePointRedemptionSheet_ = () => redemptionSheet;
  const identity = createIdentity({ tokenIssuedAt: 2000 });
  const request = { action: "deleteMember", requestId: "request-delete-1" };

  assert.throws(
    () => gas.findMemberRow_(gas.getOrCreateMemberSheet_(), identity.lineUserId),
    (error) => error.appCode === "MEMBER_DATA_CONFLICT"
  );
  const first = gas.deleteMember_(identity, request, {});
  const retry = gas.deleteMember_(identity, request, {});
  assert.equal(first.data.deleted, true);
  assert.deepEqual(JSON.parse(JSON.stringify(retry.data)), {
    deleted: true,
    duplicate: true,
  });
  assert.equal(rows.length, 2);
  assert.equal(
    rows.every(
      (row) => row.length === gas.MEMBER_HEADERS.length && row.every((value) => value === "")
    ),
    true
  );
  assert.equal(redemptionRows.length, 1);
  assert.equal(
    redemptionRows[0][gas.POINT_REDEMPTION_COLUMN.lineUserId - 1],
    `U${"d".repeat(32)}`
  );

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

test("17, 20 and 21-column schemas migrate to profile fields without touching legacy data", () => {
  const schemaFactories = [
    (gas) => Array.from(gas.LEGACY_MEMBER_HEADERS),
    (gas) => Array.from(gas.ACCESS_AUDIT_MEMBER_HEADERS),
    (gas) => Array.from(gas.ACCESS_AUDIT_MEMBER_HEADERS).concat(["admin_status"]),
  ];
  for (const createHeaders of schemaFactories) {
    const gas = createGasContext();
    const headers = createHeaders(gas);
    const legacyLength = headers.length;
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
    assert.equal(gas.MEMBER_HEADERS.length, 23);
    assert.equal(gas.MEMBER_HEADERS[20], "admin_status");
    assert.equal(gas.MEMBER_HEADERS[21], "phone");
    assert.equal(gas.MEMBER_HEADERS[22], "birthday");
    assert.equal(member[gas.MEMBER_COLUMN.status - 1], "approved");
    assert.deepEqual(
      member.filter((_value, index) => index !== gas.MEMBER_COLUMN.status - 1),
      before.filter((_value, index) => index !== gas.MEMBER_COLUMN.status - 1)
    );
  }
});

test("point sheets use the exact shared schemas and reject header drift", () => {
  const gas = createGasContext();
  const sheets = new Map();
  const spreadsheet = {
    getSheetByName(name) {
      return sheets.get(name) || null;
    },
    insertSheet(name) {
      const sheet = createDataSheet(name);
      sheets.set(name, sheet);
      return sheet;
    },
  };
  gas.SpreadsheetApp.openById = () => spreadsheet;
  const config = {
    spreadsheetId: "shared-members-sheet",
    pointTypeSheetName: "PointTypes",
    pointCampaignSheetName: "PointCampaigns",
    pointRedemptionSheetName: "PointRedemptions",
  };

  const pointTypeSheet = gas.getOrCreatePointTypeSheet_(config);
  const campaignSheet = gas.getOrCreatePointCampaignSheet_(config);
  const redemptionSheet = gas.getOrCreatePointRedemptionSheet_(config);

  assert.deepEqual(pointTypeSheet.headers, [
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
  assert.deepEqual(campaignSheet.headers, [
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
  assert.deepEqual(redemptionSheet.headers, [
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

  campaignSheet.headers[4] = "claim";
  assert.throws(
    () => gas.getOrCreatePointCampaignSheet_(config),
    (error) => error.appCode === "POINT_SCHEMA_MISMATCH"
  );
});

test("legacy point sheet rows receive append-only policy defaults", () => {
  const gas = createGasContext();
  const legacyRows = {
    PointTypes: [
      [
        "PTY-ABCDEF1234",
        "3 點",
        3,
        "active",
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-01T00:00:00.000Z"),
        `U${"a".repeat(32)}`,
        "request-legacy-type",
      ],
    ],
    PointCampaigns: [
      createPointCampaignRow(gas).slice(
        0,
        gas.LEGACY_POINT_CAMPAIGN_HEADERS.length
      ),
    ],
    PointRedemptions: [
      createPointRedemptionRow(gas).slice(
        0,
        gas.LEGACY_POINT_REDEMPTION_HEADERS.length
      ),
    ],
  };
  const sheets = new Map([
    [
      "PointTypes",
      createDataSheet(
        "PointTypes",
        Array.from(gas.LEGACY_POINT_TYPE_HEADERS),
        legacyRows.PointTypes
      ),
    ],
    [
      "PointCampaigns",
      createDataSheet(
        "PointCampaigns",
        Array.from(gas.LEGACY_POINT_CAMPAIGN_HEADERS),
        legacyRows.PointCampaigns
      ),
    ],
    [
      "PointRedemptions",
      createDataSheet(
        "PointRedemptions",
        Array.from(gas.LEGACY_POINT_REDEMPTION_HEADERS),
        legacyRows.PointRedemptions
      ),
    ],
  ]);
  gas.SpreadsheetApp.openById = () => ({
    getSheetByName(name) {
      return sheets.get(name) || null;
    },
  });
  const config = {
    spreadsheetId: "shared-members-sheet",
    pointTypeSheetName: "PointTypes",
    pointCampaignSheetName: "PointCampaigns",
    pointRedemptionSheetName: "PointRedemptions",
  };

  gas.getOrCreatePointTypeSheet_(config);
  gas.getOrCreatePointCampaignSheet_(config);
  gas.getOrCreatePointRedemptionSheet_(config);

  assert.deepEqual(
    sheets.get("PointTypes").rows[0].slice(gas.LEGACY_POINT_TYPE_HEADERS.length),
    ["limited", "once_per_member", "", ""]
  );
  assert.deepEqual(
    sheets
      .get("PointCampaigns")
      .rows[0].slice(gas.LEGACY_POINT_CAMPAIGN_HEADERS.length),
    ["limited", "once_per_member"]
  );
  assert.deepEqual(
    sheets
      .get("PointRedemptions")
      .rows[0].slice(gas.LEGACY_POINT_REDEMPTION_HEADERS.length),
    ["once_per_member"]
  );
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
  assert.equal(health.data.version, "1.4.0");
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
  assert.equal(setup.pointTypeSheetName, "PointTypes");
  assert.equal(setup.pointCampaignSheetName, "PointCampaigns");
  assert.equal(setup.pointRedemptionSheetName, "PointRedemptions");
  assert.equal(setup.lotteryPrizeSheetName, "LotteryPrizes");
  assert.equal(setup.lotteryDrawSheetName, "LotteryDraws");
  assert.equal(setup.pointTypeColumns, 12);
  assert.equal(setup.pointCampaignColumns, 12);
  assert.equal(setup.pointRedemptionColumns, 10);
  assert.equal(setup.lotteryPrizeColumns, 10);
  assert.equal(setup.lotteryDrawColumns, 13);
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
