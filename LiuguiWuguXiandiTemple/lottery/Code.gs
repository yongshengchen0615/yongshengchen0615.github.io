const SHEET_NAME = 'LotteryUsers';
const PRIZE_SHEET_NAME = 'LotteryPrizes';
const HEADERS = ['uuid', 'lineName', 'lotteryNumber', 'createdAt', 'drawnAt', 'updatedAt', 'winnerAt', 'winnerPrize', 'eligiblePrizes', 'guaranteedPrize'];
const PRIZE_HEADERS = ['prizeName', 'winnerCount', 'createdAt', 'updatedAt'];
const MAX_DRAW_ATTEMPTS = 3000;
const DEFAULT_WINNER_LIMIT = 20;

// Leave empty when this script is bound to the target Google Sheet.
const SPREADSHEET_ID = '';

// LINE Login Channel ID. This must match the channel prefix in client/script.js LIFF_ID.
const LINE_CHANNEL_ID = '2009806965';

// LINE Messaging API channel access token. Prefer setting Script Property LINE_CHANNEL_ACCESS_TOKEN.
const LINE_CHANNEL_ACCESS_TOKEN = '';
const LINE_CHANNEL_ACCESS_TOKEN_PROPERTY = 'LINE_CHANNEL_ACCESS_TOKEN';
const LINE_PUSH_MESSAGE_URL = 'https://api.line.me/v2/bot/message/push';

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

    if (action === 'getAdminBoard') {
      return jsonResponse_({ ok: true, data: getAdminBoard_(payload) });
    }

    if (action === 'setPrizeConfig') {
      return jsonResponse_({ ok: true, data: setPrizeConfig_(payload) });
    }

    if (action === 'deletePrizeConfig') {
      return jsonResponse_({ ok: true, data: deletePrizeConfig_(payload) });
    }

    if (action === 'setGuaranteedPrize') {
      return jsonResponse_({ ok: true, data: setGuaranteedPrize_(payload) });
    }

    if (action === 'clearGuaranteedPrize') {
      return jsonResponse_({ ok: true, data: clearGuaranteedPrize_(payload) });
    }

    if (action === 'updateGuaranteedPrizes') {
      return jsonResponse_({ ok: true, data: updateGuaranteedPrizes_(payload) });
    }

    if (action === 'deleteUsers') {
      return jsonResponse_({ ok: true, data: deleteUsers_(payload) });
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
        eligiblePrizes: '',
        guaranteedPrize: '',
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
        eligiblePrizes: '',
        guaranteedPrize: '',
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
        eligiblePrizes: '',
        guaranteedPrize: '',
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
  var board = null;
  var currentWinner = null;

  try {
    var sheet = getSheet_();
    var prizeSheet = getPrizeSheet_();
    var records = readRecords_(sheet);
    var prizeName = getRequestedPrizeName_(prizeSheet, payload);
    var prizeConfig = getPrizeConfigByName_(prizeSheet, prizeName);
    if (!prizeConfig) {
      throw new Error('請先在管理後台設定「' + prizeName + '」的中獎數量');
    }

    var winnerCount = getPrizeWinnerCount_(records, prizeName);
    if (winnerCount >= prizeConfig.winnerCount) {
      throw new Error('「' + prizeName + '」已達設定中獎數量');
    }

    var remainingSlots = prizeConfig.winnerCount - winnerCount;
    var eligibleRecords = getDrawableWinnerRecords_(records, prizeName, remainingSlots);

    if (!eligibleRecords.length) {
      throw new Error('目前沒有符合「' + prizeName + '」的可抽取名單；若有保證中獎者，請確認他們已領取摸彩號碼。');
    }

    var now = new Date();
    var winner = eligibleRecords[Math.floor(Math.random() * eligibleRecords.length)];
    winner.winnerAt = now;
    winner.winnerPrize = prizeName;
    winner.updatedAt = now;

    writeWinnerResult_(sheet, winner);
    currentWinner = buildWinnerRecord_(winner);
    board = buildWinnerBoard_(sheet, currentWinner, payload);
  } finally {
    lock.releaseLock();
  }

  notifyWinnerByLine_(currentWinner);
  return board;
}

