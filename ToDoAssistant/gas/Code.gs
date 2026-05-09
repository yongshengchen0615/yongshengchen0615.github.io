const PROPERTY_PREFIX = "todoAssistant:v1:";
const CHUNK_SIZE = 7500;

function doGet(e) {
  try {
    const action = (e.parameter.action || "load").toLowerCase();
    if (action !== "load") {
      return respond_(e, { ok: true, message: "Todo Assistant sync endpoint is ready." });
    }

    const key = requireKey_(e.parameter.key);
    const spreadsheetId = getSpreadsheetId_(e.parameter);
    const data = readState_(key);

    return respond_(e, {
      ok: true,
      data,
      spreadsheetUrl: getSpreadsheetUrl_(key, spreadsheetId),
      serverTime: Date.now(),
    });
  } catch (error) {
    return respond_(e, { ok: false, error: String(error.message || error) });
  }
}

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    const result = saveState_(payload);
    return respond_(e, result);
  } catch (error) {
    return respond_(e, { ok: false, error: String(error.message || error) });
  }
}

function saveState_(payload) {
  const key = requireKey_(payload.key);
  const spreadsheetId = getSpreadsheetId_(payload);
  const data = payload.data;

  if (!data || !Array.isArray(data.projects)) {
    throw new Error("Missing sync data.");
  }

  data.updatedAt = Number(data.updatedAt) || Date.now();

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    const current = readState_(key);
    if (current && Number(current.updatedAt || 0) > data.updatedAt) {
      return {
        ok: true,
        skipped: true,
        reason: "Remote data is newer.",
        data: current,
      };
    }

    writeState_(key, data);
    writeTables_(key, data, spreadsheetId);
    return {
      ok: true,
      updatedAt: data.updatedAt,
      savedAt: Date.now(),
      spreadsheetUrl: getSpreadsheetUrl_(key, spreadsheetId),
    };
  } finally {
    lock.releaseLock();
  }
}

function readState_(key) {
  const props = PropertiesService.getScriptProperties();
  const base = propertyBase_(key);
  const metaRaw = props.getProperty(`${base}:meta`);
  if (!metaRaw) return null;

  const meta = JSON.parse(metaRaw);
  const chunks = [];

  for (let index = 0; index < meta.chunks; index += 1) {
    chunks.push(props.getProperty(`${base}:chunk:${index}`) || "");
  }

  const joined = chunks.join("");
  return joined ? JSON.parse(joined) : null;
}

function writeState_(key, data) {
  const props = PropertiesService.getScriptProperties();
  const base = propertyBase_(key);
  const oldMetaRaw = props.getProperty(`${base}:meta`);
  const oldMeta = oldMetaRaw ? JSON.parse(oldMetaRaw) : { chunks: 0 };
  const json = JSON.stringify(data);
  const chunks = [];

  for (let offset = 0; offset < json.length; offset += CHUNK_SIZE) {
    chunks.push(json.slice(offset, offset + CHUNK_SIZE));
  }

  const values = {};
  chunks.forEach((chunk, index) => {
    values[`${base}:chunk:${index}`] = chunk;
  });
  values[`${base}:meta`] = JSON.stringify({
    chunks: chunks.length,
    updatedAt: data.updatedAt,
    savedAt: Date.now(),
  });

  props.setProperties(values, false);

  for (let index = chunks.length; index < oldMeta.chunks; index += 1) {
    props.deleteProperty(`${base}:chunk:${index}`);
  }
}

