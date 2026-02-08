/* ================================
 * 04_ui.js
 * Theme / UI lock / filters / data load & summary
 * ================================ */

/* ========= Theme ========= */
function initTheme_() {
	const saved = localStorage.getItem("theme") || "dark";
	document.documentElement.setAttribute("data-theme", saved);
	updateThemeButtonText_();
}

function toggleTheme_() {
	if (savingAll) return;
	const current = document.documentElement.getAttribute("data-theme") || "dark";
	const next = current === "dark" ? "light" : "dark";
	document.documentElement.setAttribute("data-theme", next);
	localStorage.setItem("theme", next);
	updateThemeButtonText_();
}

function updateThemeButtonText_() {
	const btn = document.getElementById("themeToggle");
	if (!btn) return;
	const current = document.documentElement.getAttribute("data-theme") || "dark";
	btn.textContent = current === "dark" ? "亮色" : "暗色";
}

/* ========= UI Lock ========= */
function setEditingEnabled_(enabled) {
	const lock = !enabled;

	document.querySelector(".panel")?.classList.toggle("is-locked", lock);
	["reloadBtn", "themeToggle", "searchInput", "clearSearchBtn"].forEach((id) => {
		const el = document.getElementById(id);
		if (el) el.disabled = lock;
	});

	document.querySelectorAll(".chip").forEach((el) => (el.disabled = lock));

	const ids = [
		"checkAll",
		"mobileCheckAll",
		"bulkClear",
		"bulkAudit",
		"bulkPush",
		"bulkPersonalStatus",
		"bulkScheduleEnabled",
		"bulkPerformanceEnabled",
		"bulkBookingEnabled",
		"bulkUsageDays",
		"bulkApply",
		"bulkDelete",
	];
	ids.forEach((id) => document.getElementById(id) && (document.getElementById(id).disabled = lock));

	document.querySelectorAll("th.sortable").forEach((th) => {
		th.style.pointerEvents = lock ? "none" : "";
		th.style.opacity = lock ? "0.6" : "";
	});

	document.getElementById("tbody")?.querySelectorAll("input, select, button").forEach((el) => (el.disabled = lock));

	applyView_();
	refreshSaveAllButton_();
	pushSetEnabled_(!lock);
}

/* ========= Save All Button ========= */
function ensureSaveAllButton_() {
	const topRight = document.querySelector(".topbar-right");
	if (!topRight) return;
	if (document.getElementById("saveAllBtn")) return;

	const btn = document.createElement("button");
	btn.id = "saveAllBtn";
	btn.type = "button";
	btn.className = "btn primary";
	btn.textContent = "儲存全部變更";
	btn.disabled = true;

	btn.addEventListener("click", async () => {
		if (savingAll) return;
		await saveAllDirty_();
	});

	const reloadBtn = document.getElementById("reloadBtn");
	if (reloadBtn && reloadBtn.parentElement === topRight) topRight.insertBefore(btn, reloadBtn);
	else topRight.appendChild(btn);

	refreshSaveAllButton_();
}

function refreshSaveAllButton_() {
	const btn = document.getElementById("saveAllBtn");
	if (!btn) return;
	const dirtyCount = dirtyMap.size;
	btn.disabled = savingAll || dirtyCount === 0;
	btn.textContent = savingAll ? "儲存中..." : dirtyCount ? `儲存全部變更（${dirtyCount}）` : "儲存全部變更";
}

/* ========= Mobile Select All ========= */
function ensureMobileSelectAll_() {
	const filters = document.querySelector(".panel-head .filters");
	if (!filters) return;
	if (document.getElementById("mobileCheckAll")) return;

	const wrap = document.createElement("div");
	wrap.className = "mobile-selectall";
	wrap.innerHTML = `
		<input id="mobileCheckAll" type="checkbox" aria-label="全選（目前列表）">
		<span class="label">全選</span>
		<span class="hint" id="mobileCheckAllHint">（0/${filteredUsers.length || 0}）</span>
	`;
	filters.appendChild(wrap);

	const mobile = wrap.querySelector("#mobileCheckAll");
	mobile.addEventListener("change", () => {
		if (savingAll) return;
		const checked = !!mobile.checked;

		filteredUsers.forEach((u) => {
			if (checked) selectedIds.add(u.userId);
			else selectedIds.delete(u.userId);
		});

		renderTable();
		updateBulkBar_();
		syncCheckAll_();
	});
}

/* ========= Filters ========= */
function bindFilter() {
	document.querySelectorAll(".chip").forEach((chip) => {
		chip.addEventListener("click", () => {
			if (savingAll) return;
			document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
			chip.classList.add("active");
			applyFilters();
		});
	});
}

