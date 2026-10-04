(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MemberE2EFeatureCoverage = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Each entry records the actual evidence level. A contract/UI check does not
  // certify a physical camera, LINE delivery, GPS device, or a scheduled worker.
  const catalog = [
    ['shared.session', '共用登入與 Session 權限', 'shared', 'both', 'boundary', ['ADMIN_AUTH_READY'], ['COMMON_TEST_SESSION','SECURITY_MISSING_SESSION','SECURITY_TAMPERED_SESSION','SECURITY_ADMIN_BOUNDARY']],
    ['shared.theme', '亮暗主題與偏好還原', 'shared', 'both', 'interaction', ['ADMIN_THEME_TOGGLE'], ['COMMON_THEME_TOGGLE']],
    ['shared.tour', '首次教學與操作恢復', 'shared', 'user', 'interaction', [], ['COMMON_TOUR_AUTOSTART','COMMON_TOUR_JOURNEY']],
    ['shared.realtime', '跨端即時更新', 'shared', 'user', 'contract', [], ['COMMON_REALTIME']],
    ['member.directory', '會員名冊、搜尋、分頁與紀錄', 'member', 'admin', 'interaction', ['ADMIN_TEST_MEMBER_ROSTER','ADMIN_MEMBER_DIRECTORY_CONTROLS','ADMIN_MEMBER_MODALS'], []],
    ['member.profile', '稱呼、生日、電話修改與還原', 'member', 'both', 'lifecycle', ['ADMIN_TEST_MEMBER_PROFILE_EDIT'], ['MEMBER_HUMAN_PROFILE_EDIT','MEMBER_INVALID_WRITE']],
    ['member.phone', '電話國碼與重複數字拒絕', 'member', 'user', 'boundary', [], ['MEMBER_PHONE_COUNTRY_VALIDATION']],
    ['member.terms', '條款版本、同意與拒絕', 'member', 'both', 'contract', ['ADMIN_MEMBERSHIP_TERMS'], ['MEMBER_TERMS_CONSENT']],
    ['member.join', '加入會員與 LINE 通知', 'member', 'user', 'contract', [], ['MEMBER_JOIN_LINE_AUTOMATION_CONTRACT','MEMBER_LINE_SUPPRESSION'], '正式 LINE 收件需實機驗收'],
    ['member.referral', '好友邀請與自邀拒絕', 'member', 'user', 'boundary', [], ['MEMBER_REFERRAL_BOUNDARY']],
    ['member.tiers', '會員等級、門檻與累積時數', 'member', 'both', 'contract', ['ADMIN_TIER_SETTINGS'], ['COMMON_MEMBERSHIP_MILESTONE']],
    ['member.revocation', '強制下線、撤銷與維護邊界', 'member', 'admin', 'boundary', ['ADMIN_FORCE_LOGOUT_SECURITY'], []],
    ['member.presets', '預設訊息編輯與驗證', 'member', 'admin', 'interaction', ['ADMIN_MESSAGE_PRESET_EDITOR'], []],
    ['member.grant', '發放點數、時數與通知模式', 'member', 'admin', 'interaction', ['ADMIN_GRANT_NOTIFICATION_CONTROLS','ADMIN_MEMBER_MODALS'], [], '排程 LINE 實際投遞由通知測試與實機驗收補充'],
    ['points.cards', '集點卡 CRUD、節點與樣式', 'points', 'both', 'lifecycle', ['ADMIN_POINT_CARD_CRUD'], ['POINTS_DATA','POINTS_CARD_SWITCH'], '', {}, {user:'interaction'}],
    ['points.templates', '票券模板與封存', 'points', 'admin', 'lifecycle', ['ADMIN_TICKET_CRUD'], []],
    ['points.lottery', '抽獎券與機率設定', 'points', 'admin', 'lifecycle', ['ADMIN_LOTTERY_TICKET_CRUD'], []],
    ['points.limits', '集點卡使用上限與 0 不限張數', 'points', 'both', 'contract', ['ADMIN_POINT_LIMIT_SETTINGS'], ['POINTS_SETTINGS']],
    ['points.redeem', '勾選、取消與核銷', 'points', 'user', 'lifecycle', [], ['POINTS_HUMAN_REDEEM','POINTS_INVALID_WRITE']],
    ['points.transfer', '點數轉贈與輸入邊界', 'points', 'user', 'boundary', [], ['POINTS_TRANSFER_BOUNDARY']],
    ['points.history', '集點卡票券使用紀錄', 'points', 'user', 'interaction', [], ['POINTS_HISTORY_DISCLOSURE']],
    ['event.crud', '活動票券 CRUD 與領取資格', 'event', 'both', 'lifecycle', ['ADMIN_EVENT_TICKET_CRUD'], ['EVENT_DATA','EVENT_HUMAN_LIFECYCLE']],
    ['event.dates', '活動尚未開始、結束與封存', 'event', 'user', 'boundary', [], ['EVENT_BOUNDARY_STATES']],
    ['event.limits', '每日額度、已使用數與 0 不限', 'event', 'both', 'contract', ['ADMIN_EVENT_DAILY_LIMIT_SETTINGS'], ['EVENT_TODAY_USABLE_LIMIT']],
    ['event.history', '票券詳情與已使用紀錄', 'event', 'user', 'interaction', [], ['EVENT_MODAL','EVENT_HISTORY_DISCLOSURE','EVENT_INVALID_WRITE']],
    ['event.birthday', '生日固定票券與輸入驗證', 'event', 'admin', 'interaction', ['ADMIN_BIRTHDAY_SETTINGS'], [], '年度去重與四種效期由 production SQL 整合測試驗證'],
    ['event.fixed', '固定票券週期與效期切換', 'event', 'admin', 'interaction', ['ADMIN_FIXED_TICKET_CONTROLS'], [], '四種週期、QA 隔離與通知條件由 production SQL 整合測試驗證'],
    ['automation.health', '固定發券、通知、提醒與清理排程健康', 'event', 'admin', 'boundary', ['ADMIN_AUTOMATION_HEALTH'], [], 'cron 成功不等於 LINE 收件成功', {admin:['member','event','booking']}],
    ['tickets.location', 'GPS 使用地點編輯器', 'event', 'admin', 'contract', ['ADMIN_TICKET_LOCATION_CONTROLS'], [], '實際定位權限與距離需裝置驗收', {admin:['points','event']}],
    ['tickets.service', '票券具體服務項目 any／all 限制', 'booking', 'both', 'boundary', ['ADMIN_TICKET_SERVICE_RULES'], ['BOOKING_TICKET_RULES'], '', {admin:['points','event','booking'],user:['booking']}, {admin:'interaction'}],
    ['calendar.crud', '營運日曆與活動 CRUD', 'calendar', 'admin', 'lifecycle', ['ADMIN_CALENDAR_CRUD'], []],
    ['calendar.batch', '日曆批次編輯與拒絕邊界', 'calendar', 'admin', 'interaction', ['ADMIN_CALENDAR_BATCH_CONTROLS'], []],
    ['calendar.member', '月份、今日與日期明細', 'calendar', 'user', 'interaction', [], ['CALENDAR_NAVIGATION','CALENDAR_HUMAN_DETAIL','CALENDAR_INVALID_DATE','CALENDAR_SERVER_BOUNDARY']],
    ['booking.settings', '時段、跨夜、提前日數與通知', 'booking', 'admin', 'lifecycle', ['ADMIN_BOOKING_SHARED_SETTINGS'], []],
    ['booking.resources', '服務類型、項目、價格與技師', 'booking', 'admin', 'interaction', ['ADMIN_BOOKING_CRUD','ADMIN_BOOKING_RESOURCE_CONTROLS'], []],
    ['booking.form', '日期、項目、時段與確認步驟', 'booking', 'user', 'interaction', [], ['BOOKING_FORM_INITIAL','BOOKING_FLOW_STEPPER','BOOKING_HUMAN_CONTROLS']],
    ['booking.lifecycle', '新增、修改與取消預約', 'booking', 'user', 'lifecycle', [], ['BOOKING_HUMAN_LIFECYCLE','BOOKING_INVALID_WRITE']],
    ['booking.group', '多人預約與參與者服務', 'booking', 'user', 'lifecycle', [], ['BOOKING_GROUP_DATA','BOOKING_HUMAN_GROUP']],
    ['booking.benefits', '推薦、勾選、點數預留與核銷交接', 'booking', 'user', 'lifecycle', [], ['BOOKING_BENEFITS_RECOMMENDATIONS','BOOKING_BENEFIT_REDEMPTION_LIFECYCLE','BOOKING_TICKET_RULES']],
    ['booking.receipt', '收據相機入口與管理端安全檢視', 'booking', 'both', 'contract', ['ADMIN_BOOKING_RECEIPT_VIEWER'], ['BOOKING_RECEIPT_REVIEW_CONTRACT'], '實際拍照、Storage 上傳與替換需相機驗收'],
    ['booking.accessible', '無障礙模式、可用票券與登記狀態', 'booking', 'user', 'interaction', [], ['BOOKING_ACCESSIBLE_MODE','BOOKING_ACCESSIBLE_RECEIPT_BOUNDARY']],
    ['booking.accessible-admin', '無障礙待確認、已完成與全部', 'booking', 'admin', 'interaction', ['ADMIN_BOOKING_ACCESSIBLE_QUEUE'], [], '實際審核與冪等結算由 accessible SQL 整合測試補充'],
    ['booking.sources', '預約紀錄的集點卡／活動票券來源卡片', 'booking', 'both', 'contract', ['ADMIN_BOOKING_HISTORY_TICKET_SOURCES'], ['BOOKING_HISTORY_TICKET_SOURCES']],
    ['integration.overview', '整合總覽、權益、通知與 Audit', 'integration', 'admin', 'interaction', ['ADMIN_INTEGRATION_CENTER','ADMIN_INTEGRATION_NAVIGATION'], []],
    ['testing.accounts', '測試帳號新增、選取與移除', 'testing', 'admin', 'lifecycle', ['ADMIN_TEST_MODE_CONTROLS','ADMIN_TEST_ACCOUNT_LIFECYCLE'], []],
  ].map(([id, name, module, side, level, admin, user, limitation = '', scopes = {}, levels = {}]) => Object.freeze({id,name,module,side,level,admin:Object.freeze(admin),user:Object.freeze(user),limitation,scopes,levels}));

  function report({ side, modules = [], registeredKeys = [], plannedKeys = [], results = [] }) {
    if (!['admin','user'].includes(side)) throw new TypeError('Unknown E2E coverage side');
    const registered = new Set(registeredKeys), planned = new Set(plannedKeys);
    const statuses = new Map();
    for (const row of results) {
      const previous = statuses.get(row.key);
      // A later successful stress replay must not conceal a failed base node.
      if (previous !== 'failed') statuses.set(row.key, row.status);
    }
    const features = catalog.filter(item => (item.side === 'both' || item.side === side)
      && (item.module === 'shared' || item.module === 'testing' || (item.scopes[side] || [item.module]).some(module => modules.includes(module))))
      .map(item => {
        const keys = item[side];
        const unregistered = keys.filter(key => !registered.has(key));
        const unplanned = keys.filter(key => !planned.has(key));
        const missing = keys.filter(key => !statuses.has(key));
        const failed = keys.filter(key => statuses.get(key) === 'failed');
        const blocked = keys.filter(key => ['skipped','blocked'].includes(statuses.get(key)));
        const pending = keys.filter(key => statuses.has(key)
          && !['passed','failed','skipped','blocked'].includes(statuses.get(key)));
        const status = unregistered.length ? 'unregistered' : failed.length ? 'failed'
          : unplanned.length ? 'unplanned' : blocked.length ? 'blocked'
          : missing.length || pending.length ? 'not-run' : 'passed';
        return {id:item.id,name:item.name,level:item.levels[side] || item.level,keys,status,unregistered,unplanned,missing,failed,blocked,limitation:item.limitation};
      });
    const counts = {};
    for (const feature of features) counts[feature.status] = (counts[feature.status] || 0) + 1;
    return { version:1, side, modules:modules.slice(), total:features.length, counts,
      complete:features.length > 0 && features.every(item => item.status === 'passed'), features };
  }
  function compactRecordPayload(payload, maxBytes = 320000) {
    const size = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (size(payload) <= maxBytes) return payload;
    const compact = (value, limit) => {
      if (value == null) return value;
      const serialized = JSON.stringify(value);
      if (serialized.length <= limit) return value;
      return {truncated:true,originalChars:serialized.length,preview:serialized.slice(0,limit),
        ...(value.screenshot ? {screenshot:value.screenshot} : {}),
        ...(value.diagnosis ? {diagnosis:value.diagnosis} : {})};
    };
    for (const limit of [600, 240, 80, 0]) {
      const fitted = {...payload, recordCompacted:true, cases:payload.cases.map(row => ({...row,
        message:String(row.message || '').slice(0,Math.max(80,limit)),
        expected:compact(row.expected,limit),actual:compact(row.actual,limit),
        trace:compact(row.trace,limit * 2)}))};
      if (size(fitted) <= maxBytes) return fitted;
    }
    throw Object.assign(new Error('完整 E2E 紀錄超過容量，拒絕省略案例。'),{code:'E2E_RECORD_TOO_LARGE'});
  }
  return { catalog:Object.freeze(catalog), report, compactRecordPayload };
});
