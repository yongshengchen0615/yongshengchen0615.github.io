const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('snapshot receipt selection has a clear accessible ticket count and booking context', () => {
  const source = read('booking/booking-receipt.js');
  assert.match(source, /id="snapshotTicketChoices" role="group" aria-label="選擇本次要登記使用的票券"/);
  assert.match(source, /id="snapshotTicketSelectionSummary"[^>]*role="status" aria-live="polite"/);
  assert.match(source, /const selectionSummary = document\.getElementById\('snapshotTicketSelectionSummary'\)/);
  assert.match(source, /selected\.length \+ ' 張票券/);
  assert.match(source, /select\.closest\('label'\)\?\.classList\.toggle\('hidden', selected\.length === 0\)/);
  assert.match(source, /id="snapshotTicketBookingHelp"/);
});

test('snapshot ticket cards preserve original choice payload and disabled business rules', () => {
  const source = read('booking/booking-receipt.js');
  assert.match(source, /check\.type = 'checkbox'/);
  assert.match(source, /check\.dataset\.snapshotKind = item\.kind/);
  assert.match(source, /check\.dataset\.snapshotId = item\.selectionId/);
  assert.match(source, /item\.selectable !== true \|\| \(catalog\.ticketBookingRequired && !item\.eligibleBookings\?\.length\)/);
  assert.match(source, /check\.disabled = blocked/);
  assert.match(source, /item\.disabledReason/);
  assert.match(source, /label\.classList\.toggle\('is-selected', check\.checked\)/);
  assert.match(source, /indicator\.textContent = check\.checked \? '已選擇' : '點選使用'/);
  assert.match(source, /resetTicketRequest\(\);\s*renderBookings\(\);/);
  assert.match(source, /const selectedBenefits = state\.accessible \? \[\.\.\.document\.querySelectorAll\('\[data-snapshot-id\]:checked'\)\]/);
  assert.match(source, /requestedBookingId = state\.accessible/);
  assert.match(source, /user\.booking\.receipt\.prepare/);
  assert.doesNotMatch(source, /item\.title\s*\+\s*'<|innerHTML\s*=\s*item\./);
});

test('snapshot ticket cards respect responsive theme and remain native checkboxes', () => {
  const css = read('booking/booking-receipt.css');
  const html = read('booking/index.html');
  assert.match(css, /#snapshotTicketChoices \.snapshot-ticket-choice\.is-selected/);
  assert.match(css, /#snapshotTicketChoices \.snapshot-ticket-choice\.is-unavailable/);
  assert.match(css, /#snapshotTicketChoices \.snapshot-ticket-choice:focus-within/);
  assert.match(css, /#snapshotTicketChoices \.snapshot-ticket-checkbox/);
  assert.match(css, /var\(--theme-surface-raised/);
  assert.match(css, /var\(--theme-positive-soft/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(html, /booking-receipt\.css\?v=[^" ]*snapshot-ticket-ui-20261010-1/);
  assert.match(html, /booking-receipt\.js\?v=[^" ]*snapshot-ticket-ui-20261010-1/);
});
