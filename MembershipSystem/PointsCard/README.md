# PointsCard — LINE LIFF 集點卡

`PointsCard` 採用 GitHub Pages + LINE LIFF + Google Apps Script + Google Sheets 架構，提供會員集點、優惠券、抽獎券、店家確認 QR 與管理端功能。

目前程式版本：`2.1.0`。

## 2.1.0 重點

- 支援建立多張集點卡，每張卡各自保存會員集點進度、獎勵節點、集點 QR 與票券紀錄。
- 會員端在同一個 HTML 頁面內以小分頁切換集點卡；分頁會顯示卡名與目前點數，下方只顯示所選卡片的集點進度及相關票券。
- 切換集點卡會重新向 `member.me` 取得指定 `cardId` 的伺服器端投影，不會混用不同卡片的點數或票券。
- 會員端會提早並行載入 LIFF、前端程式與公開設定，並在 LIFF 初始化期間預先建立 GAS 連線。
- 已完成多卡資料升級後，`member.me` 不再重跑全工作表初始化或建立後丟棄舊版單卡投影。
- 會員端與管理端共用免下載的繁中字型 fallback、清楚的焦點狀態與安全區域間距；手機採單欄／底部對話框，會員端在 `900px` 以上切換為集點卡與票券雙欄，管理端在 `900px` 以下將資料表轉為標籤卡片。

## 1.4.0 歷史重點

- 管理端可設定整張集點卡為「有期限」或「無期限」。
- 管理端可刪除目前集點卡；刪除後停止新的集點，但保留會員累計點數、已獲得票券、兌換紀錄與 Audit Log。
- 刪除集點卡時會撤銷當下所有仍為 `active` 的集點 QR，避免日後重新啟用集點卡時舊 QR 或外流 QR 自動恢復可用。
- 集點卡過期或刪除時，會員端顯示「目前沒有可用集點卡」。
- 沒有可用集點卡時隱藏集點進度與未獲得票券，但會員已獲得的優惠券／抽獎券仍可使用。
- 舊版部署沒有卡片生命週期 Script Properties 時，預設視為「有效、無期限」，因此不需要資料搬移。
- `member.me` 會回傳 `card.status / card.available / card.expiresAt / card.updatedAt`。
- 新增 `admin.card.update` 與 `admin.card.delete`，兩者都必須通過 LINE 身分驗證、管理員權限驗證、rate limit、ScriptLock 與 optimistic concurrency 檢查。

## 功能

### 會員端

- 使用 LINE LIFF 登入；GAS 以 LINE Verify ID Token API 驗證身分。
- 以同頁小分頁切換多張集點卡，顯示所選卡片的集點進度與獎勵節點。
- 集點卡不存在、已刪除或已過期時顯示「目前沒有可用集點卡」。
- 顯示已獲得與未獲得的優惠券／抽獎券；卡片不可用時仍保留已獲得票券。
- 已獲得票券可掃描店家確認 QR 使用；優惠券完成核銷，抽獎券由 GAS 固定開獎結果後播放動畫。
- 使用 `liff.scanCodeV2()` 掃描店家集點 QR，或直接開啟店家發放連結。
- 登入 callback、網路逾時與 retry 會保留同一個 `requestId`，避免重複加點。
- LINE ID Token 只留在目前頁面的記憶體，不寫入 Local Storage、Session Storage、URL 或 Sheet。

### 管理端

- 管理員權限由 `Members.canManagePoints` 控制，每個 `admin.*` request 都由 GAS 重新驗證。
- 管理首頁可設定集點卡期限、改為無期限、刪除或重新啟用集點卡。
- 刪除集點卡不會刪除會員歷史資料；舊的 active 集點 QR 會被永久停止。
- 集點卡不可用時，管理端禁止建立新的集點 QR；GAS 也會再次檢查，不依賴前端按鈕狀態。
- 檢視會員、累計集點、可兌換獎勵與會員狀態。
- 設定 1–5 個獎勵節點，每個節點可選優惠券或抽獎券；抽獎券可設定 2–8 個獎項與各自中獎率。
- 建立、開啟、停止或刪除店家票券確認 QR。
- 建立 `single`、`per-member` 或 `repeatable` 集點 QR；預設建議 `per-member`。
- 集點 QR 本身也可設定到期時間或無期限；此設定與整張集點卡的生命週期是兩層獨立限制，兩者都必須有效才能集點。

## 集點卡生命週期

整個 PointsCard 專案目前是一套「單一集點卡方案」，會員的 `totalStamps` 是歷史累計值，不是每張獨立卡片各自建立一列資料。

