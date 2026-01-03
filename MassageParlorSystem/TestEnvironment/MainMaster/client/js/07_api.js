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

