const ADMIN_CONFIG = {
  GAS_WEB_APP_URL: "https://script.google.com/macros/s/AKfycbxvkPHXsB22b9hiFPtNY6m4IJ8wuc2rdXlEsbEPiudfXNhBsCuR64BPSxADIBsBK7tk/exec",
  ADMIN_TOKEN: "",
};

const state = {
  busy: false,
  users: [],
  prizes: [],
  stats: null,
  selectedUuids: new Set(),
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
    "prizeName",
    "winnerCountInput",
    "prizeOptions",
    "adminToken",
    "totalCount",
    "drawnCount",
    "prizeCount",
    "selectedCount",
    "savePrizeButton",
    "setGuaranteeButton",
    "clearGuaranteeButton",
    "refreshButton",
    "systemMessage",
    "listSummary",
    "searchInput",
    "selectEligibleButton",
    "clearSelectionButton",
    "prizeList",
    "userRows",
    "toast",
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", () => refreshBoard(true));
  elements.savePrizeButton.addEventListener("click", savePrizeConfig);
  elements.setGuaranteeButton.addEventListener("click", setGuaranteedPrize);
  elements.clearGuaranteeButton.addEventListener("click", clearGuaranteedPrize);
  elements.searchInput.addEventListener("input", renderUsers);
  elements.prizeName.addEventListener("input", handlePrizeNameInput);
  elements.winnerCountInput.addEventListener("input", updateActions);
  elements.selectEligibleButton.addEventListener("click", selectPendingUsers);
  elements.clearSelectionButton.addEventListener("click", clearSelection);
  elements.userRows.addEventListener("change", handleRowChange);
}

