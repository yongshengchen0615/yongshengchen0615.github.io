const SHEETS = {
  USERS: "Users",
  GROUPS: "Groups",
  GROUP_ITEMS: "GroupItems",
  JOIN_ORDERS: "JoinOrders",
};

const HEADERS = {
  Users: ["lineUserId", "displayName", "pictureUrl", "technicianNumber", "createdAt", "updatedAt"],
  Groups: [
    "groupId",
    "groupName",
    "ownerLineUserId",
    "ownerName",
    "ownerTechnicianNumber",
    "status",
    "createdAt",
    "updatedAt",
  ],
  GroupItems: ["itemId", "groupId", "name", "price", "active", "createdAt", "updatedAt"],
  JoinOrders: [
    "orderId",
    "groupId",
    "groupName",
    "ownerLineUserId",
    "lineUserId",
    "displayName",
    "technicianNumber",
    "itemSummary",
    "itemsJson",
    "total",
    "note",
    "createdAt",
  ],
};

const TIMEZONE = "Asia/Taipei";

function doGet() {
  return jsonOutput_({
    ok: true,
    data: {
      service: "GroupSystem GAS",
      timestamp: new Date().toISOString(),
    },
  });
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = body.action;
    const payload = body.payload || {};
    const profile = verifyLineIdToken_(body.idToken);
    const context = createContext_(profile);
    const data = handleAction_(action, payload, context);

    return jsonOutput_({ ok: true, data });
  } catch (error) {
    return jsonOutput_({
      ok: false,
      error: error.message || String(error),
    });
  }
}

function handleAction_(action, payload, context) {
  switch (action) {
    case "bootstrap":
      return bootstrapData_(context);
    case "saveTechnicianNumber":
      return saveTechnicianNumber_(payload, context);
    case "createGroup":
      requireTechnician_(context.user);
      return createGroup_(payload, context);
    case "updateGroup":
      requireTechnician_(context.user);
      return updateGroup_(payload, context);
    case "setGroupStatus":
      requireTechnician_(context.user);
      return setGroupStatus_(payload, context);
    case "joinGroup":
      requireTechnician_(context.user);
      return joinGroup_(payload, context);
    default:
      throw new Error("未知操作");
  }
}

function bootstrapData_(context) {
  const groups = listGroupsWithDetails_();
  return {
    user: context.user,
    openGroups: groups.filter((group) => group.status === "open" && group.ownerLineUserId !== context.user.lineUserId),
    myGroups: groups.filter((group) => group.ownerLineUserId === context.user.lineUserId),
    myOrders: listUserJoinOrders_(context.user.lineUserId),
  };
}

function saveTechnicianNumber_(payload, context) {
  const technicianNumber = String(payload.technicianNumber || "").trim();
  if (!technicianNumber) {
    throw new Error("請輸入技師號碼");
  }
  if (technicianNumber.length > 30) {
    throw new Error("技師號碼過長");
  }

  const user = Object.assign({}, context.user, {
    technicianNumber,
    updatedAt: new Date().toISOString(),
  });
  updateObjectByKey_(SHEETS.USERS, "lineUserId", user.lineUserId, user);
  context.user = user;
  syncOwnerProfile_(user);
  return bootstrapData_(context);
}

function createGroup_(payload, context) {
  const groupName = cleanRequired_(payload.groupName, "請輸入團名");
  const items = sanitizeItems_(payload.items);
  const now = new Date().toISOString();
  const group = {
    groupId: Utilities.getUuid(),
    groupName,
    ownerLineUserId: context.user.lineUserId,
    ownerName: context.user.displayName,
    ownerTechnicianNumber: context.user.technicianNumber,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };

  appendObject_(SHEETS.GROUPS, group);
  replaceGroupItems_(group.groupId, items);
  return bootstrapData_(context);
}

function updateGroup_(payload, context) {
  const group = requireOwnedGroup_(payload.groupId, context.user);
  const groupName = cleanRequired_(payload.groupName, "請輸入團名");
  const items = sanitizeItems_(payload.items);
  const updated = Object.assign({}, group, {
    groupName,
    ownerName: context.user.displayName,
    ownerTechnicianNumber: context.user.technicianNumber,
    updatedAt: new Date().toISOString(),
  });

  updateObjectByKey_(SHEETS.GROUPS, "groupId", updated.groupId, updated);
  replaceGroupItems_(updated.groupId, items);
  return bootstrapData_(context);
}

function setGroupStatus_(payload, context) {
  const group = requireOwnedGroup_(payload.groupId, context.user);
  const status = payload.status === "closed" ? "closed" : "open";
  const updated = Object.assign({}, group, {
    status,
    updatedAt: new Date().toISOString(),
  });

  updateObjectByKey_(SHEETS.GROUPS, "groupId", updated.groupId, updated);
  return bootstrapData_(context);
}

