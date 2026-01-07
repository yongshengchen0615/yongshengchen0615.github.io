/* ================================
 * 06_bulk_table_save.js
 * Bulk selection, table render, row delegation, save-all
 * ================================ */

/* ========= Selection + Bulk ========= */
function bindBulk_() {
	document.getElementById("checkAll")?.addEventListener("change", () => {
		if (savingAll) return;
		const checked = !!document.getElementById("checkAll").checked;
		filteredUsers.forEach((u) => (checked ? selectedIds.add(u.userId) : selectedIds.delete(u.userId)));
		renderTable();
		updateBulkBar_();
		syncCheckAll_();
	});

	document.getElementById("bulkClear")?.addEventListener("click", () => {
		if (savingAll) return;
		selectedIds.clear();
		renderTable();
		updateBulkBar_();
		syncCheckAll_();
	});

	document.getElementById("bulkApply")?.addEventListener("click", () => bulkApply_());
	document.getElementById("bulkDelete")?.addEventListener("click", () => bulkDelete_());
}

function updateBulkBar_() {
	const bar = document.getElementById("bulkBar");
	const countEl = document.getElementById("bulkCount");
	if (!bar || !countEl) return;

	const n = selectedIds.size;
	if (!n) {
		bar.hidden = true;
		return;
	}
	bar.hidden = false;
	countEl.textContent = `已選取 ${n} 筆`;
}

function hideBulkBar_() {
	const bar = document.getElementById("bulkBar");
	if (bar) bar.hidden = true;
}

function syncCheckAll_() {
	const checkAll = document.getElementById("checkAll");
	const mobile = document.getElementById("mobileCheckAll");
	const hint = document.getElementById("mobileCheckAllHint");
	const total = filteredUsers.length;

	const setState = (el, checked, indeterminate) => {
		if (!el) return;
		el.checked = checked;
		el.indeterminate = indeterminate;
	};

	const selCount = filteredUsers.filter((u) => selectedIds.has(u.userId)).length;
	if (hint) hint.textContent = `（${selCount}/${total}）`;

	if (!total) {
		setState(checkAll, false, false);
		setState(mobile, false, false);
		return;
	}

	setState(checkAll, selCount === total, selCount > 0 && selCount < total);
	setState(mobile, selCount === total, selCount > 0 && selCount < total);
}

async function bulkApply_() {
	if (savingAll) return;

	// ✅ 權限保險：對應資料為「否」則不套用（UI 也會隱藏）
	const audit = canEditUserField_?.("audit") ? document.getElementById("bulkAudit")?.value || "" : "";
	const pushEnabled = canEditUserField_?.("pushEnabled") ? document.getElementById("bulkPush")?.value || "" : "";
	const personalStatusEnabled = canEditUserField_?.("personalStatusEnabled")
		? document.getElementById("bulkPersonalStatus")?.value || ""
		: "";
	const scheduleEnabled = canEditUserField_?.("scheduleEnabled")
		? document.getElementById("bulkScheduleEnabled")?.value || ""
		: "";

	const usageDaysRaw = canEditUserField_?.("usageDays") ? String(document.getElementById("bulkUsageDays")?.value || "").trim() : "";
	const usageDays = usageDaysRaw ? Number(usageDaysRaw) : null;
	if (usageDaysRaw && (!Number.isFinite(usageDays) || usageDays <= 0)) {
		toast("批次期限(天) 請輸入大於 0 的數字", "err");
		return;
	}

	if (!audit && !pushEnabled && !personalStatusEnabled && !scheduleEnabled && !usageDaysRaw) {
		toast("請先選擇要套用的批次欄位", "err");
		return;
	}

	const ids = Array.from(selectedIds);
	if (!ids.length) return;

	ids.forEach((id) => {
		const u = allUsers.find((x) => x.userId === id);
		if (!u) return;

		if (audit) u.audit = normalizeAudit_(audit);
		if (usageDaysRaw) u.usageDays = String(usageDays);

		if (normalizeAudit_(u.audit) !== "通過") u.pushEnabled = "否";
		else if (pushEnabled) u.pushEnabled = pushEnabled;

		if (personalStatusEnabled) u.personalStatusEnabled = personalStatusEnabled;
		if (scheduleEnabled) u.scheduleEnabled = scheduleEnabled;

		markDirty_(id, u);
	});

	applyFilters();
	toast("已套用到選取（尚未儲存）", "ok");
}

