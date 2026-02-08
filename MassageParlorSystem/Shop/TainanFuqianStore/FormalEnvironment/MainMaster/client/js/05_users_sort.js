/* ================================
 * 05_users_sort.js
 * Sorting
 * ================================ */

function bindSorting_() {
	document.querySelectorAll("th.sortable").forEach((th) => {
		th.addEventListener("click", () => {
			if (savingAll) return;
			const key = th.dataset.sort;
			if (!key) return;

			if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
			else {
				sortKey = key;
				sortDir = key === "createdAt" ? "desc" : "asc";
			}
			applyFilters();
		});
	});
}

function compareBy_(a, b, key, dir) {
	const sgn = dir === "asc" ? 1 : -1;

	const get = (u) => {
		if (key === "index") return 0;
		if (key === "expiry") return getExpiryDiff_(u);
		if (key === "isMaster") return u.masterCode ? 1 : 0;
		return u[key];
	};

	const av = get(a);
	const bv = get(b);

	if (
		key === "pushEnabled" ||
		key === "personalStatusEnabled" ||
		key === "scheduleEnabled" ||
		key === "performanceEnabled" ||
		key === "bookingEnabled"
	) {
		const na = String(av) === "是" ? 1 : 0;
		const nb = String(bv) === "是" ? 1 : 0;
		return (na - nb) * sgn;
	}

	if (key === "usageDays" || key === "isMaster") {
		const na = Number(av || 0);
		const nb = Number(bv || 0);
		return (na - nb) * sgn;
	}

	if (key === "createdAt") {
		const da = toTime_(av);
		const db = toTime_(bv);
		return (da - db) * sgn;
	}

	if (key === "startDate") {
		const da = toTime_(String(av || "") + "T00:00:00");
		const db = toTime_(String(bv || "") + "T00:00:00");
		return (da - db) * sgn;
	}

	const sa = String(av ?? "").toLowerCase();
	const sb = String(bv ?? "").toLowerCase();
	if (sa < sb) return -1 * sgn;
	if (sa > sb) return 1 * sgn;
	return 0;
}

function getExpiryDiff_(u) {
	if (!u.startDate || !u.usageDays) return 999999;

	const start = new Date(String(u.startDate) + "T00:00:00");
	if (isNaN(start.getTime())) return 999999;

	const usage = Number(u.usageDays);
	if (!Number.isFinite(usage) || usage <= 0) return 999999;

	const last = new Date(start.getTime() + (usage - 1) * 86400000);
	last.setHours(0, 0, 0, 0);

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	return Math.floor((last - today) / 86400000);
}
