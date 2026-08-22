'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '../admin/point-grant.js'), 'utf8');

test('point grant cancel controls bypass required-field validation', () => {
  assert.match(source, /close\.type = 'button'/);
  assert.match(source, /cancel\.type = 'button'/);
  assert.match(source, /close\.addEventListener\('click', function \(\) \{ dialog\.close\('cancel'\); \}\)/);
  assert.match(source, /cancel\.addEventListener\('click', function \(\) \{ dialog\.close\('cancel'\); \}\)/);
  assert.doesNotMatch(source, /close\.type = 'submit'/);
  assert.doesNotMatch(source, /cancel\.type = 'submit'/);
});

test('only the explicit grant action invokes the point-grant API', () => {
  assert.match(source, /submit\.type = 'button'/);
  assert.match(source, /submit\.addEventListener\('click', submitPointGrant\)/);
  assert.match(source, /PointsCard\.callApi\('admin\.points\.grant'/);
  const cancelHandler = source.match(/cancel\.addEventListener\('click',[\s\S]*?\);/);
  assert.ok(cancelHandler, 'missing cancel handler');
  assert.doesNotMatch(cancelHandler[0], /submitPointGrant|callApi|pointGrantReason/);
});
