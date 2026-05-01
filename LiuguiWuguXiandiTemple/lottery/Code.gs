const SHEET_NAME = 'LotteryUsers';
const HEADERS = ['uuid', 'lineName', 'lotteryNumber', 'createdAt', 'drawnAt', 'updatedAt'];
const MAX_DRAW_ATTEMPTS = 3000;

// Leave empty when this script is bound to the target Google Sheet.
const SPREADSHEET_ID = '';

// LINE Login Channel ID. This must match the channel prefix in script.js LIFF_ID.
const LINE_CHANNEL_ID = '2009806965';

function doGet() {
  initializeSheet_();
  return jsonResponse_({
    ok: true,
    message: 'Lottery GAS API is running.',
  });
}

function doPost(e) {
  try {
    initializeSheet_();
    var request = parseRequest_(e);
    var action = request.action;
    var payload = request.payload || {};

    if (action === 'syncUser') {
      return jsonResponse_({ ok: true, data: syncUser_(payload) });
    }

    if (action === 'drawNumber') {
      return jsonResponse_({ ok: true, data: drawNumber_(payload) });
    }

    throw new Error('不支援的操作類型');
  } catch (error) {
    return jsonResponse_({
      ok: false,
      message: error.message || String(error),
    });
  }
}

function syncUser_(payload) {
  var user = resolveLineUser_(payload);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheet_();
    var lookup = getUserLookup_(sheet);
    var now = new Date();
    var existing = lookup.byUuid[user.uuid];

    if (!existing) {
      appendUser_(sheet, {
        uuid: user.uuid,
        lineName: user.lineName,
        lotteryNumber: '',
        createdAt: now,
        drawnAt: '',
        updatedAt: now,
      });
      return buildResponseRecord_({
        uuid: user.uuid,
        lineName: user.lineName,
        lotteryNumber: '',
        createdAt: now,
        drawnAt: '',
        updatedAt: now,
      }, false);
    }

    updateUserName_(sheet, existing, user.lineName, now);
    existing.lineName = user.lineName;
    existing.updatedAt = now;
    return buildResponseRecord_(existing, false);
  } finally {
    lock.releaseLock();
  }
}

function drawNumber_(payload) {
  var user = resolveLineUser_(payload);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheet_();
    var lookup = getUserLookup_(sheet);
    var now = new Date();
    var record = lookup.byUuid[user.uuid];

    if (!record) {
      record = {
        uuid: user.uuid,
        lineName: user.lineName,
        lotteryNumber: '',
        createdAt: now,
        drawnAt: '',
        updatedAt: now,
      };
      record.rowNumber = appendUser_(sheet, record);
      lookup.usedNumbers = getUsedNumberSet_(sheet);
    } else if (record.lotteryNumber) {
      updateUserName_(sheet, record, user.lineName, now);
      record.lineName = user.lineName;
      record.updatedAt = now;
      return buildResponseRecord_(record, true);
    }

    var lotteryNumber = createUniqueLotteryNumber_(lookup.usedNumbers);
    record.lineName = user.lineName;
    record.lotteryNumber = lotteryNumber;
    record.drawnAt = now;
    record.updatedAt = now;

    writeDrawResult_(sheet, record);
    return buildResponseRecord_(record, false);
  } finally {
    lock.releaseLock();
  }
}

function resolveLineUser_(payload) {
  var fallbackUuid = cleanText_(payload.uuid);
  var fallbackName = cleanText_(payload.lineName) || 'LINE 使用者';
  var channelId = cleanText_(LINE_CHANNEL_ID);

  if (channelId) {
    if (!payload.idToken) {
      throw new Error('缺少 LINE idToken，請確認 LIFF App 已啟用 openid scope 後重新登入。');
    }

    var verified = verifyLineIdToken_(payload.idToken, fallbackUuid);
    return {
      uuid: cleanText_(verified.sub),
      lineName: cleanText_(verified.name) || fallbackName,
    };
  }

  if (!fallbackUuid) {
    throw new Error('缺少 LINE UUID');
  }

  return {
    uuid: fallbackUuid,
    lineName: fallbackName,
  };
}

function verifyLineIdToken_(idToken, expectedUserId) {
  var formPayload = {
    id_token: idToken,
    client_id: cleanText_(LINE_CHANNEL_ID),
  };
  if (expectedUserId) {
    formPayload.user_id = expectedUserId;
  }

  var response = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: formPayload,
    muteHttpExceptions: true,
  });
  var body = parseJsonSafely_(response.getContentText());
  var errorDetail = cleanText_(body.error_description) || cleanText_(body.error);

  if (response.getResponseCode() !== 200 || !body.sub) {
    throw new Error('LINE 登入驗證失敗' + (errorDetail ? '：' + errorDetail : ''));
  }

  if (cleanText_(body.aud) && cleanText_(body.aud) !== cleanText_(LINE_CHANNEL_ID)) {
    throw new Error('LINE 登入驗證失敗：Channel ID 不一致');
  }

  return body;
}

