# PERSONA MEMBERS

以原生 HTML、CSS、JavaScript 製作的 LINE LIFF 會員系統。會員端與管理端使用不同的 LIFF Channel、不同的 Google Apps Script（GAS）專案與部署；兩套 GAS 只共用同一份 Google Spreadsheet。

## 系統行為

- 會員端 LIFF `2010787602-kaiSm2eq` 只呼叫會員 GAS。
- 管理端 LIFF `2010791619-vhevCvvD` 只呼叫管理 GAS。
- 新會員預設 `Members.status=approved`，登入後可直接使用會員中心。
- 會員可在會員中心自行修改或清空 `phone` 與 `birthday`。
- 管理員可把 `Members.status` 改為 `approved`（可使用）或 `denied`（停用）。
- 管理端將會員資料與點數操作拆成兩個頁面；會員頁不會讀取點數資料，點數頁也不會讀取會員清單。
- 管理員首次登入會在 `Admins` 工作表建立 `pending` 申請。
- 只有試算表擁有者手動將 `Admins.status` 改為 `approved` 才能進入後台；改為 `denied` 會拒絕登入。
- 已核准管理員可建立 `1 點`～`9999 點`的點數類型，設定期限與領取方式（每位會員一次、可重複、整張 QR 僅限一位會員）後產生會員 LIFF QR Code。
- 已核准會員掃描 QR 並登入後會直接領取點數；結果畫面會顯示原本、獲得與目前點數，按「確認」才會返回會員資料，活動可設定每會員一次、重新掃描後重複領取，或整張 QR 僅開放第一位會員。
- 會員中心會顯示最近 30 筆點數使用紀錄，包含獲得點數、發生時間、QR 規則與當下餘額，並提供重新整理、載入、空狀態與錯誤回饋。
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
│   ├── index.html             # 會員資料與使用權限
│   ├── points.html            # 點數類型與 QR 領取碼
│   ├── styles.css
│   ├── script.js
│   └── config.json
├── shared/
│   ├── gas-api.js             # 兩端共用的跨網域傳輸
│   └── qr-code.js             # 管理端本機 QR SVG／PNG 產生器
├── gas/
│   ├── client/                # 處理會員登入、個人資料、領點與刪除資料
│   │   ├── Code.gs
│   │   └── appsscript.json
│   └── admin/                 # 處理管理員授權、會員權限與點數 QR
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
- 管理端會員頁預覽：[http://localhost:8080/admin/?demo=1](http://localhost:8080/admin/?demo=1)
- 管理端點數頁預覽：[http://localhost:8080/admin/points.html?demo=1](http://localhost:8080/admin/points.html?demo=1)

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
   | `SHEET_NAME` | 否 | 預設 `Members`；自訂時須與管理 GAS 相同 |
   | `POINT_TYPE_SHEET_NAME` | 否 | 預設 `PointTypes` |
   | `POINT_CAMPAIGN_SHEET_NAME` | 否 | 預設 `PointCampaigns` |
   | `POINT_REDEMPTION_SHEET_NAME` | 否 | 預設 `PointRedemptions` |
   | `MAX_VERIFY_REQUESTS_PER_MINUTE` | 否 | 預設 `120`，範圍 `1`–`1000` |

5. 執行一次 `setup()` 並完成授權，建立或驗證 `Members`、`PointTypes`、`PointCampaigns` 與 `PointRedemptions` 工作表。
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
   | `SHEET_NAME` | 否 | 預設 `Members`；自訂時須與會員 GAS 相同 |
   | `ADMIN_SHEET_NAME` | 否 | 預設 `Admins` |
   | `POINT_TYPE_SHEET_NAME` | 否 | 預設 `PointTypes`，須與會員 GAS 相同 |
   | `POINT_CAMPAIGN_SHEET_NAME` | 否 | 預設 `PointCampaigns`，須與會員 GAS 相同 |
   | `POINT_REDEMPTION_SHEET_NAME` | 否 | 預設 `PointRedemptions`，須與會員 GAS 相同 |
   | `MEMBER_LIFF_URL` | 否 | 預設且目前限定 `https://liff.line.me/2010787602-kaiSm2eq` |
   | `MAX_VERIFY_REQUESTS_PER_MINUTE` | 否 | 預設 `120`，範圍 `1`–`1000` |

5. 執行一次 `setup()` 並完成授權，建立或驗證五張工作表。`setup()` 也會自動建立管理 GAS 專用的 `POINT_CLAIM_SECRET`；不要放進前端 JSON、試算表或公開文件。
6. 另外部署成「網頁應用程式」，執行身分選「我」、存取權選「任何人」。
7. 複製管理 GAS 自己的 `/exec` URL。此 URL 必須與會員 GAS URL 不同。

管理 GAS 的 `ALLOWED_ORIGINS` 同樣填：

```text
https://yongshengchen0615.github.io
```

修改任何 GAS 程式後，儲存並不會更新既有正式部署；必須到「部署 → 管理部署作業」建立新版本。

### 從既有版本升級

電話與生日會追加為 `Members.phone` 與 `Members.birthday`，原有 1–21 欄位置不會改變。點數功能另外建立 `PointTypes`、`PointCampaigns` 與 `PointRedemptions`，不會再增加 `Members` 欄位。新版 `setup()` 會以追加欄位的方式，替舊點數資料補上期限／領取規則快照；既有活動預設遷移為「有期限＋每位會員一次」。升級時請在維護時段連續完成：

1. 同時將最新的會員 `Code.gs` 與管理 `Code.gs` 貼入各自專案。
2. 先在管理 GAS、再在會員 GAS 各執行一次 `setup()`，確認 `Members` 為 23 欄，並完成三張點數工作表的追加欄位與舊資料回填。
3. 兩個 GAS 都建立新的正式部署版本。
4. 最後再發布前端。

不要只升級其中一套 GAS；舊版程式會把 23 欄工作表視為 schema mismatch。

## 4. 設定兩個 LINE LIFF App

在 [LINE Developers Console](https://developers.line.biz/console/) 確認：

| 用途 | LIFF ID | Channel ID | Endpoint URL |
| --- | --- | --- | --- |
| 會員端 | `2010787602-kaiSm2eq` | `2010787602` | `https://yongshengchen0615.github.io/PersonalBrandTestingEnvironment/client/` |
| 管理端 | `2010791619-vhevCvvD` | `2010791619` | `https://yongshengchen0615.github.io/PersonalBrandTestingEnvironment/admin/` |

管理 LIFF Endpoint 仍維持在 `admin/`；`admin/points.html` 是同一個管理 LIFF 下的子頁，不需要新增第三個 LIFF App，也不需要另一份 `config.json`。

兩個 App 都勾選：

- `openid`：必要，用來取得 ID Token。
- `profile`：必要，用來取得顯示名稱與頭像。
- `email`：不需要；會員聯絡資料改由會員自行填寫電話與生日。

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

新會員預設為 `approved`。後續登入只同步 LINE 名稱、頭像與登入紀錄，不會覆蓋會員自行填寫的電話、生日，也不會覆蓋管理員設定的 `status`。除了管理後台，也可以由試算表擁有者直接手動修改這一欄。

## 點數 QR 流程

1. 管理員切換到 `admin/points.html` 點數管理頁，輸入 `1`～`9999` 的整數點數，並選擇「有期限／無期限」與「每位會員一次／可重複／僅限一位會員」後新增類型。同一點數可依規則組合建立多種類型。
2. 選取類型產生 QR Code。有期限類型須設定未來到期時間（最長 366 天）；無期限類型不顯示日期欄，可直接產生 QR。
3. 會員掃描後登入，系統先驗證會員仍為 `approved`、活動為 `active`，有期限活動還會核對是否到期。
4. 會員掃描並完成登入後，會員 GAS 直接把領取紀錄寫入 `PointRedemptions`；結果畫面顯示原本點數、此次獲得點數與目前點數，按「確認」才返回會員資料。
5. 會員中心會透過 `listPointHistory` 讀取本人最近 30 筆 `PointRedemptions`，只回傳本人資料；其他會員的 LINE User ID、Email 與內部欄位不會送到前端。
6. 管理員可刪除不再使用的點數類型。刪除採停用方式保存稽核資料，只阻止產生新的 QR；既有 QR 仍依建立當時的規則快照運作。

規則組合的行為：

- 有期限＋不可重複：到期前，每位會員一次。
- 有期限＋可重複：到期前，每次重新掃描並確認都可再次領取。
- 無期限＋不可重複：永久有效，每位會員一次。
- 無期限＋可重複：永久有效，每次重新掃描並確認都可再次領取。
- 有期限／無期限＋僅限一位會員：第一位有效會員成功領取後，整張 QR 不再接受其他會員。

QR 只包含一個 43 字元的不透明 claim，不包含點數、會員 ID 或 LINE Token。`PointCampaigns` 只保存 claim 的 SHA-256 hash；點數、期限模式與領取方式都使用建立活動當下的後台快照，前端傳入的數值不會被採信。會員端會為一次確認操作保留固定的 request ID，因此網路逾時後重試不會把同一次可重複領取誤算兩次；完成後若要再領，必須重新掃描 QR。

QR 連結可以被轉傳，因此它代表「持有連結即可參加」而不是現場定位或一次性票券。尤其「無期限＋可重複」QR 外流後，任何仍具會員資格的人都能反覆領點，請只在能接受此風險時使用。若要提前停止活動，可由試算表擁有者把對應 `PointCampaigns.status` 改為 `inactive`。刪除會員資料時也會刪除該會員的 `PointRedemptions`，因此點數餘額與領取歷史會一併清除；若日後重新建立會員，仍有效的舊 QR 可依活動規則重新領取。

## 資料與安全邊界

```text
會員 LIFF ID Token
  → 會員 GAS（LINE_CHANNEL_ID=2010787602）
  → Members：建立會員、更新登入、修改本人電話／生日、刪除本人資料
  → PointCampaigns：用 claim hash 查詢活動
  → PointRedemptions：確認後寫入領取紀錄，以 request ID 防止同次重送並加總餘額

管理 LIFF ID Token
  → 管理 GAS（LINE_CHANNEL_ID=2010791619）
  → Admins：建立 pending 申請並檢查 status
  → status=approved 後才可讀取／調整 Members.status
  → status=approved 後才可建立／刪除 PointTypes 與建立 PointCampaigns
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
node --check shared/qr-code.js
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
