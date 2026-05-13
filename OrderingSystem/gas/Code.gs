const SHEETS = {
  USERS: "Users",
  SESSIONS: "Sessions",
  GROUPS: "Groups",
  ITEMS: "Items",
  ORDERS: "Orders",
  ORDER_ITEMS: "OrderItems",
};

const HEADERS = {
  Users: ["id", "displayName", "pictureUrl", "updatedAt", "publicName"],
  Sessions: ["token", "userId", "expiresAt", "createdAt"],
  Groups: ["id", "name", "ownerUserId", "ownerName", "status", "createdAt", "updatedAt", "orderStartAt", "orderEndAt"],
  Items: ["id", "groupId", "name", "price", "createdAt", "options"],
  Orders: ["id", "groupId", "userId", "userName", "total", "createdAt", "paid"],
  OrderItems: ["id", "orderId", "itemId", "itemName", "price", "quantity", "subtotal", "options"],
};

const SESSION_DAYS = 14;

function setup() {
  const spreadsheet = SpreadsheetApp.create("OrderingSystem Data");
  ensureSheets_(spreadsheet);
  return {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
  };
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action || "ping";

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
        mode: "config-json",
        time: new Date().toISOString(),
      };
    case "setup":
      return setupBackend_(params);
    case "login": {
      const config = requestConfig_(params);
      const spreadsheet = getSpreadsheet_(config.spreadsheetId);
      ensureSheets_(spreadsheet);
      const user = verifyLineIdToken_(params.idToken, config.lineChannelId);
      upsertUser_(spreadsheet, user);
      const session = createSession_(spreadsheet, user.id);
      return {
        session: session,
        user: user,
      };
    }
    case "testLogin": {
      const spreadsheet = spreadsheetFromParams_(params);
      ensureSheets_(spreadsheet);
      const user = normalizeTestUser_(parsePayload_(params.payload));
      upsertUser_(spreadsheet, user);
      const session = createSession_(spreadsheet, user.id);
      return {
        session: session,
        user: user,
      };
    }
    case "updateProfile": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      return updateProfile_(spreadsheet, parsePayload_(params.payload), user);
    }
    case "me": {
      const spreadsheet = spreadsheetFromParams_(params);
      return {
        user: requireUser_(spreadsheet, params.session),
      };
    }
    case "groups": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      ensureSheets_(spreadsheet);
      return {
        groups: listGroups_(spreadsheet, user, {
          summaryOnly: params.view === "summary",
        }),
      };
    }
    case "group": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      const groupId = cleanText_(params.groupId, 80);
      if (!groupId) {
        throw new Error("缺少開團 ID。");
      }
      const group = listGroups_(spreadsheet, user, {
        groupId: groupId,
      })[0];
      if (!group) {
        throw new Error("找不到開團。");
      }
      return {
        group: group,
      };
    }
    case "createGroup": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      return createGroup_(spreadsheet, parsePayload_(params.payload), user);
    }
    case "addItem": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      return addItem_(spreadsheet, parsePayload_(params.payload), user);
    }
    case "updateItem": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      return updateItem_(spreadsheet, parsePayload_(params.payload), user);
    }
    case "deleteItem": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      return deleteItem_(spreadsheet, parsePayload_(params.payload), user);
    }
    case "deleteGroup": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      return deleteGroup_(spreadsheet, parsePayload_(params.payload), user);
    }
    case "saveItems": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      return saveItems_(spreadsheet, parsePayload_(params.payload), user);
    }
    case "saveGroupSettings": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      return saveGroupSettings_(spreadsheet, parsePayload_(params.payload), user);
    }
    case "publishGroup": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      return publishGroup_(spreadsheet, parsePayload_(params.payload), user);
    }
    case "joinGroup": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      return joinGroup_(spreadsheet, parsePayload_(params.payload), user);
    }
    case "updateOrder": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      return updateOrder_(spreadsheet, parsePayload_(params.payload), user);
    }
    case "saveOrders": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      return saveOrders_(spreadsheet, parsePayload_(params.payload), user);
    }
    default:
      throw new Error("Unknown action: " + action);
  }
}

function setupBackend_(params) {
  const spreadsheetId = cleanText_(params.spreadsheetId, 160);
  const spreadsheet = spreadsheetId ? getSpreadsheet_(spreadsheetId) : SpreadsheetApp.create("OrderingSystem Data");
  ensureSheets_(spreadsheet);

  return {
    spreadsheetId: spreadsheet.getId(),
    sheets: Object.keys(HEADERS),
  };
}

function requestConfig_(params) {
  const spreadsheetId = cleanText_(params.spreadsheetId, 160);
  const lineChannelId = cleanText_(params.lineChannelId, 80);

  if (!spreadsheetId) {
    throw new Error("config.json 缺少 spreadsheetId。");
  }

  if (!lineChannelId) {
    throw new Error("config.json 缺少 lineChannelId。");
  }

  return {
    spreadsheetId: spreadsheetId,
    lineChannelId: lineChannelId,
  };
}

function spreadsheetFromParams_(params) {
  return getSpreadsheet_(params.spreadsheetId);
}

function verifyLineIdToken_(idToken, lineChannelId) {
  const token = cleanText_(idToken, 5000);
  if (!token) {
    throw new Error("缺少 LINE ID token。");
  }

  const verified = fetchJson_("https://api.line.me/oauth2/v2.1/verify", {
    method: "post",
    payload: {
      id_token: token,
      client_id: lineChannelId,
    },
  });

  if (!verified.sub) {
    throw new Error("LINE 使用者資料不完整。");
  }

  return {
    id: verified.sub,
    displayName: verified.name || "LINE 使用者",
    pictureUrl: verified.picture || "",
  };
}

