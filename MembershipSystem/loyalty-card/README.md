# Loyalty Card / 集點卡

一套放在 `MembershipSystem/loyalty-card/` 的獨立集點卡模組：GitHub Pages 提供用戶端與管理端 UI，Google Apps Script (GAS) 提供 LINE Login、Session、Authorization、Google Sheets 資料層與點數交易。

## 架構

- User UI: `/MembershipSystem/loyalty-card/`
- Admin UI: `/MembershipSystem/loyalty-card/admin/`
- Frontend: HTML + CSS + vanilla JavaScript
- Backend: Google Apps Script Web App
- Identity: LINE Login v2.1 + OpenID Connect + PKCE
- Data: Google Sheets
- Browser ↔ GAS: 隱藏 iframe bridge + `postMessage` + `google.script.run`

前端**不包含** LINE Channel Secret。GAS bridge 僅接受 `PUBLIC_ORIGIN` 的訊息，且所有管理 API 仍會在 server-side 重新驗證 Session、Admin role、會員狀態與 Business Rule。

## Domain / Sheets

`setupLoyaltyCard_()` 會建立：

- `Users`: LINE identity 對應與 Account Status
- `LoyaltyAccounts`: 卡號、點數餘額、集點卡狀態
- `Transactions`: append-only 點數交易與 idempotency key
- `Sessions`: 只保存 session token 的 SHA-256 hash、到期與撤銷時間
- `Admins`: LINE User ID、role (`admin` / `staff`) 與 active
- `AuditLogs`: 登入、管理權限、點數異動等稽核事件
- `Settings`: `stamps_per_reward`、`session_hours`、`max_balance`

Role / Account Status / Loyalty Account 狀態分離，管理權限不由點數或會員等級決定。

## 1. 建立 Apps Script 專案

將 `gas/Code.gs`、`gas/Bridge.html`、`gas/appsscript.json` 放入一個 standalone Apps Script project。

先在 Apps Script editor 執行：

```text
setupLoyaltyCard_()
```

它會建立 Google Spreadsheet，並把 `SPREADSHEET_ID` 存到 Script Properties。

## 2. 設定 Script Properties

在 Apps Script → Project Settings → Script Properties 設定：

```text
LINE_CHANNEL_ID=<LINE Login channel ID>
LINE_CHANNEL_SECRET=<LINE Login channel secret>
PUBLIC_ORIGIN=https://yongshengchen0615.github.io
PUBLIC_BASE_URL=https://yongshengchen0615.github.io/MembershipSystem/loyalty-card
WEB_APP_URL=<部署後的 https://script.google.com/macros/s/.../exec>
SPREADSHEET_ID=<setupLoyaltyCard_ 建立；通常不需手動填>
```

Secret 不要寫進 `config.js`、GitHub、URL、console log 或 AuditLogs。

## 3. 部署 GAS Web App

Deploy → New deployment → Web app：

- Execute as: **Me**
- Who has access: 依你的 Google Workspace / Apps Script 可用選項，需讓實際 LINE 使用者可開啟 Web App

部署後取得 `/exec` URL，寫入 `WEB_APP_URL` Script Property，也把同一 URL 填進 `config.js`：

```js
window.LOYALTY_CONFIG = Object.freeze({
  gasWebAppUrl: 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec',
  publicOrigin: 'https://yongshengchen0615.github.io',
  basePath: '/MembershipSystem/loyalty-card'
});
```

## 4. LINE Login Console

建立/使用 LINE Login channel，Web app callback URL 設為：

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?route=oauth-callback
```

Scope 使用 `profile openid`。程式會產生每次登入專用的 `state`、`nonce`、PKCE `code_verifier` / `code_challenge`；callback 只在 GAS server 端用 Channel Secret 換 token，並使用 LINE Verify ID token endpoint 驗證 `client_id` 與 `nonce`。

## 5. 建立第一位管理員

1. 先從用戶端使用 LINE 登入一次。
2. 到 Spreadsheet → `Users` 找到你的 `line_user_id`。
3. 在 `Admins` 新增一列，例如：

```text
line_user_id | role  | active | created_at
Uxxxxxxxx... | admin | TRUE   | 2026-08-19T00:00:00.000Z
```

管理端每一次搜尋、讀取會員、集點、扣點、兌換都會重新做 server-side admin authorization；前端按鈕是否顯示不構成安全邊界。

## 點數規則

- Admin/Staff 可以 `+1`、`+5`、`-1`，也可兌換固定門檻。
- 預設每 10 點可兌換一次；可在 `Settings.stamps_per_reward` 修改。
- 扣點不允許負餘額。
- 單次人工增減預設最大 100 點。
- 每次 mutation 都需要 `idempotencyKey`，重複請求不會再次異動點數。
- 點數異動使用 `LockService` 串行化，降低 concurrent update 造成 lost update 的風險。

## Security notes

- Authentication: LINE Login v2.1 / Authorization Code + PKCE / state / nonce / ID token verification.
- Session: 隨機 bearer token 只保留在目前頁面的 JavaScript 記憶體；伺服器只存 SHA-256 hash，預設 12 小時，可撤銷。重新整理頁面需重新登入，避免同一 GitHub Pages origin 下其他路徑讀取持久 session。
- Authorization: Server-side `requireAdmin_()`；不信任前端傳入 role。
- IDOR: 管理端 target `userId` 只是 resource selector，實際操作前仍檢查 session、role、User status、LoyaltyAccount status。
- Concurrency: 點數 mutation 使用 Script Lock。
- Replay: OAuth nonce + PKCE；mutation idempotency key；login handoff 還需要瀏覽器 sessionStorage 中的第二個 secret。
- Formula Injection: 外部字串寫入 Sheets 前處理 `= + - @` 開頭。
- Secrets: Channel Secret 只放 Script Properties。
- Audit: 不記錄 password、session token、LINE access token、ID token 或 Channel Secret。

## 驗證清單

1. 未登入打開用戶端 → 只顯示 LINE Login。
2. LINE 拒絕授權 → 回到用戶端且不建立 session。
3. 正常登入 → 建立 User + LoyaltyAccount，初始 0 點。
4. 一般會員開 `/admin/` → server 回覆未授權。
5. Admin 搜尋會員 → 可看到卡號與餘額。
6. Admin `+1` → 餘額 +1，Transactions/AuditLogs 各新增紀錄。
7. 相同 idempotency key 重送 → 餘額不重複增加。
8. 餘額 0 執行 `-1` → 拒絕且餘額不變。
9. 餘額低於兌換門檻 → 兌換失敗。
10. Session 過期或 revoked → 用戶與管理 API 都拒絕。
11. `Users.status` 改成非 `ACTIVE` → 既有 session 也無法繼續使用。
12. 同時發出兩個點數更新 → 最終 balance 與兩筆 transaction 一致，不應 lost update。

## 部署後仍需人工完成

這個 repository 不包含你的 LINE Channel ID、Channel Secret、GAS deployment ID，也無法代替 LINE Developers Console / Apps Script 的帳號授權步驟。因此程式碼可提交，但實際登入在完成上述設定前不會啟用。
