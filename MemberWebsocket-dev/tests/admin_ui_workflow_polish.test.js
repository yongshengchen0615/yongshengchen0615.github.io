const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const adminRoot = path.resolve(__dirname, '..', 'admin');
const css = fs.readFileSync(path.join(adminRoot, 'ui-workflow-polish.css'), 'utf8');
const loader = fs.readFileSync(path.join(adminRoot, 'booking-panel.js'), 'utf8');

test('admin workflow polish is wired for all five modules', () => {
  assert.match(loader, /loadStyle\('ui-workflow-polish\.css'/);
  for (const selector of ['#membersPanel', '#cardsPanel', '#eventsPanel', '#calendarPanel', '#bookingPanel']) {
    assert.ok(css.includes(selector), `missing workflow styles for ${selector}`);
  }
  assert.ok(css.includes('@media (max-width: 760px)'), 'mobile breakpoint missing');
  assert.ok(css.includes('.editor-actions'), 'editor action hierarchy missing');
});

test('admin workflow polish CSS has balanced braces', () => {
  let depth = 0;
  for (const char of css) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    assert.ok(depth >= 0, 'CSS contains an unmatched closing brace');
  }
  assert.equal(depth, 0, 'CSS contains unmatched braces');
});

test('mobile list selection guides users to the matching editor', () => {
  assert.ok(loader.includes('#cardListItems .card-list-item'));
  assert.ok(loader.includes('#ticketListItems .card-list-item'));
  assert.ok(loader.includes('#eventTicketListItems .card-list-item'));
  assert.ok(loader.includes('#calendarItemListItems .card-list-item'));
  assert.ok(loader.includes("scrollIntoView({ behavior: 'smooth', block: 'start' })"));
});
