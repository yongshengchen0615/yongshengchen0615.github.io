# Member System

會員卡、集點卡、活動票券、日曆與管理端各自獨立的 LIFF 前端。資料由 Google Apps Script Web App 寫入 Google Sheets。

## 目錄

```text
Member/
├── index.html                 # 入口
├── config.json                # 僅放公開設定
├── member/                    # 會員卡：自己的 HTML/CSS/JS、LIFF transport、進度元件
├── points/                    # 集點卡：自己的 HTML/CSS/JS、LIFF transport、進度元件
├── event/                     # 活動票券：自己的 HTML/CSS/JS、LIFF transport、進度元件
├── calendar/                  # 日曆：自己的 HTML/CSS/JS、LIFF transport、進度元件
├── admin/                     # 管理端：自己的 HTML/CSS/JS 與 LIFF transport
├── gas/                       # Apps Script Web App
└── tests/                     # 本地結構與安全契約測試
```

每個 LIFF 資料夾自行持有 UI 基線與 LIFF transport，不再從 `shared/` 載入前端程式。手機採用安全區邊距、44px 以上的主要觸控目標與 16px 表單文字；每個頁面的既有視覺主題和 API 合約維持不變。

## 日曆功能

日曆沿用管理端的日期資料，但會員端是獨立的 calendar HTML、CSS 與 JavaScript。管理端以月曆作為唯一入口：點選空白日期可在小視窗新增休假日或活動，點選日期內既有項目可開啟編輯；勾選月曆日期可批次新增，勾選既有項目可批次修改或刪除，不再顯示「所有日期」清單。每筆可設定單日或最長 366 天的跨日區間、說明、識別色與公開狀態。活動可逐筆設定可參加的會員階級（一般、銀級、金級、白金），也可選填連結名稱與 HTTPS 網址；會員會在活動詳情中開啟連結，休假日不套用這些設定。會員端會保留顯示活動與其適用階級，並由伺服器以服務時數推導目前階級標示是否可參加，避免瀏覽器自行宣稱資格。未設定此欄位的既有活動相容為所有階級可參加；已寫入但無效的設定不會被放寬。管理端可一次新增或修改最多 20 筆，亦可勾選多筆既有日期後批次刪除；伺服器會先驗證整批資料與版本，再開始寫入。只有啟用中的日期會顯示在會員日曆；每次開啟都會先從 GAS 讀取全部啟用日期與完整說明，再顯示月曆，切換月份不再送出讀取請求。會員可用月曆按鈕切換；手機可水平滑動，桌面使用月曆按鈕換月，滑鼠滾輪一律保留給頁面垂直捲動。會員點擊有項目的日期時，會在小視窗中逐一查看已載入的完整說明、活動參加階級與活動連結；彈窗不顯示休假日或活動類型標記。日曆與會員卡、集點卡、活動票券都各自在本機前端載入會員階級進度元件，只顯示目前階級、累積服務分鐘、下一階段門檻、所需分鐘與進度條，並套用目前會員卡相同的伺服器推導樣式。

日曆用戶端需要自己的 Calendar LIFF。部署前需在 config.json 的 calendarLiffId 填入該 LIFF ID，並在 GAS Script properties 設定 MEMBERSHIP_CALENDAR_LINE_CHANNEL_ID 為其所屬的純數字 LINE Channel ID。Calendar LIFF Endpoint URL 為 https://<your-pages-host>/MembershipSystem/Member/calendar/。

第一次執行 setupMembershipSystem() 或部署更新後，系統會建立 CalendarItems 資料表。欄位包含日期項目 ID、名稱、類型、說明、起訖日、狀態、識別色、活動適用會員階級、活動連結名稱、活動連結網址與建立／更新稽核欄位。相關 API action 為 user.calendar.bootstrap、user.calendar.date.details、admin.calendar-items.save、admin.calendar-items.delete 與 admin.calendar-items.batch；所有管理端寫入 action 僅限已授權的管理員。

## 初始化 GAS

1. 建立一個 Apps Script 專案，把 `gas/` 內的 `.gs` 與 `appsscript.json` 放在同一個專案。
2. 在 Apps Script → Project Settings → Script properties 設定：
   - `MEMBERSHIP_MEMBER_LINE_CHANNEL_ID`：會員卡 LIFF 所屬 LINE Login Channel ID，例如 `2010787602`
   - `MEMBERSHIP_POINTS_LINE_CHANNEL_ID`：集點卡 LIFF 所屬 LINE Login Channel ID，例如 `2010787602`
   - `MEMBERSHIP_ADMIN_LINE_CHANNEL_ID`：Admin LIFF 所屬 LINE Login Channel ID
   - `MEMBERSHIP_EVENT_LINE_CHANNEL_ID`：活動票券 LIFF 所屬 LINE Login Channel ID
   - `MEMBERSHIP_LINE_CHANNEL_ACCESS_TOKEN`：選填；LINE Official Account Messaging API 的 Channel access token，只放 GAS Script properties，用於管理端發放後推播通知
   - `MEMBERSHIP_SYSTEM_SPREADSHEET_ID`：選填；設定後固定使用此 Spreadsheet，不設定時才會使用目前綁定的 Spreadsheet，或建立 `Lumen Club Membership Data`
