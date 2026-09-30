const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'admin', 'terms.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'admin', 'terms.js'), 'utf8');

test('admin membership terms UI keeps the legal workflow wiring intact', () => {
  for (const id of [
    'termsVersionList',
    'termsDraftForm',
    'termsVersion',
    'termsTitle',
    'termsSummary',
    'termsBody',
    'termsEffectiveAt',
    'termsRequired',
    'termsReconsent',
    'termsSave',
    'termsActivate',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.match(js, /admin\.terms\.list/);
  assert.match(js, /admin\.terms\.draft\.save/);
  assert.match(js, /admin\.terms\.activate/);
  assert.doesNotMatch(js, /innerHTML\s*=/);
});

test('admin membership terms UI exposes status overview and safe publishing guidance', () => {
  assert.match(html, /class="terms-status-overview"/);
  assert.match(html, /id="termsActiveVersion"/);
  assert.match(html, /id="termsDraftCount"/);
  assert.match(html, /id="termsVersionCount"/);
  assert.match(html, /id="termsEditorState"/);
  assert.match(html, /id="termsReadonlyNote"/);
  assert.match(html, /id="termsReconsentNote"/);
  assert.match(html, /儲存草稿[\s\S]*確認[\s\S]*啟用|儲存草稿 →/);
  assert.match(js, /既有會員下次進入時會被要求重新同意新版條款/);
});

test('admin membership terms UI renders structured version cards without changing stored content', () => {
  assert.match(js, /document\.createElement\('button'\)/);
  assert.match(js, /terms-version-card-top/);
  assert.match(js, /terms-status-badge/);
  assert.match(js, /terms-version-title/);
  assert.match(js, /terms-version-meta/);
  assert.match(js, /textContent = row\.title/);
  assert.match(js, /textContent = row\.version/);
});

test('admin membership terms UI is theme-aware and responsive', () => {
  assert.match(css, /html\[data-theme\][\s\S]*\.terms-status-card/);
  assert.match(css, /html\[data-theme="dark"\][\s\S]*\.terms-version-list/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.terms-admin-grid/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.terms-actions/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('admin terms assets use the same UI cache version', () => {
  assert.match(html, /terms\.css\?v=membership-terms-ui-20260930-1/);
  assert.match(html, /terms\.js\?v=membership-terms-ui-20260930-1/);
});
