# Membership Point Card — 集點卡系統

獨立於 `MembershipSystem/app/` 的全新集點卡子系統。

```text
MembershipSystem/
├─ app/                  # 既有會員卡
└─ point-card/           # 本集點卡系統
   ├─ index.html
   ├─ user/
   ├─ admin/
   ├─ shared/
   └─ gas/
```

## Domain

- `Identity`：LINE `sub`，由 GAS Verify ID Token 建立。
- `PointMember`：集點會員、狀態、目前點數、管理權限。
- `PointTransaction`：所有加點/扣點/兌獎 ledger。
- `PointVoucher`：一次性集點碼。
- `PointAudit`：安全與管理操作稽核。

`canManagePoints` 才是管理權限來源；點數、獎勵門檻、會員狀態都不能替代 Admin Permission。

## 用戶端

```text
LINE Login
→ member.me
→ 建立 / 取得 PointMember
→ 顯示點數卡與集點格
→ 顯示最近交易
```

集點連結：

```text
/user/?claim=<64-hex>
→ LINE Authentication
→ requestId
→ points.claim
→ ScriptLock
→ PointTransaction processing
→ Member balance
→ PointTransaction recorded
→ Voucher redeemed
→ Audit
```

支援 LIFF `scanCodeV2()`；QR 內容必須是目前集點卡 user URL 或目前 LIFF URL，且包含有效 `claim`。

## 管理端

所有 `admin.*` 都先：

```text
verified LINE sub
→ PointMembers.canManagePoints
→ requirePointAdmin_
```

支援：

- Dashboard metrics
- 會員點數清單
- Active / Suspended / Disabled
- 手動加點 / 扣點
- 兌換滿點獎勵
- 設定兌獎門檻
- 設定獎勵名稱
- 建立一次性集點碼
- 停止未使用集點碼
- 最近交易 ledger

管理員調點與兌獎使用 `expectedUpdatedAt + requestId + ScriptLock`。

## 點數規則

預設：

```text
10 點 → 集滿送好禮
```

管理端修改後保存於 Apps Script Script Properties：

```text
POINT_CARD_TARGET_POINTS
POINT_CARD_REWARD_TITLE
```

兌獎只允許管理端執行；用戶端只顯示「可兌換」，不自行扣點。

## Google Sheet

GAS 會自動建立：

```text
PointMembers
PointTransactions
PointVouchers
PointAudit
```

建議使用獨立 Spreadsheet。

`PointTransactions` 使用 `processing → recorded`，並保存 balance/lifetime before/after；GAS 可從中途失敗恢復，避免重複加點或餘額與 ledger 不一致。

## 一次性集點碼

原始 `claimCode` 只在建立 API response 回傳一次。

Sheet 只保存：

```text
SHA-256(claimCode)
```

不保存 raw bearer code，也不寫入 Audit / Log。集點碼最長有效 7 天。

## 初次部署

### 1. 建立新的 Apps Script project

此集點卡必須使用獨立 Apps Script project。不要與 `MembershipSystem/app/gas/` 使用相同 Script ID；兩邊都有自己的 `doGet / doPost`，且 `clasp push --force` 會同步整個 project source。

### 2. Script Properties

設定：

```text
SPREADSHEET_ID=<集點卡 Google Sheet ID>
LINE_LOGIN_CHANNEL_ID=<LINE Login Channel ID>
```

### 3. Web App

部署為 Web App，取得：

```text
https://script.google.com/macros/s/<deploymentId>/exec
```

填入：

```text
MembershipSystem/point-card/shared/config.json
```

### 4. LIFF

建議在既有 LINE Login Channel 下建立新的 LIFF app，Endpoint：

```text
https://yongshengchen0615.github.io/MembershipSystem/point-card/
```

把新 LIFF ID 填入 `shared/config.json`。不要修改既有會員卡 LIFF Endpoint。

### 5. 第一位管理員

先用 LINE 開一次集點卡，讓 `PointMembers` 建立會員資料；再由可信任 Spreadsheet editor 把該會員的：

```text
canManagePoints = TRUE
```

Sheet editor 是此權限模型的 operational trust boundary。

## 自動部署

Workflow：

```text
.github/workflows/deploy-membership-point-card-gas.yml
```

監看：

```text
MembershipSystem/point-card/gas/**
```

需要 Repository Secrets：

```text
MEMBERSHIP_POINT_CARD_GAS_SCRIPT_ID
MEMBERSHIP_GAS_CLASPRC_JSON
```

第二個 Secret 可沿用既有 MembershipSystem 的 clasp OAuth credential。

首次建立 Web App / 設定 config 後，手動執行一次 `Deploy Membership Point Card GAS`；之後 point-card GAS 變更進入 `main` 會更新同一個 deployment。

## Security

- Raw LINE ID Token 不寫 Sheet、Log、URL 或 Cache value。
- Identity cache key 使用 token SHA-256 fingerprint；cache value 只保存已由 LINE 驗證的 claims，最多 5 分鐘且不得超過 `exp`。
- User claim API 不接受 target member，實際加點者永遠是 server 驗證的 LINE `sub`。
- Admin Permission 只由 `canManagePoints` 判斷。
- 點數 mutation 使用 ScriptLock。
- User claim、Admin 調點與兌獎都有 idempotency requestId。
- 一次性 voucher 在 recovery path 會先收斂既有 processing transaction，防止中途失敗後被第二個 request 重複使用。
- 所有 Sheet 字串寫入經 formula-injection 防護。
- raw claimCode、OAuth credential、LINE token 不進 Audit。

## Verification

- 新會員首次登入 → `PointMembers` 建立。
- Admin 建立 1 點集點碼 → 會員開啟 → +1。
- 同 request 重送 → 不重複加點。
- 同 voucher 不同 request → `POINT_CODE_USED`。
- Suspended member claim → `MEMBER_INACTIVE`。
- expired voucher → `POINT_CODE_EXPIRED`。
- cancelled voucher → `POINT_CODE_CANCELLED`。
- 非 Admin 呼叫 `admin.*` → `FORBIDDEN`。
- stale `expectedUpdatedAt` → `CONFLICT`。
- 扣點後小於 0 → `INSUFFICIENT_POINTS`。
- 點數達門檻 → 用戶端顯示可兌換；Admin 兌獎後寫入 ledger 並扣除 target points。
