import { loadConfigJson, config } from "./modules/config.js";
import { dom } from "./modules/dom.js";
import { initTheme } from "./modules/theme.js";
import { showGate, hideGate, showTopLoading, hideTopLoading, setBadge, setLastUpdate, toast } from "./modules/ui.js";
import { initAuthAndGuard } from "./modules/auth.js";
import { apiPost } from "./modules/api.js";
import { state } from "./modules/state.js";
import { debounce } from "./modules/core.js";

function bindEventsOnce() {
  if (state._eventsBound) return;
  state._eventsBound = true;

  const reload = () => loadSerials();

  dom.themeToggleBtn?.addEventListener("click", () => {
    // theme.js handles it
  });

  dom.reloadBtn?.addEventListener("click", reload);

  dom.exportBtn?.addEventListener("click", async () => {
    try {
      showTopLoading("匯出中…");
      const ret = await apiPost({
        mode: "serials_list",
        filters: getFilters_(),
        limit: Math.max(1, config.LIST_LIMIT || 300),
        actor: state.me,
      });
      if (!ret.ok) throw new Error(ret.error || "export failed");
      const rows = Array.isArray(ret.serials) ? ret.serials : [];
      const csv = buildCsv_(rows);
      downloadText_(csv, `topup_serials_${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
      toast("已匯出", "ok");
    } catch (e) {
      console.error(e);
      toast("匯出失敗", "err");
    } finally {
      hideTopLoading();
    }
  });

  const filterChanged = debounce(() => loadSerials(), 220);
  dom.searchInput?.addEventListener("input", filterChanged);
  dom.statusSelect?.addEventListener("change", filterChanged);
  dom.amountSelect?.addEventListener("change", filterChanged);

  dom.genBtn?.addEventListener("click", async () => {
    try {
      const amount = Number(dom.genAmount?.value || 0);
      const count = Number(dom.genCount?.value || 0);
      const note = String(dom.genNote?.value || "").trim();

      if (!Number.isFinite(amount) || amount <= 0) throw new Error("面額不正確");
      if (!Number.isFinite(count) || count <= 0 || count > 500) throw new Error("數量需在 1~500");

      showTopLoading("產生序號中…");
      const ret = await apiPost({
        mode: "serials_generate",
        amount,
        count,
        note,
        actor: state.me,
      });
      if (!ret.ok) throw new Error(ret.error || "generate failed");

      const list = Array.isArray(ret.serials) ? ret.serials : [];
      dom.genOutput.value = list.map((s) => s.serial).join("\n");
      toast(`已產生 ${list.length} 筆`, "ok");
      await loadSerials();
    } catch (e) {
      console.error(e);
      toast(String(e.message || e), "err");
    } finally {
      hideTopLoading();
    }
  });

  dom.tbodyRows?.addEventListener("click", async (ev) => {
    const btn = ev.target?.closest?.("button[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    const serial = btn.getAttribute("data-serial");
    if (!action || !serial) return;

    try {
      if (action === "copy") {
        await navigator.clipboard.writeText(serial);
        toast("已複製", "ok");
        return;
      }

      if (action === "redeem") {
        const note = prompt("核銷備註（選填）", "") ?? "";
        showTopLoading("核銷中…");
        const ret = await apiPost({ mode: "serials_redeem", serial, note: String(note || "").trim(), actor: state.me });
        if (!ret.ok) throw new Error(ret.error || "redeem failed");
        toast("已核銷", "ok");
        await loadSerials();
        return;
      }

      if (action === "void") {
        const ok = confirm(`確定作廢？\n\n序號：${serial}`);
        if (!ok) return;
        const note = prompt("作廢原因（建議填寫）", "") ?? "";
        showTopLoading("作廢中…");
        const ret = await apiPost({ mode: "serials_void", serial, note: String(note || "").trim(), actor: state.me });
        if (!ret.ok) throw new Error(ret.error || "void failed");
        toast("已作廢", "ok");
        await loadSerials();
        return;
      }

      if (action === "reactivate") {
        const ok = confirm(`確定恢復為可用？\n\n序號：${serial}`);
        if (!ok) return;
        showTopLoading("恢復中…");
        const ret = await apiPost({ mode: "serials_reactivate", serial, actor: state.me });
        if (!ret.ok) throw new Error(ret.error || "reactivate failed");
        toast("已恢復", "ok");
        await loadSerials();
        return;
      }
    } catch (e) {
      console.error(e);
      toast(String(e.message || e), "err");
    } finally {
      hideTopLoading();
    }
  });
}

function getFilters_() {
  const q = String(dom.searchInput?.value || "").trim();
  const status = String(dom.statusSelect?.value || "all");
  const amountRaw = String(dom.amountSelect?.value || "all");
  const amount = amountRaw === "all" ? null : Number(amountRaw);

  return {
    q,
    status,
    amount: Number.isFinite(amount) ? amount : null,
  };
}

async function loadSerials() {
  dom.emptyState.style.display = "none";
  dom.errorState.style.display = "none";
  dom.loadingState.style.display = "flex";

  try {
    const ret = await apiPost({
      mode: "serials_list",
      filters: getFilters_(),
      limit: Math.max(1, config.LIST_LIMIT || 300),
      actor: state.me,
    });
    if (!ret.ok) throw new Error(ret.error || "list failed");

    const rows = Array.isArray(ret.serials) ? ret.serials : [];
    renderRows_(rows);

    setLastUpdate(ret.now || Date.now());
    setBadge(dom.summaryBadge, `共 ${rows.length} 筆`);

    dom.loadingState.style.display = "none";
    dom.emptyState.style.display = rows.length ? "none" : "block";
  } catch (e) {
    console.error(e);
    dom.loadingState.style.display = "none";
    dom.errorState.style.display = "block";
    toast("讀取序號失敗", "err");
  }
}

function escapeHtml_(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtTs_(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  try {
    const d = new Date(n);
    const pad = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch (_) {
    return "—";
  }
}

function renderRows_(rows) {
  if (!dom.tbodyRows) return;

  const html = rows
    .map((r) => {
      const serial = String(r.serial || "");
      const amount = r.amount ?? "";
      const status = String(r.status || "");
      const note = String(r.note || "");

      const createdAt = fmtTs_(r.createdAtMs);
      const usedAt = fmtTs_(r.usedAtMs);

      const chip =
        status === "active"
          ? '<span class="chip chip-active">可用</span>'
          : status === "used"
          ? '<span class="chip chip-used">已核銷</span>'
          : '<span class="chip chip-void">已作廢</span>';

      const actions =
        status === "active"
          ? `
            <button class="btn btn-small btn-ghost" data-action="copy" data-serial="${escapeHtml_(serial)}" type="button">複製</button>
            <button class="btn btn-small btn-primary" data-action="redeem" data-serial="${escapeHtml_(serial)}" type="button">核銷</button>
            <button class="btn btn-small btn-danger" data-action="void" data-serial="${escapeHtml_(serial)}" type="button">作廢</button>
          `
          : status === "void"
          ? `
            <button class="btn btn-small btn-ghost" data-action="copy" data-serial="${escapeHtml_(serial)}" type="button">複製</button>
            <button class="btn btn-small btn-primary" data-action="reactivate" data-serial="${escapeHtml_(serial)}" type="button">恢復</button>
          `
          : `
            <button class="btn btn-small btn-ghost" data-action="copy" data-serial="${escapeHtml_(serial)}" type="button">複製</button>
          `;

      return `
        <tr>
          <td class="mono" data-label="序號">${escapeHtml_(serial)}</td>
          <td data-label="面額">${escapeHtml_(amount)}</td>
          <td data-label="狀態">${chip}</td>
          <td data-label="建立時間">${escapeHtml_(createdAt)}</td>
          <td data-label="核銷時間">${escapeHtml_(usedAt)}</td>
          <td data-label="備註">${escapeHtml_(note || "")}</td>
          <td data-label="操作"><div class="row-actions">${actions}</div></td>
        </tr>
      `;
    })
    .join("");

  dom.tbodyRows.innerHTML = html || "";
}

function buildCsv_(rows) {
  const header = ["serial", "amount", "status", "createdAtMs", "usedAtMs", "note"].join(",");
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[\n\r\t,"]/.test(s)) return '"' + s.replaceAll('"', '""') + '"';
    return s;
  };
  const lines = (rows || []).map((r) => [r.serial, r.amount, r.status, r.createdAtMs, r.usedAtMs, r.note].map(esc).join(","));
  return [header, ...lines].join("\n");
}

function downloadText_(text, filename, mime) {
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

async function boot() {
  initTheme();
  showGate("初始化中…");

  try {
    await loadConfigJson();

    if (dom.pageTitle) dom.pageTitle.textContent = String(config.PAGE_TITLE || "儲值序號後台");
    if (dom.subtitle) dom.subtitle.textContent = String(config.PAGE_SUBTITLE || "");

    bindEventsOnce();

    const authRes = await initAuthAndGuard();
    if (!authRes?.ok) return;

    hideGate();
    dom.appRoot?.classList.remove("app-hidden");

    await loadSerials();
  } catch (e) {
    console.error(e);
    showGate("⚠ 初始化失敗\n" + String(e.message || e), true);
  }
}

window.addEventListener("load", () => {
  boot().catch((e) => {
    console.error(e);
    showGate("⚠ 初始化失敗\n" + String(e.message || e), true);
  });
});
