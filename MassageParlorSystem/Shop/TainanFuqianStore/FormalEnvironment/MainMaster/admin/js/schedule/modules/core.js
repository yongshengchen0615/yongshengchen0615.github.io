/* copied core.js from Scheduling (trimmed as-is) */
export function installConsoleFilter() {
  const rawLog = console.log;
  console.log = function (...args) {
    try {
      const first = args[0];
      const msg = typeof first === "string" ? first : "";
      if (msg.includes("[PanelScan]") && msg.includes("找不到 身體 / 腳底 panel")) return;
    } catch (e) {}
    rawLog.apply(console, args);
  };
}

export function withQuery(base, extraQuery) {
  const b = String(base || "").trim();
  const q = String(extraQuery || "").trim();
  if (!b) return "";
  if (!q) return b;
  return b + (b.includes("?") ? "&" : "?") + q.replace(/^\?/, "");
}

export function getQueryParam(k) {
  try {
    const u = new URL(location.href);
    return u.searchParams.get(k) || "";
  } catch {
    return "";
  }
}

export function readJsonLS(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

export function writeJsonLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function normalizeText(s) {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function debounce(fn, waitMs) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn.apply(this, args);
    }, Math.max(0, Number(waitMs) || 0));
  };
}

export function fmtRemainingRaw(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function deriveStatusClass(status, remaining) {
  const s = normalizeText(status || "");
  const n = Number(remaining);

  if (s.includes("排班")) return "status-shift";
  if (s.includes("工作")) return "status-busy";
  if (s.includes("預約")) return "status-booked";
  if (s.includes("空閒") || s.includes("待命") || s.includes("準備") || s.includes("備牌")) return "status-free";
  if (!Number.isNaN(n) && n < 0) return "status-busy";
  return "status-other";
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function isLightTheme() {
  return (document.documentElement.getAttribute("data-theme") || "dark") === "light";
}

export function hexToRgb(hex) {
  if (!hex) return null;
  const k = String(hex).toLowerCase();
  if (!hexToRgb._cache) hexToRgb._cache = new Map();
  if (hexToRgb._cache.has(k)) return hexToRgb._cache.get(k);

  let s = String(hex).replace("#", "").trim();
  if (s.length === 3) s = s.split("").map((ch) => ch + ch).join("");
  if (s.length !== 6) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  const out = { r, g, b };
  const CACHE_MAX = 1024;
  if (hexToRgb._cache.size >= CACHE_MAX) hexToRgb._cache.clear();
  hexToRgb._cache.set(k, out);
  return out;
}

export function getRgbaString(hex, alpha) {
  if (!hex) return null;
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const a = Number.isFinite(Number(alpha)) ? Number(alpha) : 1;
  const key = `${hex}|${a}`;
  if (!getRgbaString._cache) getRgbaString._cache = new Map();
  if (getRgbaString._cache.has(key)) return getRgbaString._cache.get(key);
  const s = `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
  const CACHE_MAX = 2048;
  if (getRgbaString._cache.size >= CACHE_MAX) getRgbaString._cache.clear();
  getRgbaString._cache.set(key, s);
  return s;
}

export function normalizeHex6(maybe) {
  if (!maybe) return null;
  let s = String(maybe).trim();

  const mBracket = s.match(/\[#([0-9a-fA-F]{6})\]/);
  if (mBracket) return "#" + mBracket[1];

  const mHash = s.match(/#([0-9a-fA-F]{6})/);
  if (mHash) return "#" + mHash[1];

  const mC = s.match(/(?:^|(?:text|bg)-)C?([0-9a-fA-F]{6})$/);
  if (mC) return "#" + mC[1];

  const mIn = s.match(/(?:text|bg)-C([0-9a-fA-F]{6})/);
  if (mIn) return "#" + mIn[1];

  return null;
}

export function parseOpacityToken(token) {
  if (!token) return null;
  const t = String(token).trim();

  let m = t.match(/(?:text-opacity-|bg-opacity-|opacity-)(\d{1,3})/);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isNaN(n)) return clamp(n / 100, 0, 1);
  }

  m = t.match(/\/(\d{1,3})$/);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isNaN(n)) return clamp(n / 100, 0, 1);
  }

  m = t.match(/^(0?\.\d+|1(?:\.0+)?)$/);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isNaN(n)) return clamp(n, 0, 1);
  }

  return null;
}

export function parseColorToken(str) {
  if (!str) return { hex: null, opacity: null };

  const key = String(str);
  if (parseColorToken._cache && parseColorToken._cache.has(key)) {
    return parseColorToken._cache.get(key);
  }

  const tokens = key.split(/\s+/).filter(Boolean);

  let hex = null;
  let opacity = null;

  for (const tk of tokens) {
    if (!hex) {
      const h = normalizeHex6(tk);
      if (h) hex = h;
    }
    if (opacity == null) {
      const o = parseOpacityToken(tk);
      if (o != null) opacity = o;
    }
  }

  if (!hex) {
    const h = normalizeHex6(key);
    if (h) hex = h;
  }

  const out = { hex, opacity };
  if (!parseColorToken._cache) parseColorToken._cache = new Map();
  const CACHE_MAX = 512;
  if (parseColorToken._cache.size >= CACHE_MAX) {
    parseColorToken._cache.clear();
  }
  parseColorToken._cache.set(key, out);
  return out;
}

export function applyPillFromTokens(pillEl, bgToken, textToken) {
  if (!pillEl) return;
  pillEl.style.background = "";
  pillEl.style.border = "";
  pillEl.style.color = "";

  const bg = parseColorToken(bgToken);
  if (bg.hex) {
    let aBg = bg.opacity;
    if (aBg == null) aBg = isLightTheme() ? 0.10 : 0.16;
    aBg = clamp(aBg, 0.03, 0.35);

    const bgRgba = getRgbaString(bg.hex, aBg);
    if (bgRgba) pillEl.style.background = bgRgba;

    const aBd = clamp(aBg + (isLightTheme() ? 0.12 : 0.18), 0.12, 0.55);
    const bdRgba = getRgbaString(bg.hex, aBd);
    if (bdRgba) pillEl.style.border = `1px solid ${bdRgba}`;
  }

  const fg = parseColorToken(textToken);
  if (fg.hex) {
    const minAlpha = isLightTheme() ? 0.85 : 0.70;
    let aText = fg.opacity == null ? 1 : fg.opacity;
    aText = clamp(aText, minAlpha, 1);

    const txtRgba = getRgbaString(fg.hex, aText);
    if (txtRgba) pillEl.style.color = aText < 1 ? txtRgba : fg.hex;
  }

  if (!bg.hex && fg.hex) {
    const aBg = isLightTheme() ? 0.08 : 0.14;
    const bgRgba = getRgbaString(fg.hex, aBg);
    if (bgRgba) pillEl.style.background = bgRgba;

    const aBd = isLightTheme() ? 0.22 : 0.32;
    const bdRgba = getRgbaString(fg.hex, aBd);
    if (bdRgba) pillEl.style.border = `1px solid ${bdRgba}`;
  }
}

export function tokenToStripe(bgToken, textToken) {
  const bg = parseColorToken(bgToken);
  if (bg.hex) {
    const s = getRgbaString(bg.hex, 0.9);
    if (s) return s;
  }
  const fg = parseColorToken(textToken);
  if (fg.hex) {
    const s = getRgbaString(fg.hex, 0.9);
    if (s) return s;
  }
  return "";
}

export function applyTextColorFromToken(el, token) {
  if (!el) return;
  el.style.color = "";
  const fg = parseColorToken(token);
  if (!fg.hex) return;

  const minAlpha = isLightTheme() ? 0.90 : 0.78;
  let aText = fg.opacity == null ? 1 : fg.opacity;
  aText = clamp(aText, minAlpha, 1);

  const rgba = getRgbaString(fg.hex, aText);
  if (rgba) el.style.color = aText < 1 ? rgba : fg.hex;
}

export function applyTextColorFromTokenStrong(el, token) {
  if (!el) return;
  el.style.color = "";

  const fg = parseColorToken(token);
  if (!fg.hex) return;
  const minAlpha = isLightTheme() ? 0.97 : 0.94;
  let aText = fg.opacity == null ? 1 : fg.opacity;
  aText = clamp(aText, minAlpha, 1);
  const rgba = getRgbaString(fg.hex, aText);
  if (rgba) el.style.color = aText < 1 ? rgba : fg.hex;
}
