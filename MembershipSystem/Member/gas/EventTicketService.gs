'use strict';

const EVENT_TICKET_TYPES_ = Object.freeze(['coupon', 'lottery']);
const EVENT_TICKET_STATUSES_ = Object.freeze(['active', 'draft', 'archived']);
const EVENT_TICKET_MAX_PRIZES_ = 30;
const EVENT_TICKET_MAX_QUOTA_ = 1000000;
const EVENT_TICKET_RATE_BASIS_POINTS_ = 10000;
const EVENT_TICKET_STATUS_AVAILABLE_ = 'available';
const EVENT_TICKET_STATUS_USED_ = 'used';

function handleEventTicketBootstrap_(identity) {
  const member = ensureMember_(identity);
  const snapshot = readEventTicketSnapshot_();
  const tier = eventTicketMemberTier_(member.line_user_id);
  return {
    profile: { displayName: String(member.display_name || identity.displayName), tier: tier.label, tierKey: tier.tierKey },
    offers: visibleEventTicketOffersForMember_(identity.lineUserId, snapshot, tier.tierKey),
    usedTickets: usedEventTicketHistoryForMember_(identity.lineUserId, snapshot)
  };
}

function readEventTicketSnapshot_() {
  const tickets = readRecords_('EventTickets');
  const claims = readRecords_('EventTicketClaims');
  const ticketsById = {};
  const claimsByTicket = {};
  const claimsByMemberTicket = {};
  tickets.forEach(function(ticket) {
    const eventTicketId = String(ticket.event_ticket_id || '').trim();
    if (eventTicketId) ticketsById[eventTicketId] = ticket;
  });
  claims.forEach(function(claim) {
    const eventTicketId = String(claim.event_ticket_id || '').trim();
    const lineUserId = String(claim.line_user_id || '').trim();
    if (!eventTicketId) return;
    if (!claimsByTicket[eventTicketId]) claimsByTicket[eventTicketId] = [];
    claimsByTicket[eventTicketId].push(claim);
    const key = eventTicketMemberTicketKey_(lineUserId, eventTicketId);
    if (lineUserId && !claimsByMemberTicket[key]) claimsByMemberTicket[key] = [];
    if (lineUserId) claimsByMemberTicket[key].push(claim);
  });
  return { tickets, ticketsById, claims, claimsByTicket, claimsByMemberTicket };
}

function eventTicketMemberTicketKey_(lineUserId, eventTicketId) {
  return String(lineUserId || '').trim() + '\u0000' + String(eventTicketId || '').trim();
}

function readEventTickets_(includeAdminDetails, snapshot) {
  const source = snapshot || readEventTicketSnapshot_();
  return source.tickets.map(function(ticket) {
    const claims = source.claimsByTicket[String(ticket.event_ticket_id || '')] || [];
    return eventTicketForClient_(ticket, includeAdminDetails, claims.length);
  }).sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
}

function visibleEventTicketOffersForMember_(lineUserId, snapshot, memberTierKey) {
  const source = snapshot || readEventTicketSnapshot_();
  return source.tickets.filter(function(ticket) {
    return String(ticket.status || '') === 'active' && eventTicketAllowsTier_(ticket, memberTierKey || 'general');
  }).map(function(ticket) {
    const eventTicketId = String(ticket.event_ticket_id || '');
    const claims = source.claimsByTicket[eventTicketId] || [];
    const memberClaims = source.claimsByMemberTicket[eventTicketMemberTicketKey_(lineUserId, eventTicketId)] || [];
    const claim = memberClaims.length ? memberClaims[memberClaims.length - 1] : null;
    const state = eventTicketAvailability_(ticket);
    const quota = eventTicketQuota_(ticket);
    const soldOut = quota > 0 && claims.length >= quota && !claim;
    return {
      ticket: eventTicketForClient_(ticket, false, claims.length),
      claim: claim ? eventTicketClaimForClient_(claim) : null,
      availability: state,
      tierEligible: true,
      canClaim: state === 'open' && !claim && !soldOut,
      canUse: state === 'open' && Boolean(claim) && String(claim.status || '') === EVENT_TICKET_STATUS_AVAILABLE_,
      soldOut
    };
  }).filter(function(offer) {
    return !offer.claim || String(offer.claim.status || '') !== EVENT_TICKET_STATUS_USED_;
  }).sort(function(a, b) {
    const aDate = String(a.ticket.startsOn || a.ticket.updatedAt || '');
    const bDate = String(b.ticket.startsOn || b.ticket.updatedAt || '');
    return aDate.localeCompare(bDate);
  });
}

