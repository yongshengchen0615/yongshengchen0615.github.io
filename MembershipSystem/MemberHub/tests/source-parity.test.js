'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const membershipSystemRoot = path.resolve(__dirname, '..', '..');

const modules = [
  {
    name: 'Calendar',
    source: path.join(membershipSystemRoot, 'CalendarSystem'),
    target: path.join(membershipSystemRoot, 'MemberHub', 'modules', 'calendar')
  },
  {
    name: 'Points',
    source: path.join(membershipSystemRoot, 'PointsCard'),
    target: path.join(membershipSystemRoot, 'MemberHub', 'modules', 'points')
  },
  {
    name: 'Membership',
    source: path.join(membershipSystemRoot, 'app'),
    target: path.join(membershipSystemRoot, 'MemberHub', 'modules', 'membership')
  }
];

const excludedNames = new Set(['ARCHITECTURE.md', 'README.md', 'package-lock.json', 'package.json']);
const declarationRelocations = new Set([
  'Calendar:admin/user-access.js:loadConfig'
]);

function sourceFiles(root) {
  const result = [];
  function visit(directory, relativeDirectory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'tests') visit(path.join(directory, entry.name), relative);
      } else if (!excludedNames.has(entry.name)) {
        result.push(relative);
      }
    }
  }
  visit(root, '');
  return result.sort();
}

function declarations(source) {
  const names = new Set();
  const patterns = [
    /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm,
    /^\s*class\s+([A-Za-z_$][\w$]*)\b/gm,
    /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/gm
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  return names;
}

function quotedValues(source, pattern) {
  return new Set(Array.from(source.matchAll(pattern), (match) => match[1]));
}

function missingValues(expected, actual) {
  return Array.from(expected).filter((value) => !actual.has(value)).sort();
}

for (const module of modules) {
  test(module.name + ' source contracts remain represented in MemberHub', () => {
    const files = sourceFiles(module.source);
    const missingFiles = files.filter((relative) => !fs.existsSync(path.join(module.target, relative)));
    assert.deepEqual(missingFiles, [], module.name + ' source files missing from MemberHub');

    const targetDeclarations = new Set();
    for (const relative of files.filter((file) => /\.(?:gs|js)$/.test(file))) {
      for (const name of declarations(fs.readFileSync(path.join(module.target, relative), 'utf8'))) {
        targetDeclarations.add(name);
      }
    }
    for (const relative of files.filter((file) => /\.(?:gs|js)$/.test(file))) {
      const source = fs.readFileSync(path.join(module.source, relative), 'utf8');
      const target = fs.readFileSync(path.join(module.target, relative), 'utf8');
      const missing = missingValues(declarations(source), declarations(target)).filter((name) => {
        const relocated = declarationRelocations.has(module.name + ':' + relative + ':' + name);
        return !relocated || !targetDeclarations.has(name);
      });
      assert.deepEqual(
        missing,
        [],
        module.name + '/' + relative + ' is missing declared functions or classes'
      );
    }

    for (const relative of files.filter((file) => /\.html$/.test(file))) {
      const source = fs.readFileSync(path.join(module.source, relative), 'utf8');
      const target = fs.readFileSync(path.join(module.target, relative), 'utf8');
      assert.deepEqual(
        missingValues(
          quotedValues(source.replace(/<!--[\s\S]*?-->/g, ''), /\bid=["']([^"']+)["']/g),
          quotedValues(target.replace(/<!--[\s\S]*?-->/g, ''), /\bid=["']([^"']+)["']/g)
        ),
        [],
        module.name + '/' + relative + ' is missing HTML controls'
      );
    }

    for (const relative of files.filter((file) => /\.css$/.test(file))) {
      assert.equal(
        fs.readFileSync(path.join(module.target, relative), 'utf8'),
        fs.readFileSync(path.join(module.source, relative), 'utf8'),
        module.name + '/' + relative + ' styling has drifted from the source system'
      );
    }

    const sourceCode = fs.readFileSync(path.join(module.source, 'gas', 'Code.gs'), 'utf8');
    const targetCode = fs.readFileSync(path.join(module.target, 'gas', 'Code.gs'), 'utf8');
    assert.deepEqual(
      missingValues(
        quotedValues(sourceCode, /^\s*case\s+["']([^"']+)["']\s*:/gm),
        quotedValues(targetCode, /^\s*case\s+["']([^"']+)["']\s*:/gm)
      ),
      [],
      module.name + ' GAS actions missing from MemberHub'
    );
  });
}
