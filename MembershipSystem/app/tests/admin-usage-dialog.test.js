'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('usage QR detail close controls bypass required-field validation', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../admin/index.html'), 'utf8');

  assert.match(
    html,
    /id="usageDialogCloseButton"[^>]*type="submit"[^>]*value="cancel"[^>]*formnovalidate/
  );
  assert.match(
    html,
    /id="usageDialogFooterCloseButton"[^>]*type="submit"[^>]*value="cancel"[^>]*formnovalidate/
  );
  assert.match(html, /<form id="usageForm" method="dialog">/);
});
