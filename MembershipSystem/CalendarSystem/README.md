# MembershipSystem CalendarSystem

獨立的「營業日曆」模組，提供公開用戶端月曆與管理端日期設定。此目錄不依賴、也不修改既有 `MembershipSystem/app/` 與 `MembershipSystem/PointsCard/`。

## 目錄

```text
CalendarSystem/
├── index.html
├── config.json
├── user/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── admin/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── gas/
    ├── Code.gs
    ├── StorageBootstrap.gs
    └── appsscript.json
```

## 功能

### 用戶端

- 月曆瀏覽與上/下月切換
- 休假日、活動日視覺標示
- 點擊日期查看當日完整說明
- 顯示本月已發布事件
- 只讀取 `published` 狀態，草稿與封存資料不會公開

### 管理端

- 管理憑證伺服器端驗證
- 新增/修改休假日與活動日
- 草稿/發布狀態
- 封存日期設定（soft delete）
- 月曆與本月事件清單同步
- 管理憑證只存在 `sessionStorage`，關閉分頁後即失效

### GAS / Storage

第一次 API 呼叫會自動建立 Google Spreadsheet：

- `CalendarEvents`
- `AuditLogs`

`CalendarEvents` 欄位：

| 欄位 | 用途 |
|---|---|
| eventId | 事件唯一 ID |
| date | `YYYY-MM-DD` |
| type | `holiday` / `activity` |
| title | 標題 |
| description | 當日說明 |
| status | `draft` / `published` / `archived` |
| createdAt | 建立時間 |
| updatedAt | 更新時間 |

`AuditLogs` 記錄管理端新增、更新與封存操作，不儲存管理憑證。

## 部署

1. 建立 Google Apps Script 專案。
2. 將 `gas/Code.gs`、`gas/StorageBootstrap.gs`、`gas/appsscript.json` 同步至 GAS。
3. 在 GAS **Script Properties** 新增：
   - `CALENDAR_ADMIN_TOKEN`: 至少 32 個隨機字元的高熵管理憑證。
4. 部署為 Web App：
   - Execute as: Me
   - Who has access: Anyone
5. 將 Web App `/exec` URL 寫入 `config.json` 的 `apiUrl`。
6. GitHub Pages 發布後：
   - 用戶端：`MembershipSystem/CalendarSystem/user/`
   - 管理端：`MembershipSystem/CalendarSystem/admin/`

`CALENDAR_ADMIN_TOKEN` 不可提交到 GitHub、不可放在 URL、不可寫進前端程式碼。

## API

所有動作使用 `POST application/x-www-form-urlencoded`：

- `action`: API action
- `payload`: JSON 字串
- `adminToken`: 僅管理端動作需要

### Public

- `calendar.month`
  - payload: `{ "year": 2026, "month": 8 }`
- `calendar.day`
  - payload: `{ "date": "2026-08-23" }`

### Admin

- `admin.events.list`
- `admin.event.save`
- `admin.event.delete`

管理端授權一定在 GAS server-side 執行。前端隱藏 UI 不視為安全邊界。

## Security

- 管理密鑰只保存在 GAS Script Properties。
- 管理密鑰不寫入 log、URL、GitHub 或 localStorage。
- 管理 API 具備 rate limit。
- 所有日期、類型、狀態、標題與說明都在 server-side 驗證。
- 刪除採 soft delete，保留資料與 audit trail。
- 公開 API 只投影用戶端真正需要的欄位。
- API 不使用 cookie-based authentication，因此管理操作不依賴瀏覽器 cookie，也避免以 UI route guard 當作授權機制。

## 驗證清單

- 用戶端可切換月份。
- 已發布休假/活動會顯示在正確日期。
- 點擊日期可看到完整說明。
- 草稿不會出現在用戶端。
- 未提供或錯誤管理憑證無法讀取管理資料或寫入。
- 管理端可新增、編輯、發布、改回草稿與封存。
- 封存後用戶端不再顯示。
- Event / Audit sheet 可自動建立。
