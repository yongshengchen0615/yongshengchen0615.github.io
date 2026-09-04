# Member System

獨立的會員卡、集點卡與活動票券 LIFF 用戶端，以及共用一個 HTML/CSS/JS 的管理端。資料由 Google Apps Script Web App 寫入 Google Sheets。

## 目錄

```text
Member/
├── index.html                 # 入口
├── config.json                # 僅放公開設定
├── member/                    # 會員卡用戶端（獨立 HTML/CSS/JS）
├── points/                    # 集點卡用戶端（獨立 HTML/CSS/JS）
├── event/                     # 活動票券用戶端（獨立 HTML/CSS/JS）
├── admin/                     # 會員卡、集點卡與活動票券共用管理端（單一 HTML/CSS/JS）
├── shared/common.js           # 共用 LIFF 初始化、API transport、格式化工具
├── gas/                       # Apps Script Web App
└── tests/                     # 本地結構與安全契約測試
```

## 初始化 GAS

1. 建立一個 Apps Script 專案，把 `gas/` 內的 `.gs` 與 `appsscript.json` 放在同一個專案。
2. 在 Apps Script → Project Settings → Script properties 設定：
   - `MEMBERSHIP_MEMBER_LINE_CHANNEL_ID`：會員卡 LIFF 所屬 LINE Login Channel ID，例如 `2010787602`
   - `MEMBERSHIP_POINTS_LINE_CHANNEL_ID`：集點卡 LIFF 所屬 LINE Login Channel ID，例如 `2010787602`
   - `MEMBERSHIP_ADMIN_LINE_CHANNEL_ID`：Admin LIFF 所屬 LINE Login Channel ID
   - `MEMBERSHIP_EVENT_LINE_CHANNEL_ID`：活動票券 LIFF 所屬 LINE Login Channel ID
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

注意：LIFF ID 格式通常是 `ChannelID-識別碼`。GAS Script Property 要填前面的純數字 Channel ID，不要填完整的 LIFF ID；兩個不同 LIFF 如果屬於同一個 Channel，Member 與 Points 的 Channel Property 可以填相同數字。

## Google Sheets 資料表

GAS 會建立並維護以下 schema：

- `Members`：會員身份、會員編號、狀態、登入時間，以及首次登入填寫的生日與電話；舊有的 `tier` 欄位僅供相容，會員顯示等級一律由累積消費服務時間計算。
- `Admins`：管理端授權。第一次登入只會建立 `role=none`、`status=pending`，手動改成 `admin` / `active` 後才能進入。
- `PointCards`：集點卡設定、相容用的最後回饋文字、公開狀態、識別色與使用期限；集點卡採持續累積的兌換制，不再以卡片完成點數作為上限。封存會保留這些資料；永久刪除則會移除它與相依紀錄。
- `PointCardTicketTemplates`：管理端票券庫；統一管理票券名稱、類型、票券說明、使用方式、使用說明與抽獎獎項。
- `PointCardRewards`：每張集點卡的節點設定；只保存需要集到的點數與選取的票券 ID，兌換時會扣除相同點數。試算表中的舊 `consume_stamps` 欄位僅為相容保留，不再作為設定或扣點依據。
- `PointCardLotteryPrizes`：舊版抽獎券節點的獎項資料，保留相容與歷史讀取；新抽獎券的獎項設定儲存在票券庫。
- `PointCardTickets`：會員達成節點後產生的優惠券/抽獎券快照；保存當下的票券說明、使用方式、使用說明、達標點數、抽獎結果與核銷歷史。兌換扣點一律依達標點數計算。
- `PointCardTicketChallenges`：舊版票券選號挑戰的歷史資料表；新流程不再寫入。
- `EventTickets`：活動票券設定；保存名稱、類型、說明、使用方式、活動期間、發放上限、可領取與使用的會員等級、狀態與抽獎獎項。
- `EventTicketClaims`：會員領取的活動票券快照；每位會員每張活動票券限領一次，保留使用結果與歷史紀錄。
- `PointBalances`：每位會員在每張卡的目前餘額。
- `PointEntries`：每次補登點數的不可變流水紀錄，以及用來避免同一發點操作重複寫入的 request ID。
- `ServiceTimeEntries`：管理端登錄的消費服務時間不可變流水；每筆帶有管理員、備註與 request ID，會員卡顯示其累積分鐘數。
- `MembershipTierSettings`：四個固定會員等級（一般、銀級、金級、白金）的升級門檻；一般會員固定從 0 分鐘開始，其餘三個門檻必須依序遞增。
- `AuditLogs`：管理端會員/卡片/集點操作紀錄。

