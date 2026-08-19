# Loyalty Card / 集點卡

LIFF 集點卡採四層架構：User、Admin、API Proxy、GAS。User/Admin 各自擁有自己的 HTML/CSS/JavaScript；瀏覽器不直接呼叫 GAS，所有 API 經 Cloudflare Worker Proxy；GAS 為純 JSON backend，不包含 HTML UI。

## 目錄結構

```text
MembershipSystem/loyalty-card/
├─ index.html
├─ config.json
├─ README.md
├─ user/
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js
├─ admin/
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js
├─ api-proxy/
│  ├─ package.json
│  ├─ wrangler.jsonc
│  └─ src/
│     └─ index.js
└─ gas/
   ├─ Code.gs
   ├─ LiffAuth.gs
   ├─ StorageBootstrap.gs
   └─ appsscript.json
```

## Request Flow

```text
User/Admin Browser
      ↓ HTTPS JSON
Cloudflare Worker API Proxy
      ↓ HTTPS JSON + API_PROXY_SECRET
Google Apps Script doPost()
      ↓
LINE Verify ID Token / Google Sheets
```

### LIFF Authentication

1. Frontend 執行 `liff.init()`。
2. 未登入時使用 `liff.login()`。
3. Frontend 只取得 `liff.getIDToken()`。
4. ID Token 經 API Proxy 傳給 GAS `loginWithLiff()`。
5. GAS 呼叫 LINE Verify ID Token endpoint。
6. 只使用 LINE server 驗證後的 `sub / name / picture` 建立或更新會員。
7. 第一次成功驗證時，GAS 自動建立 Spreadsheet 與必要 Sheets。
8. GAS 建立本系統 Session；browser 只在目前頁面記憶體保存 bearer token。

LIFF 只負責 Authentication。Admin Authorization 仍由 GAS server-side 的 `Admins`、Role、Account Status 與 Business Rule 決定。

## Frontend config.json

`config.json` 是公開設定：

```json
{
  "apiProxyUrl": "https://membership-loyalty-api.<account>.workers.dev",
  "publicOrigin": "https://yongshengchen0615.github.io",
  "basePath": "/MembershipSystem/loyalty-card",
  "userLiffId": "2010787602-eIzRN9l6",
  "adminLiffId": "2010787602-fkKU5flW"
}
```

禁止放入 Secret、LINE ID Token、Session Token 或其他 credential。

## 1. LINE LIFF

User LIFF endpoint：

```text
https://yongshengchen0615.github.io/MembershipSystem/loyalty-card/user/
```

Admin LIFF endpoint：

```text
https://yongshengchen0615.github.io/MembershipSystem/loyalty-card/admin/
```

兩者 scope：

```text
openid
profile
```

## 2. GAS Script Properties

GAS 只需要：

```text
LINE_CHANNEL_ID=<LINE Login channel ID>
API_PROXY_SECRET=<至少 32 字元高熵隨機值>
SPREADSHEET_ID=<自動建立；通常不需手動設定>
```

`LINE_CHANNEL_SECRET`、`PUBLIC_ORIGIN`、`PUBLIC_BASE_URL`、`WEB_APP_URL` 不再是 LIFF-only backend 的必要設定。

### 自動建表

第一次有效 LIFF ID Token 經 LINE 驗證成功後，`ensureLoyaltyStorage_()` 會自動建立 Spreadsheet 與：

- `Users`
- `LoyaltyAccounts`
- `Transactions`
- `Sessions`
- `Admins`
- `AuditLogs`
- `Settings`

若既有 `SPREADSHEET_ID` 指向的資料表 schema 不符合預期，系統會停止並報錯，不會自動覆蓋既有資料。

## 3. 部署 GAS

將以下檔案部署到同一個 standalone Apps Script project：

```text
Code.gs
LiffAuth.gs
StorageBootstrap.gs
appsscript.json
```

Deploy → New deployment → Web app：

```text
Execute as: Me
Who has access: Anyone
```

取得 `/exec` URL，填入 `api-proxy/wrangler.jsonc` 的 `GAS_BACKEND_URL`。

