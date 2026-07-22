# PERSONA MEMBERS

以原生 HTML、CSS、JavaScript 製作的 LINE LIFF 會員系統。前端可放在 GitHub Pages；Google Apps Script（GAS）負責向 LINE 驗證 ID Token，並把驗證後的會員資料寫入 Google 試算表。

## 已完成的功能

- LIFF 初始化、外部瀏覽器 LINE 登入與 LIFF Browser 自動登入狀態
- 後端驗證 LINE ID Token，不信任前端自行傳來的 userId／姓名／頭像
- 會員首次建立、再次登入更新、登入次數與最後登入時間
- 數位會員證、桌機／手機響應式介面、載入／錯誤／未設定狀態
- 外部瀏覽器登出、LIFF Browser 關閉視窗
- 會員自行刪除 Google Sheet 中的資料
- 試算表併發鎖、重複請求保護、公式注入防護
- 隱私說明視窗與可自行補充的 `privacy.html` 政策範本

## 專案結構

```text
PersonalBrandTestingEnvironment/
├── index.html              # 會員登入與會員中心
├── setup.html              # 可由瀏覽器直接閱讀的部署指南
├── privacy.html            # 隱私權政策範本
├── styles.css              # 響應式介面
├── config.json             # LIFF ID、GAS 公開網址與品牌名稱
├── script.js               # LIFF、會員狀態與 GAS 通訊
├── gas/
│   ├── Code.gs             # GAS API、LINE 驗證與 Sheet 寫入
│   └── appsscript.json     # Apps Script 權限與 Web App 設定
└── tests/
    └── gas.test.js         # GAS 認證、來源限制與回應安全測試
```

## 本機預覽

這個專案沒有套件依賴或建置步驟。在此目錄執行：

```bash
python3 -m http.server 8080
```