3. 執行 `setupMembershipSystem()` 完成授權與資料表建立。
4. Deploy → New deployment → Web app：Execute as 選自己、Who has access 選 Anyone。
5. 將部署後 `/exec` URL、Member LIFF ID、Points LIFF ID、Event LIFF ID、Admin LIFF ID 填入 `config.json`；四個 LIFF 必須是不同的 LIFF app。

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

Event LIFF Endpoint URL：

```text
https://<your-pages-host>/MembershipSystem/Member/event/
```

Member、Points、Event 與 Admin 使用不同 LIFF；各 surface 的 LIFF 可依 LINE 設定使用相同或不同 Channel，但 GAS Script Property 必須填入該 LIFF 所屬的 Channel ID。四者至少需要 `openid` scope，讓前端取得 `liff.getIDToken()`；在 LINE 內建 LIFF browser 中，每次由 `liff.init()` 自動確認登入，在外部瀏覽器中每次開啟都會先清除既有 LIFF session，再重新 `liff.login()`。登入回跳只使用一次性的 URL flow marker，不保存 ID token。GAS 會依照 request action 將 token 綁定到對應 Channel，再驗證 `aud`、`iss`、`exp` 與 `sub`。

## 建立新環境前清除資料

在 Apps Script 編輯器手動執行 `resetMembershipSystemDataForNewEnvironment()`，可清除所有系統資料表的資料列，包含會員、管理員、集點卡、票券、流水與稽核紀錄。此操作不可復原；不會刪除 Spreadsheet、欄位標題、欄位設定、Script Properties 或 LIFF 設定，也不會開放為 Web API。執行後會只重建一般 0、銀級 600、金級 1800、白金 3600 分鐘的預設會員等級門檻，方便直接建立新的測試或正式環境。

注意：LIFF ID 格式通常是 `ChannelID-識別碼`。GAS Script Property 要填前面的純數字 Channel ID，不要填完整的 LIFF ID；兩個不同 LIFF 如果屬於同一個 Channel，Member 與 Points 的 Channel Property 可以填相同數字。

## Google Sheets 資料表

GAS 會建立並維護以下 schema：

- `Members`：會員身份、會員編號、狀態、登入時間，以及首次登入填寫的生日與電話；`membership_status` 為新登入使用者的加入狀態，完成會員資料後才會變成 `active`。舊有資料沒有此欄位時相容視為已加入；舊有的 `tier` 欄位僅供相容，會員顯示等級一律由累積消費服務時間計算。
- `Admins`：管理端授權。第一次登入只會建立 `role=none`、`status=pending`，手動改成 `admin` / `active` 後才能進入。
- `PointCards`：集點卡設定、相容用的最後回饋文字、公開狀態、10 種固定卡面樣式、識別色、使用期限與 `sort_order`；會員端依排序數字由小到大顯示，相同排序依建立時間。集點卡採持續累積的兌換制，不再以卡片完成點數作為上限。封存會保留這些資料；永久刪除則會移除它與相依紀錄。
- `PointCardTicketTemplates`：管理端票券庫；統一管理票券名稱、類型、票券說明、使用方式、使用說明與抽獎獎項。
- `PointCardRewards`：每張集點卡的節點設定；只保存需要集到的點數與選取的票券 ID，兌換時會扣除相同點數。試算表中的舊 `consume_stamps` 欄位僅為相容保留，不再作為設定或扣點依據。
- `PointCardLotteryPrizes`：舊版抽獎券節點的獎項資料，保留相容與歷史讀取；新抽獎券的獎項設定儲存在票券庫。
- `PointCardTickets`：會員達成節點後產生的優惠券/抽獎券快照；保存當下的票券說明、使用方式、使用說明、達標點數、抽獎結果與核銷歷史。兌換扣點一律依達標點數計算。
- `PointCardTicketChallenges`：舊版票券選號挑戰的歷史資料表；新流程不再寫入。
- `EventTickets`：活動票券設定；保存名稱、類型、說明、使用方式、活動期間、發放上限、可領取與使用的會員等級、狀態與抽獎獎項。每張票券各自保存等級設定；會員端會看到所有啟用中的活動票券，並標示目前等級是否適用。
- `EventTicketClaims`：會員領取的活動票券快照；每位會員每張活動票券限領一次，保留使用結果與歷史紀錄。
- `PointBalances`：每位會員在每張卡的目前餘額。
- `PointEntries`：點數不可變流水紀錄；管理端發點保留 request ID，票券核銷則以 `entry_type`、`reference_type`、`reference_id` 明確連回對應票券，避免同一次核銷被解讀成兩筆消耗。
- `PointMutations`：集點發放與票券核銷的可恢復異動日誌。每次異動先記錄固定操作識別、異動前後餘額、流水識別與票券結果，再逐步完成餘額、流水、票券與稽核；中途失敗時會由同一請求或會員下次開啟 Points LIFF 補完，不會再次扣點或重複加點。
- `ServiceTimeEntries`：管理端登錄的消費服務時間不可變流水；每筆帶有管理員、備註與 request ID，會員卡顯示其累積分鐘數。
- `LineNotificationLogs`：管理端合併發放後的 LINE 官方帳號通知狀態；以合併發放 request ID 去重，不保存 Channel access token。
- `MembershipTierSettings`：四個固定會員等級（一般、銀級、金級、白金）的升級門檻與會員卡樣式；一般會員固定從 0 分鐘開始，其餘三個門檻必須依序遞增。會員卡樣式使用固定白名單：森林綠、午夜藍、海灣青、夕陽橘、薰衣草紫、玫瑰粉、金曜棕、鉑金灰、薄荷綠、櫻桃紅。
- `AuditLogs`：管理端會員/卡片/集點操作紀錄。

