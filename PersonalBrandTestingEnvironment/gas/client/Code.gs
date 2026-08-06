/**
 * PERSONA MEMBERS - client-only Google Apps Script backend
 *
 * Required Script Properties:
 * - LINE_CHANNEL_ID: member LIFF LINE Login channel ID (for example 2010787602)
 * - SPREADSHEET_ID: Google Sheet ID shared with the administrator backend
 * - ALLOWED_ORIGINS: comma-separated frontend origins
 *
 * Optional:
 * - SHEET_NAME: defaults to "Members"
 * - POINT_TYPE_SHEET_NAME: defaults to "PointTypes"
 * - POINT_CAMPAIGN_SHEET_NAME: defaults to "PointCampaigns"
 * - POINT_REDEMPTION_SHEET_NAME: defaults to "PointRedemptions"
 * - POINT_CARD_SETTING_SHEET_NAME: defaults to "PointCardSettings"
 * - LOTTERY_TYPE_SHEET_NAME: defaults to "LotteryTypes"
 * - LOTTERY_PRIZE_SHEET_NAME: defaults to "LotteryPrizes"
 * - LOTTERY_DRAW_SHEET_NAME: defaults to "LotteryDraws"
 * - MAX_VERIFY_REQUESTS_PER_MINUTE: defaults to 120 (1-1000)
 *
 * This deployment accepts only member-owned actions. It deliberately does not
 * authorize or implement administrator actions.
 */

var API_VERSION = "1.10.0";
var DEFAULT_SHEET_NAME = "Members";
var DEFAULT_POINT_TYPE_SHEET_NAME = "PointTypes";
var DEFAULT_POINT_CAMPAIGN_SHEET_NAME = "PointCampaigns";
var DEFAULT_POINT_REDEMPTION_SHEET_NAME = "PointRedemptions";
var DEFAULT_POINT_CARD_SETTING_SHEET_NAME = "PointCardSettings";
var DEFAULT_LOTTERY_TYPE_SHEET_NAME = "LotteryTypes";
var DEFAULT_LOTTERY_PRIZE_SHEET_NAME = "LotteryPrizes";
var DEFAULT_LOTTERY_DRAW_SHEET_NAME = "LotteryDraws";
var MAX_POINT_HISTORY_ENTRIES = 30;
var MAX_POINT_VALUE = 9999;
var DEFAULT_POINT_CARD_TARGET = 5;
var LEGACY_LOTTERY_TICKET_COST = 5;
var DEFAULT_LOTTERY_TYPE_ID = "LTY-DEFAULT001";
var DEFAULT_LOTTERY_TYPE_NAME = "ç¶“å…¸è½‰ç›¤";
var DEFAULT_POINT_CARD_SETTING_VERSION = "PCS-DEFAULT00001";
var MIN_LOTTERY_PRIZES = 2;
var MAX_LOTTERY_PRIZES = 12;
var MAX_AVAILABLE_REWARD_TICKETS = 50;
var LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
var MAX_ID_TOKEN_LENGTH = 6000;
var LINE_VERIFY_CACHE_SECONDS = 60;

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

// Preserve the exact former 21-column schema, then append editable profile
// fields so existing indexes and spreadsheet data never move.
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
  "config_version",
  "prize_id",
  "label",
  "color",
  "probability_basis_points",
  "sort_order",
  "status",
  "updated_at",
  "updated_by",
  "last_request_id",
];

var LOTTERY_PRIZE_HEADERS = LEGACY_LOTTERY_PRIZE_HEADERS.concat([
  "lottery_type_id",
]);

var LOTTERY_PRIZE_COLUMN = {
  configVersion: 1,
  prizeId: 2,
  label: 3,
  color: 4,
  probabilityBasisPoints: 5,
  sortOrder: 6,
  status: 7,
  updatedAt: 8,
  updatedBy: 9,
  lastRequestId: 10,
  lotteryTypeId: 11,
};