開啟 [http://localhost:8080/?demo=1](http://localhost:8080/?demo=1) 可查看完成後的會員畫面；預覽資料不會送到 GAS。真實 LIFF 登入需先完成以下設定，並使用公開 HTTPS Endpoint。

## 1. 建立 Google Sheet 與 GAS 後台

1. 建立一份新的 Google 試算表，從網址複製試算表 ID：

   ```text
   https://docs.google.com/spreadsheets/d/{這一段是 SPREADSHEET_ID}/edit
   ```

2. 在試算表選擇「擴充功能 → Apps Script」。
3. 將 [`gas/Code.gs`](gas/Code.gs) 的內容貼入 Apps Script 的 `Code.gs`。
4. 在 Apps Script「專案設定」開啟「在編輯器中顯示 appsscript.json 資訊清單檔案」，再以 [`gas/appsscript.json`](gas/appsscript.json) 取代內容。
   資訊清單已將 LINE 驗證網址加入 `urlFetchWhitelist`，這是正式版本部署使用 `UrlFetchApp` 時需要的外部網址允許清單。
5. 到「專案設定 → 指令碼屬性」加入：

   | 屬性 | 必要 | 值 |
   | --- | --- | --- |
   | `LINE_CHANNEL_ID` | 是 | LINE Login Channel 的 Channel ID，不是 LIFF ID |
   | `SPREADSHEET_ID` | 是 | 第 1 步取得的 Google Sheet ID |
   | `ALLOWED_ORIGINS` | 是 | 前端 origin，多個以逗號分隔 |
   | `SHEET_NAME` | 否 | 預設為 `Members` |
   | `MAX_VERIFY_REQUESTS_PER_MINUTE` | 否 | LINE 驗證每分鐘上限，預設 `120`，範圍 `1`–`1000` |

   GitHub Pages 範例：

   ```text
   ALLOWED_ORIGINS=https://yongshengchen0615.github.io,http://localhost:8080
   ```

   `ALLOWED_ORIGINS` 只能填 origin（協定、網域、Port），不要加 `/PersonalBrandTestingEnvironment/` 路徑，也不要填 `*`。

6. 在 Apps Script 編輯器上方選擇 `setup` 並執行一次，依畫面授權。成功後會自動建立 `Members` 工作表與欄位。
7. 選擇「部署 → 新增部署作業 → 網頁應用程式」：
   - 執行身分：**我（部署者）**
   - 誰可以存取：**任何人**
8. 完成部署後複製結尾為 `/exec` 的網址。`/dev` 只供 Apps Script 編輯者測試，不能放進正式前端。

可以用以下指令檢查部署是否可公開存取：

```bash
curl -L "你的_GAS_EXEC_網址?action=health"
```

應回傳包含 `"ok":true` 與 `"service":"member-api"` 的 JSON。修改 GAS 程式後，記得到「管理部署作業」建立新版本。

## 2. 建立 LINE Login 與 LIFF App

1. 進入 [LINE Developers Console](https://developers.line.biz/console/)，建立 Provider 與 **LINE Login Channel**。
2. 在 Channel 的 LIFF 分頁新增 LIFF App。
3. Endpoint URL 填入部署後的公開 HTTPS 網址，例如：

   ```text
   https://yongshengchen0615.github.io/PersonalBrandTestingEnvironment/
   ```

4. Scope 勾選：
   - `openid`：必要，用來取得 ID Token。
   - `profile`：必要，用來取得顯示名稱與頭像。
   - `email`：選用；需先在 LINE Developers 申請 Email 權限，且使用者同意後才會取得。
5. 建議 Size 選 `Full`，儲存後複製 LIFF ID。
6. 可將 LIFF URL `https://liff.line.me/{LIFF_ID}` 放到 LINE 圖文選單或訊息中。
7. 正式上線前，補齊 [`privacy.html`](privacy.html) 的經營者與聯絡資料，再把其公開網址填入 Channel 的隱私權政策欄位。

Endpoint URL 必須使用 HTTPS、不可包含 `#fragment`，且要涵蓋登入後實際回到的頁面。程式刻意不自訂 `redirectUri`，由 LIFF 使用 Console 設定的 Endpoint URL。

官方參考：

- [註冊 LIFF App](https://developers.line.biz/en/docs/liff/registering-liff-apps/)
- [LIFF 初始化與登入](https://developers.line.biz/en/docs/liff/developing-liff-apps/)
- [在 LIFF 與伺服器安全使用會員資料](https://developers.line.biz/en/docs/liff/using-user-profile/)
- [LINE ID Token 驗證 API](https://developers.line.biz/en/reference/line-login/#verify-id-token)

## 3. 填入前端設定

編輯 [`config.json`](config.json)：

```json
{
  "LIFF_ID": "1234567890-AbCdEfGh",
  "GAS_WEB_APP_URL": "https://script.google.com/macros/s/部署識別碼/exec",
  "BRAND_NAME": "你的品牌名稱"
}
```

這三個值都會出現在瀏覽器中，屬於公開設定。`config.json` 必須使用有效 JSON：鍵名與字串需要雙引號，最後一個欄位後不可加逗號。不要把以下資料放進 `config.json` 或 Git 儲存庫：

- LINE Channel Secret
- LINE ID Token／Access Token
- Google 帳號憑證
- 任何私鑰或服務帳號 JSON

這個實作不需要 LINE Channel Secret；GAS 只用 Channel ID 呼叫 LINE 官方的 ID Token 驗證端點。

## 4. 部署 GitHub Pages

本目錄位於 `yongshengchen0615.github.io` 儲存庫時，提交並推送到 GitHub Pages 使用的發布分支即可。確認瀏覽器能開啟：

```text
https://yongshengchen0615.github.io/PersonalBrandTestingEnvironment/
```

再用 `https://liff.line.me/{LIFF_ID}` 分別測試：

- LINE 手機 App 內開啟
- Safari／Chrome 外部瀏覽器登入
- 第一次登入是否新增一列會員
- 第二次登入是否只更新同一列且 `login_count` 加一
- 刪除會員資料後，Sheet 中該列是否消失

## 資料與安全設計

登入流程如下：

```text
LIFF 取得短效 ID Token
        ↓ HTTPS POST
GAS 將 Token 送到 LINE /oauth2/v2.1/verify
        ↓ 驗證成功才繼續
以 LINE 回傳的 sub 當唯一會員鍵並更新 Google Sheet
```

前端 `liff.getProfile()` 或自行解碼 Token 得到的資料不會被後台當成可信會員資料。GAS 只使用 LINE 驗證 API 回傳的 `sub`、`name`、`picture`、`email` 與 `iat`；`iat` 僅作為登入工作階段標記，ID Token 本體不會寫入 Sheet 或 Log。

`Members` 會保存：

- 會員編號與 LINE 使用者識別碼
- LINE 顯示名稱、頭像網址、已授權的 Email
- 狀態、建立／更新／最後登入時間，以及依不同 LINE ID Token 工作階段計算的登入次數
- LIFF 開啟情境、作業系統與語系等基本診斷資訊
- LINE 驗證後的 Token 核發時間 `iat`，用來區分登入工作階段；不包含 Token 本體
- 最後 request ID（只用於避免跨網域重試造成登入次數重複）

GAS `ContentService` 回應會重新導向，且不能自行設定完整 CORS Header。前端會先用不觸發 preflight 的 `text/plain` POST；若瀏覽器攔截跨網域回應，會自動以隱藏表單送出相同 request ID，並用一次性隨機值與 `postMessage` 接收結果。ID Token 始終位於 HTTPS POST body，不會放在網址 Query String。

GAS 是公開 Web App，無法取得可靠的用戶端 IP 來做完整防濫用。後台會先拒絕明顯錯誤的 JWT 格式，並以 `MAX_VERIFY_REQUESTS_PER_MINUTE` 做全域、盡力而為的 LINE 驗證熔斷；若未來流量或攻擊風險提高，應在 GAS 前方加入具有 IP／裝置限流能力的 API Gateway 或 Worker。

Google 官方參考：

- [部署 Apps Script Web App](https://developers.google.com/apps-script/guides/web)
- [Apps Script Content Service 與重新導向](https://developers.google.com/apps-script/guides/content)
- [Properties Service](https://developers.google.com/apps-script/guides/properties)
- [Lock Service](https://developers.google.com/apps-script/reference/lock/lock-service)

## 常見問題

### 畫面顯示「還差兩個設定」

`config.json` 仍是預設值，或 GAS 網址不是 `https://script.google.com/macros/s/.../exec`。

### 顯示 `MISSING ID TOKEN`

確認 LIFF Scope 已勾選 `openid`。變更 Scope 後，使用者可能需要重新同意授權或重新登入。

### 顯示 `ORIGIN NOT ALLOWED` 或等待 GAS 逾時

確認 GAS Script Property 的 `ALLOWED_ORIGINS` 與瀏覽器 `location.origin` 完全一致。GitHub Pages 只填網域 origin，不含子目錄。

### GAS 回傳 Google 登入頁面

重新部署 Web App，並確認存取權是「任何人」，前端使用的是 `/exec` 而不是 `/dev`。

### 已更新 Code.gs，但前端仍是舊行為

Apps Script 儲存程式不會自動更新既有正式部署；到「部署 → 管理部署作業」建立新版本。

## 開發檢查

本專案沒有 package manager。可執行：

```bash
node --check script.js
python3 -m json.tool config.json
node --check < gas/Code.gs
python3 -m json.tool gas/appsscript.json
node --test tests/gas.test.js
```

真實 LINE 驗證與 Google Sheet 寫入只有在填入自己的 LIFF／GAS 設定並完成部署後才能做端對端測試。
