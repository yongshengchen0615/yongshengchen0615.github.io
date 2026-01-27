export function getQueryParam(key) {
  try {
    const url = new URL(window.location.href);
    const k = String(key || "");
    const direct = url.searchParams.get(k);
    if (direct) return direct;

    // LIFF deep link support:
    // When opening https://liff.line.me/<LIFF_ID>?token=..., LINE typically redirects to the endpoint URL
    // and stores the original query string inside `liff.state`.
    // Example: https://example.com/index.html?liff.state=%3Ftoken%3Dabc
    const liffState = url.searchParams.get("liff.state");
    if (!liffState) return "";

    let state = String(liffState || "");
    try {
      // searchParams.get already decodes, but keep this safe for edge cases.
      state = decodeURIComponent(state);
    } catch {
      // ignore
    }

    // state can be like:
    // - "?token=..."
    // - "/path?token=...#..."
    // - "token=..." (rare)
    const qMark = state.indexOf("?");
    let qs = qMark >= 0 ? state.slice(qMark + 1) : state;
    const hash = qs.indexOf("#");
    if (hash >= 0) qs = qs.slice(0, hash);

    const params = new URLSearchParams(qs);
    return params.get(k) || "";
  } catch {
    return "";
  }
}

export function withQuery(url, qs) {
  const base = String(url || "").trim();
  if (!base) return "";
  const q = String(qs || "").trim();
  if (!q) return base;
  return base.includes("?") ? base + "&" + q : base + "?" + q;
}

export function normalizeTechNo(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const m = s.match(/\d+/);
  if (!m) return "";
  const n = parseInt(m[0], 10);
  if (Number.isNaN(n)) return "";
  return String(n).padStart(2, "0");
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
