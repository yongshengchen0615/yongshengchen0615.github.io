import { config } from "./config.js";

const DEFAULT_TIMEOUT_MS = 12_000;

async function fetchJsonWithTimeout_(url, init, timeoutMs) {
  const ms = Math.max(0, Number(timeoutMs) || 0);
  let ctrl = null;
  let t = null;

  try {
    if (typeof AbortController !== "undefined" && ms > 0) {
      ctrl = new AbortController();
      t = setTimeout(() => {
        try {
          ctrl.abort();
        } catch (_) {}
      }, ms);
    }

    const finalInit = ctrl ? { ...(init || {}), signal: ctrl.signal } : (init || {});
    const res = await fetch(url, finalInit);
    const data = await res.json().catch(() => ({ ok: false, error: "INVALID_JSON" }));
    data.__httpOk = res.ok;
    data.__httpStatus = res.status;
    return data;
  } catch (e) {
    const msg = String(e?.name || "") === "AbortError" ? "TIMEOUT" : String(e?.message || e || "FETCH_FAILED");
    return { ok: false, error: msg };
  } finally {
    if (t) clearTimeout(t);
  }
}

export async function apiPost(bodyObj, opts) {
  const timeoutMs = Number(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return await fetchJsonWithTimeout_(
    config.TOPUP_API_URL,
    {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      // GAS 建議用 text/plain 傳 JSON
      body: JSON.stringify(bodyObj || {}),
      cache: "no-store",
    },
    timeoutMs
  );
}
