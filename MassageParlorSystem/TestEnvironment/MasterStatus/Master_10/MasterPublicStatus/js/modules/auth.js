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

export async function getMasterOpenStatus({ authEndpoint, masterId }) {
  const res = await postJsonNoCorsPreflight(authEndpoint, {
    entity: "auth",
    action: "open_status",
    data: { masterId: String(masterId || "").trim() },
  });

  if (!res || res.ok !== true) throw new Error((res && (res.error || res.err)) || "OPEN_STATUS_FAILED");

  return {
    approved: Boolean(res.approved),
    enabled: Boolean(res.enabled),
    found: Boolean(res.found),
  };
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

  if (res && res.ok === true) return { ok: true };
  return { ok: false, error: res && (res.error || res.err) };
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

function mapAuthErrorToGateMessage(err) {
  const e = String(err || "").trim();
  if (!e) return "授權失敗：請向師傅索取新的授權連結。";

  if (e === "MASTER_NOT_APPROVED") return "目前師傅尚未通過審核，看板暫不可使用。";
  if (e === "MASTER_STATUS_NOT_ENABLED") return "目前師傅尚未開通個人狀態，看板暫不可使用。";
  if (e === "MASTER_NOT_OPEN") return "目前師傅未開通看板（未通過審核或未啟用個人狀態）。";

  if (e === "TOKEN_EXPIRED") return "授權失敗：連結已過期。請向師傅索取新的授權連結。";
  if (e === "TOKEN_ALREADY_USED") return "授權失敗：此連結已使用過（每個授權連結只能使用一次/一台裝置）。";
  if (e === "TOKEN_NOT_FOUND") return "授權失敗：找不到授權資料。請向師傅索取新的授權連結。";
  if (e === "TOKEN_MASTER_MISMATCH") return "授權失敗：此連結不屬於目前師傅。請確認你開的是正確的師傅頁面。";
  if (e === "TOKEN_SIGNATURE_INVALID") return "授權失敗：連結已失效（可能系統更新/密鑰變更）。請向師傅索取新的授權連結。";
  if (e === "TOKEN_FORMAT_INVALID") return "授權失敗：連結格式不正確。請向師傅索取新的授權連結。";

  // Fallback: keep generic.
  return "授權失敗：連結可能已過期或已使用。請向師傅索取新的授權連結。";
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
      const st = await checkSession({ authEndpoint: endpoint, masterId: m, sessionId: stored.sessionId });
      if (st && st.ok === true) return true;

      const err = String(st && st.error ? st.error : "").trim();
      if (err === "MASTER_NOT_APPROVED" || err === "MASTER_STATUS_NOT_ENABLED" || err === "MASTER_NOT_OPEN") {
        if (gateEl) {
          gateEl.style.display = "";
          if (msgTarget) {
            msgTarget.textContent =
              err === "MASTER_NOT_APPROVED"
                ? "目前師傅尚未通過審核，看板暫不可使用。"
                : err === "MASTER_STATUS_NOT_ENABLED"
                  ? "目前師傅尚未開通個人狀態，看板暫不可使用。"
                  : "目前師傅未開通看板（未通過審核或未啟用個人狀態）。";
          }
        }
        // IMPORTANT: Do NOT clear stored session here.
        // When the master later becomes approved/enabled again, the same session should work.
        return false;
      }
    } catch {
      // If check failed due to network/transient issues, keep session and show a safe message.
      if (gateEl) {
        gateEl.style.display = "";
        if (msgTarget) msgTarget.textContent = "授權檢查失敗：請稍後重新整理再試。";
      }
      return false;
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
      const err = String(e && e.message ? e.message : "").trim();
      clearStoredSession(m);
      if (gateEl) {
        gateEl.style.display = "";
        if (msgTarget) {
          msgTarget.textContent = mapAuthErrorToGateMessage(err);
        }
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
