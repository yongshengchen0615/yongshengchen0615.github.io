(function () {
  "use strict";

  const ADMIN_KEY = "teacherAdminKey";
  let students = [];
  let selectedAttendanceUuid = "";
  let selectedPracticeUuid = "";
  let practiceSettings = {
    targets: [],
    items: []
  };

  const elements = {
    adminKey: document.getElementById("adminKey"),
    connectButton: document.getElementById("connectButton"),
    reloadButton: document.getElementById("reloadButton"),
    searchInput: document.getElementById("searchInput"),
    statusFilter: document.getElementById("statusFilter"),
    totalCount: document.getElementById("totalCount"),
    pendingCount: document.getElementById("pendingCount"),
    approvedCount: document.getElementById("approvedCount"),
    emptyState: document.getElementById("emptyState"),
    tableWrap: document.getElementById("tableWrap"),
    studentsBody: document.getElementById("studentsBody"),
    attendanceRegion: document.getElementById("attendanceRegion"),
    attendanceTitle: document.getElementById("attendanceTitle"),
    attendanceEmpty: document.getElementById("attendanceEmpty"),
    attendanceTableWrap: document.getElementById("attendanceTableWrap"),
    attendanceBody: document.getElementById("attendanceBody"),
    closeAttendanceButton: document.getElementById("closeAttendanceButton"),
    practiceTargetInput: document.getElementById("practiceTargetInput"),
    practiceItemInput: document.getElementById("practiceItemInput"),
    addPracticeTargetButton: document.getElementById("addPracticeTargetButton"),
    addPracticeItemButton: document.getElementById("addPracticeItemButton"),
    practiceTargetList: document.getElementById("practiceTargetList"),
    practiceItemList: document.getElementById("practiceItemList"),
    practiceRecordRegion: document.getElementById("practiceRecordRegion"),
    practiceRecordTitle: document.getElementById("practiceRecordTitle"),
    practiceRecordEmpty: document.getElementById("practiceRecordEmpty"),
    practiceRecordTableWrap: document.getElementById("practiceRecordTableWrap"),
    practiceRecordBody: document.getElementById("practiceRecordBody"),
    closePracticeRecordButton: document.getElementById("closePracticeRecordButton")
  };

  const statusLabels = {
    pending: "待審核",
    approved: "已通過",
    rejected: "未通過"
  };

  function adminKey() {
    return elements.adminKey.value.trim() || sessionStorage.getItem(ADMIN_KEY) || "";
  }

  function setLoading(isLoading) {
    elements.connectButton.disabled = isLoading;
    elements.reloadButton.disabled = isLoading;
    elements.addPracticeTargetButton.disabled = isLoading;
    elements.addPracticeItemButton.disabled = isLoading;
  }

  function setEmpty(message) {
    elements.emptyState.textContent = message;
    elements.emptyState.hidden = false;
    elements.tableWrap.hidden = true;
  }

  function setAttendanceEmpty(message) {
    elements.attendanceEmpty.textContent = message;
    elements.attendanceEmpty.hidden = false;
    elements.attendanceTableWrap.hidden = true;
  }

  function setPracticeRecordEmpty(message) {
    elements.practiceRecordEmpty.textContent = message;
    elements.practiceRecordEmpty.hidden = false;
    elements.practiceRecordTableWrap.hidden = true;
  }

  function filteredStudents() {
    const query = elements.searchInput.value.trim().toLowerCase();
    const status = elements.statusFilter.value;

    return students.filter((student) => {
      const matchesStatus = status === "all" || student.status === status;
      const haystack = [student.lineName, student.lineUserId, student.uuid].join(" ").toLowerCase();
      return matchesStatus && (!query || haystack.includes(query));
    });
  }

  function updateMetrics() {
    elements.totalCount.textContent = String(students.length);
    elements.pendingCount.textContent = String(students.filter((student) => student.status === "pending").length);
    elements.approvedCount.textContent = String(students.filter((student) => student.status === "approved").length);
  }

  function durationLabel(record) {
    const startValue = record.checkInAt || record.startedAt;
    const endValue = record.checkOutAt || record.endedAt;

    if (!endValue) return "進行中";

    const start = new Date(startValue);
    const end = new Date(endValue);
    const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));

    if (!Number.isFinite(minutes)) return "-";
    if (minutes < 60) return `${minutes} 分鐘`;

    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} 小時 ${rest} 分鐘` : `${hours} 小時`;
  }

  function hideAttendanceRecords() {
    selectedAttendanceUuid = "";
    elements.attendanceRegion.hidden = true;
    elements.attendanceBody.innerHTML = "";
  }

  function hidePracticeRecords() {
    selectedPracticeUuid = "";
    elements.practiceRecordRegion.hidden = true;
    elements.practiceRecordBody.innerHTML = "";
  }

  function renderPracticeSettings() {
    renderPracticeOptionList(elements.practiceTargetList, practiceSettings.targets, "deletePracticeTarget");
    renderPracticeOptionList(elements.practiceItemList, practiceSettings.items, "deletePracticeItem");
  }

  function renderPracticeOptionList(container, options, action) {
    if (!options.length) {
      container.innerHTML = '<div class="option-list__empty">尚未新增。</div>';
      return;
    }

    container.innerHTML = options
      .map((option) => {
        return `
          <div class="option-pill">
            <span>${AppApi.escapeHtml(option.name)}</span>
            <button class="button button--delete" data-action="${action}" data-id="${AppApi.escapeHtml(option.id)}" type="button">移除</button>
          </div>
        `;
      })
      .join("");
  }

  function render() {
    updateMetrics();
    const rows = filteredStudents();

    if (!rows.length) {
      setEmpty(students.length ? "沒有符合條件的學員。" : "目前沒有學員資料。");
      return;
    }

    elements.emptyState.hidden = true;
    elements.tableWrap.hidden = false;

    elements.studentsBody.innerHTML = rows
      .map((student) => {
        const status = student.status || "pending";
        const name = AppApi.escapeHtml(student.lineName || "LINE 使用者");
        const picture = AppApi.escapeHtml(student.linePictureUrl || AppApi.avatarPlaceholder());
        const lineUserId = AppApi.escapeHtml(student.lineUserId || "-");
        const uuid = AppApi.escapeHtml(student.uuid || "");
        const badge = `<span class="badge badge--${status}">${statusLabels[status] || status}</span>`;

        return `
          <tr>
            <td>
              <div class="student-cell">
                <img src="${picture}" alt="" loading="lazy" />
                <div>
                  <strong>${name}</strong>
                  <span>${AppApi.escapeHtml(student.reviewNote || "")}</span>
                </div>
              </div>
            </td>
            <td><span class="uuid">${lineUserId}</span></td>
            <td>${badge}</td>
            <td>${AppApi.formatDate(student.createdAt)}</td>
            <td>${AppApi.formatDate(student.updatedAt)}</td>
            <td>
              <div class="actions">
                <button class="button button--approve" data-action="approved" data-uuid="${uuid}" type="button">通過</button>
                <button class="button button--pending" data-action="pending" data-uuid="${uuid}" type="button">待審</button>
                <button class="button button--reject" data-action="rejected" data-uuid="${uuid}" type="button">未通過</button>
                <button class="button button--records" data-action="records" data-uuid="${uuid}" type="button">簽到</button>
                <button class="button button--records" data-action="practiceRecords" data-uuid="${uuid}" type="button">練習</button>
                <button class="button button--delete" data-action="delete" data-uuid="${uuid}" type="button">移除</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  async function loadStudents() {
    const key = adminKey();
    if (!key) {
      setEmpty("請先輸入管理密鑰。");
      return;
    }

    setLoading(true);
    setEmpty("正在載入學員名單。");
    hideAttendanceRecords();
    hidePracticeRecords();

    try {
      const data = await AppApi.post("listStudents", { adminKey: key });
      const settings = await AppApi.post("listPracticeSettings", { adminKey: key });
      sessionStorage.setItem(ADMIN_KEY, key);
      students = data.students || [];
      practiceSettings = {
        targets: settings.targets || [],
        items: settings.items || []
      };
      renderPracticeSettings();
      render();
    } catch (error) {
      setEmpty(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(uuid, status) {
    const key = adminKey();
    const current = students.find((student) => student.uuid === uuid);
    const note =
      status === "rejected"
        ? window.prompt("未通過原因，可留空：", current ? current.reviewNote || "" : "") || ""
        : "";

    setLoading(true);

    try {
      const updated = await AppApi.post("updateStudentStatus", {
        adminKey: key,
        uuid,
        status,
        reviewNote: note
      });

      students = students.map((student) => (student.uuid === uuid ? updated.student : student));
      render();
    } catch (error) {
      window.alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteStudent(uuid) {
    const key = adminKey();
    const current = students.find((student) => student.uuid === uuid);
    const name = current ? current.lineName || current.lineUserId || current.uuid : uuid;

    if (!window.confirm(`確定移除「${name}」？這會從 Google Sheet 刪除此學員資料。`)) {
      return;
    }

    setLoading(true);

    try {
      await AppApi.post("deleteStudent", {
        adminKey: key,
        uuid
      });

      students = students.filter((student) => student.uuid !== uuid);
      if (selectedAttendanceUuid === uuid) hideAttendanceRecords();
      if (selectedPracticeUuid === uuid) hidePracticeRecords();
      render();
    } catch (error) {
      window.alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadAttendanceRecords(uuid) {
    const key = adminKey();
    const current = students.find((student) => student.uuid === uuid);
    const name = current ? current.lineName || current.lineUserId || current.uuid : uuid;

    selectedAttendanceUuid = uuid;
    elements.attendanceRegion.hidden = false;
    elements.attendanceTitle.textContent = `${name} 簽到紀錄`;
    elements.attendanceBody.innerHTML = "";
    setAttendanceEmpty("正在載入簽到紀錄。");
    setLoading(true);

    try {
      const data = await AppApi.post("listAttendanceRecords", {
        adminKey: key,
        uuid
      });
      const records = data.records || [];

      elements.attendanceTitle.textContent = `${data.student.lineName || name} 簽到紀錄`;

      if (!records.length) {
        setAttendanceEmpty("目前沒有簽到紀錄。");
        return;
      }

      elements.attendanceEmpty.hidden = true;
      elements.attendanceTableWrap.hidden = false;
      elements.attendanceBody.innerHTML = records
        .map((record) => {
          const status = record.checkOutAt
            ? '<span class="badge badge--closed">已簽退</span>'
            : '<span class="badge badge--active">進行中</span>';

          return `
            <tr>
              <td>${AppApi.formatDate(record.checkInAt)}</td>
              <td>${record.checkOutAt ? AppApi.formatDate(record.checkOutAt) : "-"}</td>
              <td>${durationLabel(record)}</td>
              <td>${status}</td>
            </tr>
          `;
        })
        .join("");
    } catch (error) {
      setAttendanceEmpty(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadPracticeRecords(uuid) {
    const key = adminKey();
    const current = students.find((student) => student.uuid === uuid);
    const name = current ? current.lineName || current.lineUserId || current.uuid : uuid;

    selectedPracticeUuid = uuid;
    elements.practiceRecordRegion.hidden = false;
    elements.practiceRecordTitle.textContent = `${name} 練習紀錄`;
    elements.practiceRecordBody.innerHTML = "";
    setPracticeRecordEmpty("正在載入練習紀錄。");
    setLoading(true);

    try {
      const data = await AppApi.post("listPracticeRecords", {
        adminKey: key,
        uuid
      });
      const records = data.records || [];

      elements.practiceRecordTitle.textContent = `${data.student.lineName || name} 練習紀錄`;

      if (!records.length) {
        setPracticeRecordEmpty("目前沒有練習紀錄。");
        return;
      }

      elements.practiceRecordEmpty.hidden = true;
      elements.practiceRecordTableWrap.hidden = false;
      elements.practiceRecordBody.innerHTML = records
        .map((record) => {
          const status = record.endedAt
            ? '<span class="badge badge--closed">已結束</span>'
            : '<span class="badge badge--active">進行中</span>';

          return `
            <tr>
              <td>${AppApi.escapeHtml(record.targetName || "-")}</td>
              <td>${AppApi.escapeHtml(record.itemName || "-")}</td>
              <td>${AppApi.formatDate(record.startedAt)}</td>
              <td>${record.endedAt ? AppApi.formatDate(record.endedAt) : "-"}</td>
              <td>${durationLabel(record)}</td>
              <td>${status}</td>
            </tr>
          `;
        })
        .join("");
    } catch (error) {
      setPracticeRecordEmpty(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function addPracticeOption(action, input, settingsKey) {
    const key = adminKey();
    const name = input.value.trim();

    if (!key) {
      window.alert("請先輸入管理密鑰。");
      return;
    }

    if (!name) {
      window.alert("請輸入名稱。");
      return;
    }

    setLoading(true);

    try {
      const data = await AppApi.post(action, {
        adminKey: key,
        name
      });
      const option = data.target || data.item;
      practiceSettings[settingsKey] = [option].concat(practiceSettings[settingsKey]);
      input.value = "";
      renderPracticeSettings();
    } catch (error) {
      window.alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function deletePracticeOption(action, id, settingsKey) {
    const key = adminKey();

    if (!window.confirm("確定移除此選項？既有練習紀錄會保留原本名稱。")) {
      return;
    }

    setLoading(true);

    try {
      await AppApi.post(action, {
        adminKey: key,
        id
      });
      practiceSettings[settingsKey] = practiceSettings[settingsKey].filter((option) => option.id !== id);
      renderPracticeSettings();
    } catch (error) {
      window.alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  function bindEvents() {
    elements.connectButton.addEventListener("click", loadStudents);
    elements.reloadButton.addEventListener("click", loadStudents);
    elements.closeAttendanceButton.addEventListener("click", hideAttendanceRecords);
    elements.closePracticeRecordButton.addEventListener("click", hidePracticeRecords);
    elements.addPracticeTargetButton.addEventListener("click", () => {
      addPracticeOption("addPracticeTarget", elements.practiceTargetInput, "targets");
    });
    elements.addPracticeItemButton.addEventListener("click", () => {
      addPracticeOption("addPracticeItem", elements.practiceItemInput, "items");
    });
    elements.practiceTargetInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") addPracticeOption("addPracticeTarget", elements.practiceTargetInput, "targets");
    });
    elements.practiceItemInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") addPracticeOption("addPracticeItem", elements.practiceItemInput, "items");
    });
    elements.searchInput.addEventListener("input", render);
    elements.statusFilter.addEventListener("change", render);
    elements.adminKey.addEventListener("keydown", (event) => {
      if (event.key === "Enter") loadStudents();
    });

    elements.studentsBody.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      if (button.dataset.action === "delete") {
        deleteStudent(button.dataset.uuid);
        return;
      }

      if (button.dataset.action === "records") {
        loadAttendanceRecords(button.dataset.uuid);
        return;
      }

      if (button.dataset.action === "practiceRecords") {
        loadPracticeRecords(button.dataset.uuid);
        return;
      }

      updateStatus(button.dataset.uuid, button.dataset.action);
    });

    elements.practiceTargetList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      deletePracticeOption(button.dataset.action, button.dataset.id, "targets");
    });

    elements.practiceItemList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      deletePracticeOption(button.dataset.action, button.dataset.id, "items");
    });
  }

  async function init() {
    bindEvents();

    setLoading(true);
    try {
      await AppApi.loadConfig();
    } catch (error) {
      setEmpty(error.message);
      setLoading(false);
      return;
    }
    setLoading(false);

    const savedKey = sessionStorage.getItem(ADMIN_KEY);
    if (savedKey) {
      elements.adminKey.value = savedKey;
      loadStudents();
    }
  }

  init();
})();
