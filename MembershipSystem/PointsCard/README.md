# PointsCard — LINE LIFF 集點卡

`PointsCard` 採用 GitHub Pages + LINE LIFF + Google Apps Script + Google Sheets 架構，提供會員集點、優惠券、抽獎券、店家確認 QR 與管理端功能。

目前用戶端與 GAS API 版本：`2.3.2`。

## 2.3.2 重點

- 店家票券確認 QR 可直接刪除；已有使用紀錄時會改為封存刪除並從管理列表隱藏，保留票券核銷與稽核紀錄。

## 2.3.1 重點

- 店家票券確認 QR 可選擇「有期限」或「無期限」；有期限時仍維持最長 7 天的安全上限，無期限 QR 會在管理端清楚標示。
- 會員端會將同一張集點卡、同一獎勵節點且狀態相同的已獲得票券合併顯示，右下角以張數標示；開啟合併票券時會優先使用較早到期的一張。

## 2.3.0 重點

- 每個優惠券／抽獎券節點可設定「取得後有效天數」；`0` 代表無期限。會員端會顯示票券使用期限，已到期票券保留顯示但不能核銷。
- 每個票券節點可設定「取得後幾天仍未使用就提醒」；`0` 代表不提醒。提醒排程透過 LINE Messaging API 官方帳號推播，並以 `X-Line-Retry-Key` 與 `CardRewardNotifications` 避免暫時性失敗造成重複訊息。
- 會員端固定顯示目前集點卡期限；沒有設定到期時間時明確顯示「無期限」。
- 多卡刪除改為封存：停止新集點並撤銷該卡仍有效的集點 QR，但保留卡片定義、會員進度、交易紀錄與未使用票券。管理端不再列出封存卡，會員仍可在原卡分頁使用尚未到期票券。
- 舊獎勵節點沒有票券期限／提醒欄位時，自動視為「無期限、不提醒」；既有多卡資料表會只新增 `CardRewardNotifications`，不重跑舊交易資料遷移。

## 2.2.1 重點

- LIFF 改用固定 `@line/liff 2.29.2` 的 pluggable bundle，只包含登入、ID Token 與 `scanCodeV2` 所需模組。
- 不再直接載入會使用動態 JavaScript 的完整 CDN SDK；建置時將 `scanCodeV2` 子視窗的 `iframe.eval()` 改為等價的 DOM form 建立流程，本地 bundle 不含 `eval()` 或 `new Function()`，因此不需要在 CSP 加入 `'unsafe-eval'`。
- 會員頁的 `frame-src` 與 `form-action` 只開放 `https://liff-subwindow.line.me`，供電腦瀏覽器的 LINE 掃碼子視窗使用。
- LIFF bundle 從完整 CDN SDK 約 126 KB 降至約 84 KB，並以 lockfile 固定直接與遞迴相依版本。

## 2.2.0 重點

- 會員端與管理端新增清楚的同步／更新失敗狀態；背景刷新失敗時保留最後一次成功資料，不再把整個操作畫面換成錯誤頁。
- 明確白名單內的唯讀 API 會合併同時間重複請求，並在暫時性連線失敗或 GAS `502 / 503 / 504` 時自動重試一次；寫入與刪除操作不會自動重送。
- 管理端切換、建立、儲存或刪除集點卡後改為頁內更新，不再重新載入頁面或重跑 LIFF 登入初始化。
- `member.me` 只精確查找目前會員的集點進度與票券紀錄；單一會員命中筆數過多時自動退回請求內全表快照，兼顧小量與大量資料情境。

## 2.1.3 重點

- 修正從 LINE 內直接開啟管理端時，已登入狀態被強制登出後卡在登入導向、導致管理端無法開啟的問題。
- 會員端與管理端每次載入仍會重新執行 `liff.init()`、取得當次 ID Token，且 GAS 會在每個 API request 重新驗證；已有有效 LINE 登入時不再重複登出。
- 未登入時才執行 `liff.login()`；外部瀏覽器憑證過期時，依 LINE 建議先登出並重新載入，再進入登入流程。
- 用戶端與管理端分別使用 `USER_LIFF_ID`、`ADMIN_LIFF_ID`；管理端產生的會員集點／票券 QR 一律使用 `USER_LIFF_ID`。

