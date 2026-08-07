const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const repositoryRoot = path.resolve(root, "..");
const htmlFiles = [
  "index.html",
  "setup.html",
  "client/index.html",
  "client/lottery.html",
  "client/privacy.html",
  "admin/index.html",
  "admin/points.html",
  "admin/lottery.html",
];
const applicationPages = [
  "client/index.html",
  "client/lottery.html",
  "admin/index.html",
  "admin/points.html",
  "admin/lottery.html",
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("all HTML documents expose a consistent metadata and language baseline", () => {
  for (const relativePath of htmlFiles) {
    const html = read(relativePath);
    assert.match(html, /<html\s+lang=["']zh-Hant["']/i, `${relativePath}: lang`);
    assert.match(html, /<meta\s+name=["']viewport["']/i, `${relativePath}: viewport`);
    assert.match(html, /<meta\s+name=["']description["']/i, `${relativePath}: description`);
    assert.match(html, /<meta\s+name=["']referrer["']\s+content=["']no-referrer["']/i, `${relativePath}: referrer`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${relativePath}: inline event handler`);
  }
});

test("interactive pages provide progressive fallback and deferred external scripts", () => {
  for (const relativePath of applicationPages) {
    const html = read(relativePath);
    assert.match(html, /<noscript>[\s\S]*role=["']alert["']/i, `${relativePath}: noscript`);
    for (const match of html.matchAll(/<script\b([^>]*)\bsrc=["'][^"']+["']([^>]*)>/gi)) {
      assert.match(`${match[1]} ${match[2]}`, /\bdefer\b/i, `${relativePath}: non-deferred script`);
    }
  }
});

test("member home defers Lottery V2 internals behind the lazy facade", () => {
  const html = read("client/index.html");
  const loader = read("client/member-lottery-loader.js");
  assert.match(html, /src=["']member-lottery-loader\.js["']/);
  assert.doesNotMatch(html, /src=["']\.\.\/shared\/lottery-wheel\.js["']/);
  assert.match(loader, /["']\.\.\/shared\/lottery-wheel\.js["']/);
  assert.doesNotMatch(html, /src=["']member-lottery-v2\.js["']/);
  assert.doesNotMatch(html, /src=["']lottery\/(?:contracts|draw-service|dialog-controller)\.js["']/);
  assert.match(loader, /"member-lottery-v2\.js"/);
  assert.match(loader, /"lottery\/draw-service\.js"/);
  assert.match(loader, /"lottery\/dialog-controller\.js"/);
  assert.doesNotMatch(html, /src=["']member-lottery\.js["']/);
  assert.doesNotMatch(html, /wheel-draw-guard/);
});

test("client runtime optimization layer is progressive and data-aware", () => {
  const html = read("client/index.html");
  const css = read("client/runtime-optimizations.css");
  assert.match(html, /href=["']runtime-optimizations\.css["']/);
  assert.match(css, /@supports\s*\(content-visibility:\s*auto\)/i);
  assert.match(css, /contain-intrinsic-size:/i);
  assert.match(css, /@media\s*\(prefers-reduced-data:\s*reduce\)/i);
  assert.match(css, /backdrop-filter:\s*none/i);
});

test("styles include no-script, reduced-motion, and large-list containment safeguards", () => {
  const clientStyles = read("client/styles.css");
  const adminStyles = read("admin/styles.css");
  for (const [name, css] of [["client", clientStyles], ["admin", adminStyles]]) {
    assert.match(css, /\.noscript-notice\s*\{/i, `${name}: noscript style`);
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/i, `${name}: reduced motion`);
    assert.match(css, /contain:\s*layout\s+paint/i, `${name}: list containment`);
    assert.match(css, /scrollbar-gutter:\s*stable/i, `${name}: stable scrollbar`);
  }
});

test("repository workflows validate without pushing application code", () => {
  for (const relativePath of [
    ".github/workflows/validate-personal-brand-lottery.yml",
    ".github/workflows/validate-personal-brand-project.yml",
  ]) {
    const workflow = fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
    assert.match(workflow, /permissions:[\s\S]*contents:\s*read/);
    assert.doesNotMatch(workflow, /contents:\s*write/);
    assert.doesNotMatch(workflow, /git\s+push/);
  }
});