var LEGACY_LOTTERY_DRAW_HEADERS = [
  "draw_id",
  "config_version",
  "prize_id",
  "prize_label_snapshot",
  "prize_color_snapshot",
  "probability_basis_points_snapshot",
  "member_id",
  "line_user_id",
  "points_spent",
  "balance_before",
  "balance_after",
  "drawn_at",
  "request_id",
];

var LOTTERY_DRAW_HEADERS = LEGACY_LOTTERY_DRAW_HEADERS.concat([
  "lottery_type_id",
  "card_setting_version",
  "card_round_key",
]);

var LOTTERY_DRAW_COLUMN = {
  drawId: 1,
  configVersion: 2,
  prizeId: 3,
  prizeLabelSnapshot: 4,
  prizeColorSnapshot: 5,
  probabilityBasisPointsSnapshot: 6,
  memberId: 7,
  lineUserId: 8,
  pointsSpent: 9,
  balanceBefore: 10,
  balanceAfter: 11,
  drawnAt: 12,
  requestId: 13,
  lotteryTypeId: 14,
  cardSettingVersion: 15,
  cardRoundKey: 16,
};

function doGet(e) {
  var action = e && e.parameter ? String(e.parameter.action || "") : "";
  var requestId = e && e.parameter ? String(e.parameter.requestId || "") : "";

  if (!action || action === "health") {
    return jsonResponse_({
      ok: true,
      requestId: requestId,
²È="25¥¹M•½¹‘Ì¤ì(€€€…¡•M•ÉÙ¥”¹•ÑMÉ¥ÁÑ…¡” ¤¹ÁÕÐ (€€€€€±¥¹•%‘•¹Ñ¥Ñå…¡•-•å|¡¥‘Q½­•¸°•áÁ•Ñ•‘¡…¹¹•±%¤°(€€€€€)M=8¹ÍÑÉ¥¹¥™ä¡ì(€€€€€€€•áÀè5…Ñ ¹™±½½È¡9Õµ‰•È¡•áÁ¥É•ÍÐ¤¤°(€€€€€€€±¥¹•UÍ•É%è¥‘•¹Ñ¥Ñä¹±¥¹•UÍ•É%°(€€€€€€€‘¥ÍÁ±…å9…µ”è¥‘•¹Ñ¥Ñä¹‘¥ÍÁ±…å9…µ”°(€€€€€€€Á¥ÑÕÉ•UÉ°è¥‘•¹Ñ¥Ñä¹Á¥ÑÕÉ•UÉ°°(€€€€€€€Ñ½­•¹%ÍÍÕ•‘Ðè¥‘•¹Ñ¥Ñä¹Ñ½­•¹%ÍÍÕ•‘Ð°(€€€€€ô¤°(€€€€€ÑÑ°(€€€€¤ì(€ô…Ñ €¡}•ÉÉ½È¤ì(€€€€¼¼	•ÍÐ•™™½ÉÐ¸1%9É•µ…¥¹ÌÑ¡”Í½ÕÉ”½˜ÑÉÕÑ ¸(€ô)ô()™Õ¹Ñ¥½¸¥Í)ÝÑ1¥­•|¡Ù…±Õ”¤ì(€É•ÑÕÉ¸€½ymµi„µèÀ´å|µt­p¹mµi„µèÀ´å|µt­p¹mµi„µèÀ´å|µt¬¼¹Ñ•ÍÐ¡MÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¤ì)ô()™Õ¹Ñ¥½¸•¹™½É•1¥¹•Y•É¥™¥…Ñ¥½¹I…Ñ•1¥µ¥Ñ| ¤ì(€Ù…È±½¬ì(€Ù…È…ÅÕ¥É•€ô™…±Í”ì((€ÑÉäì(€€€Ù…ÈÁÉ½Á•ÉÑ¥•Ì€ôAÉ½Á•ÉÑ¥•ÍM•ÉÙ¥”¹•ÑMÉ¥ÁÑAÉ½Á•ÉÑ¥•Ì ¤ì(€€€Ù…È½¹™¥ÕÉ•‘1¥µ¥Ð€ô9Õµ‰•È¡ÁÉ½Á•ÉÑ¥•Ì¹•ÑAÉ½Á•ÉÑä ‰5a}YI%e}IEUMQM}AI}5%9UQˆ¤ñð€ÄÈÀ¤ì(€€€Ù…È±¥µ¥Ð€ô5…Ñ ¹µ…à Ä°5…Ñ ¹µ¥¸ ÄÀÀÀ°5…Ñ ¹™±½½È¡½¹™¥ÕÉ•‘1¥µ¥Ð¤ñð€ÄÈÀ¤¤ì(€€€Ù…Èµ¥¹ÕÑ•	Õ­•Ð€ô5…Ñ ¹™±½½È¡…Ñ”¹¹½Ü ¤€¼€ØÀÀÀÀ¤ì(€€€Ù…È…¡•-•ä€ô€‰±¥¹”µÙ•É¥™äµ½Õ¹Ðèˆ€¬µ¥¹ÕÑ•	Õ­•Ðì(€€€±½¬€ô1½­M•ÉÙ¥”¹•ÑMÉ¥ÁÑ1½¬ ¤ì(€€€…ÅÕ¥É•€ô±½¬¹ÑÉå1½¬ ÄÀÀÀ¤ì((€€€¥˜€ ……ÅÕ¥É•¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½É| ‰	UMdˆ°€‹šr–N‡¦¦_¢¶'¢®/šÆ¢ò–’k¾ò3¢®/ž¢7–ú3–7¢¦›Žˆ¤ì(€€€ô((€€€Ù…È…¡”€ô…¡•M•ÉÙ¥”¹•ÑMÉ¥ÁÑ…¡” ¤ì(€€€Ù…È½Õ¹Ð€ô5…Ñ ¹µ…à À°9Õµ‰•È¡…¡”¹•Ð¡…¡•-•ä¤¤ñð€À¤ì(€€€¥˜€¡½Õ¹Ð€øô±¥µ¥Ð¤ì(€€€€€Ñ¡É½Ü…ÁÁÉÉ½É| ‰1%9}IQ}1%5%Qˆ°€‹šr–N‡¦¦_¢¶'¢®/šÆ–ÞË¦Sšj¯šf’â+¦fC¾ò3¢®/ž¢7–ú3–7¢¦›Žˆ¤ì(€€€ô(€€€…¡”¹ÁÕÐ¡…¡•-•ä°MÑÉ¥¹œ¡½Õ¹Ð€¬€Ä¤°€ÄÈÀ¤ì(€ô…Ñ €¡•ÉÉ½È¤ì(€€€¥˜€¡•ÉÉ½È€˜˜•ÉÉ½È¹…ÁÁ½‘”¤Ñ¡É½Ü•ÉÉ½Èì(€€€€¼¼	•ÍÐµ•™™½ÉÐÉ…Ñ”±¥µ¥Ñ¥¹œ¸1%9ÍÑ¥±°Ù…±¥‘…Ñ•Ì¥‘•¹Ñ¥Ñä¸(€ô™¥¹…±±äì(€€€¥˜€¡…ÅÕ¥É•€˜˜±½¬¤±½¬¹É•±•…Í•1½¬ ¤ì(€ô)ô()™Õ¹Ñ¥½¸‰É¥‘•I•ÍÁ½¹Í•|¡É•ÍÕ±Ð°É•ÅÕ•ÍÐ¤ì(€Ù…ÈÑ…É•Ñ=É¥¥¸€ô¥ÍY…±¥‘=É¥¥¹|¡É•ÅÕ•ÍÐ¹…±±‰…­=É¥¥¸¤€üÉ•ÅÕ•ÍÐ¹…±±‰…­=É¥¥¸€è€ˆˆì(€Ù…ÈÍ•É•Ð€ô€½ym„µ˜À´åuìÐáô¼¹Ñ•ÍÐ¡É•ÅÕ•ÍÐ¹É•ÅÕ•ÍÑM•É•Ðñð€ˆˆ¤€üÉ•ÅÕ•ÍÐ¹É•ÅÕ•ÍÑM•É•Ð€è€ˆˆì((€¥˜€ …Ñ…É•Ñ=É¥¥¸ñð€…Í•É•Ð¤ì(€€€É•ÑÕÉ¸!Ñµ±M•ÉÙ¥”(€€€€€€¹É•…Ñ•!Ñµ±=ÕÑÁÕÐ ˆð…‘½ÑåÁ”¡Ñµ°øñµ•Ñ„¡…ÉÍ•Ðõp‰ÕÑ˜´ápˆøñÑ¥Ñ±”ù%¹Ù…±¥‰É¥‘”ð½Ñ¥Ñ±”øˆ¤(€€€€€€¹Í•ÑaÉ…µ•=ÁÑ¥½¹Í5½‘”¡!Ñµ±M•ÉÙ¥”¹aÉ…µ•=ÁÑ¥½¹Í5½‘”¹11=]10¤ì(€ô((€Ù…Èµ•ÍÍ…”€ôì(€€€ÑåÁ”è€‰55	I}M}IMA=9Mˆ°(€€€É•ÅÕ•ÍÑ%èMÑÉ¥¹œ¡É•ÅÕ•ÍÐ¹É•ÅÕ•ÍÑ%ñð€ˆˆ¤°(€€€É•ÅÕ•ÍÑM•É•ÐèÍ•É•Ð°(€€€É•ÍÕ±ÐèÉ•ÍÕ±Ð°(€ôì(€Ù…È¡Ñµ°€ô(€€€€ˆð…‘½ÑåÁ”¡Ñµ°øñ¡Ñµ°øñ¡•…øñµ•Ñ„¡…ÉÍ•Ðõp‰ÕÑ˜´ápˆøñÑ¥Ñ±”ù5•µ‰•ÈÍå¹Œð½Ñ¥Ñ±”øð½¡•…øˆ€¬(€€€€ˆñ‰½‘äøñÍÉ¥ÁÐùÝ¥¹‘½Ü¹Ñ½À¹Á½ÍÑ5•ÍÍ…” ˆ€¬(€€€Í…™•)Í½¹½É!Ñµ±|¡µ•ÍÍ…”¤€¬(€€€€ˆ°ˆ€¬(€€€Í…™•)Í½¹½É!Ñµ±|¡Ñ…É•Ñ=É¥¥¸¤€¬(€€€€ˆ¤ìñp½ÍÉ¥ÁÐøð½‰½‘äøð½¡Ñµ°øˆì((€É•ÑÕÉ¸!Ñµ±M•ÉÙ¥”(€€€€¹É•…Ñ•!Ñµ±=ÕÑÁÕÐ¡¡Ñµ°¤(€€€€¹Í•ÑaÉ…µ•=ÁÑ¥½¹Í5½‘”¡!Ñµ±M•ÉÙ¥”¹aÉ…µ•=ÁÑ¥½¹Í5½‘”¹11=]10¤ì)ô()™Õ¹Ñ¥½¸©Í½¹I•ÍÁ½¹Í•|¡Á…å±½…¤ì(€É•ÑÕÉ¸½¹Ñ•¹ÑM•ÉÙ¥”(€€€€¹É•…Ñ•Q•áÑ=ÕÑÁÕÐ¡)M=8¹ÍÑÉ¥¹¥™ä¡Á…å±½…¤¤(€€€€¹Í•Ñ5¥µ•QåÁ”¡½¹Ñ•¹ÑM•ÉÙ¥”¹5¥µ•QåÁ”¹)M=8¤ì)ô()™Õ¹Ñ¥½¸Í…™•)Í½¹½É!Ñµ±|¡Ù…±Õ”¤ì(€É•ÑÕÉ¸)M=8¹ÍÑÉ¥¹¥™ä¡Ù…±Õ”¤(€€€€¹É•Á±…” ¼ð½œ°€‰qqÔÀÀÍŒˆ¤(€€€€¹É•Á±…” ¼ø½œ°€‰qqÔÀÀÍ”ˆ¤(€€€€¹É•Á±…” ¼˜½œ°€‰qqÔÀÀÈØˆ¤(€€€€¹É•Á±…” ½qÔÈÀÈà½œ°€‰qqÔÈÀÈàˆ¤(€€€€¹É•Á±…” ½qÔÈÀÈä½œ°€‰qqÔÈÀÈäˆ¤ì)ô()™Õ¹Ñ¥½¸•ÉÉ½ÉI•ÍÕ±Ñ|¡•ÉÉ½È¤ì(€Ù…È½‘”€ô•ÉÉ½È€˜˜•ÉÉ½È¹…ÁÁ½‘”€ü•ÉÉ½È¹…ÁÁ½‘”€è€‰%9QI91}II=Hˆì(€Ù…Èµ•ÍÍ…”€ô•ÉÉ½È€˜˜•ÉÉ½È¹ÁÕ‰±¥5•ÍÍ…”€ü•ÉÉ½È¹ÁÕ‰±¥5•ÍÍ…”€è€‹–ú3–>ÃžfóžRšr«¦‚Cšržj¦2¿¢ª“Žˆì((€€¼¼9•Ù•È±½œÉ•ÅÕ•ÍÐ‰½‘¥•Ì½È1%9Ñ½­•¹Ì¸(€½¹Í½±”¹•ÉÉ½È ‰5•µ‰•È±¥•¹ÐA$•ÉÉ½È½‘”è€ˆ€¬½‘”¤ì(€É•ÑÕÉ¸ì½¬è™…±Í”°½‘”è½‘”°µ•ÍÍ…”èµ•ÍÍ…”ôì)ô()™Õ¹Ñ¥½¸…ÁÁÉÉ½É|¡½‘”°ÁÕ‰±¥5•ÍÍ…”¤ì(€Ù…È•ÉÉ½È€ô¹•ÜÉÉ½È¡ÁÕ‰±¥5•ÍÍ…”¤ì(€•ÉÉ½È¹…ÁÁ½‘”€ô½‘”ì(€•ÉÉ½È¹ÁÕ‰±¥5•ÍÍ…”€ôÁÕ‰±¥5•ÍÍ…”ì(€É•ÑÕÉ¸•ÉÉ½Èì)ô()™Õ¹Ñ¥½¸¹½Éµ…±¥é•A½¥¹Ñ±…¥µ|¡Ù…±Õ”¤ì(€Ù…È±…¥´€ôMÑÉ¥¹œ¡Ù…±Õ”€ôô¹Õ±°€ü€ˆˆ€èÙ…±Õ”¤¹ÑÉ¥´ ¤ì(€¥˜€ „½ymµi„µèÀ´å|µuìÐÍô¼¹Ñ•ÍÐ¡±…¥´¤¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½É| ‰%9Y1%}A=%9Q}1%4ˆ°€‰EH½‘”ƒ¦‚c¦î{šG¢¶'š‚ó–ò?’â7š¶žŠëŽˆ¤ì(€ô(€É•ÑÕÉ¸±…¥´ì)ô()™Õ¹Ñ¥½¸Í¡„ÈÔÙ!•á|¡Ù…±Õ”¤ì(€Ù…È‰åÑ•Ì€ôUÑ¥±¥Ñ¥•Ì¹½µÁÕÑ•¥•ÍÐ (€€€UÑ¥±¥Ñ¥•Ì¹¥•ÍÑ±½É¥Ñ¡´¹M!|ÈÔØ°(€€€MÑÉ¥¹œ¡Ù…±Õ”¤°(€€€UÑ¥±¥Ñ¥•Ì¹¡…ÉÍ•Ð¹UQ|à(€€¤ì(€É•ÑÕÉ¸‰åÑ•Ì(€€€€¹µ…À¡™Õ¹Ñ¥½¸€¡‰åÑ”¤ì(€€€€€É•ÑÕÉ¸€ ¡‰åÑ”€¬€ÈÔØ¤€”€ÈÔØ¤¹Ñ½MÑÉ¥¹œ ÄØ¤¹Á…‘MÑ…ÉÐ È°€ˆÀˆ¤ì(€€€ô¤(€€€€¹©½¥¸ ˆˆ¤ì)ô()™Õ¹Ñ¥½¸Á±…¥¹M¡••ÑQ•áÑ|¡Ù…±Õ”°µ…á1•¹Ñ ¤ì(€Ù…ÈÑ•áÐ€ôMÑÉ¥¹œ¡Ù…±Õ”€ôô¹Õ±°€ü€ˆˆ€èÙ…±Õ”¤¹ÑÉ¥´ ¤ì(€¥˜€ ½xlô­pµt¼¹Ñ•ÍÐ¡Ñ•áÐ¤¤Ñ•áÐ€ôÑ•áÐ¹Í±¥” Ä¤ì(€É•ÑÕÉ¸Ñ•áÐ¹Í±¥” À°µ…á1•¹Ñ ñð€ÈÀÀ¤ì)ô()™Õ¹Ñ¥½¸¹½Éµ…±¥é•A½¥¹Ñ	…±…¹•|¡Ù…±Õ”¤ì(€Ù…È‰…±…¹”€ô9Õµ‰•È¡Ù…±Õ”ñð€À¤ì(€É•ÑÕÉ¸9Õµ‰•È¹¥Í%¹Ñ••È¡‰…±…¹”¤€˜˜‰…±…¹”€øô€À€˜˜‰…±…¹”€ðô€äÀÀÜÄääÈÔÐÜÐÀääÄ(€€€€ü‰…±…¹”(€€€€è€Àì)ô()™Õ¹Ñ¥½¸¹½Éµ…±¥é•5•µ‰•ÉA¡½¹•|¡Ù…±Õ”¤ì(€Ù…ÈÁ¡½¹”€ôMÑÉ¥¹œ¡Ù…±Õ”€ôô¹Õ±°€ü€ˆˆ€èÙ…±Õ”¤¹ÑÉ¥´ ¤ì(€¥˜€ …Á¡½¹”¤É•ÑÕÉ¸€ˆˆì((€Ù…È‘¥¥Ñ½Õ¹Ð€ôÁ¡½¹”¹É•Á±…” ½q½œ°€ˆˆ¤¹±•¹Ñ ì(€¥˜€ (€€€Á¡½¹”¹±•¹Ñ €ø€ÌÀñð(€€€€„½ylÀ´ä¬ ¤¹p´€áat¬¼¹Ñ•ÍÐ¡Á¡½¹”¤ñð(€€€‘¥¥Ñ½Õ¹Ð€ð€Øñð(€€€‘¥¥Ñ½Õ¹Ð€ø€ÈÀ(€€¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½É| (€€€€€€‰%9Y1%}A!=9ˆ°(€€€€€€‹¦nï¢¦Çš‚ó–ò?’â7š¶žŠë¾ò3¢®/¢òã–”€Øƒ¢Ì€ÈÀƒ’ö7šVã–¶_¾ò3–>¿’öÿžR£ž¦ëš‚óŽ¯Ž·Žš.³¢fš"[–"š¦ž²›¢fŽˆ(€€€€¤ì(€ô((€É•ÑÕÉ¸Á¡½¹”ì)ô()™Õ¹Ñ¥½¸¹½Éµ…±¥é•5•µ‰•É	¥ÉÑ¡‘…å|¡Ù…±Õ”¤ì(€Ù…È‰¥ÉÑ¡‘…ä€ôMÑÉ¥¹œ¡Ù…±Õ”€ôô¹Õ±°€ü€ˆˆ€èÙ…±Õ”¤¹ÑÉ¥´ ¤ì(€¥˜€ …‰¥ÉÑ¡‘…ä¤É•ÑÕÉ¸€ˆˆì((€Ù…Èµ…Ñ €ô€½x¡q‘ìÑô¤´¡q‘ìÉô¤´¡q‘ìÉô¤¼¹•á•Œ¡‰¥ÉÑ¡‘…ä¤ì(€¥˜€ …µ…Ñ ¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½É| ‰%9Y1%}	%IQ!dˆ°€‹žRš^—š‚ó–ò?’â7š¶žŠë¾ò3¢®/’öÿžR eeedµ54µŽˆ¤ì(€ô((€Ù…Èå•…È€ô9Õµ‰•È¡µ…Ñ¡lÅt¤ì(€Ù…Èµ½¹Ñ €ô9Õµ‰•È¡µ…Ñ¡lÉt¤ì(€Ù…È‘…ä€ô9Õµ‰•È¡µ…Ñ¡lÍt¤ì(€Ù…È‘…Ñ”€ô¹•Ü…Ñ”¡…Ñ”¹UQ¡å•…È°µ½¹Ñ €´€Ä°‘…ä¤¤ì(€¥˜€ (€€€‘…Ñ”¹•ÑUQÕ±±e•…È ¤€„ôôå•…Èñð(€€€‘…Ñ”¹•ÑUQ5½¹Ñ  ¤€„ôôµ½¹Ñ €´€Äñð(€€€‘…Ñ”¹•ÑUQ…Ñ” ¤€„ôô‘…ä(€€¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½É| ‰%9Y1%}	%IQ!dˆ°€‹žRš^—’â7šb¿šr'šV#žjš^—šrŽˆ¤ì(€ô((€Ù…ÈÑ½‘…ä€ôUÑ¥±¥Ñ¥•Ì¹™½Éµ…Ñ…Ñ”¡¹•Ü…Ñ” ¤°€‰Í¥„½Q…¥Á•¤ˆ°€‰åååäµ54µ‘ˆ¤ì(€¥˜€¡‰¥ÉÑ¡‘…ä€øÑ½‘…ä¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½É| ‰%9Y1%}	%IQ!dˆ°€‹žRš^—’â7–>¿šfkšZó’î+–’§Žˆ¤ì(€ô((€É•ÑÕÉ¸‰¥ÉÑ¡‘…äì)ô()™Õ¹Ñ¥½¸¹½Éµ…±¥é•I•ÅÕ¥É•‘5•µ‰•ÉAÉ½™¥±•|¡Á¡½¹•Y…±Õ”°‰¥ÉÑ¡‘…åY…±Õ”¤ì(€Ù…ÈÁ¡½¹”€ô¹½Éµ…±¥é•5•µ‰•ÉA¡½¹•|¡Á¡½¹•Y…±Õ”¤ì(€Ù…È‰¥ÉÑ¡‘…ä€ô¹½Éµ…±¥é•5•µ‰•É	¥ÉÑ¡‘…å|¡‰¥ÉÑ¡‘…åY…±Õ”¤ì(€¥˜€ …Á¡½¹”¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½É| ‰%9Y1%}A!=9ˆ°€‹¢®/–†¯–¾¯¦nï¢¦Ç–ú3–7–Ë–¶cšr–N‡¢ÎšZgŽˆ¤ì(€ô(€¥˜€ …‰¥ÉÑ¡‘…ä¤ì(€€€Ñ¡É½Ü…ÁÁÉÉ½É| ‰%9Y1%}	%IQ!dˆ°€‹¢®/–†¯–¾¯žRš^—–ú3–7–Ë–¶cšr–N‡¢ÎšZgŽˆ¤ì(€ô(€É•ÑÕÉ¸ì(€€€Á¡½¹”èÁ¡½¹”°(€€€‰¥ÉÑ¡‘…äè‰¥ÉÑ¡‘…ä°(€ôì)ô()™Õ¹Ñ¥½¸µ•µ‰•ÉA¡½¹•É½µI½Ý|¡É½Ü¤ì(€Ù…ÈÁ¡½¹”€ôMÑÉ¥¹œ¡É½Ým55	I}=1U58¹Á¡½¹”€´€Åtñð€ˆˆ¤¹ÑÉ¥´ ¤¹Í±¥” À°€ÌÀ¤ì(€É•ÑÕÉ¸€½xlô­pµt¼¹Ñ•ÍÐ¡Á¡½¹”¤€üÁ¡½¹”¹Í±¥” Ä¤€èÁ¡½¹”ì)ô()™Õ¹Ñ¥½¸µ•µ‰•É	¥ÉÑ¡‘…åÉ½µI½Ý|¡É½Ü¤ì(€Ù…È‰¥ÉÑ¡‘…ä€ôMÑÉ¥¹œ¡É½Ým55	I}=1U58¹‰¥ÉÑ¡‘…ä€´€Åtñð€ˆˆ¤¹ÑÉ¥´ ¤ì(€É•ÑÕÉ¸€½yq‘ìÑôµq‘ìÉôµq‘ìÉô¼¹Ñ•ÍÐ¡‰¥ÉÑ¡‘…ä¤€ü‰¥ÉÑ¡‘…ä€è€ˆˆì)ô()™Õ¹Ñ¥½¸Í…™•M¡••ÑQ•áÑ|¡Ù…±Õ”¤ì(€Ù…ÈÑ•áÐ€ôMÑÉ¥¹œ¡Ù…±Õ”€ôô¹Õ±°€ü€ˆˆ€èÙ…±Õ”¤ì(€É•ÑÕÉ¸€½ylô­pµt¼¹Ñ•ÍÐ¡Ñ•áÐ¤€ü€ˆœˆ€¬Ñ•áÐ€èÑ•áÐì)ô()™Õ¹Ñ¥½¸±¥µ¥ÑQ•áÑ|¡Ù…±Õ”°µ…á1•¹Ñ ¤ì(€É•ÑÕÉ¸MÑÉ¥¹œ¡Ù…±Õ”€ôô¹Õ±°€ü€ˆˆ€èÙ…±Õ”¤¹ÑÉ¥´ ¤¹Í±¥” À°µ…á1•¹Ñ ñð€ÈÀÀ¤ì)ô()™Õ¹Ñ¥½¸¹½Éµ…±¥é•!ÑÑÁÍUÉ±|¡Ù…±Õ”¤ì(€Ù…ÈÕÉ°€ô±¥µ¥ÑQ•áÑ|¡Ù…±Õ”°€ÈÀÀÀ¤ì(€É•ÑÕÉ¸€½y¡ÑÑÁÌép½p¼½¤¹Ñ•ÍÐ¡ÕÉ°¤€üÕÉ°€è€ˆˆì)ô()™Õ¹Ñ¥½¸¹½Éµ…±¥é••ÍÍMÑ…ÑÕÍ|¡Ù…±Õ”¤ì(€Ù…ÈÍÑ…ÑÕÌ€ôMÑÉ¥¹œ¡Ù…±Õ”ñð€ˆˆ¤¹ÑÉ¥´ ¤¹Ñ½1½Ý•É…Í” ¤ì(€¥˜€ …ÍÑ…ÑÕÌñðÍÑ…ÑÕÌ€ôôô€‰…ÁÁÉ½Ù•ˆñðÍÑ…ÑÕÌ€ôôô€‰…Ñ¥Ù”ˆñðÍÑ…ÑÕÌ€ôôô€‰Á•¹‘¥¹œˆ¤ì(€€€É•ÑÕÉ¸€‰…ÁÁÉ½Ù•ˆì(€ô(€¥˜€¡ÍÑ…ÑÕÌ€ôôô€‰‘•¹¥•ˆ¤É•ÑÕÉ¸€‰‘•¹¥•ˆì(€É•ÑÕÉ¸€‰Á•¹‘¥¹œˆì)ô()™Õ¹Ñ¥½¸Ñ½%Í½MÑÉ¥¹|¡Ù…±Õ”¤ì(€Ù…È‘…Ñ”€ôÙ…±Õ”¥¹ÍÑ…¹•½˜…Ñ”€üÙ…±Õ”€è¹•Ü…Ñ”¡Ù…±Õ”¤ì(€É•ÑÕÉ¸¥Í9…8¡‘…Ñ”¹•ÑQ¥µ” ¤¤€ü€ˆˆ€è‘…Ñ”¹Ñ½%M=MÑÉ¥¹œ ¤ì)ô((((