# Loyalty Card / 集點卡

獨立集點卡模組。User UI、Admin UI 與 GAS backend 分開管理；User/Admin 各自擁有自己的 HTML、CSS、JavaScript，不共用前端 bundle。

## 目錄結構

```text
MembershipSystem/loyalty-card/
├─ index.html                 # 導向 user/，並保留 LINE Web Login callback query
├─ config.json                # 僅公開 runtime 設定
├─ README.md
├─ user/
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js
├─ admin/
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js
└─ gas/
   ├─ Code.gs
   ├─ LiffAuth.gs
   ├─ Bridge.html
   └─ appsscript.json
```

- User URL: `/MembershipSystem/loyalty-card/user/`
- Admin URL: `/MembershipSystem/loyalty-card/admin/`
- Root `/MembershipSystem/loyalty-card/` 只負責導向 User。
- GAS 原始碼另外部署到 Google Apps Script Web App。

## Authentication / Authorization

### User

優先使用 LIFF：

1. Browser 載入 LIFF SDK。
2. `liff.init()` 初始化 User LIFF app。
3. 未登入時使用 `liff.login()`。
4. `liff.getIDToken()` 取得 ID Token。
5. ID Token 透過 GAS bridge 傳到 `loginWithLiff()`。
6. GAS 呼叫 LINE Verify ID Token endpoint，驗證 token 與 LINE Login Channel ID。
7. GAS 建立本系統自己的 revocable session。

若 `userLiffId` 尚未設定，User UI 仍可退回既有 LINE Web Login + PKCE 流程。

### Admin

Admin 可選擇第二個 `adminLiffId`，也可繼續使用 LINE Web Login。

**LIFF 登入成功不代表擁有 Admin 權限。** 所有管理 API 都會在 GAS server-side 重新執行 Session + Admin Role + Account Status + Resource/Business Rule 驗證。

## 1. config.json

GAS Web App 部署完成後修改：

```json
{
  "gasWebAppUrl": "https://script.google.com/macros/s/DEPLOYMENT_ID/exec",
  "publicOrigin": "https://yongshengchen0615.github.io",
  "basePath": "/MembershipSystem/loyalty-card",
  "userLiffId": "1234567890-abcdefgh",
  "adminLiffId": ""
}
```

`config.json` 是公開檔案。禁止放入：

- LINE Channel Secret
- Session Token
- LINE Access Token
- ID Token
- 任何 private credential

## 2. LIFF 設定

在與本系統 LINE Login Channel 關聯的 LIFF 設定中建立 User LIFF app：

```text
Endpoint URL:
https://yongshengchen0615.github.io/MembershipSystem/loyalty-card/user/

Scopes:
openid
profile
```

把 LIFF ID 填入 `config.json.userLiffId`。

若管理端也要使用 LIFF，建立第二個 LIFF app：

```text
Endpoint URL:
https://yongshengchen0615.github.io/MembershipSystem/loyalty-card/admin/

Scopes:
openid
profile
```

再把 LIFF ID 填入 `config.json.adminLiffId`。若留空，管理端使用 LINE Web Login。

## 3. GAS 部署

將以下檔案放進同一個 standalone Apps Script project：

```text
Code.gs
LiffAuth.gs
Bridge.html
appsscript.json
```

先執行：

```text
setupLoyaltyCard_()
```

會建立 Google Spreadsheet 與：

- Users
- LoyaltyAccounts
- Transactions
- Sessions
- Admins
- AuditLogs
- Settings

## 4. GAS Script Properties

設定：

```text
LINE_CHANNEL_ID=<LINE Login channel ID>
LINE_CHANNEL_SECRET=<LINE Login channel secret>
PUBLIC_ORIGIN=https://yongshengchen0615.github.io
PUBLIC_BASE_URL=https://yongshengchen0615.github.io/MembershipSystem/loyalty-card
WEB_APP_URL=https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec
SPREADSHEET_ID=<setupLoyaltyCard_ 建立>
```

`LINE_CHANNEL_SECRET` 只能存在 GAS Script Properties。

## 5. LINE Web Login fallback

LINE Login callback URL：

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?route=oauth-callback
```

既有 fallback 使用：

- Authorization Code
- PKCE S256
- state
- nonce
- server-side ID Token verification
- browser handoff secret

## 6. 第一位管理員

1. 先使用 LINE / LIFF 登入 User UI 一次。
2. 到 `Users` Sheet 找自己的 `line_user_id`。
3. 在 `Admins` 新增：

```text
line_user_id | role  | active | created_at
Uxxxxxxxx... | admin | TRUE   | 2026-08-19T00:00:00.000Z
```

允許角色目前為 `admin` / `staff`。

## Security Review

- Authentication：LIFF ID Token 必須在 GAS server-side 透過 LINE Verify ID Token endpoint 驗證；不信任前端 decoded profile。
- Authorization：Admin API 每次都執行 `requireAdmin_()`；LIFF / LINE Login 只證明 Identity。
- IDOR：管理端傳入的 `userId` 只是 resource selector，操作前仍檢查 Admin 權限、User status、LoyaltyAccount status。
- Session：Browser bearer session 只保留在目前頁面記憶體；GAS 只存 SHA-256 hash，並支援 expiry / revocation。
- Replay：LINE Web Login 有 PKCE/state/nonce；LIFF ID Token 經 LINE server 驗證並受 expiry 約束；point mutation 使用 idempotency key。
- Concurrency：點數 mutation 使用 `LockService`。
- Formula Injection：外部字串寫入 Sheet 前防 `= + - @` 開頭。
- Secrets：不寫入 GitHub、URL、frontend log 或 AuditLogs。

## Verification checklist

1. `/user/` 未登入 → 顯示 LINE 登入。
2. User LIFF app 內開啟 → `liff.init()` 後可完成 LINE Identity 驗證。
3. 外部瀏覽器 LIFF → 使用 `liff.login()`，返回 `/user/` 後建立本系統 session。
4. 偽造/過期/其他 Channel 的 ID Token → GAS 拒絕。
5. 一般會員開 `/admin/` → 即使 LINE/LIFF Authentication 成功，`adminBootstrap` 仍拒絕。
6. Admin 搜尋會員 → 可查看卡號與餘額。
7. Admin +1 → balance +1，Transactions / AuditLogs 新增紀錄。
8. 同 idempotency key 重送 → 不重複加點。
9. 餘額不足扣點/兌換 → 拒絕。
10. Session expired/revoked → User/Admin API 都拒絕。
11. Account Status 非 ACTIVE → 既有 session 也不能繼續操作。
12. Concurrent point updates → balance 與 transaction 應一致。

## 尚需部署環境驗證

Repository 不包含實際 LINE Channel Secret、LIFF ID 與 GAS deployment URL，因此目前只能完成 source-level verification。真正的 LIFF end-to-end login 必須在 LINE Developers Console 與正式 GAS deployment 設定完成後驗證。
