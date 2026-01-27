function boolish(v, fallback = false) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
  if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  return fallback;
}

function safeGetLiff_() {
  const w = typeof window !== "undefined" ? window : null;
  const l = w && w.liff;
  return l || null;
}

export function isLiffReady() {
  return Boolean(safeGetLiff_());
}

export async function initLiffIfConfigured({ liffId, autoLogin }) {
  const id = String(liffId || "").trim();
  if (!id) {
    return {
      enabled: false,
      available: false,
      inClient: false,
      loggedIn: false,
      displayName: "",
      context: null,
    };
  }

  const liff = safeGetLiff_();
  if (!liff || typeof liff.init !== "function") {
    return {
      enabled: true,
      available: false,
      inClient: false,
      loggedIn: false,
      displayName: "",
      context: null,
      error: "LIFF_SDK_NOT_LOADED",
    };
  }

  try {
    await liff.init({ liffId: id });
  } catch (e) {
    return {
      enabled: true,
      available: true,
      inClient: false,
      loggedIn: false,
      displayName: "",
      context: null,
      error: "LIFF_INIT_FAILED: " + String(e),
    };
  }

  const inClient = typeof liff.isInClient === "function" ? Boolean(liff.isInClient()) : false;
  const loggedIn = typeof liff.isLoggedIn === "function" ? Boolean(liff.isLoggedIn()) : false;

  if (boolish(autoLogin, false) && !loggedIn && typeof liff.login === "function") {
    try {
      liff.login({ redirectUri: window.location.href });
      return {
        enabled: true,
        available: true,
        inClient,
        loggedIn: false,
        displayName: "",
        context: null,
        loginTriggered: true,
      };
    } catch (e) {
      // fall through
      return {
        enabled: true,
        available: true,
        inClient,
        loggedIn: false,
        displayName: "",
        context: null,
        error: "LIFF_LOGIN_FAILED: " + String(e),
      };
    }
  }

  let displayName = "";
  if (loggedIn && typeof liff.getProfile === "function") {
    try {
      const prof = await liff.getProfile();
      displayName = String(prof && prof.displayName ? prof.displayName : "").trim();
    } catch {
      // ignore
    }
  }

  let context = null;
  if (typeof liff.getContext === "function") {
    try {
      context = liff.getContext();
    } catch {
      context = null;
    }
  }

  return {
    enabled: true,
    available: true,
    inClient,
    loggedIn,
    displayName,
    context,
  };
}