function normalizeTestUser_(payload) {
  return {
    id: cleanText_(payload.id, 80) || "demo_user",
    displayName: cleanText_(payload.displayName, 40) || "測試使用者",
    publicName: cleanText_(payload.publicName, 40),
    pictureUrl: cleanText_(payload.pictureUrl, 500),
  };
}

function updateProfile_(spreadsheet, payload, user) {
  const publicName = cleanText_(payload && payload.publicName, 40);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_(spreadsheet);
    const updatedUser = {
      id: user.id,
      displayName: user.displayName,
      pictureUrl: user.pictureUrl,
      publicName: publicName,
      updatedAt: new Date().toISOString(),
    };
    const displayName = userPublicName_(updatedUser);

    assertPublicNameAvailable_(spreadsheet, displayName, user.id);
    upsertObject_(spreadsheet, SHEETS.USERS, "id", updatedUser);
    updateObjectRows_(spreadsheet, SHEETS.GROUPS, function (group) {
      return group.ownerUserId === user.id;
    }, function (group) {
      group.ownerName = displayName;
      group.updatedAt = new Date().toISOString();
      return group;
    });
    updateObjectRows_(spreadsheet, SHEETS.ORDERS, function (order) {
      return order.userId === user.id;
    }, function (order) {
      order.userName = displayName;
      return order;
    });

    const refreshedUser = userResponse_(updatedUser);
    return {
      user: refreshedUser,
      groups: listGroups_(spreadsheet, refreshedUser),
    };
  } finally {
    lock.releaseLock();
  }
}

function createGroup_(spreadsheet, payload, user) {
  const name = cleanText_(payload.name, 40);
  const items = normalizeIncomingItems_(payload.items);
  const status = payload.status === "draft" ? "draft" : "open";
  const schedule = normalizeSchedule_(payload);

  if (!name) {
    throw new Error("請輸入開團名稱。");
  }

  if (status !== "draft" && !items.length) {
    throw new Error("至少需要一個品項。");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_(spreadsheet);
    const now = new Date().toISOString();
    const group = {
      id: "grp_" + randomToken_(),
      name: name,
      ownerUserId: user.id,
      ownerName: userPublicName_(user),
      status: status,
      createdAt: now,
      updatedAt: now,
      orderStartAt: schedule.orderStartAt,
      orderEndAt: schedule.orderEndAt,
    };

    appendObject_(spreadsheet, SHEETS.GROUPS, group);

    items.forEach(function (item) {
      appendObject_(spreadsheet, SHEETS.ITEMS, {
        id: "item_" + randomToken_(),
        groupId: group.id,
        name: item.name,
        price: item.price,
        createdAt: now,
        options: stringifyJson_(item.options),
      });
    });

    return groupResponse_(spreadsheet, user, group.id);
  } finally {
    lock.releaseLock();
  }
}

function addItem_(spreadsheet, payload, user) {
  const group = requireGroupOwner_(spreadsheet, cleanText_(payload.groupId, 80), user);
  const item = normalizeIncomingItems_([payload.item])[0];

  if (!item) {
    throw new Error("請輸入品項名稱與金額。");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_(spreadsheet);
    appendObject_(spreadsheet, SHEETS.ITEMS, {
      id: "item_" + randomToken_(),
      groupId: group.id,
      name: item.name,
      price: item.price,
      createdAt: new Date().toISOString(),
      options: stringifyJson_(item.options),
    });

    touchGroup_(spreadsheet, group.id);
    return groupResponse_(spreadsheet, user, group.id);
  } finally {
    lock.releaseLock();
  }
}

function updateItem_(spreadsheet, payload, user) {
  const group = requireGroupOwner_(spreadsheet, cleanText_(payload.groupId, 80), user);
  const itemId = cleanText_(payload.itemId, 80);
  const item = normalizeIncomingItems_([payload.item])[0];

  if (!itemId) {
    throw new Error("缺少品項 ID。");
  }

  if (!item) {
    throw new Error("請輸入品項名稱與金額。");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_(spreadsheet);
    const updated = updateObjectWhere_(spreadsheet, SHEETS.ITEMS, function (entry) {
      return entry.id === itemId && entry.groupId === group.id;
    }, function (entry) {
      entry.name = item.name;
      entry.price = item.price;
      entry.options = stringifyJson_(item.options);
      return entry;
    });

    if (!updated) {
      throw new Error("找不到品項。");
    }

    syncOrderItemsForItem_(spreadsheet, itemId, item);
    recalcGroupOrders_(spreadsheet, group.id);
    touchGroup_(spreadsheet, group.id);
    return groupResponse_(spreadsheet, user, group.id);
  } finally {
    lock.releaseLock();
  }
}

function deleteItem_(spreadsheet, payload, user) {
  const group = requireGroupOwner_(spreadsheet, cleanText_(payload.groupId, 80), user);
  const itemId = cleanText_(payload.itemId, 80);

  if (!itemId) {
    throw new Error("缺少品項 ID。");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_(spreadsheet);
    const deleted = deleteObjectRows_(spreadsheet, SHEETS.ITEMS, function (entry) {
      return entry.id === itemId && entry.groupId === group.id;
    });

    if (!deleted) {
      throw new Error("找不到品項。");
    }

    deleteObjectRows_(spreadsheet, SHEETS.ORDER_ITEMS, function (entry) {
      return entry.itemId === itemId;
    });
    recalcGroupOrders_(spreadsheet, group.id);
    touchGroup_(spreadsheet, group.id);
    return groupResponse_(spreadsheet, user, group.id);
  } finally {
    lock.releaseLock();
  }
}

