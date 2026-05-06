const SHEET_NAME = "students";
const HEADERS = [
  "uuid",
  "lineUserId",
  "lineName",
  "linePictureUrl",
  "status",
  "createdAt",
  "updatedAt",
  "approvedAt",
  "reviewNote",
  "publicToken"
];

function doGet() {
  return json_({
    ok: true,
    data: {
      service: "student-approval-gas",
      time: new Date().toISOString()
    }
  });
}

function doPost(e) {
  try {
    const request = parseRequest_(e);
    const action = request.action;
    const payload = request.payload || {};

    if (action === "lineLogin") {
      return json_({
        ok: true,
        data: lineLogin_(payload)
      });
    }

    if (action === "getStudentStatus") {
      return json_({
        ok: true,
        data: getStudentStatus_(payload)
      });
    }

    if (action === "listStudents") {
      return json_({
        ok: true,
        data: listStudents_(payload)
      });
    }

    if (action === "updateStudentStatus") {
      return json_({
        ok: true,
        data: updateStudentStatus_(payload)
      });
    }

    throw new Error("Unknown action: " + action);
  } catch (error) {
    return json_({
      ok: false,
      error: error.message || String(error)
    });
  }
}

function setup() {
  const sheet = ensureSheet_();
  return {
    sheet: sheet.getName(),
    headers: HEADERS,
    time: new Date().toISOString()
  };
}

function parseRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error("Missing POST body.");
  }

  return JSON.parse(e.postData.contents);
}

function lineLogin_(payload) {
  requireFields_(payload, ["code", "redirectUri"]);

  const token = exchangeLineCode_(payload);
  const verified = verifyLineIdToken_(token.id_token, payload.nonce);
  const userInfo = fetchLineUserInfo_(token.access_token);
  const lineUserId = verified.sub || userInfo.sub;

  if (!lineUserId) {
    throw new Error("LINE profile missing user id.");
  }

  const profile = {
    lineUserId,
    lineName: userInfo.name || verified.name || "",
    linePictureUrl: userInfo.picture || verified.picture || ""
  };

  const student = upsertStudent_(profile);
  return publicStudent_(student, true);
}

function getStudentStatus_(payload) {
  requireFields_(payload, ["uuid", "publicToken"]);

  const student = findStudentByUuid_(payload.uuid);
  if (!student || student.publicToken !== payload.publicToken) {
    throw new Error("找不到學員或登入資訊已失效。");
  }

  return publicStudent_(student, true);
}

function listStudents_(payload) {
  assertAdmin_(payload.adminKey);

  const students = readStudents_()
    .map((student) => publicStudent_(student, false))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return { students };
}

function updateStudentStatus_(payload) {
  assertAdmin_(payload.adminKey);
  requireFields_(payload, ["uuid", "status"]);

  const allowed = ["pending", "approved", "rejected"];
  if (allowed.indexOf(payload.status) === -1) {
    throw new Error("Invalid status: " + payload.status);
  }

  const sheet = ensureSheet_();
  const table = readTable_();
  const row = table.rows.find((item) => item.student.uuid === payload.uuid);

  if (!row) {
    throw new Error("找不到學員 UUID: " + payload.uuid);
  }

  const now = new Date().toISOString();
  const student = row.student;
  student.status = payload.status;
  student.updatedAt = now;
  student.approvedAt = payload.status === "approved" ? now : "";
  student.reviewNote = payload.status === "rejected" ? payload.reviewNote || "" : "";

  writeStudentRow_(sheet, row.rowNumber, student);

  return {
    student: publicStudent_(student, false)
  };
}

function exchangeLineCode_(payload) {
  const props = getProperties_();
  const form = {
    grant_type: "authorization_code",
    code: payload.code,
    redirect_uri: payload.redirectUri,
    client_id: props.LINE_CHANNEL_ID,
    client_secret: props.LINE_CHANNEL_SECRET
  };

  if (payload.codeVerifier) {
    form.code_verifier = payload.codeVerifier;
  }

  const response = UrlFetchApp.fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "post",
    payload: form,
    muteHttpExceptions: true
  });

  return parseLineResponse_(response, "LINE token exchange failed.");
}

function verifyLineIdToken_(idToken, nonce) {
  if (!idToken) {
    throw new Error("LINE did not return an id_token. Make sure the openid scope is requested.");
  }

  const props = getProperties_();
  const payload = {
    id_token: idToken,
    client_id: props.LINE_CHANNEL_ID
  };

  if (nonce) payload.nonce = nonce;

  const response = UrlFetchApp.fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "post",
    payload,
    muteHttpExceptions: true
  });

  return parseLineResponse_(response, "LINE id_token verification failed.");
}

