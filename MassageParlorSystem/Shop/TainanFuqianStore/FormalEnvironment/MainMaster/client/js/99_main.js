/* ================================
 * 99_main.js
 * App bootstrap
 * ================================ */

const initialLoadingEl = document.getElementById("initialLoading");
const initialLoadingTextEl = document.getElementById("initialLoadingText");
const initialLoadingBarEl = document.getElementById("initialLoadingBar");
const initialLoadingPercentEl = document.getElementById("initialLoadingPercent");
const initialLoadingProgressEl = initialLoadingEl?.querySelector?.(".initial-loading-progress") || null;

function setInitialLoadingProgress_(percent, text) {
	const p = Math.max(0, Math.min(100, Number(percent) || 0));
	if (initialLoadingTextEl && text) initialLoadingTextEl.textContent = text;
	if (initialLoadingBarEl) initialLoadingBarEl.style.width = `${p}%`;
	if (initialLoadingPercentEl) initialLoadingPercentEl.textContent = `${Math.round(p)}%`;
	if (initialLoadingProgressEl) initialLoadingProgressEl.setAttribute("aria-valuenow", String(Math.round(p)));
}

function showInitialLoading_(text) {
	if (!initialLoadingEl) return;
	if (initialLoadingTextEl && text) initialLoadingTextEl.textContent = text;
	initialLoadingEl.classList.remove("initial-loading-hidden");
	setInitialLoadingProgress_(5);
}

function hideInitialLoading_(text) {
	if (!initialLoadingEl) return;
	if (initialLoadingTextEl && text) initialLoadingTextEl.textContent = text;
	initialLoadingEl.classList.add("initial-loading-hidden");
}

document.addEventListener("DOMContentLoaded", async () => {
	try {
		showInitialLoading_("資料載入中…");
		setInitialLoadingProgress_(10, "讀取設定中…");

		await loadConfig_();
		currentView = localStorage.getItem("users_view") || currentView;
		setInitialLoadingProgress_(22, "初始化介面中…");

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

		document.getElementById("topbarLogoutBtn")?.addEventListener("click", () => adminLogout_());

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
		setInitialLoadingProgress_(45, "管理員驗證中…");
		const authed = await adminAuthBoot_();
		if (!authed) {
			hideInitialLoading_();
			return;
		}

		setInitialLoadingProgress_(65, "載入使用者資料中…");
		await loadUsers();
		setInitialLoadingProgress_(100, "完成");
		hideInitialLoading_();
	} catch (e) {
		console.error("boot error:", e);
		toast("啟動失敗（請看 console）", "err");
		showAuthGate_(true, "系統啟動失敗，請確認 config.json / 網路狀態。");
		setInitialLoadingProgress_(100, "啟動失敗");
		hideInitialLoading_("啟動失敗");
	}
});