function deleteGroup_(spreadsheet, payload, user) {
  const group = requireGroupOwner_(spreadsheet, cleanText_(payload.groupId, 80), user);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_(spreadsheet);
    const orderIds = {};
    readObjects_(spreadsheet, SHEETS.ORDERS).forEach(function (order) {
      if (order.groupId === group.id) {
        orderIds[order.id] = true;
      }
    });

    deleteObjectRows_(spreadsheet, SHEETS.ORDER_ITEMS, function (entry) {
      return orderIds[entry.orderId];
    });
    deleteObjectRows_(spreadsheet, SHEETS.ORDERS, function (entry) {
      return entry.groupId === group.id;
    });
    deleteObjectRows_(spreadsheet, SHEETS.ITEMS, function (entry) {
      return entry.groupId === group.id;
    });
    deleteObjectRows_(spreadsheet, SHEETS.GROUPS, function (entry) {
      return entry.id === group.id;
    });

    return {
      deletedGroupId: group.id,
    };
  } finally {
    lock.releaseLock();
  }
}

function saveItems_(spreadsheet, payload, user) {
  const group = requireGroupOwner_(spreadsheet, cleanText_(payload.groupId, 80), user);
  const incomingItems = Array.isArray(payload.items) ? payload.items : [];
  const seenIds = {};
  const items = incomingItems.map(function (entry) {
    entry = entry || {};
    const id = cleanText_(entry.id, 80);
    const item = normalizeIncomingItems_([entry])[0];

    if (!item) {
      throw new Error("請輸入品項名稱與金額。");
    }

    if (id) {
      if (seenIds[id]) {
        throw new Error("品項資料重複。");
      }
      seenIds[id] = true;
    }

    return {
      id: id,
      name: item.name,
      price: item.price,
      options: item.options,
    };
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_(spreadsheet);
    const now = new Date().toISOString();
    const existingItems = readObjects_(spreadsheet, SHEETS.ITEMS).filter(function (item) {
      return item.groupId === group.id;
    });
    const existingMap = {};
    existingItems.forEach(function (item) {
      existingMap[item.id] = item;
    });

    const keptIds = {};
    items.forEach(function (item) {
      if (item.id) {
        if (!existingMap[item.id]) {
          throw new Error("找不到品項。");
        }

        keptIds[item.id] = true;
        updateObjectWhere_(spreadsheet, SHEETS.ITEMS, function (entry) {
          return entry.id === item.id && entry.groupId === group.id;
        }, function (entry) {
          entry.name = item.name;
          entry.price = item.price;
          entry.options = stringifyJson_(item.options);
          return entry;
        });
        syncOrderItemsForItem_(spreadsheet, item.id, item);
        return;
      }

      appendObject_(spreadsheet, SHEETS.ITEMS, {
        id: "item_" + randomToken_(),
        groupId: group.id,
        name: item.name,
        price: item.price,
        createdAt: now,
        options: stringifyJson_(item.options),
      });
    });

    existingItems.forEach(function (item) {
      if (keptIds[item.id]) {
        return;
      }

      deleteObjectRows_(spreadsheet, SHEETS.ITEMS, function (entry) {
        return entry.id === item.id && entry.groupId === group.id;
      });
      deleteObjectRows_(spreadsheet, SHEETS.ORDER_ITEMS, function (entry) {
        return entry.itemId === item.id;
      });
    });

    recalcGroupOrders_(spreadsheet, group.id);
    touchGroup_(spreadsheet, group.id);
    return groupResponse_(spreadsheet, user, group.id);
  } finally {
    lock.releaseLock();
  }
}

function saveGroupSettings_(spreadsheet, payload, user) {
  const group = requireGroupOwner_(spreadsheet, cleanText_(payload.groupId, 80), user);
  const schedule = normalizeSchedule_(payload);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_(spreadsheet);
    updateObjectWhere_(spreadsheet, SHEETS.GROUPS, function (entry) {
      return entry.id === group.id;
    }, function (entry) {
      entry.orderStartAt = schedule.orderStartAt;
      entry.orderEndAt = schedule.orderEndAt;
      entry.updatedAt = new Date().toISOString();
      return entry;
    });

    return groupResponse_(spreadsheet, user, group.id);
  } finally {
    lock.releaseLock();
  }
}

function publishGroup_(spreadsheet, payload, user) {
  const group = requireGroupOwner_(spreadsheet, cleanText_(payload.groupId, 80), user);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_(spreadsheet);
    const itemCount = readObjects_(spreadsheet, SHEETS.ITEMS).filter(function (item) {
      return item.groupId === group.id;
    }).length;

    if (!itemCount) {
      throw new Error("至少需要一個品項才能發布開團。");
    }

    updateObjectWhere_(spreadsheet, SHEETS.GROUPS, function (entry) {
      return entry.id === group.id;
    }, function (entry) {
      entry.status = "open";
      entry.updatedAt = new Date().toISOString();
      return entry;
    });

    return groupResponse_(spreadsheet, user, group.id);
  } finally {
    lock.releaseLock();
  }
}