所有 Sheet 寫入會將以 `=`, `+`, `-`, `@` 開頭的文字轉成純文字，避免公式注入；管理端更新會以 `expectedUpdatedAt` 做 optimistic concurrency control。

## API actions

- `user.member.bootstrap`（Member LIFF）
- `user.member.profile.save`（Member LIFF；首次填寫生日與電話）
- `user.pointcard.bootstrap`（Points LIFF）
- `user.pointcard.detail`（舊版相容 API；目前 Points LIFF 由完整 bootstrap 載入所有可見卡片明細與票券）
- `admin.bootstrap`
- `admin.members.list`（支援 `memberPage`、`memberPageSize`、`memberQuery`；每頁最多 100 筆）
- `admin.pointcards.list`
- `admin.event-tickets.list`
- `admin.calendar-items.list`
- `admin.summary`
- `admin.member.update`
- `admin.member-tiers.save`
- `admin.pointcards.save`
- `admin.pointcards.reorder`（管理端以卡片控制調整會員端顯示順序）
- `admin.pointcards.archive`（封存集點卡，保留歷史資料）
- `admin.pointcards.delete`（永久刪除集點卡與相依資料）
- `admin.pointcards.remove`（舊版相容別名，等同封存）
- `admin.tickets.save`
- `admin.stamps.add`
- `admin.service_minutes.add`
- `admin.member-grants.add`（管理端合併發放；`points` 可傳多列 `{ cardId, amount }`，可一次寫入不同集點卡、服務時間或兩者；設定 Channel access token 後會推播 LINE 官方帳號通知）
- `user.pointcard.ticket.redeem`
- `user.event.bootstrap`（Event LIFF）
- `user.event.ticket.detail`（舊版相容 API；目前 Event LIFF 由完整 bootstrap 載入所有可見票券說明與獎項）
- `user.event.ticket.claim`（Event LIFF；每位會員每張限領一次）
- `user.event.ticket.redeem`（Event LIFF；本人直接使用）
- `admin.event-tickets.save`
- `admin.event-tickets.delete`（刪除活動票券設定；保留已領取的票券快照與稽核紀錄）
- `user.calendar.date.details`（舊版相容 API；目前 Calendar LIFF 由完整 bootstrap 載入全部啟用日期的完整項目）
- `admin.calendar-items.batch`（一次新增／修改／刪除最多 20 筆日曆項目）

所有用戶端功能都需要已加入會員。新使用者開啟 Points、Event 或 Calendar LIFF 時，伺服器會回傳 `MEMBERSHIP_REQUIRED`，畫面會提供「前往加入會員」按鈕；使用者先在 Member LIFF 填寫生日與電話完成加入後，才能使用其他用戶端功能。這項檢查也會套用到集點卡票券核銷與活動票券領取／使用，不能只靠前端繞過。活動票券使用紀錄與集點卡相同，預設以條列收合，點擊展開後顯示首次完整載入的所有紀錄，仍可點開查看票券快照與抽獎結果。

