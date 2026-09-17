const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const responsiveVersion = '20260914-line-form-1';

const entryPages = [
  'index.html',
  'admin/index.html',
  'member/index.html',
  'points/index.html',
  'event/index.html',
  'calendar/index.html',
  'booking/index.html',
  'booking/admin/index.html',
];

test('all application entry pages reference the current shared responsive asset', () => {
  for (const relativePath of entryPages) {
    const html = fs.readFileSync(path.join(root, relativePath), 'utf8');
    const expected = relativePath === 'index.html'
      ? `responsive.css?v=${responsiveVersion}`
      : `responsive.css?v=${responsiveVersion}`;
    assert.ok(html.includes(expected), `${relativePath} must load ${expected}`);
  }
});

test('admin entry references current assets that changed after older cache keys', () => {
  const html = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
  assert.ok(html.includes('calendar-responsive.css?v=calendar-responsive-20260914-mobile-fit-2'));
  assert.ok(html.includes('calendar-date-fix.css?v=20260914-line-date-1'));
  assert.ok(html.includes('common.js?v=admin-fresh-login-20260917-1'));
  assert.ok(html.includes('app.js?v=admin-fresh-login-20260917-1'));
  assert.ok(html.includes('booking-panel.js?v=booking-toggle-removal-20260917-3'));
  assert.ok(html.includes(`../responsive.css?v=${responsiveVersion}`));
  assert.doesNotMatch(html, /calendar-responsive\.css\?v=calendar-responsive-20260910-1/);
  assert.doesNotMatch(html, /common\.js\?v=supabase-native-booking-20260910-1/);
  assert.doesNotMatch(html, /booking-panel\.js\?v=responsive-controls-20260914-1/);
  assert.doesNotMatch(html, /booking-panel\.js\?v=booking-duration-consistency-20260911-4/);
});

test('booking entry points bust caches for participant-parity assets', () => {
  const memberHtml = fs.readFileSync(path.join(root, 'booking/index.html'), 'utf8');
  const bookingAdminHtml = fs.readFileSync(path.join(root, 'booking/admin/index.html'), 'utf8');
  const adminLoader = fs.readFileSync(path.join(root, 'admin/booking-panel.js'), 'utf8');
  const groupCss = fs.readFileSync(path.join(root, 'booking/group-booking.css'), 'utf8');
  const groupJs = fs.readFileSync(path.join(root, 'booking/group-booking.js'), 'utf8');

  assert.ok(memberHtml.includes('group-booking.css?v=booking-participant-parity-20260917-1'));
  assert.ok(memberHtml.includes('group-booking.js?v=booking-participant-parity-20260917-1'));
  assert.ok(bookingAdminHtml.includes('resources.js?v=booking-primary-tech-20260917-2'));
  assert.ok(adminLoader.includes("loadStyle('booking-resources.css', 'booking-primary-tech-20260917-3')"));
  assert.ok(adminLoader.includes("load('booking-resources.js', 'booking-primary-tech-20260917-3')"));
  assert.match(groupCss, /\.participant-service-stack\{[^}]*display:grid/);
  assert.match(groupCss, /\.group-selection-summary\{[^}]*display:grid/);
  assert.match(groupJs, /className = 'service-add-button'/);
  assert.match(groupJs, /className = 'selected-service-remove'/);
  assert.doesNotMatch(groupJs, /input\.type = 'checkbox'/);
  assert.match(groupJs, /reduce\(\(max, item\) => Math\.max\(max, item\.totalMinutes\), 0\)/);
  assert.match(groupJs, /總服務時間：\$\{overallMinutes\}分鐘/);
  assert.match(groupJs, /總金額：\$\{formatMoney\(overallAmount\)\}/);
});

test('calendar date fix keeps native date inputs shrinkable in LINE WebView', () => {
  const css = fs.readFileSync(path.join(root, 'admin/calendar-date-fix.css'), 'utf8');
  assert.match(css, /#calendarEditorModal input\[type="date"\][\s\S]*?width:\s*100%\s*!important/);
  assert.match(css, /min-inline-size:\s*0\s*!important/);
  assert.match(css, /::-webkit-datetime-edit-fields-wrapper/);
  assert.match(css, /::-webkit-calendar-picker-indicator/);
  assert.match(css, /@supports\s*\(-webkit-touch-callout:\s*none\)/);
});
