/**
 * PERSONA MEMBERS - isolated administrator Google Apps Script backend
 *
 * Required Script Properties:
 * - LINE_CHANNEL_ID: must be 2010791619 (the administrator LINE Login channel)
 * - SPREADSHEET_ID: Google Sheet ID shared with the member backend
 * - ALLOWED_ORIGINS: comma-separated frontend origins
 *
 * Optional Script Properties:
 * - SHEET_NAME: defaults to "Members"
 * - ADMIN_SHEET_NAME: defaults to "Admins"
 * - POINT_TYPE_SHEET_NAME: defaults to "PointTypes"
 * - POINT_CAMPAIGN_SHEET_NAME: defaults to "PointCampaigns"
 * - POINT_REDEMPTION_SHEET_NAME: defaults to "PointRedemptions"
 * - POINT_CARD_SETTING_SHEET_NAME: defaults to "PointCardSettings"
 * - LOTTERY_TYPE_SHEET_NAME: defaults to "LotteryTypes"
 * - LOTTERY_PRIZE_SHEET_NAME: defaults to "LotteryPrizes"
 * - LOTTERY_DRAW_SHEET_NAME: defaults to "LotteryDraws"
 * - MEMBER_LIFF_URL: defaults to the member LIFF URL
 * - MAX_VERIFY_REQUESTS_PER_MINUTE: defaults to 120 (1-1000)
 *
 * setup() creates POINT_CLAIM_SECRET when it is missing. Normal API requests
 * fail closed until that secret exists and is valid.
 *
 * Administrator approval is deliberately manual. A verified administrator
 * channel login creates an Admins row with status "pending". Only a spreadsheet
 * owner can change that cell to "approved"; no API accepts an administrator
 * status field.
 */

var API_VERSION = "1.8.0";
var SERVICE_NAME = "member-admin-api";
var REQUIRED_LINE_CHANNEL_ID = "2010791619";
var DEFAULT_SHEET_NAME = "Members";
var DEFAULT_ADMIN_SHEET_NAME = "Admins";
var DEFAULT_POINT_TYPES_SHEET_NAME = "PointTypes";
var DEFAULT_POINT_CAMPAIGNS_SHEET_NAME = "PointCampaigns";
var DEFAULT_POINT_REDEMPTIONS_SHEET_NAME = "PointRedemptions";
var DEFAULT_POINT_CARD_SETTINGS_SHEET_NAME = "PointCardSettings";
var DEFAULT_LOTTERY_TYPES_SHEET_NAME = "LotteryTypes";
var DEFAULT_LOTTERY_PRIZES_SHEET_NAME = "LotteryPrizes";
var DEFAULT_LOTTERY_DRAWS_SHEET_NAME = "LotteryDraws";
var DEFAULT_MEMBER_LIFF_URL = "https://liff.line.me/2010787602-kaiSm2eq";
var LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
var MAX_ID_TOKEN_LENGTH = 6000;
var LINE_VERIFY_CACHE_SECONDS = 60;
var DEFAULT_ADMIN_PAGE_SIZE = 50;
var MAX_ADMIN_PAGE_SIZE = 100;
var MAX_POINT_VALUE = 9999;
var MAX_POINT_HISTORY_ENTRIES = 50;
var MAX_LOTTERY_DRAW_HISTORY_ENTRIES = 50;
var DEFAULT_POINT_CARD_TARGET = 5;
var LEGACY_LOTTERY_TICKET_COST = 5;
var DEFAULT_LOTTERY_TYPE_ID = "LTY-DEFAULT001";
var DEFAULT_LOTTERY_TYPE_NAME = "ç¶“å…¸è½‰ç›¤";
var DEFAULT_POINT_CARD_SETTING_VERSION = "PCS-DEFAULT00001";
var MIN_LOTTERY_PRIZES = 2;
var MAX_LOTTERY_PRIZES = 12;
var MAX_CAMPAIGN_LIFETIME_MS = 366 * 24 * 60 * 60 * 1000;
var ADMIN_ACTIONS = [
  "adminListMembers",
  "adminSetMemberAccess",
  "adminListPointTypes",
  "adminListPointHistory",
  "adminCreatePointType",
  "adminDeletePointType",
  "adminCreatePointCampaign",
  "adminGetLotteryConfig",
  "adminSavePointCardSetting",
  "adminCreateLotteryType",
  "adminDeleteLotteryType",
  "adminSaveLotteryConfig",
  "adminListLotteryDraws",
];

var LEGACY_MEMBER_HEADERS = [
  "member_id",
  "line_user_id",
  "display_name",
  "picture_url",
  "email",
  "status",
  "joined_at",
  "updated_at",
  "last_login_at",
  "login_count",
  "context_type",
  "context_os",
  "context_language",
  "in_liff_client",
  "view_type",
  "last_token_iat",
  "last_request_id",
];

