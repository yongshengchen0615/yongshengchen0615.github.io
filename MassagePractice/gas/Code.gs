const SHEET_NAME = "students";
const ATTENDANCE_SHEET_NAME = "attendance";
const PRACTICE_TARGETS_SHEET_NAME = "practice_targets";
const PRACTICE_ITEMS_SHEET_NAME = "practice_items";
const PRACTICE_RECORDS_SHEET_NAME = "practice_records";
const PRACTICE_OTHER_OPTION_ID = "__other__";
const PRACTICE_OTHER_OPTION_NAME = "其他";
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
const ATTENDANCE_HEADERS = [
  "id",
  "studentUuid",
  "lineUserId",
  "lineName",
  "checkInAt",
  "checkOutAt",
  "createdAt",
  "updatedAt"
];
const PRACTICE_OPTION_HEADERS = [
  "id",
  "name",
  "enabled",
  "createdAt",
  "updatedAt"
];
const PRACTICE_RECORD_HEADERS = [
  "id",
  "studentUuid",
  "lineUserId",
  "lineName",
  "targetId",
  "targetName",
  "itemId",
  "itemName",
  "startedAt",
  "endedAt",
  "createdAt",
  "updatedAt"
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

    if (action === "checkIn") {
      return json_({
        ok: true,
        data: checkIn_(payload)
      });
    }

    if (action === "checkOut") {
      return json_({
        ok: true,
        data: checkOut_(payload)
      });
    }

    if (action === "startPractice") {
      return json_({
        ok: true,
        data: startPractice_(payload)
      });
    }

    if (action === "endPractice") {
      return json_({
        ok: true,
        data: endPractice_(payload)
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

    if (action === "deleteStudent") {
      return json_({
        ok: true,
        data: deleteStudent_(payload)
      });
    }

    if (action === "listAttendanceRecords") {
      return json_({
        ok: true,
        data: listAttendanceRecords_(payload)
      });
    }

    if (action === "listPracticeSettings") {
      return json_({
        ok: true,
        data: listPracticeSettings_(payload)
      });
    }

    if (action === "addPracticeTarget") {
      return json_({
        ok: true,
        data: addPracticeTarget_(payload)
      });
    }

    if (action === "addPracticeItem") {
      return json_({
        ok: true,
        data: addPracticeItem_(payload)
      });
    }

    if (action === "deletePracticeTarget") {
      return json_({
        ok: true,
        data: deletePracticeTarget_(payload)
      });
    }

    if (action === "deletePracticeItem") {
      return json_({
        ok: true,
        data: deletePracticeItem_(payload)
      });
    }

    if (action === "listPracticeRecords") {
      return json_({
        ok: true,
        data: listPracticeRecords_(payload)
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
  const attendanceSheet = ensureAttendanceSheet_();
  const practiceTargetsSheet = ensurePracticeTargetsSheet_();
  const practiceItemsSheet = ensurePracticeItemsSheet_();
  const practiceRecordsSheet = ensurePracticeRecordsSheet_();
  return {
    sheet: sheet.getName(),
    headers: HEADERS,
    attendanceSheet: attendanceSheet.getName(),
    attendanceHeaders: ATTENDANCE_HEADERS,
    practiceTargetsSheet: practiceTargetsSheet.getName(),
    practiceItemsSheet: practiceItemsSheet.getName(),
    practiceRecordsSheet: practiceRecordsSheet.getName(),
    practiceOptionHeaders: PRACTICE_OPTION_HEADERS,
    practiceRecordHeaders: PRACTICE_RECORD_HEADERS,
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

function checkIn_(payload) {
  const student = validateStudentSession_(payload);
  assertStudentApproved_(student);

  const table = readAttendanceTable_();
  const openRecord = table.rows.find((row) => row.record.studentUuid === student.uuid && !row.record.checkOutAt);

  if (openRecord) {
    throw new Error("目前已有尚未簽退的紀錄。");
  }

  const now = new Date().toISOString();
  const record = {
    id: Utilities.getUuid(),
    studentUuid: student.uuid,
    lineUserId: student.lineUserId,
    lineName: student.lineName,
    checkInAt: now,
    checkOutAt: "",
    createdAt: now,
    updatedAt: now
  };

  table.sheet.appendRow(ATTENDANCE_HEADERS.map((header) => record[header] || ""));

  return publicStudent_(student, true);
}

function checkOut_(payload) {
  const student = validateStudentSession_(payload);
  assertStudentApproved_(student);

  const table = readAttendanceTable_();
  const openRows = table.rows
    .filter((row) => row.record.studentUuid === student.uuid && !row.record.checkOutAt)
    .sort((a, b) => String(b.record.checkInAt).localeCompare(String(a.record.checkInAt)));

  if (!openRows.length) {
    throw new Error("目前沒有可簽退的紀錄。");
  }

  const now = new Date().toISOString();
  const row = openRows[0];
  row.record.checkOutAt = now;
  row.record.updatedAt = now;

  writeAttendanceRow_(table.sheet, row.rowNumber, row.record);

  return publicStudent_(student, true);
}

function startPractice_(payload) {
  const student = validateStudentSession_(payload);
  assertStudentApproved_(student);
  requireFields_(payload, ["targetId", "itemId"]);

  const openRecord = readPracticeTable_().rows.find(
    (row) => row.record.studentUuid === student.uuid && !row.record.endedAt
  );

  if (openRecord) {
    throw new Error("目前已有尚未結束的練習紀錄。");
  }

  const target = resolvePracticeChoice_(PRACTICE_TARGETS_SHEET_NAME, payload.targetId, payload.targetName, "練習對象");
  const item = resolvePracticeChoice_(PRACTICE_ITEMS_SHEET_NAME, payload.itemId, payload.itemName, "練習項目");

  const now = new Date().toISOString();
  const record = {
    id: Utilities.getUuid(),
    studentUuid: student.uuid,
    lineUserId: student.lineUserId,
    lineName: student.lineName,
    targetId: target.id,
    targetName: target.name,
    itemId: item.id,
    itemName: item.name,
    startedAt: now,
    endedAt: "",
    createdAt: now,
    updatedAt: now
  };

  ensurePracticeRecordsSheet_().appendRow(PRACTICE_RECORD_HEADERS.map((header) => record[header] || ""));

  return publicStudent_(student, true);
}

function endPractice_(payload) {
  const student = validateStudentSession_(payload);
  assertStudentApproved_(student);

  const table = readPracticeTable_();
  const openRows = table.rows
    .filter((row) => row.record.studentUuid === student.uuid && !row.record.endedAt)
    .sort((a, b) => String(b.record.startedAt).localeCompare(String(a.record.startedAt)));

  if (!openRows.length) {
    throw new Error("目前沒有可結束的練習紀錄。");
  }

  const now = new Date().toISOString();
  const row = openRows[0];
  row.record.endedAt = now;
  row.record.updatedAt = now;

  writePracticeRow_(table.sheet, row.rowNumber, row.record);

  return publicStudent_(student, true);
}

function listStudents_(payload) {
  assertAdmin_(payload.adminKey);

  const students = readStudents_()
    .map((student) => publicStudent_(student, false))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return { students };
}

function listAttendanceRecords_(payload) {
  assertAdmin_(payload.adminKey);
  requireFields_(payload, ["uuid"]);

  const student = findStudentByUuid_(payload.uuid);
  if (!student) {
    throw new Error("找不到學員 UUID: " + payload.uuid);
  }

  const records = sortAttendanceRecords_(
    readAttendanceRecords_().filter((record) => record.studentUuid === payload.uuid)
  ).map(publicAttendanceRecord_);

  return {
    student: publicStudent_(student, false),
    records
  };
}

function listPracticeSettings_(payload) {
  assertAdmin_(payload.adminKey);

  return {
    targets: readPracticeOptions_(PRACTICE_TARGETS_SHEET_NAME),
    items: readPracticeOptions_(PRACTICE_ITEMS_SHEET_NAME)
  };
}

function addPracticeTarget_(payload) {
  assertAdmin_(payload.adminKey);
  return {
    target: addPracticeOption_(PRACTICE_TARGETS_SHEET_NAME, payload.name)
  };
}

function addPracticeItem_(payload) {
  assertAdmin_(payload.adminKey);
  return {
    item: addPracticeOption_(PRACTICE_ITEMS_SHEET_NAME, payload.name)
  };
}

function deletePracticeTarget_(payload) {
  assertAdmin_(payload.adminKey);
  deletePracticeOption_(PRACTICE_TARGETS_SHEET_NAME, payload.id);
  return { id: payload.id };
}

function deletePracticeItem_(payload) {
  assertAdmin_(payload.adminKey);
  deletePracticeOption_(PRACTICE_ITEMS_SHEET_NAME, payload.id);
  return { id: payload.id };
}

function listPracticeRecords_(payload) {
  assertAdmin_(payload.adminKey);
  requireFields_(payload, ["uuid"]);

  const student = findStudentByUuid_(payload.uuid);
  if (!student) {
    throw new Error("找不到學員 UUID: " + payload.uuid);
  }

  const records = sortPracticeRecords_(
    readPracticeRecords_().filter((record) => record.studentUuid === payload.uuid)
  ).map(publicPracticeRecord_);

  return {
    student: publicStudent_(student, false),
    records
  };
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

function deleteStudent_(payload) {
  assertAdmin_(payload.adminKey);
  requireFields_(payload, ["uuid"]);

  const sheet = ensureSheet_();
  const table = readTable_();
  const row = table.rows.find((item) => item.student.uuid === payload.uuid);

  if (!row) {
    throw new Error("找不到學員 UUID: " + payload.uuid);
  }

  sheet.deleteRow(row.rowNumber);
  deleteAttendanceRowsByStudentUuid_(payload.uuid);
  deletePracticeRowsByStudentUuid_(payload.uuid);

  return {
    uuid: payload.uuid
  };
}

function validateStudentSession_(payload) {
  requireFields_(payload, ["uuid", "publicToken"]);

  const student = findStudentByUuid_(payload.uuid);
  if (!student || student.publicToken !== payload.publicToken) {
    throw new Error("找不到學員或登入資訊已失效。");
  }

  return student;
}

function assertStudentApproved_(student) {
  if (student.status !== "approved") {
    throw new Error("審核通過後才能簽到簽退。");
  }
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

  const rows = values
    .slice(1)
    .map((row, index) => ({
      row,
      rowNumber: index + 2
    }))
    .filter((item) => rowHasValue_(item.row))
    .map((item) => {
      const student = {};

      HEADERS.forEach((header) => {
        const cellIndex = headerIndex[header];
        student[header] = cellIndex >= 0 ? item.row[cellIndex] : "";
      });

      return {
        rowNumber: item.rowNumber,
        student: normalizeStudent_(student)
      };
    });

  return { sheet, rows };
}

function readAttendanceRecords_() {
  return readAttendanceTable_().rows.map((row) => row.record);
}

function readPracticeOptions_(sheetName) {
  return readPracticeOptionTable_(sheetName).rows.map((row) => row.option);
}

function readPracticeRecords_() {
  return readPracticeTable_().rows.map((row) => row.record);
}

function readAttendanceTable_() {
  const sheet = ensureAttendanceSheet_();
  const values = sheet.getDataRange().getValues();
  const headerRow = values[0] || ATTENDANCE_HEADERS;
  const headerIndex = {};

  headerRow.forEach((header, index) => {
    headerIndex[header] = index;
  });

  const rows = values
    .slice(1)
    .map((row, index) => ({
      row,
      rowNumber: index + 2
    }))
    .filter((item) => rowHasValue_(item.row))
    .map((item) => {
      const record = {};

      ATTENDANCE_HEADERS.forEach((header) => {
        const cellIndex = headerIndex[header];
        record[header] = cellIndex >= 0 ? item.row[cellIndex] : "";
      });

      return {
        rowNumber: item.rowNumber,
        record: normalizeAttendanceRecord_(record)
      };
    });

  return { sheet, rows };
}

function readPracticeOptionTable_(sheetName) {
  const sheet = ensurePracticeOptionSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  const headerRow = values[0] || PRACTICE_OPTION_HEADERS;
  const headerIndex = {};

  headerRow.forEach((header, index) => {
    headerIndex[header] = index;
  });

  const rows = values
    .slice(1)
    .map((row, index) => ({
      row,
      rowNumber: index + 2
    }))
    .filter((item) => rowHasValue_(item.row))
    .map((item) => {
      const option = {};

      PRACTICE_OPTION_HEADERS.forEach((header) => {
        const cellIndex = headerIndex[header];
        option[header] = cellIndex >= 0 ? item.row[cellIndex] : "";
      });

      return {
        rowNumber: item.rowNumber,
        option: normalizePracticeOption_(option)
      };
    });

  return { sheet, rows };
}

function readPracticeTable_() {
  const sheet = ensurePracticeRecordsSheet_();
  const values = sheet.getDataRange().getValues();
  const headerRow = values[0] || PRACTICE_RECORD_HEADERS;
  const headerIndex = {};

  headerRow.forEach((header, index) => {
    headerIndex[header] = index;
  });

  const rows = values
    .slice(1)
    .map((row, index) => ({
      row,
      rowNumber: index + 2
    }))
    .filter((item) => rowHasValue_(item.row))
    .map((item) => {
      const record = {};

      PRACTICE_RECORD_HEADERS.forEach((header) => {
        const cellIndex = headerIndex[header];
        record[header] = cellIndex >= 0 ? item.row[cellIndex] : "";
      });

      return {
        rowNumber: item.rowNumber,
        record: normalizePracticeRecord_(record)
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
    status: normalizeStatus_(student.status),
    createdAt: toIsoString_(student.createdAt),
    updatedAt: toIsoString_(student.updatedAt),
    approvedAt: toIsoString_(student.approvedAt),
    reviewNote: String(student.reviewNote || ""),
    publicToken: String(student.publicToken || "")
  };
}

function normalizeStatus_(value) {
  const status = String(value || "").trim().toLowerCase();

  if (["approved", "通過", "已通過", "已通過審核"].indexOf(status) !== -1) return "approved";
  if (["rejected", "未通過", "不通過", "拒絕"].indexOf(status) !== -1) return "rejected";
  if (["pending", "待審", "待審核", "待師資審核", ""].indexOf(status) !== -1) return "pending";

  return status;
}

function normalizeAttendanceRecord_(record) {
  return {
    id: String(record.id || ""),
    studentUuid: String(record.studentUuid || ""),
    lineUserId: String(record.lineUserId || ""),
    lineName: String(record.lineName || ""),
    checkInAt: toIsoString_(record.checkInAt),
    checkOutAt: toIsoString_(record.checkOutAt),
    createdAt: toIsoString_(record.createdAt),
    updatedAt: toIsoString_(record.updatedAt)
  };
}

function normalizePracticeOption_(option) {
  return {
    id: String(option.id || ""),
    name: String(option.name || ""),
    enabled: option.enabled === "" ? true : String(option.enabled).toLowerCase() !== "false",
    createdAt: toIsoString_(option.createdAt),
    updatedAt: toIsoString_(option.updatedAt)
  };
}

function normalizePracticeRecord_(record) {
  return {
    id: String(record.id || ""),
    studentUuid: String(record.studentUuid || ""),
    lineUserId: String(record.lineUserId || ""),
    lineName: String(record.lineName || ""),
    targetId: String(record.targetId || ""),
    targetName: String(record.targetName || ""),
    itemId: String(record.itemId || ""),
    itemName: String(record.itemName || ""),
    startedAt: toIsoString_(record.startedAt),
    endedAt: toIsoString_(record.endedAt),
    createdAt: toIsoString_(record.createdAt),
    updatedAt: toIsoString_(record.updatedAt)
  };
}

function writeStudentRow_(sheet, rowNumber, student) {
  sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([HEADERS.map((header) => student[header] || "")]);
}

function writeAttendanceRow_(sheet, rowNumber, record) {
  sheet
    .getRange(rowNumber, 1, 1, ATTENDANCE_HEADERS.length)
    .setValues([ATTENDANCE_HEADERS.map((header) => record[header] || "")]);
}

function writePracticeRow_(sheet, rowNumber, record) {
  sheet
    .getRange(rowNumber, 1, 1, PRACTICE_RECORD_HEADERS.length)
    .setValues([PRACTICE_RECORD_HEADERS.map((header) => record[header] || "")]);
}

function deleteAttendanceRowsByStudentUuid_(uuid) {
  const table = readAttendanceTable_();
  const rowNumbers = table.rows
    .filter((row) => row.record.studentUuid === uuid)
    .map((row) => row.rowNumber)
    .sort((a, b) => b - a);

  rowNumbers.forEach((rowNumber) => {
    table.sheet.deleteRow(rowNumber);
  });
}

function deletePracticeRowsByStudentUuid_(uuid) {
  const table = readPracticeTable_();
  const rowNumbers = table.rows
    .filter((row) => row.record.studentUuid === uuid)
    .map((row) => row.rowNumber)
    .sort((a, b) => b - a);

  rowNumbers.forEach((rowNumber) => {
    table.sheet.deleteRow(rowNumber);
  });
}

function findPracticeOption_(sheetName, id) {
  return readPracticeOptions_(sheetName).find((option) => option.id === id) || null;
}

function resolvePracticeChoice_(sheetName, id, customName, label) {
  if (isPracticeOtherOption_(id)) {
    const name = cleanPracticeCustomName_(customName);

    if (!name) {
      throw new Error("請輸入其他" + label + "。");
    }

    if (name.length > 60) {
      throw new Error("其他" + label + "最多 60 字。");
    }

    return {
      id: PRACTICE_OTHER_OPTION_ID,
      name: name,
      enabled: true
    };
  }

  const option = findPracticeOption_(sheetName, id);

  if (!option || !option.enabled) {
    throw new Error(label + "不存在或已停用。");
  }

  return option;
}

function isPracticeOtherOption_(id) {
  return [PRACTICE_OTHER_OPTION_ID, "other", PRACTICE_OTHER_OPTION_NAME].indexOf(String(id || "").trim()) !== -1;
}

function cleanPracticeCustomName_(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function addPracticeOption_(sheetName, name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) {
    throw new Error("請輸入名稱。");
  }

  if (cleanName === PRACTICE_OTHER_OPTION_NAME) {
    throw new Error("「其他」已是系統固定選項。");
  }

  const table = readPracticeOptionTable_(sheetName);
  const exists = table.rows.find((row) => row.option.name.toLowerCase() === cleanName.toLowerCase());
  if (exists) {
    throw new Error("名稱已存在。");
  }

  const now = new Date().toISOString();
  const option = {
    id: Utilities.getUuid(),
    name: cleanName,
    enabled: true,
    createdAt: now,
    updatedAt: now
  };

  table.sheet.appendRow(PRACTICE_OPTION_HEADERS.map((header) => option[header]));
  return normalizePracticeOption_(option);
}

function deletePracticeOption_(sheetName, id) {
  requireFields_({ id }, ["id"]);

  const table = readPracticeOptionTable_(sheetName);
  const row = table.rows.find((item) => item.option.id === id);

  if (!row) {
    throw new Error("找不到選項。");
  }

  table.sheet.deleteRow(row.rowNumber);
}

function ensureSheet_() {
  return ensureSheetWithHeaders_(SHEET_NAME, HEADERS);
}

function ensureAttendanceSheet_() {
  return ensureSheetWithHeaders_(ATTENDANCE_SHEET_NAME, ATTENDANCE_HEADERS);
}

function ensurePracticeTargetsSheet_() {
  return ensureSheetWithHeaders_(PRACTICE_TARGETS_SHEET_NAME, PRACTICE_OPTION_HEADERS);
}

function ensurePracticeItemsSheet_() {
  return ensureSheetWithHeaders_(PRACTICE_ITEMS_SHEET_NAME, PRACTICE_OPTION_HEADERS);
}

function ensurePracticeRecordsSheet_() {
  return ensureSheetWithHeaders_(PRACTICE_RECORDS_SHEET_NAME, PRACTICE_RECORD_HEADERS);
}

function ensurePracticeOptionSheet_(sheetName) {
  if (sheetName === PRACTICE_TARGETS_SHEET_NAME) return ensurePracticeTargetsSheet_();
  if (sheetName === PRACTICE_ITEMS_SHEET_NAME) return ensurePracticeItemsSheet_();
  throw new Error("Unknown practice option sheet: " + sheetName);
}

function ensureSheetWithHeaders_(sheetName, headers) {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeader = headers.some((header, index) => firstRow[index] !== header);

  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
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

  if (includeToken) {
    data.publicToken = student.publicToken;
    data.attendance = studentAttendanceSummary_(student.uuid);
    data.practice = studentPracticeSummary_(student.uuid);
  }

  return data;
}

function studentAttendanceSummary_(uuid) {
  const records = sortAttendanceRecords_(readAttendanceRecords_().filter((record) => record.studentUuid === uuid));
  const current = records.find((record) => !record.checkOutAt) || null;

  return {
    active: Boolean(current),
    current: current ? publicAttendanceRecord_(current) : null,
    recent: records.slice(0, 5).map(publicAttendanceRecord_)
  };
}

function publicAttendanceRecord_(record) {
  return {
    id: record.id,
    studentUuid: record.studentUuid,
    lineUserId: record.lineUserId,
    lineName: record.lineName,
    checkInAt: record.checkInAt,
    checkOutAt: record.checkOutAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function studentPracticeSummary_(uuid) {
  const records = sortPracticeRecords_(readPracticeRecords_().filter((record) => record.studentUuid === uuid));
  const current = records.find((record) => !record.endedAt) || null;

  return {
    active: Boolean(current),
    current: current ? publicPracticeRecord_(current) : null,
    recent: records.slice(0, 5).map(publicPracticeRecord_),
    options: {
      targets: readPracticeOptions_(PRACTICE_TARGETS_SHEET_NAME).filter((option) => option.enabled),
      items: readPracticeOptions_(PRACTICE_ITEMS_SHEET_NAME).filter((option) => option.enabled)
    }
  };
}

function publicPracticeRecord_(record) {
  return {
    id: record.id,
    studentUuid: record.studentUuid,
    lineUserId: record.lineUserId,
    lineName: record.lineName,
    targetId: record.targetId,
    targetName: record.targetName,
    itemId: record.itemId,
    itemName: record.itemName,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function sortAttendanceRecords_(records) {
  return records.slice().sort((a, b) => String(b.checkInAt).localeCompare(String(a.checkInAt)));
}

function sortPracticeRecords_(records) {
  return records.slice().sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
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