function joinGroup_(spreadsheet, payload, user) {
  const groupId = cleanText_(payload.groupId, 80);
  const requestedItems = Array.isArray(payload.items) ? payload.items : [];

  if (!groupId) {
    throw new Error("缺少開團 ID。");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_(spreadsheet);
    const groups = readObjects_(spreadsheet, SHEETS.GROUPS);
    const group = groups.find(function (entry) {
      return entry.id === groupId;
    });

    if (!group) {
      throw new Error("找不到可加入的開團。");
    }

    requireGroupAcceptingOrders_(group);

    const itemMap = {};
    readObjects_(spreadsheet, SHEETS.ITEMS)
      .filter(function (item) {
        return item.groupId === groupId;
      })
      .forEach(function (item) {
        itemMap[item.id] = item;
      });

    const selectedMap = {};
    requestedItems.forEach(function (entry) {
      const itemId = cleanText_(entry.itemId, 80);
      const quantity = Math.max(0, parseInt(entry.quantity, 10) || 0);
      const item = itemMap[itemId];
      if (!item || quantity <= 0) {
        return;
      }

      const itemOptionGroups = parseJsonArray_(item.options);
      const selectedOptions = normalizeSelectedOptions_(entry.options, itemOptionGroups);
      validateRequiredOptions_(item, itemOptionGroups, selectedOptions);
      const optionExtra = selectedOptions.reduce(function (sum, option) {
        return sum + option.price;
      }, 0);
      const price = (Number(item.price) || 0) + optionExtra;
      const key = item.id + "::" + optionSignature_(selectedOptions);
      if (!selectedMap[key]) {
        selectedMap[key] = {
          itemId: item.id,
          itemName: item.name,
          price: price,
          quantity: 0,
          subtotal: 0,
          options: selectedOptions,
        };
      }
      selectedMap[key].quantity += quantity;
      selectedMap[key].subtotal += price * quantity;
    });

    const selectedItems = Object.keys(selectedMap).map(function (key) {
      return selectedMap[key];
    });

    if (!selectedItems.length) {
      throw new Error("請選擇至少一個品項。");
    }

    const now = new Date().toISOString();
    const orderId = "ord_" + randomToken_();
    const total = selectedItems.reduce(function (sum, item) {
      return sum + item.subtotal;
    }, 0);

    appendObject_(spreadsheet, SHEETS.ORDERS, {
      id: orderId,
      groupId: groupId,
      userId: user.id,
      userName: userPublicName_(user),
      total: total,
      createdAt: now,
      paid: false,
    });

    selectedItems.forEach(function (item) {
      appendObject_(spreadsheet, SHEETS.ORDER_ITEMS, {
        id: "oi_" + randomToken_(),
        orderId: orderId,
        itemId: item.itemId,
        itemName: item.itemName,
        price: item.price,
        quantity: item.quantity,
        subtotal: item.subtotal,
        options: stringifyJson_(item.options),
      });
    });

    return groupResponse_(spreadsheet, user, groupId, {
      orderId: orderId,
    });
  } finally {
    lock.releaseLock();
  }
}

function updateOrder_(spreadsheet, payload, user) {
  const groupId = cleanText_(payload.groupId, 80);
  const orderId = cleanText_(payload.orderId, 80);
  const requestedItems = Array.isArray(payload.items) ? payload.items : [];

  if (!groupId || !orderId) {
    throw new Error("缺少訂單資料。");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_(spreadsheet);
    const order = readObjects_(spreadsheet, SHEETS.ORDERS).find(function (entry) {
      return entry.id === orderId && entry.groupId === groupId;
    });

    if (!order) {
      throw new Error("找不到訂單。");
    }

    if (order.userId !== user.id) {
      throw new Error("只能修改自己的訂單。");
    }

    const quantityByEntry = {};
    const quantityByItem = {};
    requestedItems.forEach(function (entry) {
      const entryId = cleanText_(entry.entryId, 80);
      const itemId = cleanText_(entry.itemId, 80);
      const quantity = Math.max(0, parseInt(entry.quantity, 10) || 0);
      if (entryId) {
        quantityByEntry[entryId] = quantity;
      }
      if (itemId) {
        quantityByItem[itemId] = quantity;
      }
    });

    const currentItems = readObjects_(spreadsheet, SHEETS.ORDER_ITEMS).filter(function (item) {
      return item.orderId === orderId;
    });

    const updatedItems = currentItems
      .map(function (item) {
        const quantity =
          item.id && quantityByEntry[item.id] !== undefined
            ? quantityByEntry[item.id]
            : quantityByItem[item.itemId] !== undefined
              ? quantityByItem[item.itemId]
              : Number(item.quantity) || 0;
        if (quantity <= 0) {
          return null;
        }

        const price = Number(item.price) || 0;
        item.quantity = quantity;
        item.subtotal = price * quantity;
        return item;
      })
      .filter(Boolean);

    deleteObjectRows_(spreadsheet, SHEETS.ORDER_ITEMS, function (item) {
      return item.orderId === orderId;
    });

    if (!updatedItems.length) {
      deleteObjectRows_(spreadsheet, SHEETS.ORDERS, function (entry) {
        return entry.id === orderId && entry.userId === user.id;
      });
    } else {
      updatedItems.forEach(function (item) {
        appendObject_(spreadsheet, SHEETS.ORDER_ITEMS, item);
      });

      const total = updatedItems.reduce(function (sum, item) {
        return sum + (Number(item.subtotal) || 0);
      }, 0);

      updateObjectWhere_(spreadsheet, SHEETS.ORDERS, function (entry) {
        return entry.id === orderId && entry.userId === user.id;
      }, function (entry) {
        entry.total = total;
        return entry;
      });
    }

    return groupResponse_(spreadsheet, user, groupId);
  } finally {
    lock.releaseLock();
  }
}

