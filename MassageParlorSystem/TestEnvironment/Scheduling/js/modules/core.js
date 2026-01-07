/**
 * core.js
 *
 * 這裡放「純工具函式」：
 * - URL/query 組合
 * - localStorage JSON 讀寫
 * - 文字正規化
 * - GAS 顏色 token 解析與套用
 * - console.log 過濾（PanelScan 訊息）
 *
 * 目標：讓其他模組只處理「業務邏輯」，不要重複寫工具碼。
 */

/* =========================
 * Console filter
 * ========================= */
export function installConsoleFilter() {
  // ==== 過濾 PanelScan 錯誤訊息（只動前端，不改腳本貓）====
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

/* =========================
 * URL utils
 * ========================= */
export function withQuery(base, extraQuery) {
  const b = String(base || "").trim();
  const q = String(extraQuery || "").trim();
  if (!b) return "";
  if (!q) return b;
  return b + (b.includes("?") ? "&" : "?") + q.replace(/^\?/, "");
}

/**
 * 取得 URL query string 參數。
 * @param {string} k 參數名稱。
 * @returns {string} 找不到則回傳空字串。
 */
export function getQueryParam(k) {
  try {
    const u = new URL(location.href);
    return u.searchParams.get(k) || "";
  } catch {
    return "";
  }
}

/* =========================
 * localStorage JSON utils
 * ========================= */
export function readJsonLS(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

/**
 * 寫入 localStorage（JSON.stringify）。
 * @param {string} key localStorage key。
 * @param {any} value 要儲存的值（會 JSON.stringify）。
 */
export function writeJsonLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/* =========================
 * Text normalize
 * ========================= */
export function normalizeText(s) {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}

/**
 * 基本 HTML escape（避免 innerHTML 注入）。
 * @param {string} s 原始字串。
 * @returns {string} escape 後字串。
 */
export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* =========================
 * Timing utils
 * ========================= */
/**
 * Debounce：在一段時間內多次呼叫只會執行最後一次。
 * @template {(...args:any[])=>any} F
 * @param {F} fn
 * @param {number} waitMs
 * @returns {F}
 */
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

/* =========================
 * Color token helpers
 * ========================= */
export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/**
 * 目前是否為亮色主題。
 * @returns {boolean}
 */
export function isLightTheme() {
  return (document.documentElement.getAttribute("data-theme") || "dark") === "light";
}

export function hexToRgb(hex) {
  if (!hex) return null;
  let s = String(hex).replace("#", "").trim();
  if (s.length === 3) s = s.split("").map((ch) => ch + ch).join("");
  if (s.length !== 6) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return { r, g, b };
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
  const tokens = String(str).split(/\s+/).filter(Boolean);

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
    const h = normalizeHex6(String(str));
    if (h) hex = h;
  }

  return { hex, opacity };
}

/**
 * 套用 GAS token 到「狀態 pill」
 * - bgToken：背景 token（例 bg-CFF0000 bg-opacity-20）
 * - textToken：文字 token（例 text-CFF0000 text-opacity-90）
 */
export function applyPillFromTokens(pillEl, bgToken, textToken) {
  if (!pillEl) return;

  pillEl.style.background = "";
  pillEl.style.border = "";
  pillEl.style.color = "";

  const bg = parseColorToken(bgToken);
  if (bg.hex) {
    const rgb = hexToRgb(bg.hex);
    if (rgb) {
      let aBg = bg.opacity;
      if (aBg == null) aBg = isLightTheme() ? 0.10 : 0.16;
      aBg = clamp(aBg, 0.03, 0.35);

      pillEl.style.background = `rgba(${rgb.r},${rgb.g},${rgb.b},${aBg})`;
      const aBd = clamp(aBg + (isLightTheme() ? 0.12 : 0.18), 0.12, 0.55);
      pillEl.style.border = `1px solid rgba(${rgb.r},${rgb.g},${rgb.b},${aBd})`;
    }
  }

  const fg = parseColorToken(textToken);
  if (fg.hex) {
    const rgb = hexToRgb(fg.hex);
    if (rgb) {
      const minAlpha = isLightTheme() ? 0.85 : 0.70;
      let aText = fg.opacity == null ? 1 : fg.opacity;
      aText = clamp(aText, minAlpha, 1);
      pillEl.style.color = aText < 1 ? `rgba(${rgb.r},${rgb.g},${rgb.b},${aText})` : fg.hex;
    }
  }

  if (!bg.hex && fg.hex) {
    const rgb = hexToRgb(fg.hex);
    if (rgb) {
      const aBg = isLightTheme() ? 0.08 : 0.14;
      pillEl.style.background = `rgba(${rgb.r},${rgb.g},${rgb.b},${aBg})`;
      const aBd = isLightTheme() ? 0.22 : 0.32;
      pillEl.style.border = `1px solid rgba(${rgb.r},${rgb.g},${rgb.b},${aBd})`;
    }
  }
}

/** 左側色條用：優先用背景 token，沒有再用文字 token */
export function tokenToStripe(bgToken, textToken) {
  const bg = parseColorToken(bgToken);
  if (bg.hex) {
    const rgb = hexToRgb(bg.hex);
    if (rgb) return `rgba(${rgb.r},${rgb.g},${rgb.b},0.90)`;
  }
  const fg = parseColorToken(textToken);
  if (fg.hex) {
    const rgb = hexToRgb(fg.hex);
    if (rgb) return `rgba(${rgb.r},${rgb.g},${rgb.b},0.90)`;
  }
  return "";
}

/**
 * 一般文字顏色：吃 GAS token
 * - token: text-Cxxxxxx / text-opacity-xx / #xxxxxx...
 */
export function applyTextColorFromToken(el, token) {
  if (!el) return;
  el.style.color = "";

  const fg = parseColorToken(token);
  if (!fg.hex) return;

  const rgb = hexToRgb(fg.hex);
  if (!rgb) return;

  const minAlpha = isLightTheme() ? 0.90 : 0.78;
  let aText = fg.opacity == null ? 1 : fg.opacity;
  aText = clamp(aText, minAlpha, 1);

  el.style.color = aText < 1 ? `rgba(${rgb.r},${rgb.g},${rgb.b},${aText})` : fg.hex;
}

/**
 * 強化版文字色（只給「順序」用）
 * - 讓字更清楚、加粗、加陰影
 */
export function applyTextColorFromTokenStrong(el, token) {
  if (!el) return;
  el.style.color = "";

  const fg = parseColorToken(token);
  if (!fg.hex) return;

  const rgb = hexToRgb(fg.hex);
  if (!rgb) return;

  const minAlpha = isLightTheme() ? 0.97 : 0.94;
  let aText = fg.opacity == null ? 1 : fg.opacity;
  aText = clamp(aText, minAlpha, 1);

  el.style.color = aText < 1 ? `rgba(${rgb.r},${rgb.g},${rgb.b},${aText})` : fg.hex;
  el.style.fontWeight = "900";
  el.style.textShadow = isLightTheme()
    ? "0 1px 0 rgba(0,0,0,0.10)"
    : "0 1px 0 rgba(0,0,0,0.55), 0 0 10px rgba(255,255,255,0.10)";
}