async function bulkDelete_() {
	if (savingAll) return;

	const btn = document.getElementById("bulkDelete");
	const ids = Array.from(selectedIds);
	if (!ids.length) return;

	const okConfirm = confirm(`確定要批次刪除？\n\n共 ${ids.length} 筆。\n此操作不可復原。`);
	if (!okConfirm) return;

	const dirtySelected = ids.filter((id) => dirtyMap.has(id)).length;
	if (dirtySelected) {
		const ok2 = confirm(`注意：選取中有 ${dirtySelected} 筆「未儲存」的更動。\n仍要繼續刪除嗎？`);
		if (!ok2) return;
	}

	if (btn) {
		btn.disabled = true;
		btn.textContent = "刪除中...";
	}

	let okCount = 0;
	let failCount = 0;

	for (const id of ids) {
		const ok = await deleteUser(id);
		ok ? okCount++ : failCount++;
		await sleep_(80);
	}

	selectedIds.clear();
	hideBulkBar_();

	if (btn) {
		btn.disabled = false;
		btn.textContent = "批次刪除";
	}

	if (failCount === 0) toast(`批次刪除完成：${okCount} 筆`, "ok");
	else toast(`批次刪除：成功 ${okCount} / 失敗 ${failCount}`, "err");

	// ✅ 使用紀錄：批次刪除
	if (typeof usageLogFire_ === "function") {
		usageLogFire_("users_delete_bulk", { requested: ids.length, okCount, failCount });
	}

	await loadUsers();
}

