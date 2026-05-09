const CONFIG_PATH = "config.json";
const phaseColors = ["#18745f", "#315f94", "#b66c20", "#7a4e98", "#ba3b30"];
const supportedTypes = ["residentContract", "rotationContract", "contractAdjustment"];

const templates = {
  residentContract: [
    {
      name: "基本申請",
      weight: 1,
      tasks: ["用印申請書(A)填寫完整", "廠商合約建檔單(B)確認建檔條件", "核准簽呈影本(D)確認簽呈欄位與日期"],
    },
    {
      name: "合約與保證",
      weight: 1.45,
      tasks: [
        "履約保證金或固定租金付款說明(C)",
        "確認契約書正本份數與版本正確",
        "檢查合約必填欄位、頁碼、騎縫章與廠商小章",
        "確認合約期間、櫃位名稱、租金或保證金金額",
      ],
    },
    {
      name: "廠商資料",
      weight: 1.25,
      tasks: [
        "公司設立或變更登記事項卡(E)",
        "設立公函、商行或企業社使用(F)",
        "稅籍登記或廠商請款憑證",
        "設備負責人身分證影本(G)",
        "印鑑約定書(H)與印鑑章確認",
        "廠商貨款匯申請書與帳戶資料確認",
      ],
    },
    {
      name: "品保與保單",
      weight: 1.35,
      tasks: [
        "食品業者登錄憑證字號與畫面附件",
        "新櫃位進駐評估表分數與首頁附件",
        "確認是否已簽約、現有於商場、連鎖櫃數等條件",
        "火險保單文件影本",
        "公共意外責任險保單文件影本",
        "產品責任險保單文件影本",
      ],
    },
    {
      name: "用印送審",
      weight: 0.95,
      tasks: [
        "其他特定文件或異常事項填寫",
        "逐頁檢查附件與合約內容一致",
        "用印送審資料確認",
      ],
    },
  ],
  rotationContract: [
    {
      name: "基本申請",
      weight: 1,
      tasks: ["用印申請書(A)填寫完整", "廠商合約建檔單(B)確認建檔條件", "核准簽呈影本(D)確認簽呈欄位與日期"],
    },
    {
      name: "合約與保證",
      weight: 1.55,
      tasks: [
        "履約保證金或固定租金付款說明(C)",
        "短期特賣合約或輪動櫃位合約版本確認",
        "確認契約書正本份數與版本正確",
        "檢查合約必填欄位、頁碼、騎縫章與廠商小章",
        "確認廠商負責人、統編、地址與租金資料",
      ],
    },
    {
      name: "廠商資料",
      weight: 1.2,
      tasks: [
        "公司設立或變更登記事項卡(E)",
        "設立公函、商行或企業社使用(F)",
        "稅籍登記或廠商請款憑證",
        "設備負責人身分證影本(G)",
        "印鑑約定書(H)與印鑑章確認",
        "廠商貨款匯申請書與帳戶資料確認",
      ],
    },
    {
      name: "品保與保單",
      weight: 1.25,
      tasks: [
        "食品業者登錄憑證字號與畫面附件",
        "新櫃位進駐評估表分數與首頁附件",
        "確認是否已簽約、現有於商場、連鎖櫃數等條件",
        "產品責任險保單文件影本",
        "確認保單投保限制與有效期限",
      ],
    },
    {
      name: "用印送審",
      weight: 0.9,
      tasks: [
        "其他特定文件或異常事項填寫",
        "若保證金有簽立增補條文或讓與同意書，確認內容正確",
        "用印送審資料確認",
      ],
    },
  ],
  contractAdjustment: [
    {
      name: "基本申請",
      weight: 1,
      tasks: ["用印申請書(A)填寫完整", "確認合約調整或合約展延期間欄位", "確認申請人、合約租期與條件欄位"],
    },
    {
      name: "簽呈建檔",
      weight: 1.1,
      tasks: [
        "核准簽呈(D)內容無誤",
        "確認簽呈欄位、日期與常見缺失",
        "廠商合約建檔單(B)條件確認",
        "建檔單條件需與簽呈及協議書條件相符",
      ],
    },
    {
      name: "協議書檢核",
      weight: 2.2,
      tasks: [
        "合約調整協議書正本兩份",
        "協議書版本正確，請至 Dr.owl 查看適用版本",
        "協議書內容如展延日、商業條件需與簽呈相符",
        "協議書必填欄位已填寫，字跡清楚且無數字誤植",
        "雙方立約用印處與立約日期符合公司規範",
        "協議書大小章、原約日期、名稱、統編等資訊與原約相符",
        "協議書對應原合約條文項目確認相符",
      ],
    },
    {
      name: "原約與其他",
      weight: 1,
      tasks: ["原合約影本一份", "其他特定文件用途說明", "確認其他文件是否需列入異常事項"],
    },
    {
      name: "用印送審",
      weight: 0.9,
      tasks: [
        "逐頁或側邊騎縫章確認",
        "內容增刪或修改處需旁蓋廠商小章",
        "廠商公司、負責人名稱、統編、地址需與抄錄相符",
        "增刪註記算字數與標點符號需寫入",
        "其他備註或合約異常事項填寫",
      ],
    },
  ],
};

