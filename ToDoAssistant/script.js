const STORAGE_KEY = "todo-assistant-projects-v1";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const phaseColors = ["#18745f", "#315f94", "#b66c20", "#7a4e98", "#ba3b30"];
const supportedTypes = ["residentContract", "rotationContract"];

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
};

const fullBreakdownAddons = ["確認風險與卡點", "建立備案", "整理決策紀錄"];

let state = {
  projects: [],
  activeId: null,
  filter: "all",
  draggingTaskId: null,
  pointerDrag: null,
  noteSaveTimer: null,
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  setDefaultDates();
  loadState();
  bindEvents();
  render();
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
    "projectStart",
    "projectDeadline",
    "projectType",
    "activeTitle",
    "exportButton",
    "deleteProjectButton",
    "progressLabel",
    "dateRangeLabel",
    "progressBar",
    "phaseStrip",
    "quickTaskForm",
    "quickTaskInput",
    "quickTaskDate",
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

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      renderTasks(getActiveProject());
      renderFilters();
    });
  });
}

function setDefaultDates() {
  const today = startOfDay(new Date());
  const deadline = addDays(today, 21);
  elements.projectStart.value = toDateInput(today);
  elements.projectDeadline.value = toDateInput(deadline);
  elements.quickTaskDate.value = toDateInput(today);
  elements.todayLabel.textContent = new Intl.DateTimeFormat("zh-TW", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(today);
}

function loadState() {
  const raw = readStorage();
  if (!raw) return;

  try {
    const saved = JSON.parse(raw);
    if (Array.isArray(saved.projects)) {
      state.projects = saved.projects.filter((project) => supportedTypes.includes(project.type));
      state.projects.forEach(normalizeProject);
      state.activeId = state.projects.some((project) => project.id === saved.activeId)
        ? saved.activeId
        : state.projects[0]?.id || null;
    }
  } catch {
    state.projects = [];
    state.activeId = null;
  }
}

function saveState() {
  writeStorage(
    JSON.stringify({
      projects: state.projects,
      activeId: state.activeId,
    }),
  );
}

function handleProjectSubmit(event) {
  event.preventDefault();

  const title = elements.projectTitle.value.trim();
  const outcome = elements.projectOutcome.value.trim();
  const start = parseInputDate(elements.projectStart.value);
  const deadline = parseInputDate(elements.projectDeadline.value);

  if (!title || !start || !deadline) return;

  if (deadline < start) {
    elements.projectDeadline.setCustomValidity("完成日需晚於開始日");
    elements.projectDeadline.reportValidity();
    setTimeout(() => elements.projectDeadline.setCustomValidity(""), 0);
    return;
  }

  const project = createProject({
    title,
    outcome,
    start,
    deadline,
    type: elements.projectType.value,
  });

  state.projects.unshift(project);
  state.activeId = project.id;
  saveState();
  elements.projectForm.reset();
  setDefaultDates();
  render();
}

function createProject({ title, outcome, start, deadline, type }) {
  const phases = buildBackwardPlan({ start, deadline, type });
  const tasks = phases.flatMap((phase) =>
    phase.tasks.map((taskTitle, index) => ({
      id: makeId(),
      title: taskTitle,
      phaseId: phase.id,
      phaseName: phase.name,
      dueDate: distributeTaskDate(phase, index),
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
    startDate: toDateInput(start),
    deadline: toDateInput(deadline),
    createdAt: new Date().toISOString(),
    phases,
    tasks,
  };
}

function buildBackwardPlan({ start, deadline, type }) {
  const base = templates[type] || templates.residentContract;
  const reverseBase = [...base].reverse();
  const reversePlan = reverseBase.map((phase, index) => ({
    ...phase,
    reverseOrder: index + 1,
    tasks: adjustTasks(phase.tasks),
  }));

  const totalDays = diffDays(start, deadline) + 1;
  const totalWeight = reversePlan.reduce((sum, phase) => sum + phase.weight, 0);
  let consumedWeight = 0;

  const reversedWithDates = reversePlan.map((phase) => {
    const endOffset = Math.round(((totalWeight - consumedWeight) / totalWeight) * (totalDays - 1));
    consumedWeight += phase.weight;
    const startOffset = Math.round(((totalWeight - consumedWeight) / totalWeight) * (totalDays - 1));

    return {
      id: makeId(),
      name: phase.name,
      reverseOrder: phase.reverseOrder,
      startDate: toDateInput(addDays(start, Math.min(startOffset, endOffset))),
      endDate: toDateInput(addDays(start, Math.max(startOffset, endOffset))),
      tasks: phase.tasks,
    };
  });

  return reversedWithDates.reverse().map((phase, index) => ({
    ...phase,
    order: index + 1,
    color: phaseColors[index % phaseColors.length],
  }));
}

function adjustTasks(tasks) {
  const middle = Math.max(1, tasks.length - 1);
  return [...tasks.slice(0, middle), ...fullBreakdownAddons, ...tasks.slice(middle)];
}

function distributeTaskDate(phase, taskIndex) {
  const start = parseInputDate(phase.startDate);
  const end = parseInputDate(phase.endDate);
  const span = Math.max(0, diffDays(start, end));
  const denominator = Math.max(1, phase.tasks.length - 1);
  const offset = Math.round((span * taskIndex) / denominator);
  return toDateInput(addDays(start, offset));
}

function handleQuickTaskSubmit(event) {
  event.preventDefault();
  const project = getActiveProject();
  const title = elements.quickTaskInput.value.trim();
  if (!project || !title) return;

  const fallbackDate = project.deadline || toDateInput(new Date());
  const dueDate = elements.quickTaskDate.value || fallbackDate;
  const phase = findPhaseForDate(project, dueDate) || project.phases[project.phases.length - 1];

  project.tasks.push({
    id: makeId(),
    title,
    phaseId: phase?.id || "extra",
    phaseName: phase?.name || "補充",
    dueDate,
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

function findPhaseForDate(project, dateValue) {
  const target = parseInputDate(dateValue);
  return project.phases.find((phase) => {
    const start = parseInputDate(phase.startDate);
    const end = parseInputDate(phase.endDate);
    return target >= start && target <= end;
  });
}

function fillExample() {
  elements.projectTitle.value = "進駐廠商契約用印查檢";
  elements.projectOutcome.value =
    "用印申請、契約正本、廠商證明文件、品保文件與保單皆確認完成。";
  elements.projectType.value = "residentContract";
  elements.projectStart.value = toDateInput(new Date());
  elements.projectDeadline.value = toDateInput(addDays(new Date(), 10));
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
            <span>${formatDate(project.deadline)} 完成</span>
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
  const today = startOfDay(new Date());
  const nextWeek = addDays(today, 7);
  const dueSoon = tasks.filter((task) => {
    if (task.done) return false;
    const due = parseInputDate(task.dueDate);
    return due >= today && due <= nextWeek;
  });

  elements.totalTasks.textContent = String(tasks.length);
  elements.doneTasks.textContent = String(done.length);
  elements.dueSoonTasks.textContent = String(dueSoon.length);
}

function renderActiveProject() {
  const project = getActiveProject();
  const hasProject = Boolean(project);

  elements.exportButton.disabled = !hasProject;
  elements.deleteProjectButton.disabled = !hasProject;
  elements.quickTaskInput.disabled = !hasProject;
  elements.quickTaskDate.disabled = !hasProject;

  if (!project) {
    elements.activeTitle.textContent = "尚未建立專案";
    elements.progressLabel.textContent = "0%";
    elements.dateRangeLabel.textContent = "-";
    elements.progressBar.style.width = "0%";
    elements.phaseStrip.innerHTML = `<div class="empty-state">建立目標後會出現階段</div>`;
    elements.taskList.innerHTML = `<div class="empty-state">任務會依開始日到完成日排列</div>`;
    elements.nextTaskBox.innerHTML = `<span>建立第一個專案</span>`;
    elements.outcomeText.textContent = "-";
    elements.reverseList.innerHTML = "";
    return;
  }

  const progress = getProgress(project);
  elements.activeTitle.textContent = project.title;
  elements.progressLabel.textContent = `${progress}%`;
  elements.dateRangeLabel.textContent = `${formatDate(project.startDate)} - ${formatDate(project.deadline)}`;
  elements.progressBar.style.width = `${progress}%`;
  elements.outcomeText.textContent = project.outcome;
  elements.quickTaskDate.value = toDateInput(new Date());

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
          <p class="phase-date">${formatDate(phase.startDate)} - ${formatDate(phase.endDate)}</p>
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
            <span>${formatDate(task.dueDate)}</span>
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
  return "";
}

function updateTaskNote(projectId, taskId, value, field) {
  const project = state.projects.find((item) => item.id === projectId);
  const task = project?.tasks.find((item) => item.id === taskId);
  if (!task) return;

  task.note = value;
  autoSizeNoteField(field);
  clearTimeout(state.noteSaveTimer);
  state.noteSaveTimer = setTimeout(saveState, 250);
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
      <span>${escapeHtml(nextTask.phaseName)} · ${formatDate(nextTask.dueDate)}</span>
    `;
  } else {
    elements.nextTaskBox.innerHTML = `<strong>全部完成</strong><span>${formatDate(project.deadline)}</span>`;
  }

  elements.reverseList.innerHTML = [...project.phases]
    .reverse()
    .map(
      (phase) => `
        <li>
          <strong>${escapeHtml(phase.name)}</strong>
          ${formatDate(phase.startDate)} - ${formatDate(phase.endDate)}
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
    `期間：${formatDate(project.startDate)} - ${formatDate(project.deadline)}`,
    "",
    ...project.phases.flatMap((phase) => {
      const tasks = getOrderedTasks(project)
        .filter((task) => task.phaseId === phase.id)
        .flatMap((task) => {
          const rows = [`- [${task.done ? "x" : " "}] ${formatDate(task.dueDate)} ${task.title}`];
          if (task.note?.trim()) rows.push(`  備註：${task.note.trim()}`);
          return rows;
        });
      return [`## ${phase.name} (${formatDate(phase.startDate)} - ${formatDate(phase.endDate)})`, ...tasks, ""];
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
  if (!project?.tasks?.length) return;
  project.tasks.forEach((task) => {
    if (typeof task.note !== "string") task.note = "";
  });

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

  const dateA = parseInputDate(a.dueDate);
  const dateB = parseInputDate(b.dueDate);
  if (dateA && dateB && dateA.getTime() !== dateB.getTime()) return dateA - dateB;

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

  return "依任務清單完成交付並保留後續追蹤項目。";
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date, days) {
  const copy = startOfDay(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function diffDays(start, end) {
  return Math.round((startOfDay(end) - startOfDay(start)) / MS_PER_DAY);
}

function parseInputDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return startOfDay(new Date(year, month - 1, day));
}

function toDateInput(date) {
  const target = startOfDay(date);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  const date = typeof value === "string" ? parseInputDate(value) : value;
  if (!date) return "-";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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

function readStorage() {
  try {
    return window.localStorage?.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function writeStorage(value) {
  try {
    window.localStorage?.setItem(STORAGE_KEY, value);
  } catch {
    // The app keeps working even if browser storage is unavailable.
  }
}
