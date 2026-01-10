export function getQueryParam(key) {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(String(key || "")) || "";
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