function createUniqueLotteryNumber_(usedNumbers) {
  for (var i = 0; i < MAX_DRAW_ATTEMPTS; i += 1) {
    var number = String(100000 + Math.floor(Math.random() * 900000));
    if (!usedNumbers[number]) {
      return number;
    }
  }

  throw new Error('可用摸彩號碼不足，請擴充號碼範圍');
}

function initializeSheet_() {
  var sheet = getSheet_();
  ensureHeaders_(sheet);
  sheet.getRange('A:A').setNumberFormat('@');
  sheet.getRange('C:C').setNumberFormat('@');
}

function getSheet_() {
  var spreadsheet = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('請將此 GAS 綁定到 Google 試算表，或填入 SPREADSHEET_ID');
  }

  var sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  return sheet;
}

function ensureHeaders_(sheet) {
  var lastColumn = Math.max(sheet.getLastColumn(), HEADERS.length);
  var headerRange = sheet.getRange(1, 1, 1, lastColumn);
  var currentHeaders = headerRange.getValues()[0].map(function(value) {
    return cleanText_(value);
  });
  var hasAnyHeader = currentHeaders.some(function(value) {
    return Boolean(value);
  });

  if (!hasAnyHeader) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }

  var nextColumn = currentHeaders.length + 1;
  HEADERS.forEach(function(header) {
    if (currentHeaders.indexOf(header) === -1) {
      sheet.getRange(1, nextColumn).setValue(header);
      currentHeaders.push(header);
      nextColumn += 1;
    }
  });
  sheet.setFrozenRows(1);
}

function getUserLookup_(sheet) {
  var records = readRecords_(sheet);
  var byUuid = {};
  var usedNumbers = {};

  records.forEach(function(record) {
    if (record.uuid) {
      byUuid[record.uuid] = record;
    }
    if (record.lotteryNumber) {
      usedNumbers[String(record.lotteryNumber)] = true;
    }
  });

  return {
    byUuid: byUuid,
    usedNumbers: usedNumbers,
  };
}

function getUsedNumberSet_(sheet) {
  var lookup = getUserLookup_(sheet);
  return lookup.usedNumbers;
}

function readRecords_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headerMap = getHeaderMap_(values[0]);
  var records = [];

  for (var i = 1; i < values.length; i += 1) {
    var row = values[i];
    var isEmpty = row.every(function(value) {
      return cleanText_(value) === '';
    });
    if (isEmpty) continue;

    var record = {};
    HEADERS.forEach(function(header) {
      record[header] = row[headerMap[header]];
    });
    record.uuid = cleanText_(record.uuid);
    record.lineName = cleanText_(record.lineName);
    record.lotteryNumber = cleanText_(record.lotteryNumber);
    record.rowNumber = i + 1;
    records.push(record);
  }

  return records;
}

function appendUser_(sheet, record) {
  var row = HEADERS.map(function(header) {
    return record[header] || '';
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function updateUserName_(sheet, record, lineName, updatedAt) {
  var headerMap = getHeaderMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  sheet.getRange(record.rowNumber, headerMap.lineName + 1).setValue(lineName);
  sheet.getRange(record.rowNumber, headerMap.updatedAt + 1).setValue(updatedAt);
}

function writeDrawResult_(sheet, record) {
  var headerMap = getHeaderMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  sheet.getRange(record.rowNumber, headerMap.lineName + 1).setValue(record.lineName);
  sheet.getRange(record.rowNumber, headerMap.lotteryNumber + 1).setValue(record.lotteryNumber);
  sheet.getRange(record.rowNumber, headerMap.drawnAt + 1).setValue(record.drawnAt);
  sheet.getRange(record.rowNumber, headerMap.updatedAt + 1).setValue(record.updatedAt);
}

function getHeaderMap_(headers) {
  var map = {};
  headers.forEach(function(header, index) {
    map[cleanText_(header)] = index;
  });

  HEADERS.forEach(function(header) {
    if (typeof map[header] !== 'number') {
      throw new Error('缺少欄位：' + header);
    }
  });

  return map;
}

function buildResponseRecord_(record, alreadyDrawn) {
  return {
    uuid: cleanText_(record.uuid),
    lineName: cleanText_(record.lineName),
    lotteryNumber: cleanText_(record.lotteryNumber),
    hasDrawn: Boolean(cleanText_(record.lotteryNumber)),
    alreadyDrawn: Boolean(alreadyDrawn),
    createdAt: formatDate_(record.createdAt),
    drawnAt: formatDate_(record.drawnAt),
    updatedAt: formatDate_(record.updatedAt),
  };
}

function parseRequest_(e) {
  if (e && e.postData && e.postData.contents) {
    return JSON.parse(e.postData.contents);
  }

  return {
    action: e && e.parameter ? e.parameter.action : '',
    payload: e && e.parameter ? e.parameter : {},
  };
}

function parseJsonSafely_(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (error) {
    return {};
  }
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function cleanText_(value) {
  if (value === null || typeof value === 'undefined') return '';
  return String(value).trim();
}

function formatDate_(value) {
  if (!value) return '';
  var date = Object.prototype.toString.call(value) === '[object Date]' ? value : new Date(value);
  if (isNaN(date.getTime())) return cleanText_(value);
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}