function saveOrders_(spreadsheet, payload, user) {
  const groupId = cleanText_(payload.groupId, 80);
  const requestedOrders = Array.isArray(payload.orders) ? payload.orders : [];

  if (!groupId) {
    throw new Error("缺少開團 ID。");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureSheets_(spreadsheet);
    const group = readObjects_(spreadsheet, SHEETS.GROUPS).find(function (entry) {
      return entry.id === groupId;
    });

    if (!group) {
      throw new Error("找不到開團。");
    }

    const isGroupOwner = Boolean(group.ownerUserId === user.id);
    const orders = readObjects_(spreadsheet, SHEETS.ORDERS).filter(function (entry) {
      return entry.groupId === groupId;
    });
    const orderMap = {};
    orders.forEach(function (order) {
      orderMap[order.id] = order;
    });

    const orderItemsByOrder = groupBy_(readObjects_(spreadsheet, SHEETS.ORDER_ITEMS), "orderId");
    requestedOrders.forEach(function (orderPayload) {
      const orderId = cleanText_(orderPayload.orderId, 80);
      const order = orderMap[orderId];

      if (!order) {
        throw new Error("找不到訂單。");
      }

      if (Object.prototype.hasOwnProperty.call(orderPayload, "paid")) {
        if (!isGroupOwner) {
          throw new Error("只有團主可以設定收費狀態。");
        }

        updateObjectWhere_(spreadsheet, SHEETS.ORDERS, function (entry) {
          return entry.id === orderId && entry.groupId === groupId;
        }, function (entry) {
          entry.paid = normalizeBoolean_(orderPayload.paid);
          return entry;
        });
      }

      if (!Array.isArray(orderPayload.items)) {
        return;
      }

      const quantityByEntry = {};
      const quantityByItem = {};
      if (order.userId !== user.id) {
        throw new Error("只能修改自己的訂單。");
      }

      orderPayload.items.forEach(function (entry) {
        const entryId = cleanText_(entry.entryId, 80);
        const itemId = cleanText_(entry.itemId, 80);
        const quantity = Math.max(0, parseInt(entry.quantity, 10) || 0);
        if (entryId) {
          quantityByEntry[entryId] = quantity;
        }
        if (itemId) {
          quantityByItem[itemId] = quantity;
        }
      });

      const updatedItems = (orderItemsByOrder[orderId] || [])
        .map(function (item) {
          const quantity =
            item.id && quantityByEntry[item.id] !== undefined
              ? quantityByEntry[item.id]
              : quantityByItem[item.itemId] !== undefined
                ? quantityByItem[item.itemId]
                : Number(item.quantity) || 0;
          if (quantity <= 0) {
            return null;
          }

          const price = Number(item.price) || 0;
          item.quantity = quantity;
          item.subtotal = price * quantity;
          return item;
        })
        .filter(Boolean);

      deleteObjectRows_(spreadsheet, SHEETS.ORDER_ITEMS, function (item) {
        return item.orderId === orderId;
      });

      if (!updatedItems.length) {
        deleteObjectRows_(spreadsheet, SHEETS.ORDERS, function (entry) {
          return entry.id === orderId && entry.userId === user.id;
        });
        return;
      }

      updatedItems.forEach(function (item) {
        appendObject_(spreadsheet, SHEETS.ORDER_ITEMS, item);
      });

      const total = updatedItems.reduce(function (sum, item) {
        return sum + (Number(item.subtotal) || 0);
      }, 0);

      updateObjectWhere_(spreadsheet, SHEETS.ORDERS, function (entry) {
        return entry.id === orderId && entry.userId === user.id;
      }, function (entry) {
        entry.total = total;
        return entry;
      });
    });

    return groupResponse_(spreadsheet, user, groupId);
  } finally {
    lock.releaseLock();
  }
}

function groupResponse_(spreadsheet, user, groupId, extra) {
  const result = extra || {};
  const group = listGroups_(spreadsheet, user, {
    groupId: groupId,
  })[0];
  if (group) {
    result.group = group;
  }
  return result;
}

