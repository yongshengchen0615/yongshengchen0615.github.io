(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MemberE2EActivityEvidence = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const array = value => Array.isArray(value) ? value : [];
  const RULES = Object.freeze({
    POINTS_HUMAN_REDEEM: {
      type: 'point_ticket_redeemed',
      verify: records => array(records.pointCards).some(row =>
        row.recordType === 'point_ticket' && Boolean(row.usedAt))
    },
    EVENT_HUMAN_LIFECYCLE: {
      type: 'event_tickets_redeemed',
      verify: records => array(records.eventTickets).filter(row => Boolean(row.usedAt)).length >= 2
    },
    BOOKING_HUMAN_LIFECYCLE: {
      type: 'booking_created_and_updated',
      verify: records => array(records.bookings).some(row =>
        /^QA HUMAN E2E (?!GROUP |BENEFIT )/i.test(String(row.memberNote || '')) && Boolean(row.bookingId))
    },
    BOOKING_HUMAN_GROUP: {
      type: 'group_booking_created',
      verify: records => array(records.bookings).some(row =>
        /^QA HUMAN E2E GROUP /i.test(String(row.memberNote || '')) && Number(row.partySize) >= 2)
    },
    BOOKING_BENEFIT_REDEMPTION_LIFECYCLE: {
      type: 'booking_benefit_reserved',
      verify: records => array(records.bookings).some(row =>
        /^QA HUMAN E2E BENEFIT /i.test(String(row.memberNote || '')) && Boolean(row.bookingId))
    }
  });

  function inspect(history, runCodes) {
    const records = history && history.records && typeof history.records === 'object' ? history.records : {};
    const requested = [...new Set(array(runCodes).filter(code => typeof code === 'string' && code.trim()).map(code => code.trim()))];
    const allCases = array(records.testAutomation);
    const matched = allCases.filter(row => requested.includes(String(row.runCode || '')));
    const found = new Set(matched.map(row => String(row.runCode || '')));
    const missingRunCodes = requested.filter(code => !found.has(code));
    const rejectedCases = matched.filter(row => row.status !== 'passed' || row.runStatus !== 'passed')
      .map(row => ({caseKey:String(row.caseKey || ''),status:String(row.status || ''),runStatus:String(row.runStatus || '')}));
    const observedActions = [];
    const missingActions = [];
    const verifiedKeys = new Set();
    for (const row of matched) {
      if (row.status !== 'passed' || verifiedKeys.has(row.caseKey)) continue;
      const rule = RULES[row.caseKey];
      if (!rule) continue;
      verifiedKeys.add(row.caseKey);
      (rule.verify(records) ? observedActions : missingActions).push({caseKey:row.caseKey,type:rule.type});
    }
    const observedCounts = {
      pointCards: array(records.pointCards).length,
      eventTickets: array(records.eventTickets).length,
      bookings: array(records.bookings).length,
      presence: array(records.presence).length,
      testAutomation: allCases.length
    };
    return {
      ok: requested.length > 0 && matched.length > 0 && !missingRunCodes.length &&
        !rejectedCases.length && !missingActions.length,
      evidenceLevel: !missingRunCodes.length && !rejectedCases.length && !missingActions.length && observedActions.length
        ? 'business-record-verified' : 'case-record-only-or-incomplete',
      runCount: requested.length, matchedCaseCount: matched.length, missingRunCodes,
      rejectedCases, observedActions, missingActions, observedCounts
    };
  }
  return {inspect};
});
