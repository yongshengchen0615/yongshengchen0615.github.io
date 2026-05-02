const SHEET_NAME = 'LotteryUsers';
const HEADERS = ['uuid', 'lineName', 'lotteryNumber', 'createdAt', 'drawnAt', 'updatedAt', 'winnerAt', 'winnerPrize'];
const MAX_DRAW_ATTEMPTS = 3000;
const DEFAULT_WINNER_LIMIT = 20;

// Leave empty when this script is bound to the target Google Sheet.
const SPREADSHEET_ID = '';

// LINE Login Channel ID. This must match the channel prefix in script.js LIFF_ID.
const LINE_CHANNEL_ID = '2009806965';

// Optional admin token for winner-drawing pages. Leave empty to skip this check.
const DRAW_ADMIN_TOKEN = '';

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

    if (action === 'drawWinner') {
      return jsonResponse_({ ok: true, data: drawWinner_(payload) });
    }

    if (action === 'getWinnerBoard') {
      return jsonResponse_({ ok: true, data: getWinnerBoard_(payload) });
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
        winnerAt: '',
        winnerPrize: '',
      });
      return buildResponseRecord_({
        uuid: user.uuid,
        lineName: user.lineName,
        lotteryNumber: '',
        createdAt: now,
        drawnAt: '',
        updatedAt: now,
        winnerAt: '',
        winnerPrize: '',
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
        winnerAt: '',
        winnerPrize: '',
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

function drawWinner_(payload) {
  assertAdmin_(payload);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheet_();
    var records = readRecords_(sheet);
    var eligibleRecords = getEligibleWinnerRecords_(records);

    if (!eligibleRecords.length) {
      throw new Error('目前沒有可抽取的名單，請確認已有使用者抽取摸彩號碼，且尚未全數中獎。');
    }

    var now = new Date();
    var winner = eligibleRecords[Math.floor(Math.random() * eligibleRecords.length)];
    winner.winnerAt = now;
    winner.winnerPrize = cleanText_(payload.prizeName) || '現場抽獎';
    winner.updatedAt = now;

    writeWinnerResult_(sheet, winner);
    return buildWinnerBoard_(sheet, buildWinnerRecord_(winner), payload);
  } finally {
    lock.releaseLock();
  }
}

function getWinnerBoard_(payload) {
  assertAdmin_(payload);
  return buildWinnerBoard_(getSheet_(), null, payload);
}

function assertAdmin_(payload) {
  var expectedToken = cleanText_(DRAW_ADMIN_TOKEN);
  if (expectedToken && cleanText_(payload.adminToken) !== expectedToken) {
    throw new Error('管理密鑰不正確');
  }
}

function getEligibleWinnerRecords_(records) {
  return records.filter(function(record) {
    return Boolean(cleanText_(record.lotteryNumber)) && !cleanText_(record.winnerAt);
  });
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
  sheet.getRange('D:G').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange('H:H').setNumberFormat('@');
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
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
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

  HEADERS.forEach(function(header) {
    if (currentHeaders.indexOf(header) === -1) {
      var blankIndex = currentHeaders.indexOf('');
      var column = blankIndex === -1 ? currentHeaders.length + 1 : blankIndex + 1;
      sheet.getRange(1, column).setValue(header);

      if (blankIndex === -1) {
        currentHeaders.push(header);
      } else {
        currentHeaders[blankIndex] = header;
      }
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
    record.winnerPrize = cleanText_(record.winnerPrize);
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

function writeWinnerResult_(sheet, record) {
  var headerMap = getHeaderMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  sheet.getRange(record.rowNumber, headerMap.winnerAt + 1).setValue(record.winnerAt);
  sheet.getRange(record.rowNumber, headerMap.winnerPrize + 1).setValue(record.winnerPrize);
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
    hasWon: Boolean(cleanText_(record.winnerAt)),
    createdAt: formatDate_(record.createdAt),
    drawnAt: formatDate_(record.drawnAt),
    updatedAt: formatDate_(record.updatedAt),
    winnerAt: formatDate_(record.winnerAt),
    winnerPrize: cleanText_(record.winnerPrize),
  };
}

function buildWinnerBoard_(sheet, currentWinner, payload) {
  var records = readRecords_(sheet);
  var winners = records.filter(function(record) {
    return Boolean(cleanText_(record.winnerAt));
  }).sort(function(a, b) {
    return getDateTime_(b.winnerAt) - getDateTime_(a.winnerAt);
  });
  var eligibleRecords = getEligibleWinnerRecords_(records);
  var limit = parsePositiveInteger_(payload.limit, DEFAULT_WINNER_LIMIT);

  return {
    currentWinner: currentWinner,
    stats: {
      totalUsers: records.length,
      drawnNumbers: records.filter(function(record) {
        return Boolean(cleanText_(record.lotteryNumber));
      }).length,
      winners: winners.length,
      remaining: eligibleRecords.length,
    },
    winners: winners.slice(0, limit).map(buildWinnerRecord_),
  };
}

function buildWinnerRecord_(record) {
  return {
    uuid: cleanText_(record.uuid),
    lineName: cleanText_(record.lineName),
    lotteryNumber: cleanText_(record.lotteryNumber),
    winnerAt: formatDate_(record.winnerAt),
    winnerPrize: cleanText_(record.winnerPrize),
    drawnAt: formatDate_(record.drawnAt),
  };
}

function parsePositiveInteger_(value, fallback) {
  var number = Number(value);
  if (!isFinite(number) || number < 1) return fallback;
  return Math.floor(number);
}

function getDateTime_(value) {
  if (!value) return 0;
  var date = Object.prototype.toString.call(value) === '[object Date]' ? value : new Date(value);
  if (isNaN(date.getTime())) return 0;
  return date.getTime();
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
