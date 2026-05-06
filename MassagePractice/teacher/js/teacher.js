(function () {
  "use strict";

  const ADMIN_KEY = "teacherAdminKey";
  let students = [];
  let selectedAttendanceUuid = "";

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
    closeAttendanceButton: document.getElementById("closeAttendanceButton")
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
    if (!record.checkOutAt) return "進行中";

    const start = new Date(record.checkInAt);
    const end = new Date(record.checkOutAt);
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
                <button class="button button--records" data-action="records" data-uuid="${uuid}" type="button">紀錄</button>
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

    try {
      const data = await AppApi.post("listStudents", { adminKey: key });
      sessionStorage.setItem(ADMIN_KEY, key);
      students = data.students || [];
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

  function bindEvents() {
    elements.connectButton.addEventListener("click", loadStudents);
    elements.reloadButton.addEventListener("click", loadStudents);
    elements.closeAttendanceButton.addEventListener("click", hideAttendanceRecords);
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

      updateStatus(button.dataset.uuid, button.dataset.action);
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
