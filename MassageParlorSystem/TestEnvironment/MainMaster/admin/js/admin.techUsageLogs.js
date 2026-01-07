/* ================================
 * Admin - 技師使用紀錄（usage_log）
 * - 顯示欄位：serverTime / userId / name / detail
 * - 透過 TECH_USAGE_LOG_URL 呼叫 GAS（GET）：mode=list
 * ================================ */

/** @type {{serverTime:string, userId:string, name:string, detail:string}[]} */
let techUsageLogs_ = [];

let techUsageLogsLoading_ = false;

function techLogsSetFooter_(text) {
  const el = document.getElementById("techLogsFooterStatus");
  if (el) el.textContent = String(text || "-");
}

function techLogsSetTbodyMessage_(msg) {
  const tbody = document.getElementById("techLogsTbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(msg || "-")}</td></tr>`;
}

function normalizeTechUsageRow_(r) {
  // 允許多種回傳格式
  const serverTime = String(r?.serverTime ?? r?.ts ?? r?.time ?? "");
  const userId = String(r?.userId ?? r?.lineUserId ?? "");
  const name = String(r?.name ?? r?.displayName ?? "");
  const detail = String(r?.detail ?? "");
  return { serverTime, userId, name, detail };
}

function renderTechUsageLogs_() {
  const tbody = document.getElementById("techLogsTbody");
  if (!tbody) return;

  if (!techUsageLogs_.length) {
    tbody.innerHTML = `<tr><td colspan="5">無資料</td></tr>`;
    return;
  }

  tbody.innerHTML = techUsageLogs_
    .map((r, i) => {
      return `
        <tr>
          <td data-label="#">${i + 1}</td>
          <td data-label="serverTime"><span style="font-family:var(--mono)">${escapeHtml(r.serverTime)}</span></td>
          <td data-label="userId"><span style="font-family:var(--mono)">${escapeHtml(r.userId)}</span></td>
          <td data-label="name">${escapeHtml(r.name)}</td>
          <td data-label="detail">${escapeHtml(r.detail)}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadTechUsageLogs_() {
  if (techUsageLogsLoading_) return;

  if (!TECH_USAGE_LOG_URL) {
    techLogsSetFooter_("尚未設定 TECH_USAGE_LOG_URL");
    techLogsSetTbodyMessage_("請在 config.json 設定 TECH_USAGE_LOG_URL");
    return;
  }

  techUsageLogsLoading_ = true;
  try {
    techLogsSetFooter_("載入中...");
    techLogsSetTbodyMessage_("載入中...");

    // 需要 GAS 支援 mode=list 才能讀取
    const ret = await techUsageLogGet_({ mode: "list", limit: 200 });
    if (!ret || ret.ok !== true) throw new Error(ret?.error || "list failed");

    // 支援：rows: [{serverTime,userId,name,detail}]
    // 或 values: [[serverTime,event,userId,name,clientTs,tz,href,detail], ...]
    let rows = [];
    if (Array.isArray(ret.rows)) rows = ret.rows;
    else if (Array.isArray(ret.logs)) rows = ret.logs;
    else if (Array.isArray(ret.values)) {
      rows = ret.values.map((v) => ({ serverTime: v?.[0], userId: v?.[2], name: v?.[3], detail: v?.[7] }));
    }

    techUsageLogs_ = rows
      .map(normalizeTechUsageRow_)
      .filter((r) => r.serverTime || r.userId || r.name || r.detail);

    renderTechUsageLogs_();
    techLogsSetFooter_(`共 ${techUsageLogs_.length} 筆`);
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || e);
    techLogsSetFooter_("讀取失敗");
    techLogsSetTbodyMessage_(
      msg.includes("unsupported mode")
        ? "此 TECH_USAGE_LOG_URL 的 GAS 尚未支援 mode=list（請在 GAS doGet 新增 list 回傳 JSON）"
        : msg
    );
    toast("讀取技師使用紀錄失敗", "err");
  } finally {
    techUsageLogsLoading_ = false;
  }
}

function bindTechUsageLogs_() {
  document.getElementById("techLogsReloadBtn")?.addEventListener("click", () => loadTechUsageLogs_());
}
