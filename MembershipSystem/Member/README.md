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
- `PointCards`：集點卡設定、完成點數、相容用的最後回饋文字、公開狀態、識別色與使用期限。
- `PointCardRewards`：每張集點卡的節點獎勵；包含需要集到的點數、兌換消耗點數、優惠券/抽獎券類型與獎勵說明，並保留舊版 `lottery_win_rate` 欄位供相容。
- `PointCardLotteryPrizes`：抽獎券節點的多個獎項與各自中獎率；允許單一獎項為 0%，同一抽獎券的獎項機率總和必須為 100%。
- `PointCardTickets`：會員達成節點後產生的優惠券/抽獎券；保存票券狀態、兌換消耗點數、抽獎結果與核銷歷史。
- `PointCardTicketChallenges`：短效的票券核銷選號挑戰；只保存選項與狀態，不保存 Script Properties 裡的票券密碼。
- `PointBalances`：每位會員在每張卡的目前餘額。
- `PointEntries`：每次補登點數的不可變流水紀錄。
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
- `admin.pointcards.usage-code.generate`
- `admin.pointcards.remove`（封存集點卡，保留歷史資料）
- `admin.stamps.add`
- `user.pointcard.ticket.challenge`
- `user.pointcard.ticket.redeem`

`admin.pointcards.save` 的 `card.rewards` 是節點陣列。每個節點的 `thresholdStamps`（需要集到的點數）必須是唯一且不超過 `targetStamps` 的整數，`consumeStamps`（兌換消耗點數）必須為 1 點以上且不可超過 `thresholdStamps`；`rewardType` 可為 `coupon` 或 `lottery`。抽獎券節點的 `prizes` 可設定多個 `{ prizeTitle, prizeDescription, winRate }`，各獎項機率可為 0–100%，合計必須正好 100%。

管理端每張集點卡只需按一次「一鍵產生票券密碼」，GAS 會產生該卡共用的兩位數密碼並只放在 Script Properties；用戶端使用票券時會取得 5 組干擾號碼加上 1 組正確號碼，共 6 個選項。店員點選正確號碼後，後端才會以一次性、限時挑戰完成核銷；錯誤達 3 次會鎖定票券。票券達成節點後，實際使用只要目前點數足夠支付該節點的 `consumeStamps`，不要求目前餘額仍達到原本的 `thresholdStamps`；核銷成功會依獎勵的 `consumeStamps` 扣除會員點數並寫入負數流水紀錄。抽獎券再由後端依設定機率開獎，會員端播放開獎動畫且只顯示獎項名稱，不顯示機率。已使用票券不再回傳給會員端，後端歷史紀錄仍保留。

集點卡的 `expiryMode` 可設為 `unlimited` 或 `date`；使用 `date` 時需提供 `expiresOn`（`YYYY-MM-DD`）。到期後停止新增點數與票券核銷；管理端移除集點卡會封存卡片，會員端與會員票券畫面同步隱藏，資料仍保留供稽核。

前端以 `text/plain` JSON POST，避免不必要的 CORS preflight。ID token 只存在目前頁面的記憶體，未寫入 URL、localStorage、sessionStorage、Sheet、log 或 API cache value。

## 本地驗證

在 repository root 執行：

```bash
node --test Member/tests/*.test.js
```

這些測試驗證檔案結構、LIFF/GAS 合約、資料表 schema、CSP 與 token 不落地等不變量。實際 LINE 登入、GAS Web App 與 Spreadsheet 仍需部署後做 integration verification；本次不會自動 deploy。