const fullBreakdownAddons = ["確認風險與卡點", "建立備案", "整理決策紀錄"];

let state = {
  projects: [],
  activeId: null,
  filter: "all",
  draggingTaskId: null,
  pointerDrag: null,
  updatedAt: 0,
  sync: {
    endpoint: "",
    key: "",
    busy: false,
    dirty: false,
    loaded: false,
    spreadsheetId: "",
    spreadsheetUrl: "",
  },
};

const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  setTodayLabel();
  await loadSyncConfig();
  bindEvents();
  setDataControlsDisabled(true);
  render();
  await loadStateFromGasOnStart();
});

function bindElements() {
  [
    "todayLabel",
    "totalTasks",
    "doneTasks",
    "dueSoonTasks",
    "projectList",
    "newProjectButton",
    "seedButton",
    "projectForm",
    "projectTitle",
    "projectOutcome",
    "projectType",
    "syncNowButton",
    "syncStatus",
    "syncDot",
    "syncSheetLink",
    "activeTitle",
    "exportButton",
    "deleteProjectButton",
    "progressLabel",
    "progressBar",
    "phaseStrip",
    "quickTaskForm",
    "quickTaskInput",
    "taskList",
    "nextTaskBox",
    "outcomeText",
    "reverseList",
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.projectForm.addEventListener("submit", handleProjectSubmit);
  elements.quickTaskForm.addEventListener("submit", handleQuickTaskSubmit);
  elements.newProjectButton.addEventListener("click", focusProjectTitle);
  elements.seedButton.addEventListener("click", fillExample);
  elements.exportButton.addEventListener("click", exportActiveProject);
  elements.deleteProjectButton.addEventListener("click", deleteActiveProject);
  elements.syncNowButton.addEventListener("click", () => saveToGas());
  window.addEventListener("beforeunload", warnBeforeLeavingWithUnsavedData);

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      renderTasks(getActiveProject());
      renderFilters();
    });
  });
}

function warnBeforeLeavingWithUnsavedData(event) {
  if (!state.sync.dirty) return;
  event.preventDefault();
  event.returnValue = "";
}

function setDataControlsDisabled(disabled) {
  [
    elements.newProjectButton,
    elements.seedButton,
    elements.exportButton,
    elements.deleteProjectButton,
    ...elements.projectForm.querySelectorAll("input, textarea, select, button"),
    ...elements.quickTaskForm.querySelectorAll("input, button"),
    ...elements.projectList.querySelectorAll("button"),
  ].forEach((control) => {
    if (control) control.disabled = disabled;
  });
}

