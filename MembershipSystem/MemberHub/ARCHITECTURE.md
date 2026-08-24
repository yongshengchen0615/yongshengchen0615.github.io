# MemberHub Architecture

## 目前架構：相容整合

```text
MemberHub user/admin shell
├── modules/membership  -> app snapshot
├── modules/points      -> PointsCard snapshot
└── modules/calendar    -> CalendarSystem snapshot

Each module
Browser -> LIFF ID Token -> module GAS -> LINE verify -> server authorization -> Google Sheets

Points/Calendar member action
module GAS -> authenticated server-to-server gate -> Membership GAS -> canonical membership status
```

這個階段優先保證功能完整與可回退。三個模組的後端保持獨立，避免 GAS global function 衝突、Sheet schema 誤合併，以及管理權限來源混用。

## Domain boundary

| Domain | Source | Authentication | Authorization |
|---|---|---|---|
| Profile / Membership / Minutes / Tier | `app` | LINE ID Token | `canManageMembers` 僅限管理操作 |
| Points / Cards / Rewards / Tickets | `PointsCard` | LINE ID Token | `canManagePoints` 僅限管理操作 |
| Calendar / Notices / Holidays | `CalendarSystem` | LINE ID Token | `Admins.role/status` |

三種管理權限在目前資料模型中不是同一欄位。整合 UI 不得把任一權限推論為其他權限，也不得把 Membership Tier 當成 Admin Permission。

Membership `membershipStatus`、到期日與會員資料存在性是跨模組會員可用狀態的權威來源。查無會員、停權／停用或到期都 fail closed。Points 與 Calendar 只對會員 action 執行 access gate；管理 action 不使用會員等級或會員狀態推導權限，避免停權同步與管理授權互相耦合。

Access gate 使用 HMAC-SHA256 簽署 `serviceId + timestamp + nonce + lineUserId`；Membership 只接受 `points`／`calendar`、60 秒內的請求，並以短期 nonce cache 阻擋重播。Points 與 Calendar 使用不同密鑰，呼叫端只持有自己的密鑰；密鑰只存在 Script Properties，不直接傳輸。

## 收斂順序

1. 固定完整功能快照與統一入口。
2. 建立跨模組 contract tests 與一致錯誤/同步狀態。
3. 統一 User/Admin LIFF 設定但保持 audience 驗證分離。
4. 建立 server-side aggregate API；不從瀏覽器合併敏感資料。
5. 定義 canonical `Identity`, `Profile`, `Membership`, `Role`, `Permission`, `AuditEvent`。
6. 設計可回退 migration，之後才考慮合併 Spreadsheet/GAS deployment。

## 已知風險

- 三個模組仍使用不同 Spreadsheet 與 GAS URL；Membership 狀態已集中查詢，其餘會員資料仍可能重複。
- 單一入口不等於單一登入；在 LIFF Channel 尚未統一前，各模組仍各自初始化 LIFF。
- 三套管理權限來源不同，必須維持 server-side fail-closed，不能只在入口隱藏按鈕。
- Membership access gate 會讓 Points 與 Calendar 會員 API 依賴 Membership GAS 可用性；故障時刻意 fail closed。
