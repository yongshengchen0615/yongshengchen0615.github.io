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

export function uniqSorted(list) {
  const arr = (Array.isArray(list) ? list : []).map(String).filter(Boolean);
  const set = new Set(arr);
  return Array.from(set).sort();
}