管理端合併發放的 `points` 可使用陣列同時指定多張不同集點卡與各自點數，例如 `[{ cardId: "PC-A", amount: 2 }, { cardId: "PC-B", amount: 5 }]`。所有發點 action 現在都必須提供 16–100 字元的 request ID；同一個 request ID 會讓點數、服務時間與通知都保持冪等。若要啟用 LINE 官方帳號推播，請將 Official Account Messaging API token 放在 `MEMBERSHIP_LINE_CHANNEL_ACCESS_TOKEN`；token 不可放入公開 `config.json`。本地測試不會送出真實推播，部署後仍需用測試會員確認官方帳號與 LINE Login 使用者已正確連結。

`admin.tickets.save` 管理獨立票券庫。每張票券都需要票券說明、使用方式與使用說明；抽獎券可設定多個 `{ prizeTitle, prizeDescription, winRate }`，各獎項機率可為 0–100%，合計必須正好 100%。`admin.pointcards.save` 的 `card.rewards` 是兌換節點陣列：每個節點的 `thresholdStamps`（需要集到的點數）必須唯一且為 1–100 的整數，並以 `ticketTemplateId` 選擇票券庫中的票券；兌換時會自動扣除相同的 `thresholdStamps` 點數。集點卡會持續累積，不存在會員端顯示的點數上限。舊版直接傳入票券內容的節點仍可相容處理。

`admin.event-tickets.save` 沿用集點卡票券的名稱、類型、說明、使用方式、使用說明與抽獎獎項設定，另外可設定活動起訖日與總發放上限（0 代表不限量）。每張活動票券的編輯區都會各自設定可領取／使用的會員等級（一般、銀級、金級、白金可複選），不會共用其他票券的設定；既有活動票券沒有等級設定時，會相容地視為所有等級都可使用。Event LIFF 只顯示啟用中的活動；即使會員目前等級不適用，仍會顯示票券、適用等級與「目前會員等級無法領取或使用」提示；後端也會在領取與核銷時強制檢查。會員先領取票券，再由本人確認使用。抽獎活動票券沿用集點卡抽獎券的機率驗證、伺服器開獎、結果保存與前端揭曉動畫。票券內容在領取時建立快照，之後管理端修改設定不會改寫已領取的票券。使用完成的票券會從目前活動清單移到「已使用紀錄」，即使管理端之後封存或刪除活動設定，會員仍可查看票券快照與抽獎結果；刪除活動票券會立即停止新領取與使用，並保留既有 `EventTicketClaims` 快照和稽核紀錄。

升級後，既有集點節點與已發出的票券都會保留。新增或調整節點後，已達門檻、且尚無未使用票券的會員會在下次集點卡同步時補發一次；已發出的票券仍維持原本的票券內容快照，但扣點一律依其達標點數計算。若要讓既有節點使用新的統一票券說明，先在「票券」建立並啟用票券，再回到該集點卡為節點選擇它。

會員端的「票券總覽」會顯示該集點卡設定的所有票券，即使尚未達標也會顯示解鎖所需點數。抽獎券會列出「有機會獲得」的所有獎項（包含設定為 0% 的獎項），但不會顯示任何機率。已取得且點數足夠的票券，會先顯示票券說明、使用方式與使用說明，再由本人按下「確認使用這張票券」才會核銷。後端仍檢查票券所屬會員、集點卡狀態/期限、目前餘額與一次性使用狀態。核銷成功會依該票券的 `thresholdStamps` 扣除點數並寫入負數流水紀錄；抽獎券由後端開獎，會員端播放動畫且只顯示獎項名稱，不顯示機率。重送已完成的同一票券核銷會回傳原本結果，不會再次扣點。票券使用紀錄預設收合，完整 API 回應會傳回所有明細與完整筆數。

集點卡的 `expiryMode` 可設為 `unlimited` 或 `date`；使用 `date` 時需提供 `expiresOn`（`YYYY-MM-DD`）。到期後停止新增點數與票券核銷。管理端的「封存集點卡」會讓會員端與會員票券畫面同步隱藏，但所有資料仍保留；「永久刪除」需經兩次確認，會移除卡片、節點、節點獎項、會員票券、餘額、點數流水、舊挑戰資料與對應稽核紀錄。共用票券庫不會因刪除單一集點卡而移除。

