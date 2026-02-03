export function debounce(fn, waitMs) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), Math.max(0, Number(waitMs) || 0));
  };
}

export function getQueryParam(name) {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get(name);
  } catch (_) {
    return null;
  }
}