GAS `doPost()` 只接受 JSON RPC，並驗證 body 中由 Proxy 注入的 `API_PROXY_SECRET`。瀏覽器不應直接呼叫 GAS。

## 4. 部署 Cloudflare API Proxy

進入：

```text
MembershipSystem/loyalty-card/api-proxy
```

安裝並設定 Secret：

```bash
npm install
npx wrangler secret put API_PROXY_SECRET
```

輸入的值必須與 GAS Script Property `API_PROXY_SECRET` 完全相同。

部署：

```bash
npm run check
npm run deploy
```

部署後取得 Worker URL，例如：

```text
https://membership-loyalty-api.<account>.workers.dev
```

再把 URL 填入根目錄 `config.json.apiProxyUrl`。

Proxy 只允許指定 GitHub Pages Origin 的 browser RPC，限制 JSON request size 與 RPC method allowlist，並且不記錄 ID Token / Session Token。

## 5. 建立第一位管理員

1. 先從 `/user/` 完成一次 LIFF 登入。
2. GAS 會自動建立資料表並寫入 `Users`。
3. 在 `Users` 找到自己的 `line_user_id`。
4. 在 `Admins` 新增：

```text
line_user_id | role  | active | created_at
Uxxxxxxxx... | admin | TRUE   | 2026-08-19T00:00:00.000Z
```

允許 Role：`admin` / `staff`。

## API Methods

Proxy / GAS allowlist：

```text
health
loginWithLiff
getMyCard
logoutSession
adminBootstrap
adminSearchMembers
adminGetMember
adminAdjustPoints
```

## Security Review

- Authentication：GAS 以 LINE Verify ID Token endpoint 驗證 LIFF ID Token；不信任 client-supplied profile。
- Proxy Boundary：GAS 要求 `API_PROXY_SECRET`；Secret 只存在 Cloudflare Worker Secret 與 GAS Script Properties。
- Authorization：所有 Admin API server-side 執行 Session + Role + Account Status 檢查。
- IDOR：管理端 `userId` 只是 target selector，不等於已授權。
- Session：GAS 只保存 session token SHA-256 hash，支援 expiry / revocation。
- Replay / Duplicate：點數 mutation 使用 idempotency key。
- Concurrency：點數 mutation 使用 `LockService`。
- Formula Injection：寫入 Sheets 的外部字串會處理 `= + - @` 開頭。
- Secrets：不得寫入 GitHub、URL、frontend log、AuditLogs。
- Observability：Worker 啟用 Cloudflare observability；結構化 log 不包含身份 token 或 session token。

## Verification Checklist

1. Worker `/health` 能取得 GAS health response。
2. 非指定 Origin 的 browser RPC → Proxy 拒絕。
3. 直接呼叫 GAS 且沒有正確 `API_PROXY_SECRET` → GAS 拒絕。
4. User LIFF 首次登入 → 自動建立 Spreadsheet、User、LoyaltyAccount。
5. 偽造/過期/其他 Channel ID Token → GAS 拒絕。
6. 一般會員登入 Admin LIFF → GAS 拒絕建立 Admin session。
7. Admin 搜尋會員 → 可讀取卡號與餘額。
8. Admin `+1` → balance / Transactions / AuditLogs 一致。
9. 相同 idempotency key 重送 → 不重複加點。
10. Session expired/revoked → User/Admin API 都拒絕。
11. Account Status 非 `ACTIVE` → 既有 session 也不能繼續操作。
12. Concurrent point updates → 最終 balance 與 Transactions 一致。

## 尚需部署環境完成

Repository 已包含完整程式與設定骨架，但仍需人工完成：

- 將 GAS 新版本重新部署為 Web App。
- 在 GAS 設定 `LINE_CHANNEL_ID` 與 `API_PROXY_SECRET`。
- 部署 Cloudflare Worker 並設定相同 `API_PROXY_SECRET`。
- 將 Worker URL 寫入 `config.json.apiProxyUrl`。
- 在正式 LIFF 環境執行 E2E 驗證。
