/* ================================
 * 08_push.js
 * Push panel (UI) + push send
 * ================================ */

function ensurePushPanel_() {
	const panelHead = document.querySelector(".panel-head");
	if (!panelHead) return;

	// ✅ 權限尚未載入/已清空（例如登出）：移除推播面板
	if (!adminPerms) {
		document.getElementById("pushPanel")?.remove();
		return;
	}

	// ✅ 推播功能未開通：移除推播面板
	if (!isPushFeatureEnabled_()) {
		document.getElementById("pushPanel")?.remove();
		return;
	}

	if (document.getElementById("pushPanel")) return;

	const wrap = document.createElement("div");
	wrap.id = "pushPanel";
	wrap.style.flex = "0 0 100%";
	wrap.style.width = "100%";
	wrap.style.marginTop = "10px";

	wrap.innerHTML = `
		<div class="pushbar">
			<div class="pushbar-left">
				<span class="bulk-pill" style="border-color:rgba(147,51,234,.35); background:rgba(147,51,234,.12); color:rgb(167,139,250);">
					推播
				</span>

				<div class="bulk-group">
					<label class="bulk-label" for="pushTarget">對象</label>
					<select id="pushTarget" class="select">
						<option value="selected">選取的（勾選）</option>
						<option value="filtered">目前篩選結果</option>
						<option value="all">全部</option>
						<option value="single">單一 userId</option>
					</select>
				</div>

				<div class="bulk-group" id="pushSingleWrap" style="display:none;">
					<label class="bulk-label" for="pushSingleUserId">userId</label>
					<input id="pushSingleUserId" class="select push-single" type="text"
						placeholder="貼上 userId（LINE userId）" />
				</div>

				<div class="bulk-group">
					<label class="bulk-label" style="user-select:none;">displayName 前綴</label>
					<label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text); user-select:none;">
						<input id="pushIncludeName" type="checkbox" />
						加上 displayName
					</label>
				</div>
			</div>

			<div class="pushbar-right">
				<div class="bulk-group" style="flex:1; width:100%;">
					<input id="pushMessage" class="select push-message" type="text"
						placeholder="輸入要推播的訊息…" />
				</div>

				<button id="pushSendBtn" class="btn primary" type="button">送出推播</button>
			</div>
		</div>
	`;

	panelHead.appendChild(wrap);

	const targetSel = document.getElementById("pushTarget");
	const singleWrap = document.getElementById("pushSingleWrap");

	targetSel?.addEventListener("change", () => {
		const v = targetSel.value;
		if (singleWrap) singleWrap.style.display = v === "single" ? "" : "none";
	});

	document.getElementById("pushSendBtn")?.addEventListener("click", async () => {
		if (savingAll || pushingNow) return;
		await pushSend_();
	});

	pushSetEnabled_(!savingAll);
}

function pushSetEnabled_(enabled) {
	const lock = !enabled || pushingNow;
	["pushTarget", "pushSingleUserId", "pushIncludeName", "pushMessage", "pushSendBtn"].forEach((id) => {
		const el = document.getElementById(id);
		if (el) el.disabled = lock;
	});

	const btn = document.getElementById("pushSendBtn");
	if (btn) btn.textContent = pushingNow ? "推播中…" : "送出推播";
}

function buildPushTargetIds_(target) {
	if (target === "single") {
		const uid = String(document.getElementById("pushSingleUserId")?.value || "").trim();
		return uid ? [uid] : [];
	}
	if (target === "selected") return Array.from(selectedIds);
	if (target === "filtered") return filteredUsers.map((u) => u.userId).filter(Boolean);
	if (target === "all") return allUsers.map((u) => u.userId).filter(Boolean);
	return [];
}

async function pushSend_() {
	// ✅ 前端保險：即使透過 DevTools 呼叫也不允許推播
	if (!isPushFeatureEnabled_()) {
		toast("推播功能未開通", "err");
		return;
	}

	const target = String(document.getElementById("pushTarget")?.value || "selected");
	const includeDisplayName = !!document.getElementById("pushIncludeName")?.checked;
	const message = String(document.getElementById("pushMessage")?.value || "").trim();

	if (!message) {
		toast("請輸入推播內容", "err");
		return;
	}

	const userIds = buildPushTargetIds_(target);
	if (!userIds.length) {
		toast(target === "selected" ? "請先勾選要推播的使用者" : "找不到推播對象", "err");
		return;
	}

	const n = userIds.length;
	const warn = includeDisplayName ? "⚠️ 勾選 displayName 前綴：後端可能需要逐人處理（較慢）。\n\n" : "";
	if (target === "all" || target === "filtered" || n > 30) {
		const ok = confirm(`即將推播給 ${n} 位使用者。\n\n${warn}確定要送出嗎？`);
		if (!ok) return;
	}

	pushingNow = true;
	pushSetEnabled_(false);

	try {
		const ret = await pushMessageBatch_(userIds, message, includeDisplayName);
		const okCount = Number(ret?.okCount || 0);
		const failCount = Number(ret?.failCount || 0);

		// ✅ 使用紀錄：推播（不記錄內容）
		if (typeof usageLogFire_ === "function") {
			usageLogFire_("push_message", {
				target,
				requested: userIds.length,
				includeDisplayName: !!includeDisplayName,
				messageLength: String(message || "").length,
				okCount,
				failCount,
			});
		}

		if (failCount === 0) toast(`推播完成：成功 ${okCount} 筆`, "ok");
		else toast(`推播完成：成功 ${okCount} / 失敗 ${failCount}`, "err");

		if (ret?.fail?.length) console.warn("push fail:", ret.fail);
	} catch (e) {
		console.error("pushSend error:", e);
		toast("推播失敗（請看 console）", "err");
	} finally {
		pushingNow = false;
		pushSetEnabled_(!savingAll);
	}
}