## 2.1.2 重點

- 會員端與管理端每次重新進入時都重新建立 LIFF 驗證；此版曾在外部瀏覽器與 LINE in-app browser 強制先登出再登入，已由 2.1.3 修正。
- LINE 官方不允許在 LIFF browser 內手動呼叫 `liff.login()`，因此該環境由每次頁面載入的 `liff.init()` 自動完成本次登入並取得 ID Token。
- 登入 redirect 使用短效且綁定會員／管理頁面路徑的一次性標記，避免 callback 形成無限登入循環；標記不保存 ID Token。

## 2.1.1 重點

- 抽獎券掃描店家確認 QR 後先以 `reward.prepare` 驗證票券，loading 完成才顯示抽獎準備畫面。
- 會員點擊「開始抽獎」時才透過 `reward.claim` 核銷並由 GAS 固定開獎結果；在準備畫面選擇「稍後再抽」不會消耗票券。

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
- 顯示集點卡期限、票券使用期限與店家票券確認 QR 期限；無期限會明確標示。
- 已獲得票券可掃描店家確認 QR 使用；掃描後先顯示票券確認中的 loading，優惠券完成核銷，抽獎券則由 GAS 固定開獎結果。
- 抽獎券確認完成後由會員點擊「開始抽獎」，再以旋轉、減速、揭曉三段式動效呈現；偏好減少動態的裝置使用快速、低動態版本。
- 使用 `liff.scanCodeV2()` 掃描店家集點 QR，或直接開啟店家發放連結。
- 登入 callback、網路逾時與 retry 會保留同一個 `requestId`，避免重複加點。
- LINE ID Token 只留在目前頁面的記憶體，不寫入 Local Storage、Session Storage、URL 或 Sheet。

### 管理端

- 管理員權限由 `Members.canManagePoints` 控制，每個 `admin.*` request 都由 GAS 重新驗證。
- 管理首頁可設定集點卡期限、改為無期限、刪除或重新啟用集點卡。
- 集點卡名稱不可重複；伺服器會忽略全形／半形、英文字母大小寫與連續空白差異後判定名稱是否相同。
- 刪除集點卡不會刪除會員歷史資料；舊的 active 集點 QR 會被永久停止。
- 集點卡不可用時，管理端禁止建立新的集點 QR；GAS 也會再次檢查，不依賴前端按鈕狀態。
- 檢視會員、累計集點、可兌換獎勵與會員狀態。
- 設定 1–5 個獎勵節點，每個節點可選優惠券或抽獎券；抽獎券可設定 2–8 個獎項與各自中獎率。
- 每個獎勵節點可分別設定票券有效天數與未使用提醒天數；提醒必須早於到期日。
- 建立、開啟、停止或刪除店家票券確認 QR；即使已有使用紀錄也可安全刪除，並保留歷史紀錄。每組可設定有期限或無期限，有期限時最長 7 天。開啟既有 QR 時會先顯示 loading，確認 QR 只提供展示與下載，不顯示分享連結。
- 建立 `single`、`per-member` 或 `repeatable` 集點 QR；預設建議 `per-member`。
- 每組集點 QR 永久綁定單一 `cardId`；開啟、停止、刪除與集點紀錄都必須匹配同一張集點卡，不可跨卡共用。
- 集點 QR 本身也可設定到期時間或無期限；此設定與整張集點卡的生命週期是兩層獨立限制，兩者都必須有效才能集點。

## 集點卡生命週期

PointsCard 採多集點卡資料模型。每張卡片都有獨立的 `MemberCardProgress` 列，`totalStamps` 與 `redeemedRewards` 只屬於該會員在該張卡的歷史累計，不會跨卡共用。

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

## 票券期限與未使用提醒

票券期限以會員實際跨過獎勵節點的集點紀錄時間為起點，而不是集點卡建立時間。獎勵節點欄位：

```text
ticketValidityDays = 0       → 無期限
ticketValidityDays = 30      → 取得後 30 天到期
unusedReminderDays = 0       → 不推播提醒
unusedReminderDays = 7       → 取得後 7 天仍未使用時提醒一次
```

