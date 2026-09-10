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

replaceOnce(
  '.github/workflows/test-memberwebsocket-dev.yml',
  '          node --check MemberWebsocket-dev/admin/grant-automation.js\n',
  '          node --check MemberWebsocket-dev/admin/grant-automation.js\n          node --check MemberWebsocket-dev/admin/event-ticket-activity-link.js\n'
);

replaceOnce(
  '.github/workflows/test-memberwebsocket-dev.yml',
  '          node --check MemberWebsocket-dev/event/app.js\n',
  '          node --check MemberWebsocket-dev/event/app.js\n          node --check MemberWebsocket-dev/event/activity-link.js\n'
);

replaceOnce(
  '.github/workflows/test-memberwebsocket-dev.yml',
  '          deno check MemberWebsocket-dev/supabase/functions/grant-automation/index.ts\n',
  '          deno check MemberWebsocket-dev/supabase/functions/grant-automation/index.ts\n          deno check MemberWebsocket-dev/supabase/functions/event-ticket-links/index.ts\n'
);

replaceOnce(
  '.github/workflows/test-memberwebsocket-dev.yml',
  "          grep -q 'supabaseGrantAutomationUrl' MemberWebsocket-dev/config.json\n",
  "          grep -q 'supabaseGrantAutomationUrl' MemberWebsocket-dev/config.json\n          grep -q 'event-ticket-activity-link.js' MemberWebsocket-dev/admin/index.html\n          grep -q 'activity-link.js' MemberWebsocket-dev/event/index.html\n          grep -q 'activity_url' MemberWebsocket-dev/supabase/migrations/20260910175251_add_event_ticket_activity_url.sql\n          node MemberWebsocket-dev/tests/event_ticket_activity_link.test.js\n"
);

console.log('event ticket activity link wiring patch applied');