卡片生命週期使用 GAS Script Properties：

```text
POINTS_CARD_CARD_STATUS
POINTS_CARD_CARD_EXPIRES_AT
POINTS_CARD_CARD_UPDATED_AT
```

有效狀態：

```text
active
├─ expiresAt 空白 → 無期限
└─ expiresAt 未來時間 → 有期限

expired
└─ status 仍為 active，但 expiresAt 已到期

deleted
└─ 管理員刪除，目前沒有可用集點卡
```

舊版部署沒有上述 Properties 時：

```text
status = active
expiresAt = ''
updatedAt = legacy
```

因此升級後不會把既有會員突然變成「沒有集點卡」。

### 刪除集點卡的資料策略

刪除是卡片方案的狀態刪除，不會刪除：

- `Members`
- `StampRecords`
- `RewardRecords`
- `RewardConfirmations`
- `AuditLogs`
- 會員累計點數
- 已獲得且尚未使用的票券

同時會將當下所有 `StampVouchers.status === active` 的集點 QR 改為 `cancelled`，避免重新啟用集點卡時舊 QR 復活。

### 過期與重新啟用

- 卡片過期只暫停新的集點，不會自動取消原有 QR。
- 管理員延長卡片期限或改成無期限後，尚未被取消且自身仍有效的 QR 可以繼續使用。
- 卡片若曾被「刪除」，重新啟用前會再次撤銷任何殘留 active QR；重新啟用後應建立新的集點 QR。

## 商業規則

`totalStamps` 是不可回寫減少的歷史累計值；`redeemedRewards` 是已完成使用的獎勵數量。最大獎勵節點是一張卡的視覺長度，完成後會進入下一個循環。

例如：

```text
節點：3 點 → 小點心優惠券
      6 點 → 幸運抽獎券
     10 點 → 招牌飲品優惠券

第 1 循環：3 / 6 / 10 點取得獎勵
第 2 循環：13 / 16 / 20 點再次取得相同節點獎勵
```

`RewardRecords.rewardOrdinal` 記錄實際使用的節點，會員可以使用任一張已獲得且尚未使用的票券。

抽獎結果只在 GAS 端依設定權重產生，先寫入 `RewardRecords.lotteryResult` 再回傳前端。同一個 `requestId` retry 時會恢復原結果，不會重新抽獎。

## 集點交易與刪卡競態

`stamp.record`、卡片刪除與卡片更新都使用 ScriptLock。

新的集點流程：

```text
LINE ID Token 驗證
→ 會員狀態驗證
→ 檢查同 requestId 是否已有 processing / recorded 紀錄
→ 若是既有 request，優先 recovery，維持 exactly-once 語意
→ 檢查整張集點卡 card.available
→ 檢查 StampVoucher 狀態 / 到期 / scanMode
→ 寫 processing
→ 更新會員 totalStamps
→ 寫 recorded + Audit
```

因此刪卡之後不允許新的集點，但刪卡前已開始且具有同一 `requestId` 的交易仍可安全 recovery，不會留下半完成會員點數。

## 集點 QR 模式

### `single`

整組 QR 只允許一次成功集點。適合每筆交易建立一次性 QR。

### `per-member`（建議）

同一張 QR 可提供多位會員使用，但同一會員只能成功使用一次。限制由 GAS 在 ScriptLock 內以 `voucherId + memberLineUserId` 的紀錄重新判斷。

### `repeatable`

同一或不同會員都可以重複使用。拿到連結的有效會員可以建立新的 `requestId` 再次使用，因此只適合店員現場嚴格控管的流程。

## API

會員端：

```text
member.me
stamp.record
reward.claim
```

管理端：

```text
admin.summary
admin.members.search
admin.stamps.list
admin.reward-confirmations.list
admin.member.update
admin.reward.redeem
admin.reward-nodes.update
admin.card.update
admin.card.delete
admin.stamp.create
admin.stamp.open
admin.stamp.cancel
admin.stamp.delete
admin.reward-confirm.create
admin.reward-confirm.open
admin.reward-confirm.cancel
admin.reward-confirm.delete
```

所有 `admin.*` mutation 都由伺服器端 `requireAdmin_()` 驗證，不依賴前端隱藏功能。

## 專案目錄

