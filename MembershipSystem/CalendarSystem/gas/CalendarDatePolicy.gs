'use strict';

const CALENDAR_BUSINESS_TIME_ZONE_ = 'Asia/Taipei';

function enforceAdminCalendarNotPast_(rawItem) {
  if (!rawItem || Array.isArray(rawItem) || typeof rawItem !== 'object') return;

  const startDate = typeof rawItem.startDate === 'string' ? rawItem.startDate.trim() : '';
  const endDate = typeof rawItem.endDate === 'string' ? rawItem.endDate.trim() : '';

  // CalendarService owns general date-format/range validation. This policy only
  // applies after both values are recognizable calendar date keys.
  if (!isValidDateKeyForPolicy_(startDate) || !isValidDateKeyForPolicy_(endDate)) return;

  const today = Utilities.formatDate(new Date(), CALENDAR_BUSINESS_TIME_ZONE_, 'yyyy-MM-dd');
  if (startDate < today || endDate < today) {
    throw new ApiError(
      400,
      'PAST_DATE_NOT_ALLOWED',
      '開始日期與結束日期不得設定為已經過去的日期。',
      { today: today }
    );
  }
}

function isValidDateKeyForPolicy_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !isNaN(parsed.getTime()) && parsed.toISOString().substring(0, 10) === value;
}