var ACCESS_AUDIT_MEMBER_HEADERS = LEGACY_MEMBER_HEADERS.concat([
  "access_updated_at",
  "access_updated_by",
  "last_access_request_id",
]);

// Preserve the former 21-column Members schema and append member-editable
// profile fields. This backend never reads admin_status as authorization.
var PRE_PROFILE_MEMBER_HEADERS = ACCESS_AUDIT_MEMBER_HEADERS.concat(["admin_status"]);
var MEMBER_HEADERS = PRE_PROFILE_MEMBER_HEADERS.concat(["phone", "birthday"]);

var MEMBER_COLUMN = {
  memberId: 1,
  lineUserId: 2,
  displayName: 3,
  pictureUrl: 4,
  email: 5,
  status: 6,
  joinedAt: 7,
  updatedAt: 8,
  lastLoginAt: 9,
  loginCount: 10,
  contextType: 11,
  contextOs: 12,
  contextLanguage: 13,
  inLiffClient: 14,
  viewType: 15,
  lastTokenIat: 16,
  lastRequestId: 17,
  accessUpdatedAt: 18,
  accessUpdatedBy: 19,
  lastAccessRequestId: 20,
  adminStatus: 21,
  phone: 22,
  birthday: 23,
};

var ADMIN_HEADERS = [
  "admin_id",
  "line_user_id",
  "display_name",
  "picture_url",
  "email",
  "status",
  "requested_at",
  "updated_at",
  "last_login_at",
  "login_count",
  "last_token_iat",
  "last_request_id",
];

var ADMIN_COLUMN = {
  adminId: 1,
  lineUserId: 2,
  displayName: 3,
  pictureUrl: 4,
  email: 5,
  status: 6,
  requestedAt: 7,
  updatedAt: 8,
  lastLoginAt: 9,
  loginCount: 10,
  lastTokenIat: 11,
  lastRequestId: 12,
};

var LEGACY_POINT_TYPE_HEADERS = [
  "point_type_id",
  "label",
  "points",
  "status",
  "created_at",
  "updated_at",
  "created_by",
  "last_request_id",
];

var POINT_TYPE_HEADERS = LEGACY_POINT_TYPE_HEADERS.concat([
  "expiry_mode",
  "redemption_mode",
  "deleted_by",
  "delete_request_id",
]);

var POINT_TYPE_COLUMN = {
  pointTypeId: 1,
  label: 2,
  points: 3,
  status: 4,
  createdAt: 5,
  updatedAt: 6,
  createdBy: 7,
  lastRequestId: 8,
  expiryMode: 9,
  redemptionMode: 10,
  deletedBy: 11,
  deleteRequestId: 12,
};

var LEGACY_POINT_CAMPAIGN_HEADERS = [
  "campaign_id",
  "point_type_id",
  "label_snapshot",
  "points_snapshot",
  "claim_hash",
  "status",
  "expires_at",
  "created_at",
  "created_by",
  "last_request_id",
];

var POINT_CAMPAIGN_HEADERS = LEGACY_POINT_CAMPAIGN_HEADERS.concat([
  "expiry_mode_snapshot",
  "redemption_mode_snapshot",
]);

var POINT_CAMPAIGN_COLUMN = {
  campaignId: 1,
  pointTypeId: 2,
  labelSnapshot: 3,
  pointsSnapshot: 4,
  claimHash: 5,
  status: 6,
  expiresAt: 7,
  createdAt: 8,
  createdBy: 9,
  lastRequestId: 10,
  expiryModeSnapshot: 11,
  redemptionModeSnapshot: 12,
};

var LEGACY_POINT_REDEMPTION_HEADERS = [
  "redemption_id",
  "campaign_id",
  "point_type_id",
  "member_id",
  "line_user_id",
  "points",
  "balance_after",
  "redeemed_at",
  "request_id",
];

var POINT_REDEMPTION_HEADERS = LEGACY_POINT_REDEMPTION_HEADERS.concat([
  "redemption_mode_snapshot",
]);

var POINT_REDEMPTION_COLUMN = {
  redemptionId: 1,
  campaignId: 2,
  pointTypeId: 3,
  memberId: 4,
  lineUserId: 5,
  points: 6,
  balanceAfter: 7,
  redeemedAt: 8,
  requestId: 9,
  redemptionModeSnapshot: 10,
};

