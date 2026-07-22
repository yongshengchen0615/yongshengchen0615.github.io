# PERSONA MEMBERS

以原生 HTML、CSS、JavaScript 製作的 LINE LIFF 會員系統。會員端與管理端使用不同的 LIFF Channel、不同的 Google Apps Script（GAS）專案與部署；兩套 GAS 只共用同一份 Google Spreadsheet。

## 系統行為

- 會員端 LIFF `2010787602-kaiSm2eq` 只呼叫會員 GAS。
- 管理端 LIFF `2010791619-vhevCvvD` 只呼叫管理 GAS。
- 新會員預設 `Members.status=approved`，登入後可直接使用會員中心。
- 管理員可把 `Members.status` 改為 `approved`（可使用）或 `denied`（停用）。
- 管理員首次登入會在 `Admins` 工作表建立 `pending` 申請。
- 只有試算表擁有者手動將 `Admins.status` 改為 `approved` 才能進入後台；改為 `denied` 會拒絕登入。
- `Members.admin_status` 是舊版相容欄位，不再用來授予管理權限。
- 兩套 GAS 都會各自向 LINE 驗證 ID Token，不信任前端傳入的 userId、姓名、頭像或角色。

## 專案結構

```text
PersonalBrandTestingEnvironment/
├── index.html                 # 舊網址相容入口，導向 client/
├── setup.html                 # 瀏覽器版部署指南
├── client/                    # 會員端 LIFF
│   ├── index.html
│   ├── privacy.html
│   ├── styles.css
│   ├── script.js
│   └── config.json
├── admin/                     # 管理員端 LIFF
│   ├── index.html
│   ├── styles.css
│   ├── script.js
│   └── config.json
├── shared/
│   └── gas-api.js             # 兩端共用的跨網域傳輸
├── gas/
│   ├── client/                # 只處理會員登入與刪除資料
│   │   ├── Code.gs
│   │   └── appsscript.json
│   └── admin/                 # 只處理管理員授權與會員權限
│       ├── Code.gs
│       └── appsscript.json
└── tests/
```

## 本機預覽

本專案沒有套件依賴或建置步驟。在專案目錄執行：

```bash
python3 -m http.server 8080
```

