/* ================================
 * 10_usage_log.js
 * Usage logging (optional)
 * ================================ */

function usageLogEnabled_() {
	return !!String(USAGE_LOG_API_URL || "").trim();
}

function buildUsageLogPayload_(eventName, data) {
	const nowIso = new Date().toISOString();
	const actor = adminProfile
		? {
			userId: String(adminProfile.userId || "").trim(),
			displayName: String(adminProfile.displayName || "").trim(),
		}
		: null;

	return {
		mode: "appendUsageLog",
		ts: nowIso,
		event: String(eventName || "").trim() || "unknown",
		actor,
		page: {
			href: String(location.href || ""),
			path: String(location.pathname || ""),
		},
		ua: String(navigator.userAgent || ""),
		data: data && typeof data === "object" ? data : { value: data },
	};
}

async function usageLog_(eventName, data) {
	try {
		if (!usageLogEnabled_()) return { ok: true, skipped: true };

		const payload = buildUsageLogPayload_(eventName, data);
		const res = await fetch(USAGE_LOG_API_URL, {
			method: "POST",
			headers: { "Content-Type": "text/plain;charset=utf-8" },
			body: JSON.stringify(payload),
		});

		return await res.json().catch(() => ({ ok: true }));
	} catch (err) {
		// never block UX
		console.warn("usageLog_ failed:", err);
		return { ok: false, error: String(err) };
	}
}

function usageLogFire_(eventName, data) {
	try {
		// fire-and-forget
		void usageLog_(eventName, data);
	} catch (err) {
		console.warn("usageLogFire_ failed:", err);
	}
}
