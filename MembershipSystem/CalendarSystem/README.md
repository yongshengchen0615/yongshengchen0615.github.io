# CalendarSystem V2

以 GitHub Pages + LIFF + Google Apps Script + Google Sheets 實作的日曆系統。

## 架構

```text
MembershipSystem/CalendarSystem/
├── index.html
├── config.json
├── user/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── admin/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── gas/
│   ├── Code.gs
│   ├── Auth.gs
│   ├── CalendarService.gs
│   ├── StorageBootstrap.gs
│   └── appsscript.json
└── tests/
    ├── architecture.test.js
    ├── calendar-ui.test.js
    ├── gas-manifest.test.js
    ├── performance.test.js
    └── security.test.js
```

## 身分與權限模型

- **Authentication**：User/Admin LIFF 各自取得 LINE ID Token (`liff.getIDToken()`)，GAS 以 HTTPS POST 呼叫 LINE Verify ID Token API 驗證 token。
- **Verified identity cache**：LINE 驗證成功後，GAS 只把已驗證 identity (`lineUserId`、`displayName`、`clientType`、到期時間) 放入 Script Cache，最長 5 分鐘且不超過原 ID Token 到期時間。Cache key 是 token + Channel ID 的 SHA-256 digest；raw ID Token 不會被快取。
- **Transient retry**：LINE Verify 發生網路錯誤、HTTP 429 或 5xx 時只做一次短暫 retry，避免無限制重試放大故障。
- **Identity**：GAS 只使用 LINE 驗證回應中的可信任 claims，例如 `sub`、`name`、`aud`、`exp`、`iss`；不信任前端自行傳入 LINE User ID 或顯示名稱。
- **Authorization**：管理端每次受保護 action 都重新從 Google Sheet `Admins` 判斷 role/status；LINE identity cache 不會快取 Admin 權限。
- **User LIFF 與 Admin LIFF 分離**：`config.json` 分別設定 `userLiffId` 與 `adminLiffId`，GAS 分別以對應 LINE Login Channel ID 驗證 `aud`。
- **Session**：本系統不另外發永久 session/token；前端仍以目前 LIFF ID Token 呼叫 API，GAS 只對已成功驗證的 identity 做短期快取。

LINE ID Token 只放在 HTTPS POST request body，不寫入 URL、Google Sheet、log、localStorage 或 sessionStorage。

## LIFF Scopes

User LIFF 與 Admin LIFF 都需要啟用：

- `openid`：讓 `liff.getIDToken()` 可取得 ID Token。
- `profile`：讓驗證後 ID Token claims 可包含使用者顯示名稱。

## 資料表

第一次執行 `setupCalendarSystem()`，或第一次 Web App request 時，GAS 會建立新的 V2 Spreadsheet 並寫入 Script Property `CALENDAR_SYSTEM_V2_SPREADSHEET_ID`。

### Users

`line_user_id, display_name, status, last_login_at, created_at, updated_at`

### Admins

`line_user_id, display_name, role, status, first_seen_at, updated_at`

管理端第一次登入如果尚未授權，系統會自動新增：

- `role = none`
- `status = pending`

並回傳 403。管理者只需在 Google Sheet 手動把該列修改為：

- `role = admin`
- `status = active`

再次整理管理端頁面即可進入。

### CalendarItems

`item_id, type, title, start_date, end_date, all_day, start_time, end_time, description, location, status, created_by, created_at, updated_by, updated_at, color`

- type：`holiday | event | notice`
- status：`draft | published | archived`
- archived 為 soft delete，避免直接破壞歷史資料。

### AuditLogs

`audit_id, actor_line_user_id, actor_role, action, target_type, target_id, result, detail, created_at`

不記錄 ID Token、secret 或 credential。

## 連線與資料更新效率

- 每個 API request 在通過 LINE authentication 後只做一次 Spreadsheet schema validation，內部 storage helper 不再重複檢查四張 Sheet。
- Users/Admins/CalendarItems 的 key lookup 使用單一 key column 的 `TextFinder`，避免為找一筆資料就把整張 Sheet 的所有欄位載入記憶體。
- 主日曆只查詢目前 42 個可視日期；Calendar list 使用 30 秒 Script Cache，cache key 綁定 `CALENDAR_SYSTEM_V2_DATA_REVISION`、角色與日期範圍。任何 API create/update/archive 都會先更新 revision，因此 API 寫入後的新 request 不會命中舊 revision cache。
- Cache 超過安全大小時會自動略過，回退到 Google Sheet，不影響正確性；管理端批量選取與未更新的舊客戶端可省略範圍，以維持完整清單相容性。
- 管理端 create/update/archive 成功後直接套用 GAS 回傳的 authoritative item，不再緊接著呼叫一次完整 `admin.calendar.list`。
- User 端提供手動更新；頁面回到前景時只有資料超過 60 秒才自動呼叫 `user.calendar.list`，避免每次 focus 都產生 request。
- Calendar UI 會先篩出目前 42 個可視日期的事項並排序一次，再建立 day index，避免跨日期事項在每一天重複排序。

