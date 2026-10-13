(() => {
  'use strict';
  let pending = false, cursor = null, filters = null, generation = 0;
  const $ = id => document.getElementById(id);
  const node = (tag, text, cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
  function date(offset) { return new Date(Date.now() + (8 * 60 * 60 * 1000) + offset * 86400000).toISOString().slice(0, 10); }
  function init() {
    const nav = document.querySelector('.surface-nav'), view = $('adminView'); if (!nav || !view) return;
    const tab = node('button', '使用紀錄', 'surface-tab'); tab.id = 'operationAuditTab'; tab.type = 'button';
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'operationAuditPanel'); tab.setAttribute('aria-selected', 'false');
    nav.append(tab);
    const panel = node('section', '', 'panel hidden operation-audit-panel'); panel.id = 'operationAuditPanel';
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id);
    panel.innerHTML = '<h2>使用紀錄／操作稽核</h2><p>查詢重要會員及系統操作。識別資訊已遮罩，詳情只提供必要欄位；每次查詢也會留下稽核紀錄。</p><form id="operationAuditForm" class="operation-audit-filters"><label>開始日期<input id="auditFrom" type="date" required></label><label>結束日期<input id="auditTo" type="date" required></label><label>會員編號<input id="auditMemberCode" type="text" maxlength="40" placeholder="全部會員" autocomplete="off"></label><label>事件<input id="auditAction" type="text" maxlength="80" placeholder="全部事件／完整事件名稱" autocomplete="off"></label><label>結果<select id="auditResult"><option value="">全部</option><option value="success">成功</option><option value="failed">失敗</option></select></label><button id="auditSearch" class="button button-dark" type="submit">查詢</button></form><p id="operationAuditStatus" role="status" aria-live="polite"></p><div id="operationAuditList"></div><button id="auditNext" class="button button-outline" type="button" hidden>下一頁</button>';
    view.append(panel); $('auditFrom').value = date(-6); $('auditTo').value = date(0);
    tab.addEventListener('click', () => {
      nav.querySelectorAll('[role=tab]').forEach(n => n.setAttribute('aria-selected', String(n===tab)));
      [...view.children].filter(n => n.classList.contains('panel')).forEach(n => n.classList.toggle('hidden', n!==panel));
      if (!filters) void query(false);
    });
    nav.addEventListener('click', e => { if (e.target.closest('.surface-tab')?.id !== tab.id) panel.classList.add('hidden'); });
    $('operationAuditForm').addEventListener('submit', e => { e.preventDefault(); void query(false); });
    $('auditNext').addEventListener('click', () => void query(true));
  }
  async function query(next) {
    if (pending) return;
    const session = window.MemberSystem.getSession('admin');
    if (!session) { $('operationAuditStatus').textContent = '登入狀態已失效，請重新登入。'; return; }
    const from = $('auditFrom').value, to = $('auditTo').value;
    if (!from || !to || from>to) { $('operationAuditStatus').textContent = '請選擇有效的日期範圍。'; return; }
    const upper = new Date(`${to}T00:00:00+08:00`); upper.setUTCDate(upper.getUTCDate()+1);
    if (!next) { cursor = null; filters = {from:`${from}T00:00:00+08:00`,to:upper.toISOString(),memberCode:$('auditMemberCode').value.trim().toUpperCase(),eventAction:$('auditAction').value.trim(),result:$('auditResult').value}; }
    const current = ++generation; pending = true;
    $('operationAuditPanel').setAttribute('aria-busy', 'true'); $('auditSearch').disabled = true; $('auditNext').disabled = true;
    $('operationAuditStatus').textContent = '正在查詢紀錄…';
    try {
      const result = await window.MemberSystem.request(session.config, 'admin', session.idToken, 'admin.audit.query', {
        ...filters,cursor,requestId:'AUDQ-'+crypto.randomUUID(),
      });
      if (current!==generation) return;
      const list = $('operationAuditList'); list.replaceChildren();
      const items = Array.isArray(result.items) ? result.items : [];
      for (const item of items) {
        const row = node('article', '', 'operation-audit-row');
        row.append(node('strong', `${item.action} · ${item.result === 'success' ? '成功' : '失敗'}`),
          node('p', `${new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'medium'}).format(new Date(item.createdAt))} · ${item.actorRole} ${item.actor}`),
          node('small', `${item.targetType} · ${item.target}`));
        const detail = node('details', ''); detail.append(node('summary', '查看詳情'), node('pre', JSON.stringify(item.detail || {}, null, 2)));
        row.append(detail); list.append(row);
      }
      cursor = items.length ? {createdAt:items.at(-1).createdAt,id:items.at(-1).id} : null;
      $('auditNext').hidden = !result.hasMore;
      $('operationAuditStatus').textContent = items.length ? `本頁 ${items.length} 筆；依台北時間由新到舊排列。` : '此條件下沒有紀錄。';
    } catch (e) {
      $('operationAuditList').replaceChildren(); $('auditNext').hidden = true;
      $('operationAuditStatus').textContent = e.message || '查詢失敗，請重試。';
    } finally { pending = false; $('operationAuditPanel').setAttribute('aria-busy','false'); $('auditSearch').disabled=false; $('auditNext').disabled=false; }
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
