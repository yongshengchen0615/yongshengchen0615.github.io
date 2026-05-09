# Google Apps Script 同步部署

1. 到 Google Apps Script 新增專案。
2. 將 `Code.gs` 內容貼到 Apps Script 的 `Code.gs`。
3. 點選「部署」→「新增部署作業」。
4. 類型選「網頁應用程式」。
5. 執行身分選「我」。
6. 存取權選「知道連結的任何人」。
7. 開啟你要使用的現有 Google 試算表，複製網址中的試算表 ID。
8. 複製部署後的 Web App URL，填入專案根目錄的 `config.json`。
9. 在 `config.json` 填入同一組 `syncKey` 與現有試算表的 `spreadsheetId`。
10. 每台裝置開啟同一份前端頁面時，系統會從 GAS 載入最新資料。
11. 修改資料後，按側邊欄的「儲存」把完整資料寫回 GAS，並在既有試算表中建立或更新工作表。

前端需要透過 HTTP/HTTPS 開啟，像是 GitHub Pages、本機開發伺服器或正式網站；直接用 `file://` 開啟時，瀏覽器可能不允許讀取 `config.json`。

`config.json` 範例：

```json
{
  "gasUrl": "https://script.google.com/macros/s/你的部署ID/exec",
  "syncKey": "your-shared-sync-key",
  "spreadsheetId": "你的現有 Google 試算表 ID"
}
```

同一個 `gasUrl` + 同一組 `syncKey` + 同一個 `spreadsheetId` 會對應同一份雲端資料。

GAS 不會自動建立新的試算表；它會在 `spreadsheetId` 指向的既有試算表中維護：

- `Projects`
- `Phases`
- `Tasks`
- `Meta`

這些資料表是目前資料的鏡像；前端每次開啟都會從 GAS 讀取完整 JSON。
資料修改後需按「儲存」才會寫回 GAS。

注意：如果前端部署在公開網站，`config.json` 也會被公開讀取；`syncKey` 適合用來分流資料，不適合作為真正的密碼。
