# 團購系統

HTML、CSS、JavaScript 前端加上 Google Apps Script 後端。使用者透過 LINE LIFF 登入後，可以開團、建立品項與金額，也可以加入別人的團並選擇數量。

這版不使用 Apps Script Script Properties，所有部署設定都放在前端 `config.json`。

## 檔案

- `index.html`：前端畫面與 LIFF SDK 載入
- `styles.css`：響應式介面樣式
- `app.js`：LIFF 登入、開團、加入團、GAS JSONP API
- `config.json`：前端設定
- `gas/Code.gs`：Apps Script 後端、LINE ID token 驗證、Google Sheets 資料儲存

## 介面

登入後以上方導覽切換主要工作：

- `所有開團`：查看全部開放中的團
- `我的開團`：篩選自己建立的團
- `我已加入`：篩選自己有下單的團
- `開新團`：建立團名、開始/結束下單時間、品項與金額，也可先儲存為草稿

在 `所有開團`、`我的開團` 或 `我已加入` 點選團卡後，會進入全版面的團購明細，可下單、查看訂單，返回時會回到進入明細前的列表區塊。

團購明細會依身分顯示不同資料：

- 團主：可在 `下單與訂單`、`品項管理` 之間切換；可看到所有人的訂單明細，並可新增、修改、刪除品項；品項改完後用單一儲存按鈕批次套用
- 非團主：只能看到自己的訂購紀錄
- 草稿：只有團主可在 `我的開團` 看到草稿，發布後才會開放下單
- 移除開團：團主可在團購明細移除整個開團，品項與訂單會一併移除
- 我的開團：已發布與未發布草稿會用不同顏色標記
- 下單時間：團主可設定開始與結束下單時間，未開始、已截止或草稿狀態都不能送出訂單
- 選擇品項：數量調整時會即時顯示已選明細、各品項小計與總金額
- 品項細項：團主可在品項管理先新增共用的品項細項與加價選項，並設定每組細項是否下單必填；下單時可針對同一品項新增不同細項明細
- Loading：初始登入與 GAS 儲存流程會顯示全螢幕等待畫面，儲存與重新讀取資料完成後才關閉
- 訂購者：可在自己的訂單中修改已訂購品項數量，或將品項數量改為 0 來移除該品項；訂單改完後用單一儲存按鈕批次套用
- 訂單清單：每筆訂單會標記為 `團主訂購` 或 `非團主訂購`，並顯示 `已收費` / `未收費`；團主可切換收費狀態，按 `儲存訂單變更` 後才寫入 GAS，訂購者重新讀取後會看到相同狀態

團主修改品項名稱或金額時，已訂購使用者的訂單品項會同步更新並重算金額。團主刪除品項時，該品項會從既有訂單移除；若某筆訂單沒有剩餘品項，該筆訂單也會移除。

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
- `demoMode`：`true` 時開頁自動 LINE/LIFF 登入；`false` 時開頁自動使用測試身分

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

## 自動登入模式

頁面不顯示 LINE 登入按鈕。開啟頁面時會依照 `config.json` 自動登入：

- `demoMode: true`：自動初始化 LIFF，未登入 LINE 時直接進入 LINE 登入流程
- `demoMode: false`：自動呼叫 GAS 的 `testLogin` 建立測試 session

測試身分的後續開團、加入團、訂單統計都會走 GAS 和 `spreadsheetId` 指定的 Google Sheet。

只有 `gasWebAppUrl` 留空時，前端才會退回瀏覽器 `localStorage` 的本機 Demo 資料。

## 資料表

GAS 會在指定的 Google Sheet 建立或使用這些分頁：

- `Users`
- `Sessions`
- `Groups`：含 `orderStartAt`、`orderEndAt` 欄位保存開始與結束下單時間
- `Items`：含 `options` 欄位保存品項細項設定 JSON，包含每組細項的必填設定
- `Orders`：含 `paid` 欄位保存團主設定的收費狀態
- `OrderItems`：含 `options` 欄位保存該筆訂購選到的細項 JSON

前端從 GitHub Pages 呼叫 GAS 時使用 JSONP，避免一般瀏覽器跨網域讀取 Apps Script response 的限制。
