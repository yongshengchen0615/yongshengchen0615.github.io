# PointsCard — LINE LIFF 集點卡

`PointsCard` 參考 `app` 的 GitHub Pages + LIFF + Google Apps Script + Google Sheets 架構，獨立提供一套可部署的集點卡系統。

## 功能

### 會員端

- 使用 LINE LIFF 登入；GAS 以 LINE Verify ID Token API 驗證身分。
- 顯示可配置的集點節點、每個節點獎勵、累計集點、待兌換獎勵與最近紀錄。
- 透過 `liff.scanCodeV2()` 掃描店家 QR Code，或直接開啟店家發放連結。
- 登入 callback、網路逾時與重試會保留同一個 `requestId`，避免重複集點。
- LINE ID Token 只留在目前頁面的記憶體，不寫入 Local Storage、Session Storage、URL 或 Sheet。

### 管理端

- 管理員權限由 `Members.canManagePoints` 控制，每個 `admin.*` request 都由 GAS 重新讀取驗證。
- 檢視會員、累計集點、可兌換獎勵與會員狀態。
- 停權或停用會員，不允許前端直接修改累計點數。
- 設定 1–5 個獎勵節點，例如 3 點送小點心、6 點送折價券、10 點送飲品。
- 依達成順序兌換不同節點獎勵，並留下備註與 Audit Log。
- 建立單次或可重複使用的集點 QR Code，支援開啟、停止與刪除未使用 QR。

## 商業規則

`totalStamps` 是不可回寫減少的歷史累計值；`redeemedRewards` 是已完成的兌換次數。最大節點是一張卡的長度，完成後會進入下一張卡並重複相同節點。

```text
節點：3 點 → 小點心、6 點 → 50 元折價券、10 點 → 招牌飲品
第 1 張：累計 3 / 6 / 10 點時依序取得三份獎勵
第 2 張：累計 13 / 16 / 20 點時再次取得三份獎勵
```

獎勵採 FIFO：管理端永遠兌換最早達成且尚未使用的節點，讓既有 `redeemedRewards` 與 `RewardRecords` 保持相容。節點修改會套用到目前累計點數；第一筆獎勵兌換後即鎖定設定，避免既有兌換被重新解讀。

## 目錄

```text
PointsCard/
├── index.html              LIFF Endpoint 導向頁
├── redirect.js
├── shared/
│   ├── common.js           LIFF、登入 callback、API transport、request recovery
│   └── config.json         LIFF ID 與 GAS Web App URL
├── user/                   會員集點卡
├── admin/                  管理端
├── gas/
│   ├── Code.gs             API router、LINE 驗證、會員與管理查詢
│   ├── Storage.gs          Sheet schema、初始化、管理員設定、Audit
│   ├── StampService.gs     QR 發放與 retry-safe 集點
│   ├── RewardService.gs    retry-safe 獎勵兌換
│   └── appsscript.json
└── tests/contracts.test.js
```

## Sheet 資料

執行 `initializePointsCardStorage()` 後會建立：

- `Members`
- `StampVouchers`
- `StampRecords`
- `RewardRecords`
- `AuditLogs`

集點與兌換 mutation 都先寫入 `processing` 紀錄，再更新會員累計，最後改為 `recorded`。同一個 `requestId` 重送時會恢復或回傳同一筆結果。若中斷狀態與會員累計無法安全對應，API 會回 `RECOVERY_REQUIRED`，不會猜測或重複加點。

## 部署設定

### 1. 建立 GAS 專案

將 `gas/` 內所有檔案同步到同一個 Apps Script Project，然後在 Script Editor 依序執行：

```javascript
initializePointsCardStorage();
configurePointsCard('YOUR_LINE_LOGIN_CHANNEL_ID', '招牌飲品一份', 10);
```

`LINE_LOGIN_CHANNEL_ID` 是公開的 LINE Login Channel ID，不是 Channel Secret。

上述函式會建立相容的單一 10 點節點。部署 `1.1.0` 後，可直接在管理端「獎勵節點」區域新增不同點數與獎勵；既有單一節點設定會自動作為 fallback，不需要修改 Sheet 欄位或重建試算表。

### 2. 部署 Web App

建立或更新 Web App deployment：

```text
Execute as: Me
Who has access: Anyone
```

GAS Web App 必須允許未登入 Google 的 LIFF 使用者連線；實際會員驗證仍由 LINE ID Token server-side verification 完成。

把 `/exec` URL 寫入 `shared/config.json`：

```json
{
  "LIFF_ID": "1234567890-AbCdEfGh",
  "GAS_WEB_APP_URL": "https://script.google.com/macros/s/DEPLOYMENT_ID/exec"
}
```

### 3. 設定 LIFF

- Endpoint URL 指向部署後的 `PointsCard/` 根目錄。
- Scope 至少包含 `openid` 與 `profile`。
- 若要使用相機掃碼，需在 LIFF 設定與支援的 LINE 環境啟用 Scan QR。

### 4. 指定第一位管理員

先用該 LINE 帳號開啟會員端，讓 `Members` 建立會員 row。接著從 `Members.lineUserId` 取得該帳號的 LINE User ID，在 Script Editor 執行：

```javascript
setPointsCardAdmin('Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', true);
```

需要撤銷時改傳 `false`。不要把實際 LINE User ID 貼到公開 Issue、文件或程式碼。

管理端網址為：

```text
https://YOUR_GITHUB_PAGES_HOST/.../PointsCard/admin/
```

## QR Code 模式

- `single`：整組 QR Code 只允許一次成功集點，適合單次發放。
- `repeatable`：可由不同會員重複集點，適合店員現場展示；分享連結外流也會增加濫用風險，因此必須由店員控管展示時機。
- QR Code 的 `shareCode` 是集點憑證，不是會員 Authentication 或管理 Authorization。會員身分、狀態與管理權限仍由 GAS 判斷。

## 多節點設定限制

- 每張卡可設定 1–5 個節點。
- 節點必須是 1–20 的不重複整數。
- 最大節點決定每張卡的點數長度。
- 尚未兌換獎勵前，可以修改節點；新設定會依會員目前累計點數重新計算可兌換獎勵。
- 產生第一筆 `RewardRecords` 後設定會鎖定；集點仍可繼續循環累積。

## 本機驗證

```bash
node --check PointsCard/redirect.js
node --check PointsCard/shared/common.js
node --check PointsCard/user/app.js
node --check PointsCard/admin/app.js
node --test PointsCard/tests/*.test.js
```

本機測試通過只代表 repository source 的語法與契約一致；GAS `/exec` 與 LIFF 實機掃碼仍須在部署後另行驗證。