function fetchLineUserInfo_(accessToken) {
  const response = UrlFetchApp.fetch("https://api.line.me/oauth2/v2.1/userinfo", {
    method: "get",
    headers: {
      Authorization: "Bearer " + accessToken
    },
    muteHttpExceptions: true
  });

  return parseLineResponse_(response, "LINE userinfo request failed.");
}

function parseLineResponse_(response, fallbackMessage) {
  const status = response.getResponseCode();
  const text = response.getContentText();
  let data = {};

  try {
    data = JSON.parse(text || "{}");
  } catch (error) {
    throw new Error(fallbackMessage + " HTTP " + status);
  }

  if (status < 200 || status >= 300) {
    throw new Error(data.error_description || data.message || data.error || fallbackMessage);
  }

  return data;
}

function upsertStudent_(profile) {
  const sheet = ensureSheet_();
  const table = readTable_();
  const now = new Date().toISOString();
  const existing = table.rows.find((row) => row.student.lineUserId === profile.lineUserId);

  if (existing) {
    const student = existing.student;
    student.lineName = profile.lineName;
    student.linePictureUrl = profile.linePictureUrl;
    student.updatedAt = now;
    student.status = student.status || "pending";
    student.publicToken = student.publicToken || createToken_();

    writeStudentRow_(sheet, existing.rowNumber, student);
    return student;
  }

  const student = {
    uuid: Utilities.getUuid(),
    lineUserId: profile.lineUserId,
    lineName: profile.lineName,
    linePictureUrl: profile.linePictureUrl,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    approvedAt: "",
    reviewNote: "",
    publicToken: createToken_()
  };

  sheet.appendRow(HEADERS.map((header) => student[header] || ""));
  return student;
}

function findStudentByUuid_(uuid) {
  const row = readTable_().rows.find((item) => item.student.uuid === uuid);
  return row ? row.student : null;
}

function readStudents_() {
  return readTable_().rows.map((row) => row.student);
}

function readTable_() {
  const sheet = ensureSheet_();
  const values = sheet.getDataRange().getValues();
  const headerRow = values[0] || HEADERS;
  const headerIndex = {};

  headerRow.forEach((header, index) => {
    headerIndex[header] = index;
  });

  const rows = values.slice(1).filter(rowHasValue_).map((row, index) => {
    const student = {};

    HEADERS.forEach((header) => {
      const cellIndex = headerIndex[header];
      student[header] = cellIndex >= 0 ? row[cellIndex] : "";
    });

    return {
      rowNumber: index + 2,
      student: normalizeStudent_(student)
    };
  });

  return { sheet, rows };
}

function normalizeStudent_(student) {
  return {
    uuid: String(student.uuid || ""),
    lineUserId: String(student.lineUserId || ""),
    lineName: String(student.lineName || ""),
    linePictureUrl: String(student.linePictureUrl || ""),
    status: String(student.status || "pending"),
    createdAt: toIsoString_(student.createdAt),
    updatedAt: toIsoString_(student.updatedAt),
    approvedAt: toIsoString_(student.approvedAt),
    reviewNote: String(student.reviewNote || ""),
    publicToken: String(student.publicToken || "")
  };
}

function writeStudentRow_(sheet, rowNumber, student) {
  sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([HEADERS.map((header) => student[header] || "")]);
}

function ensureSheet_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const needsHeader = HEADERS.some((header, index) => firstRow[index] !== header);

  if (needsHeader) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function getSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("請在 Script Properties 設定 SPREADSHEET_ID，或將此 GAS 綁定到 Google Sheet。");
  }

  return spreadsheet;
}

function getProperties_() {
  const props = PropertiesService.getScriptProperties();
  const values = props.getProperties();
  const required = ["LINE_CHANNEL_ID", "LINE_CHANNEL_SECRET", "ADMIN_KEY"];
  const missing = required.filter((key) => !values[key]);

  if (missing.length) {
    throw new Error("Script Properties 尚未設定: " + missing.join(", "));
  }

  return values;
}

function assertAdmin_(adminKey) {
  const expected = getProperties_().ADMIN_KEY;
  if (!adminKey || adminKey !== expected) {
    throw new Error("管理密鑰錯誤。");
  }
}

function requireFields_(payload, fields) {
  fields.forEach((field) => {
    if (!payload[field]) {
      throw new Error("Missing field: " + field);
    }
  });
}

function publicStudent_(student, includeToken) {
  const data = {
    uuid: student.uuid,
    lineUserId: student.lineUserId,
    lineName: student.lineName,
    linePictureUrl: student.linePictureUrl,
    status: student.status,
    createdAt: student.createdAt,
    updatedAt: student.updatedAt,
    approvedAt: student.approvedAt,
    reviewNote: student.reviewNote
  };

  if (includeToken) data.publicToken = student.publicToken;
  return data;
}

function createToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}

function rowHasValue_(row) {
  return row.some((value) => value !== "" && value !== null);
}

function toIsoString_(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]") return value.toISOString();
  return String(value);
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
