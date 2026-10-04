export function summarizeE2EExecution(cases) {
  const rows = Array.isArray(cases) ? cases : [];
  const passed = rows.filter(row => row.status === 'passed').length;
  const failed = rows.filter(row => row.status === 'failed').length;
  const skipped = rows.filter(row => row.status === 'skipped').length;
  const complete = rows.length > 0 && passed === rows.length;
  return { coverageKind:'registered-node-execution', coverageComplete:complete,
    verificationStatus:failed ? 'failed' : complete ? 'passed' : 'incomplete',
    executedCases:passed + failed, skippedCases:skipped };
}

export async function prepareE2EServiceRuleFixtures(supabase, fixture) {
  const tag = String(fixture?.runTag || '');
  const createdBy = String(fixture?.createdBy || '');
  if (!/^[A-Z0-9_-]{4,40}$/.test(tag) || createdBy !== 'qa:e2e:' + tag.toLowerCase()) {
    throw new Error('E2E_FIXTURE_PROVENANCE_INVALID');
  }
  const services = await supabase.from('booking_services').select('id').eq('created_by',createdBy)
    .eq('is_active',true).eq('requires_companion_service',false).order('duration_minutes').limit(2);
  if (services.error || services.data?.length !== 2) throw new Error('E2E_RULE_SERVICES_MISSING');
  const ids = services.data.map(row => row.id);
  const inserted = await supabase.from('event_tickets').insert(['any','all'].map(mode => ({
    event_ticket_id:'QA-EVT-' + tag + '-RULE-' + mode.toUpperCase(),
    title:'E2E QA 服務限定 ' + mode + ' ' + tag, ticket_type:'coupon',
    description:'驗證具體服務項目 ' + mode + ' 限制。', usage_method:'僅供測試帳號預約驗證。',
    usage_instructions:'未預約符合的具體服務項目時不得勾選。',prizes:[],status:'active',
    starts_on:fixture.today,ends_on:null,quota:0,accent:'#3D7A69',
    allowed_tier_keys:['general','silver','gold','platinum'],
    required_service_ids:ids,required_service_match_mode:mode,created_by:createdBy,updated_by:createdBy
  })));
  if (inserted.error) throw new Error('E2E_RULE_TICKETS_PREPARE_FAILED');
  return {serviceRuleTickets:2,serviceRuleModes:['any','all']};
}
