/* ================================
 * Admin 審核管理台 - 資料正規化 / dirty 判斷
 * ================================ */

/**
 * 將 audit 正規化。
 * - 空值：預設為「待審核」
 * - 非列舉：歸類為「其他」
 * @param {any} v
 */
function normalizeAudit_(v) {
  const s = String(v || "").trim();
  if (!s) return "待審核";
  return AUDIT_ENUM.includes(s) ? s : "其他";
}

/**
 * 將 是/否 正規化。
 * - 只要不是嚴格的「是」就回傳「否」
 * @param {any} v
 */
function normalizeYesNo_(v) {
  const s = String(v ?? "").trim();
  return s === "是" ? "是" : "否";
}

/**
 * 產生 AdminRow 的快照字串。
 * - 用 JSON.stringify 保持順序一致，方便比較 dirty
 * - normalizeAudit_/normalizeYesNo_ 讓同義值收斂，減少不必要的 dirty
 * @param {AdminRow} a
 */
function snapshot_(a) {
  return JSON.stringify({
    userId: a.userId,
    displayName: a.displayName,
    audit: normalizeAudit_(a.audit),
    createdAt: a.createdAt,
    lastLogin: a.lastLogin,

    techAudit: normalizeYesNo_(a.techAudit),
    techCreatedAt: normalizeYesNo_(a.techCreatedAt),
    techStartDate: normalizeYesNo_(a.techStartDate),
    techExpiryDate: normalizeYesNo_(a.techExpiryDate),
    techMasterNo: normalizeYesNo_(a.techMasterNo),
    techIsMaster: normalizeYesNo_(a.techIsMaster),
    techPushEnabled: normalizeYesNo_(a.techPushEnabled),
    techPersonalStatusEnabled: normalizeYesNo_(a.techPersonalStatusEnabled),
    techScheduleEnabled: normalizeYesNo_(a.techScheduleEnabled),
  });
}

/**
 * 依據 originalMap 與目前 snapshot 比較，更新 dirtyMap。
 * @param {string} id
 * @param {AdminRow} a
 */
function markDirty_(id, a) {
  const orig = originalMap.get(id) || "";
  const now = snapshot_(a);
  if (orig !== now) dirtyMap.set(id, true);
  else dirtyMap.delete(id);
}

/**
 * 將後端原始資料轉成前端統一的 AdminRow。
 * - 這裡只做「型別/空值/枚舉」正規化，不做 UI 邏輯。
 * @param {any} a
 * @returns {AdminRow}
 */
function toAdminRow_(a) {
  return {
    userId: String(a?.userId || ""),
    displayName: String(a?.displayName || ""),
    audit: normalizeAudit_(a?.audit),
    createdAt: String(a?.createdAt || ""),
    lastLogin: String(a?.lastLogin || ""),

    techAudit: normalizeYesNo_(a?.techAudit),
    techCreatedAt: normalizeYesNo_(a?.techCreatedAt),
    techStartDate: normalizeYesNo_(a?.techStartDate),
    techExpiryDate: normalizeYesNo_(a?.techExpiryDate),
    techMasterNo: normalizeYesNo_(a?.techMasterNo),
    techIsMaster: normalizeYesNo_(a?.techIsMaster),
    techPushEnabled: normalizeYesNo_(a?.techPushEnabled),
    techPersonalStatusEnabled: normalizeYesNo_(a?.techPersonalStatusEnabled),
    techScheduleEnabled: normalizeYesNo_(a?.techScheduleEnabled),
  };
}

/**
 * 由 userId 取得 AdminRow。
 * - 集中封裝查找行為，讓後續維護更一致。
 * @param {string} userId
 * @returns {AdminRow | undefined}
 */
function getAdminById_(userId) {
  return allAdmins.find((x) => x.userId === userId);
}

/**
 * 將 AdminRow 轉成 updateAdminsBatch 所需 payload。
 * - 僅輸出後端需要更新的欄位（與現有行為一致）
 * @param {AdminRow} a
 */
function toUpdateItem_(a) {
  return {
    userId: a.userId,
    displayName: a.displayName,
    audit: normalizeAudit_(a.audit),

    techAudit: normalizeYesNo_(a.techAudit),
    techCreatedAt: normalizeYesNo_(a.techCreatedAt),
    techStartDate: normalizeYesNo_(a.techStartDate),
    techExpiryDate: normalizeYesNo_(a.techExpiryDate),
    techMasterNo: normalizeYesNo_(a.techMasterNo),
    techIsMaster: normalizeYesNo_(a.techIsMaster),
    techPushEnabled: normalizeYesNo_(a.techPushEnabled),
    techPersonalStatusEnabled: normalizeYesNo_(a.techPersonalStatusEnabled),
    techScheduleEnabled: normalizeYesNo_(a.techScheduleEnabled),
  };
}