function setTodayLabel() {
  const today = new Date();
  elements.todayLabel.textContent = new Intl.DateTimeFormat("zh-TW", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(today);
}

function saveState(options = {}) {
  const { touch = true, dirty = true } = options;
  if (touch) state.updatedAt = Date.now();

  if (dirty) {
    state.sync.dirty = true;
    setSyncStatus("尚未儲存到 GAS", "dirty");
  }
}

async function loadSyncConfig() {
  try {
    const response = await fetch(CONFIG_PATH, { cache: "no-store" });
    if (!response.ok) throw new Error("config.json not found");

    const config = await response.json();
    state.sync.endpoint = String(config.gasUrl || config.endpoint || "").trim();
    state.sync.key = String(config.syncKey || config.key || "").trim();
    state.sync.spreadsheetId = extractSpreadsheetId(config.spreadsheetId || config.spreadsheetUrl || "");
    rememberSpreadsheetUrl(config.spreadsheetUrl || getSpreadsheetUrlFromId(state.sync.spreadsheetId));
    setSyncStatus(hasSyncConfig() ? "已讀取 config.json" : "config.json 尚未設定完整", hasSyncConfig() ? "ready" : "error");
  } catch (error) {
    state.sync.endpoint = "";
    state.sync.key = "";
    state.sync.spreadsheetId = "";
    rememberSpreadsheetUrl("");
    setSyncStatus(`無法讀取 config.json`, "error");
  }
}

function hasSyncConfig() {
  return Boolean(state.sync.endpoint && state.sync.key && state.sync.spreadsheetId);
}

function extractSpreadsheetId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : text;
}

function getSpreadsheetUrlFromId(id) {
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : "";
}

function createSyncSnapshot() {
  state.projects.forEach(normalizeProject);
  return {
    version: 1,
    updatedAt: state.updatedAt || Date.now(),
    activeId: state.activeId,
    projects: state.projects,
  };
}

function applySyncSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.projects)) return false;

  state.projects = snapshot.projects.filter((project) => supportedTypes.includes(project.type));
  state.projects.forEach(normalizeProject);
  state.activeId = state.projects.some((project) => project.id === snapshot.activeId)
    ? snapshot.activeId
    : state.projects[0]?.id || null;
  state.updatedAt = Number(snapshot.updatedAt) || Date.now();
  state.sync.dirty = false;
  state.sync.loaded = true;
  render();
  return true;
}

async function loadStateFromGasOnStart() {
  if (!hasSyncConfig()) {
    setSyncStatus("請先在 config.json 設定 gasUrl、syncKey、spreadsheetId", "error");
    return;
  }

  if (state.sync.busy) return;
  state.sync.busy = true;
  setDataControlsDisabled(true);
  setSyncStatus("從 GAS 載入中", "busy");

  try {
    const remote = await loadCloudState();
    rememberSpreadsheetUrl(remote?.spreadsheetUrl);
    const remoteData = remote?.data || null;

    if (remoteData) {
      if (!applySyncSnapshot(remoteData)) {
        throw new Error("GAS 資料格式不正確");
      }
      setSyncStatus(`已從 GAS 載入 ${formatTime(new Date())}`, "ready");
      return;
    }

    state.projects = [];
    state.activeId = null;
    state.updatedAt = 0;
    state.sync.dirty = false;
    state.sync.loaded = true;
    render();
    setSyncStatus("GAS 尚無資料，建立後按儲存", "ready");
  } catch (error) {
    state.sync.loaded = false;
    setSyncStatus(`GAS 載入失敗：${error.message || "連線錯誤"}`, "error");
  } finally {
    state.sync.busy = false;
    if (state.sync.loaded) {
      setDataControlsDisabled(false);
      render();
    }
    setSyncStatus(elements.syncStatus.textContent, elements.syncDot.className.replace("sync-dot", "").trim());
  }
}

async function loadCloudState() {
  return requestJsonp("load");
}

async function saveToGas() {
  if (!hasSyncConfig()) {
    setSyncStatus("請先在 config.json 設定 gasUrl、syncKey、spreadsheetId", "error");
    return;
  }

  if (!state.sync.loaded) {
    setSyncStatus("請先成功從 GAS 載入資料", "error");
    return;
  }

  if (state.sync.busy) return;
  state.sync.busy = true;
  setDataControlsDisabled(true);
  state.updatedAt = Date.now();
  setSyncStatus("儲存到 GAS 中", "busy");

  const snapshot = createSyncSnapshot();
  const payload = {
    key: state.sync.key,
    spreadsheetId: state.sync.spreadsheetId,
    data: snapshot,
  };

  try {
    await pushCloudState(payload);
    const verified = await loadCloudState();
    rememberSpreadsheetUrl(verified?.spreadsheetUrl);

    if (!verified?.data || Number(verified.data.updatedAt || 0) < Number(snapshot.updatedAt || 0)) {
      throw new Error("GAS 尚未回傳最新資料");
    }

    if (!applySyncSnapshot(verified.data)) {
      throw new Error("GAS 資料格式不正確");
    }
    setSyncStatus(`已儲存到 GAS ${formatTime(new Date())}`, "ready");
  } catch (error) {
    state.sync.dirty = true;
    setSyncStatus(`儲存失敗：${error.message || "連線錯誤"}`, "error");
  } finally {
    state.sync.busy = false;
    if (state.sync.loaded) {
      setDataControlsDisabled(false);
      render();
    }
    setSyncStatus(elements.syncStatus.textContent, elements.syncDot.className.replace("sync-dot", "").trim());
  }
}

