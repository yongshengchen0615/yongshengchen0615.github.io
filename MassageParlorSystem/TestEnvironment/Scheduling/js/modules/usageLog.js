/**
 * usageLog.js
 *
 * 使用頻率紀錄（可選）：
 * - 透過 config.USAGE_LOG_URL 指向一個 GAS Web App
 * - 事件以 GET query string 方式送出（mode=log&event=...）
 * - 內建節流：同一 userId + event 在一定時間內只送一次（避免重整/回前景狂打）
 */

import { config } from "./config.js";

const LS_KEY_PREFIX = "usageLog:lastSent:";

function getFallbackUserFromWindow() {
  try {
    const uid = String(window.currentUserId || "").trim();
    const name = String(window.currentDisplayName || "").trim();
    return { userId: uid, displayName: name };
  } catch {
    return { userId: "", displayName: "" };
  }
}

function nowMs() {
  return Date.now();
}

function safeReadNumberLS(key) {
  try {
    const v = localStorage.getItem(key);
    if (!v) return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

function safeWriteNumberLS(key, n) {
  try {
    localStorage.setItem(key, String(n));
  } catch {}
}

function buildUrl(base, params) {
  const b = String(base || "").trim();
  if (!b) return "";

  const u = new URL(b);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const s = String(v);
    if (!s) continue;
    u.searchParams.set(k, s);
  }
  return u.toString();
}

async function fireAndForgetGet(url) {
  try {
    // keepalive 讓瀏覽器在頁面切換/關閉時也能盡量送出
    // mode:no-cors：避免 GAS 未回 CORS header 時被瀏覽器擋下
    await fetch(url, { method: "GET", mode: "no-cors", cache: "no-store", keepalive: true });
  } catch (e) {
    // 不影響主流程
    console.warn("[UsageLog] send failed:", e);
  }
}

/**
 * 記錄一次「app_open」事件
 * - 只有在 config.USAGE_LOG_URL 有填時才會送
 * - 同一 userId 會依 config.USAGE_LOG_MIN_INTERVAL_MS 節流
 *
 * @param {Object} [args]
 * @param {string} [args.userId] 使用者唯一 ID（通常是 LIFF userId）；空值會略過不送。
 * @param {string} [args.displayName] 顯示名稱（可選）；會送到後端作紀錄。
 * @returns {Promise<{ok:boolean, skipped?:boolean, reason?:string}>} 送出結果；skipped 表示被略過。
 */
export async function logAppOpen({ userId, displayName } = {}) {
  return await logUsageEvent({ event: "app_open", userId, displayName });
}

/**
 * 記錄一次 usage event。
 * - 只有在 config.USAGE_LOG_URL 有填時才會送
 * - 同一 userId + event 會依 config.USAGE_LOG_MIN_INTERVAL_MS 節流
 *
 * @param {Object} args
 * @param {string} args.event 事件名稱（必填）
 * @param {string} [args.userId] 使用者唯一 ID（通常是 LIFF userId）；空值會略過不送。
 * @param {string} [args.displayName] 顯示名稱（可選）
 * @param {string} [args.detail] 事件附加資訊（可選；例如 from/to、狀態原因）
 * @returns {Promise<{ok:boolean, skipped?:boolean, reason?:string}>}
 */
export async function logUsageEvent({ event, userId, displayName, detail } = {}) {
  const base = String(config.USAGE_LOG_URL || "").trim();
  if (!base) return { ok: false, skipped: true, reason: "NO_URL" };

  const ev = String(event || "").trim();
  if (!ev) return { ok: false, skipped: true, reason: "NO_EVENT" };

  const fallback = getFallbackUserFromWindow();
  const uid = String(userId || fallback.userId || "").trim();
  if (!uid) return { ok: false, skipped: true, reason: "NO_USER" };

  const name = String(displayName || fallback.displayName || "").trim();
  const t = nowMs();

  const minIntervalMs = Number(config.USAGE_LOG_MIN_INTERVAL_MS) || 0;
  const key = LS_KEY_PREFIX + uid + ":" + ev;
  const last = safeReadNumberLS(key);
  if (last && minIntervalMs > 0 && t - last < minIntervalMs) {
    return { ok: false, skipped: true, reason: "THROTTLED" };
  }

  // 先寫入，避免短時間內重入重送
  safeWriteNumberLS(key, t);

  const url = buildUrl(base, {
    mode: "log",
    event: ev,
    userId: uid,
    name,
    ts: String(t),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    href: location.href,
    detail: String(detail || "").trim(),
  });

  if (!url) return { ok: false, skipped: true, reason: "BAD_URL" };
  await fireAndForgetGet(url);
  return { ok: true };
}
