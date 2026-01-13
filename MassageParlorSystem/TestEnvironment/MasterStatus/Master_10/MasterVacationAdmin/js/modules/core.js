export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function ymd(d) {
  const s = String(d || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return "";
}

// Display helper: converts canonical YYYY-MM-DD into YYYY/MM/DD.
// Returns empty string if input is not a valid canonical date.
export function ymdSlash(d) {
  const s = ymd(d);
  return s ? s.replace(/-/g, "/") : "";
}

export function uniqSorted(list) {
  const arr = (Array.isArray(list) ? list : []).map(String).filter(Boolean);
  const set = new Set(arr);
  return Array.from(set).sort();
}