function usedEventTicketHistoryForMember_(lineUserId, snapshot) {
  const source = snapshot || readEventTicketSnapshot_();
  const memberId = String(lineUserId || '').trim();
  return source.claims.filter(function(claim) {
    return String(claim.line_user_id || '').trim() === memberId && String(claim.status || '') === EVENT_TICKET_STATUS_USED_;
  }).map(function(claim) {
    const eventTicketId = String(claim.event_ticket_id || '').trim();
    const ticket = source.ticketsById[eventTicketId] || null;
    const claimCount = (source.claimsByTicket[eventTicketId] || []).length;
    return {
      ticket: eventTicketClaimTicketForClient_(claim, ticket, claimCount),
      claim: eventTicketClaimForClient_(claim),
      availability: EVENT_TICKET_STATUS_USED_,
      tierEligible: true,
      canClaim: false,
      canUse: false,
      soldOut: false,
      history: true,
      definitionRemoved: !ticket
    };
  }).sort(function(a, b) {
    return String(b.claim.usedAt || b.claim.claimedAt || '').localeCompare(String(a.claim.usedAt || a.claim.claimedAt || ''));
  });
}

function eventTicketForClient_(ticket, includeAdminDetails, claimCount) {
  const quota = eventTicketQuota_(ticket);
  const allowedTierKeys = eventTicketAllowedTierKeys_(ticket);
  const clientTicket = {
    eventTicketId: String(ticket.event_ticket_id || ''),
    title: String(ticket.title || ''),
    ticketType: String(ticket.ticket_type || 'coupon').toLowerCase() === 'lottery' ? 'lottery' : 'coupon',
    description: String(ticket.description || ''),
    usageMethod: String(ticket.usage_method || ''),
    usageInstructions: String(ticket.usage_instructions || ''),
    status: EVENT_TICKET_STATUSES_.indexOf(String(ticket.status || 'draft')) >= 0 ? String(ticket.status || 'draft') : 'draft',
    startsOn: eventTicketDateValue_(ticket.starts_on),
    endsOn: eventTicketDateValue_(ticket.ends_on),
    availability: eventTicketAvailability_(ticket),
    quota,
    quotaRemaining: quota > 0 ? Math.max(0, quota - Number(claimCount || 0)) : null,
    allowedTierKeys,
    allowedTierLabels: eventTicketTierLabels_(allowedTierKeys),
    accent: /^#[0-9a-f]{6}$/i.test(String(ticket.accent || '')) ? String(ticket.accent) : '#e47845',
    createdAt: String(ticket.created_at || ''),
    updatedAt: String(ticket.updated_at || ''),
    prizes: eventTicketPrizesForClient_(eventTicketParseArray_(ticket.lottery_prizes_json), includeAdminDetails)
  };
  if (includeAdminDetails) clientTicket.claimedCount = Math.max(0, Number(claimCount || 0));
  return clientTicket;
}

function eventTicketClaimForClient_(claim) {
  return {
    claimId: String(claim.claim_id || ''),
    eventTicketId: String(claim.event_ticket_id || ''),
    ticketType: String(claim.ticket_type || 'coupon').toLowerCase() === 'lottery' ? 'lottery' : 'coupon',
    ticketTitle: String(claim.ticket_title || ''),
    ticketDescription: String(claim.ticket_description || ''),
    usageMethod: String(claim.usage_method || ''),
    usageInstructions: String(claim.usage_instructions || ''),
    prizes: eventTicketPrizesForClient_(eventTicketParseArray_(claim.lottery_prizes_json), false),
    status: String(claim.status || EVENT_TICKET_STATUS_AVAILABLE_),
    claimedAt: String(claim.claimed_at || ''),
    usedAt: String(claim.used_at || ''),
    result: eventTicketResultForClient_(claim.result_json)
  };
}

