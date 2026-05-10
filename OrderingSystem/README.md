# 團購系統

使用 HTML、CSS、JavaScript 製作的團購前端，後端使用 Google Apps Script。使用者可透過 LINE Login 登入、開團、設定品項與金額，也可以加入別人的團並選擇品項與數量。

## 檔案

- `index.html`：前端畫面與模板
- `styles.css`：響應式介面樣式
- `app.js`：登入狀態、開團、加入團、GAS JSONP API
- `config.json`：前端設定
- `gas/Code.gs`：Apps Script 後端、LINE OAuth callback、Google Sheets 資料儲存

## 前端設定

先部署 GAS Web App，再把部署 URL 填入 `config.json`：

```json
{
  "gasWebAppUrl": "https://script.google.com/macros/s/你的部署ID/exec",
  "demoMode": false
}
```

`gasWebAppUrl` 留空時，前端會使用瀏覽器 `localStorage` 的測試資料，方便直接開發 UI。

## GAS 設定

1. 到 Apps Script 建立專案。
2. 將 `gas/Code.gs` 內容貼到 Apps Script。
3. 在 Apps Script 專案設定新增 Script Properties：

```text
LINE_CHANNEL_ID=你的 LINE Login Channel ID
LINE_CHANNEL_SECRET=你的 LINE Login Channel Secret
FRONTEND_URL=https://你的 GitHub Pages 網址/OrderingSystem/
LINE_CALLBACK_URL=https://script.google.com/macros/s/你的部署ID/exec?action=lineCallback
SPREADSHEET_ID=可選，留空會自動建立試算表
```

4. 在 Apps Script 編輯器執行一次 `setup()`，授權建立/讀寫試算表。
5. 部署為 Web App：
   - Execute as：Me
   - Who has access：Anyone
6. 複製 Web App URL 到 `config.json`。

## LINE Developers 設定

在 LINE Login Channel 裡設定 Callback URL：

```text
https://script.google.com/macros/s/你的部署ID/exec?action=lineCallback
```

這一條必須跟 GAS Script Property 的 `LINE_CALLBACK_URL` 完全一致，包含 `/exec` 和 `?action=lineCallback`。

Scopes 使用：

```text
profile openid
```

Channel Secret 只放在 GAS Script Properties，不要放到前端。

## 資料表

GAS 會建立或使用指定的 Google Sheets，包含：

- `Users`
- `Sessions`
- `Groups`
- `Items`
- `Orders`
- `OrderItems`

前端從 GitHub Pages 呼叫 GAS 時使用 JSONP，避免一般瀏覽器跨網域讀取 Apps Script response 的限制。
