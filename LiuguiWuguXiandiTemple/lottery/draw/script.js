const DRAW_CONFIG = {
  GAS_WEB_APP_URL: "https://script.google.com/macros/s/AKfycbxvkPHXsB22b9hiFPtNY6m4IJ8wuc2rdXlEsbEPiudfXNhBsCuR64BPSxADIBsBK7tk/exec",
  ADMIN_TOKEN: "",
  WINNER_LIMIT: 20,
};

const state = {
  busy: false,
  board: null,
  showSettings: true,
  showHistory: true,
  rollingTimer: null,
  prizeRefreshTimer: null,
  toastTimer: null,
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  refreshBoard(false);
});

function cacheElements() {
  [
    "connectionBadge",
    "workspace",
    "settingsPanel",
    "historyPanel",
    "toggleSettingsButton",
    "toggleHistoryButton",
    "winnerNumber",
    "winnerName",
    "winnerPrize",
    "winnerTime",
    "drawButton",
    "refreshButton",
    "prizeName",
    "adminToken",
    "drawnCount",
    "winnerCount",
    "remainingCount",
    "totalCount",
    "systemMessage",
    "historyBadge",
    "winnerRows",
    "toast",
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.drawButton.addEventListener("click", handleDrawWinner);
  elements.refreshButton.addEventListener("click", () => refreshBoard(true));
  elements.prizeName.addEventListener("change", handlePrizeInput);
  elements.toggleSettingsButton.addEventListener("click", () => togglePanel("settings"));
  elements.toggleHistoryButton.addEventListener("click", () => togglePanel("history"));
  renderPanelVisibility();
}

async function refreshBoard(showToastOnSuccess) {
  setBusy(true, "同步中");

  try {
    const board = await gasRequest("getWinnerBoard", buildPayload());
    state.board = board;
    renderBoard(board);
    setConnection("ready", "已同步");
    setSystemMessage(getBoardMessage(board));
    if (showToastOnSuccess) showToast("名單已同步", "success");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function handleDrawWinner() {
  setBusy(true, "抽取中");
  startRollingNumber();
  setSystemMessage("正在依照獎項資格抽取名單。");

  try {
    const board = await gasRequest("drawWinner", buildPayload());
    state.board = board;
    stopRollingNumber();
    renderBoard(board, { animateCurrent: true });
    setConnection("ready", "已完成");
    setSystemMessage(board.currentWinner ? "中獎者已寫入 GAS。" : getBoardMessage(board));
    showToast("中獎紀錄已寫入 GAS", "success");
  } catch (error) {
    stopRollingNumber();
    renderBoard(state.board);
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function gasRequest(action, payload) {
  const response = await fetch(DRAW_CONFIG.GAS_WEB_APP_URL, {
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

function buildPayload() {
  return {
    prizeName: elements.prizeName.value.trim(),
    adminToken: elements.adminToken.value.trim() || DRAW_CONFIG.ADMIN_TOKEN,
    limit: DRAW_CONFIG.WINNER_LIMIT,
  };
}

function renderBoard(board, options = {}) {
  renderPrizeOptions(board && board.prizes, board && board.prizeName);
  renderStats(board && board.stats);
  renderWinnerRows(board && board.winners);

  if (board && board.currentWinner) {
    renderCurrentWinner(board.currentWinner, options.animateCurrent);
  } else if (!state.rollingTimer) {
    elements.winnerNumber.textContent = "------";
    elements.winnerNumber.classList.remove("is-final");
    elements.winnerName.textContent = "等待抽取";
    renderPrizeLabel();
    elements.winnerTime.textContent = "--";
  }

  updateButtons();
}

function renderCurrentWinner(winner, animate) {
  elements.winnerNumber.classList.remove("is-final");
  elements.winnerNumber.textContent = formatLotteryNumber(winner.lotteryNumber);
  elements.winnerName.textContent = winner.lineName || "未命名使用者";
  elements.winnerPrize.textContent = winner.winnerPrize || "現場抽獎";
  elements.winnerTime.textContent = winner.winnerAt || "--";

  if (animate) {
    window.requestAnimationFrame(() => {
      elements.winnerNumber.classList.add("is-final");
    });
  }
}

function renderStats(stats) {
  const values = stats || {
    totalUsers: 0,
    drawnNumbers: 0,
    winners: 0,
    prizeWinners: 0,
    remaining: 0,
    remainingSlots: 0,
  };

  elements.totalCount.textContent = values.totalUsers;
  elements.drawnCount.textContent = values.drawnNumbers;
  elements.winnerCount.textContent = values.prizeWinners || 0;
  elements.remainingCount.textContent = values.remainingSlots;
  elements.historyBadge.textContent = `${values.winners} 筆`;
  elements.historyBadge.dataset.state = values.winners > 0 ? "ready" : "idle";
}

function renderPrizeOptions(prizes, currentPrizeName) {
  const rows = prizes || [];
  const selectedPrizeName = elements.prizeName.value.trim() || currentPrizeName || "";

  if (!rows.length) {
    elements.prizeName.innerHTML = '<option value="">請先到管理後台設定獎項</option>';
    return;
  }

  elements.prizeName.innerHTML = rows.map((prize) => {
    const isSelected = prize.prizeName === selectedPrizeName;
    const remaining = Number(prize.remainingSlots || 0);
    return `
      <option value="${escapeHtml(prize.prizeName)}" ${isSelected ? "selected" : ""}>
        ${escapeHtml(prize.prizeName)}（剩餘 ${escapeHtml(remaining)}）
      </option>
    `;
  }).join("");

  if (!elements.prizeName.value && rows[0]) {
    elements.prizeName.value = rows[0].prizeName;
  }
}

function renderWinnerRows(winners) {
  const rows = winners || [];
  if (!rows.length) {
    elements.winnerRows.innerHTML = '<tr><td class="empty-row" colspan="5">尚無中獎紀錄</td></tr>';
    return;
  }

  elements.winnerRows.innerHTML = rows.map((winner, index) => `
    <tr>
      <td>${index + 1}</td>
      <td class="number-cell">${escapeHtml(formatLotteryNumber(winner.lotteryNumber))}</td>
      <td>${escapeHtml(winner.lineName || "未命名使用者")}</td>
      <td>${escapeHtml(winner.winnerPrize || "現場抽獎")}</td>
      <td>${escapeHtml(winner.winnerAt || "--")}</td>
    </tr>
  `).join("");
}

function renderPrizeLabel() {
  if (state.board && state.board.currentWinner) return;
  elements.winnerPrize.textContent = elements.prizeName.value.trim() || "現場抽獎";
}

function setBusy(isBusy, label) {
  state.busy = isBusy;
  if (isBusy) setConnection("busy", label || "處理中");
  updateButtons();
}

function updateButtons() {
  const remaining = state.board && state.board.stats ? Number(state.board.stats.remaining) : 0;
  const hasPrize = Boolean(elements.prizeName.value.trim());
  elements.drawButton.disabled = state.busy || !hasPrize || remaining <= 0;
  elements.refreshButton.disabled = state.busy;
  elements.prizeName.disabled = state.busy;
  elements.adminToken.disabled = state.busy;
}

function togglePanel(panelName) {
  if (panelName === "settings") {
    state.showSettings = !state.showSettings;
  }
  if (panelName === "history") {
    state.showHistory = !state.showHistory;
  }
  renderPanelVisibility();
}

function renderPanelVisibility() {
  elements.settingsPanel.hidden = !state.showSettings;
  elements.historyPanel.hidden = !state.showHistory;
  elements.workspace.classList.toggle("is-settings-hidden", !state.showSettings);
  elements.workspace.classList.toggle("is-history-hidden", !state.showHistory);
  updateToggleButton(elements.toggleSettingsButton, state.showSettings, "抽獎設定");
  updateToggleButton(elements.toggleHistoryButton, state.showHistory, "中獎紀錄");
}

function updateToggleButton(button, isVisible, label) {
  button.classList.toggle("is-active", isVisible);
  button.setAttribute("aria-pressed", String(isVisible));
  button.textContent = isVisible ? `隱藏${label}` : `顯示${label}`;
}

function setConnection(stateName, label) {
  elements.connectionBadge.dataset.state = stateName;
  elements.connectionBadge.textContent = label;
}

function setSystemMessage(message) {
  elements.systemMessage.textContent = message;
}

function getBoardMessage(board) {
  if (!board || !board.stats) return "尚未取得 GAS 名單。";
  const prizeName = board.prizeName || elements.prizeName.value.trim() || "未設定獎項";
  if (!board.prizeConfig) return `請先在管理後台設定「${prizeName}」的中獎數量。`;
  if (board.stats.drawnNumbers === 0) return "目前沒有已領號碼的使用者。";
  if (board.stats.remainingSlots === 0) return `「${prizeName}」已達設定中獎數量。`;
  if (board.stats.remaining === 0) return `目前沒有符合「${prizeName}」的可抽名單。`;
  return `「${prizeName}」剩餘 ${board.stats.remainingSlots} 個名額，可抽名單 ${board.stats.remaining} 位。`;
}

function handlePrizeInput() {
  renderPrizeLabel();
  window.clearTimeout(state.prizeRefreshTimer);
  state.prizeRefreshTimer = window.setTimeout(() => {
    if (!state.busy) refreshBoard(false);
  }, 420);
}

function showToast(message, type = "info") {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.type = type;
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2600);
}

function showError(error) {
  const message = error && error.message ? error.message : "發生未知錯誤";
  setConnection("error", "發生錯誤");
  setSystemMessage(message);
  showToast(message, "error");
}

function startRollingNumber() {
  stopRollingNumber();
  elements.winnerName.textContent = "抽取中";
  elements.winnerTime.textContent = "--";
  elements.winnerNumber.classList.remove("is-final");
  state.rollingTimer = window.setInterval(() => {
    elements.winnerNumber.textContent = String(100000 + Math.floor(Math.random() * 900000));
  }, 58);
}

function stopRollingNumber() {
  if (!state.rollingTimer) return;
  window.clearInterval(state.rollingTimer);
  state.rollingTimer = null;
}

function formatLotteryNumber(value) {
  return String(value || "").padStart(6, "0");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
