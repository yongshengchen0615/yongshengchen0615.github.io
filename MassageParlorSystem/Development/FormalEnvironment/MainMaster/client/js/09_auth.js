/* ================================
 * 09_auth.js
 * LIFF Admin Auth + Admin GAS perms
 * ================================ */

function setAdminPermsFromCheck_(check) {
	adminPerms = {
		pushFeatureEnabled: check.pushFeatureEnabled,
		techAudit: check.techAudit,
		techCreatedAt: check.techCreatedAt,
		techStartDate: check.techStartDate,
		techExpiryDate: check.techExpiryDate,
		techMasterNo: check.techMasterNo,
		techIsMaster: check.techIsMaster,
		techPushEnabled: check.techPushEnabled,
		techPersonalStatusEnabled: check.techPersonalStatusEnabled,
		techAppointmentQueryEnabled: check.techAppointmentQueryEnabled,
		techScheduleEnabled: check.techScheduleEnabled,
		techPerformanceEnabled: check.techPerformanceEnabled,
	};
}

async function getLiffIdentity_() {
	// 主要走 profile（需要 LIFF scope: profile）
	try {
		const profile = await liff.getProfile();
		return { userId: String(profile.userId || "").trim(), displayName: String(profile.displayName || "").trim() };
	} catch (e) {
		// fallback：若有 openid scope，可用 idToken.sub
		try {
			const token = liff.getDecodedIDToken && liff.getDecodedIDToken();
			if (token && token.sub) {
				return { userId: String(token.sub || "").trim(), displayName: String(token.name || "").trim() };
			}
		} catch (_) {
			// ignore
		}

		const err = new Error("LIFF_SCOPE_MISSING");
		err.code = "LIFF_SCOPE_MISSING";
		err.original = e;
		throw err;
	}
}

async function refreshAdminPerms_() {
	try {
		if (!adminProfile?.userId) return false;

		const check = await adminCheckAccess_(adminProfile.userId, adminProfile.displayName || "");
		if (!check?.ok) return false;

		setAdminPermsFromCheck_(check);

		// ✅ 立即套用 UI gate（推播面板/欄位隱藏/tabs）
		applyPushFeatureGate_();
		applyColumnPermissions_();
		applyBulkPermissions_();
		enforceViewTabsPolicy_();

		// ✅ 若權限被撤銷，立即封鎖
		if (String(check.audit || "") !== "通過") {
			showAuthGate_(true, "你的管理員權限已變更，請重新登入或聯絡管理員。");
			setEditingEnabled_(false);
			return false;
		}

		return true;
	} catch (e) {
		console.warn("refreshAdminPerms_ failed:", e);
		return false;
	}
}

function showAuthGate_(show, msg) {
	const gate = document.getElementById("authGate");
	const m = document.getElementById("authGateMsg");
	if (m && msg) m.textContent = msg;
	if (gate) gate.style.display = show ? "flex" : "none";
}

async function adminAuthBoot_() {
	showAuthGate_(true, "請稍候，正在進行 LINE 登入與權限檢查…");

	try {
		if (!window.liff) throw new Error("LIFF SDK not loaded");

		await liff.init({ liffId: LIFF_ID });

		if (!liff.isLoggedIn()) {
			showAuthGate_(true, "尚未登入 LINE，將導向登入…");
			liff.login({ redirectUri: window.location.href });
			return false;
		}

		const ident = await getLiffIdentity_();
		if (!ident.userId) throw new Error("LIFF missing userId");
		adminProfile = { userId: ident.userId, displayName: ident.displayName || "" };

		const check = await adminCheckAccess_(adminProfile.userId, adminProfile.displayName);

		// ✅ 保存權限（後端 adminUpsertAndCheck 回傳）
		setAdminPermsFromCheck_(check);

		// ✅ 先套用欄位隱藏 + tabs 政策 + 推播 gate（就算最後 audit 不通過也先準備好）
		applyPushFeatureGate_();
		applyBulkPermissions_();
		enforceViewTabsPolicy_();

		if (!check.ok) {
			showAuthGate_(true, "管理員驗證失敗（後端回傳異常）。請稍後重試。");
			setEditingEnabled_(false);
			throw new Error("adminCheckAccess not ok");
		}

		if (String(check.audit || "") !== "通過") {
			const hint =
				check.audit === "待審核"
					? "你的管理員權限目前為「待審核」。"
					: check.audit === "拒絕"
					? "你的管理員權限已被「拒絕」。"
					: check.audit === "停用"
					? "你的管理員權限目前為「停用」。"
					: check.audit === "系統維護"
					? "系統目前維護中，暫不開放管理員登入。"
					: "你的管理員權限尚未通過。";

			showAuthGate_(true, `${hint}\n\nLINE：${adminProfile.displayName}\nID：${adminProfile.userId}`);
			setEditingEnabled_(false);
			throw new Error("admin not approved");
		}

		showAuthGate_(false);
		setEditingEnabled_(true);

		// ✅ 使用紀錄：登入成功
		if (typeof usageLogFire_ === "function") {
			usageLogFire_("admin_login_ok", { audit: String(check.audit || ""), liff: true });
		}

		// ✅ 通過後再保險套一次（含 tabs / 欄位隱藏）
		applyPushFeatureGate_();
		applyBulkPermissions_();
		enforceViewTabsPolicy_();

		toast(`管理員：${adminProfile.displayName}（已通過）`, "ok");
		return true;
	} catch (err) {
		if (err && err.code === "LIFF_SCOPE_MISSING") {
			showAuthGate_(
				true,
				"LIFF 權限不足：目前 LIFF App 沒有提供取得使用者資訊的權限。\n\n請到 LINE Developers → 你的 Channel → LIFF → Scopes 勾選：profile（建議同時勾選 openid 以利備援）。\n\n調整後請重新開啟此頁。"
			);
			setEditingEnabled_(false);
			return false;
		}
		console.warn("adminAuthBoot blocked:", err);
		return false;
	}
}

async function adminLogout_() {
	try {
		if (window.liff && liff.isLoggedIn()) await liff.logout();
	} finally {
		// ✅ 使用紀錄：登出
		if (typeof usageLogFire_ === "function") {
			usageLogFire_("admin_logout", { liff: !!(window.liff && liff.isLoggedIn && liff.isLoggedIn()) });
		}

		adminProfile = null;
		adminPerms = null;
		setEditingEnabled_(false);
		if (typeof applyBulkPermissions_ === "function") applyBulkPermissions_();
		ensurePushPanel_();
		showAuthGate_(true, "已登出。請重新登入。");
	}
}
