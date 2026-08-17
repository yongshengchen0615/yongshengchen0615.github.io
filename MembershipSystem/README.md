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
- **Authorization**：管理權限來自 GAS Script Property `ADMIN_LINE_USER_IDS`，不由 Membership tier 決定。
- **Membership**：會員編號、tier、membershipStatus、joinedAt、expiresAt。
- **Profile**：displayName、pictureUrl，來源為 LINE 驗證後的 ID Token claims。
- **Audit Event**：會員建立與管理端會員修改事件。

本階段尚未實作 Subscription、付款、密碼 Credential、Refresh Token 或複雜 Role/Permission engine。

## Google Sheet Schema

GAS 第一次使用時會自動建立：

### `Members`
`lineUserId | memberNo | displayName | pictureUrl | tier | membershipStatus | joinedAt | expiresAt | note | createdAt | updatedAt`

### `AuditLogs`
`timestamp | actorLineUserId | actorRole | action | targetLineUserId | result | details`

請勿手動更改欄位順序；程式會檢查 schema，避免靜默寫入錯欄。

## 部署步驟

1. 建立一份 Google Spreadsheet，複製 Spreadsheet ID。
2. 建立 Standalone Google Apps Script 專案，將 `gas/Code.gs` 與 `gas/appsscript.json` 複製進去。
3. 在 Apps Script → Project Settings → Script properties 設定：`SPREADSHEET_ID`、`LINE_CHANNEL_ID`、`ADMIN_LINE_USER_IDS`（多個以逗號分隔）。
4. Apps Script Deploy → New deployment → Web app：Execute as `Me`，Who has access `Anyone`，取得以 `/exec` 結尾的 URL。
5. LINE Developers 的 LIFF Endpoint URL 設為 `https://yongshengchen0615.github.io/MembershipSystem/`，Scope 至少勾選 `openid`、`profile`。
6. 修改 `config.js` 的 `LIFF_ID` 與 `GAS_WEB_APP_URL`。
7. 合併此 branch 到 `main` 後即可由 GitHub Pages 開啟。
8. 第一次以自己的 LINE 帳號登入後，可在 `Members` 第一欄取得自己的 LINE user ID，再填入 `ADMIN_LINE_USER_IDS`。

## Security Notes

- 前端不會把 `liff.getProfile()` 或 decoded profile 當成後端身分來源；只把原始 ID Token 傳給 GAS。
- GAS 使用 LINE `POST /oauth2/v2.1/verify` 驗證 ID Token並比對 Channel ID。
- 管理端 API 每次都重新做 Authentication + server-side Authorization。
- 不使用密碼，不儲存 LINE ID Token / access token / secret，也不將 Token 寫入 Log 或 Sheet。
- 管理端更新採欄位白名單，避免 Mass Assignment。
- 管理端搜尋與更新設有簡易 rate limit；第一次建檔與更新使用 LockService 處理併發。
- Web App 必須公開讓 LIFF 呼叫，但所有受保護操作仍需要有效 LINE ID Token。
- 目前為小型 MVP；若會員量明顯增加，應將 Google Sheet 替換成具索引、交易與細緻權限控制的資料庫。

## 可驗證情境

- Happy path：新會員登入 → 建卡 → 再登入取得同一會員編號。
- Unauthenticated：缺少 / 失效 ID Token → 拒絕。
- Unauthorized：非管理員呼叫 `admin.list` / `admin.update` → 拒絕。
- Invalid input：非法 tier、status、日期、超長 note → 拒絕。
- Duplicate / concurrent registration：同 LINE user 同時第一次登入 → Lock + 再查詢避免重複建卡。
- Concurrent admin update：`expectedUpdatedAt` 不一致 → `CONFLICT`。
- Privilege escalation：修改前端 JavaScript 或直接打 admin API，仍會由 GAS 檢查 `ADMIN_LINE_USER_IDS`。
