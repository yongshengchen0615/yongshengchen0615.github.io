/* ================================
 * Admin 審核管理台 - UI/渲染/鎖定
 * ================================ */

/**
 * 更新登入狀態顯示文字。
 * @param {string} t
 */
function setAuthText_(t) {
  const el = document.getElementById("authText");
  if (el) el.textContent = String(t || "");
}

/**
 * 顯示無權限 overlay。
 * - 讓使用者可複製 userId 以便聯絡管理員
 * - 可嘗試關閉 LIFF 視窗
 */
function showBlocker_(msg, userId, displayName, audit) {
  const blocker = document.getElementById("blocker");
  const meta = document.getElementById("blockerMeta");
  const p = document.getElementById("blockerMsg");
  if (!blocker) return;

  if (p) p.textContent = msg;
  if (meta) {
    meta.textContent =
      `userId: ${userId || "-"}\n` +
      `displayName: ${displayName || "-"}\n` +
      `audit: ${audit || "-"}`;
  }

  blocker.hidden = false;

  document.getElementById("btnCopyUserId")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(String(userId || ""));
      toast("已複製 userId", "ok");
    } catch (_) {
      toast("複製失敗", "err");
    }
  });

  document.getElementById("btnCloseLiff")?.addEventListener("click", () => {
    try {
      if (liff?.closeWindow) liff.closeWindow();
    } catch (_) {}
    blocker.hidden = true;
  });
}

/* =========================
 * Theme
 * ========================= */

/**
 * 初始化主題：
 * - localStorage.theme: dark | light
 * - 透過 html[data-theme] 讓 CSS variables 生效
 */
