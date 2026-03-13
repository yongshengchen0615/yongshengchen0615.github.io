# 美業預約系統

這個專案拆成兩個前端資料夾：

- `client/`：給客人使用的預約端
- `admin/`：給管理員使用的設定端
- `superadmin/`：給最高管理員使用的權限管理端
- `gas/`：Google Apps Script 後端，負責把設定與預約資料寫入 Google Sheets

## 功能

### 用戶端
- 客人需先使用 LINE LIFF 登入
- 新登入用戶會進入待審核，需由管理員審核通過後才可預約
- 客人可選擇技師
- 每位技師只會顯示自己可服務的項目
- 可依班表選擇日期與時段
- 可送出姓名、電話、備註與預約資料

### 管理員端
- 管理服務項目
- 管理技師與技師可服務的項目
- 管理技師上班日期與時段
- 查看預約清單
- 管理員需先使用 LINE LIFF 登入，且管理員帳號需審核通過後才可使用後台
- 只有被最高管理員授權的 admin，才可審核其他管理員的後台存取權限
- 審核 LINE 登入用戶，控制是否可在前台送出預約

### 最高管理員端
- 使用獨立的 `superadmin/` 頁面登入
- 可設定哪些 admin 具備「管理其他管理員」的權限
- 最高管理員名單由 GAS Script Properties 的 `SUPER_ADMIN_LINE_USER_IDS` 控制

### GAS / Google Sheets
- 所有技師、服務、班表、預約資料皆透過 GAS 寫入與讀取
- 首次執行會自動建立以下工作表：
  - `Config`
  - `AdminUsers`
  - `Services`
  - `Technicians`
  - `Schedules`
  - `Users`
  - `Reservations`

## 建議部署方式

### 前端
1. 將 `client/` 與 `admin/` 部署到靜態主機，例如 GitHub Pages、Netlify 或 Vercel。
2. 修改 `client/config.json` 內的 `gasWebAppUrl`。
3. 修改 `client/config.json` 內的 `liffId`。
4. 在 LINE Developers 建立 LIFF App，Endpoint URL 指向 `client/` 的部署網址。
5. 修改 `admin/config.json` 內的 `gasWebAppUrl` 與 `liffId`。
6. 在 LINE Developers 為 `admin/` 頁面建立專用 LIFF App，Endpoint URL 指向 `admin/` 的部署網址。
7. 修改 `superadmin/config.json` 內的 `gasWebAppUrl` 與 `liffId`。
8. 在 LINE Developers 為 `superadmin/` 頁面建立專用 LIFF App，Endpoint URL 指向 `superadmin/` 的部署網址。
9. 系統會自動讀取各自資料夾下的 `config.json`，前端畫面不再顯示任何 GAS URL 或管理密碼相關輸入 UI。
10. 請用靜態伺服器方式開啟頁面；若直接用 `file://` 開檔，瀏覽器可能無法讀取 `config.json`。

### GAS
1. 到 Google Drive 建立試算表。
2. 在 Apps Script 中貼上 `gas/Code.gs` 與 `gas/appsscript.json`。
3. 在 Apps Script 的專案設定加入 Script Properties：
  - `ADMIN_APPROVED_LINE_USER_IDS=已通過審核的管理員 LINE userId，逗號分隔`
  - `SUPER_ADMIN_LINE_USER_IDS=最高管理員的 LINE userId，逗號分隔`
4. 第一次啟用 admin 後台時，至少要先把一位管理員的 LINE userId 寫入 `ADMIN_APPROVED_LINE_USER_IDS`，作為 bootstrap 管理員。
5. 建議同步設定 `SUPER_ADMIN_LINE_USER_IDS`；若未設定，系統會先以 `ADMIN_APPROVED_LINE_USER_IDS` 作為最高管理員 fallback。
6. 之後其他管理員可先登入 admin 頁面進入待審核，再由具有管理員修改權限的 admin 或最高管理員進行設定。
7. 以網頁應用程式方式部署。
8. 執行身分建議設為你自己，存取權限可依需求設定。

## 工作表欄位

### Services
- `serviceId`
- `name`
- `durationMinutes`
- `price`
- `active`
- `updatedAt`

### Technicians
- `technicianId`
- `name`
- `serviceIds`
- `active`
- `updatedAt`

### Schedules
- `scheduleId`
- `technicianId`
- `date`
- `startTime`
- `endTime`
- `isWorking`
- `updatedAt`

### Reservations
- `reservationId`
- `userId`
- `userDisplayName`
- `customerName`
- `phone`
- `technicianId`
- `serviceId`
- `date`
- `startTime`
- `endTime`
- `status`
- `note`
- `createdAt`

### Users
- `userId`
- `displayName`
- `customerName`
- `phone`
- `pictureUrl`
- `status`
- `note`
- `createdAt`
- `updatedAt`
- `lastLoginAt`

### AdminUsers
- `userId`
- `displayName`
- `pictureUrl`
- `status`
- `canManageAdmins`
- `note`
- `createdAt`
- `updatedAt`
- `lastLoginAt`

## 使用流程

1. 管理員先到 `admin/` 建立服務項目。
2. 建立技師，並指定該技師可服務的項目。
3. 設定技師每日上班時間。
4. 客人到 `client/` 選擇技師、服務、日期與時段後送出預約。
5. 首次登入的 LINE 用戶會先進入待審核，管理員需到 `admin/` 的「用戶審核」頁面通過後，該用戶才可正式送單。
6. 管理員第一次使用前，需先由已在 `ADMIN_APPROVED_LINE_USER_IDS` 內的 bootstrap 管理員登入後台。
7. 最高管理員登入 `superadmin/` 後，可設定哪些 admin 具有「管理其他管理員」的權限。
8. 其他管理員登入 admin 後會先進入待審核，需由具備管理員修改權限的 admin 到「管理員存取審核」區塊通過後才可使用。

## 注意事項

- 管理員後台改為 LIFF 登入 + 管理員審核機制，第一次需先在 Script Properties 設定 `ADMIN_APPROVED_LINE_USER_IDS`。
- 若要明確區分最高管理員，請額外設定 `SUPER_ADMIN_LINE_USER_IDS`。
- 前台建立預約時，GAS 會再次檢查用戶是否為「已通過」，所以即使前端被繞過也無法直接送單。
- 若要上正式環境，建議再加上 Google Login 或更嚴格的身份驗證。
- 若需要取消預約、黑名單、LINE 通知、Email 通知，可在此基礎上繼續擴充。
