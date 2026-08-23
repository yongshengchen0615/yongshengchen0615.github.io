'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }

function fakeClassList(initial) {
  const values = new Set(initial || []);
  return {
    contains: (value) => values.has(value),
    add: (value) => values.add(value),
    remove: (value) => values.delete(value)
  };
}

function fakeElement(id, classes) {
  const attributes = {};
  const listeners = {};
  return {
    id,
    classList: fakeClassList(classes),
    hidden: false,
    tabIndex: 0,
    focused: false,
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null; },
    addEventListener(name, handler) { listeners[name] = handler; },
    focus() { this.focused = true; },
    dispatch(name, event) { if (listeners[name]) listeners[name](event || {}); }
  };
}

test('member ticket wallet uses separate accessible earned and upcoming tab panels', () => {
  const html = read('user/index.html');
  const css = read('user/ticket-tabs.css');
  const script = read('user/ticket-tabs.js');

  assert.match(html, /id="earnedTicketsTab"[^>]+role="tab"[^>]+aria-controls="earnedTicketGroup"/);
  assert.match(html, /id="upcomingTicketsTab"[^>]+role="tab"[^>]+aria-controls="upcomingTicketGroup"/);
  assert.match(html, /id="earnedTicketGroup"[^>]+role="tabpanel"[^>]+aria-labelledby="earnedTicketsTab"/);
  assert.match(html, /id="upcomingTicketGroup"[^>]+role="tabpanel"[^>]+aria-labelledby="upcomingTicketsTab"[^>]+hidden/);
  assert.match(html, /ticket-tabs\.css/);
  assert.match(html, /ticket-tabs\.js/);
  assert.match(css, /\.ticket-subtabs/);
  assert.match(css, /\.ticket-subtab\[aria-selected="true"\]/);
  assert.doesNotThrow(() => new vm.Script(script));
});

test('ticket subtab controller separates panels and falls back when upcoming tickets are unavailable', () => {
  const source = read('user/ticket-tabs.js');
  const earnedTab = fakeElement('earnedTicketsTab');
  const upcomingTab = fakeElement('upcomingTicketsTab');
  const earnedPanel = fakeElement('earnedTicketGroup');
  const upcomingPanel = fakeElement('upcomingTicketGroup');
  earnedTab.setAttribute('aria-selected', 'true');
  upcomingTab.setAttribute('aria-selected', 'false');

  let observerCallback = null;
  const elements = { earnedTicketsTab: earnedTab, upcomingTicketsTab: upcomingTab, earnedTicketGroup: earnedPanel, upcomingTicketGroup: upcomingPanel };
  const context = {
    document: {
      querySelectorAll: (selector) => selector === '[data-ticket-tab]' ? [earnedTab, upcomingTab] : [],
      getElementById: (id) => elements[id] || null
    },
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe() {}
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  assert.equal(earnedPanel.hidden, false);
  assert.equal(upcomingPanel.hidden, true);
  assert.equal(earnedTab.getAttribute('aria-selected'), 'true');

  upcomingTab.dispatch('click');
  assert.equal(earnedPanel.hidden, true);
  assert.equal(upcomingPanel.hidden, false);
  assert.equal(upcomingTab.getAttribute('aria-selected'), 'true');

  upcomingPanel.classList.add('hidden');
  observerCallback();
  assert.equal(upcomingTab.getAttribute('aria-disabled'), 'true');
  assert.equal(earnedTab.getAttribute('aria-selected'), 'true');
  assert.equal(earnedPanel.hidden, false);
  assert.equal(upcomingPanel.hidden, true);
});

test('ticket subtabs support keyboard navigation without changing ticket authorization logic', () => {
  const script = read('user/ticket-tabs.js');
  const app = read('user/app.js');
  assert.match(script, /ArrowLeft/);
  assert.match(script, /ArrowRight/);
  assert.match(script, /event\.key === 'Home'/);
  assert.match(script, /event\.key === 'End'/);
  assert.match(app, /PointsCard\.callApi\('reward\.claim'/);
  assert.doesNotMatch(script, /callApi\s*\(|reward\.claim|idToken|confirmationCode/);
});