function eventTicketClaimTicketForClient_(claim, ticket, claimCount) {
  const clientTicket = ticket ? eventTicketForClient_(ticket, false, claimCount) : {
    eventTicketId: String(claim.event_ticket_id || ''),
    title: '',
    ticketType: 'coupon',
    description: '',
    usageMethod: '',
    usageInstructions: '',
    status: 'archived',
    startsOn: '',
    endsOn: '',
    availability: EVENT_TICKET_STATUS_USED_,
    quota: 0,
    quotaRemaining: null,
    allowedTierKeys: [],
    allowedTierLabels: [],
    accent: '#e47845',
    createdAt: String(claim.created_at || ''),
    updatedAt: String(claim.updated_at || ''),
    prizes: []
  };
  clientTicket.title = String(claim.ticket_title || clientTicket.title || '活動票券');
  clientTicket.ticketType = String(claim.ticket_type || clientTicket.ticketType || 'coupon').toLowerCase() === 'lottery' ? 'lottery' : 'coupon';
  clientTicket.description = String(claim.ticket_description || clientTicket.description || '');
  clientTicket.usageMethod = String(claim.usage_method || clientTicket.usageMethod || '');
  clientTicket.usageInstructions = String(claim.usage_instructions || clientTicket.usageInstructions || '');
  clientTicket.prizes = eventTicketPrizesForClient_(eventTicketParseArray_(claim.lottery_prizes_json), false);
  return clientTicket;
}

function eventTicketPrizesForClient_(prizes, includeWinRate) {
  return (Array.isArray(prizes) ? prizes : []).map(function(prize) {
    const clientPrize = {
      prizeId: String(prize.prize_id || prize.prizeId || ''),
      prizeTitle: String(prize.prize_title || prize.prizeTitle || ''),
      prizeDescription: String(prize.prize_description || prize.prizeDescription || '')
    };
    if (includeWinRate) clientPrize.winRate = Number(prize.win_rate || prize.winRate || 0);
    return clientPrize;
  });
}

function eventTicketResultForClient_(value) {
  if (!value) return null;
  try {
    const result = JSON.parse(String(value));
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    return { prizeId: String(result.prizeId || result.prize_id || ''), prizeTitle: String(result.prizeTitle || result.prize_title || ''), prizeDescription: String(result.prizeDescription || result.prize_description || '') };
  } catch (_) { return null; }
}

function handleEventTicketSave_(identity, admin, request) {
  const input = request.eventTicket && typeof request.eventTicket === 'object' && !Array.isArray(request.eventTicket) ? request.eventTicket : {};
  const eventTicketId = String(input.eventTicketId || '').trim();
  const title = String(input.title || '').trim();
  const ticketType = String(input.ticketType || '').trim().toLowerCase();
  const description = String(input.description || '').trim();
  const usageMethod = String(input.usageMethod || '').trim();
  const usageInstructions = String(input.usageInstructions || '').trim();
  const status = String(input.status || '').trim().toLowerCase();
  const startsOn = eventTicketNormalizeDate_(input.startsOn, '活動開始日');
  const endsOn = eventTicketNormalizeDate_(input.endsOn, '活動結束日');
  const quota = eventTicketNormalizeQuota_(input.quota);
  const allowedTierKeys = normalizeEventTicketAllowedTierKeys_(input.allowedTierKeys);
  const accent = String(input.accent || '').trim();
  const expected = String(request.expectedUpdatedAt || '').trim();
  if (!title || title.length > 100 || EVENT_TICKET_TYPES_.indexOf(ticketType) < 0 || !description || description.length > 240 || !usageMethod || usageMethod.length > 120 || !usageInstructions || usageInstructions.length > 500 || EVENT_TICKET_STATUSES_.indexOf(status) < 0 || !/^#[0-9a-f]{6}$/i.test(accent) || (startsOn && endsOn && startsOn > endsOn)) {
    throw new ApiError(400, 'INVALID_EVENT_TICKET', '活動票券名稱、類型、說明、使用方式、使用說明、日期或狀態不合法。');
  }
  const prizes = ticketType === 'lottery' ? normalizeEventTicketPrizes_(input.prizes) : [];

  return withDataLock_(function() {
    const now = nowIso_();
    let ticket;
    let rowNumber = 0;
    if (eventTicketId) {
      const match = findRecordWithRow_('EventTickets', 'event_ticket_id', eventTicketId);
      if (!match) throw new ApiError(404, 'EVENT_TICKET_NOT_FOUND', '找不到活動票券。');
      if (expected && String(match.record.updated_at || '') !== expected) throw new ApiError(409, 'CONFLICT', '活動票券已被更新，請重新整理。');
      ticket = match.record;
      rowNumber = match.rowNumber;
    } else {
      ticket = { event_ticket_id: 'ET-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), created_by: identity.lineUserId, created_at: now };
    }
    ticket.title = title;
    ticket.ticket_type = ticketType;
    ticket.description = description;
    ticket.usage_method = usageMethod;
    ticket.usage_instructions = usageInstructions;
    ticket.lottery_prizes_json = JSON.stringify(prizes);
    ticket.status = status;
    ticket.starts_on = startsOn;
    ticket.ends_on = endsOn;
    ticket.quota = String(quota);
    ticket.allowed_tier_keys = JSON.stringify(allowedTierKeys);
    ticket.accent = accent.toUpperCase();
    ticket.updated_by = identity.lineUserId;
    ticket.updated_at = now;
    if (rowNumber) updateRecordAtRow_('EventTickets', rowNumber, ticket); else appendRecord_('EventTickets', ticket);
    const claims = readRecords_('EventTicketClaims').filter(function(claim) { return String(claim.event_ticket_id || '') === eventTicketId || String(claim.event_ticket_id || '') === ticket.event_ticket_id; });
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'EVENT_TICKET_SAVE', target_type: 'event_ticket', target_id: ticket.event_ticket_id, result: 'success', detail: 'Event ticket saved; existing claim snapshots retained', created_at: now });
    return { eventTicket: eventTicketForClient_(ticket, true, claims.length) };
  });
}

