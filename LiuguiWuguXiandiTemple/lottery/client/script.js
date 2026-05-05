const LOTTERY_CONFIG = {
  LIFF_ID: "2009806965-6dv1AJSV",
  GAS_WEB_APP_URL: "https://script.google.com/macros/s/AKfycbxvkPHXsB22b9hiFPtNY6m4IJ8wuc2rdXlEsbEPiudfXNhBsCuR64BPSxADIBsBK7tk/exec",
  TOKEN_REFRESH_BUFFER_SECONDS: 60,
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
    "drawButton",
    "syncButton",
    "lotteryNumber",
    "numberState",
    "winnerPrizeCard",
    "winnerPrizeName",
    "winnerPrizeTime",
    "drawSubtitle",
    "avatarFallback",
    "avatarImage",
    "lineName",
    "lineUuid",
    "syncState",
    "drawState",
    "winnerPrizeRow",
    "winnerPrizeDetail",
    "systemMessage",
    "toast",
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.drawButton.addEventListener("click", handleDraw);
  elements.syncButton.addEventListener("click", () => syncCurrentUser(true));
}

async function boot() {
  if (!hasRuntimeConfig()) {
    setConnection("error", "尚未設定");
    setSystemMessage("請先在 script.js 填入 LIFF_ID 與 GAS_WEB_APP_URL。");
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
      setConnection("busy", "前往登入");
      setSystemMessage("正在前往 LINE 登入。");
      liff.login({ redirectUri: window.location.href.split("#")[0] });
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

async function loadLineProfile() {
  const profile = await liff.getProfile();
  const idToken = getLineIdToken();
  const decodedToken = getDecodedLineIdToken();
  validateLineToken_(idToken, decodedToken);

  state.profile = {
    uuid: profile.userId,
    lineName: profile.displayName || "LINE 使用者",
    pictureUrl: profile.pictureUrl || "",
    idToken,
  };
  renderProfile();
}

async function syncCurrentUser(showToastOnSuccess) {
  requireProfile();
  setBusy(true, "同步資料");

  try {
    const record = await gasRequest("syncUser", getFreshLinePayload());
    state.record = record;
    renderRecord(record);
    setConnection("ready", "已同步");
    setSystemMessage(getRecordMessage(record));
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
    renderRecord(state.record);
    return;
  }

  setBusy(true, "抽取中");
  elements.drawButton.disabled = true;
  elements.numberState.textContent = "正在確認 GAS 內是否有重複號碼";
  elements.lotteryNumber.textContent = "------";

  try {
    const record = await gasRequest("drawNumber", getFreshLinePayload());
    state.record = record;
    renderRecord(record);
    setConnection("ready", "已完成");
    setSystemMessage(getRecordMessage(record));
  } catch (error) {
    renderRecord(state.record);
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
    if (isExpiredTokenMessage(result.message)) {
      restartLineLogin("LINE 登入已過期，正在重新登入。");
    }
    throw new Error(result.message || "GAS 請求失敗");
  }

  return result.data;
}

function getFreshLinePayload() {
  requireProfile();

  const idToken = getLineIdToken();
  const decodedToken = getDecodedLineIdToken();
  validateLineToken_(idToken, decodedToken);

  state.profile.idToken = idToken;
  return {
    uuid: state.profile.uuid,
    lineName: state.profile.lineName,
    pictureUrl: state.profile.pictureUrl,
    idToken,
  };
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

  elements.syncButton.disabled = false;
}

function renderRecord(record) {
  if (!record) {
    elements.lotteryNumber.textContent = "------";
    elements.numberState.textContent = state.profile ? "尚未抽取" : "正在啟動 LINE";
    elements.syncState.textContent = "尚未同步";
    elements.drawState.textContent = "尚未抽取";
    renderWinnerPrize(null);
    elements.drawButton.disabled = true;
    return;
  }

  elements.syncState.textContent = "已寫入 GAS";
  renderWinnerPrize(record);

  if (record.hasDrawn) {
    const number = formatLotteryNumber(record.lotteryNumber);
    elements.lotteryNumber.textContent = number;
    elements.numberState.textContent = getNumberStateLabel(record);
    elements.drawState.textContent = hasWinnerPrize(record) ? "已中獎" : "已抽取";
    elements.drawButton.textContent = "已完成抽號";
    elements.drawButton.disabled = true;
    return;
  }

  elements.lotteryNumber.textContent = "------";
  elements.numberState.textContent = "尚未抽取";
  elements.drawState.textContent = "尚未抽取";
  elements.drawButton.textContent = "抽取摸彩號碼";
  elements.drawButton.disabled = state.busy;
}

function renderWinnerPrize(record) {
  const hasWon = hasWinnerPrize(record);
  elements.winnerPrizeCard.hidden = !hasWon;
  elements.winnerPrizeRow.hidden = !hasWon;

  if (!hasWon) {
    elements.winnerPrizeName.textContent = "--";
    elements.winnerPrizeTime.textContent = "--";
    elements.winnerPrizeDetail.textContent = "--";
    return;
  }

  elements.winnerPrizeName.textContent = record.winnerPrize;
  elements.winnerPrizeTime.textContent = record.winnerAt ? `中獎時間 ${record.winnerAt}` : "中獎時間尚未同步";
  elements.winnerPrizeDetail.textContent = record.winnerPrize;
}

function getNumberStateLabel(record) {
  if (hasWinnerPrize(record)) {
    return `恭喜中獎：${record.winnerPrize}`;
  }
  return record.alreadyDrawn ? "你已經抽取過，這是原本號碼" : "此號碼已保留給你";
}

function getRecordMessage(record) {
  if (hasWinnerPrize(record)) {
    return `恭喜中獎，獎項為「${record.winnerPrize}」。`;
  }
  if (record && record.hasDrawn) {
    return record.alreadyDrawn ? "你已經抽取過，系統顯示原本的摸彩號碼。" : "已找到你先前抽取的摸彩號碼。";
  }
  return "使用者資料已寫入 GAS，可以開始抽取摸彩號碼。";
}

function hasWinnerPrize(record) {
  return Boolean(record && String(record.winnerPrize || "").trim());
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

function validateLineToken_(idToken, decodedToken) {
  const expectedChannelId = getLineChannelId();

  if (!idToken) {
    throw new Error("缺少 LINE idToken，請在 LINE Developers Console 的 LIFF App 啟用 openid scope 後重新登入。");
  }

  if (decodedToken && decodedToken.aud && expectedChannelId && decodedToken.aud !== expectedChannelId) {
    throw new Error("LINE 登入驗證失敗：LIFF Channel ID 與 idToken 不一致，請檢查 LIFF_ID 與 GAS 的 LINE_CHANNEL_ID。");
  }

  if (isDecodedTokenExpired(decodedToken)) {
    restartLineLogin("LINE 登入已過期，正在重新登入。");
    throw new Error("LINE 登入已過期，請重新登入。");
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

function getLineIdToken() {
  if (typeof liff.getIDToken !== "function") return "";
  return liff.getIDToken() || "";
}

function getDecodedLineIdToken() {
  if (typeof liff.getDecodedIDToken !== "function") return null;
  return liff.getDecodedIDToken();
}

function getLineChannelId() {
  return LOTTERY_CONFIG.LIFF_ID.split("-")[0] || "";
}

function isDecodedTokenExpired(decodedToken) {
  if (!decodedToken || !decodedToken.exp) return false;
  const bufferMs = LOTTERY_CONFIG.TOKEN_REFRESH_BUFFER_SECONDS * 1000;
  return decodedToken.exp * 1000 <= Date.now() + bufferMs;
}

function isExpiredTokenMessage(message) {
  return /idtoken expired|id token expired|token expired/i.test(String(message || ""));
}

function restartLineLogin(message) {
  setConnection("idle", "重新登入");
  setSystemMessage(message);
  showToast(message, "error");

  window.setTimeout(() => {
    if (window.liff && typeof liff.logout === "function" && liff.isLoggedIn()) {
      liff.logout();
    }
    if (window.liff && typeof liff.login === "function") {
      liff.login({ redirectUri: window.location.href.split("#")[0] });
    }
  }, 300);
}

function formatLotteryNumber(value) {
  return String(value || "").padStart(6, "0");
}
