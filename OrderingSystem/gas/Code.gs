const SHEETS = {
  USERS: "Users",
  SESSIONS: "Sessions",
  GROUPS: "Groups",
  ITEMS: "Items",
  ORDERS: "Orders",
  ORDER_ITEMS: "OrderItems",
};

const HEADERS = {
  Users: ["id", "displayName", "pictureUrl", "updatedAt"],
  Sessions: ["token", "userId", "expiresAt", "createdAt"],
  Groups: ["id", "name", "ownerUserId", "ownerName", "status", "createdAt", "updatedAt"],
  Items: ["id", "groupId", "name", "price", "createdAt"],
  Orders: ["id", "groupId", "userId", "userName", "total", "createdAt"],
  OrderItems: ["id", "orderId", "itemId", "itemName", "price", "quantity", "subtotal"],
};

const SESSION_DAYS = 14;
const OAUTH_STATE_PREFIX = "line_state:";

function setup() {
  ensureSheets_();
  return {
    ok: true,
    spreadsheetId: getSpreadsheet_().getId(),
  };
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action || "ping";

  if (action === "lineLogin") {
    return lineLogin_(params);
  }

  if (action === "lineCallback") {
    return lineCallback_(params);
  }

  try {
    const data = routeApi_(action, params);
    return respond_(true, data, params.callback);
  } catch (error) {
    return respond_(false, {}, params.callback, error.message);
  }
}

function doPost(e) {
  const params = (e && e.parameter) || {};
  const body = parseBody_(e);
  const action = body.action || params.action || "ping";

  try {
    const data = routeApi_(action, Object.assign({}, params, body));
    return respond_(true, data, params.callback || body.callback);
  } catch (error) {
    return respond_(false, {}, params.callback || body.callback, error.message);
  }
}

function routeApi_(action, params) {
  switch (action) {
    case "ping":
      return {
        app: "OrderingSystem",
        time: new Date().toISOString(),
      };
    case "lineLoginUrl":
      return buildLineLoginUrl_(params);
    case "debugConfig":
      return {
        webAppUrl: webAppUrl_(),
        lineCallbackUrl: lineCallbackUrl_(),
        hasLineChannelId: Boolean(prop_("LINE_CHANNEL_ID", "")),
      };
    case "me":
      return {
        user: requireUser_(params.session),
      };
    case "groups":
      ensureSheets_();
      return {
        groups: listGroups_(),
      };
    case "createGroup": {
      const user = requireUser_(params.session);
      return createGroup_(parsePayload_(params.payload), user);
    }
    case "joinGroup": {
      const user = requireUser_(params.session);
      return joinGroup_(parsePayload_(params.payload), user);
    }
    default:
      throw new Error("Unknown action: " + action);
  }
}

function lineLogin_(params) {
  const data = buildLineLoginUrl_(params);
  return redirectHtml_(data.authUrl);
}

function buildLineLoginUrl_(params) {
  const channelId = prop_("LINE_CHANNEL_ID");
  const frontend = frontendFromRequest_(params.frontend);
  const state = randomToken_();
  const nonce = randomToken_();
  const callbackUrl = lineCallbackUrl_();

  CacheService.getScriptCache().put(
    OAUTH_STATE_PREFIX + state,
    JSON.stringify({
      nonce: nonce,
      frontend: frontend,
    }),
    600
  );

  return {
    authUrl:
      "https://access.line.me/oauth2/v2.1/authorize?" +
      queryString_({
        response_type: "code",
        client_id: channelId,
        redirect_uri: callbackUrl,
        state: state,
        scope: "profile openid",
        nonce: nonce,
      }),
  };
}

function lineCallback_(params) {
  const fallbackFrontend = prop_("FRONTEND_URL", webAppUrl_());

  try {
    if (params.error) {
      throw new Error(params.error_description || params.error);
    }

    const state = params.state || "";
    const cached = CacheService.getScriptCache().get(OAUTH_STATE_PREFIX + state);
    if (!cached) {
      throw new Error("LINE 登入狀態已逾時，請重新登入。");
    }

    const stateData = JSON.parse(cached);
    const callbackUrl = lineCallbackUrl_();
    const channelId = prop_("LINE_CHANNEL_ID");
    const channelSecret = prop_("LINE_CHANNEL_SECRET");

    const token = fetchJson_("https://api.line.me/oauth2/v2.1/token", {
      method: "post",
      payload: {
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: callbackUrl,
        client_id: channelId,
        client_secret: channelSecret,
      },
    });

    if (!token.id_token) {
      throw new Error("LINE 未回傳 ID token。");
    }

    const verified = fetchJson_("https://api.line.me/oauth2/v2.1/verify", {
      method: "post",
      payload: {
        id_token: token.id_token,
        client_id: channelId,
      },
    });

    if (stateData.nonce && verified.nonce !== stateData.nonce) {
      throw new Error("LINE nonce 驗證失敗。");
    }

    const profile = buildLineProfile_(verified, token.access_token);
    upsertUser_(profile);
    const session = createSession_(profile.id);

    return redirectHtml_(appendQuery_(stateData.frontend, { session: session }));
  } catch (error) {
    return redirectHtml_(
      appendQuery_(fallbackFrontend, {
        login_error: error.message || "LINE 登入失敗。",
      })
    );
  }
}