function handleEventTicketDelete_(identity, admin, request) {
  const eventTicketId = String(request.eventTicketId || '').trim();
  const expected = String(request.expectedUpdatedAt || '').trim();
  if (!eventTicketId || eventTicketId.length > 80 || expected.length > 80) throw new ApiError(400, 'INVALID_EVENT_TICKET_DELETE', '活動票券識別碼不合法。');
  return withDataLock_(function() {
    const match = findRecordWithRow_('EventTickets', 'event_ticket_id', eventTicketId);
    if (!match) throw new ApiError(404, 'EVENT_TICKET_NOT_FOUND', '找不到活動票券。');
    if (expected && String(match.record.updated_at || '') !== expected) throw new ApiError(409, 'CONFLICT', '活動票券已被更新，請重新整理。');
    const preservedClaimCount = readRecords_('EventTicketClaims').filter(function(claim) { return String(claim.event_ticket_id || '') === eventTicketId; }).length;
    const deleted = deleteRecordsWhere_('EventTickets', function(ticket) { return String(ticket.event_ticket_id || '') === eventTicketId; });
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: admin.role, action: 'EVENT_TICKET_DELETE', target_type: 'event_ticket', target_id: eventTicketId, result: 'success', detail: 'Event ticket deleted; ' + String(preservedClaimCount) + ' claim snapshots retained', created_at: nowIso_() });
    return { deleted: Boolean(deleted), eventTicketId, preservedClaimCount };
  });
}