function listGroups_(spreadsheet, user, options) {
  options = options || {};
  const summaryOnly = Boolean(options.summaryOnly);
  const targetGroupId = cleanText_(options.groupId, 80);
  const groups = readObjects_(spreadsheet, SHEETS.GROUPS);
  const items = readObjects_(spreadsheet, SHEETS.ITEMS);
  const orders = readObjects_(spreadsheet, SHEETS.ORDERS);
  const orderItems = summaryOnly ? [] : readObjects_(spreadsheet, SHEETS.ORDER_ITEMS);

  const itemsByGroup = groupBy_(items, "groupId");
  const ordersByGroup = groupBy_(orders, "groupId");
  const orderItemsByOrder = groupBy_(orderItems, "orderId");

  return groups
    .filter(function (group) {
      const isOwner = Boolean(user && group.ownerUserId === user.id);
      return group.id && (!targetGroupId || group.id === targetGroupId) && (group.status !== "draft" || isOwner);
    })
    .map(function (group) {
      const isOwner = Boolean(user && group.ownerUserId === user.id);
      const allGroupOrders = ordersByGroup[group.id] || [];
      const visibleOrders = (ordersByGroup[group.id] || []).filter(function (order) {
        return isOwner || (user && order.userId === user.id);
      });
      const groupOrders = summaryOnly
        ? []
        : visibleOrders
            .map(function (order) {
              const attachedItems = (orderItemsByOrder[order.id] || []).map(function (item) {
                return {
                  entryId: item.id,
                  itemId: item.itemId,
                  name: item.itemName,
                  price: Number(item.price) || 0,
                  quantity: Number(item.quantity) || 0,
                  subtotal: Number(item.subtotal) || 0,
                  options: parseJsonArray_(item.options),
                };
              });

              return {
                id: order.id,
                userId: order.userId,
                userName: order.userName,
                total: Number(order.total) || 0,
                paid: normalizeBoolean_(order.paid),
                createdAt: order.createdAt,
                items: attachedItems,
              };
            })
            .sort(function (a, b) {
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });

      const participants = {};
      visibleOrders.forEach(function (order) {
        participants[order.userId] = true;
      });

      return {
        id: group.id,
        name: group.name,
        ownerUserId: group.ownerUserId,
        ownerName: group.ownerName,
        isOwner: isOwner,
        canManageItems: isOwner,
        status: group.status || "open",
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        orderStartAt: group.orderStartAt || "",
        orderEndAt: group.orderEndAt || "",
        items: (itemsByGroup[group.id] || []).map(function (item) {
          return {
            id: item.id,
            name: item.name,
            price: Number(item.price) || 0,
            options: summaryOnly ? [] : parseJsonArray_(item.options),
          };
        }),
        orders: groupOrders,
        hasJoined: Boolean(
          user &&
            allGroupOrders.some(function (order) {
              return order.userId === user.id;
            })
        ),
        isSummary: summaryOnly,
        stats: {
          participants: Object.keys(participants).length,
          orders: visibleOrders.length,
          total: visibleOrders.reduce(function (sum, order) {
            return sum + (Number(order.total) || 0);
          }, 0),
        },
      };
    })
    .sort(function (a, b) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

function requireGroupOwner_(spreadsheet, groupId, user) {
  if (!groupId) {
    throw new Error("缺少開團 ID。");
  }

  const group = readObjects_(spreadsheet, SHEETS.GROUPS).find(function (entry) {
    return entry.id === groupId;
  });

  if (!group) {
    throw new Error("找不到開團。");
  }

  if (!user || group.ownerUserId !== user.id) {
    throw new Error("只有團主可以管理品項。");
  }

  return group;
}

function touchGroup_(spreadsheet, groupId) {
  updateObjectWhere_(spreadsheet, SHEETS.GROUPS, function (entry) {
    return entry.id === groupId;
  }, function (entry) {
    entry.updatedAt = new Date().toISOString();
    return entry;
  });
}

function syncOrderItemsForItem_(spreadsheet, itemId, item) {
  updateObjectRows_(spreadsheet, SHEETS.ORDER_ITEMS, function (entry) {
    return entry.itemId === itemId;
  }, function (entry) {
    const quantity = Number(entry.quantity) || 0;
    const selectedOptions = normalizeSelectedOptions_(parseJsonArray_(entry.options), item.options);
    const optionExtra = selectedOptions.reduce(function (sum, option) {
      return sum + (Number(option.price) || 0);
    }, 0);
    entry.itemName = item.name;
    entry.options = stringifyJson_(selectedOptions);
    entry.price = item.price + optionExtra;
    entry.subtotal = entry.price * quantity;
    return entry;
  });
}

function recalcGroupOrders_(spreadsheet, groupId) {
  const groupOrders = readObjects_(spreadsheet, SHEETS.ORDERS).filter(function (order) {
    return order.groupId === groupId;
  });
  const orderIds = {};
  groupOrders.forEach(function (order) {
    orderIds[order.id] = true;
  });

  const summary = {};
  readObjects_(spreadsheet, SHEETS.ORDER_ITEMS).forEach(function (item) {
    if (!orderIds[item.orderId]) {
      return;
    }

    if (!summary[item.orderId]) {
      summary[item.orderId] = {
        count: 0,
        total: 0,
      };
    }

    summary[item.orderId].count += 1;
    summary[item.orderId].total += Number(item.subtotal) || 0;
  });

  updateObjectRows_(spreadsheet, SHEETS.ORDERS, function (order) {
    return order.groupId === groupId && summary[order.id] && summary[order.id].count > 0;
  }, function (order) {
    order.total = summary[order.id].total;
    return order;
  });

  deleteObjectRows_(spreadsheet, SHEETS.ORDERS, function (order) {
    return order.groupId === groupId && (!summary[order.id] || summary[order.id].count === 0);
  });
}

function requireUser_(spreadsheet, sessionToken) {
  const token = cleanText_(sessionToken, 160);
  if (!token) {
    throw new Error("請先登入。");
  }

  ensureSheets_(spreadsheet);
  const session = readObjects_(spreadsheet, SHEETS.SESSIONS).find(function (entry) {
    return entry.token === token;
  });

  if (!session) {
    throw new Error("登入已失效，請重新登入。");
  }

  if (new Date(session.expiresAt).getTime() < Date.now()) {
    throw new Error("登入已過期，請重新登入。");
  }

  const user = readObjects_(spreadsheet, SHEETS.USERS).find(function (entry) {
    return entry.id === session.userId;
  });

  if (!user) {
    throw new Error("找不到使用者資料。");
  }

  return userResponse_(user);
}

function upsertUser_(spreadsheet, profile) {
  ensureSheets_(spreadsheet);
  const existing = readObjects_(spreadsheet, SHEETS.USERS).find(function (entry) {
    return entry.id === profile.id;
  });
  const hasPublicName = Object.prototype.hasOwnProperty.call(profile, "publicName");

  upsertObject_(spreadsheet, SHEETS.USERS, "id", {
    id: profile.id,
    displayName: cleanText_(profile.displayName, 40) || (existing && existing.displayName) || "LINE 使用者",
    pictureUrl: cleanText_(profile.pictureUrl, 500),
    updatedAt: new Date().toISOString(),
    publicName: hasPublicName ? cleanText_(profile.publicName, 40) : (existing && existing.publicName) || "",
  });
}

function userResponse_(user) {
  return {
    id: user.id,
    displayName: cleanText_(user.displayName, 40) || "LINE 使用者",
    publicName: cleanText_(user.publicName, 40),
    pictureUrl: cleanText_(user.pictureUrl, 500),
    publicDisplayName: userPublicName_(user),
  };
}

function userPublicName_(user) {
  const publicName = cleanText_(user && user.publicName, 40);
  const displayName = cleanText_(user && user.displayName, 40);
  return publicName || displayName || "LINE 使用者";
}

function assertPublicNameAvailable_(spreadsheet, name, userId) {
  const requestedKey = publicNameKey_(name);
  if (!requestedKey) {
    return;
  }

  const duplicate = readObjects_(spreadsheet, SHEETS.USERS).find(function (entry) {
    return entry.id !== userId && publicNameKey_(userPublicName_(entry)) === requestedKey;
  });

  if (duplicate) {
    throw new Error("公開名稱已被使用，請換一個名稱。");
  }
}

function publicNameKey_(value) {
  return cleanText_(value, 40)
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function createSession_(spreadsheet, userId) {
  ensureSheets_(spreadsheet);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const token = "sess_" + randomToken_() + randomToken_();

  appendObject_(spreadsheet, SHEETS.SESSIONS, {
    token: token,
    userId: userId,
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  });

  return token;
}

function ensureSheets_(spreadsheet) {
  Object.keys(HEADERS).forEach(function (sheetName) {
    let sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
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

function getSpreadsheet_(spreadsheetId) {
  const id = cleanText_(spreadsheetId, 160);
  if (!id) {
    throw new Error("config.json 缺少 spreadsheetId。");
  }
  return SpreadsheetApp.openById(id);
}

function readObjects_(spreadsheet, sheetName) {
  const sheet = getSheetNoEnsure_(spreadsheet, sheetName);
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

function appendObject_(spreadsheet, sheetName, object) {
  const sheet = getSheetNoEnsure_(spreadsheet, sheetName);
  const headers = HEADERS[sheetName];
  sheet.appendRow(
    headers.map(function (header) {
      return object[header] !== undefined ? object[header] : "";
    })
  );
}

function upsertObject_(spreadsheet, sheetName, key, object) {
  const sheet = getSheetNoEnsure_(spreadsheet, sheetName);
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

function updateObjectWhere_(spreadsheet, sheetName, predicate, updater) {
  const sheet = getSheetNoEnsure_(spreadsheet, sheetName);
  const headers = HEADERS[sheetName];
  const values = sheet.getDataRange().getValues();

  for (let index = 1; index < values.length; index += 1) {
    const object = headers.reduce(function (entry, header, headerIndex) {
      entry[header] = normalizeCell_(values[index][headerIndex]);
      return entry;
    }, {});

    if (predicate(object)) {
      const updated = updater(object);
      const row = headers.map(function (header) {
        return updated[header] !== undefined ? updated[header] : "";
      });
      sheet.getRange(index + 1, 1, 1, headers.length).setValues([row]);
      return true;
    }
  }

  return false;
}

function updateObjectRows_(spreadsheet, sheetName, predicate, updater) {
  const sheet = getSheetNoEnsure_(spreadsheet, sheetName);
  const headers = HEADERS[sheetName];
  const values = sheet.getDataRange().getValues();
  let updatedCount = 0;

  for (let index = 1; index < values.length; index += 1) {
    const object = headers.reduce(function (entry, header, headerIndex) {
      entry[header] = normalizeCell_(values[index][headerIndex]);
      return entry;
    }, {});

    if (predicate(object)) {
      const updated = updater(object);
      const row = headers.map(function (header) {
        return updated[header] !== undefined ? updated[header] : "";
      });
      sheet.getRange(index + 1, 1, 1, headers.length).setValues([row]);
      updatedCount += 1;
    }
  }

  return updatedCount;
}

function deleteObjectRows_(spreadsheet, sheetName, predicate) {
  const sheet = getSheetNoEnsure_(spreadsheet, sheetName);
  const headers = HEADERS[sheetName];
  const values = sheet.getDataRange().getValues();
  let deleted = false;

  for (let index = values.length - 1; index >= 1; index -= 1) {
    const object = headers.reduce(function (entry, header, headerIndex) {
      entry[header] = normalizeCell_(values[index][headerIndex]);
      return entry;
    }, {});

    if (predicate(object)) {
      sheet.deleteRow(index + 1);
      deleted = true;
    }
  }

  return deleted;
}

function getSheetNoEnsure_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
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
      item = item || {};
      return {
        name: cleanText_(item.name, 32),
        price: Number(item.price),
        options: normalizeOptionGroups_(item.options),
      };
    })
    .filter(function (item) {
      return item.name && Number.isFinite(item.price) && item.price >= 0;
    });
}

function normalizeSchedule_(payload) {
  const orderStartAt = normalizeIsoDate_(payload && payload.orderStartAt);
  const orderEndAt = normalizeIsoDate_(payload && payload.orderEndAt);

  if (orderStartAt && orderEndAt && new Date(orderEndAt).getTime() <= new Date(orderStartAt).getTime()) {
    throw new Error("結束下單時間必須晚於開始下單時間。");
  }

  return {
    orderStartAt: orderStartAt,
    orderEndAt: orderEndAt,
  };
}

function normalizeIsoDate_(value) {
  const raw = cleanText_(value, 80);
  if (!raw) {
    return "";
  }

  const date = new Date(raw);
  if (isNaN(date.getTime())) {
    throw new Error("下單時間格式錯誤。");
  }
  return date.toISOString();
}

function requireGroupAcceptingOrders_(group) {
  if (group.status === "draft") {
    throw new Error("此開團仍是草稿，發布後才可下單。");
  }

  if (group.status === "closed") {
    throw new Error("此開團已截止下單。");
  }

  const now = Date.now();
  const startTime = group.orderStartAt ? new Date(group.orderStartAt).getTime() : 0;
  const endTime = group.orderEndAt ? new Date(group.orderEndAt).getTime() : 0;

  if (startTime && now < startTime) {
    throw new Error("此開團尚未開始下單。");
  }

  if (endTime && now > endTime) {
    throw new Error("此開團已截止下單。");
  }
}

function normalizeOptionGroups_(groups) {
  if (!Array.isArray(groups)) {
    return [];
  }

  return groups
    .map(function (group, groupIndex) {
      const name = cleanText_(group && group.name, 24);
      const choices = Array.isArray(group && group.choices) ? group.choices : [];
      return {
        id: cleanText_((group && group.id) || "opt_" + groupIndex, 80),
        name: name,
        required: Boolean(group && group.required),
        choices: choices
          .map(function (choice, choiceIndex) {
            const choiceName = cleanText_(choice && choice.name, 24);
            return {
              id: cleanText_((choice && choice.id) || "choice_" + choiceIndex, 80),
              name: choiceName,
              price: Math.max(0, Number(choice && choice.price) || 0),
            };
          })
          .filter(function (choice) {
            return choice.name;
          }),
      };
    })
    .filter(function (group) {
      return group.name && group.choices.length;
    });
}

function normalizeSelectedOptions_(selectedOptions, itemOptionGroups) {
  const groups = normalizeOptionGroups_(itemOptionGroups);
  const groupMap = {};
  groups.forEach(function (group) {
    const choiceMap = {};
    group.choices.forEach(function (choice) {
      choiceMap[choice.id] = choice;
    });
    groupMap[group.id] = {
      group: group,
      choices: choiceMap,
    };
  });

  if (!Array.isArray(selectedOptions)) {
    return [];
  }

  return selectedOptions
    .map(function (option) {
      const groupId = cleanText_(option && option.groupId, 80);
      const choiceId = cleanText_(option && option.choiceId, 80);
      const matchedGroup = groupMap[groupId];
      const matchedChoice = matchedGroup && matchedGroup.choices[choiceId];
      if (matchedGroup && matchedChoice) {
        return {
          groupId: matchedGroup.group.id,
          groupName: matchedGroup.group.name,
          choiceId: matchedChoice.id,
          choiceName: matchedChoice.name,
          price: matchedChoice.price,
        };
      }

      if (groups.length) {
        return null;
      }

      const groupName = cleanText_(option && option.groupName, 24);
      const choiceName = cleanText_(option && option.choiceName, 24);
      if (!groupName || !choiceName) {
        return null;
      }
      return {
        groupId: groupId,
        groupName: groupName,
        choiceId: choiceId,
        choiceName: choiceName,
        price: Math.max(0, Number(option && option.price) || 0),
      };
    })
    .filter(Boolean);
}

function validateRequiredOptions_(item, itemOptionGroups, selectedOptions) {
  const selectedGroupIds = {};
  normalizeSelectedOptions_(selectedOptions, []).forEach(function (option) {
    selectedGroupIds[option.groupId] = true;
  });

  const missing = normalizeOptionGroups_(itemOptionGroups).find(function (group) {
    return group.required && !selectedGroupIds[group.id];
  });

  if (missing) {
    throw new Error("請選擇「" + item.name + "」的" + missing.name + "。");
  }
}

function optionSignature_(options) {
  return normalizeSelectedOptions_(options, []).map(function (option) {
    return option.groupId + ":" + option.choiceId + ":" + option.price;
  }).join("|");
}

function parseJsonArray_(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function stringifyJson_(value) {
  const array = Array.isArray(value) ? value : [];
  return array.length ? JSON.stringify(array) : "";
}

function cleanText_(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function normalizeBoolean_(value) {
  if (value === true || value === 1) {
    return true;
  }
  return ["true", "yes", "1", "已收費"].indexOf(String(value || "").trim().toLowerCase()) >= 0;
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

function randomToken_() {
  return Utilities.getUuid().replace(/-/g, "");
}
