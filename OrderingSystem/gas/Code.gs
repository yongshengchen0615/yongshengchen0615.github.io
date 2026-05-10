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
        groups: listGroups_(spreadsheet, user),
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
    case "saveItems": {
      const spreadsheet = spreadsheetFromParams_(params);
      const user = requireUser_(spreadsheet, params.session);
      return saveItems_(spreadsheet, parsePayload_(params.payload), user);
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
    pictureUrl: cleanText_(payload.pictureUrl, 500),
  };
}

function createGroup_(spreadsheet, payload, user) {
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
    ensureSheets_(spreadsheet);
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

    appendObject_(spreadsheet, SHEETS.GROUPS, group);

    items.forEach(function (item) {
      appendObject_(spreadsheet, SHEETS.ITEMS, {
        id: "item_" + randomToken_(),
        groupId: group.id,
        name: item.name,
        price: item.price,
        createdAt: now,
      });
    });

    return {
      group: group,
      groups: listGroups_(spreadsheet, user),
    };
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
    });

    touchGroup_(spreadsheet, group.id);
    return {
      groups: listGroups_(spreadsheet, user),
    };
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
      return entry;
    });

    if (!updated) {
      throw new Error("找不到品項。");
    }

    syncOrderItemsForItem_(spreadsheet, itemId, item);
    recalcGroupOrders_(spreadsheet, group.id);
    touchGroup_(spreadsheet, group.id);
    return {
      groups: listGroups_(spreadsheet, user),
    };
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
    return {
      groups: listGroups_(spreadsheet, user),
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
    return {
      groups: listGroups_(spreadsheet, user),
    };
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
      return entry.id === groupId && entry.status !== "closed";
    });

    if (!group) {
      throw new Error("找不到可加入的開團。");
    }

    const itemMap = {};
    readObjects_(spreadsheet, SHEETS.ITEMS)
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

    appendObject_(spreadsheet, SHEETS.ORDERS, {
      id: orderId,
      groupId: groupId,
      userId: user.id,
      userName: user.displayName,
      total: total,
      createdAt: now,
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
      });
    });

    return {
      orderId: orderId,
      groups: listGroups_(spreadsheet, user),
    };
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

    const quantityMap = {};
    requestedItems.forEach(function (entry) {
      const itemId = cleanText_(entry.itemId, 80);
      const quantity = Math.max(0, parseInt(entry.quantity, 10) || 0);
      if (itemId) {
        quantityMap[itemId] = quantity;
      }
    });

    const currentItems = readObjects_(spreadsheet, SHEETS.ORDER_ITEMS).filter(function (item) {
      return item.orderId === orderId;
    });

    const updatedItems = currentItems
      .map(function (item) {
        const quantity = quantityMap[item.itemId] !== undefined ? quantityMap[item.itemId] : Number(item.quantity) || 0;
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

    return {
      groups: listGroups_(spreadsheet, user),
    };
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

      if (order.userId !== user.id) {
        throw new Error("只能修改自己的訂單。");
      }

      const quantityMap = {};
      const requestedItems = Array.isArray(orderPayload.items) ? orderPayload.items : [];
      requestedItems.forEach(function (entry) {
        const itemId = cleanText_(entry.itemId, 80);
        const quantity = Math.max(0, parseInt(entry.quantity, 10) || 0);
        if (itemId) {
          quantityMap[itemId] = quantity;
        }
      });

      const updatedItems = (orderItemsByOrder[orderId] || [])
        .map(function (item) {
          const quantity = quantityMap[item.itemId] !== undefined ? quantityMap[item.itemId] : Number(item.quantity) || 0;
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

    return {
      groups: listGroups_(spreadsheet, user),
    };
  } finally {
    lock.releaseLock();
  }
}

function listGroups_(spreadsheet, user) {
  const groups = readObjects_(spreadsheet, SHEETS.GROUPS);
  const items = readObjects_(spreadsheet, SHEETS.ITEMS);
  const orders = readObjects_(spreadsheet, SHEETS.ORDERS);
  const orderItems = readObjects_(spreadsheet, SHEETS.ORDER_ITEMS);

  const itemsByGroup = groupBy_(items, "groupId");
  const ordersByGroup = groupBy_(orders, "groupId");
  const orderItemsByOrder = groupBy_(orderItems, "orderId");

  return groups
    .filter(function (group) {
      return group.id;
    })
    .map(function (group) {
      const isOwner = Boolean(user && group.ownerUserId === user.id);
      const visibleOrders = (ordersByGroup[group.id] || []).filter(function (order) {
        return isOwner || (user && order.userId === user.id);
      });
      const groupOrders = visibleOrders
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
        isOwner: isOwner,
        canManageItems: isOwner,
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
    entry.itemName = item.name;
    entry.price = item.price;
    entry.subtotal = item.price * quantity;
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

  return {
    id: user.id,
    displayName: user.displayName || "LINE 使用者",
    pictureUrl: user.pictureUrl || "",
  };
}

function upsertUser_(spreadsheet, profile) {
  ensureSheets_(spreadsheet);
  upsertObject_(spreadsheet, SHEETS.USERS, "id", {
    id: profile.id,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl,
    updatedAt: new Date().toISOString(),
  });
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