function handleEventTicketClaim_(identity, request) {
  const eventTicketId = String(request.eventTicketId || '').trim();
  if (!eventTicketId || eventTicketId.length > 80) throw new ApiError(400, 'INVALID_EVENT_TICKET_CLAIM', '活動票券識別碼不合法。');
  return withDataLock_(function() {
    const match = findRecordWithRow_('EventTickets', 'event_ticket_id', eventTicketId);
    if (!match) throw new ApiError(404, 'EVENT_TICKET_NOT_FOUND', '找不到活動票券。');
    const ticket = match.record;
    const member = findRecordWithRow_('Members', 'line_user_id', identity.lineUserId);
    if (!member || String(member.record.status || 'active') !== 'active') throw new ApiError(400, 'MEMBER_DISABLED', '停用中的會員無法領取活動票券。');
    assertEventTicketOpen_(ticket);
    const claims = readRecords_('EventTicketClaims');
    const existing = claims.find(function(claim) { return String(claim.event_ticket_id || '') === eventTicketId && String(claim.line_user_id || '') === String(identity.lineUserId); });
    if (existing) return { claimed: false, alreadyClaimed: true, ticket: eventTicketClaimForClient_(existing) };
    assertEventTicketAllowsTier_(ticket, eventTicketMemberTier_(identity.lineUserId).tierKey);
    const quota = eventTicketQuota_(ticket);
    const claimedCount = claims.filter(function(claim) { return String(claim.event_ticket_id || '') === eventTicketId; }).length;
    if (quota > 0 && claimedCount >= quota) throw new ApiError(409, 'EVENT_TICKET_SOLD_OUT', '這張活動票券已達發放上限。');
    const now = nowIso_();
    const claim = eventTicketClaimFromDefinition_(identity.lineUserId, ticket, now);
    appendRecord_('EventTicketClaims', claim);
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: 'member', action: 'EVENT_TICKET_CLAIM', target_type: 'event_ticket_claim', target_id: claim.claim_id, result: 'success', detail: 'Event ticket claimed once per member', created_at: now });
    return { claimed: true, ticket: eventTicketClaimForClient_(claim) };
  });
}

function handleEventTicketRedeem_(identity, request) {
  const claimId = String(request.claimId || '').trim();
  if (!claimId || claimId.length > 80) throw new ApiError(400, 'INVALID_EVENT_TICKET_REDEEM', '活動票券識別碼不合法。');
  return withDataLock_(function() {
    const claimMatch = findRecordWithRow_('EventTicketClaims', 'claim_id', claimId);
    if (!claimMatch || String(claimMatch.record.line_user_id || '') !== String(identity.lineUserId)) throw new ApiError(404, 'EVENT_TICKET_CLAIM_NOT_FOUND', '找不到這張活動票券。');
    const claim = claimMatch.record;
    if (String(claim.status || '') === EVENT_TICKET_STATUS_USED_) throw new ApiError(409, 'EVENT_TICKET_ALREADY_USED', '這張活動票券已使用。', { usedAt: String(claim.used_at || '') });
    const ticketMatch = findRecordWithRow_('EventTickets', 'event_ticket_id', String(claim.event_ticket_id || ''));
    if (!ticketMatch) throw new ApiError(410, 'EVENT_TICKET_REMOVED', '這張活動票券已移除，無法使用。');
    const member = findRecordWithRow_('Members', 'line_user_id', identity.lineUserId);
    if (!member || String(member.record.status || 'active') !== 'active') throw new ApiError(400, 'MEMBER_DISABLED', '停用中的會員無法使用活動票券。');
    assertEventTicketOpen_(ticketMatch.record);
    assertEventTicketAllowsTier_(ticketMatch.record, eventTicketMemberTier_(identity.lineUserId).tierKey);
    const now = nowIso_();
    const result = String(claim.ticket_type || '') === 'lottery' ? drawEventTicketPrize_(claim) : null;
    claim.status = EVENT_TICKET_STATUS_USED_;
    claim.used_at = now;
    claim.result_json = result ? JSON.stringify(result) : '';
    claim.updated_at = now;
    updateRecordAtRow_('EventTicketClaims', claimMatch.rowNumber, claim);
    appendAuditRecord_({ audit_id: Utilities.getUuid(), actor_line_user_id: identity.lineUserId, actor_role: 'member', action: 'EVENT_TICKET_REDEEM', target_type: 'event_ticket_claim', target_id: claimId, result: 'success', detail: result ? 'Lottery event ticket redeemed and prize drawn' : 'Event ticket redeemed', created_at: now });
    return { redeemed: true, ticket: eventTicketClaimForClient_(claim) };
  });
}

function eventTicketClaimFromDefinition_(lineUserId, ticket, now) {
  return {
    claim_id: 'EC-' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(),
    event_ticket_id: String(ticket.event_ticket_id || ''),
    line_user_id: String(lineUserId),
    ticket_type: String(ticket.ticket_type || 'coupon').toLowerCase() === 'lottery' ? 'lottery' : 'coupon',
    ticket_title: String(ticket.title || ''),
    ticket_description: String(ticket.description || ''),
    usage_method: String(ticket.usage_method || ''),
    usage_instructions: String(ticket.usage_instructions || ''),
    lottery_prizes_json: JSON.stringify(eventTicketParseArray_(ticket.lottery_prizes_json)),
    status: EVENT_TICKET_STATUS_AVAILABLE_,
    claimed_at: now,
    used_at: '',
    result_json: '',
    created_at: now,
    updated_at: now
  };
}

