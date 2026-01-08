/* ================================
 * Admin - 管理員紀錄（UsageLog）
 * - 顯示欄位：ts / actorUserId / actorDisplayName
 * - 透過 USAGE_LOG_API_URL 呼叫 GAS：listUsageLog
 * ================================ */

/** @type {{ts:string, actorUserId:string, actorDisplayName:string}[]} */
let adminLogs_ = [];

/** @type {{ts:string, actorUserId:string, actorDisplayName:string}[]} */
let adminLogsAll_ = [];

let adminLogsLoading_ = false;

function logsSetFooter_(text) {
  const el = document.getElementById("logsFooterStatus");
  if (el) el.textContent = String(text || "-");
}

function logsSetTbodyMessage_(msg) {
  const tbody = document.getElementById("logsTbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="4">${escapeHtml(msg || "-")}</td></tr>`;
}

function normalizeLogRow_(r) {
  const ts = String(r?.ts ?? "");
  const actorUserId = String(r?.actorUserId ?? r?.userId ?? "");
  const actorDisplayName = String(r?.actorDisplayName ?? r?.displayName ?? "");
  return { ts, actorUserId, actorDisplayName };
}

function pad2_(n) {
  return String(n).padStart(2, "0");
}

/**
 * 盡量把各種 ts 字串轉成 YYYY-MM-DD（以本機時區為準）。
 * @param {string} ts
 */
function toDateKey_(ts) {
  const s = String(ts || "").trim();
  if (!s) return "";

  // 常見：2026-01-08T... 或 2026-01-08 12:34:56
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // 常見：2026/01/08 ...
  if (/^\d{4}\/\d{2}\/\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, "-");

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2_(d.getMonth() + 1)}-${pad2_(d.getDate())}`;
}

function getSelectedLogsDate_() {
  const el = document.getElementById("logsDateInput");
  const v = String(el?.value || "").trim();
  return v;
}

function applyAdminLogsDateFilter_() {
  const dateKey = getSelectedLogsDate_();
  if (!dateKey) {
    adminLogs_ = adminLogsAll_.slice();
    return;
  }
  adminLogs_ = adminLogsAll_.filter((r) => toDateKey_(r.ts) === dateKey);
}

function renderAdminLogs_() {
  const tbody = document.getElementById("logsTbody");
  if (!tbody) return;

  if (!adminLogs_.length) {
    tbody.innerHTML = `<tr><td colspan="4">無資料</td></tr>`;
    return;
  }

  tbody.innerHTML = adminLogs_
    .map((r, i) => {
      return `
        <tr>
          <td data-label="#">${i + 1}</td>
          <td data-label="ts"><span style="font-family:var(--mono)">${escapeHtml(r.ts)}</span></td>
          <td data-label="actorUserId"><span style="font-family:var(--mono)">${escapeHtml(r.actorUserId)}</span></td>
          <td data-label="actorDisplayName">${escapeHtml(r.actorDisplayName)}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadAdminLogs_() {
  if (adminLogsLoading_) return;

  if (!USAGE_LOG_API_URL) {
    logsSetFooter_("尚未設定 USAGE_LOG_API_URL");
    logsSetTbodyMessage_("請在 config.json 設定 USAGE_LOG_API_URL");
    return;
  }

  adminLogsLoading_ = true;
  try {
    logsSetFooter_("載入中...");
    logsSetTbodyMessage_("載入中...");

    const ret = await usageLogPost_({ mode: "listUsageLog", limit: 200 });
    if (!ret || ret.ok !== true) throw new Error(ret?.error || "listUsageLog failed");

    // 支援兩種格式：
    // 1) rows: [{ts, actorUserId, actorDisplayName}, ...]
    // 2) logs: 同上
    // 3) values: [[ts, actorUserId, actorDisplayName], ...]
    let rows = [];
    if (Array.isArray(ret.rows)) rows = ret.rows;
    else if (Array.isArray(ret.logs)) rows = ret.logs;
    else if (Array.isArray(ret.values)) {
      rows = ret.values.map((v) => ({ ts: v?.[0], actorUserId: v?.[1], actorDisplayName: v?.[2] }));
    }

    adminLogsAll_ = rows.map(normalizeLogRow_).filter((r) => r.ts || r.actorUserId || r.actorDisplayName);
    applyAdminLogsDateFilter_();
    renderAdminLogs_();

    const dateKey = getSelectedLogsDate_();
    logsSetFooter_(dateKey ? `共 ${adminLogs_.length} 筆（${dateKey}）/ 總 ${adminLogsAll_.length} 筆` : `共 ${adminLogs_.length} 筆`);
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || e);
    logsSetFooter_("讀取失敗");
    logsSetTbodyMessage_(
      msg.includes("unsupported mode")
        ? "此 USAGE_LOG_API_URL 的 GAS 尚未支援 listUsageLog（請更新 GAS 程式並重新部署 Web App）"
        : msg
    );
    toast("讀取管理員紀錄失敗", "err");
  } finally {
    adminLogsLoading_ = false;
  }
}

function bindAdminLogs_() {
  document.getElementById("logsReloadBtn")?.addEventListener("click", () => loadAdminLogs_());

  const dateEl = document.getElementById("logsDateInput");
  if (dateEl) {
    dateEl.addEventListener("change", () => {
      applyAdminLogsDateFilter_();
      renderAdminLogs_();
      const dateKey = getSelectedLogsDate_();
      logsSetFooter_(dateKey ? `共 ${adminLogs_.length} 筆（${dateKey}）/ 總 ${adminLogsAll_.length} 筆` : `共 ${adminLogs_.length} 筆`);
    });
  }
}

/**
 * 追加一筆管理員紀錄（不阻擋主流程）。
 * - 只送：ts / actor
 */
async function appendAdminUsageLog_() {
  if (!USAGE_LOG_API_URL) return;
  if (!me?.userId) return;

  try {
    await usageLogPost_({
      mode: "appendUsageLog",
      ts: new Date().toISOString(),
      actor: { userId: me.userId, displayName: me.displayName },
    });
  } catch (e) {
    // 不阻擋主流程
    console.warn("appendUsageLog failed", e);
  }
}
