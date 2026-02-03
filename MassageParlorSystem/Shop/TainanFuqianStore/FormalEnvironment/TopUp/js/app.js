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
      const text = list.map((s) => s.serial).filter(Boolean).join("\n");

      // genOutput textarea 已移除：改成複製到剪貼簿（best-effort）
      if (dom.genOutput) dom.genOutput.value = text;

      let copied = false;
      if (text) {
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
        } catch (_) {
          copied = false;
        }
      }

      toast(copied ? `已產生 ${list.length} 筆（已複製）` : `已產生 ${list.length} 筆`, "ok");
      await loadSerials();
    } catch (e) {
      console.error(e);
      toast(String(e.message || e), "err");
    } finally {
      hideTopLoading();
    }
  });

  dom.selectAll?.addEventListener("change", () => {
    const checked = !!dom.selectAll.checked;
    const serials = Array.isArray(state._visibleActiveSerials) ? state._visibleActiveSerials : [];
    if (checked) {
      for (const s of serials) state.selectedSerials.add(String(s));
    } else {
      for (const s of serials) state.selectedSerials.delete(String(s));
    }
    syncBatchUi_();
    // rerender checkboxes to reflect state
    syncRowCheckboxes_();
  });

  dom.batchVoidBtn?.addEventListener("click", async () => {
    const serials = getSelectedVisibleActiveSerials_();
    if (!serials.length) return;

    const ok = confirm(`確定批次作廢？\n\n筆數：${serials.length}`);
    if (!ok) return;

    const note = prompt("作廢原因（建議填寫）", "") ?? "";

    try {
      let okCount = 0;
      const failed = [];

      for (let i = 0; i < serials.length; i++) {
        const serial = serials[i];
        showTopLoading(`作廢中… (${i + 1}/${serials.length})`);
        const ret = await apiPost({ mode: "serials_void", serial, note: String(note || "").trim(), actor: state.me });
        if (ret?.ok) {
          okCount++;
        } else {
          failed.push({ serial, error: ret?.error || "void failed" });
        }
      }

      if (failed.length) {
        console.warn("batch void failed", failed);
        toast(`已作廢 ${okCount} 筆；失敗 ${failed.length} 筆`, "err");
      } else {
        toast(`已作廢 ${okCount} 筆`, "ok");
      }

      state.selectedSerials.clear();
      syncBatchUi_();
      await loadSerials();
    } catch (e) {
      console.error(e);
      toast(String(e.message || e), "err");
    } finally {
      hideTopLoading();
    }
  });

  dom.batchDeleteBtn?.addEventListener("click", async () => {
    const serials = getSelectedVisibleActiveSerials_();
    if (!serials.length) return;

    const ok = confirm(`確定批次刪除？\n\n筆數：${serials.length}\n\n⚠ 刪除後無法復原`);
    if (!ok) return;

    const note = prompt("刪除原因（建議填寫）", "") ?? "";

    try {
      showTopLoading("刪除中…");

      // Prefer batch endpoint (faster). Fallback to per-item loop if unsupported.
      const ret = await apiPost({ mode: "serials_delete_batch", serials, note: String(note || "").trim(), actor: state.me });
      if (!ret?.ok) {
        // fallback
        let okCount = 0;
        const failed = [];
        for (let i = 0; i < serials.length; i++) {
          const serial = serials[i];
          showTopLoading(`刪除中… (${i + 1}/${serials.length})`);
          const r = await apiPost({ mode: "serials_delete", serial, note: String(note || "").trim(), actor: state.me });
          if (r?.ok) okCount++;
          else failed.push({ serial, error: r?.error || "delete failed" });
        }
        if (failed.length) {
          console.warn("batch delete failed", failed);
          toast(`已刪除 ${okCount} 筆；失敗 ${failed.length} 筆`, "err");
        } else {
          toast(`已刪除 ${okCount} 筆`, "ok");
        }
      } else {
        const deleted = Array.isArray(ret.deleted) ? ret.deleted.length : 0;
        const failed = Array.isArray(ret.failed) ? ret.failed.length : 0;
        if (failed) toast(`已刪除 ${deleted} 筆；失敗 ${failed} 筆`, "err");
        else toast(`已刪除 ${deleted} 筆`, "ok");
      }

      state.selectedSerials.clear();
      syncBatchUi_();
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

      if (action === "delete") {
        const ok = confirm(`確定刪除？\n\n序號：${serial}\n\n⚠ 刪除後無法復原`);
        if (!ok) return;
        const note = prompt("刪除原因（建議填寫）", "") ?? "";
        showTopLoading("刪除中…");
        const ret = await apiPost({ mode: "serials_delete", serial, note: String(note || "").trim(), actor: state.me });
        if (!ret.ok) throw new Error(ret.error || "delete failed");
        state.selectedSerials.delete(String(serial));
        syncBatchUi_();
        toast("已刪除", "ok");
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

  dom.tbodyRows?.addEventListener("change", (ev) => {
    const cb = ev.target?.closest?.("input.row-select[data-serial]");
    if (!cb) return;
    const serial = cb.getAttribute("data-serial");
    if (!serial) return;

    if (cb.checked) state.selectedSerials.add(serial);
    else state.selectedSerials.delete(serial);

    syncBatchUi_();
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

    // 更新可視的 active serial 列表（供全選/批次作廢使用）
    state._visibleActiveSerials = rows.filter((r) => String(r.status || "") === "active").map((r) => String(r.serial || ""));
    // 清掉已不存在於當前可見範圍的選取（避免跨篩選誤操作）
    const visibleSet = new Set(state._visibleActiveSerials);
    for (const s of Array.from(state.selectedSerials)) {
      if (!visibleSet.has(String(s))) state.selectedSerials.delete(String(s));
    }
    syncBatchUi_();

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
      const usedNote = String(r.usedNote || "");

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
            <button class="btn btn-small btn-danger" data-action="void" data-serial="${escapeHtml_(serial)}" type="button">作廢</button>
            <button class="btn btn-small btn-danger" data-action="delete" data-serial="${escapeHtml_(serial)}" type="button">刪除</button>
          `
          : status === "void"
          ? `
            <button class="btn btn-small btn-ghost" data-action="copy" data-serial="${escapeHtml_(serial)}" type="button">複製</button>
            <button class="btn btn-small btn-primary" data-action="reactivate" data-serial="${escapeHtml_(serial)}" type="button">恢復</button>
            <button class="btn btn-small btn-danger" data-action="delete" data-serial="${escapeHtml_(serial)}" type="button">刪除</button>
          `
          : `
            <button class="btn btn-small btn-ghost" data-action="copy" data-serial="${escapeHtml_(serial)}" type="button">複製</button>
            <button class="btn btn-small btn-danger" data-action="delete" data-serial="${escapeHtml_(serial)}" type="button">刪除</button>
          `;

      const isActive = status === "active";
      const isChecked = isActive && state.selectedSerials?.has?.(serial);

      return `
        <tr>
          <td class="select-cell" data-label="選取">
            <input class="row-select" type="checkbox" data-serial="${escapeHtml_(serial)}" ${isActive ? "" : "disabled"} ${isChecked ? "checked" : ""} aria-label="選取序號" />
          </td>
          <td class="mono" data-label="序號">${escapeHtml_(serial)}</td>
          <td data-label="面額">${escapeHtml_(amount)}</td>
          <td data-label="狀態">${chip}</td>
          <td data-label="建立時間">${escapeHtml_(createdAt)}</td>
          <td data-label="核銷時間">${escapeHtml_(usedAt)}</td>
          <td data-label="核銷備註">${escapeHtml_(usedNote || "")}</td>
          <td data-label="備註">${escapeHtml_(note || "")}</td>
          <td data-label="操作"><div class="row-actions">${actions}</div></td>
        </tr>
      `;
    })
    .join("");

  dom.tbodyRows.innerHTML = html || "";
}

function getSelectedVisibleActiveSerials_() {
  const visible = Array.isArray(state._visibleActiveSerials) ? state._visibleActiveSerials : [];
  const picked = [];
  for (const s of visible) {
    if (state.selectedSerials.has(String(s))) picked.push(String(s));
  }
  return picked;
}

function syncRowCheckboxes_() {
  if (!dom.tbodyRows) return;
  const inputs = dom.tbodyRows.querySelectorAll('input.row-select[data-serial]');
  for (const el of inputs) {
    const serial = el.getAttribute('data-serial');
    if (!serial) continue;
    if (el.disabled) {
      el.checked = false;
      continue;
    }
    el.checked = state.selectedSerials.has(String(serial));
  }
}

function syncBatchUi_() {
  const selected = getSelectedVisibleActiveSerials_();
  const total = Array.isArray(state._visibleActiveSerials) ? state._visibleActiveSerials.length : 0;

  if (dom.selectedCount) dom.selectedCount.textContent = `已選 ${selected.length}`;
  if (dom.batchVoidBtn) dom.batchVoidBtn.disabled = selected.length === 0;
  if (dom.batchDeleteBtn) dom.batchDeleteBtn.disabled = selected.length === 0;

  if (dom.selectAll) {
    dom.selectAll.indeterminate = selected.length > 0 && selected.length < total;
    dom.selectAll.checked = total > 0 && selected.length === total;
    dom.selectAll.disabled = total === 0;
  }
}

function buildCsv_(rows) {
  const header = ["serial", "amount", "status", "createdAtMs", "usedAtMs", "usedNote", "note"].join(",");
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[\n\r\t,"]/.test(s)) return '"' + s.replaceAll('"', '""') + '"';
    return s;
  };
  const lines = (rows || []).map((r) => [r.serial, r.amount, r.status, r.createdAtMs, r.usedAtMs, r.usedNote, r.note].map(esc).join(","));
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