function writeTables_(key, data, spreadsheetId) {
  const ss = getSpreadsheet_(key, spreadsheetId);
  const projects = data.projects || [];
  const projectRows = [];
  const phaseRows = [];
  const taskRows = [];
  let taskCount = 0;

  projects.forEach((project) => {
    const tasks = project.tasks || [];
    const doneTasks = tasks.filter((task) => task.done).length;
    taskCount += tasks.length;

    projectRows.push([
      project.id || "",
      project.title || "",
      project.type || "",
      project.outcome || "",
      project.createdAt || "",
      project.id === data.activeId ? "Y" : "",
      tasks.length,
      doneTasks,
      tasks.length ? Math.round((doneTasks / tasks.length) * 100) : 0,
    ]);

    (project.phases || []).forEach((phase) => {
      const phaseTasks = tasks.filter((task) => task.phaseId === phase.id);
      phaseRows.push([
        project.id || "",
        phase.id || "",
        phase.order || "",
        phase.name || "",
        phase.color || "",
        phaseTasks.length,
        phaseTasks.filter((task) => task.done).length,
      ]);
    });

    tasks
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .forEach((task) => {
        taskRows.push([
          project.id || "",
          task.id || "",
          task.order || 0,
          task.done ? "Y" : "",
          task.title || "",
          task.phaseName || "",
          task.note || "",
          task.manual ? "Y" : "",
          task.createdAt || "",
        ]);
      });
  });

  writeSheet_(ss, "Projects", [
    "projectId",
    "title",
    "type",
    "outcome",
    "createdAt",
    "active",
    "taskCount",
    "doneTaskCount",
    "progress",
  ], projectRows);

  writeSheet_(ss, "Phases", [
    "projectId",
    "phaseId",
    "order",
    "name",
    "color",
    "taskCount",
    "doneTaskCount",
  ], phaseRows);

  writeSheet_(ss, "Tasks", [
    "projectId",
    "taskId",
    "order",
    "done",
    "title",
    "phaseName",
    "note",
    "manual",
    "createdAt",
  ], taskRows);

  writeSheet_(ss, "Meta", ["keyHash", "updatedAt", "activeId", "projectCount", "taskCount", "savedAt"], [[
    hashKey_(key),
    data.updatedAt || "",
    data.activeId || "",
    projects.length,
    taskCount,
    new Date().toISOString(),
  ]]);
}

function writeSheet_(ss, name, headers, rows) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

function getSpreadsheet_(key, spreadsheetId) {
  const targetId = getSpreadsheetId_({ spreadsheetId });
  const props = PropertiesService.getScriptProperties();
  const base = propertyBase_(key);
  const propertyName = `${base}:spreadsheetId`;

  try {
    const ss = SpreadsheetApp.openById(targetId);
    props.setProperty(propertyName, targetId);
    return ss;
  } catch (error) {
    throw new Error("Cannot open configured spreadsheet. Check spreadsheetId and GAS permissions.");
  }
}

function getSpreadsheetUrl_(key, spreadsheetId) {
  const props = PropertiesService.getScriptProperties();
  const base = propertyBase_(key);
  const existingId = getSpreadsheetId_({ spreadsheetId }, false) || props.getProperty(`${base}:spreadsheetId`);
  if (!existingId) return "";

  try {
    return SpreadsheetApp.openById(existingId).getUrl();
  } catch (error) {
    return "";
  }
}

function parsePayload_(e) {
  const body = e.postData && e.postData.contents;
  if (body) return JSON.parse(body);
  if (e.parameter.payload) return JSON.parse(e.parameter.payload);
  return e.parameter || {};
}

function getSpreadsheetId_(source, required) {
  const shouldRequire = required !== false;
  const raw = source && (source.spreadsheetId || source.spreadsheetUrl);
  const value = String(raw || "").trim();

  if (!value) {
    if (shouldRequire) throw new Error("Missing spreadsheetId.");
    return "";
  }

  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : value;
}

function requireKey_(key) {
  const value = String(key || "").trim();
  if (value.length < 6) {
    throw new Error("Sync key must be at least 6 characters.");
  }
  return value;
}

function propertyBase_(key) {
  return `${PROPERTY_PREFIX}${hashKey_(key)}`;
}

function hashKey_(key) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8);
  return bytes
    .map((byte) => {
      const value = byte < 0 ? byte + 256 : byte;
      return value.toString(16).padStart(2, "0");
    })
    .join("");
}

function respond_(e, payload) {
  const callback = e && e.parameter && e.parameter.callback;
  const json = JSON.stringify(payload);

  if (callback && /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback)) {
    return ContentService.createTextOutput(`${callback}(${json});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