function buildLineProfile_(verified, accessToken) {
  let profile = {};

  if ((!verified.name || !verified.picture) && accessToken) {
    try {
      profile = fetchJson_("https://api.line.me/v2/profile", {
        method: "get",
        headers: {
          Authorization: "Bearer " + accessToken,
        },
      });
    } catch (error) {
      profile = {};
    }
  }

  const id = verified.sub || profile.userId;
  if (!id) {
    throw new Error("LINE 使用者資料不完整。");
  }

  return {
    id: id,
    displayName: verified.name || profile.displayName || "LINE 使用者",
    pictureUrl: verified.picture || profile.pictureUrl || "",
  };
}

function createGroup_(payload, user) {
  const name = cleanText_(payload.name, 40);
  const items = normalizeIncomingItems_(payload.items);

  if (!name) {
    throw new Error("請輸入開團名稱。");
  }

  if (!items.length) {
    throw new Error("至少需要一個品項。");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_();
    const now = new Date().toISOString();
    const group = {
      id: "grp_" + randomToken_(),
      name: name,
      ownerUserId: user.id,
      ownerName: user.displayName,
      status: "open",
      createdAt: now,
      updatedAt: now,
    };

    appendObject_(SHEETS.GROUPS, group);

    items.forEach(function (item) {
      appendObject_(SHEETS.ITEMS, {
        id: "item_" + randomToken_(),
        groupId: group.id,
        name: item.name,
        price: item.price,
        createdAt: now,
      });
    });

    return {
      group: group,
      groups: listGroups_(),
    };
  } finally {
    lock.releaseLock();
  }
}

function joinGroup_(payload, user) {
  const groupId = cleanText_(payload.groupId, 80);
  const requestedItems = Array.isArray(payload.items) ? payload.items : [];

  if (!groupId) {
    throw new Error("缺少開團 ID。");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_();
    const groups = readObjects_(SHEETS.GROUPS);
    const group = groups.find(function (entry) {
      return entry.id === groupId && entry.status !== "closed";
    });

    if (!group) {
      throw new Error("找不到可加入的開團。");
    }

    const itemMap = {};
    readObjects_(SHEETS.ITEMS)
      .filter(function (item) {
        return item.groupId === groupId;
      })
      .forEach(function (item) {
        itemMap[item.id] = item;
      });

    const quantities = {};
    requestedItems.forEach(function (entry) {
      const itemId = cleanText_(entry.itemId, 80);
      const quantity = Math.max(0, parseInt(entry.quantity, 10) || 0);
      if (itemId && quantity > 0) {
        quantities[itemId] = (quantities[itemId] || 0) + quantity;
      }
    });

    const selectedItems = Object.keys(quantities)
      .map(function (itemId) {
        const item = itemMap[itemId];
        if (!item) {
          return null;
        }
        const quantity = quantities[itemId];
        const price = Number(item.price) || 0;
        return {
          itemId: item.id,
          itemName: item.name,
          price: price,
          quantity: quantity,
          subtotal: price * quantity,
        };
      })
      .filter(Boolean);

    if (!selectedItems.length) {
      throw new Error("請選擇至少一個品項。");
    }

    const now = new Date().toISOString();
    const orderId = "ord_" + randomToken_();
    const total = selectedItems.reduce(function (sum, item) {
      return sum + item.subtotal;
    }, 0);

    appendObject_(SHEETS.ORDERS, {
      id: orderId,
      groupId: groupId,
      userId: user.id,
      userName: user.displayName,
      total: total,
      createdAt: now,
    });

    selectedItems.forEach(function (item) {
      appendObject_(SHEETS.ORDER_ITEMS, {
        id: "oi_" + randomToken_(),
        orderId: orderId,
        itemId: item.itemId,
        itemName: item.itemName,
        price: item.price,
        quantity: item.quantity,
        subtotal: item.subtotal,
      });
    });

    return {
      orderId: orderId,
      groups: listGroups_(),
    };
  } finally {
    lock.releaseLock();
  }
}

