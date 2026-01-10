import { getQueryParam } from "./core.js";

function lsKey(masterId) {
  const m = String(masterId || "").trim();
  return `auth_session_master_${m || "unknown"}`;
}

function nowMs() {
  return Date.now();
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function postJsonNoCorsPreflight(url, payload) {
  const resp = await fetch(String(url || "").trim(), {
    method: "POST",
    cache: "no-store",
    body: JSON.stringify(payload || {}),
  });

  const text = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${text.slice(0, 200)}`);

  const data = safeParseJson(text);
  if (!data) throw new Error(`NON_JSON ${text.slice(0, 200)}`);
  return data;
}

export async function submitReviewRequest({ authEndpoint, masterId, guestName, guestNote }) {
  const res = await postJsonNoCorsPreflight(authEndpoint, {
    entity: "auth",
    action: "request",
    data: {
      masterId: String(masterId || "").trim(),
      guestName: String(guestName || "").trim(),
      guestNote: String(guestNote || "").trim(),
    },
  });
  if (!res || res.ok !== true) throw new Error((res && (res.error || res.err)) || "REQUEST_FAILED");
  return res;
}

function readStoredSession(masterId) {
  const raw = String(localStorage.getItem(lsKey(masterId)) || "").trim();
  if (!raw) return null;

  const data = safeParseJson(raw);
  if (!data) return null;

  const sessionId = String(data.sessionId || "").trim();
  const expiresAtMs = Number(data.expiresAtMs);
  if (!sessionId || Number.isNaN(expiresAtMs)) return null;

  // local expiry check first (avoid unnecessary calls)
  if (expiresAtMs <= nowMs()) return null;

  return { sessionId, expiresAtMs };
}

function writeStoredSession(masterId, sessionId, expiresAtMs) {
  const payload = { sessionId: String(sessionId || "").trim(), expiresAtMs: Number(expiresAtMs) };
  localStorage.setItem(lsKey(masterId), JSON.stringify(payload));
}

function clearStoredSession(masterId) {
  localStorage.removeItem(lsKey(masterId));
}

function removeTokenFromUrl() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("token")) return;
    url.searchParams.delete("token");
    window.history.replaceState({}, "", url.toString());
  } catch {
    // ignore
  }
}

async function checkSession({ authEndpoint, masterId, sessionId }) {
  const res = await postJsonNoCorsPreflight(authEndpoint, {
    entity: "auth",
    action: "check",
    data: { masterId, sessionId },
  });

  if (res && res.ok === true) return true;
  return false;
}

async function exchangeInvite({ authEndpoint, masterId, token }) {
  const res = await postJsonNoCorsPreflight(authEndpoint, {
    entity: "auth",
    action: "exchange",
    data: { masterId, token },
  });

  if (!res || res.ok !== true) throw new Error((res && (res.error || res.err)) || "AUTH_EXCHANGE_FAILED");

  const sessionId = String(res.sessionId || "").trim();
  const expiresAtMs = Number(res.expiresAtMs);
  if (!sessionId || Number.isNaN(expiresAtMs)) throw new Error("AUTH_EXCHANGE_BAD_RESPONSE");

  return { sessionId, expiresAtMs };
}

export async function ensureAuthorizedOrShowGate({ masterId, authEndpoint, gateEl, gateMsgEl }) {
  const m = String(masterId || "").trim();
  const endpoint = String(authEndpoint || "").trim();

  const msgTarget = gateMsgEl || gateEl;

  if (!m || !endpoint) {
    if (gateEl) {
      gateEl.style.display = "";
      if (msgTarget) msgTarget.textContent = "設定錯誤：缺少 masterId 或 AUTH_ENDPOINT。";
    }
    return false;
  }

  // 1) Try existing session.
  const stored = readStoredSession(m);
  if (stored) {
    try {
      const ok = await checkSession({ authEndpoint: endpoint, masterId: m, sessionId: stored.sessionId });
      if (ok) return true;
    } catch {
      // fall through
    }
    clearStoredSession(m);
  }

  // 2) Try token in URL.
  const token = String(getQueryParam("token") || "").trim();
  if (token) {
    try {
      const { sessionId, expiresAtMs } = await exchangeInvite({ authEndpoint: endpoint, masterId: m, token });
      writeStoredSession(m, sessionId, expiresAtMs);
      removeTokenFromUrl();
      return true;
    } catch (e) {
      clearStoredSession(m);
      if (gateEl) {
        gateEl.style.display = "";
        if (msgTarget) msgTarget.textContent = "授權失敗：連結可能已過期或已使用。請向師傅索取新的授權連結。";
      }
      return false;
    }
  }

  // 3) Not authorized.
  if (gateEl) {
    gateEl.style.display = "";
    if (msgTarget) msgTarget.textContent = "尚未授權：你可以先送出申請，師傅審核通過後才可查看。";
  }
  return false;
}
