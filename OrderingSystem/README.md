# 團購系統

HTML、CSS、JavaScript 前端加上 Google Apps Script 後端。使用者透過 LINE LIFF 登入後，可以開團、建立品項與金額，也可以加入別人的團並選擇數量。

這版不使用 Apps Script Script Properties，所有部署設定都放在前端 `config.json`。

## 檔案

- `index.html`：前端畫面與 LIFF SDK 載入
- `styles.css`：響應式介面樣式
- `app.js`：LIFF 登入、開團、加入團、GAS JSONP API
- `config.json`：前端設定
- `gas/Code.gs`：Apps Script 後端、LINE ID token 驗證、Google Sheets 資料儲存

## config.json

```json
{
  "gasWebAppUrl": "https://script.google.com/macros/s/你的部署ID/exec",
  "liffId": "你的 LIFF ID",
  "lineChannelId": "你的 LINE Login Channel ID",
  "spreadsheetId": "你的 Google Sheet ID",
  "demoMode": false
}
```

說明：

- `gasWebAppUrl`：Apps Script Web App 的 `/exec` URL，不要加 `?action=...`
- `liffId`：LINE Developers Console 裡 LIFF app 的 LIFF ID
- `lineChannelId`：LINE Login Channel 的 Channel ID
- `spreadsheetId`：Google Sheets 網址 `/d/` 後面那段 ID
- `demoMode`：`true` 時會顯示測試身分按鈕

## GAS 部署

1. 到 Apps Script 建立專案。
2. 將 `gas/Code.gs` 內容貼到 Apps Script。
3. 不需要設定 Script Properties。
4. 建立 Google Sheet，複製 Sheet ID 到 `config.json` 的 `spreadsheetId`。
5. 在 Apps Script 編輯器部署 Web App：
   - Execute as：Me
   - Who has access：Anyone
6. 複製 Web App `/exec` URL 到 `config.json` 的 `gasWebAppUrl`。
7. 開一次這個網址初始化資料表：

```text
https://script.google.com/macros/s/你的部署ID/exec?action=setup&spreadsheetId=你的GoogleSheetID
```

## LINE Developers 設定

1. 建立或使用 LINE Login Channel。
2. 在 `Basic settings` 複製 `Channel ID`，填到 `config.json` 的 `lineChannelId`。
3. 到 `LIFF` 分頁新增 LIFF app。
4. Endpoint URL 填你的前端網址，例如：

```text
https://你的帳號.github.io/你的repo/OrderingSystem/
```

5. LIFF scopes 勾選：

```text
profile
openid
```

6. 複製 LIFF ID，填到 `config.json` 的 `liffId`。

這版不需要 `LINE_CHANNEL_SECRET`，也不需要 LINE Login Callback URL。登入流程由 LIFF SDK 在前端完成，前端只把 `liff.getIDToken()` 拿到的 ID token 送到 GAS，GAS 透過 LINE 官方 verify endpoint 驗證後建立 session。

## 資料表

GAS 會在指定的 Google Sheet 建立或使用這些分頁：

- `Users`
- `Sessions`
- `Groups`
- `Items`
- `Orders`
- `OrderItems`

前端從 GitHub Pages 呼叫 GAS 時使用 JSONP，避免一般瀏覽器跨網域讀取 Apps Script response 的限制。