var LEGACY_POINT_CARD_SETTING_HEADERS = [
  "setting_version",
  "target_points",
  "effective_at",
  "updated_by",
  "last_request_id",
];
var MILESTONE_POINT_CARD_SETTING_HEADERS = LEGACY_POINT_CARD_SETTING_HEADERS.concat([
  "reward_milestones",
]);
var LOTTERY_POINT_CARD_SETTING_HEADERS = MILESTONE_POINT_CARD_SETTING_HEADERS.concat([
  "reward_lottery_type_ids",
]);
var POINT_CARD_SETTING_HEADERS = LOTTERY_POINT_CARD_SETTING_HEADERS.concat([
  "expiry_mode",
  "expires_on",
]);

var POINT_CARD_SETTING_COLUMN = {
  settingVersion: 1,
  targetPoints: 2,
  effectiveAt: 3,
  updatedBy: 4,
  lastRequestId: 5,
  rewardMilestones: 6,
  rewardLotteryTypeIds: 7,
  expiryMode: 8,
  expiresOn: 9,
};

var LOTTERY_TYPE_HEADERS = [
  "lottery_type_id",
  "name",
  "status",
  "created_at",
  "updated_at",
  "created_by",
  "deleted_at",
  "deleted_by",
  "last_request_id",
];

var LOTTERY_TYPE_COLUMN = {
  lotteryTypeId: 1,
  name: 2,
  status: 3,
  createdAt: 4,
  updatedAt: 5,
  createdBy: 6,
  deletedAt: 7,
  deletedBy: 8,
  lastRequestId: 9,
};

