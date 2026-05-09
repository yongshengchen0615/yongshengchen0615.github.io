const SHEET_NAME = "students";
const TEACHERS_SHEET_NAME = "teachers";
const ATTENDANCE_SHEET_NAME = "attendance";
const PRACTICE_TARGETS_SHEET_NAME = "practice_targets";
const PRACTICE_ITEMS_SHEET_NAME = "practice_items";
const PRACTICE_RECORDS_SHEET_NAME = "practice_records";
const LOCATION_SETTINGS_SHEET_NAME = "location_settings";
const PRACTICE_OTHER_OPTION_ID = "__other__";
const PRACTICE_OTHER_OPTION_NAME = "其他";
const LOCATION_SETTING_ID = "default";
const DEFAULT_LOCATION_RADIUS_METERS = 100;
const MIN_LOCATION_RADIUS_METERS = 10;
const MAX_LOCATION_RADIUS_METERS = 10000;
const WRITE_ACTIONS = [
  "checkIn",
  "checkOut",
  "startPractice",
  "endPractice",
  "updateStudentStatus",
  "deleteStudent",
  "addPracticeTarget",
  "addPracticeItem",
  "batchAddPracticeTargets",
  "batchAddPracticeItems",
  "deletePracticeTarget",
  "deletePracticeItem",
  "updateLocationSettings"
];
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
const TEACHER_HEADERS = [
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
  "updatedAt",
  "checkInLatitude",
  "checkInLongitude",
  "checkInAccuracyMeters",
  "checkInDistanceMeters",
  "checkOutLatitude",
  "checkOutLongitude",
  "checkOutAccuracyMeters",
  "checkOutDistanceMeters"
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
  "updatedAt",
  "startLatitude",
  "startLongitude",
  "startAccuracyMeters",
  "startDistanceMeters",
  "endLatitude",
  "endLongitude",
  "endAccuracyMeters",
  "endDistanceMeters"
];
const LOCATION_SETTINGS_HEADERS = [
  "id",
  "name",
  "enabled",
  "latitude",
  "longitude",
  "radiusMeters",
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
    const data = shouldLockAction_(action)
      ? withWriteLock_(function () {
          return handleAction_(action, payload);
        })
      : handleAction_(action, payload);

    return json_({
      ok: true,
      data: data
    });
  } catch (error) {
    return json_({
      ok: false,
      error: error.message || String(error)
    });
  }
}

function shouldLockAction_(action) {
  return WRITE_ACTIONS.indexOf(action) !== -1;
}

