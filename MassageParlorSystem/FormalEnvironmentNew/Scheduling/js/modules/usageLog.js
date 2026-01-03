/**
 * usageLog.js
 *
 * 使用頻率紀錄（可選）：
 * - 透過 config.USAGE_LOG_URL 指向一個 GAS Web App
 * - 預設只在「授權通過後」送出一次 app_open
 * - 內建節流：同一 userId 在一定時間內只送一次（避免重整/回前景狂打）
 */

import { config } from "./config.js";

const LS_KEY_PREFIX = "usageLog:lastSent:";

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
 */
export async function logAppOpen({ userId, displayName } = {}) {
  const base = String(config.USAGE_LOG_URL || "").trim();
  if (!base) return { ok: false, skipped: true, reason: "NO_URL" };

  const uid = String(userId || "").trim();
  if (!uid) return { ok: false, skipped: true, reason: "NO_USER" };

  const minIntervalMs = Number(config.USAGE_LOG_MIN_INTERVAL_MS) || 0;
  const key = LS_KEY_PREFIX + uid;
  const last = safeReadNumberLS(key);
  const t = nowMs();

  if (last && minIntervalMs > 0 && t - last < minIntervalMs) {
    return { ok: false, skipped: true, reason: "THROTTLED" };
  }

  // 先寫入，避免短時間內重入重送
  safeWriteNumberLS(key, t);

  const url = buildUrl(base, {
    mode: "log",
    event: "app_open",
    userId: uid,
    name: String(displayName || "").trim(),
    ts: String(t),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    href: location.href,
  });

  if (!url) return { ok: false, skipped: true, reason: "BAD_URL" };
  await fireAndForgetGet(url);
  return { ok: true };
}