function getWinnerBoard_(payload) {
  assertAdmin_(payload);
  return buildWinnerBoard_(getSheet_(), null, payload);
}

function getAdminBoard_(payload) {
  assertAdmin_(payload);
  return buildAdminBoard_(getSheet_(), getPrizeSheet_(), {
    selectedUuids: normalizeUuidList_(payload.selectedUuids),
  });
}

function setPrizeConfig_(payload) {
  assertAdmin_(payload);
  var prizeName = cleanText_(payload.prizeName);
  var originalPrizeName = cleanText_(payload.originalPrizeName) || prizeName;
  if (!prizeName) {
    throw new Error('請輸入獎項名稱');
  }

  var winnerCount = parsePositiveInteger_(payload.winnerCount, 0);
  if (winnerCount < 1) {
    throw new Error('中獎數量必須大於 0');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var userSheet = getSheet_();
    var prizeSheet = getPrizeSheet_();
    var records = readRecords_(userSheet);
    assertPrizeCapacity_(records, originalPrizeName, winnerCount);

    var now = new Date();
    var prizes = readPrizeConfigs_(prizeSheet);
    var existing = null;
    var duplicate = null;
    prizes.forEach(function(prize) {
      if (prize.prizeName === originalPrizeName) {
        existing = prize;
      }
      if (prize.prizeName === prizeName && prize.prizeName !== originalPrizeName) {
        duplicate = prize;
      }
    });

    if (duplicate) {
      throw new Error('獎項名稱已存在：' + prizeName);
    }

    if (existing) {
      existing.prizeName = prizeName;
      existing.winnerCount = winnerCount;
      existing.updatedAt = now;
      writePrizeConfig_(prizeSheet, existing);
    } else {
      appendPrizeConfig_(prizeSheet, {
        prizeName: prizeName,
        winnerCount: winnerCount,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (originalPrizeName !== prizeName) {
      renamePrizeInRecords_(userSheet, records, originalPrizeName, prizeName, now);
    }

    return buildAdminBoard_(userSheet, prizeSheet, {
      message: '已設定「' + prizeName + '」中獎數量為 ' + winnerCount + ' 名',
    });
  } finally {
    lock.releaseLock();
  }
}

function deletePrizeConfig_(payload) {
  assertAdmin_(payload);
  var prizeName = cleanText_(payload.prizeName);
  if (!prizeName) {
    throw new Error('請輸入要刪除的獎項名稱');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var userSheet = getSheet_();
    var prizeSheet = getPrizeSheet_();
    var records = readRecords_(userSheet);
    if (getPrizeWinnerCount_(records, prizeName) > 0) {
      throw new Error('「' + prizeName + '」已有中獎紀錄，不能刪除');
    }

    var prize = getPrizeConfigByName_(prizeSheet, prizeName);
    if (!prize) {
      throw new Error('找不到獎項：' + prizeName);
    }

    prizeSheet.deleteRow(prize.rowNumber);
    clearGuaranteedPrizeByName_(userSheet, records, prizeName, new Date());

    return buildAdminBoard_(userSheet, prizeSheet, {
      message: '已刪除獎項「' + prizeName + '」',
    });
  } finally {
    lock.releaseLock();
  }
}

function setGuaranteedPrize_(payload) {
  assertAdmin_(payload);
  var prizeName = cleanText_(payload.prizeName);
  if (!prizeName) {
    throw new Error('請輸入保證中獎獎項');
  }

  var selectedUuids = normalizeUuidList_(payload.selectedUuids);
  if (!selectedUuids.length) {
    throw new Error('請至少勾選一位保證中獎使用者');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var userSheet = getSheet_();
    var prizeSheet = getPrizeSheet_();
    var prizeConfig = getPrizeConfigByName_(prizeSheet, prizeName);
    if (!prizeConfig) {
      throw new Error('請先設定「' + prizeName + '」的中獎數量');
    }

    var records = readRecords_(userSheet);
    var targetRecords = getSelectedRecords_(records, selectedUuids);
    targetRecords.forEach(function(record) {
      if (cleanText_(record.winnerAt) && cleanText_(record.winnerPrize) !== prizeName) {
        throw new Error(record.lineName + ' 已中過其他獎項，不能設定為「' + prizeName + '」保證中獎');
      }
    });

    var now = new Date();
    targetRecords.forEach(function(record) {
      record.guaranteedPrize = prizeName;
      record.updatedAt = now;
    });
    assertGuaranteedCapacity_(records, prizeName, prizeConfig.winnerCount, targetRecords);

    targetRecords.forEach(function(record) {
      writeGuaranteedPrize_(userSheet, record);
    });

    return buildAdminBoard_(userSheet, prizeSheet, {
      selectedUuids: selectedUuids,
      message: '已設定 ' + targetRecords.length + ' 位使用者保證中「' + prizeName + '」',
    });
  } finally {
    lock.releaseLock();
  }
}

function clearGuaranteedPrize_(payload) {
  assertAdmin_(payload);
  var selectedUuids = normalizeUuidList_(payload.selectedUuids);
  if (!selectedUuids.length) {
    throw new Error('請至少勾選一位要清除保證中獎的使用者');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var userSheet = getSheet_();
    var prizeSheet = getPrizeSheet_();
    var records = readRecords_(userSheet);
    var targetRecords = getSelectedRecords_(records, selectedUuids);
    var now = new Date();

    targetRecords.forEach(function(record) {
      record.guaranteedPrize = '';
      record.updatedAt = now;
      writeGuaranteedPrize_(userSheet, record);
    });

    return buildAdminBoard_(userSheet, prizeSheet, {
      selectedUuids: selectedUuids,
      message: '已清除 ' + targetRecords.length + ' 位使用者的保證中獎設定',
    });
  } finally {
    lock.releaseLock();
  }
}

function updateGuaranteedPrizes_(payload) {
  assertAdmin_(payload);
  var guaranteeChanges = normalizeGuaranteedPrizeChanges_(payload.guaranteeChanges);
  if (!guaranteeChanges.length) {
    throw new Error('沒有需要儲存的保證中獎變更');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var userSheet = getSheet_();
    var prizeSheet = getPrizeSheet_();
    var records = readRecords_(userSheet);
    var prizes = readPrizeConfigs_(prizeSheet);
    var prizeMap = {};
    prizes.forEach(function(prize) {
      prizeMap[prize.prizeName] = prize;
    });

    var recordMap = {};
    records.forEach(function(record) {
      recordMap[record.uuid] = record;
    });

    var changedPrizeMap = {};
    var targetRecords = [];
    var now = new Date();

    guaranteeChanges.forEach(function(change) {
      var record = recordMap[change.uuid];
      if (!record) {
        throw new Error('找不到勾選的使用者：' + change.uuid);
      }

      if (change.prizeName && !prizeMap[change.prizeName]) {
        throw new Error('請先設定「' + change.prizeName + '」的中獎數量');
      }

      if (
        cleanText_(record.winnerAt) &&
        change.prizeName &&
        cleanText_(record.winnerPrize) !== change.prizeName
      ) {
        throw new Error(record.lineName + ' 已中過其他獎項，不能設定為「' + change.prizeName + '」保證中獎');
      }

      if (cleanText_(record.guaranteedPrize)) {
        changedPrizeMap[cleanText_(record.guaranteedPrize)] = true;
      }
      if (change.prizeName) {
        changedPrizeMap[change.prizeName] = true;
      }

      record.guaranteedPrize = change.prizeName;
      record.updatedAt = now;
      targetRecords.push(record);
    });

    Object.keys(changedPrizeMap).forEach(function(prizeName) {
      var prizeConfig = prizeMap[prizeName];
      if (prizeConfig) {
        assertGuaranteedCapacity_(records, prizeName, prizeConfig.winnerCount);
      }
    });

    targetRecords.forEach(function(record) {
      writeGuaranteedPrize_(userSheet, record);
    });

    return buildAdminBoard_(userSheet, prizeSheet, {
      selectedUuids: guaranteeChanges.map(function(change) {
        return change.uuid;
      }),
      message: '已儲存 ' + targetRecords.length + ' 筆保證中獎變更',
    });
  } finally {
    lock.releaseLock();
  }
}

function deleteUsers_(payload) {
  assertAdmin_(payload);
  var selectedUuids = normalizeUuidList_(payload.selectedUuids);
  if (!selectedUuids.length) {
    throw new Error('請至少勾選一位要刪除的使用者');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var userSheet = getSheet_();
    var prizeSheet = getPrizeSheet_();
    var records = readRecords_(userSheet);
    var targetRecords = getSelectedRecords_(records, selectedUuids);
    var rowNumbers = targetRecords.map(function(record) {
      return record.rowNumber;
    }).sort(function(a, b) {
      return b - a;
    });

    rowNumbers.forEach(function(rowNumber) {
      userSheet.deleteRow(rowNumber);
    });

    return buildAdminBoard_(userSheet, prizeSheet, {
      message: '已刪除 ' + targetRecords.length + ' 位使用者',
    });
  } finally {
    lock.releaseLock();
  }
}

function assertAdmin_(payload) {
  var expectedToken = cleanText_(DRAW_ADMIN_TOKEN);
  if (expectedToken && cleanText_(payload.adminToken) !== expectedToken) {
    throw new Error('管理密鑰不正確');
  }
}

function getEligibleWinnerRecords_(records, prizeName) {
  var targetPrize = cleanText_(prizeName);
  return records.filter(function(record) {
    if (!cleanText_(record.lotteryNumber) || cleanText_(record.winnerAt)) return false;
    if (!targetPrize) return true;

    var prizes = parsePrizeList_(record.eligiblePrizes);
    return !prizes.length || prizes.indexOf(targetPrize) !== -1;
  });
}

function getDrawableWinnerRecords_(records, prizeName, remainingSlots) {
  var pendingGuaranteedRecords = records.filter(function(record) {
    return !cleanText_(record.winnerAt) &&
      cleanText_(record.guaranteedPrize) === prizeName;
  });
  var readyGuaranteedRecords = pendingGuaranteedRecords.filter(function(record) {
    return cleanText_(record.lotteryNumber) &&
      cleanText_(record.guaranteedPrize) === prizeName;
  });

  if (readyGuaranteedRecords.length) {
    return readyGuaranteedRecords;
  }

  if (pendingGuaranteedRecords.length >= remainingSlots) {
    return [];
  }

  return records.filter(function(record) {
    return cleanText_(record.lotteryNumber) &&
      !cleanText_(record.winnerAt) &&
      !cleanText_(record.guaranteedPrize);
  });
}

function getPrizeWinnerCount_(records, prizeName) {
  return records.filter(function(record) {
    return cleanText_(record.winnerPrize) === prizeName;
  }).length;
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

function notifyWinnerByLine_(winner) {
  if (!winner || !cleanText_(winner.uuid) || !cleanText_(winner.winnerPrize)) return;

  var accessToken = getLineChannelAccessToken_();
  if (!accessToken) {
    Logger.log('LINE push skipped: missing Script Property ' + LINE_CHANNEL_ACCESS_TOKEN_PROPERTY);
    return;
  }

  var response;
  try {
    response = UrlFetchApp.fetch(LINE_PUSH_MESSAGE_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + accessToken,
      },
      payload: JSON.stringify({
        to: cleanText_(winner.uuid),
        messages: [{
          type: 'text',
          text: buildWinnerLineMessage_(winner),
        }],
      }),
      muteHttpExceptions: true,
    });
  } catch (error) {
    Logger.log('LINE push failed: ' + (error.message || String(error)));
    return;
  }

  var statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) {
    Logger.log('LINE push failed with HTTP ' + statusCode + ': ' + response.getContentText());
  }
}

function getLineChannelAccessToken_() {
  return cleanText_(LINE_CHANNEL_ACCESS_TOKEN) ||
    cleanText_(PropertiesService.getScriptProperties().getProperty(LINE_CHANNEL_ACCESS_TOKEN_PROPERTY));
}

function buildWinnerLineMessage_(winner) {
  var lineName = cleanText_(winner.lineName) || '貴賓';
  var lotteryNumber = cleanText_(winner.lotteryNumber) || '------';
  var winnerPrize = cleanText_(winner.winnerPrize) || '現場抽獎';
  var winnerAt = cleanText_(winner.winnerAt);
  var lines = [
    '六龜帝安宮摸彩中獎通知',
    '',
    '恭喜 ' + lineName + ' 中獎！',
    '摸彩號碼：' + lotteryNumber,
    '中獎獎項：' + winnerPrize,
  ];

  if (winnerAt) {
    lines.push('中獎時間：' + winnerAt);
  }

  lines.push('', '請依現場公告或工作人員指示領獎。');
  return lines.join('\n');
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
  sheet.getRange('I:I').setNumberFormat('@');
  sheet.getRange('J:J').setNumberFormat('@');

  var prizeSheet = getPrizeSheet_();
  ensurePrizeHeaders_(prizeSheet);
  prizeSheet.getRange('A:A').setNumberFormat('@');
  prizeSheet.getRange('B:B').setNumberFormat('0');
  prizeSheet.getRange('C:D').setNumberFormat('yyyy-mm-dd hh:mm:ss');
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

function getPrizeSheet_() {
  var spreadsheet = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('請將此 GAS 綁定到 Google 試算表，或填入 SPREADSHEET_ID');
  }

  var sheet = spreadsheet.getSheetByName(PRIZE_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PRIZE_SHEET_NAME);
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

function ensurePrizeHeaders_(sheet) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headerRange = sheet.getRange(1, 1, 1, lastColumn);
  var currentHeaders = headerRange.getValues()[0].map(function(value) {
    return cleanText_(value);
  });
  var hasAnyHeader = currentHeaders.some(function(value) {
    return Boolean(value);
  });

  if (!hasAnyHeader) {
    sheet.getRange(1, 1, 1, PRIZE_HEADERS.length).setValues([PRIZE_HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }

  PRIZE_HEADERS.forEach(function(header) {
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
    record.eligiblePrizes = serializePrizeList_(parsePrizeList_(record.eligiblePrizes));
    record.guaranteedPrize = cleanText_(record.guaranteedPrize);
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

function writePrizeEligibility_(sheet, record) {
  var headerMap = getHeaderMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  sheet.getRange(record.rowNumber, headerMap.eligiblePrizes + 1).setValue(record.eligiblePrizes);
  sheet.getRange(record.rowNumber, headerMap.updatedAt + 1).setValue(record.updatedAt);
}

function writeGuaranteedPrize_(sheet, record) {
  var headerMap = getHeaderMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  sheet.getRange(record.rowNumber, headerMap.guaranteedPrize + 1).setValue(record.guaranteedPrize);
  sheet.getRange(record.rowNumber, headerMap.updatedAt + 1).setValue(record.updatedAt);
}

function writePrizeNameFields_(sheet, record) {
  var headerMap = getHeaderMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  sheet.getRange(record.rowNumber, headerMap.winnerPrize + 1).setValue(record.winnerPrize);
  sheet.getRange(record.rowNumber, headerMap.guaranteedPrize + 1).setValue(record.guaranteedPrize);
  sheet.getRange(record.rowNumber, headerMap.updatedAt + 1).setValue(record.updatedAt);
}

function appendPrizeConfig_(sheet, prize) {
  var row = PRIZE_HEADERS.map(function(header) {
    return prize[header] || '';
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function writePrizeConfig_(sheet, prize) {
  var headerMap = getPrizeHeaderMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  sheet.getRange(prize.rowNumber, headerMap.prizeName + 1).setValue(prize.prizeName);
  sheet.getRange(prize.rowNumber, headerMap.winnerCount + 1).setValue(prize.winnerCount);
  sheet.getRange(prize.rowNumber, headerMap.updatedAt + 1).setValue(prize.updatedAt);
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

function getPrizeHeaderMap_(headers) {
  var map = {};
  headers.forEach(function(header, index) {
    map[cleanText_(header)] = index;
  });

  PRIZE_HEADERS.forEach(function(header) {
    if (typeof map[header] !== 'number') {
      throw new Error('缺少獎項欄位：' + header);
    }
  });

  return map;
}

function readPrizeConfigs_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headerMap = getPrizeHeaderMap_(values[0]);
  var prizes = [];

  for (var i = 1; i < values.length; i += 1) {
    var row = values[i];
    var isEmpty = row.every(function(value) {
      return cleanText_(value) === '';
    });
    if (isEmpty) continue;

    var prize = {};
    PRIZE_HEADERS.forEach(function(header) {
      prize[header] = row[headerMap[header]];
    });
    prize.prizeName = cleanText_(prize.prizeName);
    prize.winnerCount = parsePositiveInteger_(prize.winnerCount, 0);
    prize.rowNumber = i + 1;

    if (prize.prizeName && prize.winnerCount > 0) {
      prizes.push(prize);
    }
  }

  return prizes;
}

function getPrizeConfigByName_(sheet, prizeName) {
  var targetPrize = cleanText_(prizeName);
  var found = null;
  readPrizeConfigs_(sheet).forEach(function(prize) {
    if (prize.prizeName === targetPrize) {
      found = prize;
    }
  });
  return found;
}

function getRequestedPrizeName_(prizeSheet, payload) {
  var prizeName = cleanText_(payload.prizeName);
  if (prizeName) return prizeName;

  var prizes = readPrizeConfigs_(prizeSheet);
  if (prizes.length) {
    return prizes[0].prizeName;
  }

  return '現場抽獎';
}

function buildResponseRecord_(record, alreadyDrawn) {
  return {
    uuid: cleanText_(record.uuid),
    lineName: cleanText_(record.lineName),
    lotteryNumber: cleanText_(record.lotteryNumber),
    hasDrawn: Boolean(cleanText_(record.lotteryNumber)),
    alreadyDrawn: Boolean(alreadyDrawn),
    hasWon: Boolean(cleanText_(record.winnerAt) || cleanText_(record.winnerPrize)),
    createdAt: formatDate_(record.createdAt),
    drawnAt: formatDate_(record.drawnAt),
    updatedAt: formatDate_(record.updatedAt),
    winnerAt: formatDate_(record.winnerAt),
    winnerPrize: cleanText_(record.winnerPrize),
    eligiblePrizes: parsePrizeList_(record.eligiblePrizes),
    guaranteedPrize: cleanText_(record.guaranteedPrize),
  };
}

function buildWinnerBoard_(sheet, currentWinner, payload) {
  var prizeSheet = getPrizeSheet_();
  var records = readRecords_(sheet);
  var prizeName = getRequestedPrizeName_(prizeSheet, payload);
  var prizeConfig = getPrizeConfigByName_(prizeSheet, prizeName);
  var winners = records.filter(function(record) {
    return Boolean(cleanText_(record.winnerAt));
  }).sort(function(a, b) {
    return getDateTime_(b.winnerAt) - getDateTime_(a.winnerAt);
  });
  var prizeWinnerCount = getPrizeWinnerCount_(records, prizeName);
  var remainingSlots = prizeConfig ? Math.max(prizeConfig.winnerCount - prizeWinnerCount, 0) : 0;
  var eligibleRecords = prizeConfig ? getDrawableWinnerRecords_(records, prizeName, remainingSlots) : [];
  var limit = parsePositiveInteger_(payload.limit, DEFAULT_WINNER_LIMIT);

  return {
    currentWinner: currentWinner,
    prizeName: prizeName,
    prizeConfig: prizeConfig ? buildPrizeConfigRecord_(prizeConfig, records) : null,
    prizes: readPrizeConfigs_(prizeSheet).map(function(prize) {
      return buildPrizeConfigRecord_(prize, records);
    }),
    stats: {
      totalUsers: records.length,
      drawnNumbers: records.filter(function(record) {
        return Boolean(cleanText_(record.lotteryNumber));
      }).length,
      winners: winners.length,
      prizeWinners: prizeWinnerCount,
      remainingSlots: remainingSlots,
      remaining: Math.min(eligibleRecords.length, remainingSlots),
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
    eligiblePrizes: parsePrizeList_(record.eligiblePrizes),
    guaranteedPrize: cleanText_(record.guaranteedPrize),
  };
}

function buildAdminBoard_(sheet, prizeSheet, options) {
  var records = readRecords_(sheet);
  var prizes = readPrizeConfigs_(prizeSheet);
  var selectedMap = buildUuidSet_(options && options.selectedUuids ? options.selectedUuids : []);
  var users = records.map(function(record) {
    return buildAdminUserRecord_(record, Boolean(selectedMap[record.uuid]));
  }).sort(function(a, b) {
    if (a.hasWon !== b.hasWon) return a.hasWon ? -1 : 1;
    if (a.hasDrawn !== b.hasDrawn) return a.hasDrawn ? -1 : 1;
    return String(a.lotteryNumber || '').localeCompare(String(b.lotteryNumber || ''));
  });

  return {
    message: options && options.message ? options.message : '',
    stats: {
      totalUsers: records.length,
      drawnNumbers: records.filter(function(record) {
        return Boolean(cleanText_(record.lotteryNumber));
      }).length,
      winners: records.filter(function(record) {
        return Boolean(cleanText_(record.winnerAt));
      }).length,
      remaining: records.filter(function(record) {
        return Boolean(cleanText_(record.lotteryNumber)) && !cleanText_(record.winnerAt);
      }).length,
      prizes: prizes.length,
    },
    users: users,
    prizes: prizes.map(function(prize) {
      return buildPrizeConfigRecord_(prize, records);
    }),
  };
}

function buildAdminUserRecord_(record, selected) {
  return {
    uuid: cleanText_(record.uuid),
    lineName: cleanText_(record.lineName),
    lotteryNumber: cleanText_(record.lotteryNumber),
    hasDrawn: Boolean(cleanText_(record.lotteryNumber)),
    hasWon: Boolean(cleanText_(record.winnerAt) || cleanText_(record.winnerPrize)),
    selected: Boolean(selected),
    createdAt: formatDate_(record.createdAt),
    drawnAt: formatDate_(record.drawnAt),
    updatedAt: formatDate_(record.updatedAt),
    winnerAt: formatDate_(record.winnerAt),
    winnerPrize: cleanText_(record.winnerPrize),
    eligiblePrizes: parsePrizeList_(record.eligiblePrizes),
    guaranteedPrize: cleanText_(record.guaranteedPrize),
    eligibilityMode: parsePrizeList_(record.eligiblePrizes).length ? 'custom' : 'auto',
  };
}

function buildPrizeConfigRecord_(prize, records) {
  var winnerCount = getPrizeWinnerCount_(records, prize.prizeName);
  var guaranteedCount = records.filter(function(record) {
    return cleanText_(record.guaranteedPrize) === prize.prizeName;
  }).length;

  return {
    prizeName: prize.prizeName,
    winnerCount: prize.winnerCount,
    winnerCountUsed: winnerCount,
    guaranteedCount: guaranteedCount,
    remainingSlots: Math.max(prize.winnerCount - winnerCount, 0),
    createdAt: formatDate_(prize.createdAt),
    updatedAt: formatDate_(prize.updatedAt),
  };
}

function buildPrizeList_(records) {
  var prizeMap = {};
  records.forEach(function(record) {
    var prize = cleanText_(record.winnerPrize);
    if (prize) {
      prizeMap[prize] = true;
    }
    parsePrizeList_(record.eligiblePrizes).forEach(function(eligiblePrize) {
      prizeMap[eligiblePrize] = true;
    });
  });

  return Object.keys(prizeMap).sort();
}

function parsePrizeList_(value) {
  var raw = cleanText_(value);
  if (!raw) return [];

  var seen = {};
  var prizes = [];
  raw.split(/[|,，、\n\r;；]+/).forEach(function(item) {
    var prize = cleanText_(item);
    if (!prize || seen[prize]) return;
    seen[prize] = true;
    prizes.push(prize);
  });

  return prizes;
}

function serializePrizeList_(prizes) {
  if (!Array.isArray(prizes)) return '';

  var seen = {};
  var normalized = [];
  prizes.forEach(function(item) {
    var prize = cleanText_(item);
    if (!prize || seen[prize]) return;
    seen[prize] = true;
    normalized.push(prize);
  });

  return normalized.join('、');
}

function normalizeUuidList_(value) {
  if (!Array.isArray(value)) return [];

  var map = {};
  var uuids = [];
  value.forEach(function(item) {
    var uuid = cleanText_(item);
    if (!uuid || map[uuid]) return;
    map[uuid] = true;
    uuids.push(uuid);
  });

  return uuids;
}

function normalizeGuaranteedPrizeChanges_(value) {
  if (!Array.isArray(value)) return [];

  var order = [];
  var byUuid = {};
  value.forEach(function(item) {
    var uuid = cleanText_(item && item.uuid);
    if (!uuid) return;
    if (!Object.prototype.hasOwnProperty.call(byUuid, uuid)) {
      order.push(uuid);
    }
    byUuid[uuid] = cleanText_(item.prizeName);
  });

  return order.map(function(uuid) {
    return {
      uuid: uuid,
      prizeName: byUuid[uuid],
    };
  });
}

function buildUuidSet_(uuids) {
  var map = {};
  uuids.forEach(function(uuid) {
    map[uuid] = true;
  });
  return map;
}

function assertAllSelectedUsersFound_(selectedUuids, foundMap) {
  selectedUuids.forEach(function(uuid) {
    if (!foundMap[uuid]) {
      throw new Error('找不到勾選的使用者：' + uuid);
    }
  });
}

function getSelectedRecords_(records, selectedUuids) {
  var selectedMap = buildUuidSet_(selectedUuids);
  var foundMap = {};
  var targetRecords = [];

  records.forEach(function(record) {
    if (!selectedMap[record.uuid]) return;
    foundMap[record.uuid] = true;
    targetRecords.push(record);
  });

  assertAllSelectedUsersFound_(selectedUuids, foundMap);
  return targetRecords;
}

function assertPrizeCapacity_(records, prizeName, winnerCount) {
  var usedCount = getPrizeWinnerCount_(records, prizeName);
  var guaranteedCount = records.filter(function(record) {
    return cleanText_(record.guaranteedPrize) === prizeName;
  }).length;
  var requiredCount = Math.max(usedCount, guaranteedCount);

  if (winnerCount < requiredCount) {
    throw new Error('「' + prizeName + '」目前已有 ' + usedCount + ' 位中獎、' + guaranteedCount + ' 位保證中獎，數量不能小於 ' + requiredCount);
  }
}

function assertGuaranteedCapacity_(records, prizeName, winnerCount) {
  var lockedUuids = {};

  records.forEach(function(record) {
    if (cleanText_(record.winnerPrize) === prizeName || cleanText_(record.guaranteedPrize) === prizeName) {
      lockedUuids[record.uuid] = true;
    }
  });

  var lockedCount = Object.keys(lockedUuids).length;
  if (lockedCount > winnerCount) {
    throw new Error('「' + prizeName + '」保證中獎人數加上已中獎人數已超過設定數量 ' + winnerCount + ' 名');
  }
}

function renamePrizeInRecords_(sheet, records, originalPrizeName, prizeName, updatedAt) {
  records.forEach(function(record) {
    var changed = false;

    if (cleanText_(record.winnerPrize) === originalPrizeName) {
      record.winnerPrize = prizeName;
      changed = true;
    }
    if (cleanText_(record.guaranteedPrize) === originalPrizeName) {
      record.guaranteedPrize = prizeName;
      changed = true;
    }

    if (!changed) return;
    record.updatedAt = updatedAt;
    writePrizeNameFields_(sheet, record);
  });
}

function clearGuaranteedPrizeByName_(sheet, records, prizeName, updatedAt) {
  records.forEach(function(record) {
    if (cleanText_(record.guaranteedPrize) !== prizeName) return;
    record.guaranteedPrize = '';
    record.updatedAt = updatedAt;
    writeGuaranteedPrize_(sheet, record);
  });
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
