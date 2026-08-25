'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' must exist');
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error('unterminated function ' + name);
}

function adminCaseBlocks(source) {
  const doPost = functionSource(source, 'doPost');
  const matches = Array.from(doPost.matchAll(/^\s*case\s+['"](admin\.[^'"]+)['"]\s*:/gm));
  return matches.map((match, index) => ({
    action: match[1],
    body: doPost.slice(
      match.index + match[0].length,
      index + 1 < matches.length ? matches[index + 1].index : doPost.indexOf('\n      default:', match.index)
    )
  }));
}

function assertEveryAdminRouteIsGuarded(relative, guardPattern) {
  const blocks = adminCaseBlocks(read(relative));
  assert.ok(blocks.length > 0, relative + ' must expose admin routes');
  for (const block of blocks) {
    const guard = block.body.search(guardPattern);
    const serviceCall = block.body.search(/(?:return\s+json_|data\s*=\s*handleAdmin)/);
    assert.ok(guard >= 0, block.action + ' must perform server-side admin authorization');
    assert.ok(serviceCall >= 0, block.action + ' must dispatch an admin service operation');
    assert.ok(guard < serviceCall, block.action + ' must authorize before dispatch');
  }
  return blocks.map((block) => block.action);
}

test('every Membership and Points admin action is server-authorized before dispatch', () => {
  const membershipActions = assertEveryAdminRouteIsGuarded(
    'modules/membership/gas/Code.gs',
    /\brequireAdmin_\(context\);/
  );
  const pointsActions = assertEveryAdminRouteIsGuarded(
    'modules/points/gas/Code.gs',
    /\brequireAdmin_\(context\);/
  );

  assert.ok(membershipActions.length >= 10, 'Membership admin route coverage unexpectedly shrank');
  assert.ok(pointsActions.length >= 20, 'Points admin route coverage unexpectedly shrank');
});

test('every Calendar admin action is server-authorized before dispatch', () => {
  const actions = assertEveryAdminRouteIsGuarded(
    'modules/calendar/gas/Code.gs',
    /\bconst\s+admin\s*=\s*authorizeAdmin_\(identity\);/
  );
  assert.ok(actions.length >= 7, 'Calendar admin route coverage unexpectedly shrank');

  const doPost = functionSource(read('modules/calendar/gas/Code.gs'), 'doPost');
  assert.match(doPost, /const clientType = clientTypeForAction_\(action\);/);
  assert.match(doPost, /authenticateLine_\(request\.idToken, clientType\)/);
  assert.match(doPost, /if \(clientType === 'user'\) requireMemberHubAccess_\(identity\.lineUserId\);/);
});

test('membership tiers and member access gates cannot grant module administration', () => {
  const membership = read('modules/membership/gas/Code.gs');
  const points = read('modules/points/gas/Code.gs');
  const calendarAuth = read('modules/calendar/gas/Auth.gs');

  const authorizationFunctions = [
    functionSource(membership, 'requireAdmin_'),
    functionSource(membership, 'isAdmin_'),
    functionSource(points, 'requireAdmin_'),
    functionSource(calendarAuth, 'authorizeAdmin_')
  ].join('\n');
  assert.doesNotMatch(authorizationFunctions, /\btier\b/i);
  assert.match(functionSource(membership, 'isAdmin_'), /canManageMembers/);
  assert.match(functionSource(points, 'requireAdmin_'), /canManagePoints/);
  assert.match(functionSource(calendarAuth, 'authorizeAdmin_'), /role\s*!==\s*'admin'/);

  assert.doesNotMatch(functionSource(membership, 'internalMemberAccessCheck_'), /\b(?:tier|canManageMembers|requireAdmin_)\b/i);
  assert.doesNotMatch(functionSource(points, 'isPointsMemberAction_'), /admin\./);
});