async function refreshBoard(showToastOnSuccess) {
  setBusy(true, "同步中");

  try {
    const board = await gasRequest("getAdminBoard", buildPayload());
    applyBoard(board);
    setConnection("ready", "已同步");
    setSystemMessage(board.message || getBoardMessage());
    if (showToastOnSuccess) showToast("名單已同步", "success");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function savePrizeConfig() {
  const prizeName = elements.prizeName.value.trim();
  const winnerCount = Number(elements.winnerCountInput.value);

  if (!prizeName) {
    showError(new Error("請輸入獎項名稱"));
    return;
  }
  if (!Number.isFinite(winnerCount) || winnerCount < 1) {
    showError(new Error("中獎數量必須大於 0"));
    return;
  }

  setBusy(true, "儲存中");

  try {
    const board = await gasRequest("setPrizeConfig", buildPayload({ winnerCount }));
    applyBoard(board);
    setConnection("ready", "已儲存");
    setSystemMessage(board.message || "獎項已更新。");
    showToast(board.message || "獎項已更新", "success");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function setGuaranteedPrize() {
  const selectedUuids = getSelectedUuids();
  if (!selectedUuids.length) {
    showError(new Error("請先勾選保證中獎使用者"));
    return;
  }
  if (!elements.prizeName.value.trim()) {
    showError(new Error("請輸入保證中獎獎項"));
    return;
  }

  setBusy(true, "寫入中");

  try {
    const board = await gasRequest("setGuaranteedPrize", buildPayload({ selectedUuids }));
    applyBoard(board, selectedUuids);
    setConnection("ready", "已寫入");
    setSystemMessage(board.message || "保證中獎設定已更新。");
    showToast(board.message || "保證中獎設定已更新", "success");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function clearGuaranteedPrize() {
  const selectedUuids = getSelectedUuids();
  if (!selectedUuids.length) {
    showError(new Error("請先勾選要清除保證設定的使用者"));
    return;
  }

  setBusy(true, "清除中");

  try {
    const board = await gasRequest("clearGuaranteedPrize", buildPayload({ selectedUuids }));
    applyBoard(board, selectedUuids);
    setConnection("ready", "已清除");
    setSystemMessage(board.message || "保證中獎設定已清除。");
    showToast(board.message || "保證中獎設定已清除", "success");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
}

async function gasRequest(action, payload) {
  const response = await fetch(ADMIN_CONFIG.GAS_WEB_APP_URL, {
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

function buildPayload(extra = {}) {
  return Object.assign({
    prizeName: elements.prizeName.value.trim(),
    adminToken: elements.adminToken.value.trim() || ADMIN_CONFIG.ADMIN_TOKEN,
  }, extra);
}

function applyBoard(board, selectedUuids) {
  state.users = board.users || [];
  state.prizes = board.prizes || [];
  state.stats = board.stats || null;

  if (selectedUuids) {
    state.selectedUuids = new Set(selectedUuids);
  } else {
    state.selectedUuids = new Set(
      state.users.filter((user) => user.selected).map((user) => user.uuid)
    );
  }

  renderStats();
  renderPrizes();
  renderUsers();
  updateWinnerCountFromPrize();
  updateActions();
}

function renderStats() {
  const stats = state.stats || {
    totalUsers: 0,
    drawnNumbers: 0,
    prizes: 0,
  };

  elements.totalCount.textContent = stats.totalUsers;
  elements.drawnCount.textContent = stats.drawnNumbers;
  elements.prizeCount.textContent = stats.prizes || state.prizes.length;
  elements.selectedCount.textContent = state.selectedUuids.size;
  elements.listSummary.textContent = `已領號碼 ${stats.drawnNumbers} 位，已設定 ${state.prizes.length} 個獎項。`;
}

function renderPrizes() {
  elements.prizeOptions.innerHTML = state.prizes
    .map((prize) => `<option value="${escapeHtml(prize.prizeName)}"></option>`)
    .join("");

  if (!state.prizes.length) {
    elements.prizeList.innerHTML = '<p class="section-copy">尚未設定獎項。</p>';
    return;
  }

  elements.prizeList.innerHTML = state.prizes.map((prize) => `
    <button class="prize-item" type="button" data-prize="${escapeHtml(prize.prizeName)}" data-count="${escapeHtml(prize.winnerCount)}">
      <strong>${escapeHtml(prize.prizeName)}</strong>
      <span>${escapeHtml(prize.winnerCountUsed)} / ${escapeHtml(prize.winnerCount)}</span>
    </button>
  `).join("");

  elements.prizeList.querySelectorAll(".prize-item").forEach((button) => {
    button.addEventListener("click", () => {
      elements.prizeName.value = button.dataset.prize;
      elements.winnerCountInput.value = button.dataset.count;
      updateActions();
    });
  });
}

function renderUsers() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const users = state.users.filter((user) => {
    if (!query) return true;
    return [
      user.lineName,
      user.lotteryNumber,
      user.winnerPrize,
      user.guaranteedPrize,
      user.uuid,
    ].some((value) => String(value || "").toLowerCase().includes(query));
  });

  if (!users.length) {
    elements.userRows.innerHTML = '<tr><td class="empty-row" colspan="6">沒有符合條件的使用者</td></tr>';
    return;
  }

  elements.userRows.innerHTML = users.map((user) => {
    const selected = state.selectedUuids.has(user.uuid);
    const rowClasses = [
      selected ? "is-selected" : "",
      user.hasWon ? "is-winner" : "",
    ].filter(Boolean).join(" ");
    const status = getUserStatus(user);

    return `
      <tr class="${rowClasses}">
        <td class="check-cell">
          <input class="winner-check" type="checkbox" data-uuid="${escapeHtml(user.uuid)}" ${selected ? "checked" : ""}>
        </td>
        <td class="number-cell">${escapeHtml(user.lotteryNumber || "未領號")}</td>
        <td>
          <p class="user-name">${escapeHtml(user.lineName || "未命名使用者")}</p>
          <p class="user-id">${escapeHtml(user.uuid)}</p>
        </td>
        <td>${renderGuaranteedPrize(user)}</td>
        <td><span class="status-pill" data-state="${status.state}">${status.label}</span></td>
        <td>${escapeHtml(getWinnerRecordLabel(user))}</td>
      </tr>
    `;
  }).join("");
}

function handleRowChange(event) {
  const checkbox = event.target.closest(".winner-check");
  if (!checkbox) return;

  if (checkbox.checked) {
    state.selectedUuids.add(checkbox.dataset.uuid);
  } else {
    state.selectedUuids.delete(checkbox.dataset.uuid);
  }

  renderStats();
  renderUsers();
  updateActions();
}

function selectPendingUsers() {
  state.users.forEach((user) => {
    if (!user.hasWon) {
      state.selectedUuids.add(user.uuid);
    }
  });
  renderStats();
  renderUsers();
  updateActions();
}

function clearSelection() {
  state.selectedUuids.clear();
  renderStats();
  renderUsers();
  updateActions();
}

function handlePrizeNameInput() {
  updateWinnerCountFromPrize();
  updateActions();
}

function updateWinnerCountFromPrize() {
  const prize = findPrize(elements.prizeName.value.trim());
  if (prize) {
    elements.winnerCountInput.value = prize.winnerCount;
  }
}

function findPrize(prizeName) {
  return state.prizes.find((prize) => prize.prizeName === prizeName) || null;
}

function getSelectedUuids() {
  return Array.from(state.selectedUuids);
}

function getUserStatus(user) {
  if (user.hasWon) {
    return {
      state: "winner",
      label: "已中獎",
    };
  }

  if (user.guaranteedPrize) {
    return {
      state: "guaranteed",
      label: "保證中獎",
    };
  }

  return {
    state: "auto",
    label: "系統決定",
  };
}

function renderGuaranteedPrize(user) {
  if (!user.guaranteedPrize) {
    return '<span class="status-pill" data-state="auto">系統隨機</span>';
  }

  return `<span class="prize-tag">${escapeHtml(user.guaranteedPrize)}</span>`;
}

function getWinnerRecordLabel(user) {
  if (!user.hasWon) return "--";
  return `${user.winnerPrize || "未命名獎項"} / ${user.winnerAt || "--"}`;
}

function setBusy(isBusy, label) {
  state.busy = isBusy;
  if (isBusy) setConnection("busy", label || "處理中");
  updateActions();
}

function updateActions() {
  const hasSelection = state.selectedUuids.size > 0;
  const hasPrize = Boolean(elements.prizeName.value.trim());
  const hasWinnerCount = Number(elements.winnerCountInput.value) > 0;

  elements.savePrizeButton.disabled = state.busy || !hasPrize || !hasWinnerCount;
  elements.setGuaranteeButton.disabled = state.busy || !hasSelection || !hasPrize || !findPrize(elements.prizeName.value.trim());
  elements.clearGuaranteeButton.disabled = state.busy || !hasSelection;
  elements.refreshButton.disabled = state.busy;
  elements.selectEligibleButton.disabled = state.busy || !state.users.some((user) => !user.hasWon);
  elements.clearSelectionButton.disabled = state.busy || !hasSelection;
  elements.prizeName.disabled = state.busy;
  elements.winnerCountInput.disabled = state.busy;
  elements.adminToken.disabled = state.busy;
  elements.searchInput.disabled = state.busy;
}

function setConnection(stateName, label) {
  elements.connectionBadge.dataset.state = stateName;
  elements.connectionBadge.textContent = label;
}

function setSystemMessage(message) {
  elements.systemMessage.textContent = message;
}

function getBoardMessage() {
  if (!state.stats) return "尚未取得 GAS 名單。";
  if (!state.prizes.length) return "請先設定獎項與中獎數量。";
  return "可勾選使用者並設定保證中獎獎項；未設定者由系統隨機抽出。";
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
