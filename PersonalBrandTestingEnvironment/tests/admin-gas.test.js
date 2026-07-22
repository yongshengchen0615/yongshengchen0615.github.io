const assert = require("node:assert/strict");
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
  const propertyValues = {
    LINE_CHANNEL_ID: ADMIN_CHANNEL_ID,
    SPREADSHEET_ID: "spreadsheet-id",
    SHEET_NAME: "Members",
    ADMIN_SHEET_NAME: "Admins",
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
      getUuid() {
        return "01234567-89ab-cdef-0123-456789abcdef";
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

function configFor(gas) {
  return {
    lineChannelId: ADMIN_CHANNEL_ID,
    spreadsheetId: "spreadsheet-id",
    sheetName: "Members",
    adminSheetName: "Admins",
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
});

test("configuration fails closed unless the administrator channel is exact", () => {
  const gas = createGasContext();
  const config = gas.getConfig_();
  assert.equal(config.lineChannelId, ADMIN_CHANNEL_ID);
  assert.equal(config.sheetName, "Members");
  assert.equal(config.adminSheetName, "Admins");

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

test("only two administrator actions are accepted and member/profile input is ignored", () => {
  const gas = createGasContext();
  for (const action of ["upsertMember", "updateMemberProfile", "deleteMember"]) {
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
      }),
    },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "adminStatus"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "status"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "phone"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, "birthday"), false);
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

  for (const action of ["upsertMember", "updateMemberProfile", "deleteMember"]) {
    assert.throws(
      () => gas.handleAdminRequest_({ action, idToken: "header.payload.signature" }),
      (error) => error.appCode === "UNSUPPORTED_ACTION"
    );
  }
  assert.equal(configRead, false);
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
});

test("health identifies the isolated service without exposing configuration", () => {
  const gas = createGasContext();
  const output = gas.doGet({ parameter: { action: "health", requestId: "health-123" } });
  const response = JSON.parse(output.content);
  assert.equal(response.ok, true);
  assert.equal(response.requestId, "health-123");
  assert.equal(response.data.service, "member-admin-api");
  assert.equal(response.data.version, "1.1.0");
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
