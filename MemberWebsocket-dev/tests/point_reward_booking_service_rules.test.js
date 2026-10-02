const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const offersModule = import(pathToFileURL(path.join(root, 'supabase/functions/_shared/latest-available-offers.ts')));

test('point-card booking service rules belong to reward nodes, not ticket templates', () => {
  const migration = read('supabase/migrations/20261002152109_move_point_ticket_service_rules_to_reward_nodes.sql');
  const adminHtml = read('admin/index.html');
  const adminApp = read('admin/app.js');
  const api = read('supabase/functions/api/index.ts');
  const benefits = read('supabase/functions/_shared/booking-benefits.ts');

  assert.match(migration, /alter table public\.point_card_rewards[\s\S]*required_service_types/);
  assert.match(migration, /join public\.point_card_rewards r on r\.id = pt\.reward_id/);
  assert.match(migration, /alter table public\.ticket_templates[\s\S]*drop column if exists required_service_types/);

  assert.doesNotMatch(adminHtml, /id="ticketRequiredServiceTypes"/);
  assert.match(adminApp, /此節點的預約項目限制/);
  assert.match(adminApp, /data\.rewardRequiredServiceTypes = 'true'/);
  assert.match(adminApp, /requiredServiceTypes: collectRequiredServiceTypes\(row\.querySelector\('\[data-reward-required-service-types\]'\)\)/);

  assert.match(api, /requiredServiceTypes: Array\.isArray\(reward\.required_service_types\)/);
  assert.match(api, /normalizeRequiredServiceTypes\(supabase,reward\.requiredServiceTypes\)/);
  assert.doesNotMatch(api, /normalizeRequiredServiceTypes\(supabase,ticket\.requiredServiceTypes\)/);

  assert.match(benefits, /offer\.requiredServiceTypes/);
  assert.doesNotMatch(benefits, /pointRequiredByTemplate/);
});

test('the same ticket template can have different booking rules at different point nodes', async () => {
  const { selectLatestPointOffers } = await offersModule;
  const rewards = [
    {
      id: 'reward-body',
      point_card_id: 'card-1',
      threshold_stamps: 5,
      ticket_template_id: 'template-1',
      required_service_types: ['身體'],
    },
    {
      id: 'reward-foot',
      point_card_id: 'card-1',
      threshold_stamps: 10,
      ticket_template_id: 'template-1',
      required_service_types: ['腳底'],
    },
  ];
  const cards = [{
    id: 'card-1',
    card_id: 'CARD',
    title: '身體集點卡',
    status: 'active',
    expiry_mode: 'unlimited',
    sort_order: 0,
  }];
  const templates = [{
    id: 'template-1',
    title: '共用優惠券',
    status: 'active',
  }];
  const tickets = [
    {
      ticket_id: 'PT-BODY',
      reward_id: 'reward-body',
      point_card_id: 'card-1',
      ticket_template_id: 'template-1',
      threshold_stamps: 5,
    },
    {
      ticket_id: 'PT-FOOT',
      reward_id: 'reward-foot',
      point_card_id: 'card-1',
      ticket_template_id: 'template-1',
      threshold_stamps: 10,
    },
  ];

  const offers = selectLatestPointOffers(rewards, cards, templates, tickets, '2026-10-02');
  assert.equal(offers.length, 2);
  assert.deepEqual(offers[0].requiredServiceTypes, ['身體']);
  assert.deepEqual(offers[1].requiredServiceTypes, ['腳底']);
  assert.equal(offers[0].ticketTemplateId, offers[1].ticketTemplateId);
});
