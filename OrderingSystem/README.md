# 開團系統

純前端 `HTML / CSS / JS` 搭配 Google Apps Script 後端。前端使用 LINE LIFF 登入，後端用 LINE `idToken` 驗證身分，資料存進 Google Sheets。

## 功能

- LINE 登入：所有使用者都需登入，正式環境會自動導向 LINE 登入，不顯示登入按鈕。
- 首次登入：登入成功後會顯示全螢幕技師號碼設定畫面，確認寫入 GAS 後才會進入系統。
- 開團：使用者可建立團名，新增多個項目與價格。
- 加入團：使用者可加入別人開設中的團，選擇項目與數量後送出。
- 團主視圖：開團者可查看自己開的團、各項目彙整與加入明細。
- 加入紀錄：使用者可查看自己加入過的團。

## 檔案

- `index.html`：頁面結構
- `styles.css`：介面樣式
- `config.json`：前端連線設定
- `app.js`：前端互動與 GAS API 串接
- `gas/Code.gs`：Google Apps Script 後端

## 前端設定

打開 `config.json`，填入：

```json
{
  "LIFF_ID": "你的 LIFF ID",
  "GAS_WEB_APP_URL": "你的 GAS Web App /exec URL",
  "links": {
    "lineDevelopers": "https://developers.line.biz/console/",
    "gasDashboard": "https://script.google.com/home"
  }
}
```

尚未填入或讀不到 `config.json` 時會進入 Demo 模式，方便先看畫面與流程。正式測試時請用 GitHub Pages、GAS Web App 或本機 HTTP 伺服器開啟，瀏覽器直接用 `file://` 開 HTML 可能會擋掉 JSON 讀取。

## GAS 部署

1. 到 Google Drive 建立新的 Apps Script 專案。
2. 將 `gas/Code.gs` 的內容貼到 Apps Script 編輯器。
3. 如果要固定使用既有 Google Sheets，打開 `gas/Code.gs`，在最上方填入：

```js
const GAS_CONFIG = {
  SPREADSHEET_ID: "你的 Google Sheets ID",
};
```

4. 到「專案設定」加入 Script Properties：
   - `LINE_CHANNEL_ID`：LINE Login Channel ID
   - `SPREADSHEET_ID`：可留空。若 `GAS_CONFIG.SPREADSHEET_ID` 也留空，第一次執行時會自動建立資料表。
5. 部署為 Web App：
   - Execute as：Me
   - Who has access：Anyone
6. 複製部署後的 `/exec` URL，貼回 `config.json` 的 `GAS_WEB_APP_URL`。

GAS 會自動建立這些工作表：

- `Users`
- `Groups`
- `GroupItems`
- `JoinOrders`

## LINE LIFF 設定

1. 到 LINE Developers 建立 LINE Login Channel。
2. 建立 LIFF App，Endpoint URL 填前端頁面的公開網址，Scopes 至少啟用 `profile` 與 `openid`。
3. 將 LIFF ID 貼回 `config.json` 的 `LIFF_ID`。
4. 將 Channel ID 填到 GAS Script Properties 的 `LINE_CHANNEL_ID`。

LIFF 會在前端取得 `idToken`，GAS 會呼叫 LINE 官方 Verify ID token API 驗證後才執行操作。

官方文件：

- LIFF `getIDToken`：https://developers.line.biz/en/reference/liff/#get-id-token
- Verify ID token：https://developers.line.biz/en/reference/line-login/#verify-id-token

## 使用流程

1. 使用者開啟頁面後自動進入 LINE 登入流程。
2. 第一次登入成功後會停在全螢幕技師號碼畫面，輸入並確認後系統會寫入 GAS。
3. 到「開團」建立團名、項目與價格。
4. 其他使用者到「加入團」選擇別人開設中的團並送出。
5. 團主到「我開的團」查看彙整與明細。

## 常見狀況

- `IdToken expired.`：LINE 登入憑證過期。前端會在呼叫 GAS 前檢查 token 到期時間，若過期會自動重新登入 LINE。