所有 Sheet 寫入會將以 `=`, `+`, `-`, `@` 開頭的文字轉成純文字，避免公式注入；管理端更新會以 `expectedUpdatedAt` 做 optimistic concurrency control。

## API actions

- `user.member.bootstrap`（Member LIFF）
- `user.member.profile.save`（Member LIFF；首次填寫生日與電話）
- `user.pointcard.bootstrap`（Points LIFF）
- `admin.bootstrap`
- `admin.members.list`（支援 `memberPage`、`memberPageSize`、`memberQuery`；每頁最多 100 筆）
- `admin.pointcards.list`
- `admin.member.update`
- `admin.member-tiers.save`
- `admin.pointcards.save`
- `admin.pointcards.archive`（封存集點卡，保留歷史資料）
- `admin.pointcards.delete`（永久刪除集點卡與相依資料）
- `admin.pointcards.remove`（舊版相容別名，等同封存）
- `admin.tickets.save`
- `admin.stamps.add`
- `admin.service_minutes.add`
- `admin.member-grants.add`（管理端合併發放；可一次寫入集點、服務時間或兩者）
- `user.pointcard.ticket.redeem`
- `user.event.bootstrap`（Event LIFF）
- `user.event.ticket.claim`（Event LIFF；每位會員每張限領一次）
- `user.event.ticket.redeem`（Event LIFF；本人直接使用）
- `admin.event-tickets.save`
- `admin.event-tickets.delete`（刪除活動票券設定；保留已領取的票券快照與稽核紀錄）

`admin.tickets.save` 管理獨立票券庫。每張票券都需要票券說明、使用方式與使用說明；抽獎券可設定多個 `{ prizeTitle, prizeDescription, winRate }`，各獎項機率可為 0–100%，合計必須正好 100%。`admin.pointcards.save` 的 `card.rewards` 是兌換節點陣列：每個節點的 `thresholdStamps`（需要集到的點數）必須唯一且為 1–100 的整數，並以 `ticketTemplateId` 選擇票券庫中的票券；兌換時會自動扣除相同的 `thresholdStamps` 點數。集點卡會持續累積，不存在會員端顯示的點數上限。舊版直接傳入票券內容的節點仍可相容處理。

`admin.event-tickets.save` 沿用集點卡票券的名稱、類型、說明、使用方式、使用說明與抽獎獎項設定，另外可設定活動起訖日、總發放上限（0 代表不限量）與可領取／使用的會員等級（一般、銀級、金級、白金可複選）。既有活動票券沒有等級設定時，會相容地視為所有等級都可使用。Event LIFF 只顯示啟用中的活動；即使會員目前等級不適用，仍會顯示票券、適用等級與「目前會員等級無法領取或使用」提示；後端也會在領取與核銷時強制檢查。會員先領取票券，再由本人確認使用。票券內容在領取時建立快照，之後管理端修改設定不會改寫已領取的票券。刪除活動票券會立即停止新領取與使用，並保留既有 `EventTicketClaims` 快照和稽核紀錄。

升級後，既有集點節點與已發出的票券都會保留。新增或調整節點後，已達門檻、且尚無未使用票券的會員會在下次集點卡同步時補發一次；已發出的票券仍維持原本的票券內容快照，但扣點一律依其達標點數計算。若要讓既有節點使用新的統一票券說明，先在「票券」建立並啟用票券，再回到該集點卡為節點選擇它。

