/* ============================================
 * 99_main.js
 * - 應用程式進入點（DOMContentLoaded）
 * ============================================ */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadConfig_();
    currentView = localStorage.getItem("users_view") || currentView;

    // Theme
    initTheme_();
    document.getElementById("themeToggle")?.addEventListener("click", toggleTheme_);

    // Reload
    document.getElementById("reloadBtn")?.addEventListener("click", async () => {
      if (savingAll) return;
      selectedIds.clear();
      hideBulkBar_();
      await loadUsers();
    });

    // Clear Search
    document.getElementById("clearSearchBtn")?.addEventListener("click", () => {
      if (savingAll) return;
      const si = document.getElementById("searchInput");
      if (si) si.value = "";
      si?.closest(".search-box")?.classList.remove("is-searching");
      applyFilters();
    });

    // Gate buttons
    document.getElementById("authRetryBtn")?.addEventListener("click", () => adminAuthBoot_());
    document.getElementById("authLogoutBtn")?.addEventListener("click", () => adminLogout_());

    // UI elements
    ensureSaveAllButton_();
    ensureMobileSelectAll_();

    // Tabs 會由權限決定是否建立（此時 perms 未載入，多半不會顯示）
    ensureViewTabs_();

    // Push panel
    ensurePushPanel_();

    // Bindings
    bindFilter();
    bindSorting_();
    bindBulk_();
    bindTableDelegation_();

    // Search input (debounce)
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
      searchInput.addEventListener(
        "input",
        debounce(() => {
          if (savingAll) return;
          const box = searchInput.closest(".search-box");
          const hasValue = searchInput.value.trim().length > 0;
          box?.classList.toggle("is-searching", hasValue);
          applyFilters();
        }, 180)
      );
      searchInput.closest(".search-box")?.classList.toggle("is-searching", searchInput.value.trim().length > 0);
    }

    // 先做管理員驗證：通過才放行 loadUsers()
    await adminAuthBoot_();

    // 通過才會走到這裡
    loadUsers();
  } catch (e) {
    console.error("boot error:", e);
    toast("啟動失敗（請看 console）", "err");
    showAuthGate_(true, "系統啟動失敗，請確認 config.json / 網路狀態。");
  }
});
