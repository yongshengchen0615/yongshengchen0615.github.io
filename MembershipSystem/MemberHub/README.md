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

此基線沒有 GAS 程式變更，也不需要資料表 migration。三個模組沿用各自既有 `config.json` / `shared/config.json` 與 GAS Web App deployment。

後續若將三套 GAS 合併成單一 deployment，必須先完成資料表對照、Action namespace、權限模型、migration 與 rollback 驗證，不能直接把三份 `Code.gs` 貼入同一個 Apps Script 專案。

## 驗證

```bash
node --test MembershipSystem/MemberHub/tests/*.test.js
```