var LEGACY_LOTTERY_PRIZE_HEADERS = [
  "config_v²È="25Ñ¥½¸€¡½É¥¥¸¤ì(€€€€€¥˜€¡½É¥¥¸€˜˜¥ÍY…±¥‘=É¥¥¹|¡½É¥¥¸¤€˜˜½É¥¥¹Ì¹¥¹‘•á=˜¡½É¥¥¸¤€ôôô€´Ä¤ì(€€€€€€€½É¥¥¹Ì¹ÁÕÍ ¡½É¥¥¸¤ì(€€€€€ô(€€€ô¤ì(€É•ÑÕÉ¸½É¥¥¹Ìì)ô()™Õ¹Ñ¥½¸¥ÍY…±¥‘=É¥¥¹|¡½É¥¥¸¤ì(€É•ÑÕÉ¸€ (€€€€½y¡ÑÑÁÌép½p½m„µèÀ´ä¸µt¬ üèéq¬¤ü½¤¹Ñ•ÍÐ¡½É¥¥¸¤ñð(€€€€½y¡ÑÑÀép½p¼¡±½…±¡½ÍÑðÄÈÝp¸Áp¸Áp¸Ä¤ üèéq¬¤ü½¤¹Ñ•ÍÐ¡½É¥¥¸¤(€€¤ì)ô()™Õ¹Ñ¥½¸¹½Éµ…±¥é•=É¥¥¹|¡Ù…±Õ”¤ì(€É•ÑÕÉ¸MÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤¹É•Á±…” ½p¼¬¼°€ˆˆ¤ì)ô()™Õ¹Ñ¥½¸±¥¹•%‘•¹Ñ¥Ñå…¡•-•å|¡¥‘Q½­•¸°•áÁ•Ñ•‘¡…¹¹•±%¤ì(€Ù…È‘¥•ÍÐ€ôUÑ¥±¥Ñ¥•Ì¹½µÁÕÑ•¥•ÍÐ (€€€UÑ¥±¥Ñ¥•Ì¹¥•ÍÑ±½É¥Ñ¡´¹M!|ÈÔØ°(€€€MÑÉ¥¹œ¡¥‘Q½­•¸ñð€ˆˆ¤°(€€€UÑ¥±¥Ñ¥•Ì¹¡…ÉÍ•Ð¹UQ|à(€€¤ì(€Ù…È¡•à€ô‘¥•ÍÐ(€€€€¹µ…À¡™Õ¹Ñ¥½¸€¡‰åÑ”¤ì(€€€€€É•ÑÕÉ¸€ ¡9Õµ‰•È¡‰åÑ”¤€¬€ÈÔØ¤€”€ÈÔØ¤¹Ñ½MÑÉ¥¹œ ÄØ¤¹Á…‘MÑ…ÉÐ È°€ˆÀˆ¤ì(€€€ô¤(€€€€¹©½¥¸ ˆˆ¤ì(€É•ÑÕÉ¸€‰…‘µ¥¸µ±¥¹”µ¥‘•¹Ñ¥Ñäèˆ€¬•áÁ•Ñ•‘¡…¹¹•±%€¬€ˆèˆ€¬¡•àì)ô()™Õ¹Ñ¥½¸•Ñ…¡•‘1¥¹•%‘•¹Ñ¥Ñå|¡¥‘Q½­•¸°•áÁ•Ñ•‘¡…¹¹•±%¤ì(€ÑÉäì(€€€Ù…ÈÉ…Ü€ô…¡•M•ÉÙ¥”¹•ÑMÉ¥ÁÑ…¡” ¤¹•Ð (€€€€€±¥¹•%‘•¹Ñ¥Ñå…¡•-•å|¡¥‘Q½­•¸°•áÁ•Ñ•‘¡…¹¹•±%¤(€€€€¤ì(€€€¥˜€ …É…Ü¤É•ÑÕÉ¸¹Õ±°ì(€€€Ù…È…¡•€ô)M=8¹Á…ÉÍ”¡É…Ü¤ì(€€€Ù…È¹½ÝM•½¹‘Ì€ô5…Ñ ¹™±½½È¡…Ñ”¹¹½Ü ¤€¼€ÄÀÀÀ¤ì(€€€¥˜€ (€€€€€€……¡•ñð(€€€€€9Õµ‰•È¡…¡•¹•áÀñð€À¤€ðô¹½ÝM•½¹‘Ìñð(€€€€€€„½yUlÀ´å„µ™uìÌÉô¼¹Ñ•ÍÐ¡MÑÉ¥¹œ¡…¡•¹±¥¹•UÍ•É%ñð€ˆˆ¤¤ñð(€€€€€9Õµ‰•È¡…¡•¹Ñ½­•¹%ÍÍÕ•‘Ðñð€À¤€ðô€À(€€€€¤ì(€€€€€É•ÑÕÉ¸¹Õ±°ì(€€€ô(€€€É•ÑÕÉ¸ì(€€€€€±¥¹•UÍ•É%èMÑÉ¥¹œ¡…¡•¹±¥¹•UÍ•É%¤°(€€€€€‘¥ÍÁ±…å9…µ”è±¥µ¥ÑQ•áÑ|¡…¡•¹‘¥ÍÁ±…å9…µ”ñð€‰1%9ƒžº‡žB–N„ˆ°€ÄÀÀ¤°(€€€€€Á¥ÑÕÉ•UÉ°è¹½Éµ…±¥é•!ÑÑÁÍUÉ±|¡…¡•¹Á¥ÑÕÉ•UÉ°¤°(€€€€€•µ…¥°è±¥µ¥ÑQ•áÑ|¡…¡•¹•µ…¥°ñð€ˆˆ°€ÈÔÐ¤°(€€€€€Ñ½­•¹%ÍÍÕ•‘Ðè5…Ñ ¹™±½½È¡9Õµ‰•È¡…¡•¹Ñ½­•¹%ÍÍÕ•‘Ð¤¤°(€€€ôì(€ô…Ñ €¡}•ÉÉ½È¤ì(€€€É•ÑÕÉ¸¹Õ±°ì(€ô)ô()™Õ¹Ñ¥½¸…¡•1¥¹•%‘•¹Ñ¥Ñå|¡¥‘Q½­•¸°•áÁ•Ñ•‘¡…¹¹•±%°•áÁ¥É•ÍÐ°¥‘•¹Ñ¥Ñä¤ì(€ÑÉäì(€€€Ù…È¹½ÝM•½¹‘Ì€ô5…Ñ ¹™±½½È¡…Ñ”¹¹½Ü ¤€¼€ÄÀÀÀ¤ì(€€€Ù…ÈÉ•µ…¥¹¥¹M•½¹‘Ì€ô5…Ñ ¹™±½½È¡9Õµ‰•È¡•áÁ¥É•ÍÐ¤ñð€À¤€´¹½ÝM•½¹‘Ìì(€€€¥˜€¡É•µ…¥¹¥¹M•½¹‘Ì€ðô€À¤É•ÑÕÉ¸ì(€€€Ù…ÈÑÑ°€ô5…Ñ ¹µ¥¸¡1%9}YI%e}!}M=9L°É•µ…¥¹¥¹M•½¹‘Ì¤ì(€€€…¡•M•ÉÙ¥”¹•ÑMÉ¥ÁÑ…¡” ¤¹ÁÕÐ (€€€€€±¥¹•%‘•¹Ñ¥Ñå…¡•-•å|¡¥‘Q½­•¸°•áÁ•Ñ•‘¡…¹¹•±%¤°(€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€€€€€•áÀè5…Ñ ¹™±½½È¡9Õµ‰•È¡•áÁ¥É•ÍÐ¤¤°(€€€€€€€±¥¹•UÍ•É%è¥‘•¹Ñ¥Ñä¹±¥¹•UÍ•É%°(€€€€€€€‘¥ÍÁ±…å9…µ”è¥‘•¹Ñ¥Ñä¹‘¥ÍÁ±…å9…µ”°(€€€€€€€Á¥ÑÕÉ•UÉ°è¥‘•¹Ñ¥Ñä¹Á¥ÑÕÉ•UÉ°°(€€€€€€€•µ…¥°è¥‘•¹Ñ¥Ñä¹•µ…¥°°(€€€€€€€Ñ½­•¹%ÍÍÕ•‘Ðè¥‘•¹Ñ¥Ñä¹Ñ½­•¹%ÍÍÕ•‘Ð°(€€€€€ô¤°(€€€€€ÑÑ°(€€€€¤ì(€ô…Ñ €¡}•ÉÉ½È¤ì(€€€€¼¼	•ÍÐ•™™½ÉÐ¸1%9É•µ…¥¹ÌÑ¡”Í½ÕÉ”½˜ÑÉÕÑ ¸(€ô)ô()™Õ¹Ñ¥½¸¥Í)ÝÑ1¥­•|¡Ù…±Õ”¤ì(€É•ÑÕÉ¸€½ymµi„µèÀ´å|µt­p¹mµi„µèÀ´å|µt­p¹mµi„µèÀ´å|µt¬¼¹Ñ•ÍÐ¡MÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¤ì)ô()™Õ¹Ñ¥½¸•¹™½É•1¥¹•Y•É¥™¥…Ñ¥½¹I…Ñ•1¥µ¥Ñ| ¤ì(€Ù…È±½¬ì(€Ù…È…ÅÕ¥É•€ô™…±Í”ì((€ÑÉäì(€€€Ù…ÈÁÉ½Á•ÉÑ¥•Ì€ôAÉ½Á•ÉÑ¥•ÍM•ÉÙ¥”¹•ÑMÉ¥ÁÑAÉ½Á•ÉÑ¥•Ì ¤ì(€€€Ù…È½¹™¥ÕÉ•‘1¥µ¥Ð€ô9Õµ‰•È¡ÁÉ½Á•ÉÑ¥•Ì¹•ÑAÉ½Á•ÉÑä ‰5a}YI%e}IEUMQM}AI}5%9UQˆ¤ñð€ÄÈÀ¤ì(€€€Ù…È±¥µ¥Ð€ô5…Ñ ¹µ…à Ä°5…Ñ ¹µ¥¸ ÄÀÀÀ°5…Ñ ¹™±½½È¡½¹™¥ÕÉ•‘1¥µ¥Ð¤ñð€ÄÈÀ¤¤ì(€€€Ù…Èµ¥¹ÕÑ•	Õ­•Ð€ô5…Ñ ¹™±½½È¡…Ñ”¹¹½Ü ¤€¼€ØÀÀÀÀ¤ì(€€€Ù…È…¡•-•ä€ô€‰…‘µ¥¸µ±¥¹”µÙ•É¥™äµ½Õ¹Ðèˆ€¬µ¥¹ÕÑ•	Õ­•Ðì(€€€±½¬€ô1½­M•ÉÙ¥”¹•ÑMÉ¥ÁÑ1½¬ ¤ì(€€€…ÅÕ¥É•€ô±½¬¹ÑÉå1½¬ ÄÀÀÀ¤ì((€€€¥˜€ ……ÅÕ¥É•¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½É| ‰	UMdˆ°€‹žº‡žB–N‡¦¦_¢¶'¢®/šÆ¢ò–’k¾ò3¢®/ž¢7–ú3–7¢¦›Žˆ¤ì(€€€ô((€€€Ù…È…¡”€ô…¡•M•ÉÙ¥”¹•ÑMÉ¥ÁÑ…¡” ¤ì(€€€Ù…È½Õ¹Ð€ô5…Ñ ¹µ…à À°9Õµ‰•È¡…¡”¹•Ð¡…¡•-•ä¤¤ñð€À¤ì(€€€¥˜€¡½Õ¹Ð€øô±¥µ¥Ð¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½É| ‰1%9}IQ}1%5%Qˆ°€‹žº‡žB–N‡¦¦_¢¶'¢®/šÆ–ÞË¦Sšj¯šf’â+¦fC¾ò3¢®/ž¢7–ú3–7¢¦›Žˆ¤ì(€€€ô(€€€…¡”¹ÁÕÐ¡…¡•-•ä°MÑÉ¥¹œ¡½Õ¹Ð€¬€Ä¤°€ÄÈÀ¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È€˜˜•ÉÉ½È¹…ÁÁ½‘”¤Ñ¡É½Ü•ÉÉ½Èì(€€€€¼¼	•ÍÐ•™™½ÉÐ½¹±äì¥‘•¹Ñ¥ÑäÙ•É¥™¥…Ñ¥½¸ÍÑ¥±°½ÕÉÌ…Ð1%9¸(€ô™¥¹…±±äì(€€€¥˜€¡…ÅÕ¥É•€˜˜±½¬¤±½¬¹É•±•…Í•1½¬ ¤ì(€ô)ô()™Õ¹Ñ¥½¸‰É¥‘•I•ÍÁ½¹Í•|¡É•ÍÕ±Ð°É•ÅÕ•ÍÐ¤ì(€Ù…ÈÑ…É•Ñ=É¥¥¸€ô¥ÍY…±¥‘=É¥¥¹|¡É•ÅÕ•ÍÐ¹…±±‰…­=É¥¥¸¤€üÉ•ÅÕ•ÍÐ¹…±±‰…­=É¥¥¸€è€ˆˆì(€Ù…ÈÍ•É•Ð€ô€½ym„µ˜À´åuìÐáô¼¹Ñ•ÍÐ¡É•ÅÕ•ÍÐ¹É•ÅÕ•ÍÑM•É•Ðñð€ˆˆ¤(€€€€üÉ•ÅÕ•ÍÐ¹É•ÅÕ•ÍÑM•É•Ð(€€€€è€ˆˆì((€¥˜€ …Ñ…É•Ñ=É¥¥¸ñð€…Í•É•Ð¤ì(€€€É•ÑÕÉ¸!Ñµ±M•ÉÙ¥”¹É•…Ñ•!Ñµ±=ÕÑÁÕÐ (€€€€€€ˆð…‘½ÑåÁ”¡Ñµ°øñµ•Ñ„¡…ÉÍ•Ðõp‰ÕÑ˜´ápˆøñÑ¥Ñ±”ù%¹Ù…±¥‰É¥‘”ð½Ñ¥Ñ±”øˆ(€€€€¤¹Í•ÑaÉ…µ•=ÁÑ¥½¹Í5½‘”¡!Ñµ±M•ÉÙ¥”¹aÉ…µ•=ÁÑ¥½¹Í5½‘”¹11=]10¤ì(€ô((€Ù…Èµ•ÍÍ…”€ôì(€€€ÑåÁ”è€‰55	I}M}IMA=9Mˆ°(€€€É•ÅÕ•ÍÑ%èMÑÉ¥¹œ¡É•ÅÕ•ÍÐ¹É•ÅÕ•ÍÑ%ñð€ˆˆ¤°(€€€É•ÅÕ•ÍÑM•É•ÐèÍ•É•Ð°(€€€É•ÍÕ±ÐèÉ•ÍÕ±Ð°(€ôì(€Ù…È¡Ñµ°€ô(€€€€ˆð…‘½ÑåÁ”¡Ñµ°øñ¡Ñµ°øñ¡•…øñµ•Ñ„¡…ÉÍ•Ðõp‰ÕÑ˜´ápˆøñÑ¥Ñ±”ù‘µ¥¸Íå¹Œð½Ñ¥Ñ±”øð½¡•…øˆ€¬(€€€€ˆñ‰½‘äøñÍÉ¥ÁÐùÝ¥¹‘½Ü¹Ñ½À¹Á½ÍÑ5•ÍÍ…” ˆ€¬(€€€Í…™•)Í½¹½É!Ñµ±|¡µ•ÍÍ…”¤€¬(€€€€ˆ°ˆ€¬(€€€Í…™•)Í½¹½É!Ñµ±|¡Ñ…É•Ñ=É¥¥¸¤€¬(€€€€ˆ¤ìñp½ÍÉ¥ÁÐøð½‰½‘äøð½¡Ñµ°øˆì((€É•ÑÕÉ¸!Ñµ±M•ÉÙ¥”¹É•…Ñ•!Ñµ±=ÕÑÁÕÐ¡¡Ñµ°¤¹Í•ÑaÉ…µ•=ÁÑ¥½¹Í5½‘”¡!Ñµ±M•ÉÙ¥”¹aÉ…µ•=ÁÑ¥½¹Í5½‘”¹11=]10¤ì)ô()™Õ¹Ñ¥½¸©Í½¹I•ÍÁ½¹Í•|¡Á…å±½…¤ì(€É•ÑÕÉ¸½¹Ñ•¹ÑM•ÉÙ¥”¹É•…Ñ•Q•áÑ=ÕÑÁÕÐ¡)M=8¹ÍÑÉ¥¹¥™ä¡Á…å±½…¤¤¹Í•Ñ5¥µ•QåÁ”¡½¹Ñ•¹ÑM•ÉÙ¥”¹5¥µ•QåÁ”¹)M=8¤ì)ô()™Õ¹Ñ¥½¸Í…™•)Í½¹½É!Ñµ±|¡Ù…±Õ”¤ì(€É•ÑÕÉ¸)M=8¹ÍÑÉ¥¹¥™ä¡Ù…±Õ”¤(€€€€¹É•Á±…” ¼ð½œ°€‰qqÔÀÀÍŒˆ¤(€€€€¹É•Á±…” ¼ø½œ°€‰qqÔÀÀÍ”ˆ¤(€€€€¹É•Á±…” ¼˜½œ°€‰qqÔÀÀÈØˆ¤(€€€€¹É•Á±…” ½qÔÈÀÈà½œ°€‰qqÔÈÀÈàˆ¤(€€€€¹É•Á±…” ½qÔÈÀÈä½œ°€‰qqÔÈÀÈäˆ¤ì)ô()™Õ¹Ñ¥½¸•ÉÉ½ÉI•ÍÕ±Ñ|¡•ÉÉ½È¤ì(€Ù…È½‘”€ô•ÉÉ½È€˜˜•ÉÉ½È¹…ÁÁ½‘”€ü•ÉÉ½È¹…ÁÁ½‘”€è€‰%9QI91}II=Hˆì(€Ù…Èµ•ÍÍ…”€ô•ÉÉ½È€˜˜•ÉÉ½È¹ÁÕ‰±¥5•ÍÍ…”€ü•ÉÉ½È¹ÁÕ‰±¥5•ÍÍ…”€è€‹–ú3–>ÃžfóžRšr«¦‚Cšržj¦2¿¢ª“Žˆì((€€¼¼9•Ù•È±½œÉ•ÅÕ•ÍÐ‰½‘¥•Ì°%Ñ½­•¹Ì°½È1%9ÕÍ•È%Ì¸(€½¹Í½±”¹•ÉÉ½È ‰‘µ¥¸A$•ÉÉ½È½‘”è€ˆ€¬½‘”¤ì((€É•ÑÕÉ¸ì(€€€½¬è™…±Í”°(€€€½‘”è½‘”°(€€€µ•ÍÍ…”èµ•ÍÍ…”°(€ôì)ô()™Õ¹Ñ¥½¸…ÁÁÉÉ½É|¡½‘”°ÁÕ‰±¥5•ÍÍ…”¤ì(€Ù…È•ÉÉ½È€ô¹•ÜÉÉ½È¡ÁÕ‰±¥5•ÍÍ…”¤ì(€•ÉÉ½È¹…ÁÁ½‘”€ô½‘”ì(€•ÉÉ½È¹ÁÕ‰±¥5•ÍÍ…”€ôÁÕ‰±¥5•ÍÍ…”ì(€É•ÑÕÉ¸•ÉÉ½Èì)ô()™Õ¹Ñ¥½¸µ•µ‰•ÉA¡½¹•É½µI½Ý|¡É½Ü¤ì(€Ù…ÈÁ¡½¹”€ôMÑÉ¥¹œ¡É½Ým55	I}=1U58¹Á¡½¹”€´€Åtñð€ˆˆ¤¹ÑÉ¥´ ¤¹Í±¥” À°€ÌÀ¤ì(€É•ÑÕÉ¸€½xlô­pµt¼¹Ñ•ÍÐ¡Á¡½¹”¤€üÁ¡½¹”¹Í±¥” Ä¤€èÁ¡½¹”ì)ô()™Õ¹Ñ¥½¸µ•µ‰•É	¥ÉÑ¡‘…åÉ½µI½Ý|¡É½Ü¤ì(€Ù…È‰¥ÉÑ¡‘…ä€ôMÑÉ¥¹œ¡É½Ým55	I}=1U58¹‰¥ÉÑ¡‘…ä€´€Åtñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€É•ÑÕÉ¸€½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹Ñ•ÍÐ¡‰¥ÉÑ¡‘…ä¤€ü‰¥ÉÑ¡‘…ä€è€ˆˆì)ô()™Õ¹Ñ¥½¸Í…™•M¡••ÑQ•áÑ|¡Ù…±Õ”¤ì(€Ù…ÈÑ•áÐ€ôMÑÉ¥¹œ¡Ù…±Õ”€ôô¹Õ±°€ü€ˆˆ€èÙ…±Õ”¤ì(€É•ÑÕÉ¸€½ylô­pµt¼¹Ñ•ÍÐ¡Ñ•áÐ¤€ü€ˆœˆ€¬Ñ•áÐ€èÑ•áÐì)ô()™Õ¹Ñ¥½¸Á±…¥¹M¡••ÑQ•áÑ|¡Ù…±Õ”°µ…á1•¹Ñ ¤ì(€Ù…ÈÑ•áÐ€ôMÑÉ¥¹œ¡Ù…±Õ”€ôô¹Õ±°€ü€ˆˆ€èÙ…±Õ”¤¹ÑÉ¥´ ¤ì(€¥˜€ ½xlô­pµt¼¹Ñ•ÍÐ¡Ñ•áÐ¤¤Ñ•áÐ€ôÑ•áÐ¹Í±¥” Ä¤ì(€É•ÑÕÉ¸Ñ•áÐ¹Í±¥” À°µ…á1•¹Ñ ñð€ÈÀÀ¤ì)ô()™Õ¹Ñ¥½¸±¥µ¥ÑQ•áÑ|¡Ù…±Õ”°µ…á1•¹Ñ ¤ì(€É•ÑÕÉ¸MÑÉ¥¹œ¡Ù…±Õ”€ôô¹Õ±°€ü€ˆˆ€èÙ…±Õ”¤¹ÑÉ¥´ ¤¹Í±¥” À°µ…á1•¹Ñ ñð€ÈÀÀ¤ì)ô()™Õ¹Ñ¥½¸¹½Éµ…±¥é•!ÑÑÁÍUÉ±|¡Ù…±Õ”¤ì(€Ù…ÈÕÉ°€ô±¥µ¥ÑQ•áÑ|¡Ù…±Õ”°€ÈÀÀÀ¤ì(€É•ÑÕÉ¸€½y¡ÑÑÁÌép½p¼½¤¹Ñ•ÍÐ¡ÕÉ°¤€üÕÉ°€è€ˆˆì)ô()™Õ¹Ñ¥½¸¹½Éµ…±¥é••ÍÍMÑ…ÑÕÍ|¡Ù…±Õ”¤ì(€Ù…ÈÍÑ…ÑÕÌ€ôMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤ì(€¥˜€ …ÍÑ…ÑÕÌñðÍÑ…ÑÕÌ€ôôô€‰…ÁÁÉ½Ù•ˆñðÍÑ…ÑÕÌ€ôôô€‰…Ñ¥Ù”ˆñðÍÑ…ÑÕÌ€ôôô€‰Á•¹‘¥¹œˆ¤ì(€€€É•ÑÕÉ¸€‰…ÁÁÉ½Ù•ˆì(€ô(€¥˜€¡ÍÑ…ÑÕÌ€ôôô€‰‘•¹¥•ˆ¤É•ÑÕÉ¸€‰‘•¹¥•ˆì(€É•ÑÕÉ¸€‰Á•¹‘¥¹œˆì)ô()™Õ¹Ñ¥½¸ÍÑÉ¥Ñ‘µ¥¹MÑ…ÑÕÍ|¡Ù…±Õ”¤ì(€Ù…ÈÍÑ…ÑÕÌ€ôMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤ì(€É•ÑÕÉ¸ÍÑ…ÑÕÌ€ôôô€‰…ÁÁÉ½Ù•ˆñðÍÑ…ÑÕÌ€ôôô€‰Á•¹‘¥¹œˆñðÍÑ…ÑÕÌ€ôôô€‰‘•¹¥•ˆ(€€€€üÍÑ…ÑÕÌ(€€€€è€ˆˆì)ô()™Õ¹Ñ¥½¸‘…Ñ•M½ÉÑY…±Õ•|¡Ù…±Õ”¤ì(€Ù…È‘…Ñ”€ôÙ…±Õ”¥¹ÍÑ…¹•½˜…Ñ”€üÙ…±Õ”€è¹•Ü…Ñ”¡Ù…±Õ”¤ì(€Ù…ÈÑ¥µ•ÍÑ…µÀ€ô‘…Ñ”¹•ÑQ¥µ” ¤ì(€É•ÑÕÉ¸¥Í9…8¡Ñ¥µ•ÍÑ…µÀ¤€ü€À€èÑ¥µ•ÍÑ…µÀì)ô()™Õ¹Ñ¥½¸Ñ½%Í½MÑÉ¥¹|¡Ù…±Õ”¤ì(€¥˜€¡Ù…±Õ”€ôôô€ˆˆñðÙ…±Õ”€ôôô¹Õ±°ñðÙ…±Õ”€ôôôÕ¹‘•™¥¹•¤É•ÑÕÉ¸€ˆˆì(€Ù…È‘…Ñ”€ôÙ…±Õ”¥¹ÍÑ…¹•½˜…Ñ”€üÙ…±Õ”€è¹•Ü…Ñ”¡Ù…±Õ”¤ì(€É•ÑÕÉ¸¥Í9…8¡‘…Ñ”¹•ÑQ¥µ” ¤¤€ü€ˆˆ€è‘…Ñ”¹Ñ½%M=MÑÉ¥¹œ ¤ì)ô(