function initTheme_() {
  const saved = localStorage.getItem("theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
}

/**
 * 切換主題（儲存中時不允許切換）。
 */
function toggleTheme_() {
  if (savingAll) return;
  const cur = document.documentElement.getAttribute("data-theme") || "dark";
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
}

/* =========================
 * Render
 * ========================= */

/**
 * 產生技師欄位 cell（是/否 toggle）。
 * @param {string} field - AdminRow 欄位名
 * @param {string} value - 目前值
 */
function ynCell_(field, value) {
  const v = normalizeYesNo_(value);
  return `
    <td>
      <button type="button" class="yn-toggle" data-field="${field}" data-val="${v}" aria-label="${field}">
        ${v}
      </button>
    </td>
  `;
}

/**
 * 依照 filtered 內容渲染 table。
 * - 每列會用 dataset.userid 保存 userId
 * - dirty 列會加上 .dirty 樣式提示
 */
function render_() {
  const tbody = $("#tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="17">無資料</td></tr>`;
    return;
  }

  const frag = document.createDocumentFragment();

  filtered.forEach((a, i) => {
    const isDirty = dirtyMap.has(a.userId);
    const tr = document.createElement("tr");
    tr.dataset.userid = a.userId;
    if (isDirty) tr.classList.add("dirty");

    // ✅ 固定 17 欄
    tr.innerHTML = `
      <td class="sticky-col col-check">
        <input class="row-check" type="checkbox" ${selectedIds.has(a.userId) ? "checked" : ""} aria-label="選取此列">
      </td>
      <td>${i + 1}</td>

      <td><span style="font-family:var(--mono)">${escapeHtml(a.userId)}</span></td>
      <td>${escapeHtml(a.displayName)}</td>

      <td>
        <select data-field="audit" class="select" aria-label="審核狀態">
          ${AUDIT_ENUM.map((v) => `<option value="${v}" ${normalizeAudit_(a.audit) === v ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </td>

      <td><span style="font-family:var(--mono)">${escapeHtml(a.createdAt)}</span></td>
      <td><span style="font-family:var(--mono)">${escapeHtml(a.lastLogin)}</span></td>

      ${ynCell_("techAudit", a.techAudit)}
      ${ynCell_("techCreatedAt", a.techCreatedAt)}
      ${ynCell_("techStartDate", a.techStartDate)}
      ${ynCell_("techExpiryDate", a.techExpiryDate)}
      ${ynCell_("techMasterNo", a.techMasterNo)}
      ${ynCell_("techIsMaster", a.techIsMaster)}
      ${ynCell_("techPushEnabled", a.techPushEnabled)}
      ${ynCell_("techPersonalStatusEnabled", a.techPersonalStatusEnabled)}
      ${ynCell_("techScheduleEnabled", a.techScheduleEnabled)}

      <td class="sticky-right">
        <div class="actions">
          ${isDirty ? `<span class="dirty-dot" title="未儲存"></span>` : ``}
          <button class="btn danger btn-del" type="button">刪除</button>
        </div>
      </td>
    `;

    frag.appendChild(tr);
  });

  tbody.appendChild(frag);

  if (savingAll) {
    tbody.querySelectorAll("input, select, button").forEach((el) => (el.disabled = true));
  }
}

/**
 * 更新 KPI 統計資訊。
 * - 統計基準使用 allAdmins（非 filtered）
 */
function updateStats_() {
  const total = allAdmins.length;
  const approved = allAdmins.filter((a) => normalizeAudit_(a.audit) === "通過").length;
  const pending = allAdmins.filter((a) => normalizeAudit_(a.audit) === "待審核").length;
  const rejected = allAdmins.filter((a) => normalizeAudit_(a.audit) === "拒絕").length;

  setText_("kpiTotal", total);
  setText_("kpiApproved", approved);
  setText_("kpiPending", pending);
  setText_("kpiRejected", rejected);

  const s = $("#summaryText");
  if (s) s.textContent = `總筆數：${total}（通過 ${approved} / 待審核 ${pending} / 拒絕 ${rejected}）`;
}

/* =========================
 * UI helpers
 * ========================= */

/**
 * 綁定審核狀態 chips。
 * - 點擊後切換 active，並重新套用篩選
 */
function bindChips_() {
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (savingAll) return;
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      applyFilters_();
    });
  });
}

/**
 * 同步「全選」checkbox 狀態：checked / indeterminate
 */
function syncCheckAll_() {
  const checkAll = $("#checkAll");
  if (!checkAll) return;

  const total = filtered.length;
  const sel = filtered.filter((a) => selectedIds.has(a.userId)).length;

  checkAll.checked = total > 0 && sel === total;
  checkAll.indeterminate = sel > 0 && sel < total;
}

/**
 * 更新批次操作 bar 顯示/隱藏與已選取筆數。
 */
function updateBulkBar_() {
  const bar = $("#bulkBar");
  const count = $("#bulkCount");
  if (!bar || !count) return;

  const n = selectedIds.size;
  bar.hidden = n === 0;
  count.textContent = `已選取 ${n} 筆`;
}

/**
 * 刷新「儲存全部變更」按鈕文字與 disabled。
 */
function refreshSaveAllButton_() {
  const btn = $("#saveAllBtn");
  if (!btn) return;

  const n = dirtyMap.size;
  btn.disabled = savingAll || n === 0;
  btn.textContent = savingAll ? "儲存中..." : n ? `儲存全部變更（${n}）` : "儲存全部變更";
}

/**
 * 更新 footer 顯示狀態。
 */
function updateFooter_() {
  const el = $("#footerStatus");
  if (!el) return;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  const dirty = dirtyMap.size ? `，未儲存 ${dirtyMap.size} 筆` : "";
  el.textContent = `最後更新：${hh}:${mm}:${ss}，目前顯示 ${filtered.length} 筆${dirty}`;
}

/**
 * 全域鎖定 UI：
 * - 鎖定 topbar、搜尋、批次、chips
 * - 另外 render_() 也會在 savingAll 時 disable tbody 內的互動元件
 */
function setLock_(locked) {
  LOCKABLE_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });

  document.querySelectorAll(".chip").forEach((el) => (el.disabled = locked));
}

/**
 * 更新某一列的 dirty UI 狀態 + footer/button。
 * @param {Element} row
 * @param {string} userId
 */
function updateRowDirtyStateUI_(row, userId) {
  row.classList.toggle("dirty", dirtyMap.has(userId));
  refreshSaveAllButton_();
  updateFooter_();
}