會員端的「票券總覽」會顯示該集點卡設定的所有票券，即使尚未達標也會顯示解鎖所需點數。抽獎券會列出「有機會獲得」的所有獎項（包含設定為 0% 的獎項），但不會顯示任何機率。已取得且點數足夠的票券，會先顯示票券說明、使用方式與使用說明，再由本人按下「確認使用這張票券」才會核銷。後端仍檢查票券所屬會員、集點卡狀態/期限、目前餘額與一次性使用狀態。核銷成功會依該票券的 `thresholdStamps` 扣除點數並寫入負數流水紀錄；抽獎券由後端開獎，會員端播放動畫且只顯示獎項名稱，不顯示機率。已使用票券不再回傳給會員端，後端歷史紀錄仍保留。

集點卡的 `expiryMode` 可設為 `unlimited` 或 `date`；使用 `date` 時需提供 `expiresOn`（`YYYY-MM-DD`）。到期後停止新增點數與票券核銷。管理端的「封存集點卡」會讓會員端與會員票券畫面同步隱藏，但所有資料仍保留；「永久刪除」需經兩次確認，會移除卡片、節點、節點獎項、會員票券、餘額、點數流水、舊挑戰資料與對應稽核紀錄。共用票券庫不會因刪除單一集點卡而移除。

會員第一次開啟會員卡必須填寫生日與電話；這些個資只保存在 `Members`，並只回傳給已驗證的本人會員卡顯示，管理端名冊不會取得生日或電話。會員等級不再由管理端逐一設定：系統會將 `ServiceTimeEntries` 的分鐘數加總，依 `MembershipTierSettings` 自動套用一般、銀級、金級或白金會員。初始門檻是一般 0、銀級 600、金級 1800、白金 3600 分鐘，管理端可調整銀級、金級與白金的門檻；四個等級會立即依新門檻重新計算。管理端的「發放」視窗可勾選集點、服務時間或兩者並同時提交；發點需要選擇啟用中的集點卡與 1–100 點，服務時間可登錄 1–1440 分鐘，所有表面都會以分鐘顯示累積服務時間。合併發放與原本個別發放同樣攜帶單次 request ID，重送同一操作不會重複寫入。

前端以 `text/plain` JSON POST，避免不必要的 CORS preflight。讀取資料若遇到暫時性網路或非 JSON 回應，會等待後自動再試一次；寫入操作不會自動重送，以免重複異動。若寫入回應無法確認，受影響操作會鎖定並提供「重新整理確認」，避免使用者直接重送；管理端在寫入成功後若僅畫面同步失敗，會明確提示「資料已更新」並要求重新整理，而不誤報寫入失敗；ID token 只存在目前頁面的記憶體，未寫入 URL、localStorage、sessionStorage、Sheet、log 或 API cache value。

為避免首頁同步隨資料量增加而重複掃描相同 Sheet，Points bootstrap 會先讀取一次卡片、獎勵、票券範本、餘額與已發票券的快照，並建立會員／集點卡索引；只有真的需要補發票券時，才會取得資料鎖後重讀快照，避免純讀取互相排隊且仍防止重複發券。會員卡的單一會員服務時數會快取 120 秒，系統寫入服務時間時立即失效；管理端會員名冊只傳送目前頁面的資料，避免大量會員同時傳輸與渲染。所有 API 的 schema 驗證也會依 Spreadsheet 與 schema 指紋快取 120 秒；schema 變更會自動使用新指紋重新驗證。

## 本地驗證

在 repository root 執行：

```bash
node --test Member/tests/*.test.js
```

這些測試驗證檔案結構、LIFF/GAS 合約、資料表 schema、CSP 與 token 不落地等不變量。實際 LINE 登入、GAS Web App 與 Spreadsheet 仍需部署後做 integration verification；本次不會自動 deploy。