會員第一次開啟會員卡必須填寫生日與電話；這些個資只保存在 `Members`，並只回傳給已驗證的本人會員卡顯示，管理端名冊不會取得生日或電話。會員卡會將會員識別／聯絡資料與升等進度分開顯示；所有會員端都會醒目顯示目前會員資格、下一個資格及尚需累積的服務分鐘數。會員等級不再由管理端逐一設定：系統會將 `ServiceTimeEntries` 的分鐘數加總，依 `MembershipTierSettings` 自動套用一般、銀級、金級或白金會員，並將該等級設定的會員卡樣式套用到會員卡與所有會員端的會員階級進度。管理端可在四個等級各自選擇 10 種固定樣式之一；舊資料沒有樣式時會使用各等級預設樣式。集點卡也可在管理端選擇同一組 10 種固定卡面樣式，舊資料沒有樣式時相容使用森林綠。初始門檻是一般 0、銀級 600、金級 1800、白金 3600 分鐘，管理端可調整銀級、金級與白金的門檻；四個等級會立即依新門檻重新計算。管理端的「發放」視窗開啟時不預先勾選發放項目、集點卡、點數或服務時間，必須由管理員明確選擇後才能提交；可勾選集點、服務時間或兩者並同時提交。發點需要選擇啟用中的集點卡與 1–100 點，服務時間可登錄 1–1440 分鐘，所有表面都會以分鐘顯示累積服務時間。合併發放與原本個別發放同樣攜帶單次 request ID，重送同一操作不會重複寫入。

前端以 `text/plain` JSON POST，避免不必要的 CORS preflight。公開設定與 API 讀取若遇到暫時性網路或非 JSON 回應，會等待後自動再試一次；讀取逾時為 20 秒，寫入逾時延長為 30 秒，且沒有 `AbortController` 的舊 WebView 也會結束等待並顯示可操作的錯誤。寫入操作仍不會自動重送，以免重複異動。管理端所有寫入、封存與刪除動作會立即顯示處理中提示，並在伺服器確認後顯示完成提示。若寫入回應無法確認，受影響操作會鎖定並提供「重新整理確認」，避免使用者直接重送；管理端在寫入成功後若僅畫面同步失敗，會明確提示「資料已更新」並要求重新整理，而不誤報寫入失敗；ID token 只存在目前頁面的記憶體，未寫入 URL、localStorage、sessionStorage、Sheet、log 或 API cache value。

Points、Event 與 Calendar 每次開啟都先完成 LINE 身分驗證，然後直接由 GAS 讀取目前的 Google Sheets 資料；不傳送也不比對資料版本、修訂版或快取範圍。Points 會在首次回應含所有可見卡片的完整節點與票券、完整使用歷史；Event 含所有可見活動票券的完整說明、獎項與完整使用歷史；Calendar 含所有啟用日期的完整項目與連結。若任何完整資料缺漏，該 LIFF 保持在載入／錯誤畫面而不會進入半完成工作區。Admin 初始回應也包含所有會員、階級、集點卡／票券、活動票券、日曆與統計資料。

GAS 的資料回應與會員服務時數不使用讀取快取，直接手動編輯 Google Sheet 後的下一次成功開啟或手動更新會立即讀取該次最新資料。只有 schema 檢查仍使用 120 秒快取，因為它不包含也不決定會員或管理資料。只有真的需要恢復異動或補發票券時，才會取得資料鎖，避免純讀取互相排隊且仍防止重複發券。為移除舊版瀏覽器快照，前端只會嘗試刪除 `MembershipSystemSyncCache`，不讀取或寫入其任何紀錄；ID token、LINE user ID、生日、電話與管理端名冊均不會落地。部署新版 GAS 後，`setupMembershipSystem()` 或第一個 API 請求會自動建立 `PointMutations`。

## 本地驗證

在 repository root 執行：

```bash
node --test Member/tests/*.test.js
```

這些測試驗證檔案結構、LIFF/GAS 合約、資料表 schema、CSP 與 token 不落地等不變量。實際 LINE 登入、GAS Web App 與 Spreadsheet 仍需部署後做 integration verification；本次不會自動 deploy。


## 2026-09-09 UI／UX 與載入優化

詳見 [優化分析、測試與部署驗收](./OPTIMIZATION-20260909.md)。本版保留 API 讀取的有界等待與同一時間的相同請求合併，但移除已完成資料的前端／GAS 快取、版本協商與按需明細讀取。所有完整 bootstrap 完成並渲染後才會進入工作畫面；寫入仍只送一次並保留結果不確定時的鎖定與確認流程。

請先更新對應 Member GAS deployment，再發布前端；兩端必須一同更新，否則新版前端會因完整 bootstrap 資料缺漏而停在錯誤畫面。既有 `deploy-membership-gas.yml` 的發布目標是另一個 `MembershipSystem/app/gas/` 路徑。
