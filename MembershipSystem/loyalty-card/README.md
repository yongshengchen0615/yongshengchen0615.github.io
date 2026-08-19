# Loyalty Card / 集點卡

全新集點卡模組，所有原始碼都放在 `MembershipSystem/loyalty-card/`，但依技術類型分開管理。GitHub Pages 發布 HTML/CSS/JS；`gas/` 內原始碼另外部署到 Google Apps Script Web App。

## 目錄結構

```text
MembershipSystem/loyalty-card/
├─ config.json
├─ README.md
├─ html/
│  ├─ index.html
│  └─ admin/
│     └─ index.html
├─ css/
│  └─ styles.css
├─ js/
│  ├─ bootstrap.js
│  └─ app.js
└─ gas/
   ├─ Code.gs
   ├─ Bridge.html
   └─ appsscript.json
```

- 用戶端：`/MembershipSystem/loyalty-card/html/`
- 管理端：`/MembershipSystem/loyalty-card/html/admin/`
- `config.json`：只放可公開的前端設定
- `gas/`：GAS 原始碼，需另外部署到 Apps Script

## 系統架構

- Frontend：HTML + CSS + Vanilla JavaScript
- Backend：Google Apps Script Web App
- Identity：LINE Login v2.1 + OpenID Connect + PKCE
- Data：Google Sheets
- Browser ↔ GAS：隱藏 iframe bridge + `postMessage` + `google.script.run`

前端不包含 LINE Channel Secret。Channel Secret 只能存在 GAS Script Properties。

## Domain / Sheets

執行 `setupLoyaltyCard_()` 後建立：

- `Users`：LINE Identity、顯示名稱、Account Status
- `LoyaltyAccounts`：卡號、點數餘額、集點卡狀態
- `Transactions`：append-only 點數交易、idempotency key
- `Sessions`：Session token SHA-256 hash、到期與撤銷
- `Admins`：LINE User ID、Role、Active
- `AuditLogs`：登入、權限與點數異動稽核
- `Settings`：兌換門檻、Session 時效、最大點數

Role、Account Status、Loyalty Account 狀態分離；會員點數或 Membership 不等於 Admin Permission。

## 1. 部署 GAS

將 `gas/Code.gs`、`gas/Bridge.html`、`gas/appsscript.json` 複製到 standalone Google Apps Script project。

先執行：

```text
setupLoyaltyCard_()
```

系統會建立 Google Spreadsheet，並把 `SPREADSHEET_ID` 寫入 Script Properties。

## 2. GAS Script Properties

設定：

```text
LINE_CHANNEL_ID=<LINE Login channel ID>
LINE_CHANNEL_SECRET=<LINE Login channel secret>
PUBLIC_ORIGIN=https://yongshengchen0615.github.io
PUBLIC_BASE_URL=https://yongshengchen0615.github.io/MembershipSystem/loyalty-card/html
WEB_APP_URL=https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
SPREADSHEET_ID=<setupLoyaltyCard_ 建立>
```

`LINE_CHANNEL_SECRET`、Session Token、LINE Access Token、ID Token 不得放入 GitHub、`config.json`、URL、前端 Log 或 AuditLogs。

## 3. 前端 config.json

GAS Web App 部署完成後，修改根目錄 `config.json`：

```json
{
  "gasWebAppUrl": "https://script.google.com/macros/s/DEPLOYMENT_ID/exec",
  "publicOrigin": "https://yongshengchen0615.github.io",
  "basePath": "/MembershipSystem/loyalty-card/html"
}
```

`js/bootstrap.js` 會先讀取 `config.json`，成功後才載入 `js/app.js`。

## 4. LINE Login Console

Callback URL：

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?route=oauth-callback
```

Scope：

```text
profile openid
```

登入流程使用：

- Authorization Code
- `state`
- `nonce`
- PKCE `S256`
- LINE ID Token verification
- 瀏覽器 handoff secret

## 5. 第一位管理員

1. 先從用戶端使用 LINE 登入一次。
2. 到 `Users` Sheet 找自己的 `line_user_id`。
3. 在 `Admins` 新增：

```text
line_user_id | role  | active | created_at
Uxxxxxxxx... | admin | TRUE   | 2026-08-19T00:00:00.000Z
```

管理端每個操作都會在 GAS server-side 執行 `requireAdmin_()`，不信任前端傳入的 Role。

## 點數規則

- Admin/Staff 可 `+1`、`+5`、`-1`、兌換獎勵。
- 預設每 10 點兌換一次。
- 不允許負餘額。
- 單次人工增減最大 100 點。
- Mutation 必須帶 `idempotencyKey`。
- 點數更新使用 `LockService`，避免 concurrent lost update。
- 所有成功/失敗點數操作寫入 AuditLogs。

## Security Review

- Authentication：LINE Login + PKCE + state + nonce + ID Token verification。
- Authorization：所有 Admin API server-side 驗證 Session + Role + User Status + Loyalty Account Status。
- IDOR：`userId` 只用來指定 Target Resource，不代表已授權。
- Session：Browser 只在當前頁面記憶體保存 bearer session；GAS 只存 SHA-256 hash，可到期與撤銷。
- Replay：OAuth nonce/PKCE、login handoff secret、mutation idempotency key。
- Injection：寫入 Sheets 的外部字串防 Spreadsheet Formula Injection。
- Audit：不記錄 Secret、完整 Token 或 Credential。

## 驗證清單

1. 未登入用戶端只顯示 LINE Login。
2. LINE 拒絕授權不建立 Session。
3. 首次登入建立 User + LoyaltyAccount，初始 0 點。
4. 一般會員進管理端會被 server-side 拒絕。
5. Admin 可搜尋會員並讀取點數。
6. `+1` 後 Balance、Transactions、AuditLogs 一致。
7. 相同 idempotency key 重送不重複加點。
8. 0 點執行 `-1` 會被拒絕。
9. 點數低於門檻不能兌換。
10. Session expired/revoked 後所有 protected API 拒絕。
11. User status 非 `ACTIVE` 後既有 Session 也不能操作。
12. 並發點數更新不應發生 lost update。

## 尚需人工設定

Repository 不包含你的 LINE Channel ID、Channel Secret、GAS Deployment ID，也不能代替 LINE Developers Console 與 Apps Script 的帳號授權。因此程式碼完成後，仍需依上面步驟部署 GAS 並更新 `config.json` 才能實際登入。