function joinGroup_(payload, context) {
  const group = getGroupById_(payload.groupId);
  if (!group || group.status !== "open") {
    throw new Error("這個團目前無法加入");
  }
  if (group.ownerLineUserId === context.user.lineUserId) {
    throw new Error("不能加入自己開的團");
  }

  const requestedItems = Array.isArray(payload.items) ? payload.items : [];
  if (!requestedItems.length) {
    throw new Error("請選擇要加入的項目");
  }

  const activeItems = listActiveItems_(group.groupId);
  const itemMap = {};
  activeItems.forEach((item) => {
    itemMap[item.itemId] = item;
  });

  const orderItems = requestedItems.map((requested) => {
    const item = itemMap[requested.itemId];
    const quantity = Number(requested.quantity || 0);
    if (!item || quantity <= 0) {
      throw new Error("加入項目不正確");
    }
    return {
      itemId: item.itemId,
      name: item.name,
      price: Number(item.price),
      quantity,
    };
  });

  const total = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const order = {
    orderId: Utilities.getUuid(),
    groupId: group.groupId,
    groupName: group.groupName,
    ownerLineUserId: group.ownerLineUserId,
    lineUserId: context.user.lineUserId,
    displayName: context.user.displayName,
    technicianNumber: context.user.technicianNumber,
    itemSummary: orderItems.map((item) => `${item.name} x${item.quantity}`).join("、"),
    itemsJson: JSON.stringify(orderItems),
    total,
    note: String(payload.note || "").trim(),
    createdAt: new Date().toISOString(),
  };

  appendObject_(SHEETS.JOIN_ORDERS, order);
  return bootstrapData_(context);
}

function createContext_(profile) {
  const user = upsertUserFromProfile_(profile);
  return {
    profile,
    user,
  };
}

function upsertUserFromProfile_(profile) {
  const now = new Date().toISOString();
  const existing = getUserByLineId_(profile.lineUserId);
  const user = existing
    ? Object.assign({}, existing, {
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl,
        updatedAt: now,
      })
    : {
        lineUserId: profile.lineUserId,
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl,
        technicianNumber: "",
        createdAt: now,
        updatedAt: now,
      };

  if (existing) {
    updateObjectByKey_(SHEETS.USERS, "lineUserId", user.lineUserId, user);
  } else {
    appendObject_(SHEETS.USERS, user);
  }

  return user;
}

function syncOwnerProfile_(user) {
  const groups = readObjects_(SHEETS.GROUPS).filter((group) => group.ownerLineUserId === user.lineUserId);
  groups.forEach((group) => {
    updateObjectByKey_(SHEETS.GROUPS, "groupId", group.groupId, Object.assign({}, group, {
      ownerName: user.displayName,
      ownerTechnicianNumber: user.technicianNumber,
      updatedAt: new Date().toISOString(),
    }));
  });
}

function verifyLineIdToken_(idToken) {
  if (!idToken) {
    throw new Error("缺少 LINE 登入憑證");
  }

  const channelId = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_ID");
  if (!channelId) {
    throw new Error("GAS 尚未設定 LINE_CHANNEL_ID");
  }

  const response = UrlFetchApp.fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "post",
    muteHttpExceptions: true,
    payload: {
      id_token: idToken,
      client_id: channelId,
    },
  });

  const statusCode = response.getResponseCode();
  const data = JSON.parse(response.getContentText() || "{}");
  if (statusCode < 200 || statusCode >= 300 || !data.sub) {
    throw new Error(data.error_description || "LINE 登入驗證失敗");
  }

  return {
    lineUserId: data.sub,
    displayName: data.name || "LINE 使用者",
    pictureUrl: data.picture || "",
  };
}

function requireTechnician_(user) {
  if (!user || !user.technicianNumber) {
    throw new Error("第一次登入請先輸入技師號碼");
  }
}

function requireOwnedGroup_(groupId, user) {
  const group = getGroupById_(groupId);
  if (!group || group.ownerLineUserId !== user.lineUserId) {
    throw new Error("找不到可操作的開團");
  }
  return group;
}

function cleanRequired_(value, message) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(message);
  }
  return text;
}

function sanitizeItems_(items) {
  const sanitized = (Array.isArray(items) ? items : [])
    .map((item) => ({
      itemId: item.itemId || Utilities.getUuid(),
      name: String(item.name || "").trim(),
      price: Number(item.price || 0),
    }))
    .filter((item) => item.name);

  if (!sanitized.length) {
    throw new Error("請新增至少一個項目");
  }

  sanitized.forEach((item) => {
    if (Number.isNaN(item.price) || item.price < 0) {
      throw new Error("項目價格不正確");
    }
  });

  return sanitized;
}