async function pushCloudState(payload) {
  await fetch(state.sync.endpoint, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
}

function requestJsonp(action) {
  return new Promise((resolve, reject) => {
    const callbackName = `todoAssistantSync_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("雲端讀取逾時"));
    }, 12000);

    function cleanup() {
      clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
    }

    window[callbackName] = (payload) => {
      cleanup();
      if (!payload?.ok) {
        reject(new Error(payload?.error || "雲端回應錯誤"));
        return;
      }
      resolve(payload);
    };

    try {
      const url = new URL(state.sync.endpoint);
      url.searchParams.set("action", action);
      url.searchParams.set("key", state.sync.key);
      url.searchParams.set("spreadsheetId", state.sync.spreadsheetId);
      url.searchParams.set("callback", callbackName);
      script.src = url.toString();
      script.onerror = () => {
        cleanup();
        reject(new Error("無法連線到 GAS"));
      };
      document.head.appendChild(script);
    } catch {
      cleanup();
      reject(new Error("config.json 的 gasUrl 格式不正確"));
    }
  });
}

function rememberSpreadsheetUrl(url) {
  state.sync.spreadsheetUrl = String(url || "").trim();

  if (!elements.syncSheetLink) return;
  elements.syncSheetLink.classList.toggle("hidden", !state.sync.spreadsheetUrl);
  elements.syncSheetLink.href = state.sync.spreadsheetUrl || "#";
}

function setSyncStatus(message, status = "") {
  elements.syncStatus.textContent = message;
  elements.syncDot.className = `sync-dot ${status}`.trim();
  elements.syncNowButton.disabled = state.sync.busy || !hasSyncConfig() || !state.sync.loaded;
}

function handleProjectSubmit(event) {
  event.preventDefault();

  const title = elements.projectTitle.value.trim();
  const outcome = elements.projectOutcome.value.trim();

  if (!title) return;

  const project = createProject({
    title,
    outcome,
    type: elements.projectType.value,
  });

  state.projects.unshift(project);
  state.activeId = project.id;
  saveState();
  elements.projectForm.reset();
  render();
}

function createProject({ title, outcome, type }) {
  const phases = buildBackwardPlan({ type });
  const tasks = phases.flatMap((phase) =>
    phase.tasks.map((taskTitle) => ({
      id: makeId(),
      title: taskTitle,
      phaseId: phase.id,
      phaseName: phase.name,
      done: false,
      note: "",
      createdAt: new Date().toISOString(),
    })),
  );
  setTaskOrders(tasks);

  return {
    id: makeId(),
    title,
    outcome: outcome || getDefaultOutcome(type),
    type,
    complexity: "deep",
    createdAt: new Date().toISOString(),
    phases,
    tasks,
  };
}

function buildBackwardPlan({ type }) {
  const base = templates[type] || templates.residentContract;
  return base.map((phase, index) => ({
    id: makeId(),
    name: phase.name,
    reverseOrder: base.length - index,
    tasks: adjustTasks(phase.tasks),
    order: index + 1,
    color: phaseColors[index % phaseColors.length],
  }));
}

function adjustTasks(tasks) {
  const middle = Math.max(1, tasks.length - 1);
  return [...tasks.slice(0, middle), ...fullBreakdownAddons, ...tasks.slice(middle)];
}

function handleQuickTaskSubmit(event) {
  event.preventDefault();
  const project = getActiveProject();
  const title = elements.quickTaskInput.value.trim();
  if (!project || !title) return;

  const phase = project.phases[project.phases.length - 1];

  project.tasks.push({
    id: makeId(),
    title,
    phaseId: phase?.id || "extra",
    phaseName: phase?.name || "補充",
    done: false,
    note: "",
    createdAt: new Date().toISOString(),
    order: getNextTaskOrder(project),
    manual: true,
  });

  elements.quickTaskInput.value = "";
  saveState();
  render();
}

function fillExample() {
  elements.projectTitle.value = "進駐廠商契約用印查檢";
  elements.projectOutcome.value =
    "用印申請、契約正本、廠商證明文件、品保文件與保單皆確認完成。";
  elements.projectType.value = "residentContract";
  focusProjectTitle();
}

function focusProjectTitle() {
  elements.projectTitle.focus();
  elements.projectTitle.select();
}

function render() {
  renderProjectList();
  renderStats();
  renderActiveProject();
  renderFilters();

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderProjectList() {
  if (!state.projects.length) {
    elements.projectList.innerHTML = `<div class="empty-state">尚無專案</div>`;
    return;
  }

  elements.projectList.innerHTML = state.projects
    .map((project) => {
      const progress = getProgress(project);
      const activeClass = project.id === state.activeId ? "active" : "";
      return `
        <button class="project-item ${activeClass}" type="button" data-project-id="${project.id}">
          <span>
            <strong>${escapeHtml(project.title)}</strong>
            <span>${project.tasks.length} 項任務</span>
          </span>
          <span class="mini-progress" style="--value: ${progress}%">${progress}</span>
        </button>
      `;
    })
    .join("");

  elements.projectList.querySelectorAll("[data-project-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeId = button.dataset.projectId;
      saveState();
      render();
    });
  });
}

function renderStats() {
  const tasks = state.projects.flatMap((project) => project.tasks);
  const done = tasks.filter((task) => task.done);
  const open = tasks.filter((task) => !task.done);

  elements.totalTasks.textContent = String(tasks.length);
  elements.doneTasks.textContent = String(done.length);
  elements.dueSoonTasks.textContent = String(open.length);
}

function renderActiveProject() {
  const project = getActiveProject();
  const hasProject = Boolean(project);

  elements.exportButton.disabled = !hasProject;
  elements.deleteProjectButton.disabled = !hasProject;
  elements.quickTaskInput.disabled = !hasProject;

  if (!project) {
    elements.activeTitle.textContent = "尚未建立專案";
    elements.progressLabel.textContent = "0%";
    elements.progressBar.style.width = "0%";
    elements.phaseStrip.innerHTML = `<div class="empty-state">建立目標後會出現階段</div>`;
    elements.taskList.innerHTML = `<div class="empty-state">任務會依階段排列</div>`;
    elements.nextTaskBox.innerHTML = `<span>建立第一個專案</span>`;
    elements.outcomeText.textContent = "-";
    elements.reverseList.innerHTML = "";
    return;
  }

  const progress = getProgress(project);
  elements.activeTitle.textContent = project.title;
  elements.progressLabel.textContent = `${progress}%`;
  elements.progressBar.style.width = `${progress}%`;
  elements.outcomeText.textContent = project.outcome;

  renderPhases(project);
  renderTasks(project);
  renderInspector(project);
}

function renderPhases(project) {
  elements.phaseStrip.innerHTML = project.phases
    .map((phase) => {
      const phaseTasks = project.tasks.filter((task) => task.phaseId === phase.id);
      const done = phaseTasks.filter((task) => task.done).length;
      const total = phaseTasks.length || 1;
      return `
        <article class="phase-card" style="--phase-color: ${phase.color}">
          <header>
            <h3>${escapeHtml(phase.name)}</h3>
            <span class="phase-date">${phase.order}</span>
          </header>
          <p class="phase-date">${done} / ${total} 完成</p>
          <progress value="${done}" max="${total}"></progress>
        </article>
      `;
    })
    .join("");
}

function renderTasks(project) {
  if (!project) return;
  normalizeProject(project);
  const visibleTasks = getOrderedTasks(project)
    .filter((task) => {
      if (state.filter === "open") return !task.done;
      if (state.filter === "done") return task.done;
      return true;
    });

  if (!visibleTasks.length) {
    elements.taskList.innerHTML = `<div class="empty-state">沒有符合篩選的任務</div>`;
    return;
  }

  elements.taskList.innerHTML = visibleTasks.map((task, index) => renderTaskCard(task, index)).join("");

  elements.taskList.querySelectorAll("[data-toggle-task]").forEach((button) => {
    button.addEventListener("click", () => toggleTask(project.id, button.dataset.toggleTask));
  });

  elements.taskList.querySelectorAll("[data-delete-task]").forEach((button) => {
    button.addEventListener("click", () => deleteTask(project.id, button.dataset.deleteTask));
  });

  elements.taskList.querySelectorAll("[data-task-note]").forEach((field) => {
    autoSizeNoteField(field);
    field.addEventListener("input", () => updateTaskNote(project.id, field.dataset.taskNote, field.value, field));
    field.addEventListener("blur", saveState);
  });

  elements.taskList.querySelectorAll("[data-drag-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => handleTaskPointerDown(event, project.id));
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderTaskCard(task, index) {
  const doneClass = task.done ? "done" : "";
  const emphasisClass = getTaskEmphasis(task);
  const dragClass = state.filter === "all" ? "" : "locked-order";
  const note = task.note || "";
  return `
    <article class="task-card ${doneClass} ${emphasisClass} ${dragClass}" data-drag-task="${task.id}">
      <span class="task-number" data-drag-handle title="拖曳調整順序">
        <i data-lucide="grip-vertical"></i>
        ${String(index + 1).padStart(2, "0")}
      </span>
      <div class="task-main">
        <button class="task-check" type="button" data-toggle-task="${task.id}" aria-label="切換完成狀態">
          <i data-lucide="check"></i>
        </button>
        <div class="task-content">
          <span class="task-title">${escapeHtml(task.title)}</span>
          <span class="task-meta">
            <span class="phase-pill">${escapeHtml(task.phaseName)}</span>
          </span>
        </div>
      </div>
      <div class="task-actions">
        <button class="icon-button" type="button" data-delete-task="${task.id}" aria-label="刪除任務">
          <i data-lucide="x"></i>
        </button>
      </div>
      <label class="task-note-wrap">
        <span>備註</span>
        <textarea class="task-note" data-task-note="${task.id}" rows="1" placeholder="新增備註">${escapeHtml(note)}</textarea>
      </label>
    </article>
  `;
}

function getTaskEmphasis(task) {
  const content = `${task.title} ${task.phaseName}`;
  if (/異常|增補|讓與|注意|其他/.test(content)) return "alert";
  if (/品保|保單|責任險|食品|評估表/.test(content)) return "quality";
  if (/協議書|原合約|原約|Dr\.owl/.test(content)) return "agreement";
  return "";
}

function updateTaskNote(projectId, taskId, value, field) {
  const project = state.projects.find((item) => item.id === projectId);
  const task = project?.tasks.find((item) => item.id === taskId);
  if (!task) return;

  task.note = value;
  autoSizeNoteField(field);
  saveState();
}

function autoSizeNoteField(field) {
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}

function handleTaskPointerDown(event, projectId) {
  if (state.filter !== "all") return;
  if (event.pointerType === "mouse" && event.button !== 0) return;

  const card = event.currentTarget.closest("[data-drag-task]");
  if (!card) return;

  event.preventDefault();
  state.draggingTaskId = card.dataset.dragTask;
  state.pointerDrag = {
    projectId,
    taskId: state.draggingTaskId,
    pointerId: event.pointerId,
    startY: event.clientY,
    offsetY: event.clientY - card.getBoundingClientRect().top,
    currentTargetId: null,
    dropCard: null,
    insertAfter: false,
    hasMoved: false,
    card,
    ghost: createTaskDragGhost(card, event.clientY),
  };

  card.classList.add("dragging");
  document.body.classList.add("task-drag-active");
  event.currentTarget.setPointerCapture?.(event.pointerId);

  window.addEventListener("pointermove", handleTaskPointerMove, { passive: false });
  window.addEventListener("pointerup", handleTaskPointerUp);
  window.addEventListener("pointercancel", handleTaskPointerCancel);
}

function handleTaskPointerMove(event) {
  const drag = state.pointerDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;

  event.preventDefault();
  drag.hasMoved = drag.hasMoved || Math.abs(event.clientY - drag.startY) > 4;
  moveTaskDragGhost(drag, event.clientY);
  scrollDragViewport(event.clientY);

  const target = getTaskCardAtPoint(event.clientX, event.clientY);

  if (!target || target.dataset.dragTask === drag.taskId) {
    clearCurrentDropTarget(drag);
    drag.currentTargetId = null;
    return;
  }

  if (drag.dropCard && drag.dropCard !== target) {
    clearCurrentDropTarget(drag);
  }

  drag.currentTargetId = target.dataset.dragTask;
  drag.dropCard = target;
  drag.insertAfter = !isBeforeDropTarget(event, target);
  target.classList.toggle("drop-before", !drag.insertAfter);
  target.classList.toggle("drop-after", drag.insertAfter);
}

function handleTaskPointerUp(event) {
  const drag = state.pointerDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;

  event.preventDefault();
  const project = state.projects.find((item) => item.id === drag.projectId);
  const shouldReorder = project && drag.hasMoved && drag.currentTargetId && drag.currentTargetId !== drag.taskId;

  if (shouldReorder) {
    reorderTask(project, drag.taskId, drag.currentTargetId, drag.insertAfter);
    saveState();
  }

  endTaskPointerDrag();

  if (shouldReorder) {
    render();
  }
}

function handleTaskPointerCancel() {
  endTaskPointerDrag();
}

function clearCurrentDropTarget(drag) {
  drag.dropCard?.classList.remove("drop-before", "drop-after");
  drag.dropCard = null;
}

function endTaskPointerDrag() {
  window.removeEventListener("pointermove", handleTaskPointerMove);
  window.removeEventListener("pointerup", handleTaskPointerUp);
  window.removeEventListener("pointercancel", handleTaskPointerCancel);
  state.pointerDrag?.ghost?.remove();
  clearDragClasses();
  document.body.classList.remove("task-drag-active");
  state.draggingTaskId = null;
  state.pointerDrag = null;
}

function createTaskDragGhost(card, clientY) {
  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add("task-drag-ghost");
  ghost.classList.remove("dragging", "drop-before", "drop-after");
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = "0px";
  ghost.style.width = `${rect.width}px`;
  document.body.appendChild(ghost);
  moveTaskDragGhost({ ghost, offsetY: clientY - rect.top }, clientY);
  return ghost;
}

function moveTaskDragGhost(drag, clientY) {
  if (!drag.ghost) return;
  drag.ghost.style.transform = `translate3d(0, ${clientY - drag.offsetY}px, 0)`;
}

function getTaskCardAtPoint(x, y) {
  const draggedCard = state.pointerDrag?.card;
  if (draggedCard) draggedCard.style.pointerEvents = "none";
  const target = document.elementFromPoint(x, y)?.closest("[data-drag-task]");
  if (draggedCard) draggedCard.style.pointerEvents = "";
  return target;
}

function scrollDragViewport(clientY) {
  const edge = 76;
  if (clientY < edge) {
    window.scrollBy(0, -14);
  } else if (clientY > window.innerHeight - edge) {
    window.scrollBy(0, 14);
  }
}

function isBeforeDropTarget(event, target) {
  const rect = target.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2;
}

function clearDragClasses(options = {}) {
  const selector = options.keepDragging ? ".drop-before, .drop-after" : ".dragging, .drop-before, .drop-after";
  elements.taskList.querySelectorAll(selector).forEach((item) => item.classList.remove("dragging", "drop-before", "drop-after"));
}

function reorderTask(project, draggedTaskId, targetTaskId, insertAfter) {
  const orderedTasks = getOrderedTasks(project);
  const draggedIndex = orderedTasks.findIndex((task) => task.id === draggedTaskId);
  const targetIndex = orderedTasks.findIndex((task) => task.id === targetTaskId);
  if (draggedIndex < 0 || targetIndex < 0) return;

  const [draggedTask] = orderedTasks.splice(draggedIndex, 1);
  const adjustedTargetIndex = orderedTasks.findIndex((task) => task.id === targetTaskId);
  orderedTasks.splice(adjustedTargetIndex + (insertAfter ? 1 : 0), 0, draggedTask);
  setTaskOrders(orderedTasks);
}

function renderInspector(project) {
  const nextTask = getOrderedTasks(project)
    .filter((task) => !task.done)
    [0];

  if (nextTask) {
    elements.nextTaskBox.innerHTML = `
      <strong>${escapeHtml(nextTask.title)}</strong>
      <span>${escapeHtml(nextTask.phaseName)}</span>
    `;
  } else {
    elements.nextTaskBox.innerHTML = `<strong>全部完成</strong><span>${project.tasks.length} 項任務</span>`;
  }

  elements.reverseList.innerHTML = [...project.phases]
    .reverse()
    .map(
      (phase) => `
        <li>
          <strong>${escapeHtml(phase.name)}</strong>
          第 ${phase.order} 階段
        </li>
      `,
    )
    .join("");
}

function renderFilters() {
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.filter);
  });
}

function toggleTask(projectId, taskId) {
  const project = state.projects.find((item) => item.id === projectId);
  const task = project?.tasks.find((item) => item.id === taskId);
  if (!task) return;
  task.done = !task.done;
  saveState();
  render();
}

function deleteTask(projectId, taskId) {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return;
  project.tasks = project.tasks.filter((task) => task.id !== taskId);
  saveState();
  render();
}

function deleteActiveProject() {
  const project = getActiveProject();
  if (!project) return;

  const ok = confirm(`刪除「${project.title}」？`);
  if (!ok) return;

  state.projects = state.projects.filter((item) => item.id !== project.id);
  state.activeId = state.projects[0]?.id || null;
  saveState();
  render();
}

function exportActiveProject() {
  const project = getActiveProject();
  if (!project) return;

  const lines = [
    `# ${project.title}`,
    `完成條件：${project.outcome}`,
    "",
    ...project.phases.flatMap((phase) => {
      const tasks = getOrderedTasks(project)
        .filter((task) => task.phaseId === phase.id)
        .flatMap((task) => {
          const rows = [`- [${task.done ? "x" : " "}] ${task.title}`];
          if (task.note?.trim()) rows.push(`  備註：${task.note.trim()}`);
          return rows;
        });
      return [`## ${phase.name}`, ...tasks, ""];
    }),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${project.title.replace(/[\\/:*?"<>|]/g, "-")}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

function getActiveProject() {
  return state.projects.find((project) => project.id === state.activeId) || null;
}

function getProgress(project) {
  if (!project || !project.tasks.length) return 0;
  const done = project.tasks.filter((task) => task.done).length;
  return Math.round((done / project.tasks.length) * 100);
}

function normalizeProject(project) {
  if (!project) return;
  delete project.startDate;
  delete project.deadline;

  if (!Array.isArray(project.phases)) project.phases = [];
  project.phases.forEach((phase, index) => {
    delete phase.startDate;
    delete phase.endDate;
    if (!Number.isFinite(phase.order)) phase.order = index + 1;
    if (!phase.color) phase.color = phaseColors[index % phaseColors.length];
  });

  if (!Array.isArray(project.tasks)) project.tasks = [];
  project.tasks.forEach((task) => {
    if (typeof task.note !== "string") task.note = "";
    delete task.dueDate;
  });
  if (!project.tasks.length) return;

  const needsOrder = project.tasks.some((task) => !Number.isFinite(task.order));
  if (!needsOrder) return;

  const orderedTasks = [...project.tasks].sort(compareTaskOrder);
  setTaskOrders(orderedTasks);
}

function getOrderedTasks(project) {
  normalizeProject(project);
  return [...project.tasks].sort(compareTaskOrder);
}

function compareTaskOrder(a, b) {
  const orderA = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
  const orderB = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;

  return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
}

function setTaskOrders(tasks) {
  tasks.forEach((task, index) => {
    task.order = index;
  });
}

function getNextTaskOrder(project) {
  normalizeProject(project);
  return project.tasks.reduce((max, task) => Math.max(max, Number.isFinite(task.order) ? task.order : -1), -1) + 1;
}

function getDefaultOutcome(type) {
  if (type === "residentContract") {
    return "進駐廠商契約用印文件、品保與保單皆完成檢核。";
  }

  if (type === "rotationContract") {
    return "特賣或輪動櫃位契約用印文件、品保與保單皆完成檢核。";
  }

  if (type === "contractAdjustment") {
    return "合約調整或展延協議書用印文件、簽呈、建檔單、協議書與原合約影本皆完成檢核。";
  }

  return "依任務清單完成交付並保留後續追蹤項目。";
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makeId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
