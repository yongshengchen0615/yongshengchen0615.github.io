# Member System

獨立的會員卡與集點卡 LIFF 用戶端，以及共用一個 HTML/CSS/JS 的管理端。資料由 Google Apps Script Web App 寫入 Google Sheets。

## 目錄

```text
Member/
├── index.html                 # 入口
├── config.json                # 僅放公開設定
├── member/                    # 會員卡用戶端（獨立 HTML/CSS/JS）
├── points/                    # 集點卡用戶端（獨立 HTML/CSS/JS）
├── admin/                     # 會員卡與集點卡共用管理端（單一 HTML/CSS/JS）
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
   - `MEMBERSHIP_SYSTEM_SPREADSHEET_ID`：選填；不填時會依序使用目前綁定的 Spreadsheet，或建立 `Lumen Club Membership Data`
3. 執行 `setupMembershipSystem()` 完成授權與資料表建立。
4. Deploy → New deployment → Web app：Execute as 選自己、Who has access 選 Anyone。
5. 將部署後 `/exec` URL、Member LIFF ID、Points LIFF ID、Admin LIFF ID 填入 `config.json`；Member 與 Points 必須是不同的 LIFF app。

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

Member、Points 與 Admin 使用不同 LIFF/LINE Login Channel。三者至少需要 `openid` scope，讓前端取得 `liff.getIDToken()`；在 LINE 內建 LIFF browser 中，每次由 `liff.init()` 自動確認登入，在外部瀏覽器中每次開啟都會先清除既有 LIFF session，再重新 `liff.login()`。登入回跳只使用一次性的 URL flow marker，不保存 ID token。GAS 會依照 request action 將 token 綁定到對應 Channel，再驗證 `aud`、`iss`、`exp` 與 `sub`。

注意：LIFF ID 格式通常是 `ChannelID-識別碼`。GAS Script Property 要填前面的純數字 Channel ID，不要填完整的 LIFF ID；兩個不同 LIFF 如果屬於同一個 Channel，Member 與 Points 的 Channel Property 可以填相同數字。

## Google Sheets 資料表

GAS 會建立並維護以下 schema：

- `Members`：會員身份、會員編號、等級、狀態與登入時間。
- `Admins`：管理端授權。第一次登入只會建立 `role=none`、`status=pending`，手動改成 `admin` / `active` 後才能進入。
- `PointCards`：集點卡設定、相容用的最後回饋文字、公開狀態、識別色與使用期限；集點卡採持續累積的兌換制，不再以卡片完成點數作為上限。封存會保留這些資料；永久刪除則會移除它與相依紀錄。
- `PointCardTicketTemplates`：管理端票券庫；統一管理票券名稱、類型、票券說明、使用方式、使用說明與抽獎獎項。
- `PointCardRewards`：每張集點卡的節點設定；只保存需要集到的點數、兌換消耗點數與選取的票券 ID。既有直接設定的舊節點仍可讀取。
- `PointCardLotteryPrizes`：舊版抽獎券節點的獎項資料，保留相容與歷史讀取；新抽獎券的獎項設定儲存在票券庫。
- `PointCardTickets`：會員達成節點後產生的優惠券/抽獎券快照；保存當下的票券說明、使用方式、使用說明、兌換消耗點數、抽獎結果與核銷歷史。
- `PointCardTicketChallenges`：舊版票券選號挑戰的歷史資料表；新流程不再寫入。
- `PointBalances`：每位會員在每張卡的目前餘額。
- `PointEntries`：每次補登點數的不可變流水紀錄，以及用來避免同一發點操作重複寫入的 request ID。
- `AuditLogs`：管理端會員/卡片/集點操作紀錄。

所有 Sheet 寫入會將以 `=`, `+`, `-`, `@` 開頭的文字轉成純文字，避免公式注入；管理端更新會以 `expectedUpdatedAt` 做 optimistic concurrency control。

## API actions

- `user.member.bootstrap`（Member LIFF）
- `user.pointcard.bootstrap`（Points LIFF）
- `admin.bootstrap`
- `admin.members.list`
- `admin.pointcards.list`
- `admin.member.update`
- `admin.pointcards.save`
- `admin.pointcards.archive`（封存集點卡，保留歷史資料）
- `admin.pointcards.delete`（永久刪除集點卡與相依資料）
- `admin.pointcards.remove`（舊版相容別名，等同封存）
- `admin.tickets.save`
- `admin.stamps.add`
- `user.pointcard.ticket.redeem`

`admin.tickets.save` 管理獨立票券庫。每張票券都需要票券說明、使用方式與使用說明；抽獎券可設定多個 `{ prizeTitle, prizeDescription, winRate }`，各獎項機率可為 0–100%，合計必須正好 100%。`admin.pointcards.save` 的 `card.rewards` 是兌換節點陣列：每個節點的 `thresholdStamps`（需要集到的點數）必須唯一且為 1–100 的整數，`consumeStamps`（兌換消耗點數）必須為 1 點以上且不可超過 `thresholdStamps`，並以 `ticketTemplateId` 選擇票券庫中的票券。集點卡會持續累積，不存在會員端顯示的點數上限。舊版直接傳入票券內容的節點仍可相容處理。

升級後，既有集點節點與已發出的票券都會保留。若要讓既有節點使用新的統一票券說明，先在「票券」建立並啟用票券，再回到該集點卡為節點選擇它。

會員端的「票券總覽」會顯示該集點卡設定的所有票券，即使尚未達標也會顯示解鎖所需點數。抽獎券會列出「有機會獲得」的所有獎項（包含設定為 0% 的獎項），但不會顯示任何機率。已取得且點數足夠的票券，會先顯示票券說明、使用方式與使用說明，再由本人按下「確認使用這張票券」才會核銷。後端仍檢查票券所屬會員、集點卡狀態/期限、目前餘額與一次性使用狀態。核銷成功會依 `consumeStamps` 扣除點數並寫入負數流水紀錄；抽獎券由後端開獎，會員端播放動畫且只顯示獎項名稱，不顯示機率。已使用票券不再回傳給會員端，後端歷史紀錄仍保留。

集點卡的 `expiryMode` 可設為 `unlimited` 或 `date`；使用 `date` 時需提供 `expiresOn`（`YYYY-MM-DD`）。到期後停止新增點數與票券核銷。管理端的「封存集點卡」會讓會員端與會員票券畫面同步隱藏，但所有資料仍保留；「永久刪除」需經兩次確認，會移除卡片、節點、節點獎項、會員票券、餘額、點數流水、舊挑戰資料與對應稽核紀錄。共用票券庫不會因刪除單一集點卡而移除。

前端以 `text/plain` JSON POST，避免不必要的 CORS preflight。讀取資料若遇到暫時性網路或非 JSON 回應，會等待後自動再試一次；寫入操作不會自動重送，以免重複異動。管理端在寫入成功後若僅畫面同步失敗，會明確提示「資料已更新」並要求重新整理，而不誤報寫入失敗；發點操作會攜帶單次 request ID，重送同一操作不會重複加點。ID token 只存在目前頁面的記憶體，未寫入 URL、localStorage、sessionStorage、Sheet、log 或 API cache value。

為避免首頁同步隨資料量增加而重複掃描相同 Sheet，Points bootstrap 會在資料鎖定期間讀取一次卡片、獎勵、票券範本、餘額與已發票券的快照，並以同一份快照完成票券補發與回應。所有 API 的 schema 驗證也會依 Spreadsheet 與 schema 指紋快取 120 秒；schema 變更會自動使用新指紋重新驗證。

## 本地驗證

在 repository root 執行：

```bash
node --test Member/tests/*.test.js
```

這些測試驗證檔案結構、LIFF/GAS 合約、資料表 schema、CSP 與 token 不落地等不變量。實際 LINE 登入、GAS Web App 與 Spreadsheet 仍需部署後做 integration verification；本次不會自動 deploy。
