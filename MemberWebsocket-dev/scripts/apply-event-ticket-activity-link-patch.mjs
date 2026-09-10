import fs from 'node:fs';

function replaceOnce(path, before, after) {
  const source = fs.readFileSync(path, 'utf8');
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Expected source not found in ${path}: ${before}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Expected unique source in ${path}: ${before}`);
  fs.writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length));
}

replaceOnce(
  'MemberWebsocket-dev/admin/index.html',
  '<script src="./grant-automation.js?v=grant-automation-20260910" defer></script>',
  '<script src="./grant-automation.js?v=grant-automation-20260910" defer></script>\n  <script src="./event-ticket-activity-link.js?v=event-ticket-activity-link-20260911" defer></script>'
);

replaceOnce(
  'MemberWebsocket-dev/event/index.html',
  '<script src="./app.js?v=supabase-native-20260910" defer></script>',
  '<script src="./activity-link.js?v=event-ticket-activity-link-20260911" defer></script>\n  <script src="./app.js?v=supabase-native-20260910" defer></script>'
);

console.log('event ticket activity link UI wiring patch applied');