function assertEventTicketOpen_(ticket) {
  if (String(ticket.status || '') !== 'active') throw new ApiError(409, 'EVENT_TICKET_NOT_ACTIVE', '這張活動票券目前沒有開放。');
  const availability = eventTicketAvailability_(ticket);
  if (availability === 'scheduled') throw new ApiError(409, 'EVENT_TICKET_NOT_STARTED', '這張活動票券尚未開始。');
  if (availability === 'ended') throw new ApiError(410, 'EVENT_TICKET_ENDED', '這張活動票券活動已結束。');
}

function eventTicketTierDefinitions_() {
  if (typeof MEMBERSHIP_TIER_DEFINITIONS_ !== 'undefined' && Array.isArray(MEMBERSHIP_TIER_DEFINITIONS_)) return MEMBERSHIP_TIER_DEFINITIONS_;
  return [
    { tierKey: 'general', label: '一般會員' },
    { tierKey: 'silver', label: '銀級會員' },
    { tierKey: 'gold', label: '金級會員' },
    { tierKey: 'platinum', label: '白金會員' }
  ];
}

function eventTicketAllTierKeys_() { return eventTicketTierDefinitions_().map(function(tier) { return tier.tierKey; }); }

function eventTicketTierLabels_(tierKeys) {
  const allowed = Array.isArray(tierKeys) ? tierKeys : [];
  return eventTicketTierDefinitions_().filter(function(tier) { return allowed.indexOf(tier.tierKey) >= 0; }).map(function(tier) { return tier.label; });
}

function normalizeEventTicketAllowedTierKeys_(value) {
  if (value === undefined || value === null) return eventTicketAllTierKeys_();
  if (!Array.isArray(value)) throw new ApiError(400, 'INVALID_EVENT_TICKET', '活動票券適用會員等級不合法。');
  const requested = {};
  value.forEach(function(item) {
    const tierKey = String(item || '').trim();
    if (tierKey) requested[tierKey] = true;
  });
  const allowedTierKeys = eventTicketAllTierKeys_().filter(function(tierKey) { return Boolean(requested[tierKey]); });
  if (!allowedTierKeys.length || Object.keys(requested).length !== allowedTierKeys.length) throw new ApiError(400, 'INVALID_EVENT_TICKET', '請至少選擇一個有效的可使用會員等級。');
  return allowedTierKeys;
}

function eventTicketAllowedTierKeys_(ticket) {
  const raw = String(ticket && ticket.allowed_tier_keys || '').trim();
  if (!raw) return eventTicketAllTierKeys_();
  const parsed = eventTicketParseArray_(raw);
  const requested = {};
  parsed.forEach(function(item) { const tierKey = String(item || '').trim(); if (tierKey) requested[tierKey] = true; });
  return eventTicketAllTierKeys_().filter(function(tierKey) { return Boolean(requested[tierKey]); });
}

function eventTicketMemberTier_(lineUserId) {
  if (typeof serviceMinutesTotalForMember_ !== 'function' || typeof membershipTierForServiceMinutes_ !== 'function') return eventTicketTierDefinitions_()[0];
  return membershipTierForServiceMinutes_(serviceMinutesTotalForMember_(lineUserId));
}

function eventTicketAllowsTier_(ticket, tierKey) { return eventTicketAllowedTierKeys_(ticket).indexOf(String(tierKey || '').trim()) >= 0; }

function assertEventTicketAllowsTier_(ticket, tierKey) {
  if (!eventTicketAllowsTier_(ticket, tierKey)) throw new ApiError(403, 'EVENT_TICKET_TIER_INELIGIBLE', '目前會員等級無法領取或使用這張活動票券。', { allowedTierKeys: eventTicketAllowedTierKeys_(ticket) });
}

function eventTicketAvailability_(ticket) {
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const startsOn = eventTicketDateValue_(ticket && ticket.starts_on);
  const endsOn = eventTicketDateValue_(ticket && ticket.ends_on);
  if (startsOn && today < startsOn) return 'scheduled';
  if (endsOn && today > endsOn) return 'ended';
  return 'open';
}