兩個欄位都只接受 `0`–`3650` 的整數；有期限時，`unusedReminderDays` 必須小於 `ticketValidityDays`。舊資料缺少欄位時預設為 `0`，保持無期限且不主動推播。

提醒排程只掃描尚未核銷、尚未到期且已達提醒時間的票券。每張票券用 `cardId + memberLineUserId + rewardOrdinal` 產生固定通知 ID 與 LINE retry key；HTTP `200` 或相同 retry key 的 `409` 都記錄為已接受，避免連線逾時、重新設定提醒天數或重跑排程後重複推播。

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
reward.prepare
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

`admin.stamps.list`、`admin.stamp.create`、`admin.stamp.open`、`admin.stamp.cancel` 與 `admin.stamp.delete` 都必須帶入 `cardId`；其中開啟、停止與刪除還必須帶入同卡的 `voucherId`，伺服器會拒絕跨卡組合。

所有 `admin.*` mutation 都由伺服器端 `requireAdmin_()` 驗證，不依賴前端隱藏功能。

## 專案目錄

```text
PointsCard/
├── package.json
├── package-lock.json
├── index.html
├── redirect.js
├── scripts/
│   └── build-liff.mjs
├── shared/
│   ├── common.js
│   ├── config.json
│   └── liff-client.entry.js
├── vendor/
│   └── liff-client.js
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
│   ├── TicketNotificationService.gs
│   └── appsscript.json
└── tests/
    ├── contracts.test.js
    ├── optimization.test.js
    ├── storage-binding.test.js
    ├── recovery.test.js
    ├── supply-chain.test.js
    ├── stamp-lifecycle.test.js
    ├── card-lifecycle.test.js
    ├── card-delete-revocation.test.js
    └── ticket-expiry-reminder.test.js
```

## Sheet 資料

GAS 會依下列順序選擇並綁定資料試算表：

1. 從 Google Spreadsheet 內執行時，優先綁定目前開啟的 Spreadsheet。
2. 沒有目前 Spreadsheet 時，沿用 Script Property `POINTS_CARD_SPREADSHEET_ID`。
3. 兩者都沒有時，自動建立 `PointsCard Data` 並保存其 Spreadsheet ID。

執行 `initializePointsCardStorage()` 或第一次呼叫多集點卡 API 時，會自動建立完整資料表：

- `Members`
- `StampVouchers`
- `StampRecords`
- `RewardConfirmations`
- `RewardRecords`
- `AuditLogs`
- `Cards`
- `MemberCardProgress`
- `CardStampVouchers`
- `CardStampRecords`
- `CardRewardRecords`
- `CardRewardNotifications`

多集點卡遷移狀態會綁定 `POINTS_CARD_SPREADSHEET_ID`。若之後切換到另一份 Spreadsheet，下一次 API 請求會為新資料表建立必要工作表並執行一次相容遷移；若已遷移的資料表只缺少部分工作表，系統會停止寫入並列出缺少名稱，避免以空白工作表覆蓋可能需要從備份還原的資料。

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

`2.1.1` 新增 `reward.prepare`；部署時應先更新 GAS，再發布會員端，避免新版前端連到尚未支援準備流程的舊 `/exec`。

`2.3.0` 新增 `TicketNotificationService.gs` 與 `CardRewardNotifications`；同步新檔後，第一次 API request 或手動執行 `initializePointsCardStorage()` 會以非破壞方式新增提醒紀錄工作表。

若 Apps Script 是從目標 Google Spreadsheet 的「擴充功能 → Apps Script」開啟，執行下列函式就會綁定目前這份 Spreadsheet，並一次建立所有必要工作表：

```javascript
initializePointsCardStorage();
configurePointsCard('YOUR_LINE_LOGIN_CHANNEL_ID', '招牌飲品一份', 10);
```

`LINE_LOGIN_CHANNEL_ID` 是公開的 LINE Login Channel ID，不是 Channel Secret。

如果 Web App 第一次執行時尚未設定 Spreadsheet，也會自動綁定可用的目前 Spreadsheet；沒有目前 Spreadsheet 時則建立新的 `PointsCard Data`。重新執行 `initializePointsCardStorage()` 可切換並綁定目前 Spreadsheet，回傳值中的 `binding` 會顯示 `active`、`configured` 或 `created`。

