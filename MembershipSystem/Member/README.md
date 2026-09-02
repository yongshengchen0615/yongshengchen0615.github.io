# Member System

獨立的會員卡與集點卡 LIFF 用戶端，以及共用一個 HTML/CSS/JS 的管理端。資料由 Google Apps Script Web App 寫入 Google Sheets。

## 目錄

```text
Member/
├── index.html                 # 入口
├── config.json                # 僅放公開設定
├── member/                    # 會員卡用戶端（獨立 HTML/CSS/JS）
├── points/                    # 集點卡用戶端（獨立 HTML/CSS/JS）
├── admin/                     # 會員卡與集點卡共用管理端（單一 HTML/CSS/JS）
├── shared/common.js           # 共用 LIFF 初始化、API transport、格式化工具
├── gas/                       # Apps Script Web App
└── tests/                     # 本地結構與安全契約測試
```

## 初始化 GAS

1. 建立一個 Apps Script 專案，把 `gas/` 內的 `.gs` 與 `appsscript.json` 放在同一個專案。
2. 在 Apps Script → Project Settings → Script properties 設定：
   - `MEMBERSHIP_MEMBER_LINE_CHANNEL_ID`：會員卡 LIFF 所屬 LINE Login Channel ID
   - `MEMBERSHIP_POINTS_LINE_CHANNEL_ID`：集點卡 LIFF 所屬 LINE Login Channel ID
   - `MEMBERSHIP_ADMIN_LINE_CHANNEL_ID`：Admin LIFF 所屬 LINE Login Channel ID
   - `MEMBERSHIP_SYSTEM_SPREADSHEET_ID`：選填；不填時會依序使用目前綁定的 Spreadsheet，或建立 `Lumen Club Membership Data`
3. 執行 `setupMembershipSystem()` 完成授權與資料表建立。
4. Deploy → New deployment → Web app：Execute as 選自己、Who has access 選 Anyone。
5. 將部署後 `/exec` URL、Member LIFF ID、Points LIFF ID、Admin LIFF ID 填入 `config.json`；Member 與 Points 必須是不同的 LIFF app。

Member LIFF Endpoint URL：

```text
https://<your-pages-host>/MembershipSystem/Member/member/
```

Points LIFF Endpoint URL：

```text
https://<your-pages-host>/MembershipSystem/Member/points/
```

Admin LIFF Endpoint URL：

```text
https://<your-pages-host>/MembershipSystem/Member/admin/
```

Member、Points 與 Admin 使用不同 LIFF/LINE Login Channel。三者至少需要 `openid` scope，讓前端取得 `liff.getIDToken()`；GAS 會依照 request action 將 token 綁定到對應 Channel，再驗證 `aud`、`iss`、`exp` 與 `sub`。

## Google Sheets 資料表

GAS 會建立並維護以下 schema：

- `Members`：會員身份、會員編號、等級、狀態與登入時間。
- `Admins`：管理端授權。第一次登入只會建立 `role=none`、`status=pending`，手動改成 `admin` / `active` 後才能進入。
- `PointCards`：集點卡設定、完成點數、回饋、公開狀態與識別色。
- `PointBalances`：每位會員在每張卡的目前餘額。
- `PointEntries`：每次補登點數的不可變流水紀錄。
- `AuditLogs`：管理端會員/卡片/集點操作紀錄。

所有 Sheet 寫入會將以 `=`, `+`, `-`, `@` 開頭的文字轉成純文字，避免公式注入；管理端更新會以 `expectedUpdatedAt` 做 optimistic concurrency control。

## API actions

- `user.member.bootstrap`（Member LIFF）
- `user.pointcard.bootstrap`（Points LIFF）
- `admin.bootstrap`
- `admin.members.list`
- `admin.pointcards.list`
- `admin.member.update`
- `admin.pointcards.save`
- `admin.stamps.add`

前端以 `text/plain` JSON POST，避免不必要的 CORS preflight。ID token 只存在目前頁面的記憶體，未寫入 URL、localStorage、sessionStorage、Sheet、log 或 API cache value。

## 本地驗證

在 repository root 執行：

```bash
node --test Member/tests/*.test.js
```

這些測試驗證檔案結構、LIFF/GAS 合約、資料表 schema、CSP 與 token 不落地等不變量。實際 LINE 登入、GAS Web App 與 Spreadsheet 仍需部署後做 integration verification；本次不會自動 deploy。
