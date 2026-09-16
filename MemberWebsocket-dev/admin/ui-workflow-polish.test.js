const fs = require('fs');
const path = require('path');

const root = __dirname;
const css = fs.readFileSync(path.join(root, 'ui-workflow-polish.css'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'booking-panel.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(loader.includes("loadStyle('ui-workflow-polish.css'"), 'workflow polish stylesheet must be loaded');
assert(css.includes('#membersPanel'), 'member module styles missing');
assert(css.includes('#cardsPanel'), 'points card module styles missing');
assert(css.includes('#eventsPanel'), 'event ticket module styles missing');
assert(css.includes('#calendarPanel'), 'calendar module styles missing');
assert(css.includes('#bookingPanel'), 'booking module styles missing');
assert(css.includes('@media (max-width: 760px)'), 'mobile breakpoint missing');
assert(css.includes('.editor-actions'), 'editor action hierarchy missing');

let depth = 0;
for (const char of css) {
  if (char === '{') depth += 1;
  if (char === '}') depth -= 1;
  assert(depth >= 0, 'CSS contains an unmatched closing brace');
}
assert(depth === 0, 'CSS contains unmatched braces');

console.log('admin workflow polish wiring: PASS');