注意：若直接手動修改 `CalendarItems` Sheet（不是透過 API），revision 不會立刻改變，因此最長可能需要等目前 30 秒 list cache 到期才會反映。透過管理端 API 的變更不受此限制。

## GAS 設定

### 1. 建立 Apps Script

把 `gas/` 內的 `.gs` 與 `appsscript.json` 複製到同一個 Apps Script 專案。

### 2. 設定 Script Properties

在 Apps Script → Project Settings → Script Properties 設定：

- `CALENDAR_USER_LINE_CHANNEL_ID`：User LIFF 所屬 LINE Login Channel ID
- `CALENDAR_ADMIN_LINE_CHANNEL_ID`：Admin LIFF 所屬 LINE Login Channel ID

建議 User/Admin LIFF 使用不同 LINE Login Channel；兩者可建立在同一個 LINE Provider 下。

`CALENDAR_SYSTEM_V2_SPREADSHEET_ID` 不需要手動填；系統可自動建立。如果要使用既有的全新 Spreadsheet，也可以自行填入。

### 3. 初始化資料表

在 Apps Script 編輯器執行：

```text
setupCalendarSystem()
```

它只會建立/確認 V2 所需工作表，不會讀取或遷移舊 CalendarSystem 的資料。

### 4. Deploy Web App

Deploy → New deployment → Web app：

- Execute as：Me
- Who has access：Anyone

Web App 必須公開可呼叫，真正的存取控制由 GAS 內的 LINE ID Token 驗證與 `Admins` authorization 執行。

### 5. 設定前端 config.json

填入：

- `gasWebAppUrl`
- `userLiffId`
- `adminLiffId`

`config.json` 只能放 public configuration，不得放 Channel Secret、ID Token 或其他 secret。

### 6. LIFF Endpoint URL

User LIFF：

```text
https://yongshengchen0615.github.io/MembershipSystem/CalendarSystem/user/
```

Admin LIFF：

```text
https://yongshengchen0615.github.io/MembershipSystem/CalendarSystem/admin/
```

## API actions

所有 POST request 使用 `text/plain` JSON，以避免不必要的 CORS preflight；所有受保護 action 都需要 `idToken`。

`user.bootstrap`、`user.calendar.list`、`admin.bootstrap` 與 `admin.calendar.list` 可選擇傳入 `rangeStart` 與 `rangeEnd`（`YYYY-MM-DD`，最多連續 42 天）取得重疊事項。兩者都省略時會維持完整清單回應，以相容既有客戶端與管理端批量選取。

- `user.bootstrap`
- `user.calendar.list`
- `admin.bootstrap`
- `admin.calendar.list`
- `admin.calendar.create`
- `admin.calendar.update`
- `admin.calendar.archive`

管理端 update/archive 會帶 `expectedUpdatedAt` 做 optimistic concurrency control，避免兩個管理者互相覆蓋變更。

Rate limit 回應會附帶 `error.details.retryAfterSeconds`，前端會顯示下一次可重試的時間。批量操作依筆數計算寫入成本；一筆 20 項的批次會使用 20/30 的每分鐘寫入額度。

## 安全邊界

- 不信任 client 傳入的 LINE user id / display name / role。
- GAS 不接受 client 傳入的 admin boolean。
- LINE ID Token 不寫入 Sheet、log、URL、localStorage、sessionStorage 或 CacheService value。
- LINE identity cache key 只使用 SHA-256 digest，不保存 raw token。
- GAS 將 ID Token 以 POST body 傳給 LINE Verify API，不使用 token query string。
- GAS 檢查驗證結果的 `sub`、`aud`、`exp`、`iss`，並以對應 Channel ID 限制 User/Admin surface。
- Admin 權限只在 server-side 判斷，且不放入 LINE identity cache。
- 寫入採 Script Lock，降低併發更新造成資料破壞的風險。
- 管理操作保留 AuditLogs。
- API 做 request size、欄位長度、日期格式、enum 與 rate limit 驗證。
- Sheet 寫入會防止公式注入。

## UI / UX

- Admin 與 User 都維持 calendar-first 操作。
- 點日期使用 modal 顯示/編輯當日內容，關閉後恢復到原日期焦點。
- 顯示最近同步時間與同步狀態，不再用一般 `alert()` 表示資料更新失敗。
- User 在更新失敗時保留上一份可用日曆，不因暫時網路錯誤清空畫面。
- Admin 顏色 preset 有可存取的 `aria-pressed` 選取狀態。
- 支援 `prefers-reduced-motion`，鍵盤 focus 有清楚可見狀態。

## 測試

Repository clone 後可執行：

```bash
node --test MembershipSystem/CalendarSystem/tests/*.test.js
```

測試涵蓋架構、安全不變量、UI modal/color contract 與這次新增的 performance invariants。GAS Web App、LINE Login、Google Sheet 與實際網路延遲仍需部署最新 GAS version 後做 integration verification。
