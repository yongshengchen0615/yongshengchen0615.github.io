# MembershipSystem — 會員卡 MVP

GitHub Pages 前端 + Google Apps Script（GAS）後端的會員系統，包含一般會員端、管理端、會員時數與一次性 QR / URL 核銷。

## 資料夾結構

```text
MembershipSystem/
├─ index.html
├─ user/
│  ├─ index.html
│  ├─ styles.css
│  ├─ usage.css
│  └─ app.js
├─ admin/
│  ├─ index.html
│  ├─ styles.css
│  ├─ usage.css
│  └─ app.js
├─ shared/
│  ├─ config.json
│  └─ common.js
├─ gas/
│  ├─ Code.gs
│  └─ appsscript.json
└─ README.md
```

## 前端設定 `shared/config.json`

```json
{
  "LIFF_ID": "YOUR_LIFF_ID",
  "GAS_WEB_APP_URL": "YOUR_GAS_WEB_APP_URL"
}
```

`config.json` 是 GitHub Pages 公開資源，只能放前端公開設定。不得放 LINE Channel Secret、Access Token、API Secret、Password 或其他秘密。

## LIFF 重新登入政策

每次完整開啟或重新整理 `user/` / `admin/` 都重新建立本次 LIFF 登入狀態。

- 外部瀏覽器 / LINE 內建瀏覽器：既有 LIFF session 不直接放行，重新走 `liff.login()`。
- Login callback 使用一次性 random nonce + `sessionStorage` 驗證。
- LIFF Browser 由 `liff.init()` 自動完成登入並重新檢查 ID Token。
- LINE 自身 SSO 可能自動完成登入，因此不保證每次都出現帳密輸入畫面。

## 消費時數 Domain

### Member hours

會員時數以「分鐘」作為資料庫單位，UI 以小時顯示，避免浮點數扣除誤差。

- `availableMinutes`：目前可用時數。
- `consumedMinutes`：歷史成功核銷的累計時數。
- 管理端輸入以 `0.25` 小時（15 分鐘）為最小單位。
- `consumedMinutes` 不由管理端直接修改，只能由成功核銷累加。

### Usage Voucher

管理端針對指定會員建立一次性核銷券：

```text
Admin
→ 選擇會員
→ 指定消費時數 / 到期時間
→ GAS 產生隨機 token
→ Sheet 只保存 SHA-256 token hash
→ Admin 收到 raw token 一次
→ 前端產生 QR Code + URL
```

核銷券同時綁定 `targetLineUserId` 與 `targetMemberNo`。網址即使轉傳給其他 LINE 帳號，GAS 仍會拒絕。

狀態：

```text
issued → processing → redeemed
   └──────────────→ cancelled
issued + 到期時間已過 → expired（讀取時計算）
```

`processing` 用於跨 Sheet 更新的 crash recovery。若執行中斷，重試會比對會員核銷前 / 後餘額；只有狀態可安全判定時才繼續，否則 fail closed，避免重複扣除。

### Reserved hours

尚未使用且未過期的核銷券會占用可發放額度：

```text
可再發放分鐘 = availableMinutes - outstanding voucher minutes
```

因此不能建立超過目前可發放額度的核銷券，也不能把會員可用時數調低到尚未核銷券的保留時數以下。核銷成功、取消或過期後保留額度釋放。

## 用戶端 `user/`

- LINE LIFF Authentication。
- 顯示會員卡、可用時數、已消費時數。
- 可使用 `liff.scanCodeV2()` 掃描管理端 QR Code。
- 不支援 LIFF Scanner 的環境仍可直接開啟管理端發放網址。
- `?redeem=<token>` 開啟後先呼叫 `usage.preview`，不會自動扣時數。
- 使用者必須按「確認消費」後才呼叫 `usage.redeem`。

Scanner 只接受：

- 與目前會員頁相同 origin。
- 同一個 `user/` path。
- 合法 64 hex token。

掃描到的任意外部 URL 不會自動導向，降低 QR phishing / open redirect 風險。

## 管理端 `admin/`

- Server-side 管理 Permission 驗證。
- 搜尋會員、修改會員等級 / 狀態 / 有效期限 / 備註。
- 調整會員 `availableMinutes`；`consumedMinutes` 唯讀。
- 對指定會員建立一次性時數核銷券。
- 設定消費時數、到期時間與備註。
- 產生 QR Code 與可複製發放網址。
- 查看最近核銷券與取消尚未使用的核銷券。

QR Code 使用固定版本 `qrcode-generator@2.0.4` 在管理端瀏覽器產生，不使用第三方 QR image API，因此 URL 不會被送去遠端 QR image service。此第三方 JavaScript 目前從固定版本 CDN 載入；若要進一步降低前端供應鏈風險，可改為 vendored local asset。

## API

所有 POST API 都先執行：

```text
ID Token
→ LINE Verify ID Token API
→ Identity
→ Role / Permission
→ Business Rule
```

### Member

#### `member.me`

