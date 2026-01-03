/* ================================
 * 99_main.js
 * App bootstrap
 * ================================ */

document.addEventListener("DOMContentLoaded", async () => {
	try {
		await loadConfig_();
		currentView = localStorage.getItem("users_view") || currentView;

		initTheme_();
		document.getElementById("themeToggle")?.addEventListener("click", toggleTheme_);

		document.getElementById("reloadBtn")?.addEventListener("click", async () => {
			if (savingAll) return;

			// ✅ 重新整理時也同步更新管理員權限（含：推播功能開通）
			const authed = await refreshAdminPerms_();
			if (!authed) return;

			selectedIds.clear();
			hideBulkBar_();
			await loadUsers();
		});

		document.getElementById("clearSearchBtn")?.addEventListener("click", () => {
			if (savingAll) return;
			const si = document.getElementById("searchInput");
			if (si) si.value = "";
			si?.closest(".search-box")?.classList.remove("is-searching");
			applyFilters();
		});

		// ✅ Gate buttons
		document.getElementById("authRetryBtn")?.addEventListener("click", () => adminAuthBoot_());
		document.getElementById("authLogoutBtn")?.addEventListener("click", () => adminLogout_());

		ensureSaveAllButton_();
		ensureMobileSelectAll_();
		// ✅ Tabs 會由權限決定是否建立（此時 perms 未載入，多半不會顯示）
		ensureViewTabs_();
		ensurePushPanel_();

		bindFilter();
		bindSorting_();
		bindBulk_();
		// ✅ 權限尚未載入前：先隱藏批次欄位（避免「否」仍顯示的錯覺/閃爍）
		if (typeof applyBulkPermissions_ === "function") applyBulkPermissions_();
		bindTableDelegation_();

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

		// ✅ 先做管理員驗證：通過才放行 loadUsers()
		const authed = await adminAuthBoot_();
		if (!authed) return;

		loadUsers();
	} catch (e) {
		console.error("boot error:", e);
		toast("啟動失敗（請看 console）", "err");
		showAuthGate_(true, "系統啟動失敗，請確認 config.json / 網路狀態。");
	}
});