```text
PointsCard/
├── index.html
├── redirect.js
├── shared/
│   ├── common.js
│   └── config.json
├── user/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── admin/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── card-lifecycle.js
│   └── card-lifecycle.css
├── gas/
│   ├── Code.gs
│   ├── CardService.gs
│   ├── Storage.gs
│   ├── StampService.gs
│   ├── RewardService.gs
│   ├── RewardConfirmationService.gs
│   └── appsscript.json
└── tests/
    ├── contracts.test.js
    ├── optimization.test.js
    ├── recovery.test.js
    ├── supply-chain.test.js
    ├── stamp-lifecycle.test.js
    ├── card-lifecycle.test.js
    └── card-delete-revocation.test.js
```

## Sheet 資料

執行 `initializePointsCardStorage()` 後會建立：

- `Members`
- `StampVouchers`
- `StampRecords`
- `RewardConfirmations`
- `RewardRecords`
- `AuditLogs`

`1.4.0` 沒有新增 Sheet 欄位。卡片期限與刪除狀態存在 Script Properties，因此不需要 Sheet migration。

## Observability / Sentry

每個 GAS `doPost` request 都建立短期 `traceId`，回傳在 JSON response 的 `meta.traceId`，並輸出結構化 `points_card_api` log：

```text
traceId
action
ok
durationMs
errorCode（失敗時）
```

`shared/common.js` 的 `PointsCard.reportError()` 只允許下列 context 進入 Sentry：

```text
source
action
traceId
durationMs
```

錯誤訊息會遮蔽 URL、LINE User ID、32–64 位 hex token 與 JWT。Repository 不應硬編碼 Sentry DSN、Auth Token、LINE Channel Secret 或其他 secret。

新的 `admin.card.update`、`admin.card.delete`、`CARD_UNAVAILABLE` 錯誤仍透過同一個 `PointsCard.callApi()` / `reportError()` 路徑處理，不會把 mutation payload 或 QR share code 放進 Sentry context。

## 部署

### 1. 同步 GAS

**必須把 `gas/` 內所有檔案同步到同一個 Apps Script Project。**

`1.4.0` 新增 `CardService.gs`；若只更新 `Code.gs` 而沒有一起部署 `CardService.gs`，API 會因缺少卡片生命週期函式而失敗。

既有專案仍可執行：

```javascript
initializePointsCardStorage();
configurePointsCard('YOUR_LINE_LOGIN_CHANNEL_ID', '招牌飲品一份', 10);
```

`LINE_LOGIN_CHANNEL_ID` 是公開的 LINE Login Channel ID，不是 Channel Secret。

從舊版升級到 `1.4.0` 不需要新增 Sheet 欄位；重新執行 `initializePointsCardStorage()` 可確認既有 Sheet schema，但卡片 lifecycle 不依賴新的 Sheet 欄位。

### 2. 部署 GAS Web App

```text
Execute as: Me
Who has access: Anyone
```

GAS Web App 必須允許 LIFF 使用者連線；真正會員驗證仍由 LINE ID Token server-side verification 完成。

把 `/exec` URL 寫入 `shared/config.json`。

### 3. 設定 LIFF

- Endpoint URL 指向部署後的 `PointsCard/` 根目錄。
- Scope 至少包含 `openid` 與 `profile`。
- 相機掃碼需要支援 `liff.scanCodeV2()` 的 LINE LIFF 環境。

### 4. 指定管理員

先用該 LINE 帳號開啟會員端，再於 Script Editor 執行：

```javascript
setPointsCardAdmin('Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', true);
```

需要撤銷時傳入 `false`。不要把實際 LINE User ID 放進公開 repository、Issue 或 log。

## 本機驗證

```bash
node --check PointsCard/redirect.js
node --check PointsCard/shared/common.js
node --check PointsCard/user/app.js
node --check PointsCard/admin/app.js
node --check PointsCard/admin/card-lifecycle.js
node --test PointsCard/tests/*.test.js
```

`card-lifecycle.test.js` 驗證：

- 舊版缺少 lifecycle property 時仍視為有效、無期限。
- 有期限、無期限、過期與刪除狀態。
- `admin.card.update/delete` 的 server authorization、ScriptLock 與 optimistic concurrency。
- `stamp.record` 必須在新交易進入前檢查卡片有效性。
- 會員端精確顯示「目前沒有可用集點卡」。
- 已獲得票券在卡片不可用時仍保留。

`card-delete-revocation.test.js` 驗證刪卡會撤銷舊 active 集點 QR，並避免重新啟用卡片時舊 QR 復活。

Repository 測試只代表 source 語法與契約；GAS `/exec`、LINE Verify、Script Properties 與 LIFF 實機掃碼仍須在部署後做整合驗證。
