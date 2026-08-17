# MembershipSystem — 會員卡 MVP

此資料夾提供 GitHub Pages 前端（HTML / CSS / JavaScript）與 Google Apps Script（GAS）後端。第一階段只實作「會員卡」，包含一般會員端與管理端。

## 功能

### 用戶端 `index.html`
- LINE LIFF 登入。
- 第一次登入自動建立會員資料與唯一會員編號。
- 顯示會員姓名、頭像、會員編號、等級、會員狀態、加入日期與有效期限。
- 只有通過伺服器管理權限驗證的使用者才顯示管理端入口。

### 管理端 `admin.html`
- 管理權限由 GAS server-side 驗證，不信任前端角色資訊。
- 會員總數 / 有效 / 停權與停用統計。
- 依會員編號或名稱搜尋。
- 修改會員等級、會員狀態、有效期限、管理備註。
- 使用 `expectedUpdatedAt` 做樂觀鎖，降低多人同時修改造成覆寫的風險。

## Domain Model

目前 MVP 明確拆分以下概念：
- **Identity**：LINE `sub`（LINE user ID），由 LINE ID Token 驗證取得。
- **Authentication**：LIFF ID Token → GAS → LINE Verify ID Token API。
- **Permission / Authorization**：`Members.canManageMembers` 是「管理會員」權限；GAS 在 server-side 讀取此欄位判斷。
- **Membership**：會員編號、tier、membershipStatus、joinedAt、expiresAt。
- **Profile**：displayName、pictureUrl，來源為 LINE 驗證後的 ID Token claims。
- **Audit Event**：會員建立與管理端會員修改事件。

目前沒有建立複雜 Role engine；`tier` 只代表會員等級，**不會**授予管理權限。管理能力只由 `canManageMembers` 決定。

## Google Sheet Schema

GAS 第一次使用時會自動建立工作表及必要欄位；既有工作表若缺少必要欄位，也會自動插入缺少的欄位並保留原資料。

### `Members`
`lineUserId | memberNo | displayName | pictureUrl | tier | membershipStatus | joinedAt | expiresAt | note | createdAt | updatedAt | canManageMembers`

`canManageMembers`：
- 新會員預設為 `FALSE`。
- 設為 `TRUE`：允許進入管理端並呼叫會員管理 API。
- 改回 `FALSE`：撤銷管理權限，下一次 API request 即生效。
- 此欄位不由前端 API 修改，只能直接在 Google Sheet 管理。

### `AuditLogs`
`timestamp | actorLineUserId | actorRole | action | targetLineUserId | result | details`

### Schema 自動建立 / 補欄規則
- 工作表不存在：自動建立工作表及完整 header。
- 工作表存在但缺欄：GAS 會把缺少的必要欄位插入到正確位置。
- 額外自訂欄位：保留，不會被 GAS 刪除。
- 必要欄位若被手動重新排序，GAS 會回報 schema error，避免把資料寫進錯誤欄位。

## 部署步驟

1. 建立一份 Google Spreadsheet，複製 Spreadsheet ID。
2. 建立 Standalone Google Apps Script 專案，將 `gas/Code.gs` 與 `gas/appsscript.json` 複製進去。
3. 在 Apps Script → Project Settings → Script properties 只需設定：
   - `SPREADSHEET_ID`：Google Sheet ID。
   - `LINE_CHANNEL_ID`：LIFF 所屬 LINE Login Channel ID（不是 LIFF ID）。
4. Apps Script Deploy → New deployment → Web app：
   - Execute as：Me。
   - Who has access：Anyone。
   - 部署後取得以 `/exec` 結尾的 Web App URL。
5. 到 LINE Developers 建立 / 設定 LIFF App：
   - Endpoint URL：`https://yongshengchen0615.github.io/MembershipSystem/`
   - Scope 至少勾選 `openid`、`profile`。
6. 修改 `config.js`：
   - `LIFF_ID`：你的 LIFF ID。
   - `GAS_WEB_APP_URL`：第 4 步的 `/exec` URL。
7. 部署後，先以自己的 LINE 帳號登入會員端一次。GAS 會自動建立 `Members` 工作表、必要欄位與你的會員資料。
8. 打開 Google Sheet，在自己的會員那一列，把 `canManageMembers` 從 `FALSE` 改成 `TRUE`。
9. 重新整理會員頁或管理頁即可取得管理權限；**不需要設定 `ADMIN_LINE_USER_IDS`，也不需要因為授權會員而重新部署 GAS。**

## Security Notes

- 前端不會把 `liff.getProfile()` 或 decoded profile 當成後端身分來源；只把原始 ID Token 傳給 GAS。
- GAS 使用 LINE `POST /oauth2/v2.1/verify` 驗證 ID Token 並比對 Channel ID。
- 管理端 API 每次都重新做 Authentication + server-side Permission check。
- `canManageMembers` 不存在於 `admin.update` 可修改的 payload 白名單，前端不能用 Mass Assignment 自行取得管理權。
- `tier` 與管理 Permission 完全分離；把會員改成 `vip` 不會變成管理員。
- 不使用密碼，不儲存 LINE ID Token / access token / secret，也不將 Token 寫入 Log 或 Sheet。
- API 以會員編號操作，不把 LINE user ID 暴露到管理端瀏覽器。
- 管理端搜尋與更新設有簡易 rate limit；第一次建檔與更新使用 LockService 處理併發。
- 寫入 Google Sheet 前會防止以 `=`, `+`, `-`, `@` 開頭的文字被解讀成公式，降低 Spreadsheet Formula Injection 風險。
- Web App 必須公開讓 LIFF 呼叫，但所有受保護操作仍需要有效 LINE ID Token。
- **Google Spreadsheet 的編輯權限現在也是安全邊界。** 任何能編輯 `Members.canManageMembers` 的人，都能授予或撤銷管理權，因此 Spreadsheet 只能分享給可信任的管理者。
- 直接手動修改 `canManageMembers` 不會經過目前 GAS API，因此該次權限變更本身不會自動寫入 `AuditLogs`。若未來需要完整管理稽核，可再加入 installable `onEdit` trigger。
- 目前為小型 MVP。若會員量明顯增加，應將 Google Sheet 替換成具索引、交易與細緻權限控制的資料庫。

## 可驗證情境

- Happy path：新會員登入 → GAS 自動建立 Sheet / 欄位 / 會員卡 → 再登入取得同一會員編號。
- Schema migration：舊版 `Members` 沒有 `canManageMembers` → GAS 自動新增欄位 → 原會員資料保留。
- Grant admin：將本人 `canManageMembers` 改成 `TRUE` → 下一次 request 可使用管理 API。
- Revoke admin：改回 `FALSE` → 下一次 request 的 `admin.list` / `admin.update` 被拒絕。
- Unauthenticated：缺少 / 失效 ID Token → 拒絕。
- Unauthorized：`canManageMembers` 非 `TRUE` 的會員呼叫 `admin.list` / `admin.update` → 拒絕。
- Invalid input：非法 tier、status、日期、超長 note → 拒絕。
- Duplicate / concurrent registration：同 LINE user 同時第一次登入 → Lock + 再查詢避免重複建卡。
- Concurrent admin update：`expectedUpdatedAt` 不一致 → `CONFLICT`，要求重新整理。
- Privilege escalation：修改前端 JavaScript、偽造會員 tier 或直接打 admin API，仍會由 GAS 檢查 `canManageMembers`。
