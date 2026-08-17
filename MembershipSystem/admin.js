(function () {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  let members = [];
  let searchTimer = null;

  const statusLabel = { active: '有效', suspended: '停權', disabled: '停用' };

  async function loadMembers(query) {
    const result = await Membership.callApi('admin.list', { query: query || '', page: 1, pageSize: 100 });
    members = result.members;
    renderMetrics(result.stats);
    renderTable(members, result.total);
    $('#adminBoot').classList.add('hidden');
    $('#adminError').classList.add('hidden');
    $('#adminApp').classList.remove('hidden');
  }

  function renderMetrics(stats) {
    $('#metricTotal').textContent = stats.total;
    $('#metricActive').textContent = stats.active;
    $('#metricInactive').textContent = stats.suspended + stats.disabled;
  }

  function renderTable(rows, total) {
    const body = $('#memberTableBody');
    body.replaceChildren();
    $('#resultCount').textContent = `${total} 筆`;
    $('#emptyState').classList.toggle('hidden', rows.length !== 0);

    rows.forEach((member) => {
      const tr = document.createElement('tr');
      const memberTd = document.createElement('td');
      const memberCell = document.createElement('div');
      memberCell.className = 'member-cell';
      const img = document.createElement('img');
      img.alt = '';
      img.src = member.pictureUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="100%25" height="100%25" fill="%23eef2f6"/%3E%3C/svg%3E';
      const identity = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = member.displayName || 'LINE 會員';
      const joined = document.createElement('small');
      joined.textContent = `加入 ${Membership.formatDate(member.joinedAt)}`;
      identity.append(name, joined);
      memberCell.append(img, identity);
      memberTd.append(memberCell);
      const numberTd = document.createElement('td'); numberTd.textContent = member.memberNo;
      const tierTd = document.createElement('td'); tierTd.textContent = String(member.tier || '').toUpperCase();
      const statusTd = document.createElement('td');
      const status = document.createElement('span');
      status.className = `table-status ${member.membershipStatus === 'active' ? '' : member.membershipStatus}`.trim();
      status.textContent = statusLabel[member.membershipStatus] || member.membershipStatus;
      statusTd.append(status);
      const expiryTd = document.createElement('td'); expiryTd.textContent = Membership.formatDate(member.expiresAt, '永久');
      const actionTd = document.createElement('td');
      const edit = document.createElement('button');
      edit.className = 'text-button'; edit.type = 'button'; edit.textContent = '編輯';
      edit.addEventListener('click', () => openEdit(member));
      actionTd.append(edit);
      tr.append(memberTd, numberTd, tierTd, statusTd, expiryTd, actionTd);
      body.append(tr);
    });
  }

  function openEdit(member) {
    $('#editMemberName').textContent = member.displayName || 'LINE 會員';
    $('#editMemberNo').textContent = member.memberNo;
    $('#editLineUserId').value = member.lineUserId;
    $('#editExpectedUpdatedAt').value = member.updatedAt;
    $('#editTier').value = member.tier;
    $('#editStatus').value = member.membershipStatus;
    $('#editExpiresAt').value = member.expiresAt ? String(member.expiresAt).slice(0, 10) : '';
    $('#editNote').value = member.note || '';
    $('#editError').classList.add('hidden');
    $('#editDialog').showModal();
  }

  async function saveMember() {
    const button = $('#saveMemberButton');
    button.disabled = true;
    $('#editError').classList.add('hidden');
    try {
      await Membership.callApi('admin.update', {
        targetLineUserId: $('#editLineUserId').value,
        expectedUpdatedAt: $('#editExpectedUpdatedAt').value,
        tier: $('#editTier').value,
        membershipStatus: $('#editStatus').value,
        expiresAt: $('#editExpiresAt').value,
        note: $('#editNote').value
      });
      $('#editDialog').close();
      await loadMembers($('#memberSearch').value.trim());
    } catch (error) {
      $('#editError').textContent = error.message;
      $('#editError').classList.remove('hidden');
    } finally {
      button.disabled = false;
    }
  }

  function showAdminError(error) {
    $('#adminBoot').classList.add('hidden');
    $('#adminApp').classList.add('hidden');
    $('#adminErrorMessage').textContent = error && error.message ? error.message : '無法驗證管理權限。';
    $('#adminError').classList.remove('hidden');
  }

  async function initialize() {
    try {
      const loggedIn = await Membership.ensureLiffLogin();
      if (!loggedIn) return;
      await loadMembers('');
    } catch (error) {
      showAdminError(error);
    }
  }

  $('#memberSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadMembers($('#memberSearch').value.trim()).catch(showAdminError), 300);
  });
  $('#adminRefreshButton').addEventListener('click', () => loadMembers($('#memberSearch').value.trim()).catch(showAdminError));
  $('#saveMemberButton').addEventListener('click', saveMember);
  initialize();
})();