function withWriteLock_(callback) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);
  } catch (error) {
    throw new Error("系統忙碌中，請稍後再試。");
  }

  try {
    const result = callback();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function handleAction_(action, payload) {
  if (action === "lineLogin") {
    return lineLogin_(payload);
  }

  if (action === "teacherLineLogin") {
    return teacherLineLogin_(payload);
  }

  if (action === "getTeacherStatus") {
    return getTeacherStatus_(payload);
  }

  if (action === "getStudentStatus") {
    return getStudentStatus_(payload);
  }

  if (action === "checkIn") {
    return checkIn_(payload);
  }

  if (action === "checkOut") {
    return checkOut_(payload);
  }

  if (action === "startPractice") {
    return startPractice_(payload);
  }

  if (action === "endPractice") {
    return endPractice_(payload);
  }

  if (action === "listStudents") {
    return listStudents_(payload);
  }

  if (action === "updateStudentStatus") {
    return updateStudentStatus_(payload);
  }

  if (action === "deleteStudent") {
    return deleteStudent_(payload);
  }

  if (action === "listAttendanceRecords") {
    return listAttendanceRecords_(payload);
  }

  if (action === "listPracticeSettings") {
    return listPracticeSettings_(payload);
  }

  if (action === "addPracticeTarget") {
    return addPracticeTarget_(payload);
  }

  if (action === "addPracticeItem") {
    return addPracticeItem_(payload);
  }

  if (action === "batchAddPracticeTargets") {
    return batchAddPracticeTargets_(payload);
  }

  if (action === "batchAddPracticeItems") {
    return batchAddPracticeItems_(payload);
  }

  if (action === "deletePracticeTarget") {
    return deletePracticeTarget_(payload);
  }

  if (action === "deletePracticeItem") {
    return deletePracticeItem_(payload);
  }

  if (action === "updateLocationSettings") {
    return updateLocationSettings_(payload);
  }

  if (action === "listPracticeRecords") {
    return listPracticeRecords_(payload);
  }

  throw new Error("Unknown action: " + action);
}

function setup() {
  const sheet = ensureSheet_();
  const teachersSheet = ensureTeachersSheet_();
  const attendanceSheet = ensureAttendanceSheet_();
  const practiceTargetsSheet = ensurePracticeTargetsSheet_();
  const practiceItemsSheet = ensurePracticeItemsSheet_();
  const practiceRecordsSheet = ensurePracticeRecordsSheet_();
  const locationSettingsSheet = ensureLocationSettingsSheet_();
  return {
    sheet: sheet.getName(),
    headers: HEADERS,
    teachersSheet: teachersSheet.getName(),
    teacherHeaders: TEACHER_HEADERS,
    attendanceSheet: attendanceSheet.getName(),
    attendanceHeaders: ATTENDANCE_HEADERS,
    practiceTargetsSheet: practiceTargetsSheet.getName(),
    practiceItemsSheet: practiceItemsSheet.getName(),
    practiceRecordsSheet: practiceRecordsSheet.getName(),
    locationSettingsSheet: locationSettingsSheet.getName(),
    practiceOptionHeaders: PRACTICE_OPTION_HEADERS,
    practiceRecordHeaders: PRACTICE_RECORD_HEADERS,
    locationSettingsHeaders: LOCATION_SETTINGS_HEADERS,
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

function teacherLineLogin_(payload) {
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

  const teacher = upsertTeacher_(profile);
  return publicTeacher_(teacher, true);
}

function getTeacherStatus_(payload) {
  const teacher = validateTeacherSession_(payload);
  return publicTeacher_(teacher, true);
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
  const location = assertWithinLocationRange_(payload);

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
    updatedAt: now,
    checkInLatitude: location ? location.latitude : "",
    checkInLongitude: location ? location.longitude : "",
    checkInAccuracyMeters: location ? location.accuracyMeters : "",
    checkInDistanceMeters: location ? location.distanceMeters : "",
    checkOutLatitude: "",
    checkOutLongitude: "",
    checkOutAccuracyMeters: "",
    checkOutDistanceMeters: ""
  };

  table.sheet.appendRow(ATTENDANCE_HEADERS.map((header) => cellValue_(record[header])));
  SpreadsheetApp.flush();

  return publicStudent_(student, true);
}

function checkOut_(payload) {
  const student = validateStudentSession_(payload);
  assertStudentApproved_(student);
  const location = assertWithinLocationRange_(payload);

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
  if (location) {
    row.record.checkOutLatitude = location.latitude;
    row.record.checkOutLongitude = location.longitude;
    row.record.checkOutAccuracyMeters = location.accuracyMeters;
    row.record.checkOutDistanceMeters = location.distanceMeters;
  }

  writeAttendanceRow_(table.sheet, row.rowNumber, row.record);
  SpreadsheetApp.flush();

  return publicStudent_(student, true);
}

function startPractice_(payload) {
  const student = validateStudentSession_(payload);
  assertStudentApproved_(student);
  requireFields_(payload, ["targetId", "itemId"]);
  const location = assertWithinLocationRange_(payload);

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
    updatedAt: now,
    startLatitude: location ? location.latitude : "",
    startLongitude: location ? location.longitude : "",
    startAccuracyMeters: location ? location.accuracyMeters : "",
    startDistanceMeters: location ? location.distanceMeters : "",
    endLatitude: "",
    endLongitude: "",
    endAccuracyMeters: "",
    endDistanceMeters: ""
  };

  ensurePracticeRecordsSheet_().appendRow(PRACTICE_RECORD_HEADERS.map((header) => cellValue_(record[header])));
  SpreadsheetApp.flush();

  return publicStudent_(student, true);
}

function endPractice_(payload) {
  const student = validateStudentSession_(payload);
  assertStudentApproved_(student);
  const location = assertWithinLocationRange_(payload);

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
  if (location) {
    row.record.endLatitude = location.latitude;
    row.record.endLongitude = location.longitude;
    row.record.endAccuracyMeters = location.accuracyMeters;
    row.record.endDistanceMeters = location.distanceMeters;
  }

  writePracticeRow_(table.sheet, row.rowNumber, row.record);
  SpreadsheetApp.flush();

  return publicStudent_(student, true);
}

function listStudents_(payload) {
  assertTeacherAccess_(payload);

  const students = readStudents_()
    .map((student) => publicStudent_(student, false))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return { students };
}

function listAttendanceRecords_(payload) {
  assertTeacherAccess_(payload);
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
  assertTeacherAccess_(payload);

  return {
    targets: readPracticeOptions_(PRACTICE_TARGETS_SHEET_NAME),
    items: readPracticeOptions_(PRACTICE_ITEMS_SHEET_NAME),
    location: publicLocationSettings_(readLocationSettings_())
  };
}

function addPracticeTarget_(payload) {
  assertTeacherAccess_(payload);
  return {
    target: addPracticeOption_(PRACTICE_TARGETS_SHEET_NAME, payload.name)
  };
}

function addPracticeItem_(payload) {
  assertTeacherAccess_(payload);
  return {
    item: addPracticeOption_(PRACTICE_ITEMS_SHEET_NAME, payload.name)
  };
}

function batchAddPracticeTargets_(payload) {
  assertTeacherAccess_(payload);
  return batchAddPracticeOptionsResponse_("targets", PRACTICE_TARGETS_SHEET_NAME, payload.names);
}

function batchAddPracticeItems_(payload) {
  assertTeacherAccess_(payload);
  return batchAddPracticeOptionsResponse_("items", PRACTICE_ITEMS_SHEET_NAME, payload.names);
}

function deletePracticeTarget_(payload) {
  assertTeacherAccess_(payload);
  deletePracticeOption_(PRACTICE_TARGETS_SHEET_NAME, payload.id);
  return { id: payload.id };
}

function deletePracticeItem_(payload) {
  assertTeacherAccess_(payload);
  deletePracticeOption_(PRACTICE_ITEMS_SHEET_NAME, payload.id);
  return { id: payload.id };
}

function updateLocationSettings_(payload) {
  assertTeacherAccess_(payload);

  const setting = buildLocationSettingsFromPayload_(payload);
  const table = readLocationSettingsTable_();
  const existing = table.rows.find((row) => row.setting.id === LOCATION_SETTING_ID);

  if (existing) {
    writeLocationSettingsRow_(table.sheet, existing.rowNumber, setting);
  } else {
    table.sheet.appendRow(LOCATION_SETTINGS_HEADERS.map((header) => cellValue_(setting[header])));
  }

  SpreadsheetApp.flush();

  return {
    location: publicLocationSettings_(setting)
  };
}

function listPracticeRecords_(payload) {
  assertTeacherAccess_(payload);
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
  assertTeacherAccess_(payload);
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
  assertTeacherAccess_(payload);
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

function assertWithinLocationRange_(payload) {
  const setting = readLocationSettings_();

  if (!isLocationRangeEnabled_(setting)) {
    return null;
  }

  const clientLocation = parseClientLocation_(payload.location);
  const distance = haversineDistanceMeters_(
    Number(setting.latitude),
    Number(setting.longitude),
    clientLocation.latitude,
    clientLocation.longitude
  );
  const roundedDistance = Math.round(distance);
  const radius = Number(setting.radiusMeters);

  if (roundedDistance > radius) {
    throw new Error(
      "目前位置距離「" +
        locationDisplayName_(setting) +
        "」約 " +
        roundedDistance +
        " 公尺，超出允許範圍 " +
        radius +
        " 公尺。"
    );
  }

  return {
    latitude: roundCoordinate_(clientLocation.latitude),
    longitude: roundCoordinate_(clientLocation.longitude),
    accuracyMeters: clientLocation.accuracyMeters,
    distanceMeters: roundedDistance
  };
}

function isLocationRangeEnabled_(setting) {
  return Boolean(
    setting &&
      setting.enabled &&
      setting.latitude !== "" &&
      setting.longitude !== "" &&
      setting.radiusMeters !== "" &&
      isFiniteNumber_(Number(setting.latitude)) &&
      isFiniteNumber_(Number(setting.longitude)) &&
      isFiniteNumber_(Number(setting.radiusMeters)) &&
      Number(setting.radiusMeters) > 0
  );
}

function parseClientLocation_(location) {
  if (!location || typeof location !== "object") {
    throw new Error("此操作需要取得目前定位，請允許瀏覽器定位後再試。");
  }

  return {
    latitude: parseRequiredNumber_(location.latitude, "定位緯度", -90, 90),
    longitude: parseRequiredNumber_(location.longitude, "定位經度", -180, 180),
    accuracyMeters: parseOptionalNonNegativeNumber_(location.accuracy, "定位精準度")
  };
}

function buildLocationSettingsFromPayload_(payload) {
  const enabled = parseBoolean_(payload.enabled);
  const latitude = parseOptionalCoordinate_(payload.latitude, "緯度", -90, 90);
  const longitude = parseOptionalCoordinate_(payload.longitude, "經度", -180, 180);
  const radius = parseOptionalRadius_(payload.radiusMeters);

  if (enabled && latitude === "") {
    throw new Error("啟用定位限制前，請設定緯度。");
  }

  if (enabled && longitude === "") {
    throw new Error("啟用定位限制前，請設定經度。");
  }

  if (enabled && radius === "") {
    throw new Error("啟用定位限制前，請設定範圍半徑。");
  }

  return {
    id: LOCATION_SETTING_ID,
    name: cleanLocationName_(payload.name),
    enabled,
    latitude,
    longitude,
    radiusMeters: radius === "" ? DEFAULT_LOCATION_RADIUS_METERS : radius,
    updatedAt: new Date().toISOString()
  };
}

function defaultLocationSettings_() {
  return {
    id: LOCATION_SETTING_ID,
    name: "",
    enabled: false,
    latitude: "",
    longitude: "",
    radiusMeters: DEFAULT_LOCATION_RADIUS_METERS,
    updatedAt: ""
  };
}

function publicLocationSettings_(setting) {
  const normalized = normalizeLocationSettings_(setting || defaultLocationSettings_());

  return {
    name: normalized.name,
    enabled: isLocationRangeEnabled_(normalized),
    latitude: normalized.latitude,
    longitude: normalized.longitude,
    radiusMeters: normalized.radiusMeters,
    updatedAt: normalized.updatedAt
  };
}

function cleanLocationName_(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function locationDisplayName_(setting) {
  return setting.name || "指定地點";
}

function parseBoolean_(value) {
  if (value === true) return true;
  return ["true", "1", "yes", "y", "啟用"].indexOf(String(value || "").trim().toLowerCase()) !== -1;
}

function parseOptionalCoordinate_(value, label, min, max) {
  if (value === "" || value === null || typeof value === "undefined") return "";
  return parseRequiredNumber_(value, label, min, max);
}

function parseOptionalRadius_(value) {
  if (value === "" || value === null || typeof value === "undefined") return "";
  const radius = Math.round(parseRequiredNumber_(value, "範圍半徑", MIN_LOCATION_RADIUS_METERS, MAX_LOCATION_RADIUS_METERS));

  if (radius < MIN_LOCATION_RADIUS_METERS || radius > MAX_LOCATION_RADIUS_METERS) {
    throw new Error("範圍半徑需介於 " + MIN_LOCATION_RADIUS_METERS + " 到 " + MAX_LOCATION_RADIUS_METERS + " 公尺。");
  }

  return radius;
}

function parseRequiredNumber_(value, label, min, max) {
  const number = Number(value);

  if (!isFiniteNumber_(number)) {
    throw new Error(label + "格式不正確。");
  }

  if (number < min || number > max) {
    throw new Error(label + "需介於 " + min + " 到 " + max + "。");
  }

  return number;
}

function parseOptionalNonNegativeNumber_(value, label) {
  if (value === "" || value === null || typeof value === "undefined") return "";
  const number = Number(value);

  if (!isFiniteNumber_(number) || number < 0) {
    throw new Error(label + "格式不正確。");
  }

  return Math.round(number);
}

function haversineDistanceMeters_(lat1, lon1, lat2, lon2) {
  const earthRadiusMeters = 6371000;
  const dLat = degreesToRadians_(lat2 - lat1);
  const dLon = degreesToRadians_(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(degreesToRadians_(lat1)) *
      Math.cos(degreesToRadians_(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function degreesToRadians_(degrees) {
  return (degrees * Math.PI) / 180;
}

function roundCoordinate_(value) {
  return Math.round(Number(value) * 1000000) / 1000000;
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
  return withWriteLock_(function () {
    return upsertStudentWithoutLock_(profile);
  });
}

function upsertStudentWithoutLock_(profile) {
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

  sheet.appendRow(HEADERS.map((header) => cellValue_(student[header])));
  return student;
}

function upsertTeacher_(profile) {
  return withWriteLock_(function () {
    return upsertTeacherWithoutLock_(profile);
  });
}

function upsertTeacherWithoutLock_(profile) {
  const sheet = ensureTeachersSheet_();
  const table = readTeachersTable_();
  const now = new Date().toISOString();
  const existing = table.rows.find((row) => row.teacher.lineUserId === profile.lineUserId);

  if (existing) {
    const teacher = existing.teacher;
    teacher.lineName = profile.lineName;
    teacher.linePictureUrl = profile.linePictureUrl;
    teacher.updatedAt = now;
    teacher.status = teacher.status || "pending";
    teacher.publicToken = teacher.publicToken || createToken_();

    writeTeacherRow_(sheet, existing.rowNumber, teacher);
    return teacher;
  }

  const teacher = {
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

  sheet.appendRow(TEACHER_HEADERS.map((header) => cellValue_(teacher[header])));
  return teacher;
}

function findStudentByUuid_(uuid) {
  const row = readTable_().rows.find((item) => item.student.uuid === uuid);
  return row ? row.student : null;
}

function findTeacherByUuid_(uuid) {
  const row = readTeachersTable_().rows.find((item) => item.teacher.uuid === uuid);
  return row ? row.teacher : null;
}

function readStudents_() {
  return readTable_().rows.map((row) => row.student);
}

function readTeachers_() {
  return readTeachersTable_().rows.map((row) => row.teacher);
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

function readTeachersTable_() {
  const sheet = ensureTeachersSheet_();
  const values = sheet.getDataRange().getValues();
  const headerRow = values[0] || TEACHER_HEADERS;
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
      const teacher = {};

      TEACHER_HEADERS.forEach((header) => {
        const cellIndex = headerIndex[header];
        teacher[header] = cellIndex >= 0 ? item.row[cellIndex] : "";
      });

      return {
        rowNumber: item.rowNumber,
        teacher: normalizeTeacher_(teacher)
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

function readLocationSettings_() {
  const table = readLocationSettingsTable_();
  const row = table.rows.find((item) => item.setting.id === LOCATION_SETTING_ID) || table.rows[0];
  return row ? row.setting : defaultLocationSettings_();
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

function readLocationSettingsTable_() {
  const sheet = ensureLocationSettingsSheet_();
  const values = sheet.getDataRange().getValues();
  const headerRow = values[0] || LOCATION_SETTINGS_HEADERS;
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
      const setting = {};

      LOCATION_SETTINGS_HEADERS.forEach((header) => {
        const cellIndex = headerIndex[header];
        setting[header] = cellIndex >= 0 ? item.row[cellIndex] : "";
      });

      return {
        rowNumber: item.rowNumber,
        setting: normalizeLocationSettings_(setting)
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

function normalizeTeacher_(teacher) {
  return {
    uuid: String(teacher.uuid || ""),
    lineUserId: String(teacher.lineUserId || ""),
    lineName: String(teacher.lineName || ""),
    linePictureUrl: String(teacher.linePictureUrl || ""),
    status: normalizeStatus_(teacher.status),
    createdAt: toIsoString_(teacher.createdAt),
    updatedAt: toIsoString_(teacher.updatedAt),
    approvedAt: toIsoString_(teacher.approvedAt),
    reviewNote: String(teacher.reviewNote || ""),
    publicToken: String(teacher.publicToken || "")
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
    updatedAt: toIsoString_(record.updatedAt),
    checkInLatitude: toOptionalNumber_(record.checkInLatitude),
    checkInLongitude: toOptionalNumber_(record.checkInLongitude),
    checkInAccuracyMeters: toOptionalNumber_(record.checkInAccuracyMeters),
    checkInDistanceMeters: toOptionalNumber_(record.checkInDistanceMeters),
    checkOutLatitude: toOptionalNumber_(record.checkOutLatitude),
    checkOutLongitude: toOptionalNumber_(record.checkOutLongitude),
    checkOutAccuracyMeters: toOptionalNumber_(record.checkOutAccuracyMeters),
    checkOutDistanceMeters: toOptionalNumber_(record.checkOutDistanceMeters)
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
    updatedAt: toIsoString_(record.updatedAt),
    startLatitude: toOptionalNumber_(record.startLatitude),
    startLongitude: toOptionalNumber_(record.startLongitude),
    startAccuracyMeters: toOptionalNumber_(record.startAccuracyMeters),
    startDistanceMeters: toOptionalNumber_(record.startDistanceMeters),
    endLatitude: toOptionalNumber_(record.endLatitude),
    endLongitude: toOptionalNumber_(record.endLongitude),
    endAccuracyMeters: toOptionalNumber_(record.endAccuracyMeters),
    endDistanceMeters: toOptionalNumber_(record.endDistanceMeters)
  };
}

function normalizeLocationSettings_(setting) {
  const enabledValue = String(setting.enabled || "").trim().toLowerCase();
  const radius = toOptionalNumber_(setting.radiusMeters);

  return {
    id: String(setting.id || LOCATION_SETTING_ID),
    name: cleanLocationName_(setting.name),
    enabled: ["true", "1", "yes", "y", "啟用"].indexOf(enabledValue) !== -1,
    latitude: toOptionalNumber_(setting.latitude),
    longitude: toOptionalNumber_(setting.longitude),
    radiusMeters: radius === "" ? DEFAULT_LOCATION_RADIUS_METERS : radius,
    updatedAt: toIsoString_(setting.updatedAt)
  };
}

function writeStudentRow_(sheet, rowNumber, student) {
  sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([HEADERS.map((header) => cellValue_(student[header]))]);
}

function writeTeacherRow_(sheet, rowNumber, teacher) {
  sheet
    .getRange(rowNumber, 1, 1, TEACHER_HEADERS.length)
    .setValues([TEACHER_HEADERS.map((header) => cellValue_(teacher[header]))]);
}

function writeAttendanceRow_(sheet, rowNumber, record) {
  sheet
    .getRange(rowNumber, 1, 1, ATTENDANCE_HEADERS.length)
    .setValues([ATTENDANCE_HEADERS.map((header) => cellValue_(record[header]))]);
}

function writePracticeRow_(sheet, rowNumber, record) {
  sheet
    .getRange(rowNumber, 1, 1, PRACTICE_RECORD_HEADERS.length)
    .setValues([PRACTICE_RECORD_HEADERS.map((header) => cellValue_(record[header]))]);
}

function writeLocationSettingsRow_(sheet, rowNumber, setting) {
  sheet
    .getRange(rowNumber, 1, 1, LOCATION_SETTINGS_HEADERS.length)
    .setValues([LOCATION_SETTINGS_HEADERS.map((header) => cellValue_(setting[header]))]);
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

function cleanPracticeOptionName_(value) {
  return String(value || "").trim();
}

function practiceOptionNamesFromPayload_(names) {
  const values = Array.isArray(names)
    ? names
    : String(names || "")
        .split(/[\n,，;；]+/);
  const seen = {};
  const cleanNames = [];

  values.forEach((value) => {
    const cleanName = cleanPracticeOptionName_(value);
    const key = cleanName.toLowerCase();

    if (!cleanName || seen[key]) return;

    seen[key] = true;
    cleanNames.push(cleanName);
  });

  return cleanNames;
}

function addPracticeOption_(sheetName, name) {
  const cleanName = cleanPracticeOptionName_(name);
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

  table.sheet.appendRow(PRACTICE_OPTION_HEADERS.map((header) => cellValue_(option[header])));
  return normalizePracticeOption_(option);
}

function batchAddPracticeOptionsResponse_(key, sheetName, names) {
  const result = batchAddPracticeOptions_(sheetName, names);
  const response = {
    skipped: result.skipped
  };
  response[key] = result.options;
  return response;
}

function batchAddPracticeOptions_(sheetName, names) {
  const cleanNames = practiceOptionNamesFromPayload_(names);
  if (!cleanNames.length) {
    throw new Error("請輸入名稱。");
  }

  const table = readPracticeOptionTable_(sheetName);
  const existing = {};
  const skipped = [];

  table.rows.forEach((row) => {
    existing[row.option.name.toLowerCase()] = true;
  });

  const now = new Date().toISOString();
  const options = [];

  cleanNames.forEach((name) => {
    const key = name.toLowerCase();

    if (name === PRACTICE_OTHER_OPTION_NAME || existing[key]) {
      skipped.push(name);
      return;
    }

    existing[key] = true;
    options.push({
      id: Utilities.getUuid(),
      name,
      enabled: true,
      createdAt: now,
      updatedAt: now
    });
  });

  if (options.length) {
    const rowStart = Math.max(table.sheet.getLastRow(), 1) + 1;
    const rows = options.map((option) => PRACTICE_OPTION_HEADERS.map((header) => cellValue_(option[header])));
    table.sheet
      .getRange(rowStart, 1, options.length, PRACTICE_OPTION_HEADERS.length)
      .setValues(rows);
  }

  return {
    options: options.map(normalizePracticeOption_),
    skipped
  };
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

function ensureTeachersSheet_() {
  return ensureSheetWithHeaders_(TEACHERS_SHEET_NAME, TEACHER_HEADERS);
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

function ensureLocationSettingsSheet_() {
  return ensureSheetWithHeaders_(LOCATION_SETTINGS_SHEET_NAME, LOCATION_SETTINGS_HEADERS);
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
  const required = ["LINE_CHANNEL_ID", "LINE_CHANNEL_SECRET"];
  const missing = required.filter((key) => !values[key]);

  if (missing.length) {
    throw new Error("Script Properties 尚未設定: " + missing.join(", "));
  }

  return values;
}

function assertTeacherAccess_(payload) {
  const teacher = validateTeacherSession_(payload);
  assertTeacherApproved_(teacher);
  return teacher;
}

function validateTeacherSession_(payload) {
  requireFields_(payload, ["teacherUuid", "teacherToken"]);

  const teacher = findTeacherByUuid_(payload.teacherUuid);
  if (!teacher || teacher.publicToken !== payload.teacherToken) {
    throw new Error("找不到師資或登入資訊已失效。");
  }

  return teacher;
}

function assertTeacherApproved_(teacher) {
  if (teacher.status !== "approved") {
    throw new Error("師資審核通過後才能使用師資系統。");
  }
}

function requireFields_(payload, fields) {
  fields.forEach((field) => {
    if (!payload[field]) {
      throw new Error("Missing field: " + field);
    }
  });
}

function publicTeacher_(teacher, includeToken) {
  const data = {
    uuid: teacher.uuid,
    lineUserId: teacher.lineUserId,
    lineName: teacher.lineName,
    linePictureUrl: teacher.linePictureUrl,
    status: teacher.status,
    createdAt: teacher.createdAt,
    updatedAt: teacher.updatedAt,
    approvedAt: teacher.approvedAt,
    reviewNote: teacher.reviewNote
  };

  if (includeToken) {
    data.publicToken = teacher.publicToken;
  }

  return data;
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
    data.locationRequirement = publicLocationSettings_(readLocationSettings_());
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
    updatedAt: record.updatedAt,
    checkInDistanceMeters: record.checkInDistanceMeters,
    checkInAccuracyMeters: record.checkInAccuracyMeters,
    checkOutDistanceMeters: record.checkOutDistanceMeters,
    checkOutAccuracyMeters: record.checkOutAccuracyMeters
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
    updatedAt: record.updatedAt,
    startDistanceMeters: record.startDistanceMeters,
    startAccuracyMeters: record.startAccuracyMeters,
    endDistanceMeters: record.endDistanceMeters,
    endAccuracyMeters: record.endAccuracyMeters
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

function toOptionalNumber_(value) {
  if (value === "" || value === null || typeof value === "undefined") return "";
  const number = Number(value);
  return isFiniteNumber_(number) ? number : "";
}

function isFiniteNumber_(value) {
  return typeof value === "number" && isFinite(value);
}

function cellValue_(value) {
  return value === null || typeof value === "undefined" ? "" : value;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
