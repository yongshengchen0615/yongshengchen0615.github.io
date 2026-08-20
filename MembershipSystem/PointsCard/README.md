# PointsCard — LINE LIFF 集點卡

`PointsCard` 採用 GitHub Pages + LINE LIFF + Google Apps Script + Google Sheets 架構，提供可獨立部署的會員集點、票券與抽獎系統。

目前程式版本：`1.3.0`。

## 功能

### 會員端

- 使用 LINE LIFF 登入；GAS 以 LINE Verify ID Token API 驗證身分。
- 顯示集點進度，以及下方「已獲得／未獲得」優惠券與抽獎券。
- 已獲得票券可點開並掃描店家確認 QR；優惠券立即核銷，抽獎券顯示開獎動畫與伺服器端結果。
- 透過 `liff.scanCodeV2()` 掃描店家 QR Code，或直接開啟店家發放連結。
- 登入 callback、網路逾時與重試會保留同一個 `requestId`，避免重複集點。
- LINE ID Token 只留在目前頁面的記憶體，不寫入 Local Storage、Session Storage、URL 或 Sheet。
- `member.me` 只取得目前畫面需要的會員與票券狀態，不再讀取已移除的歷史活動清單。

### 管理端

- 管理員權限由 `Members.canManagePoints` 控制，每個 `admin.*` request 都由 GAS 重新讀取驗證。
- 管理首頁先載入摘要與獎勵設定；會員、集點 QR、票券確認等資料在切換分頁時按需載入。
- 會員搜尋只呼叫 `admin.members.search`，不再重新載入完整 dashboard。
- 檢視會員、累計集點、可兌換獎勵與會員狀態。
- 停權或停用會員，不允許前端直接修改累計點數。
- 設定 1–5 個獎勵節點，每個節點可選優惠券或抽獎券；抽獎券可設定 2–8 個獎項與各自中獎率。
- 會員可選擇任一張已獲得票券使用，並留下票券節點、店家確認與 Audit Log。
- 建立、開啟、停止或刪除店家票券確認 QR。
- 建立 `single`、`per-member` 或 `repeatable` 集點 QR Code；新版管理端預設使用較安全的 `per-member`。

## 商業規則

`totalStamps` 是不可回寫減少的歷史累計值；`redeemedRewards` 是已完成的兌換次數。最大節點是一張卡的長度，完成後會進入下一張卡並重複相同節點。

```text
節點：3 點 → 小點心優惠券、6 點 → 幸運抽獎券、10 點 → 招牌飲品優惠券
第 1 張：累計 3 / 6 / 10 點時依序取得三份獎勵
第 2 張：累計 13 / 16 / 20 點時再次取得三份獎勵
```

`RewardRecords.rewardOrdinal` 記錄實際使用的節點，因此會員可點選任一張已獲得且尚未使用的票券；`redeemedRewards` 繼續作為使用總數，維持既有資料相容。節點修改會套用到目前累計點數；第一筆票券確認後即鎖定設定，避免既有票券被重新解讀。

抽獎結果只在 GAS 端依設定權重產生，先寫入 `RewardRecords.lotteryResult` 再回傳前端播放動畫。同一個 `requestId` 重試時會恢復原結果，不會重新抽獎。每個獎項可設定 `0%` 至 `100%`（最多兩位小數），同一張抽獎券必須精確合計 `100%`；`0%` 獎項會保留在設定中但不會被抽中。

## 目錄

```text
PointsCard/
├── index.html
├── redirect.js
├── shared/
│   ├── common.js           LIFF、API transport、trace / Sentry bridge
│   └── config.json
├── user/
├── admin/
├── gas/
│   ├── Code.gs             API router、LINE 驗證、管理查詢、trace logging
│   ├── Storage.gs          Sheet schema、request-scoped read cache、Audit
│   ├── StampService.gs     QR 發放、retry-safe 集點、per-member replay guard
│   ├── RewardService.gs    retry-safe 獎勵兌換
│   ├── RewardConfirmationService.gs
│   └── appsscript.json
└── tests/
    ├── contracts.test.js
    └── optimization.test.js
```

## Sheet 資料

執行 `initializePointsCardStorage()` 後會建立：

- `Members`
- `StampVouchers`
- `StampRecords`
- `RewardConfirmations`
- `RewardRecords`
- `AuditLogs`

集點與兌換 mutation 都先寫入 `processing` 紀錄，再更新會員累計，最後改為 `recorded`。同一個 `requestId` 重送時會恢復或回傳同一筆結果。若中斷狀態與會員累計無法安全對應，API 會回 `RECOVERY_REQUIRED`，不會猜測或重複加點。

`1.3.0` 另外在單次 GAS request 內快取完整 Sheet read；`appendObject_`、`writeObjectRow_` 與 `deleteObjectRow_` 都會立即清除對應快取，避免同一 request 重複 `getValues()` 又不犧牲 mutation 後的一致性。

## 集點 QR Code 模式

### `single`

整組 QR Code 只允許一次成功集點。適合每筆交易建立一次性 QR；任何會員成功使用後，其他會員都不能再使用。

### `per-member`（新版預設）

同一張 QR 可提供多位會員使用，但**同一會員只能成功使用一次**。這個限制在 GAS 的 ScriptLock 交易內，以 `voucherId + memberLineUserId` 的已完成紀錄重新判斷，不依賴前端狀態。

適合活動、批次發放或「每會員限領一次」的情境。

### `repeatable`