async function loadUsers() {
	try {
		if (!API_BASE_URL) throw new Error("API_BASE_URL not initialized");

		const res = await fetch(API_BASE_URL + "?mode=listUsers");
		const json = await res.json();
		if (!json.ok) throw new Error("listUsers not ok");

		allUsers = (json.users || []).map((u) => ({
			...u,
			personalStatusEnabled: (u.personalStatusEnabled || "否") === "是" ? "是" : "否",
			scheduleEnabled: (u.scheduleEnabled || "否") === "是" ? "是" : "否",
			performanceEnabled: (u.performanceEnabled || "否") === "是" ? "是" : "否",
			bookingEnabled: (u.bookingEnabled || "否") === "是" ? "是" : "否",
			pushEnabled: (u.pushEnabled || "否") === "是" ? "是" : "否",
			audit: normalizeAudit_(u.audit),
		}));

		originalMap.clear();
		dirtyMap.clear();
		for (const u of allUsers) originalMap.set(u.userId, snapshot_(u));

		applyFilters();
		toast("資料已更新", "ok");
	} catch (err) {
		console.error("loadUsers error:", err);
		toast("讀取失敗", "err");
	} finally {
		refreshSaveAllButton_();
		applyView_();
		// ✅ 權限欄位隱藏在 render 後也保險再套一次
		applyColumnPermissions_();
	}
}

function applyFilters() {
	const keywordRaw = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
	const activeChip = document.querySelector(".chip.active");
	const filter = activeChip ? activeChip.dataset.filter : "ALL";

	filteredUsers = allUsers.filter((u) => {
		const audit = normalizeAudit_(u.audit);
		if (filter !== "ALL" && audit !== filter) return false;

		if (keywordRaw) {
			const hay = `${u.userId} ${u.displayName || ""} ${u.masterCode || ""}`.toLowerCase();
			if (!hay.includes(keywordRaw)) return false;
		}
		return true;
	});

	filteredUsers.sort((a, b) => compareBy_(a, b, sortKey, sortDir));

	renderTable();
	updateSummary();
	updateKpis_();
	updateFooter();
	syncCheckAll_();
	updateBulkBar_();
	refreshSaveAllButton_();
	applyView_();

	// ✅ 權限欄位隱藏
	applyColumnPermissions_();

	if (savingAll) setEditingEnabled_(false);
}

function updateSummary() {
	const el = document.getElementById("summaryText");
	if (!el) return;

	const total = allUsers.length;
	const approved = allUsers.filter((u) => normalizeAudit_(u.audit) === "通過").length;
	const pending = allUsers.filter((u) => normalizeAudit_(u.audit) === "待審核").length;
	const rejected = allUsers.filter((u) => normalizeAudit_(u.audit) === "拒絕").length;
	const maintenance = allUsers.filter((u) => normalizeAudit_(u.audit) === "系統維護").length;

	el.textContent = `總筆數：${total}（通過 ${approved} / 待審核 ${pending} / 拒絕 ${rejected} / 維護 ${maintenance}）`;
}

function updateKpis_() {
	const total = allUsers.length;
	const approved = allUsers.filter((u) => normalizeAudit_(u.audit) === "通過").length;
	const pending = allUsers.filter((u) => normalizeAudit_(u.audit) === "待審核").length;
	const rejected = allUsers.filter((u) => normalizeAudit_(u.audit) === "拒絕").length;
	const disabled = allUsers.filter((u) => normalizeAudit_(u.audit) === "停用").length;
	const maintenance = allUsers.filter((u) => normalizeAudit_(u.audit) === "系統維護").length;

	setText_("kpiTotal", total);
	setText_("kpiApproved", approved);
	setText_("kpiPending", pending);
	setText_("kpiRejected", rejected);
	setText_("kpiDisabled", disabled);
	setText_("kpiMaintenance", maintenance);
}

function updateFooter() {
	const el = document.getElementById("footerStatus");
	if (!el) return;

	const now = new Date();
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	const ss = String(now.getSeconds()).padStart(2, "0");

	const dirtyCount = dirtyMap.size;
	const dirtyText = dirtyCount ? `，未儲存 ${dirtyCount} 筆` : "";

	const keyword = document.getElementById("searchInput")?.value.trim();
	const searchHint = keyword ? "（搜尋中）" : "";

	el.textContent = `最後更新：${hh}:${mm}:${ss}，目前顯示 ${filteredUsers.length} 筆${searchHint}${dirtyText}`;
}