取得 / 建立會員並回傳公開會員資料與時數。

#### `usage.preview`

Request：

```json
{
  "token": "64-char-random-token"
}
```

檢查 token、target ownership、voucher state、expiry、Membership state 與 available hours；只 preview，不修改資料。

#### `usage.redeem`

Server-side flow：

```text
Authentication
→ Voucher target ownership
→ Voucher state / expiry
→ Membership state
→ Available hours
→ Script Lock
→ processing state
→ Member balance update
→ redeemed state
→ Audit
```

同會員對已完成 voucher 重送 request 採 idempotent success，不再次扣除。

### Admin

- `admin.list`：會員列表與統計。
- `admin.update`：可修改 `tier`、`membershipStatus`、`expiresAt`、`note`、`availableHours`；不可修改 `canManageMembers`、`consumedMinutes`、Identity 或 memberNo。
- `admin.usage.create`：建立一次性核銷券；只有建立 response 回傳 raw token。
- `admin.usage.list`：最近核銷券，不回傳 token hash / raw token / LINE user id。
- `admin.usage.cancel`：取消尚未成功核銷的 voucher。

## Google Sheet Schema

GAS 會自動建立缺少的 Sheet / 必要欄位。既有必要欄位若被重新排序則 fail closed。

### `Members`

```text
lineUserId | memberNo | displayName | pictureUrl | tier | membershipStatus |
joinedAt | expiresAt | note | createdAt | updatedAt | canManageMembers |
availableMinutes | consumedMinutes
```

新欄位追加在既有 `canManageMembers` 後方；舊會員空白值視為 `0` 分鐘。

### `UsageVouchers`

```text
voucherId | tokenHash | targetLineUserId | targetMemberNo | minutes | status |
expiresAt | note | createdByLineUserId | createdAt | updatedAt | processingAt |
redeemedByLineUserId | redeemedAt | cancelledByLineUserId | cancelledAt |
balanceBeforeMinutes | balanceAfterMinutes | consumedBeforeMinutes |
consumedAfterMinutes | auditRecordedAt
```

不保存 raw bearer token。

### `AuditLogs`

新增事件：

- `USAGE_VOUCHER_CREATED`
- `USAGE_VOUCHER_CANCELLED`
- `USAGE_REDEEMED`

Audit details 不包含 raw voucher token、LINE ID Token 或 Secret。

## Security Notes

- QR / URL token 是 bearer capability，但同時綁定指定 LINE Identity。
- Sheet 只保存 SHA-256 token hash；raw token 只在建立 response 與發放 QR / URL 中存在。
- Voucher 單次使用、可到期、可撤銷。
- `usage.redeem` 使用 Script Lock 防止並行 double-spend。
- `processing` + before/after balance 支援中斷後安全恢復。
- 管理端餘額修改沿用 `expectedUpdatedAt` optimistic lock；成功核銷也會更新 Member `updatedAt`。
- 管理端 UI 不是 Authorization Boundary，`admin.*` 仍由 GAS `requireAdmin_()` server-side 強制授權。
- Scanner 不會導向任意 URL。
- User / Admin page 設置 `referrer=no-referrer`，降低 query token 經 Referer 外洩風險。
- API 不回傳 token hash、LINE user id 或內部 processing 欄位。
- Token / Secret / Password 不寫入 Audit / public error。

## 部署

1. 更新 Apps Script `gas/Code.gs`。
2. **重新部署 Apps Script Web App**；這次不是純前端修改。
3. 保留 Script Properties：`SPREADSHEET_ID`、`LINE_CHANNEL_ID`。
4. LINE LIFF Scope 至少開啟 `openid`、`profile`。
5. 若要使用會員頁內建 QR Scanner，在 LINE Developers Console 的 LIFF 設定開啟 **Scan QR**。
6. 部署 GitHub Pages 前端。
7. 管理端先替會員設定「可用時數」。
8. 點「發放核銷」建立 QR / URL。
9. 用目標會員帳號掃描或開啟網址，確認 preview 後執行核銷。

## Verification

至少驗證：

- Existing schema migration：追加 `availableMinutes` / `consumedMinutes` 且舊資料保留。
- New member：兩個時數欄位預設 0。
- Unauthenticated / Unauthorized：管理 API 正確拒絕。
- Create voucher：超出可發放額度、過期時間、超過 30 天 → reject。
- Forwarded URL：非 target LINE Identity → reject。
- Preview：不扣時數。
- Redeem：正確扣 `availableMinutes`、增加 `consumedMinutes`。
- Duplicate / concurrent redeem：不可重複扣時數。
- Crash recovery：`processing` + before/after state 可恢復或 fail closed。
- Expired / cancelled voucher：不可 redeem。
- Suspended / disabled / expired Membership：不可 redeem。
- Admin stale update after redemption：`expectedUpdatedAt` → `CONFLICT`。
- Scanner：只接受本系統會員 URL + valid token。
- Scanner unsupported：改用發放網址，不影響 URL redemption。
