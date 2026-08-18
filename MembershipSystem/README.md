# MembershipSystem — 會員卡 MVP

GitHub Pages 前端 + Google Apps Script（GAS）後端的會員系統，包含會員卡、管理端、消費時間記錄與 QR Code 發放。

## Domain

### 消費時間

`consumedMinutes` 只表示會員歷史累計消費時間。

- 新流程不使用可用時數 / 可用分鐘作為餘額。
- 掃描 QR Code 或開啟發放連結不會扣除 `availableMinutes`。
- 每次成功記錄只增加 `consumedMinutes`，並新增一筆 `UsageRecords`。
- `availableMinutes` 欄位暫時保留於既有 `Members` Sheet，只為 backward compatibility；新 UI / 新 business rule 不使用它。

### Usage QR Code

管理端建立 QR Code 時設定：

- `minutes`：本次要記錄的消費分鐘。
- `scanMode=single`：整張 QR 只允許一次成功記錄。
- `scanMode=repeatable`：QR 可重複使用，每次新的掃描 / 發放連結開啟可新增一筆消費時間。
- `expiresAt`：有效期限。
- `note`：發放備註。

QR 不指定會員。真正被記錄的人永遠是 GAS 驗證 LINE ID Token 後得到的當前會員。

## QR 管理

管理端 QR 清單支援：

- **新增**：建立新的 QR Code / shareCode。
- **開啟**：再次顯示 QR、下載 SVG、複製發放連結。
- **修改**：只有目前仍有效且 `recordCount=0` 的非 legacy QR 可修改 `minutes`、`scanMode`、`expiresAt`、`note`。
- **停止**：保留 Voucher 與歷史資料，但禁止後續使用。
- **刪除**：只有沒有成功 UsageRecord、也沒有 processing UsageRecord 的 QR 可刪除。刪除會移除 `UsageVouchers` row；如果已有消費歷史，必須使用「停止」而不是刪除。

修改與刪除都使用 `expectedUpdatedAt` optimistic concurrency，避免兩個管理員同時操作時互相覆寫。

新 QR 建立時會產生 64-hex `shareCode`，並保存於 `UsageVouchers`。`shareCode` 是發放識別碼，不是 Authentication / Authorization credential；會員身分與管理權限仍由 LINE ID Token + GAS server-side 驗證。

舊 QR 的原始 bearer token 過去只存 SHA-256 hash，因此無法反推原 token。為了讓舊 QR 可以再次開啟：

- 第一次執行 `admin.usage.open` 時，若 `shareCode` 尚不存在，GAS 會補產生新的 `shareCode`。
- 舊 `tokenHash` 不會被覆寫，所以已經發出去的舊 URL 仍可繼續使用。
- 新產生的 share URL 也可使用。
- legacy targeted QR 為 read-only，不允許用新版「修改」改變其語意。

## 用戶端流程

### 掃描 QR Code

「掃描 QR Code」現在是會員卡內的一個按鈕。會員按下後不顯示掃描類型選單，直接呼叫 LINE LIFF `liff.scanCodeV2()`：

```text
會員卡內按「掃描 QR Code」
→ liff.scanCodeV2()
→ 驗證掃描結果為目前 member URL 或目前 LIFF ID URL
→ 驗證 64-hex usage / legacy redeem code
→ usage.record
→ Script Lock
→ UsageRecords processing
→ Member.consumedMinutes 增加
→ UsageRecords recorded
→ Audit
```

`liff.scanCodeV2()` 不支援時不再要求使用者選另一種掃描類型，而是提示直接使用管理端發放連結。

### 發放連結

發放連結採「登入後立即記錄」：

```text
開啟 ?usage=<shareCode> 或 legacy ?redeem=<token>
→ LIFF Authentication
→ 建立 / 恢復 requestId
→ usage.record
→ 顯示 Loading
→ 成功後顯示確認小視窗
→ 使用者按「確認」關閉小視窗
```

不再呼叫 `usage.preview` 等待第二次記錄確認。

LIFF Login callback 的 `usage` / `redeem` / `requestId` 恢復由 `shared/common.js` 統一處理，短期 navigation state 只用於 callback 與 idempotency recovery，不是 Authentication / Authorization credential。LINE ID Token 只保存在目前 document 的記憶體，不寫入 browser storage。

沒有「餘額不足」「扣除可用時數」「核銷」商業規則。

## Idempotency

每次流程使用 cryptographically-random `requestId`：

- 相同 `requestId` 重送只回復同一筆記錄。
- 新掃描建立新的 `requestId`。
- 發放連結若在 API response 遺失後重新整理，會保留同一個 requestId，避免 repeatable QR 因 retry 被重複累計。
- `single` 的全域一次限制由 GAS server-side enforcement。

## API

所有 POST API 都先驗證 LINE ID Token。

### Member

- `member.me`
- `usage.preview`：保留相容性 / 查詢用途；目前會員 UI 不再用它作確認步驟。
- `usage.record`
- `usage.redeem`：只做舊前端 compatibility alias，實際行為等同 `usage.record`，不再扣任何 balance。

### Admin

所有 `admin.*` 都先執行 `requireAdmin_()`。

