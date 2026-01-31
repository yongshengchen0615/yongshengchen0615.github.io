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
    await fetch(url, { method: "GET", mode: "no-cors", cache: "no-store", keepalive: true });
  } catch (e) {
    console.warn("[UsageLog] send failed:", e);
  }
}

export async function logAppOpen({ userId, displayName } = {}) {
  return await logUsageEvent({ event: "app_open", userId, displayName, eventCn: "開啟應用" });
}

export async function logUsageEvent({ event, userId, displayName, detail, noThrottle, eventCn } = {}) {
  const base = String(config.USAGE_LOG_URL || "").trim();
  if (!base) return { ok: false, skipped: true, reason: "NO_URL" };

  const ev = String(event || "").trim();
  if (!ev) return { ok: false, skipped: true, reason: "NO_EVENT" };

  const fallback = getFallbackUserFromWindow();
  const uid = String(userId || fallback.userId || "").trim();
  if (!uid) return { ok: false, skipped: true, reason: "NO_USER" };

  const name = String(displayName || fallback.displayName || "").trim();
  const t = nowMs();

  const skipThrottle = noThrottle === true;
  if (!skipThrottle) {
    const minIntervalMs = Number(config.USAGE_LOG_MIN_INTERVAL_MS) || 0;
    const key = LS_KEY_PREFIX + uid + ":" + ev;
    const last = safeReadNumberLS(key);
    if (last && minIntervalMs > 0 && t - last < minIntervalMs) {
      return { ok: false, skipped: true, reason: "THROTTLED" };
    }

    safeWriteNumberLS(key, t);
  }

  const url = buildUrl(base, {
    mode: "log",
    event: ev,
    userId: uid,
    name,
    ts: String(t),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    href: location.href,
    detail: String(detail || "").trim(),
    eventCn: String(eventCn || "").trim(),
  });

  if (!url) return { ok: false, skipped: true, reason: "BAD_URL" };
  await fireAndForgetGet(url);
  return { ok: true };
}