function listGroups_() {
  const groups = readObjects_(SHEETS.GROUPS);
  const items = readObjects_(SHEETS.ITEMS);
  const orders = readObjects_(SHEETS.ORDERS);
  const orderItems = readObjects_(SHEETS.ORDER_ITEMS);

  const itemsByGroup = groupBy_(items, "groupId");
  const ordersByGroup = groupBy_(orders, "groupId");
  const orderItemsByOrder = groupBy_(orderItems, "orderId");

  return groups
    .filter(function (group) {
      return group.id;
    })
    .map(function (group) {
      const groupOrders = (ordersByGroup[group.id] || [])
        .map(function (order) {
          const attachedItems = (orderItemsByOrder[order.id] || []).map(function (item) {
            return {
              itemId: item.itemId,
              name: item.itemName,
              price: Number(item.price) || 0,
              quantity: Number(item.quantity) || 0,
              subtotal: Number(item.subtotal) || 0,
            };
          });

          return {
            id: order.id,
            userId: order.userId,
            userName: order.userName,
            total: Number(order.total) || 0,
            createdAt: order.createdAt,
            items: attachedItems,
          };
        })
        .sort(function (a, b) {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

      const participants = {};
      groupOrders.forEach(function (order) {
        participants[order.userId] = true;
      });

      return {
        id: group.id,
        name: group.name,
        ownerUserId: group.ownerUserId,
        ownerName: group.ownerName,
        status: group.status || "open",
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        items: (itemsByGroup[group.id] || []).map(function (item) {
          return {
            id: item.id,
            name: item.name,
            price: Number(item.price) || 0,
          };
        }),
        orders: groupOrders,
        stats: {
          participants: Object.keys(participants).length,
          orders: groupOrders.length,
          total: groupOrders.reduce(function (sum, order) {
            return sum + order.total;
          }, 0),
        },
      };
    })
    .sort(function (a, b) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

function requireUser_(sessionToken) {
  const token = cleanText_(sessionToken, 160);
  if (!token) {
    throw new Error("請先登入。");
  }

  ensureSheets_();
  const session = readObjects_(SHEETS.SESSIONS).find(function (entry) {
    return entry.token === token;
  });

  if (!session) {
    throw new Error("登入已失效，請重新登入。");
  }

  if (new Date(session.expiresAt).getTime() < Date.now()) {
    throw new Error("登入已過期，請重新登入。");
  }

  const user = readObjects_(SHEETS.USERS).find(function (entry) {
    return entry.id === session.userId;
  });

  if (!user) {
    throw new Error("找不到使用者資料。");
  }

  return {
    id: user.id,
    displayName: user.displayName || "LINE 使用者",
    pictureUrl: user.pictureUrl || "",
  };
}

function upsertUser_(profile) {
  ensureSheets_();
  upsertObject_(SHEETS.USERS, "id", {
    id: profile.id,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl,
    updatedAt: new Date().toISOString(),
  });
}

function createSession_(userId) {
  ensureSheets_();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const token = "sess_" + randomToken_() + randomToken_();

  appendObject_(SHEETS.SESSIONS, {
    token: token,
    userId: userId,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  });

  return token;
}

function ensureSheets_() {
  const ss = getSpreadsheet_();
  Object.keys(HEADERS).forEach(function (sheetName) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    const headers = HEADERS[sheetName];
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      return;
    }

    const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    const mismatch = headers.some(function (header, index) {
      return currentHeaders[index] !== header;
    });

    if (mismatch) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  });
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty("SPREADSHEET_ID");

  if (!spreadsheetId) {
    const spreadsheet = SpreadsheetApp.create("OrderingSystem Data");
    spreadsheetId = spreadsheet.getId();
    props.setProperty("SPREADSHEET_ID", spreadsheetId);
  }

  return SpreadsheetApp.openById(spreadsheetId);
}

function getSheet_(sheetName) {
  ensureSheets_();
  return getSpreadsheet_().getSheetByName(sheetName);
}

function readObjects_(sheetName) {
  const sheet = getSheetNoEnsure_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return [];
  }

  const headers = values[0];
  return values
    .slice(1)
    .filter(function (row) {
      return row.some(function (cell) {
        return cell !== "";
      });
    })
    .map(function (row) {
      return headers.reduce(function (object, header, index) {
        object[header] = normalizeCell_(row[index]);
        return object;
      }, {});
    });
}

function appendObject_(sheetName, object) {
  const sheet = getSheetNoEnsure_(sheetName);
  const headers = HEADERS[sheetName];
  sheet.appendRow(
    headers.map(function (header) {
      return object[header] !== undefined ? object[header] : "";
    })
  );
}

function upsertObject_(sheetName, key, object) {
  const sheet = getSheetNoEnsure_(sheetName);
  const headers = HEADERS[sheetName];
  const values = sheet.getDataRange().getValues();
  const keyIndex = headers.indexOf(key);
  const row = headers.map(function (header) {
    return object[header] !== undefined ? object[header] : "";
  });

  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][keyIndex]) === String(object[key])) {
      sheet.getRange(index + 1, 1, 1, headers.length).setValues([row]);
      return;
    }
  }

  sheet.appendRow(row);
}

