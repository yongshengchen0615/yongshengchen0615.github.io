const SPREADSHEET_ID = "";

const DATASETS = {
  words: {
    sheetName: "Words",
    headers: ["id", "word", "meaning", "createdAt"],
  },
  phrases: {
    sheetName: "Phrases",
    headers: ["id", "phrase", "meaning", "example", "createdAt"],
  },
};

function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const action = String(params.action || "list").toLowerCase();
    const kind = getKind(params, action);
    const payload =
      action === "add" || action === "addword" || action === "addphrase"
        ? addEntry(kind, params)
        : {
            ok: true,
            type: kind,
            data: listEntries(kind),
          };

    return jsonResponse(payload, e);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: String(error && error.message ? error.message : error),
      },
      e
    );
  }
}

function doPost(e) {
  try {
    const body = parseBody(e);
    const kind = getKind(body, String(body.action || "add").toLowerCase());
    return jsonResponse(addEntry(kind, body), e);
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: String(error && error.message ? error.message : error),
      },
      e
    );
  }
}

function addWord(body) {
  return addEntry("words", body);
}

function addPhrase(body) {
  return addEntry("phrases", body);
}

function addEntry(kind, body) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(5000);
    locked = true;

    const isPhrase = kind === "phrases";
    const english = isPhrase
      ? cleanText(body.phrase || body.word || body.english || body.en)
      : cleanText(body.word || body.english || body.en);
    const meaning = cleanText(body.meaning || body.chinese || body.zh);
    const example = cleanText(body.example || body.sentence || body.usage);

    if (!english || !meaning) {
      return {
        ok: false,
        error: isPhrase ? "phrase and meaning are required" : "word and meaning are required",
      };
    }

    const entry = {
      id: Utilities.getUuid(),
      word: english,
      meaning: meaning,
      createdAt: new Date().toISOString(),
    };

    if (isPhrase) {
      entry.phrase = english;
      entry.example = example;
      getSheet(kind).appendRow([
        entry.id,
        entry.phrase,
        entry.meaning,
        entry.example,
        entry.createdAt,
      ]);
    } else {
      getSheet(kind).appendRow([entry.id, entry.word, entry.meaning, entry.createdAt]);
    }

    return {
      ok: true,
      type: kind,
      data: entry,
    };
  } finally {
    if (locked) {
      lock.releaseLock();
    }
  }
}

function setup() {
  getSheet("words");
  getSheet("phrases");
}

function listWords() {
  return listEntries("words");
}

function listPhrases() {
  return listEntries("phrases");
}

function listEntries(kind) {
  const sheet = getSheet(kind);
  const headers = DATASETS[kind].headers;
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return [];
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return rows
    .map(function (row) {
      if (kind === "phrases") {
        return {
          id: String(row[0] || ""),
          word: String(row[1] || ""),
          phrase: String(row[1] || ""),
          meaning: String(row[2] || ""),
          example: String(row[3] || ""),
          createdAt: row[4] instanceof Date ? row[4].toISOString() : String(row[4] || ""),
        };
      }

      return {
        id: String(row[0] || ""),
        word: String(row[1] || ""),
        meaning: String(row[2] || ""),
        createdAt: row[3] instanceof Date ? row[3].toISOString() : String(row[3] || ""),
      };
    })
    .filter(function (entry) {
      return entry.word && entry.meaning;
    })
    .reverse();
}

function getKind(params, action) {
  if (action === "addphrase" || action === "listphrases") {
    return "phrases";
  }

  const value = String(params.type || params.kind || params.sheet || "words").toLowerCase();
  return value === "phrase" || value === "phrases" ? "phrases" : "words";
}

function getSheet(kind) {
  const spreadsheet = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    throw new Error("No spreadsheet found. Bind this script to a Sheet or set SPREADSHEET_ID.");
  }

  const dataset = DATASETS[kind];
  let sheet = spreadsheet.getSheetByName(dataset.sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(dataset.sheetName);
  }

  const currentHeaders = sheet.getRange(1, 1, 1, dataset.headers.length).getValues()[0];
  const needsHeaders = dataset.headers.some(function (header, index) {
    return currentHeaders[index] !== header;
  });

  if (needsHeaders) {
    sheet.getRange(1, 1, 1, dataset.headers.length).setValues([dataset.headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function parseBody(e) {
  const contents = e && e.postData && e.postData.contents ? e.postData.contents : "";

  if (contents) {
    try {
      return JSON.parse(contents);
    } catch (error) {
      return e.parameter || {};
    }
  }

  return e && e.parameter ? e.parameter : {};
}

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function jsonResponse(payload, e) {
  const callback = e && e.parameter && e.parameter.callback ? String(e.parameter.callback) : "";
  const json = JSON.stringify(payload);

  if (callback && /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback)) {
    return ContentService.createTextOutput(callback + "(" + json + ");").setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }

  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
