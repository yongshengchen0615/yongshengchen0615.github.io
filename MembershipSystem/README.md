# MembershipSystem — 會員卡 MVP

GitHub Pages 前端 + Google Apps Script（GAS）後端的會員系統，包含一般會員端、管理端、會員分鐘餘額與 QR Code 核銷。

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

`config.json` 是公開資源，只能放前端公開設定。不得放 LINE Channel Secret、Access Token、API Secret、Password 或其他秘密。

## LIFF 登入

每次完整開啟或重新整理 `user/` / `admin/` 都重新建立本次 LIFF 登入狀態。

- 外部瀏覽器 / LINE 內建瀏覽器：重新走 LIFF login flow。
- Login callback 使用一次性 random nonce + `sessionStorage` 驗證。
- LIFF Browser 由 `liff.init()` 自動完成登入並重新檢查 ID Token。
- LINE SSO 可能自動完成登入，因此不保證每次都顯示帳密輸入畫面。

## 會員分鐘

會員餘額與所有核銷都以整數「分鐘」表示與儲存：

- `availableMinutes`：目前可用分鐘。
- `consumedMinutes`：成功核銷的累計分鐘。
- 管理端以整數分鐘調整餘額。
- `consumedMinutes` 不由管理端直接修改，只能由成功核銷累加。

## 通用 Usage QR Code

新建立的 QR Code **不指定會員**。建立流程：

```text
Admin
→ 輸入消費分鐘
→ 選擇 single / repeatable
→ 設定到期時間 / 備註
→ GAS 產生隨機 token
→ UsageVouchers 只保存 SHA-256 token hash
→ Admin 只在 create response 取得 raw token
→ 前端產生 QR Code + URL
```

掃描流程：

```text
Member LIFF Authentication
→ 掃描 / 開啟 QR URL
→ usage.preview
→ Server 檢查 QR 狀態、Membership 狀態、分鐘餘額
→ 使用者確認
→ usage.redeem(token, requestId)
→ Script Lock
→ UsageRedemptions processing record
→ Member balance update
→ Redemption redeemed
→ Audit
```

### Scan mode

- `single`：整張 QR Code 只允許一次成功核銷。第一筆成功後 QR Code 失效。
- `repeatable`：QR Code 可由不同已登入會員重複使用；每次新的確認都會再次扣除該掃描會員的分鐘，直到到期或管理員取消。

`repeatable` 是刻意允許重複消費的商業規則，不是權限。每次核銷仍必須通過 LINE Authentication、Membership 狀態與分鐘餘額檢查。

### Idempotency / recovery

每次會員開始一筆核銷會建立 cryptographically-random `requestId`：

- 同一 `requestId` 重送只恢復 / 回傳同一筆核銷，不再次扣除。
- 重新掃描 QR Code 會產生新的 `requestId`；`repeatable` 模式因此可建立新的合法核銷。
- `UsageRedemptions` 在扣除會員分鐘前先寫入 `processing` 與 before/after balance snapshot。
- 同一 QR Code 同時間只允許一筆未完成的 `processing` redemption；新掃描或取消前會先安全恢復前一筆。
- 若 member balance 與 before/after snapshot 都不一致，系統 fail closed，回傳 `REDEMPTION_CONFLICT`，避免不確定狀態下重複扣除。

## 舊版指定會員 Voucher 相容性

既有資料中 `scanMode` 空白、且具有 `targetLineUserId` 的 Voucher 視為 legacy targeted voucher：

- 仍只允許原指定 LINE Identity 使用。
- 仍維持單次核銷與舊版 crash recovery。
- 不會因 schema migration 自動變成通用 QR Code。
- 舊版尚未核銷且未到期的 targeted voucher 仍會保留該會員分鐘，直到核銷、取消或過期。

新建立的 QR Code 不再使用 `targetLineUserId` / `targetMemberNo`。

## 用戶端 `user/`

- LINE LIFF Authentication。
- 顯示會員卡、可用分鐘、已消費分鐘。
- QR Scanner 支援：
  - Browser camera (`getUserMedia`)。
  - 手機拍照 / 相簿或桌機 QR 圖片檔案。
  - `liff.scanCodeV2()`（環境支援時）。
  - 直接開啟管理端發放的 URL 作為 fallback。
- QR 圖片在瀏覽器本機解析，不上傳圖片。
- `?redeem=<token>` 只做 preview，不會自動扣分鐘。
- 使用者必須按「確認消費」才呼叫 `usage.redeem`。

Scanner 只接受：

- 與目前會員頁相同 origin。
- 同一個 `user/` path。
- 合法 64 hex token。

掃描到的任意外部 URL 不會自動導向。

## 管理端 `admin/`

- Server-side `canManageMembers` Permission 驗證。
- 搜尋會員、修改會員等級 / 狀態 / 有效期限 / 備註。
- 調整會員 `availableMinutes`；`consumedMinutes` 唯讀。
- 建立不指定會員的消費分鐘 QR Code。
- 設定 `single` / `repeatable`、分鐘、到期時間與備註。
- 查看每個 QR Code 的成功核銷次數。
- 可取消尚可繼續使用的 QR Code；已開始的 processing redemption 會先完成安全恢復，再停止後續使用。

QR Code 使用固定版本 `qrcode-generator@2.0.4` 在管理端瀏覽器產生，不使用遠端 QR image API。

## API

所有 POST API 都先執行：

```text
ID Token
→ LINE Verify ID Token API
→ Identity
→ Role / Permission（管理 API）
→ Business Rule
```

### Member

#### `member.me`

