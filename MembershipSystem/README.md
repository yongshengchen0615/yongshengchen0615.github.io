# MembershipSystem — 會員卡 MVP

GitHub Pages 前端 + Google Apps Script（GAS）後端的會員系統，包含會員卡、管理端、消費時間記錄與 QR Code 發放。

## Domain

### 消費時間

`consumedMinutes` 只表示會員歷史累計消費時間。

- 新流程不使用可用時數 / 可用分鐘作為餘額。
- 掃描 QR Code 不會扣除 `availableMinutes`。
- 每次成功記錄只增加 `consumedMinutes`，並新增一筆 `UsageRecords`。
- `availableMinutes` 欄位暫時保留於既有 `Members` Sheet，只為 backward compatibility；新 UI / 新 business rule 不使用它。

### Usage QR Code

管理端建立 QR Code 時設定：

- `minutes`：本次要記錄的消費分鐘。
- `scanMode=single`：整張 QR 只允許一次成功記錄。
- `scanMode=repeatable`：QR 可重複使用，每次新的確認新增一筆消費時間。
- `expiresAt`：有效期限。
- `note`：發放備註。

QR 不指定會員。真正被記錄的人永遠是 GAS 驗證 LINE ID Token 後得到的當前會員。

## QR 再次開啟 / 下載 / 複製

管理端 QR 清單每一列都有「開啟」。

開啟後可：

- 再次顯示 QR Code。
- 下載 SVG QR Code。
- 複製發放連結。

新 QR 建立時會產生 64-hex `shareCode`，並保存於 `UsageVouchers`。`shareCode` 是發放識別碼，不是 Authentication / Authorization credential；會員身分與管理權限仍由 LINE ID Token + GAS server-side 驗證。

舊 QR 的原始 bearer token 過去只存 SHA-256 hash，因此無法反推原 token。為了讓舊 QR 可以再次開啟：

- 第一次執行 `admin.usage.open` 時，若 `shareCode` 尚不存在，GAS 會補產生新的 `shareCode`。
- 舊 `tokenHash` 不會被覆寫，所以已經發出去的舊 URL 仍可繼續使用。
- 新產生的 share URL 也可使用。

## 使用者流程

```text
LINE Authentication
→ 掃描 QR / 開啟發放連結
→ usage.preview
→ Server 驗證 QR 狀態 + Membership 狀態
→ 使用者按「確認記錄」
→ usage.record
→ Script Lock
→ UsageRecords processing
→ Member.consumedMinutes 增加
→ UsageRecords recorded
→ Audit
```

沒有「餘額不足」「扣除可用時數」「核銷」商業規則。

為避免網路 retry 重複記錄，每次流程建立 random `requestId`：

- 相同 `requestId` 重送只回復同一筆記錄。
- 新掃描會建立新的 `requestId`。
- `single` 的全域一次限制由 GAS server-side enforcement。

## API

所有 POST API 都先驗證 LINE ID Token。

### Member

- `member.me`
- `usage.preview`
- `usage.record`
- `usage.redeem`：只做舊前端 compatibility alias，實際行為等同 `usage.record`，不再扣任何 balance。

### Admin

所有 `admin.*` 都先執行 `requireAdmin_()`。

- `admin.list`
- `admin.update`
- `admin.usage.list`
- `admin.usage.create`
- `admin.usage.open`：取得 / 補建 shareCode，供管理端再次顯示、下載與複製 QR。
- `admin.usage.cancel`

## Google Sheet Schema

### Members

```text
lineUserId | memberNo | displayName | pictureUrl | tier | membershipStatus |
joinedAt | expiresAt | note | createdAt | updatedAt | canManageMembers |
availableMinutes | consumedMinutes
```

`availableMinutes` 為 legacy compatibility 欄位，新消費時間功能不使用。

### UsageVouchers

保留既有欄位並追加：

```text
scanMode | shareCode
```

舊 `tokenHash` 保留以支援已發出的舊 URL。

### UsageRecords

```text
recordId | requestId | voucherId | memberLineUserId | memberNo | minutes |
status | createdAt | updatedAt | consumedBeforeMinutes | consumedAfterMinutes |
recordedAt | auditRecordedAt
```

每次成功消費時間記錄一列。

### Legacy UsageRedemptions

若既有 Spreadsheet 已由上一版建立 `UsageRedemptions`，本版不刪除也不重新解讀其歷史資料。新流程只寫入 `UsageRecords`。

## Security Notes

- Authentication：LINE ID Token → LINE verify API → `sub`。
- Authorization：所有管理 API → `requireAdmin_()` → `canManageMembers`。
- QR / shareCode 不授予管理權，也不能指定另一個會員身分。
- Scanner 仍只接受同 origin、相同 `user/` path、64-hex usage/redeem code。
- `requestId` 只用於 idempotency，不是身分或權限憑證。
- `UsageRecords` 的 LINE user id 不透過一般會員 API 回傳。
- Audit 不寫入 LINE ID Token、Password、Secret。
- User / Admin page 使用 `referrer=no-referrer`，降低 URL code 經 Referer 外洩。

## Migration / Deployment

這次包含 GAS 與 Schema 變更，必須重新部署 Apps Script Web App。

1. 更新 `gas/Code.gs`。
2. 重新部署 GAS Web App。
3. 第一次使用時 GAS 會在 `UsageVouchers` 追加 `shareCode`，並建立 `UsageRecords`。
4. 既有 `UsageRedemptions` 不刪除。
5. 部署 GitHub Pages 前端。
6. 驗證舊 QR URL 仍可用；管理端第一次「開啟」舊 QR 後可取得新的 share URL。

## Verification

至少驗證：

- 掃描 / 記錄不讀取或扣除 `availableMinutes`。
- 成功記錄只增加 `consumedMinutes`。
- 相同 `requestId` 重送不重複增加分鐘。
- `single` 只有第一筆可成功。
- `repeatable` 可產生多筆 UsageRecords。
- Unauthenticated / inactive Membership 不可記錄。
- 非管理員不可 create/open/cancel QR。
- 既有 QR 第一次 open 補建 shareCode，不覆寫舊 tokenHash。
- 管理端可再次顯示 QR、下載 SVG、複製發放連結。
