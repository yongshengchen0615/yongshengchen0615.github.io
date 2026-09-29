const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'member/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'member/app.js'), 'utf8');
const terms = { id: 'terms-2', version: '2026-10-v2', title: '新版條款', summary: '請閱讀', body: '完整條款內容' };
const profile = { profileComplete: true, membershipRequired: false, joinedAt: '2026-01-01' };

async function start(consentRequired, options = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/member/' });
  const w = dom.window;
  await new Promise((resolve) => w.addEventListener('load', resolve, { once: true }));
  const calls = [];
  w.MemberSystem = {
    bindDialogKeyboard() {},
    loadConfig: async () => ({ brandName: 'Lumen Club' }),
    signIn: async () => 'fixture-token',
    initials: () => '會',
    formatDate: (value) => value || '',
    subscribeRealtime: () => () => {},
    request: async (_config, _surface, _token, action, payload) => {
      calls.push({ action, payload });
      if (action === 'user.member.bootstrap') {
        const bootstrapCount = calls.filter((call) => call.action === 'user.member.bootstrap').length;
        if (typeof options.bootstrapResult === 'function') return options.bootstrapResult(bootstrapCount);
        return { profile, terms, consentRequired };
      }
      if (action === 'user.member.terms.accept') {
        if (typeof options.termsAcceptResult === 'function') return options.termsAcceptResult(payload);
        return { profile, terms };
      }
      throw new Error(`Unexpected action: ${action}`);
    },
  };
  w.MembershipProgress = { render() {} };
  w.eval(app);
  w.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { dom, w, calls };
}

test('member page initializes and shows the latest terms to members who must reconsent', async () => {
  const { dom, w, calls } = await start(true);
  try {
    const get = (id) => w.document.getElementById(id);
    assert.equal(get('termsRenewView').classList.contains('hidden'), false);
    assert.equal(get('memberView').classList.contains('hidden'), true);
    assert.match(get('renewTermsSummary').textContent, /2026-10-v2/);
    assert.equal(get('renewTermsBody').textContent, '完整條款內容');

    get('renewTermsForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
    assert.match(get('renewTermsMessage').textContent, /請閱讀並同意/);
    assert.equal(calls.filter((call) => call.action === 'user.member.terms.accept').length, 0);

    get('renewTermsAccepted').checked = true;
    get('renewTermsForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), {
      action: 'user.member.terms.accept',
      payload: { termsId: 'terms-2', termsVersion: '2026-10-v2', accepted: true },
    });
    assert.equal(get('memberView').classList.contains('hidden'), false);
  } finally { dom.window.close(); }
});

test('reconsent preflight refreshes changed terms without silently accepting them', async () => {
  const latestTerms = {
    id: 'terms-3',
    version: '2026-11-v3',
    title: '最新條款',
    summary: '條款再次更新',
    body: '最新完整條款內容',
  };
  const { dom, w, calls } = await start(true, {
    bootstrapResult: (count) => count === 1
      ? { profile, terms, consentRequired: true }
      : { profile, terms: latestTerms, consentRequired: true },
    termsAcceptResult: () => ({ profile, terms: latestTerms, consentRequired: false }),
  });
  try {
    const get = (id) => w.document.getElementById(id);
    get('renewTermsAccepted').checked = true;
    get('renewTermsForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(calls.filter((call) => call.action === 'user.member.terms.accept').length, 0);
    assert.match(get('renewTermsSummary').textContent, /2026-11-v3/);
    assert.equal(get('renewTermsAccepted').checked, false);
    assert.match(get('renewTermsMessage').textContent, /已載入最新版本/);

    get('renewTermsAccepted').checked = true;
    get('renewTermsForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const accepts = calls.filter((call) => call.action === 'user.member.terms.accept');
    assert.equal(accepts.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(accepts[0].payload)), {
      termsId: 'terms-3',
      termsVersion: '2026-11-v3',
      accepted: true,
    });
    assert.equal(get('memberView').classList.contains('hidden'), false);
  } finally { dom.window.close(); }
});

test('member page initializes without showing the reconsent view when consent is current', async () => {
  const { dom, w } = await start(false);
  try {
    assert.equal(w.document.getElementById('memberView').classList.contains('hidden'), false);
    assert.equal(w.document.getElementById('termsRenewView').classList.contains('hidden'), true);
  } finally { dom.window.close(); }
});
