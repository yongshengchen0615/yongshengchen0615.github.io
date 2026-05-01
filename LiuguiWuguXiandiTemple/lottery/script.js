const LOTTERY_CONFIG = {
  LIFF_ID: "2009806965-6dv1AJSV",
  GAS_WEB_APP_URL: "https://script.google.com/macros/s/AKfycbxvkPHXsB22b9hiFPtNY6m4IJ8wuc2rdXlEsbEPiudfXNhBsCuR64BPSxADIBsBK7tk/exec",
};

const state = {
  liffReady: false,
  profile: null,
  record: null,
  busy: false,
  toastTimer: null,
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  boot();
});

function cacheElements() {
  [
    "connectionBadge",
    "loginButton",
    "drawButton",
    "syncButton",
    "lotteryNumber",
    "numberState",
    "drawSubtitle",
    "avatarFallback",
    "avatarImage",
    "lineName",
    "lineUuid",
    "syncState",
    "drawState",
    "systemMessage",
    "toast",
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.loginButton.addEventListener("click", handleLogin);
  elements.drawButton.addEventListener("click", handleDraw);
  elements.syncButton.addEventListener("click", () => syncCurrentUser(true));
}

async function boot() {
  if (!hasRuntimeConfig()) {
    setConnection("error", "尚未設定");
    setSystemMessage("請先在 script.js 填入 LIFF_ID 與 GAS_WEB_APP_URL。");
    elements.loginButton.disabled = true;
    return;
  }

  if (!window.liff) {
    setConnection("error", "LIFF 載入失敗");
    setSystemMessage("LINE LIFF SDK 尚未載入，請確認網路與 script 標籤。");
    return;
  }

  try {
    setBusy(true, "啟動 LINE");
    await liff.init({
      liffId: LOTTERY_CONFIG.LIFF_ID,
      withLoginOnExternalBrowser: true,
    });
    state.liffReady = true;

    if (!liff.isLoggedIn()) {
      setConnection("idle", "尚未登入");
      setSystemMessage("請先用 LINE 登入。");
      return;
    }

    await loadLineProfile();
    await syncCurrentUser(false);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function handleLogin() {
  try {
    if (!state.liffReady) {
      await boot();
      if (!state.liffReady) return;
    }

    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href.split("#")[0] });
      return;
    }

    await loadLineProfile();
    await syncCurrentUser(true);
  } catch (error) {
    showError(error);
  }
}

async function loadLineProfile() {
  const profile = await liff.getProfile();
  state.profile = {
    uuid: profile.userId,
    lineName: profile.displayName || "LINE 使用者",
    pictureUrl: profile.pictureUrl || "",
    idToken: typeof liff.getIDToken === "function" ? liff.getIDToken() || "" : "",
  };
  renderProfile();
}