function eventTicketDateValue_(value) {
  const date = String(value || '').trim();
  return eventTicketIsValidDate_(date) ? date : '';
}

function eventTicketNormalizeDate_(value, label) {
  const date = String(value || '').trim();
  if (date && !eventTicketIsValidDate_(date)) throw new ApiError(400, 'INVALID_EVENT_TICKET', label + '格式不合法。');
  return date;
}

function eventTicketIsValidDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parts = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
}

function eventTicketQuota_(ticket) {
  const value = Number(ticket && ticket.quota || 0);
  return Number.isInteger(value) && value >= 0 ? Math.min(value, EVENT_TICKET_MAX_QUOTA_) : 0;
}

function eventTicketNormalizeQuota_(value) {
  const text = value === null || value === undefined || value === '' ? '0' : String(value).trim();
  const quota = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(quota) || quota < 0 || quota > EVENT_TICKET_MAX_QUOTA_) throw new ApiError(400, 'INVALID_EVENT_TICKET', '活動票券發放上限必須是 0–1,000,000 的整數。');
  return quota;
}

function normalizeEventTicketPrizes_(rawPrizes) {
  if (!Array.isArray(rawPrizes) || rawPrizes.length < 1 || rawPrizes.length > EVENT_TICKET_MAX_PRIZES_) throw new ApiError(400, 'INVALID_EVENT_TICKET', '抽獎券至少要設定 1 個獎項，最多 30 個獎項。');
  let totalBasisPoints = 0;
  const prizes = rawPrizes.map(function(rawPrize) {
    if (!rawPrize || typeof rawPrize !== 'object' || Array.isArray(rawPrize)) throw new ApiError(400, 'INVALID_EVENT_TICKET', '抽獎獎項格式不合法。');
    const prizeTitle = String(rawPrize.prizeTitle || '').trim();
    const prizeDescription = String(rawPrize.prizeDescription || '').trim();
    const rateText = rawPrize.winRate === null || rawPrize.winRate === undefined ? '' : String(rawPrize.winRate).trim();
    const winRate = Number(rateText);
    if (!prizeTitle || prizeTitle.length > 100 || prizeDescription.length > 240 || !rateText || !Number.isFinite(winRate) || winRate < 0 || winRate > 100) throw new ApiError(400, 'INVALID_EVENT_TICKET', '抽獎獎項名稱、說明與機率都必須合法。');
    const basisPoints = Math.round(winRate * 100);
    totalBasisPoints += basisPoints;
    return { prize_id: 'EP-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(), prize_title: prizeTitle, prize_description: prizeDescription, win_rate: String(basisPoints / 100) };
  });
  if (totalBasisPoints !== EVENT_TICKET_RATE_BASIS_POINTS_) throw new ApiError(400, 'INVALID_EVENT_TICKET', '同一張抽獎券的獎項機率合計必須正好是 100%。');
  return prizes;
}

function eventTicketParseArray_(value) {
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; }
}

function drawEventTicketPrize_(claim) {
  const prizes = eventTicketParseArray_(claim.lottery_prizes_json);
  let cursor = 0;
  let lastPositive = null;
  const roll = typeof generateTicketRandomBasisPoint_ === 'function' ? generateTicketRandomBasisPoint_() : Math.floor(Math.random() * EVENT_TICKET_RATE_BASIS_POINTS_);
  for (let index = 0; index < prizes.length; index += 1) {
    const prize = prizes[index];
    const basisPoints = Math.max(0, Math.round(Number(prize.win_rate || prize.winRate || 0) * 100));
    if (basisPoints > 0) lastPositive = prize;
    cursor += basisPoints;
    if (basisPoints > 0 && roll < cursor) return { prizeId: String(prize.prize_id || prize.prizeId || ''), prizeTitle: String(prize.prize_title || prize.prizeTitle || ''), prizeDescription: String(prize.prize_description || prize.prizeDescription || '') };
  }
  return lastPositive ? { prizeId: String(lastPositive.prize_id || lastPositive.prizeId || ''), prizeTitle: String(lastPositive.prize_title || lastPositive.prizeTitle || ''), prizeDescription: String(lastPositive.prize_description || lastPositive.prizeDescription || '') } : null;
}
