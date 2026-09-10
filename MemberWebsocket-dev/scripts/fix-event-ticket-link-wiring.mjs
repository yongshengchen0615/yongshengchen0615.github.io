import fs from 'node:fs';

function collapseDuplicate(path, tag) {
  const source = fs.readFileSync(path, 'utf8');
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:${escaped}\\s*){2,}`, 'g');
  const next = source.replace(pattern, `${tag}\n  `);
  const count = next.split(tag).length - 1;
  if (count !== 1) throw new Error(`${path}: expected exactly one activity-link script tag after cleanup, got ${count}`);
  fs.writeFileSync(path, next);
}

collapseDuplicate(
  'MemberWebsocket-dev/admin/index.html',
  '<script src="./event-ticket-activity-link.js?v=event-ticket-activity-link-20260911" defer></script>'
);
collapseDuplicate(
  'MemberWebsocket-dev/event/index.html',
  '<script src="./activity-link.js?v=event-ticket-activity-link-20260911" defer></script>'
);

console.log('event ticket activity link duplicate wiring cleaned');