可由同一或不同會員重複集點。保留此模式是為了相容既有門市流程，但拿到連結的有效會員可重複建立新 `requestId` 使用，因此只應用於店員現場嚴格控管的特殊情境。

若不確定要選哪個模式，優先使用 `per-member`；若每筆消費都必須獨立核准，優先使用 `single` 並為每筆交易產生新 QR。

## 管理端 API 拆分

為降低 Google Sheets 全表讀取與管理搜尋成本，`1.3.0` 新增：

```text
admin.summary
admin.members.search
admin.stamps.list
admin.reward-confirmations.list
```

舊的 `admin.dashboard` 仍保留作為相容 API，但新版 `admin/app.js` 不再依賴它。

新版載入流程：

```text
登入
→ admin.summary
→ 總覽可操作

切換會員分頁
→ admin.members.search

切換集點 QR
→ admin.stamps.list

切換票券確認
→ admin.reward-confirmations.list
```

會員搜尋 debounce 後只查會員，不再重抓 QR、票券確認與統計資料。

## Observability / Sentry

每個 GAS `doPost` request 都建立短期 `traceId`，並在 JSON response 中回傳：

```json
{
  "meta": {
    "traceId": "..."
  }
}
```

GAS 會輸出結構化 log：

```text
points_card_api
- traceId
- action
- ok
- durationMs
- errorCode（失敗時）
```

未預期例外另外輸出 `points_card_unhandled_error` 與截短後的 stack。這些 log 不記錄 `idToken`、mutation payload、QR share code 或 request URL query。

`shared/common.js` 提供安全的 `PointsCard.reportError()`。若頁面已由部署環境初始化 `window.Sentry`，錯誤會使用 `Sentry.captureException()` 上報，附帶的 context 僅允許：

```text
source
API action
traceId
durationMs
```

Repository 不硬編碼 Sentry DSN、Auth Token 或其他 secret。Sentry Auth Token 僅供管理端 API 查詢／維運工具使用，不應放進 GitHub Pages。

## 部署設定

### 1. 建立或更新 GAS 專案

將 `gas/` 內所有檔案同步到同一個 Apps Script Project，然後執行：

```javascript
initializePointsCardStorage();
configurePointsCard('YOUR_LINE_LOGIN_CHANNEL_ID', '招牌飲品一份', 10);
```

`LINE_LOGIN_CHANNEL_ID` 是公開的 LINE Login Channel ID，不是 Channel Secret。

從舊版升級至 `1.3.0` 時仍建議再次執行：

```javascript
initializePointsCardStorage();
```

`1.3.0` 沒有新增 Sheet 欄位；`per-member` 沿用既有 `scanMode` 欄位，因此不需要資料搬移。

### 2. 部署 Web App

```text
Execute as: Me
Who has access: Anyone
```

GAS Web App 必須允許未登入 Google 的 LIFF 使用者連線；實際會員驗證仍由 LINE ID Token server-side verification 完成。

把 `/exec` URL 寫入 `shared/config.json`。

### 3. 設定 LIFF

- Endpoint URL 指向部署後的 `PointsCard/` 根目錄。
- Scope 至少包含 `openid` 與 `profile`。
- 若要使用相機掃碼，需在 LIFF 設定與支援的 LINE 環境啟用 Scan QR。

### 4. 指定第一位管理員

先用該 LINE 帳號開啟會員端，再於 Script Editor 執行：

```javascript
setPointsCardAdmin('Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', true);
```

需要撤銷時改傳 `false`。不要把實際 LINE User ID 貼到公開 Issue、文件或程式碼。

## 店家票券確認 QR

- 店家確認 QR 與集點 QR 使用不同資料表、參數與 API，不能互相替代。
- 店員只在門市現場展示；拿到連結的人若同時擁有未使用票券，即可在有效期內完成確認。
- QR 外流時應由管理端立即停止並建立新 QR；已有票券紀錄的 QR 只能停止，不能刪除。
- 優惠券確認後立即使用；抽獎券確認後由 GAS 固定開獎結果，再由會員端播放揭曉動畫。

## 多節點設定限制

- 每張卡可設定 1–5 個節點。
- 節點必須是 1–20 的不重複整數。
- 最大節點決定每張卡的點數長度。
- 節點類型必須是優惠券或抽獎券。
- 抽獎券必須設定 2–8 個不重複獎項；各獎項中獎率可為 `0%` 至 `100%`、最多兩位小數，合計必須精確為 `100%`。
- 會員端會列出中獎率大於 `0%` 的可能獎項，但不公開各獎項權重。
- 尚未使用任何票券前，可以修改節點。
- 產生第一筆 `RewardRecords` 後設定鎖定。

## 本機驗證

```bash
node --check PointsCard/redirect.js
node --check PointsCard/shared/common.js
node --check PointsCard/user/app.js
node --check PointsCard/admin/app.js
node --test PointsCard/tests/*.test.js
```

`optimization.test.js` 另外驗證：

- `member.me` 不再讀取未使用的 activity。
- 管理端使用拆分查詢 API。
- `per-member` 防止同會員重放、同時保留 `single/repeatable` 相容性。
- request-scoped Sheet cache 寫入後會失效。
- trace / Sentry bridge 不把 ID Token 或 mutation payload 放進 observability context。

本機測試通過只代表 repository source 的語法與契約一致；GAS `/exec`、LINE Verify 與 LIFF 實機掃碼仍須在部署後另行驗證。
