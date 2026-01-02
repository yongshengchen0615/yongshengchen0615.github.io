/* ============================================
 * 07_api.js
 * - 所有與後端溝通的 API
 * ============================================ */

/**
 * 批次更新 users
 * @param {Array<Object>} items - 更新項目陣列
 * @returns {Promise<Object>} - 後端回傳 JSON
 */
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

/**
 * 刪除單一使用者
 * @param {string} userId - LINE userId
 * @returns {Promise<boolean>} - 是否成功
 */
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

/**
 * 推播（批次）
 * @param {string[]} userIds - 目標 userId 列表
 * @param {string} message - 推播訊息
 * @param {boolean} includeDisplayName - 是否加上 displayName 前綴
 * @returns {Promise<Object>} - 後端回傳 JSON
 */
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

/**
 * 管理員門禁：後端 upsert 並檢查權限
 * @param {string} userId - 管理員 LINE userId
 * @param {string} displayName - 顯示名稱（方便後台辨識）
 * @returns {Promise<Object>} - 後端回傳 JSON（含 audit + tech 權限欄位）
 */
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
