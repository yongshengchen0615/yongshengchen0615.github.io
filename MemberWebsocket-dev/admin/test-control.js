(() => {
  'use strict';

  const els = {};
  let currentRunId = '';
  let pollTimer = 0;
  let busy = false;

  window.addEventListener('DOMContentLoaded', () => {
    [
      'testModeTab',
      'automationTestRunnerBadge',
      'runQuickAutomationTestButton',
      'runFullAutomationTestButton',
      'automationTestMessage',
      'automationTestRunCode',
      'automationTestRunStatus',
      'automationTestRunSuite',
      'automationTestProgress',
      'automationTestProgressBar',
      'automationTestProgressText',
      'automationTestPassedCount',
      'automationTestFailedCount',
      'automationTestTotalCount',
      'automationTestCaseList',
      'automationTestCaseEmpty',
      'automationTestHistoryList',
      'automationTestHistoryEmpty'
    ].forEach((id) => { els[id] = document.getElementById(id); });

    if (!els.testModeTab || !els.runQuickAutomationTestButton) return;

    els.runQuickAutomationTestButton.addEventListener('click', () => startRun('quick'));
    els.runFullAutomationTestButton.addEventListener('click', () => startRun('full'));
    els.testModeTab.addEventListener('click', () => loadHistory().catch(showError));

    window.addEventListener('member-admin-ready', () => {
      if (els.testModeTab.getAttribute('aria-selected') === 'true') {
        loadHistory().catch(showError);
      }
    });

    window.addEventListener('beforeunload', stopPolling);
  });

  function apiUrl(config) {
    const base = String(config && config.supabaseUrl || '').replace(/\/$/, '');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)) {
      throw new Error('自動化測試服務設定不完整。');
    }
    return base + '/functions/v1/test-control-api';
  }

  async function request(action, payload = {}) {
    const session = await window.MemberAdminSession.wait();
    const response = await fetch(apiUrl(session.config), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: String(session.config.supabasePublishableKey || '')
      },
      cache: 'no-store',
      body: JSON.stringify({
        ...payload,
        action,
        clientType: 'admin',
        idToken: session.idToken
      })
    });

    let body;
    try { body = await response.json(); }
    catch { throw new Error('自動化測試服務暫時未正常回應。'); }

    if (!response.ok || !body || body.ok !== true) {
      const error = new Error(body?.error?.message || '自動化測試服務拒絕此操作。');
      error.code = body?.error?.code || 'TEST_CONTROL_ERROR';
      throw error;
    }
    return body.data || {};
  }

  async function loadHistory() {
    const data = await request('admin.test-control.list');
    renderHistory(Array.isArray(data.runs) ? data.runs : []);
    if (!currentRunId && Array.isArray(data.runs) && data.runs.length) {
      currentRunId = String(data.runs[0].id || '');
      if (currentRunId) {
        const detail = await request('admin.test-control.status', { runId: currentRunId });
        renderDetail(detail);
      }
    }
  }

  async function startRun(suite) {
    if (busy) return;
    setBusy(true);
    setMessage(suite === 'full' ? '正在建立完整測試…' : '正在建立快速測試…');
    try {
      const created = await request('admin.test-control.create', { suite });
      currentRunId = String(created.run?.id || '');
      renderDetail(created);
      renderHistory(Array.isArray(created.runs) ? created.runs : []);
      if (!currentRunId) throw new Error('自動化測試建立成功，但未取得執行識別。');

      setMessage('測試執行中；畫面會持續更新每個案例與測試數據。');
      beginPolling();

      const executePromise = request('admin.test-control.execute', { runId: currentRunId });
      const finalData = await executePromise;
      stopPolling();
      renderDetail(finalData);
      renderHistory(Array.isArray(finalData.runs) ? finalData.runs : []);
      const failed = Number(finalData.run?.failedCases || 0);
      setMessage(
        failed > 0
          ? '測試完成：有 ' + failed + ' 個案例失敗，請展開失敗案例查看 Expected / Actual。'
          : '測試完成：所有案例通過。',
        failed > 0
      );
    } catch (error) {
      stopPolling();
      showError(error);
    } finally {
      setBusy(false);
    }
  }

  function beginPolling() {
    stopPolling();
    const tick = async () => {
      if (!currentRunId) return;
      try {
        const data = await request('admin.test-control.status', { runId: currentRunId });
        renderDetail(data);
        renderHistory(Array.isArray(data.runs) ? data.runs : []);
        const status = String(data.run?.status || '');
        if (['passed', 'failed', 'cancelled'].includes(status)) stopPolling();
      } catch (_) {}
    };
    pollTimer = window.setInterval(tick, 900);
  }

  function stopPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = 0;
  }

  function setBusy(value) {
    busy = Boolean(value);
    els.runQuickAutomationTestButton.disabled = busy;
    els.runFullAutomationTestButton.disabled = busy;
  }

  function statusText(status) {
    const map = {
      queued: '等待執行',
      running: '執行中',
      passed: '通過',
      failed: '失敗',
      cancelled: '已取消',
      skipped: '略過'
    };
    return map[status] || status || '尚未執行';
  }

  function suiteText(suite) {
    return suite === 'full' ? '完整測試' : suite === 'quick' ? '快速測試' : '—';
  }

  function statusClass(status) {
    return ['queued', 'running', 'passed', 'failed', 'cancelled', 'skipped'].includes(status)
      ? ' is-' + status
      : '';
  }

  function formatTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-TW', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  }

  function formatDuration(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s';
  }

  function formatData(value) {
    if (value === null || value === undefined) return '—';
    try {
      const text = JSON.stringify(value, null, 2);
      return text === '{}' ? '—' : text;
    } catch (_) {
      return String(value);
    }
  }

  function renderDetail(data) {
    const run = data && data.run ? data.run : null;
    const cases = Array.isArray(data && data.cases) ? data.cases : [];
    if (!run) return;

    currentRunId = String(run.id || currentRunId);
    const total = Number(run.totalCases || cases.length || 0);
    const passed = Number(run.passedCases || 0);
    const failed = Number(run.failedCases || 0);
    const complete = Math.min(total, passed + failed);
    const progress = total > 0 ? Math.round((complete / total) * 100) : 0;
    const status = String(run.status || 'queued');

    els.automationTestRunCode.textContent = String(run.runCode || '—');
    els.automationTestRunStatus.textContent = statusText(status);
    els.automationTestRunStatus.className = 'test-control-run-status' + statusClass(status);
    els.automationTestRunSuite.textContent = suiteText(run.suite);
    els.automationTestPassedCount.textContent = String(passed);
    els.automationTestFailedCount.textContent = String(failed);
    els.automationTestTotalCount.textContent = String(total);
    els.automationTestProgressBar.style.width = progress + '%';
    els.automationTestProgressText.textContent = progress + '% · ' + complete + ' / ' + total;
    els.automationTestProgress.setAttribute('aria-valuenow', String(progress));
    els.automationTestProgress.setAttribute('aria-valuetext', progress + '%');

    els.automationTestRunnerBadge.textContent = status === 'running'
      ? 'Runner：執行中'
      : status === 'passed'
        ? 'Runner：全部通過'
        : status === 'failed'
          ? 'Runner：發現異常'
          : 'Runner：待命';
    els.automationTestRunnerBadge.className = 'test-mode-status-badge' + (
      status === 'running' ? ' is-warning' :
      status === 'passed' ? ' is-active' :
      status === 'failed' ? ' is-error' : ' is-off'
    );

    els.automationTestCaseList.replaceChildren(...cases.map(renderCase));
    els.automationTestCaseEmpty.classList.toggle('hidden', cases.length !== 0);
  }

  function renderCase(testCase) {
    const details = document.createElement('details');
    details.className = 'test-control-case' + statusClass(String(testCase.status || 'queued'));
    details.open = ['running', 'failed'].includes(String(testCase.status || ''));

    const summary = document.createElement('summary');

    const identity = document.createElement('div');
    identity.className = 'test-control-case-identity';

    const mark = document.createElement('span');
    mark.className = 'test-control-case-mark';
    mark.textContent = testCase.status === 'passed' ? '✓' : testCase.status === 'failed' ? '!' : testCase.status === 'running' ? '●' : '○';

    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = String(testCase.name || testCase.key || '測試案例');
    const meta = document.createElement('small');
    const duration = formatDuration(testCase.durationMs);
    meta.textContent = [String(testCase.domain || ''), duration].filter(Boolean).join(' · ');
    copy.append(title, meta);
    identity.append(mark, copy);

    const state = document.createElement('span');
    state.className = 'test-control-case-state' + statusClass(String(testCase.status || 'queued'));
    state.textContent = statusText(String(testCase.status || 'queued'));

    summary.append(identity, state);
    details.append(summary);

    if (testCase.failureMessage) {
      const failure = document.createElement('div');
      failure.className = 'test-control-failure';
      const code = document.createElement('strong');
      code.textContent = String(testCase.failureCode || 'TEST_FAILED');
      const message = document.createElement('span');
      message.textContent = String(testCase.failureMessage || '');
      failure.append(code, message);
      details.append(failure);
    }

    const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
    const stepList = document.createElement('div');
    stepList.className = 'test-control-step-list';
    if (!steps.length) {
      const pending = document.createElement('p');
      pending.className = 'test-control-step-empty';
      pending.textContent = '等待此案例開始執行。';
      stepList.append(pending);
    } else {
      steps.forEach((step) => stepList.append(renderStep(step)));
    }
    details.append(stepList);
    return details;
  }

  function renderStep(step) {
    const row = document.createElement('section');
    row.className = 'test-control-step' + statusClass(String(step.status || 'queued'));

    const heading = document.createElement('div');
    heading.className = 'test-control-step-heading';

    const name = document.createElement('strong');
    name.textContent = String(step.order || '') + '. ' + String(step.name || step.key || '步驟');

    const meta = document.createElement('span');
    meta.textContent = [statusText(String(step.status || 'queued')), formatDuration(step.durationMs)].filter(Boolean).join(' · ');
    heading.append(name, meta);
    row.append(heading);

    if (step.message) {
      const message = document.createElement('p');
      message.className = 'test-control-step-message';
      message.textContent = String(step.message);
      row.append(message);
    }

    const data = document.createElement('div');
    data.className = 'test-control-data-grid';

    const expected = document.createElement('div');
    const expectedTitle = document.createElement('span');
    expectedTitle.textContent = 'Expected';
    const expectedValue = document.createElement('pre');
    expectedValue.textContent = formatData(step.expected);
    expected.append(expectedTitle, expectedValue);

    const actual = document.createElement('div');
    const actualTitle = document.createElement('span');
    actualTitle.textContent = 'Actual';
    const actualValue = document.createElement('pre');
    actualValue.textContent = formatData(step.actual);
    actual.append(actualTitle, actualValue);

    data.append(expected, actual);
    row.append(data);
    return row;
  }

  function renderHistory(runs) {
    const list = Array.isArray(runs) ? runs : [];
    els.automationTestHistoryList.replaceChildren(...list.map((run) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'test-control-history-item' + (String(run.id || '') === currentRunId ? ' active' : '');
      button.addEventListener('click', async () => {
        if (busy) return;
        currentRunId = String(run.id || '');
        renderHistory(list);
        try {
          const data = await request('admin.test-control.status', { runId: currentRunId });
          renderDetail(data);
        } catch (error) {
          showError(error);
        }
      });

      const top = document.createElement('span');
      top.className = 'test-control-history-top';
      const code = document.createElement('strong');
      code.textContent = String(run.runCode || 'Test run');
      const status = document.createElement('span');
      status.className = 'test-control-history-status' + statusClass(String(run.status || 'queued'));
      status.textContent = statusText(String(run.status || 'queued'));
      top.append(code, status);

      const meta = document.createElement('small');
      meta.textContent = [
        suiteText(run.suite),
        formatTime(run.createdAt),
        Number(run.passedCases || 0) + '/' + Number(run.totalCases || 0) + ' 通過'
      ].join(' · ');

      button.append(top, meta);
      return button;
    }));
    els.automationTestHistoryEmpty.classList.toggle('hidden', list.length !== 0);
  }

  function setMessage(message, error = false) {
    els.automationTestMessage.textContent = String(message || '');
    els.automationTestMessage.classList.toggle('hidden', !message);
    els.automationTestMessage.classList.toggle('error', Boolean(error));
  }

  function showError(error) {
    setMessage(error && error.message ? error.message : '自動化測試操作失敗，請稍後再試。', true);
  }
})();