### 1.1 設定 LINE 官方帳號票券提醒

在 Apps Script「專案設定 → 指令碼屬性」新增：

```text
LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = Messaging API channel access token
```

Token 是機密資料，不可寫入 repository、Sheet、瀏覽器設定或 log。LINE Login channel 與 Messaging API channel 必須位於同一個 LINE Provider，兩邊取得的會員 User ID 才能對應；會員也必須加入官方帳號好友（或符合 LINE push 的其他接收條件）。

同步並授權新版 `appsscript.json` 後，在 Script Editor 手動執行一次：

```javascript
installPointsCardTicketReminderTrigger();
```

這會建立每小時執行一次的 `runPointsCardTicketReminderSweep` time-driven trigger。可先手動執行 sweep 檢查回傳的 `configured / attempted / sent / retryable / failed` 數字；回傳內容不包含 Token 或 LINE User ID。LINE 對已封鎖／未加好友等部分情況仍可能回 `200`，因此 `sent` 代表 LINE Platform 已接受請求，不保證裝置端實際顯示。

### 1.2 接收 MembershipSystem 的服務分鐘同步集點

若要在 `app` 管理端發放服務分鐘時同步發點，請在 PointsCard 的 Apps Script「專案設定 → 指令碼屬性」設定：

```text
POINTS_CARD_MINUTE_GRANT_INTEGRATION_SECRET = 與 MembershipSystem app 相同的高熵隨機字串
```

管理員會在 MembershipSystem app 的服務分鐘發放視窗直接選擇本次的有效集點卡，不需要在 GAS 設定 `CARD-ID`。PointsCard 只將目前可發放的卡片清單提供給已簽章的 app GAS；所選卡片 ID 會被納入完整 HMAC payload、保存於 app 的分鐘交易，並在重試時維持不變。卡片若在發放前已過期、封存或刪除，PointsCard 會拒絕同步，讓 app 紀錄保留失敗狀態供管理員確認。端點不接受瀏覽器傳來的管理權限或 LINE token，而是驗證 app GAS 對完整 payload 產生的 HMAC、10 分鐘時效與固定 request ID。相同分鐘發放重送只會恢復同一筆 PointsCard 加點紀錄，不會重複加點。

首次同步到尚未開過 PointsCard 的 LINE 帳號時，系統會建立一筆 active 會員資料，再將點數寫入管理員選擇的卡片。首次同步成功的整合來源點數通知會交給 app 的分鐘推播統一發送，避免同一筆交易收到兩則通知。

### 2. 部署 GAS Web App

```text
Execute as: Me
Who has access: Anyone
```

GAS Web App 必須允許 LIFF 使用者連線；真正會員驗證仍由 LINE ID Token server-side verification 完成。

把 `/exec` URL 寫入 `shared/config.json`。

### 3. 設定 LIFF

- 在 `shared/config.json` 分別設定 `USER_LIFF_ID` 與 `ADMIN_LIFF_ID`；舊版 `LIFF_ID` 僅作為用戶端設定的相容 fallback。
- 用戶端 LIFF Endpoint URL 指向部署後的 `PointsCard/user/`（或 `PointsCard/user/index.html`）。
- 管理端 LIFF Endpoint URL 指向部署後的 `PointsCard/admin/`（或 `PointsCard/admin/index.html`）。
- 在 LINE 中分別使用 `https://liff.line.me/{USER_LIFF_ID}` 與 `https://liff.line.me/{ADMIN_LIFF_ID}` 開啟兩端，不要把管理端路徑接在用戶端 LIFF URL 後方。
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
npm --prefix PointsCard ci
npm --prefix PointsCard run build:liff
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

`card-delete-revocation.test.js` 驗證刪卡會封存卡片、撤銷 active 集點 QR，且不刪除會員進度、交易與票券資料。

`ticket-expiry-reminder.test.js` 驗證舊票券設定相容、取得時間與到期時間計算、到期拒絕核銷、LINE retry key、提醒 Secret 邊界及排程設定。

Repository 測試只代表 source 語法與契約；GAS `/exec`、LINE Verify、Script Properties 與 LIFF 實機掃碼仍須在部署後做整合驗證。
