# TopUp 序號管理 GAS（Web App）

這份 GAS 提供 TopUp 後台的 API：
- 管理員門禁：`adminUpsertAndCheck`
- 序號：list / generate / redeem / void / reactivate

## 1) 建立 Apps Script 專案

1. 到 https://script.google.com 建立新專案
2. 綁定一個 Google Spreadsheet（作為資料庫）
3. 把 [TopUp/gas/Code.gs](Code.gs) 貼到 Apps Script 的 `Code.gs`

> 表格會自動建立/初始化三個 Sheet：`Admins`、`Serials`、`OpsLog`

## 2) 部署成 Web App

1. Deploy → New deployment
2. Type：Web app
3. Execute as：Me
4. Who has access：Anyone（或 Anyone with the link）
5. 部署後複製 `/exec` URL

## 3) 串接前端

把 `/exec` URL 填到 [TopUp/config.json](../config.json) 的 `TOPUP_API_URL`。

## 4) 管理員審核流程（重要）

- 任何人第一次打開後台，都會先呼叫 `adminUpsertAndCheck`，並在 `Admins` 新增一筆，預設 `Audit=待審核`。
- 你需要到 Spreadsheet 的 `Admins` sheet 把該使用者 `Audit` 改成 `通過`，他才可進入後台操作序號。

## 5) Serials 欄位

`Serials` 欄位（自動建立）：
- Serial, Amount, Status(active/used/void), Note
- CreatedAtMs, CreatedBy, BatchId
- UsedAtMs, UsedBy, UsedNote
- VoidAtMs, VoidBy, VoidNote
- ReactivatedAtMs, ReactivatedBy
- UpdatedAtMs
