# MemberHub

`MemberHub` 是 `CalendarSystem`、`PointsCard` 與 `app` 的整合會員入口，提供分離的會員端與管理端。

## 本次基線

- `user/`：會員中心，統一導向會員資料、集點卡與日曆。
- `admin/`：管理中心，統一導向會員管理、集點管理與日曆管理。
- `modules/`：以同一個 Git commit 固定三套既有系統的完整快照，保留其 GAS、LIFF、測試與所有既有功能。
- 原本的 `MembershipSystem/CalendarSystem`、`MembershipSystem/PointsCard`、`MembershipSystem/app` 不修改。

## 路徑

- 會員端：`/MembershipSystem/MemberHub/user/`
- 管理端：`/MembershipSystem/MemberHub/admin/`
- 整合入口：`/MembershipSystem/MemberHub/`

## 安全模型

入口頁不接收或保存 LINE ID Token。每個功能模組仍由自己的 LIFF 初始化取得 ID Token，並由對應 GAS 進行 LINE server-side 驗證。管理端按鈕只負責導覽，不構成授權邊界；每個 `admin.*` API 仍必須在 GAS 重新驗證管理權限。

會員等級只代表商業會員層級，不能推導或授予管理權限。

## 部署

三個模組沿用各自的 GAS Web App 與資料表。Membership GAS 是跨模組會員可用狀態的權威來源；Points 與 Calendar 只在 LINE 身分驗證成功後，以 server-to-server access gate 查詢停權狀態。

部署時必須：

1. 產生兩組不同且至少 32 字元的服務密鑰：`MEMBERHUB_POINTS_ACCESS_GATE_SECRET` 與 `MEMBERHUB_CALENDAR_ACCESS_GATE_SECRET`。
2. Membership 專案設定兩組密鑰；Points 只設定 Points 密鑰，Calendar 只設定 Calendar 密鑰。不得在兩個呼叫端共用或交叉設定密鑰。
3. 在 Points 與 Calendar 設定 `MEMBERHUB_ACCESS_GATE_URL`，值為 Membership GAS 的 `/exec` URL。
4. 依序重新部署 Membership、Points、Calendar GAS；Calendar `appsscript.json` 的 URL fetch allowlist 必須與 Membership deployment URL 一致。

此設定由舊的單一密鑰切換為兩組密鑰，三個 deployment 無法原子更新。首次切換應安排維護時段，先完成全部 Script Properties，再連續部署三個服務；版本不一致期間會員 API 會 fail closed，管理 API 不受 access gate 影響。確認三個新版本正常後，刪除舊的 `MEMBERHUB_ACCESS_GATE_SECRET`。

Access gate 未設定、回應格式錯誤或網路失敗時，Points 與 Calendar 的會員 API 會 fail closed。管理 API 不經此 gate，仍由各模組獨立的 server-side admin permission 決定；Membership Tier 永遠不授予管理權。

服務密鑰不會出現在網路請求中。Points 與 Calendar 各自以專屬密鑰對服務名稱、60 秒時效、隨機 nonce 與 LINE user ID 產生 HMAC-SHA256；Membership 依服務選取密鑰、驗證簽章並以 CacheService 拒絕 nonce 重播。輪替時只需同步更新 Membership 與對應服務的 Apps Script 專案。

Membership 查無該 LINE 使用者、會員已停權／停用或會籍已到期時，會員 API 同樣 fail closed。新使用者必須先開啟會員資料模組完成會員建立，再使用 Points 或 Calendar。

後續若將三套 GAS 合併成單一 deployment，必須先完成資料表對照、Action namespace、權限模型、migration 與 rollback 驗證，不能直接把三份 `Code.gs` 貼入同一個 Apps Script 專案。

## 驗證

```bash
node --test $(find MembershipSystem/MemberHub -path '*/tests/*.test.js' -print | sort)
```