async function syncCurrentUser(showToastOnSuccess) {
  requireProfile();
  setBusy(true, "同步資料");

  try {
    const record = await gasRequest("syncUser", state.profile);
    state.record = record;
    renderRecord(record, { animate: false });
    setConnection("ready", "已同步");
    setSystemMessage(record.hasDrawn ? "已找到你先前抽取的摸彩號碼。" : "使用者資料已寫入 GAS，可以開始抽取摸彩號碼。");
    if (showToastOnSuccess) showToast("資料已同步", "success");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function handleDraw() {
  requireProfile();
  if (state.record && state.record.hasDrawn) {
    renderRecord(state.record, { animate: false });
    return;
  }

  setBusy(true, "抽取中");
  elements.drawButton.disabled = true;
  elements.numberState.textContent = "正在確認 GAS 內是否有重複號碼";
  startRollingNumber();

  try {
    const record = await gasRequest("drawNumber", state.profile);
    state.record = record;
    renderRecord(record, { animate: true });
    setConnection("ready", "已完成");
    setSystemMessage(record.alreadyDrawn ? "你已經抽取過，系統顯示原本的摸彩號碼。" : "摸彩號碼已產生並寫入 GAS。");
  } catch (error) {
    stopRollingNumber();
    renderRecord(state.record, { animate: false });
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function gasRequest(action, payload) {
  const response = await fetch(LOTTERY_CONFIG.GAS_WEB_APP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({ action, payload }),
  });

  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(result.message || "GAS 請求失敗");
  }

  return result.data;
}

function renderProfile() {
  if (!state.profile) return;

  elements.lineName.textContent = state.profile.lineName;
  elements.lineUuid.textContent = state.profile.uuid;

  if (state.profile.pictureUrl) {
    elements.avatarImage.src = state.profile.pictureUrl;
    elements.avatarImage.hidden = false;
    elements.avatarFallback.hidden = true;
  } else {
    elements.avatarImage.hidden = true;
    elements.avatarFallback.hidden = false;
  }

  elements.loginButton.disabled = true;
  elements.syncButton.disabled = false;
}

function renderRecord(record, options = {}) {
  if (!record) {
    elements.lotteryNumber.textContent = "------";
    elements.numberState.textContent = "等待 LINE 登入";
    elements.syncState.textContent = "尚未同步";
    elements.drawState.textContent = "尚未抽取";
    elements.drawButton.disabled = true;
    return;
  }

  elements.syncState.textContent = "已寫入 GAS";

  if (record.hasDrawn) {
    const number = formatLotteryNumber(record.lotteryNumber);
    stopRollingNumber();
    if (options.animate) {
      animateFinalNumber(number);
    } else {
      elements.lotteryNumber.textContent = number;
    }
    elements.numberState.textContent = record.alreadyDrawn ? "你已經抽取過，這是原本號碼" : "此號碼已保留給你";
    elements.drawState.textContent = "已抽取";
    elements.drawButton.textContent = "已完成抽號";
    elements.drawButton.disabled = true;
    return;
  }

  stopRollingNumber();
  elements.lotteryNumber.textContent = "------";
  elements.numberState.textContent = "尚未抽取";
  elements.drawState.textContent = "尚未抽取";
  elements.drawButton.textContent = "抽取摸彩號碼";
  elements.drawButton.disabled = state.busy;
}

function setBusy(isBusy, label) {
  state.busy = isBusy;
  document.body.classList.toggle("is-busy", isBusy);

  if (isBusy) {
    setConnection("busy", label || "處理中");
  }

  if (elements.drawButton) {
    elements.drawButton.disabled = isBusy || !state.record || state.record.hasDrawn;
  }
  if (elements.syncButton) {
    elements.syncButton.disabled = isBusy || !state.profile;
  }
  if (elements.loginButton) {
    elements.loginButton.disabled = isBusy || Boolean(state.profile) || !hasRuntimeConfig();
  }
}

function setConnection(stateName, label) {
  elements.connectionBadge.dataset.state = stateName;
  elements.connectionBadge.textContent = label;
}

function setSystemMessage(message) {
  elements.systemMessage.textContent = message;
}

function showToast(message, type = "info") {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.type = type;
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2800);
}

function showError(error) {
  const message = error && error.message ? error.message : "發生未知錯誤";
  setConnection("error", "發生錯誤");
  setSystemMessage(message);
  showToast(message, "error");
}

function requireProfile() {
  if (!state.profile || !state.profile.uuid) {
    throw new Error("尚未取得 LINE 使用者資料");
  }
}

function hasRuntimeConfig() {
  return Boolean(
    LOTTERY_CONFIG.LIFF_ID &&
      LOTTERY_CONFIG.GAS_WEB_APP_URL &&
      !LOTTERY_CONFIG.LIFF_ID.includes("請填入") &&
      !LOTTERY_CONFIG.GAS_WEB_APP_URL.includes("請填入")
  );
}

function formatLotteryNumber(value) {
  return String(value || "").padStart(6, "0");
}

let rollingTimer = null;

function startRollingNumber() {
  stopRollingNumber();
  rollingTimer = window.setInterval(() => {
    elements.lotteryNumber.textContent = String(100000 + Math.floor(Math.random() * 900000));
  }, 70);
}

function stopRollingNumber() {
  if (rollingTimer) {
    window.clearInterval(rollingTimer);
    rollingTimer = null;
  }
}

function animateFinalNumber(finalNumber) {
  let count = 0;
  const timer = window.setInterval(() => {
    count += 1;
    elements.lotteryNumber.textContent = count < 8
      ? String(100000 + Math.floor(Math.random() * 900000))
      : finalNumber;
    if (count >= 8) window.clearInterval(timer);
  }, 55);
}
