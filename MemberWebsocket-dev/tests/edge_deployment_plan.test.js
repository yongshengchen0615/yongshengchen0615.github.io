const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { deploymentPlan } = require('../scripts/edge-deployment-plan.cjs');
const root = path.resolve(__dirname, '../supabase/functions');

test('service requirement changes redeploy every transitive ticket consumer', () => {
  const plan = deploymentPlan(root, ['_shared/latest-available-offers.ts']);
  assert.deepEqual(plan.map(row => row.slug), ['api', 'booking-admin-operations', 'booking-receipt-api', 'grant-automation', 'scheduled-grant-messages']);
  assert.ok(plan.find(row => row.slug === 'booking-admin-operations').files.includes('_shared/booking-benefits.ts'));
});

test('artifact authorization is bundled together with the canonical identity contract', () => {
  const plan = deploymentPlan(root, ['_shared/auth-contract.ts']);
  assert.ok(plan.some(row => row.slug === 'e2e-artifact-api'));
  assert.ok(plan.some(row => row.slug === 'booking-group-details-api'));
  assert.deepEqual(deploymentPlan(root, ['e2e-artifact-api/index.ts']).map(row => row.slug), ['e2e-artifact-api']);
  assert.deepEqual(deploymentPlan(root, ['not-a-function.txt']), []);
});

test('deployment planning follows cyclic reexports and rejects missing bundle files', () => {
  const dir = fs.mkdtempSync(path.join(__dirname, 'edge-plan-'));
  try {
    fs.mkdirSync(path.join(dir, 'api')); fs.mkdirSync(path.join(dir, '_shared'));
    fs.writeFileSync(path.join(dir, 'api/index.ts'), "import '../_shared/a.js';");
    fs.writeFileSync(path.join(dir, '_shared/a.js'), "export {value} from './b.js';");
    fs.writeFileSync(path.join(dir, '_shared/b.js'), "import './a.js'; export const value = 1;");
    assert.equal(deploymentPlan(dir, ['_shared/b.js']).length, 1);
    fs.unlinkSync(path.join(dir, '_shared/b.js'));
    assert.throws(() => deploymentPlan(dir, ['_shared/a.js']), /ENOENT/);
    fs.writeFileSync(path.join(dir, '_shared/a.js'), "import '../../escape.js';");
    assert.throws(() => deploymentPlan(dir, ['_shared/a.js']), /escapes functions root/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
