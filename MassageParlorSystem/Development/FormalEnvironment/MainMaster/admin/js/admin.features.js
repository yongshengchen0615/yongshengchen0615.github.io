/* ================================
 * Admin 審核管理台 - 功能流程（事件/授權/載入/批次/儲存）
 * ================================ */

/* =========================
 * Init - Event bindings
 * ========================= */

/**
 * 綁定右上角工具列按鈕。
 * - 切換主題 / 重新整理 / 儲存全部
 */
function bindTopbar_() {
  $("#themeToggle")?.addEventListener("click", toggleTheme_);
  $("#reloadBtn")?.addEventListener("click", () => loadAdmins_());
  $("#saveAllBtn")?.addEventListener("click", () => saveAllDirty_());
}

/**
 * 綁定搜尋輸入與清除按鈕。
 * - input 使用 debounce 避免輸入時頻繁重繪 table
 */
function bindSearch_() {
  $("#clearSearchBtn")?.addEventListener("click", () => {
    if (savingAll) return;
    const si = $("#searchInput");
    if (si) si.value = "";
    applyFilters_();
  });

  $("#searchInput")?.addEventListener(
    "input",
    debounce(() => {
      if (savingAll) return;
      applyFilters_();
    }, 180)
  );
}

/* =========================
 * LIFF + AUTH Gate
 * ========================= */

/**
 * LIFF Gate：
 * 1) 初始化 LIFF
 * 2) 若未登入則導向登入
 * 3) 取得 profile.userId / displayName
 * 4) 呼叫 AUTH API：adminUpsertAndCheck（寫入/更新管理員 + 回傳審核/允許狀態）
 * 5) 若不允許，顯示 blocker overlay 並中斷初始化
 */
async function liffGate_() {
  setAuthText_("LIFF 初始化中...");
  await liff.init({ liffId: LIFF_ID });

  if (!liff.isLoggedIn()) {
    setAuthText_("導向登入中...");
    liff.login();
    // 避免後續流程誤以為已通過驗證（login 會導頁）
    const err = new Error("LIFF_LOGIN_REDIRECT");
    err.code = "LIFF_LOGIN_REDIRECT";
    throw err;
  }

  const profile = await liff.getProfile();
  me.userId = String(profile.userId || "").trim();
  me.displayName = String(profile.displayName || "").trim();

  if (!me.userId) throw new Error("LIFF missing userId");

  const ret = await authPost_({
    mode: "adminUpsertAndCheck",
    userId: me.userId,
    displayName: me.displayName,
  });

  if (!ret || !ret.ok) throw new Error(ret?.error || "adminUpsertAndCheck failed");

  me.audit = String(ret.audit || ret.user?.audit || "");
  setAuthText_(`${me.displayName}（${me.audit}）`);

  const allowed = ret.allowed === true || String(me.audit) === "通過";
  if (!allowed) {
    showBlocker_(
      `尚未通過審核（目前：${me.audit}）\n\n請由總管理員將你的狀態改為「通過」。`,
      me.userId,
      me.displayName,
      me.audit
    );
    const err = new Error("ADMIN_NOT_ALLOWED");
    err.code = "ADMIN_NOT_ALLOWED";
    throw err;
  }
}

/* =========================
 * Data load + filter
 * ========================= */

/**
 * 從 ADMIN API 讀取管理員清單。
 * - 會重置 originalMap/dirtyMap/selectedIds
 * - 讀取後會重新套用篩選並渲染
 */
async function loadAdmins_() {
  try {
    setLock_(true);
    const ret = await apiPost_({ mode: "listAdmins" });
    if (!ret.ok) throw new Error(ret.error || "listAdmins failed");

    allAdmins = (ret.admins || []).map(toAdminRow_);

    adminById.clear();
    for (const a of allAdmins) adminById.set(a.userId, a);

    originalMap.clear();
    dirtyMap.clear();
    selectedIds.clear();
    for (const a of allAdmins) originalMap.set(a.userId, snapshot_(a));

    invalidateStats_();

    applyFilters_();
    toast("資料已更新", "ok");
  } catch (e) {
    console.error(e);
    toast("讀取失敗", "err");
  } finally {
    setLock_(false);
  }
}