/* ========= Table ========= */
function renderTable() {
	const tbody = document.getElementById("tbody");
	if (!tbody) return;
	tbody.innerHTML = "";

	refreshSortIndicators_();

	if (!filteredUsers.length) {
		const tr = document.createElement("tr");
		tr.innerHTML = `<td colspan="15">無資料</td>`;
		tbody.appendChild(tr);
		return;
	}

	const frag = document.createDocumentFragment();

	filteredUsers.forEach((u, i) => {
		const expiry = getExpiryInfo(u);
		const pushEnabled = (u.pushEnabled || "否") === "是" ? "是" : "否";
		const personalStatusEnabled = (u.personalStatusEnabled || "否") === "是" ? "是" : "否";
		const scheduleEnabled = (u.scheduleEnabled || "否") === "是" ? "是" : "否";

		const audit = normalizeAudit_(u.audit);
		const isMaster = u.masterCode ? "是" : "否";
		const isDirty = dirtyMap.has(u.userId);

		const pushDisabled = audit !== "通過" ? "disabled" : "";

		const tr = document.createElement("tr");
		tr.dataset.userid = u.userId;
		if (isDirty) tr.classList.add("dirty");

		tr.innerHTML = `
			<td class="sticky-col col-check" data-label="選取">
				<input class="row-check" type="checkbox" ${selectedIds.has(u.userId) ? "checked" : ""} aria-label="選取此列">
			</td>

			<td data-label="#">${i + 1}</td>
			<td data-label="userId"><span class="mono">${escapeHtml(u.userId)}</span></td>
			<td data-label="顯示名稱">${escapeHtml(u.displayName || "")}</td>
			<td data-label="建立時間"><span class="mono">${escapeHtml(u.createdAt || "")}</span></td>

			<td data-label="開始使用">
				<input type="date" data-field="startDate" value="${escapeHtml(u.startDate || "")}">
			</td>
			<td data-label="期限(天)">
				<input type="number" min="1" data-field="usageDays" value="${escapeHtml(u.usageDays || "")}">
			</td>

			<td data-label="使用狀態">
				<span class="expiry-pill ${expiry.cls}">${escapeHtml(expiry.text)}</span>
			</td>

			<td data-label="審核狀態">
				<select data-field="audit" aria-label="審核狀態">
					${AUDIT_ENUM.map((v) => auditOption(v, audit)).join("")}
				</select>
				<span class="audit-badge ${auditClass_(audit)}">${escapeHtml(audit)}</span>
			</td>

			<td data-label="師傅編號">
				<input type="text" data-field="masterCode" placeholder="師傅編號" value="${escapeHtml(u.masterCode || "")}">
			</td>
			<td data-label="是否師傅">${isMaster}</td>

			<td data-label="是否推播">
				<select data-field="pushEnabled" aria-label="是否推播" ${pushDisabled}>
					<option value="否" ${pushEnabled === "否" ? "selected" : ""}>否</option>
					<option value="是" ${pushEnabled === "是" ? "selected" : ""}>是</option>
				</select>
			</td>

			<td data-label="個人狀態開通">
				<select data-field="personalStatusEnabled" aria-label="個人狀態開通">
					<option value="否" ${personalStatusEnabled === "否" ? "selected" : ""}>否</option>
					<option value="是" ${personalStatusEnabled === "是" ? "selected" : ""}>是</option>
				</select>
			</td>

			<td data-label="排班表開通">
				<select data-field="scheduleEnabled" aria-label="排班表開通">
					<option value="否" ${scheduleEnabled === "否" ? "selected" : ""}>否</option>
					<option value="是" ${scheduleEnabled === "是" ? "selected" : ""}>是</option>
				</select>
			</td>

			<td data-label="操作">
				<div class="actions">
					${isDirty ? `<span class="dirty-dot" title="未儲存"></span>` : `<span class="row-hint">-</span>`}
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

function refreshSortIndicators_() {
	document.querySelectorAll("th.sortable").forEach((th) => {
		const key = th.dataset.sort;
		const base = th.textContent.replace(/[↑↓]\s*$/, "").trim();
		th.textContent = base;

		if (key === sortKey) {
			const ind = document.createElement("span");
			ind.className = "sort-ind";
			ind.textContent = sortDir === "asc" ? "↑" : "↓";
			th.appendChild(ind);
		}
	});
}

/* ========= Delegation ========= */
function bindTableDelegation_() {
	const tbody = document.getElementById("tbody");
	if (!tbody) return;

	tbody.addEventListener("change", (e) => {
		if (savingAll) return;
		const t = e.target;
		if (!(t instanceof HTMLElement)) return;

		if (t.classList.contains("row-check")) {
			const row = t.closest("tr");
			const userId = row?.dataset.userid;
			if (!userId) return;
			t.checked ? selectedIds.add(userId) : selectedIds.delete(userId);
			updateBulkBar_();
			syncCheckAll_();
			return;
		}

		if (t.matches("[data-field]")) handleRowFieldChange_(t);
	});

	tbody.addEventListener("input", (e) => {
		if (savingAll) return;
		const t = e.target;
		if (!(t instanceof HTMLElement)) return;
		if (t.matches("input[data-field]")) handleRowFieldChange_(t);
	});

	tbody.addEventListener("click", async (e) => {
		if (savingAll) return;

		const btn = e.target instanceof Element ? e.target.closest("button") : null;
		if (!btn) return;

		const row = btn.closest("tr");
		const userId = row?.dataset.userid;
		if (!userId) return;

		if (btn.classList.contains("btn-del")) {
			await handleRowDelete_(row, userId, btn);
		}
	});
}

function handleRowFieldChange_(fieldEl) {
	const row = fieldEl.closest("tr");
	const userId = row?.dataset.userid;
	if (!row || !userId) return;

	const u = allUsers.find((x) => x.userId === userId);
	if (!u) return;

	const field = fieldEl.getAttribute("data-field");
	if (!field) return;

	// ✅ 權限保險：對應資料為「否」則不允許修改
	if (typeof canEditUserField_ === "function" && !canEditUserField_(field)) {
		const snapStr = originalMap.get(userId);
		if (snapStr) {
			try {
				const snap = JSON.parse(snapStr);
				const prev = snap?.[field];
				if (fieldEl instanceof HTMLInputElement || fieldEl instanceof HTMLSelectElement) {
					fieldEl.value = prev ?? "";
				}
			} catch (_) {}
		}
		return;
	}

	const value = readFieldValue_(fieldEl);

	if (field === "usageDays") u.usageDays = String(value || "");
	else if (field === "startDate") u.startDate = String(value || "");
	else if (field === "masterCode") u.masterCode = String(value || "");
	else if (field === "audit") u.audit = normalizeAudit_(value || "待審核");
	else if (field === "pushEnabled") u.pushEnabled = String(value || "否");
	else if (field === "personalStatusEnabled") u.personalStatusEnabled = String(value || "否");
	else if (field === "scheduleEnabled") u.scheduleEnabled = String(value || "否");

	const audit = normalizeAudit_(u.audit);
	const pushSel = row.querySelector('select[data-field="pushEnabled"]');

	if (audit !== "通過") {
		u.pushEnabled = "否";
		if (pushSel) {
			pushSel.value = "否";
			pushSel.disabled = true;
		}
	} else {
		if (pushSel) pushSel.disabled = false;
	}

	if (field === "audit") {
		const badge = row.querySelector(".audit-badge");
		if (badge) {
			badge.textContent = audit;
			badge.className = `audit-badge ${auditClass_(audit)}`;
		}
	}

	const exp = getExpiryInfo(u);
	const pill = row.querySelector(".expiry-pill");
	if (pill) {
		pill.className = `expiry-pill ${exp.cls}`;
		pill.textContent = exp.text;
	}

	markDirty_(userId, u);
	const isDirty = dirtyMap.has(userId);
	row.classList.toggle("dirty", isDirty);

	const actions = row.querySelector(".actions");
	if (actions) {
		const dot = actions.querySelector(".dirty-dot");
		const hint = actions.querySelector(".row-hint");
		if (isDirty) {
			if (!dot) {
				if (hint) hint.remove();
				actions.insertAdjacentHTML("afterbegin", `<span class="dirty-dot" title="未儲存"></span>`);
			}
		} else {
			if (dot) dot.remove();
			if (!actions.querySelector(".row-hint")) actions.insertAdjacentHTML("afterbegin", `<span class="row-hint">-</span>`);
		}
	}

	updateFooter();
	updateSummary();
	updateKpis_();
	refreshSaveAllButton_();
}

function readFieldValue_(el) {
	if (el instanceof HTMLInputElement) return el.value;
	if (el instanceof HTMLSelectElement) return el.value;
	return "";
}

async function handleRowDelete_(row, userId, delBtn) {
	const u = allUsers.find((x) => x.userId === userId);
	const okConfirm = confirm(
		`確定要刪除使用者？\n\nuserId: ${userId}\n顯示名稱: ${u?.displayName || ""}\n\n此操作不可復原。`
	);
	if (!okConfirm) return;

	delBtn.disabled = true;
	const oldText = delBtn.textContent;
	delBtn.textContent = "刪除中...";

	const ok = await deleteUser(userId);

	delBtn.disabled = false;
	delBtn.textContent = oldText || "刪除";

	if (ok) {
		toast("刪除完成", "ok");

		// ✅ 使用紀錄：單筆刪除
		if (typeof usageLogFire_ === "function") {
			usageLogFire_("users_delete_one", { userId });
		}
		selectedIds.delete(userId);

		allUsers = allUsers.filter((x) => x.userId !== userId);
		filteredUsers = filteredUsers.filter((x) => x.userId !== userId);
		originalMap.delete(userId);
		dirtyMap.delete(userId);

		applyFilters();
	} else {
		toast("刪除失敗", "err");
	}
}

/* ========= Save All Dirty ========= */
async function saveAllDirty_() {
	const dirtyIds = Array.from(dirtyMap.keys());
	if (!dirtyIds.length) {
		toast("目前沒有需要儲存的變更", "ok");
		return;
	}

	savingAll = true;
	setEditingEnabled_(false);
	refreshSaveAllButton_();

	try {
		const items = dirtyIds
			.map((userId) => allUsers.find((x) => x.userId === userId))
			.filter(Boolean)
			.map((u) => {
				const finalAudit = normalizeAudit_(u.audit);
				const finalPush = finalAudit !== "通過" ? "否" : u.pushEnabled || "否";
				return {
					userId: u.userId,
					audit: finalAudit,
					startDate: u.startDate || "",
					usageDays: u.usageDays || "",
					masterCode: u.masterCode || "",
					pushEnabled: finalPush,
					personalStatusEnabled: u.personalStatusEnabled || "否",
					scheduleEnabled: u.scheduleEnabled || "否",
				};
			});

		document.getElementById("footerStatus") &&
			(document.getElementById("footerStatus").textContent = `儲存中：1/1（共 ${items.length} 筆）`);

		const ret = await updateUsersBatch(items);

		// ✅ 使用紀錄：儲存全部（不含敏感內容）
		if (typeof usageLogFire_ === "function") {
			usageLogFire_("users_update_batch", {
				items: items.length,
				okCount: Number(ret?.okCount || 0),
				failCount: Number(ret?.failCount || 0),
			});
		}

		if (ret && ret.okCount) {
			const failedSet = new Set((ret.fail || []).map((x) => String(x.userId || "").trim()));
			items.forEach((it) => {
				const id = it.userId;
				if (!id || failedSet.has(id)) return;

				const u = allUsers.find((x) => x.userId === id);
				if (!u) return;

				u.audit = it.audit;
				u.startDate = it.startDate;
				u.usageDays = it.usageDays;
				u.masterCode = it.masterCode;
				u.pushEnabled = it.audit !== "通過" ? "否" : it.pushEnabled;
				u.personalStatusEnabled = it.personalStatusEnabled;
				u.scheduleEnabled = it.scheduleEnabled;

				originalMap.set(id, snapshot_(u));
				dirtyMap.delete(id);
			});

			applyFilters();
		} else {
			applyFilters();
		}

		refreshSaveAllButton_();
		updateSummary();
		updateKpis_();
		updateFooter();

		if (ret && ret.failCount === 0) toast(`全部儲存完成：${ret.okCount} 筆`, "ok");
		else toast(`儲存完成：成功 ${ret?.okCount || 0} / 失敗 ${ret?.failCount || 0}`, "err");
	} finally {
		savingAll = false;
		setEditingEnabled_(true);
		refreshSaveAllButton_();
	}
}

/* ========= Helpers ========= */
function auditOption(value, current) {
	const sel = value === current ? "selected" : "";
	return `<option value="${value}" ${sel}>${value}</option>`;
}

function auditClass_(audit) {
	switch (normalizeAudit_(audit)) {
		case "通過":
			return "approved";
		case "待審核":
			return "pending";
		case "拒絕":
			return "rejected";
		case "停用":
			return "disabled";
		case "系統維護":
			return "maintenance";
		default:
			return "other";
	}
}

function getExpiryInfo(u) {
	if (!u.startDate || !u.usageDays) return { cls: "unset", text: "未設定" };

	const start = new Date(String(u.startDate) + "T00:00:00");
	if (isNaN(start.getTime())) return { cls: "unset", text: "未設定" };

	const usage = Number(u.usageDays);
	if (!Number.isFinite(usage) || usage <= 0) return { cls: "unset", text: "未設定" };

	const last = new Date(start.getTime() + (usage - 1) * 86400000);
	last.setHours(0, 0, 0, 0);

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const diff = Math.floor((last - today) / 86400000);

	if (diff < 0) return { cls: "expired", text: `已過期（超 ${Math.abs(diff)} 天）` };
	return { cls: "active", text: `使用中（剩 ${diff} 天）` };
}

function snapshot_(u) {
	return JSON.stringify({
		userId: u.userId,
		audit: normalizeAudit_(u.audit),
		startDate: u.startDate || "",
		usageDays: String(u.usageDays || ""),
		masterCode: u.masterCode || "",
		pushEnabled: (u.pushEnabled || "否") === "是" ? "是" : "否",
		personalStatusEnabled: (u.personalStatusEnabled || "否") === "是" ? "是" : "否",
		scheduleEnabled: (u.scheduleEnabled || "否") === "是" ? "是" : "否",
	});
}

function markDirty_(userId, u) {
	const orig = originalMap.get(userId) || "";
	const now = snapshot_(u);
	if (orig !== now) dirtyMap.set(userId, true);
	else dirtyMap.delete(userId);
}
