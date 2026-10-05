#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Edge Functions bundle their relative imports at deployment time. A changed
// shared dependency therefore requires redeploying every importing entrypoint.
function deploymentPlan(root, changedFiles) {
  root = path.resolve(root);
  const changed = new Set(changedFiles.map(file => path.resolve(root, file)));
  const imports = new Map();
  function dependencies(file, visited = new Set()) {
    if (visited.has(file)) return visited;
    if (!file.startsWith(root + path.sep)) throw new Error('Import escapes functions root: ' + file);
    visited.add(file);
    if (!imports.has(file)) {
      const source = fs.readFileSync(file, 'utf8');
      const relative = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g)]
        .map(match => path.resolve(path.dirname(file), match[1]));
      imports.set(file, relative);
    }
    for (const dependency of imports.get(file)) dependencies(dependency, visited);
    return visited;
  }
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('_') && fs.existsSync(path.join(root, entry.name, 'index.ts')))
    .map(entry => {
      const files = [...dependencies(path.join(root, entry.name, 'index.ts'))];
      return { slug: entry.name, changedDependencies: files.filter(file => changed.has(file)).map(file => path.relative(root, file)).sort(),
        files: files.map(file => path.relative(root, file)).sort() };
    })
    .filter(entry => entry.changedDependencies.length)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

if (require.main === module) {
  if (!process.argv.slice(2).length) {
    process.stderr.write('Usage: node edge-deployment-plan.cjs <files relative to supabase/functions>\n');
    process.exitCode = 1;
  } else {
    const root = path.resolve(__dirname, '../supabase/functions');
    process.stdout.write(JSON.stringify(deploymentPlan(root, process.argv.slice(2)), null, 2) + '\n');
  }
}
module.exports = { deploymentPlan };
