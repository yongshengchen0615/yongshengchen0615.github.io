/* ================================
 * 07_api.js
 * Network calls
 * ================================ */

async function updateUsersBatch(items) {
  try {
    const res = await fetch(API_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ mode: "updateUsersBatch", items }),
    });
    return await res.json().catch(() => ({}));
  } catch (err) {
    console.error("updateUsersBatch error:", err);
    return { ok: false, error: String(err) };
  }
}

async function deleteUser(userId) {
  try {
    const fd = new URLSearchParams();
    fd.append("mode", "deleteUser");
    fd.append("userId", userId);

    const res = await fetch(API_BASE_URL, { method: "POST", body: fd });
    const json = await res.json().catch(() => ({}));
    return !!json.ok;
  } catch (err) {
    console.error("deleteUser error:", err);
    return false;
  }
}

async function pushMessageBatch_(userIds, message, includeDisplayName) {
  if (!API_BASE_URL) throw new Error("API_BASE_URL not initialized");

  const res = await fetch(API_BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      mode: "pushMessage",
      userIds,
      message,
      includeDisplayName: includeDisplayName ? "是" : "否",
    }),
  });

  return await res.json().catch(() => ({}));
}

async function adminCheckAccess_(userId, displayName) {
  if (!ADMIN_API_URL) throw new Error("ADMIN_API_URL not initialized");

  const res = await fetch(ADMIN_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      mode: "adminUpsertAndCheck",
      userId,
      displayName,
    }),
  });

  return await res.json().catch(() => ({ ok: false }));
}

/* ================================
 * Admin Dashboard APIs (Admins sheet)
 * GAS modes: listAdmins / updateAdminsBatch / deleteAdmin / getSpreadsheetId
 * ================================ */

async function adminListAdmins_() {
  try {
    if (!ADMIN_API_URL) throw new Error("ADMIN_API_URL not initialized");

    const res = await fetch(ADMIN_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ mode: "listAdmins" }),
    });
    return await res.json().catch(() => ({}));
  } catch (err) {
    console.error("adminListAdmins_ error:", err);
    return { ok: false, error: String(err) };
  }
}

async function adminUpdateAdminsBatch_(items) {
  try {
    if (!ADMIN_API_URL) throw new Error("ADMIN_API_URL not initialized");

    const res = await fetch(ADMIN_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ mode: "updateAdminsBatch", items: Array.isArray(items) ? items : [] }),
    });
    return await res.json().catch(() => ({}));
  } catch (err) {
    console.error("adminUpdateAdminsBatch_ error:", err);
    return { ok: false, error: String(err) };
  }
}

// 補充：在成功回應時記錄操作（非同步、fire-and-forget）
async function adminUpdateAdminsBatchWithLog_(items) {
  const ret = await adminUpdateAdminsBatch_(items);
  try {
    if (ret && ret.ok && typeof usageLogFire_ === 'function') {
      usageLogFire_('admin_update_admins_batch', {
        items: Array.isArray(items) ? items.length : 0,
        okCount: Number(ret.okCount || 0),
        failCount: Number(ret.failCount || 0),
      });
    }
  } catch (e) {
    console.warn('usageLogFire_ for adminUpdateAdminsBatchWithLog failed', e);
  }
  return ret;
}

async function adminDeleteAdmin_(userId) {
  try {
    if (!ADMIN_API_URL) throw new Error("ADMIN_API_URL not initialized");

    const res = await fetch(ADMIN_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ mode: "deleteAdmin", userId: String(userId || "").trim() }),
    });
    const json = await res.json().catch(() => ({}));
    try {
      if (json && json.ok && typeof usageLogFire_ === 'function') {
        usageLogFire_('admin_delete_admin', { userId: String(userId || "").trim() });
      }
    } catch (e) {
      console.warn('usageLogFire_ for adminDeleteAdmin_ failed', e);
    }
    return json;
  } catch (err) {
    console.error("adminDeleteAdmin_ error:", err);
    return { ok: false, error: String(err) };
  }
}

async function adminGetSpreadsheetId_() {
  try {
    if (!ADMIN_API_URL) throw new Error("ADMIN_API_URL not initialized");

    const res = await fetch(ADMIN_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ mode: "getSpreadsheetId" }),
    });
    return await res.json().catch(() => ({}));
  } catch (err) {
    console.error("adminGetSpreadsheetId_ error:", err);
    return { ok: false, error: String(err) };
  }
}