- 會員端預覽：[http://localhost:8080/client/?demo=1](http://localhost:8080/client/?demo=1)
- 管理端預覽：[http://localhost:8080/admin/?demo=1](http://localhost:8080/admin/?demo=1)

展示模式不會把資料送到 GAS。真實登入必須使用公開 HTTPS Endpoint。

## 1. 建立共用 Google Spreadsheet

建立一份 Google 試算表，從網址複製 Spreadsheet ID：

```text
https://docs.google.com/spreadsheets/d/{這一段是 SPREADSHEET_ID}/edit
```

會員 GAS 與管理 GAS 的 `SPREADSHEET_ID` 必須填完全相同的值。不要公開分享試算表的編輯權；可以編輯 `Admins.status` 的人等同最高管理者。

## 2. 建立並部署會員 GAS

1. 建立第一個獨立 Apps Script 專案，例如命名為 `PERSONA Member API`。
2. 將 [`gas/client/Code.gs`](gas/client/Code.gs) 貼入 `Code.gs`。
3. 開啟資訊清單檔案後，以 [`gas/client/appsscript.json`](gas/client/appsscript.json) 取代內容。
4. 在「專案設定 → 指令碼屬性」加入：

   | 屬性 | 必要 | 值 |
   | --- | --- | --- |
   | `LINE_CHANNEL_ID` | 是 | `2010787602` |
   | `SPREADSHEET_ID` | 是 | 共用 Google Spreadsheet ID |
   | `ALLOWED_ORIGINS` | 是 | `https://yongshengchen0615.github.io` |
   | `SHEET_NAME` | 否 | 預設 `Members` |
   | `MAX_VERIFY_REQUESTS_PER_MINUTE` | 否 | 預設 `120`，範圍 `1`–`1000` |

5. 執行一次 `setup()` 並完成授權，建立或更新 `Members` 工作表。
6. 選擇「部署 → 新增部署作業 → 網頁應用程式」：
   - 執行身分：**我（部署者）**
   - 誰可以存取：**任何人**
7. 複製結尾為 `/exec` 的會員 GAS URL。

正式站的 `ALLOWED_ORIGINS` 只填 origin，不含 `/PersonalBrandTestingEnvironment/client/` 路徑、結尾斜線或 `*`。需要本機串接時才額外用逗號加入 `http://localhost:8080`。

會員 GAS 健康檢查：

```bash
curl -L "會員_GAS_EXEC_URL?action=health"
```

成功回應會包含 `"ok":true` 與 `"service":"member-client-api"`。

## 3. 建立並部署管理 GAS

1. 建立第二個、完全獨立的 Apps Script 專案，例如命名為 `PERSONA Admin API`。不要把管理程式貼進會員 GAS 專案。
2. 將 [`gas/admin/Code.gs`](gas/admin/Code.gs) 貼入 `Code.gs`。
3. 開啟資訊清單檔案後，以 [`gas/admin/appsscript.json`](gas/admin/appsscript.json) 取代內容。
4. 在這個專案的「指令碼屬性」加入：

   | 屬性 | 必要 | 值 |
   | --- | --- | --- |
   | `LINE_CHANNEL_ID` | 是 | `2010791619` |
   | `SPREADSHEET_ID` | 是 | 與會員 GAS 完全相同的 Spreadsheet ID |
   | `ALLOWED_ORIGINS` | 是 | `https://yongshengchen0615.github.io` |
   | `SHEET_NAME` | 否 | 預設 `Members` |
   | `ADMIN_SHEET_NAME` | 否 | 預設 `Admins` |
   | `MAX_VERIFY_REQUESTS_PER_MINUTE` | 否 | 預設 `120`，範圍 `1`–`1000` |

5. 執行一次 `setup()` 並完成授權，建立或更新 `Members` 與 `Admins` 工作表。
6. 另外部署成「網頁應用程式」，執行身分選「我」、存取權選「任何人」。
7. 複製管理 GAS 自己的 `/exec` URL。此 URL 必須與會員 GAS URL 不同。

管理 GAS 的 `ALLOWED_ORIGINS` 同樣填：

```text
https://yongshengchen0615.github.io
```

修改任何 GAS 程式後，儲存並不會更新既有正式部署；必須到「部署 → 管理部署作業」建立新版本。

## 4. 設定兩個 LINE LIFF App

在 [LINE Developers Console](https://developers.line.biz/console/) 確認：

| 用途 | LIFF ID | Channel ID | Endpoint URL |
| --- | --- | --- | --- |
| 會員端 | `2010787602-kaiSm2eq` | `2010787602` | `https://yongshengchen0615.github.io/PersonalBrandTestingEnvironment/client/` |
| 管理端 | `2010791619-vhevCvvD` | `2010791619` | `https://yongshengchen0615.github.io/PersonalBrandTestingEnvironment/admin/` |

兩個 App 都勾選：

- `openid`：必要，用來取得 ID Token。
- `profile`：必要，用來取得顯示名稱與頭像。
- `email`：選用；需要先申請 Email 權限。

Endpoint URL 必須使用 HTTPS、不可包含 `#fragment`，且會員端與管理端不可對調。建議 Size 選 `Full`。

官方參考：

- [註冊 LIFF App](https://developers.line.biz/en/docs/liff/registering-liff-apps/)
- [LIFF 初始化與登入](https://developers.line.biz/en/docs/liff/developing-liff-apps/)
- [安全使用 LIFF 會員資料](https://developers.line.biz/en/docs/liff/using-user-profile/)
- [LINE ID Token 驗證 API](https://developers.line.biz/en/reference/line-login/#verify-id-token)

## 5. 填入前端 config.json

[`client/config.json`](client/config.json) 保留現有會員 LIFF ID 與會員 GAS URL：

```json
{
  "BRAND_NAME": "PERSONA",
  "LIFF_ID": "2010787602-kaiSm2eq",
  "GAS_WEB_APP_URL": "https://script.google.com/macros/s/會員部署識別碼/exec"
}
```

[`admin/config.json`](admin/config.json) 的 LIFF ID 已固定；部署管理 GAS 後，把 placeholder 換成新管理 GAS URL：

```json
{
  "LIFF_ID": "2010791619-vhevCvvD",
  "GAS_WEB_APP_URL": "https://script.google.com/macros/s/管理部署識別碼/exec",
  "BRAND_NAME": "PERSONA",
  "PAGE_SIZE": 50
}
```

會員端與管理端的 `GAS_WEB_APP_URL` 不可共用或對調。這些是瀏覽器可見的公開設定；不要把 LINE Channel Secret、ID Token、Google 憑證、私鑰或管理員狀態放進前端 JSON。

## 6. 首次管理員核准

1. 先完成兩套 GAS 的 `setup()`、部署與兩份 `config.json`。
2. 使用管理端 LIFF 登入。管理 GAS 驗證成功後，會在共用 Spreadsheet 的 `Admins` 工作表建立一列 `status=pending` 的申請。
3. 試算表擁有者確認該列資料，手動把 `status` 改為小寫 `approved`。
4. 回到管理端等待畫面，按「重新整理」即可進入會員管理後台。

若要撤銷管理資格，在 `Admins` 工作表把該列 `status` 改為 `denied`。管理端不提供核准其他管理員的 API；核准只允許由試算表擁有者手動執行。

管理員不必先在會員端登入。管理端身分只對應 `Admins` 工作表；`Members.admin_status` 即使填成 `approved` 也不會取得管理權限。

## 會員權限

`Members.status` 是會員是否能使用系統的唯一控制欄位：

- `approved`：可以登入會員系統。
- `denied`：停止使用會員系統，但仍可要求刪除自己的資料。

新會員預設為 `approved`。後續登入只同步 LINE 個人資料與登入紀錄，不會覆蓋管理員設定的 `status`。除了管理後台，也可以由試算表擁有者直接手動修改這一欄。

## 資料與安全邊界

```text
會員 LIFF ID Token
  → 會員 GAS（LINE_CHANNEL_ID=2010787602）
  → Members：建立會員、更新登入、刪除本人資料

管理 LIFF ID Token
  → 管理 GAS（LINE_CHANNEL_ID=2010791619）
  → Admins：建立 pending 申請並檢查 status
  → status=approved 後才可讀取／調整 Members.status
```

兩套 GAS 各自只接受自己的動作與 Channel Token。它們透過相同 `SPREADSHEET_ID` 讀寫同一份試算表，而不是彼此呼叫。前端傳入的身分、callback origin 或角色不構成權限。

管理端身分只在 `Admins` 工作表比對，不需要命中會員端建立的 `Members.line_user_id`。因此兩個官方帳號即使位於不同 Provider、LINE 驗證得到不同的 `sub`，也不會影響管理員核准或會員權限管理。

ID Token 只放在 HTTPS POST body，不會寫入 Sheet、Log 或 Query String。GAS 使用 LINE 驗證結果中的 `sub` 作為各自工作表的身分鍵。

## 常見問題

### 管理端顯示「尚未完成設定」

`admin/config.json` 的 `GAS_WEB_APP_URL` 仍是 `YOUR_ADMIN_GAS_WEB_APP_URL`，或不是管理 GAS 正式部署的 `/exec` URL。完成第二次 GAS 部署後再替換。

### 管理端顯示「等待核准」

這是首次登入的正常流程。到共用 Spreadsheet 的 `Admins` 工作表找到該申請，把 `status` 從 `pending` 改為 `approved`，再回管理端按「重新整理」。不要修改 `Members.admin_status`。

### 管理端顯示「申請已拒絕」

該帳號在 `Admins.status` 不是 `approved`，通常是 `denied`。只有試算表擁有者可以手動恢復為 `approved`。

### 顯示 `INVALID_TOKEN`

確認兩端沒有共用或對調 GAS URL，且各 GAS 的 `LINE_CHANNEL_ID` 正確：

```text
會員 GAS：2010787602
管理 GAS：2010791619
```

修正 Script Property 後建立新的 GAS 部署版本，再關閉 LIFF 視窗並重新登入取得新 Token。

### 顯示 `MISSING_ID_TOKEN`

確認對應 LIFF App 的 Scope 已勾選 `openid`。變更 Scope 後，使用者可能需要重新同意或登入。

### 顯示 `ORIGIN_NOT_ALLOWED` 或等待 GAS 逾時

兩個 GAS 專案都要各自設定：

```text
ALLOWED_ORIGINS=https://yongshengchen0615.github.io
```

不要加入 `/PersonalBrandTestingEnvironment/`、`client/`、`admin/` 或 `*`。

### GAS 回傳 Google 登入頁面

重新部署對應的 Web App，確認存取權是「任何人」，且前端使用 `/exec` 而不是 `/dev`。

## 開發檢查

```bash
node --check shared/gas-api.js
node --check client/script.js
node --check admin/script.js
python3 -m json.tool client/config.json
python3 -m json.tool admin/config.json
node --check < gas/client/Code.gs
node --check < gas/admin/Code.gs
python3 -m json.tool gas/client/appsscript.json
python3 -m json.tool gas/admin/appsscript.json
node --test tests/*.test.js
```

真實 LINE 驗證與 Google Sheet 寫入，只有在兩套 GAS 完成部署並填入各自 URL 後才能做端對端測試。