- `admin.list`
- `admin.update`
- `admin.usage.list`
- `admin.usage.create`
- `admin.usage.update`：只允許尚未有消費紀錄且目前有效的 QR。
- `admin.usage.open`：取得 / 補建 shareCode，供管理端再次顯示、下載與複製 QR。
- `admin.usage.cancel`：停止後續使用，保留 Voucher。
- `admin.usage.delete`：只允許沒有任何 UsageRecord / processing record 的 QR；刪除前要求 Audit 可寫入。

## Google Sheet Schema

### Members

```text
lineUserId | memberNo | displayName | pictureUrl | tier | membershipStatus |
joinedAt | expiresAt | note | createdAt | updatedAt | canManageMembers |
availableMinutes | consumedMinutes
```

`availableMinutes` 為 legacy compatibility 欄位，新消費時間功能不使用。

### UsageVouchers

保留既有欄位：

```text
... | scanMode | shareCode
```

GAS 1.5.0 的 QR CRUD **不新增欄位**。舊 `tokenHash` 保留以支援已發出的舊 URL。

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
- Scanner 只接受目前會員頁或目前 LIFF ID 的發放 URL，且 usage/redeem 必須是 64-hex code。
- `requestId` 只用於 idempotency，不是身分或權限憑證。
- 短期 browser storage 只保存 LIFF navigation / retry 狀態，不保存 raw LINE ID Token，也不授予 Identity、Role 或 Permission。
- 自動記錄連結只允許在 top-level page 執行；被第三方網站 iframe 內嵌時會拒絕，降低無互動 drive-by 記錄風險。
- `UsageRecords` 的 LINE user id 不透過一般會員 API 回傳。
- Audit 不寫入 LINE ID Token、Password、Secret、shareCode。
- QR 修改與刪除在 server-side 使用 ScriptLock + `expectedUpdatedAt` 做 concurrency control。
- 有 UsageRecords 的 Voucher 不可刪除，避免破壞歷史資料關聯。
- 刪除前必須先成功建立 `USAGE_QR_DELETE_REQUESTED` Audit；Audit 不可用時 fail closed。
- User / Admin page 使用 `referrer=no-referrer`，降低 URL code 經 Referer 外洩。
- **Tradeoff：**發放連結是登入後立即產生寫入的 bearer action。持有有效 share URL 的第三方若能誘導一名已登入且 Membership 有效的會員直接開啟連結，就可能替該會員建立一筆消費時間，因此 share URL 應只發給預期使用者並設定合理到期時間；`single` 模式可縮小重複使用面。

## Migration / Deployment

目前 GAS service version 為 **1.5.0**。

若 production 尚未部署 1.4.x，先完成既有 `shareCode` / `UsageRecords` migration。若已部署 1.4.1，本次 1.5.0 不新增 Sheet 欄位，但新增管理端 QR update/delete server actions，因此仍必須重新部署 GAS：

1. 更新 Apps Script 專案中的 `gas/Code.gs`。
2. **新增 `gas/UsageAdmin.gs` 到同一個 Apps Script 專案。**
3. 建立新的 Apps Script version，將既有 Web App deployment 指向 1.5.0 code。
4. 保持原本 `/exec` URL，避免前端 config 變更。
5. 部署 GitHub Pages 最新 `main`。
6. 直接開啟 `/exec`，確認 `doGet()` 回傳 `version: "1.5.0"`。

只更新 GitHub Repository 不會讓既有 Apps Script Web App deployment 自動取得新的 `UsageAdmin.gs`。

## Verification

至少驗證：

- 會員卡內只有一個「掃描 QR Code」按鈕，不再有獨立 scanner panel。
- 點按鈕直接進入 `liff.scanCodeV2()`，沒有掃描類型選單。
- 掃描成功後直接執行 `usage.record`。
- 消費時間寫入期間顯示 Loading；成功後顯示確認小視窗。
- 點 `?usage=` 發放連結完成 LIFF Login 後自動記錄；iframe 內嵌不得觸發。
- legacy `?redeem=` 仍可自動記錄。
- LIFF callback / refresh 後仍保留同一筆 requestId，不因 retry 重複增加分鐘。
- 掃描 / 記錄不讀取或扣除 `availableMinutes`。
- 成功記錄只增加 `consumedMinutes`。
- 相同 `requestId` 重送不重複增加分鐘。
- `single` 只有第一筆可成功。
- `repeatable` 可產生多筆 UsageRecords。
- Unauthenticated / inactive Membership 不可記錄。
- 非管理員不可 create/update/open/cancel/delete QR。
- Admin 可新增 QR。
- 未使用且有效 QR 可修改 minutes / mode / expiry / note，share URL 保持同一個 shareCode。
- 已有 UsageRecord、processing、expired、cancelled 或 legacy targeted QR 不可修改。
- 未有 UsageRecord / processing record 的 QR 可刪除。
- 已有 UsageRecord 的 QR 刪除必須被拒絕，可改用停止。
- 刪除 Audit 無法寫入時必須拒絕刪除。
- 兩個管理員用舊 `expectedUpdatedAt` 同時修改 / 刪除時，第二個操作必須回 CONFLICT。
- 既有 QR 第一次 open 補建 shareCode，不覆寫舊 tokenHash。
- 管理端可再次顯示 QR、下載 SVG、複製發放連結。
