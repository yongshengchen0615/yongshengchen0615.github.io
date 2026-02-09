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

  // 避免多次呼叫 showBlocker_ 導致重複綁定 listener
  const copyBtn = document.getElementById("btnCopyUserId");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(String(userId || ""));
        toast("已複製 userId", "ok");
      } catch (_) {
        toast("複製失敗", "err");
      }
    };
  }

  const closeBtn = document.getElementById("btnCloseLiff");
  if (closeBtn) {
    closeBtn.onclick = () => {
      try {
        if (liff?.closeWindow) liff.closeWindow();
      } catch (_) {}
      blocker.hidden = true;
    };
  }
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
  // 同步頂部切換按鈕文字（與 schedule 模組顯示一致）
  try {
    const btn = document.getElementById("themeToggle");
    if (btn) btn.textContent = saved === "dark" ? "🌙 深色" : "☀️ 淺色";
  } catch (_) {}
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
  // 更新頂部按鈕文字以反映新主題
  try {
    const btn = document.getElementById("themeToggle");
    if (btn) btn.textContent = next === "dark" ? "🌙 深色" : "☀️ 淺色";
  } catch (_) {}
}

/* =========================
 * Render
 * ========================= */

/**
 * 產生技師欄位 cell（是/否 toggle）。
 * @param {string} field - AdminRow 欄位名
 * @param {string} value - 目前值
 */
function ynCell_(field, value, label) {
  const v = normalizeYesNo_(value);
  return `
    <td data-label="${escapeHtml(label || field)}" class="yn-cell">
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
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="20">無資料</td></tr>`;
    return;
  }

  // ✅ 大量資料時 innerHTML 一次寫入通常比 createElement/append 更快
  const rowsHtml = filtered
    .map((a, i) => {
      const userId = String(a.userId || "");
      const isDirty = dirtyMap.has(userId);
      const auditNow = normalizeAudit_(a.audit);
      return `
        <tr data-userid="${escapeHtml(userId)}" class="${isDirty ? "dirty" : ""}">
          <td class="sticky-col col-check" data-label="選取">
            <input class="row-check" type="checkbox" ${selectedIds.has(userId) ? "checked" : ""} aria-label="選取此列">
          </td>
          <td data-label="#">${i + 1}</td>

          <td data-label="lineUserId"><span style="font-family:var(--mono)">${escapeHtml(userId)}</span></td>
          <td data-label="lineDisplayName">${escapeHtml(a.displayName)}</td>

          <td data-label="審核狀態">
            <select data-field="audit" class="select" aria-label="審核狀態">
              ${AUDIT_ENUM.map((v) => `<option value="${v}" ${auditNow === v ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </td>

          <td data-label="建立時間"><span style="font-family:var(--mono)">${escapeHtml(a.createdAt)}</span></td>
          <td data-label="最後登入"><span style="font-family:var(--mono)">${escapeHtml(a.lastLogin)}</span></td>

          ${ynCell_("pushFeatureEnabled", a.pushFeatureEnabled, "推播功能開通")}
          ${ynCell_("techAudit", a.techAudit, "技師審核狀態")}
          ${ynCell_("techCreatedAt", a.techCreatedAt, "技師建立時間")}
          ${ynCell_("techStartDate", a.techStartDate, "技師開始使用日期")}
          ${ynCell_("techExpiryDate", a.techExpiryDate, "技師使用期限")}
          ${ynCell_("techMasterNo", a.techMasterNo, "技師師傅編號")}
          ${ynCell_("techIsMaster", a.techIsMaster, "技師是否師傅")}
          ${ynCell_("techPushEnabled", a.techPushEnabled, "技師是否推播")}
          ${ynCell_("techPersonalStatusEnabled", a.techPersonalStatusEnabled, "技師個人狀態開通")}
          ${ynCell_("techScheduleEnabled", a.techScheduleEnabled, "技師排班表開通")}
          ${ynCell_("techPerformanceEnabled", a.techPerformanceEnabled, "技師業績開通")}
          ${ynCell_("techAppointmentQueryEnabled", a.techAppointmentQueryEnabled, "技師預約查詢開通")}

          <td class="sticky-right" data-label="操作">
            <div class="actions">
              ${isDirty ? `<span class="dirty-dot" title="未儲存"></span>` : ``}
              <button class="btn danger btn-del" type="button">刪除</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  tbody.innerHTML = rowsHtml;

  if (savingAll) {
    tbody.querySelectorAll("input, select, button").forEach((el) => (el.disabled = true));
  }

  // notify that admins render completed (dispatch on next rAF to ensure repaint)
  try {
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => {
        try {
          window.dispatchEvent(new CustomEvent("admin:rendered", { detail: "admins" }));
        } catch (e) {}
      });
    } else {
      // fallback
      try {
        window.dispatchEvent(new CustomEvent("admin:rendered", { detail: "admins" }));
      } catch (e) {}
    }
  } catch (e) {}
}

/**
 * 更新 KPI 統計資訊。
 * - 統計基準使用 allAdmins（非 filtered）
 */
function invalidateStats_() {
  statsDirty = true;
}

function maybeUpdateStats_() {
  if (!statsDirty) return;

  let approved = 0;
  let pending = 0;
  let rejected = 0;
  let disabled = 0;
  let maintenance = 0;

  for (const a of allAdmins) {
    const audit = normalizeAudit_(a.audit);
    if (audit === "通過") approved += 1;
    else if (audit === "待審核") pending += 1;
    else if (audit === "拒絕") rejected += 1;
    else if (audit === "停用") disabled += 1;
    else if (audit === "系統維護") maintenance += 1;
  }

  statsCache = {
    total: allAdmins.length,
    approved,
    pending,
    rejected,
    disabled,
    maintenance,
  };
  statsDirty = false;

  setText_("kpiTotal", statsCache.total);
  setText_("kpiApproved", statsCache.approved);
  setText_("kpiPending", statsCache.pending);
  setText_("kpiRejected", statsCache.rejected);
  setText_("kpiDisabled", statsCache.disabled);
  setText_("kpiMaintenance", statsCache.maintenance);

  const s = $("#summaryText");
  if (s && !s.hidden)
    s.textContent =
      `總筆數：${statsCache.total}（` +
      `通過 ${statsCache.approved} / ` +
      `待審核 ${statsCache.pending} / ` +
      `拒絕 ${statsCache.rejected} / ` +
      `停用 ${statsCache.disabled} / ` +
      `系統維護 ${statsCache.maintenance}` +
      `）`;
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