function replaceGroupItems_(groupId, items) {
  const now = new Date().toISOString();
  listItemsByGroup_(groupId).forEach((item) => {
    updateObjectByRowNumber_(SHEETS.GROUP_ITEMS, item._rowNumber, Object.assign({}, item, {
      active: false,
      updatedAt: now,
    }));
  });

  items.forEach((item) => {
    appendObject_(SHEETS.GROUP_ITEMS, {
      itemId: Utilities.getUuid(),
      groupId,
      name: item.name,
      price: item.price,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  });
}

function listGroupsWithDetails_() {
  const groups = readObjects_(SHEETS.GROUPS);
  const items = readObjects_(SHEETS.GROUP_ITEMS);
  const orders = readObjects_(SHEETS.JOIN_ORDERS).map(normalizeOrder_);

  return groups
    .map((group) => {
      const groupOrders = orders.filter((order) => order.groupId === group.groupId);
      return stripPrivate_(Object.assign({}, group, {
        items: items.filter((item) => item.groupId === group.groupId && item.active === true).map(stripPrivate_),
        orders: groupOrders.map(stripPrivate_),
        orderCount: groupOrders.length,
      }));
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function listUserJoinOrders_(lineUserId) {
  return readObjects_(SHEETS.JOIN_ORDERS)
    .filter((order) => order.lineUserId === lineUserId)
    .map(normalizeOrder_)
    .map(stripPrivate_)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function getUserByLineId_(lineUserId) {
  return readObjects_(SHEETS.USERS).find((user) => user.lineUserId === lineUserId) || null;
}

function getGroupById_(groupId) {
  return readObjects_(SHEETS.GROUPS).find((group) => group.groupId === groupId) || null;
}

function listItemsByGroup_(groupId) {
  return readObjects_(SHEETS.GROUP_ITEMS).filter((item) => item.groupId === groupId);
}

function listActiveItems_(groupId) {
  return listItemsByGroup_(groupId).filter((item) => item.active === true);
}

function normalizeOrder_(order) {
  let items = [];
  try {
    items = JSON.parse(order.itemsJson || "[]");
  } catch (error) {
    items = [];
  }
  return Object.assign({}, order, {
    items,
    total: Number(order.total || 0),
  });
}

function stripPrivate_(object) {
  const copy = Object.assign({}, object);
  delete copy._rowNumber;
  return copy;
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error("缺少請求內容");
  }
  return JSON.parse(e.postData.contents);
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  let spreadsheetId = properties.getProperty("SPREADSHEET_ID");
  let spreadsheet;

  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create("GroupSystem Database");
    spreadsheetId = spreadsheet.getId();
    properties.setProperty("SPREADSHEET_ID", spreadsheetId);
  }

  Object.keys(SHEETS).forEach((key) => {
    const name = SHEETS[key];
    ensureSheet_(spreadsheet, name, HEADERS[name]);
  });

  return spreadsheet;
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  if (sheet.getLastRow() === 0) {
    applyTextFormat_(sheet, headers.length);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }

  applyTextFormat_(sheet, headers.length);
  const lastColumn = Math.max(sheet.getLastColumn(), headers.length);
  const current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].filter(Boolean);
  const missing = headers.filter((header) => current.indexOf(header) === -1);
  if (missing.length) {
    sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
  }
  sheet.setFrozenRows(1);
}

function applyTextFormat_(sheet, columnCount) {
  sheet.getRange(1, 1, sheet.getMaxRows(), columnCount).setNumberFormat("@");
}

function getSheet_(name) {
  return getSpreadsheet_().getSheetByName(name);
}

function readObjects_(name) {
  const sheet = getSheet_(name);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow <= 1 || lastColumn === 0) return [];

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values.shift();
  return values
    .filter((row) => row.some((cell) => cell !== ""))
    .map((row, index) => {
      const object = { _rowNumber: index + 2 };
      headers.forEach((header, columnIndex) => {
        if (!header) return;
        object[header] = normalizeCellValue_(row[columnIndex]);
      });
      return object;
    });
}

function appendObject_(name, object) {
  const sheet = getSheet_(name);
  const headers = getHeaders_(sheet);
  sheet.appendRow(headers.map((header) => valueOrBlank_(object[header])));
}

function updateObjectByKey_(name, key, value, object) {
  const sheet = getSheet_(name);
  const rows = readObjects_(name);
  const row = rows.find((candidate) => candidate[key] === value);
  if (!row) {
    throw new Error(`找不到資料列：${key}`);
  }

  const headers = getHeaders_(sheet);
  const values = headers.map((header) => valueOrBlank_(object[header]));
  sheet.getRange(row._rowNumber, 1, 1, headers.length).setValues([values]);
}

function updateObjectByRowNumber_(name, rowNumber, object) {
  const sheet = getSheet_(name);
  const headers = getHeaders_(sheet);
  const values = headers.map((header) => valueOrBlank_(object[header]));
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
}

function getHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].filter(Boolean);
}

function valueOrBlank_(value) {
  return value === null || value === undefined ? "" : value;
}

function normalizeCellValue_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (upper === "TRUE") return true;
    if (upper === "FALSE") return false;
  }
  return value;
}