function getSheetNoEnsure_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("Missing sheet: " + sheetName);
  }
  return sheet;
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    return {};
  }
}

function parsePayload_(payload) {
  if (!payload) {
    return {};
  }

  if (typeof payload === "object") {
    return payload;
  }

  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error("payload 格式錯誤。");
  }
}

function normalizeIncomingItems_(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map(function (item) {
      return {
        name: cleanText_(item.name, 32),
        price: Number(item.price),
      };
    })
    .filter(function (item) {
      return item.name && Number.isFinite(item.price) && item.price >= 0;
    });
}

function cleanText_(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function normalizeCell_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return value.toISOString();
  }
  return value;
}

function groupBy_(items, key) {
  return items.reduce(function (map, item) {
    const value = item[key];
    if (!map[value]) {
      map[value] = [];
    }
    map[value].push(item);
    return map;
  }, {});
}

function respond_(ok, data, callback, message) {
  const body = JSON.stringify({
    ok: ok,
    data: data || {},
    message: message || "",
  });

  const safeCallback = safeCallback_(callback);
  if (safeCallback) {
    return ContentService.createTextOutput(safeCallback + "(" + body + ");").setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }

  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function safeCallback_(callback) {
  const value = String(callback || "");
  return /^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(value) ? value : "";
}

function prop_(name, fallback) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (value) {
    return value;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error("Missing Script Property: " + name);
}

function frontendFromRequest_(frontend) {
  const configured = prop_("FRONTEND_URL", "");
  const requested = cleanText_(frontend, 500);

  if (configured) {
    return requested && requested.indexOf(configured) === 0 ? requested : configured;
  }

  if (!requested) {
    throw new Error("Missing FRONTEND_URL Script Property.");
  }

  return requested;
}

function webAppUrl_() {
  return ScriptApp.getService().getUrl();
}

function lineCallbackUrl_() {
  return prop_("LINE_CALLBACK_URL", webAppUrl_() + "?action=lineCallback");
}

function fetchJson_(url, options) {
  const requestOptions = Object.assign(
    {
      muteHttpExceptions: true,
    },
    options || {}
  );
  const response = UrlFetchApp.fetch(url, requestOptions);
  const text = response.getContentText();
  let data = {};

  try {
    data = JSON.parse(text);
  } catch (error) {
    data = {};
  }

  if (response.getResponseCode() >= 400) {
    throw new Error(data.error_description || data.message || text || "HTTP " + response.getResponseCode());
  }

  return data;
}

function redirectHtml_(url) {
  const safeUrl = JSON.stringify(url);
  const escapedUrl = escapeHtml_(url);
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><base target="_top"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Redirect</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f6f2;color:#151816}a{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:8px;background:#06c755;color:#fff;text-decoration:none;font-weight:800}</style></head><body><a href="' +
      escapedUrl +
      '" target="_top">繼續 LINE 登入</a><script>try{window.top.location.replace(' +
      safeUrl +
      ")}catch(e){location.replace(" +
      safeUrl +
      ")}</script></body></html>"
  );
}

function escapeHtml_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function queryString_(params) {
  return Object.keys(params)
    .map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]);
    })
    .join("&");
}

function appendQuery_(url, params) {
  const query = queryString_(params);
  return url + (url.indexOf("?") === -1 ? "?" : "&") + query;
}

function randomToken_() {
  return Utilities.getUuid().replace(/-/g, "");
}
