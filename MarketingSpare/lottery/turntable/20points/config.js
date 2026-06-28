// 配置檔：設定 Web App URL 與工作表名稱等
// 請依需求調整以下值
window.TURN_ADMIN_CONFIG = {
  // Google Apps Script Web App URL（必填）
  scriptUrl: 'https://script.google.com/macros/s/AKfycbyWac7BflzzvIgv3r5ZMMl7WY4v6tFLgTKGxSkDUZ2Z8skDSLQAa6OOoAU3aN2MciAP/exec',
  // 預設工作表名稱（必填）
  sheetName: '機率',
  // 代理（選填），若不需要請留空字串
  proxyUrl: '',
  // 是否使用 no-cors（通常不需要）
  noCors: false,
  // LIFF 設定：抽中獎項後用 liff.sendMessages() 傳回目前 LINE 聊天視窗
  liff: {
    // 請填入 LINE Developers Console 的 LIFF ID
    liffId: '2005939681-Glnl96Vg',
    // landed = 獎項確定後立即送出；confirm = 按確認後才送出
    sendOn: 'landed',
    // 可用變數：{activity}、{prize}、{landedAt}
    messageTemplate: '我中了「{prize}」！',
    closeAfterSend: false
  }
};
