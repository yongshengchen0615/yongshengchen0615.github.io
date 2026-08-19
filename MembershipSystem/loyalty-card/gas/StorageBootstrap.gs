function ensureLoyaltyStorage_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    let spreadsheetId = props.getProperty('SPREADSHEET_ID') || '';
    let spreadsheet;

    if (spreadsheetId) {
      try {
        spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      } catch (error) {
        throw new Error('SPREADSHEET_ID 無法開啟，請檢查 Script Property 與檔案權限');
      }
    } else {
      spreadsheet = SpreadsheetApp.create('MembershipSystem Loyalty Card DB');
      spreadsheetId = spreadsheet.getId();
      props.setProperty('SPREADSHEET_ID', spreadsheetId);
    }

    Object.keys(APP.headers).forEach((sheetName) => {
      let sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) sheet = spreadsheet.insertSheet(sheetName);

      const expected = APP.headers[sheetName];
      const current = sheet.getRange(1, 1, 1, expected.length).getValues()[0].map(String);
      const emptyHeader = current.every((value) => value === '');

      if (emptyHeader) {
        sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
        sheet.setFrozenRows(1);
        return;
      }

      if (expected.some((header, index) => current[index] !== header)) {
        throw new Error('Existing sheet schema mismatch: ' + sheetName);
      }
    });

    const defaultSheet = spreadsheet.getSheetByName('Sheet1');
    if (defaultSheet && spreadsheet.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
      spreadsheet.deleteSheet(defaultSheet);
    }

    seedSetting_('stamps_per_reward', String(APP.defaultRewardTarget));
    seedSetting_('session_hours', String(APP.defaultSessionHours));
    seedSetting_('max_balance', '9999');

    return {
      spreadsheetId: spreadsheetId,
      spreadsheetUrl: spreadsheet.getUrl()
    };
  } finally {
    lock.releaseLock();
  }
}

function setupLoyaltyCard_() {
  return ensureLoyaltyStorage_();
}
