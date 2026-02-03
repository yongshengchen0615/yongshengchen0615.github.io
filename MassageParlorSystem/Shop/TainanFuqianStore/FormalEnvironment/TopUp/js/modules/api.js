import { config } from "./config.js";

export async function apiPost(bodyObj) {
  const res = await fetch(config.TOPUP_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(bodyObj || {}),
  });

  return await res.json().catch(() => ({ ok: false, error: "INVALID_JSON" }));
}
