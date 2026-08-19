function ensureLoyaltyStorage_() {
  const props = PropertiesService.getScriptProperties();

  if (hasHealthyLoyaltyStorage_(props.getProperty('SPREADSHEET_ID'))) {
    return;
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const currentId = props.getProperty('SPREADSHEET_ID');
    if (hasHealthyLoyaltyStorage_(currentId)) return;

    if (currentId) props.deleteProperty('SPREADSHEET_ID');
    setupLoyaltyCard_();
  } finally {
    lock.releaseLock();
  }
}

function hasHealthyLoyaltyStorage_(spreadsheetId) {
  if (!spreadsheetId) return false;

  try {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    return Object.keys(APP.headers).every((sheetName) => {
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) return false;

      const expected = APP.headers[sheetName];
      const actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0].map(String);
      return expected.every((header, index) => actual[index] === header);
    });
  } catch (_) {
    return false;
  }
}