/**
 * 套用篩選條件並刷新畫面：
 * - keyword：搜尋 userId / displayName
 * - filter：chips 審核狀態
 */
function applyFilters_() {
  const keyword = String($("#searchInput")?.value || "").trim().toLowerCase();
  const active = document.querySelector(".chip.active");
  const filter = active ? String(active.dataset.filter || "ALL") : "ALL";

  filtered = allAdmins.filter((a) => {
    if (filter !== "ALL" && normalizeAudit_(a.audit) !== filter) return false;
    if (keyword) {
      const hay = `${a.userId} ${a.displayName}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });

  render_();
  maybeUpdateStats_();
  syncCheckAll_();
  updateBulkBar_();
  refreshSaveAllButton_();
  updateFooter_();
}

/* =========================
 * Selection + Bulk
 * ========================= */

/**
 * 綁定批次操作區。
 * - 全選、清除選取、批次套用、批次刪除
 */
function bindBulk_() {
  $("#checkAll")?.addEventListener("change", () => {
    if (savingAll) return;
    const el = $("#checkAll");
    const checked = !!el && el.checked;

    // 只更新選取狀態與 checkbox，不需要整表重繪
    filtered.forEach((a) => (checked ? selectedIds.add(a.userId) : selectedIds.delete(a.userId)));
    document.querySelectorAll("#tbody .row-check").forEach((cb) => {
      if (cb instanceof HTMLInputElement) cb.checked = checked;
    });
    syncCheckAll_();
    updateBulkBar_();
  });

  $("#bulkClear")?.addEventListener("click", () => {
    if (savingAll) return;
    selectedIds.clear();

    // 只需要把目前顯示的勾選取消
    document.querySelectorAll("#tbody .row-check").forEach((cb) => {
      if (cb instanceof HTMLInputElement) cb.checked = false;
    });
    syncCheckAll_();
    updateBulkBar_();
  });

  $("#bulkApply")?.addEventListener("click", () => bulkApply_());
  $("#bulkDelete")?.addEventListener("click", () => bulkDelete_());
}

/**
 * 對選取列批次套用審核狀態。
 * - 僅修改前端記憶體資料，並標記 dirty
 * - 實際寫回要點「儲存全部變更」
 */
function bulkApply_() {
  if (savingAll) return;

  const audit = String($("#bulkAudit")?.value || "").trim();
  if (!audit) return toast("請先選擇批次審核狀態", "err");

  const ids = Array.from(selectedIds);
  if (!ids.length) return toast("請先勾選要套用的管理員", "err");

  ids.forEach((id) => {
    const a = getAdminById_(id);
    if (!a) return;
    a.audit = normalizeAudit_(audit);
    markDirty_(id, a);
  });

  invalidateStats_();
  applyFilters_();
  toast("已套用到選取（尚未儲存）", "ok");
}

/**
 * 批次刪除（逐筆呼叫 deleteAdmin）。
 * - 刪除後會重新載入清單。
 */
async function bulkDelete_() {
  if (savingAll) return;

  const ids = Array.from(selectedIds);
  if (!ids.length) return;

  const ok = confirm(`確定要批次刪除？\n\n共 ${ids.length} 筆。\n此操作不可復原。`);
  if (!ok) return;

  setLock_(true);

  try {
    let okCount = 0,
      failCount = 0;
    for (const id of ids) {
      const ret = await apiPost_({ mode: "deleteAdmin", userId: id }).catch(() => ({}));
      if (ret && ret.ok) okCount++;
      else failCount++;
      await sleep_(80);
    }

    toast(
      failCount === 0 ? `批次刪除完成：${okCount} 筆` : `刪除：成功 ${okCount} / 失敗 ${failCount}`,
      failCount ? "err" : "ok"
    );

    await loadAdmins_();
  } finally {
    setLock_(false);
  }
}

/* =========================
 * Table delegation
 * ========================= */

/**
 * Table 事件代理：
 * - tbody 上一次綁定 change + click，避免每列都綁 event
 * - change：checkbox、audit select
 * - click：技師 toggle、刪除
 */
function bindTableDelegation_() {
  const tbody = $("#tbody");
  if (!tbody) return;

  // ✅ change：checkbox + audit 下拉
  tbody.addEventListener("change", (e) => {
    if (savingAll) return;
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    if (t.classList.contains("row-check")) {
      const row = t.closest("tr");
      const id = row?.dataset.userid;
      if (!id) return;
      t.checked ? selectedIds.add(id) : selectedIds.delete(id);
      syncCheckAll_();
      updateBulkBar_();
      return;
    }

    if (t.matches("select[data-field='audit']")) {
      const row = t.closest("tr");
      const id = row?.dataset.userid;
      if (!id) return;

      const a = getAdminById_(id);
      if (!a) return;

      a.audit = normalizeAudit_(t.value);
      markDirty_(id, a);
      updateRowDirtyStateUI_(row, id);

      // audit 變更會影響 KPI
      invalidateStats_();
      maybeUpdateStats_();
    }
  });

  // ✅ click：技師欄位 toggle + 刪除
  tbody.addEventListener("click", async (e) => {
    if (savingAll) return;

    const btn = e.target instanceof Element ? e.target.closest("button") : null;
    if (!btn) return;

    const row = btn.closest("tr");
    const id = row?.dataset.userid;
    if (!id) return;

    // 1) 技師欄位 toggle
    if (btn.classList.contains("yn-toggle")) {
      const field = String(btn.getAttribute("data-field") || "");
      const cur = normalizeYesNo_(btn.getAttribute("data-val"));
      const next = cur === "是" ? "否" : "是";

      if (!TECH_TOGGLE_FIELDS.has(field)) return;

      const a = getAdminById_(id);
      if (!a) return;

      // 僅允許預期欄位被修改，避免任意 data-field 注入
      a[field] = next;

      // update UI
      btn.setAttribute("data-val", next);
      btn.textContent = next;

      markDirty_(id, a);
      updateRowDirtyStateUI_(row, id);
      return;
    }

    // 2) 刪除
    if (btn.classList.contains("btn-del")) {
      const a = getAdminById_(id);
      const ok = confirm(`確定要刪除？\n\nuserId: ${id}\n名稱: ${a?.displayName || ""}`);
      if (!ok) return;

      btn.disabled = true;
      btn.textContent = "刪除中...";
      const ret = await apiPost_({ mode: "deleteAdmin", userId: id }).catch(() => ({}));
      if (ret && ret.ok) {
        toast("刪除完成", "ok");
        await loadAdmins_();
      } else {
        toast("刪除失敗", "err");
        btn.disabled = false;
        btn.textContent = "刪除";
      }
    }
  });
}

/* =========================
 * Save All
 * ========================= */

/**
 * 儲存全部變更：
 * - 送出 dirtyMap 的資料（批次）到 updateAdminsBatch
 * - 後端回傳成功/失敗列表後：更新 originalMap + 清理 dirtyMap
 */
async function saveAllDirty_() {
  const ids = Array.from(dirtyMap.keys());
  if (!ids.length) return toast("目前沒有需要儲存的變更", "ok");

  savingAll = true;
  setLock_(true);
  refreshSaveAllButton_();

  try {
    const items = ids.map((id) => getAdminById_(id)).filter(Boolean).map(toUpdateItem_);

    const ret = await apiPost_({ mode: "updateAdminsBatch", items });
    if (!ret || !ret.ok) throw new Error(ret?.error || "updateAdminsBatch failed");

    const failedSet = new Set((ret.fail || []).map((x) => String(x.userId || "").trim()));
    items.forEach((it) => {
      if (!it.userId || failedSet.has(it.userId)) return;
      const a = getAdminById_(it.userId);
      if (!a) return;
      originalMap.set(it.userId, snapshot_(a));
      dirtyMap.delete(it.userId);
    });

    applyFilters_();
    toast(
      ret.failCount ? `儲存完成：成功 ${ret.okCount} / 失敗 ${ret.failCount}` : `全部儲存完成：${ret.okCount} 筆`,
      ret.failCount ? "err" : "ok"
    );
  } catch (e) {
    console.error(e);
    toast("儲存失敗", "err");
  } finally {
    savingAll = false;
    setLock_(false);
    refreshSaveAllButton_();
  }
}