取得 / 建立會員並回傳公開會員資料與分鐘餘額。

#### `usage.preview`

Request：

```json
{
  "token": "64-char-random-token"
}
```

只檢查，不修改資料。

#### `usage.redeem`

Request：

```json
{
  "token": "64-char-random-token",
  "requestId": "32-to-64-char-hex-idempotency-key"
}
```

Server-side 檢查 QR state / expiry / mode、Authentication、Membership state、available minutes，再執行交易。

### Admin

- `admin.list`：會員列表與分鐘統計。
- `admin.update`：可修改 `tier`、`membershipStatus`、`expiresAt`、`note`、`availableMinutes`；不可修改 `canManageMembers`、`consumedMinutes`、Identity 或 memberNo。
- `admin.usage.create`：建立通用 QR Code；request 使用 `minutes`、`scanMode`、`expiresAt`、`note`。只有 create response 回傳 raw token。
- `admin.usage.list`：最近 QR Code、模式、狀態與成功核銷次數，不回傳 raw token / token hash / LINE user id。
- `admin.usage.cancel`：停止 QR Code 後續核銷。

## Google Sheet Schema

GAS 會建立缺少的 Sheet / 必要欄位。既有必要欄位若被重新排序則 fail closed。

### `Members`

```text
lineUserId | memberNo | displayName | pictureUrl | tier | membershipStatus |
joinedAt | expiresAt | note | createdAt | updatedAt | canManageMembers |
availableMinutes | consumedMinutes
```

### `UsageVouchers`

```text
voucherId | tokenHash | targetLineUserId | targetMemberNo | minutes | status |
expiresAt | note | createdByLineUserId | createdAt | updatedAt | processingAt |
redeemedByLineUserId | redeemedAt | cancelledByLineUserId | cancelledAt |
balanceBeforeMinutes | balanceAfterMinutes | consumedBeforeMinutes |
consumedAfterMinutes | auditRecordedAt | scanMode
```

`scanMode` 為新增欄位。舊 target / balance 欄位保留是為 legacy targeted voucher 相容；新通用 QR 不再填 target 欄位。

### `UsageRedemptions`

```text
redemptionId | requestId | voucherId | redeemerLineUserId | redeemerMemberNo |
minutes | status | createdAt | updatedAt | balanceBeforeMinutes |
balanceAfterMinutes | consumedBeforeMinutes | consumedAfterMinutes |
redeemedAt | auditRecordedAt
```

每次通用 QR 核銷一列。此 Sheet 是 server-side transaction/audit data，不透過 public API 回傳 LINE user id。

### `AuditLogs`

重要事件：

- `USAGE_VOUCHER_CREATED`
- `USAGE_VOUCHER_CANCELLED`
- `USAGE_REDEEMED`

Audit details 不包含 raw voucher token、LINE ID Token 或 Secret。

## Security Notes

- QR token 是 bearer capability；新通用 QR 刻意不綁定特定會員，但核銷者仍必須完成 LINE Authentication 且 Membership 可使用。
- Sheet 只保存 QR token 的 SHA-256 hash；raw token 只在建立 response 與發放 QR / URL 中存在。
- `single` 由 server-side Script Lock + redemption ledger 保證全域單次成功。
- `repeatable` 每次合法新 request 都可再次核銷；同 requestId 重送為 idempotent。
- 管理 API 仍由 GAS `requireAdmin_()` server-side 強制授權，前端 UI 不是 Authorization Boundary。
- QR scanner 不會導向任意 URL。
- User / Admin page 設置 `referrer=no-referrer`，降低 query token 經 Referer 外洩風險。
- Token / Secret / Password 不寫入 Audit / public error。
- `jsQR@1.4.0` 僅在 Web Worker 中載入，與 LIFF / ID Token / DOM 執行環境隔離；仍屬固定版本 runtime CDN dependency。

## Migration / 部署

這次包含 GAS 與 Schema 變更，**必須重新部署 Apps Script Web App**。

1. 更新 `gas/Code.gs`。
2. 重新部署 Apps Script Web App。
3. 第一次執行時 GAS 會：
   - 在既有 `UsageVouchers` 追加 `scanMode`。
   - 建立新的 `UsageRedemptions` Sheet。
4. 保留 Script Properties：`SPREADSHEET_ID`、`LINE_CHANNEL_ID`。
5. 部署 GitHub Pages 前端。
6. 管理端建立新的 minute QR，分別驗證 single / repeatable。

舊版前端與新版 generic create API 語意不相容；後端會拒絕仍傳 `targetMemberNo` / `hours` 的 create request，避免舊 UI 在新規則下誤發通用 QR。

## Verification

至少驗證：

- Schema migration：既有 Voucher rows 保留，`scanMode` 追加，建立 `UsageRedemptions`。
- Legacy targeted voucher：仍只允許原 target Identity。
- Unauthenticated / Unauthorized：admin API 正確拒絕。
- Create generic QR：不需要會員、分鐘必須為 1–60000 整數、mode 僅 single/repeatable、expiry 不超過 30 天。
- Preview：不扣分鐘。
- Single：兩個會員並行掃描只能一筆成功。
- Repeatable：不同會員可各自成功；同一會員重新掃描也可再次成功。
- Duplicate request：相同 requestId 不可重複扣分鐘。
- Crash recovery：processing + before/after snapshot 可恢復，衝突時 fail closed。
- Cancel during processing：先恢復已接受交易，再停止未來核銷。
- Insufficient minutes：不可 redeem。
- Suspended / disabled / expired Membership：不可 redeem。
- Scanner：只接受本系統 user URL + valid token。
