var GAS_SCALE_WARNING_ROWS = 5000;
var GAS_SCALE_CRITICAL_ROWS = 20000;

/**
 * Manual, read-only diagnostic for the member GAS project.
 * Run from the Apps Script editor when investigating latency or quota pressure.
 *
 * It returns only aggregate row/cell counts and never reads or logs member,
 * LINE, request, prize, or campaign values.
 */
function diagnoseMemberGasScale() {
  var config = getConfig_();
  var spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  var definitions = [
    {
      key: "members",
      sheetName: config.sheetName,
      width: MEMBER_HEADERS.length,
    },
    {
      key: "pointRedemptions",
      sheetName: config.pointRedemptionSheetName,
      width: POINT_REDEMPTION_HEADERS.length,
    },
    {
      key: "pointCardSettings",
      sheetName: config.pointCardSettingSheetName,
      width: POINT_CARD_SETTING_HEADERS.length,
    },
    {
      key: "lotteryTypes",
      sheetName: config.lotteryTypeSheetName,
      width: LOTTERY_TYPE_HEADERS.length,
    },
    {
      key: "lotteryPrizes",
      sheetName: config.lotteryPrizeSheetName,
      width: LOTTERY_PRIZE_HEADERS.length,
    },
    {
      key: "lotteryDraws",
      sheetName: config.lotteryDrawSheetName,
      width: LOTTERY_DRAW_HEADERS.length,
    },
  ];

  var tables = definitions.map(function (definition) {
    var sheet = spreadsheet.getSheetByName(definition.sheetName);
    var dataRows = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
    var estimatedCells = dataRows * definition.width;
    return {
      key: definition.key,
      rows: dataRows,
      columns: definition.width,
      estimatedCells: estimatedCells,
      risk: gasScaleRiskForRows_(dataRows),
    };
  });

  var byKey = Object.create(null);
  tables.forEach(function (table) {
    byKey[table.key] = table;
  });

  var estimatedReadCells = {
    listPointHistory:
      byKey.members.rows +
      byKey.pointRedemptions.estimatedCells * 2 +
      byKey.lotteryDraws.estimatedCells,
    getLotteryConfig:
      byKey.members.rows +
      byKey.pointRedemptions.estimatedCells +
      byKey.pointCardSettings.estimatedCells +
      byKey.lotteryTypes.estimatedCells +
      byKey.lotteryPrizes.estimatedCells +
      byKey.lotteryDraws.estimatedCells,
  };

  var recommendations = [];
  if (byKey.pointRedemptions.rows >= GAS_SCALE_WARNING_ROWS) {
    recommendations.push(
      "PointRedemptions 已進入高掃描成本區間；優先規劃會員索引、分區或封存。"
    );
  }
  if (byKey.lotteryDraws.rows >= GAS_SCALE_WARNING_ROWS) {
    recommendations.push(
      "LotteryDraws 已進入高掃描成本區間；優先規劃 request/member 索引或歷史封存。"
    );
  }
  if (byKey.members.rows >= GAS_SCALE_WARNING_ROWS) {
    recommendations.push(
      "Members 已進入高掃描成本區間；findMemberRow_ 的線性掃描應改為索引查找。"
    );
  }
  if (!recommendations.length) {
    recommendations.push(
      "目前資料量仍在可控區間；持續用實際 LIFF latency 驗證，不需要提前過度設計。"
    );
  }

  var snapshot = {
    generatedAt: new Date().toISOString(),
    thresholds: {
      warningRows: GAS_SCALE_WARNING_ROWS,
      criticalRows: GAS_SCALE_CRITICAL_ROWS,
    },
    tables: tables,
    estimatedReadCells: estimatedReadCells,
    recommendations: recommendations,
  };

  console.log("Member GAS scale diagnostic: " + JSON.stringify(snapshot));
  return snapshot;
}

function gasScaleRiskForRows_(rows) {
  var count = Math.max(0, Number(rows) || 0);
  if (count >= GAS_SCALE_CRITICAL_ROWS) return "critical";
  if (count >= GAS_SCALE_WARNING_ROWS) return "warning";
  return "normal";
}
