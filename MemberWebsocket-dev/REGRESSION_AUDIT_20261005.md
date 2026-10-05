# 新功能對既有功能的回歸檢查

日期：2026-10-05（Asia/Taipei）。基準：`21578d03f44e8a6e3001eedcd63bd840ff6713cd`。
範圍：`MemberWebsocket-dev` 管理端、會員端、點數、活動票券、營運日曆、預約、通知、測試控制，以及 Supabase `dbuquirnaskrwcamdxki`。

## 結論

**FACT：找到並重現兩個票券 UI 回歸，另找到原有快照 API 的原始碼授權退回較簡化版本，以及管理端部署共用依賴落後。不能宣稱所有功能皆無錯誤。**

本次修正保留既有 API、資料表、票券核銷／扣點規則，不改會員等級、管理權限、排程或正式設定。沒有執行線上扣點、核銷、完成預約、刪除資料、發 LINE 訊息或啟用條款。

## 已確認缺陷與修正

| 問題 | 觸發／影響 | 證據與處置 |
| --- | --- | --- |
| 票券上限調低沒有修正既有選取 | 管理員從 0（不限）改成 1，會員已選的 3 張集點券及 3 張活動券仍全數送出；後端可能拒絕原有預約送出／修改 | 新增 DOM 測試修正前實際得到 6 張、預期 2 張。依最新各類上限及點數／服务條件保留先選且仍有效的票券，移除超額項目、更新確認摘要並提示；改回 0 不代替會員自動選券 |
| 舊票券回應覆蓋新預約編輯對象 | 可用權益請求尚未完成時切換預約，較早請求仍渲染旧預約的保留／可用狀態，可能取消剛帶入的票券 | 新增 DOM 測試修正前觀察到 `old-context` 渲染。立即同步遇到既有請求時使舊 sequence 失效，再合併執行最新 context 請求 |
| E2E 快照 API 的 Repository 登入驗證比線上版本弱 | 下次直接部署原始碼會失去共用 issuer／audience／expiry／iat、session 與一致的管理員授權契約 | 全部線上 bundle 比對找到差異。將 source 改回 canonical auth helper；納入共用契約清單及依賴計畫，避免未來發布回退。**不是聲稱線上快照目前已採用該較弱 source** |
| 管理端票券 options 的 bundle 使用舊服務類型規則 | 新功能已改成「具體服務項目 any／all」，但 `booking-admin-operations` 的 `_shared/booking-benefits.ts`／`latest-available-offers.ts` 仍回傳 `requiredServiceTypes`，缺少新 UI 預期的 `requiredServiceIds` 與 match mode | FACT：線上檔案與 main 差異已確認。INFERENCE：設定限制後，管理端修改原有預約票券可能顯示錯誤條件，並在送出時遭 DB 的新規則拒絕。需要重新部署該函式及最新版共用依賴；本次未修改線上部署 |

新增 `scripts/edge-deployment-plan.cjs`，列出相對 import／reexport 的直接及間接使用者，避免只部署入口而遺漏共用依賴。它不呼叫管理 API、不取得憑證、不自動部署。

```sh
node MemberWebsocket-dev/scripts/edge-deployment-plan.cjs _shared/latest-available-offers.ts
node MemberWebsocket-dev/scripts/edge-deployment-plan.cjs _shared/auth-contract.ts
```

第一個命令列出 `api`、`booking-admin-operations`、`booking-receipt-api`、`grant-automation`、`scheduled-grant-messages`。實際部署應核對完整 bundle，而不是看到這五個名稱就無條件發布。

## 部署比對

讀取全部 31 個 ACTIVE Edge Function 的部署檔案，與本次基準的正式 source 逐一比對（CRLF 正規化）。

| 部署差異 | 判斷 |
| --- | --- |
| `booking-admin-operations`：兩個票券 helper 落後 | 有實質業務規則差異，優先同步 |
| `booking-admin-api`、`event-ticket-links`、`booking-group-details-api`：auth helper 落後 | 需同步；舊 helper 的管理員 bypass 沒有按 channel 限制。這幾個入口的正常管理用途本身使用 admin channel，不能僅憑差異宣稱已發生會員端越權 |
| `booking-admin-api`：booking-hours 缺少新 helper | 缺少 `currentBusinessDate`，但該入口目前未呼叫這個新增 export；未將其單獨列為已重現功能故障 |
| `booking-group-details-api`：入口／request-body 版本差異 | 有格式及共用 helper 修訂；依最新版原始碼一併驗證部署 |
| `e2e-artifact-api`：線上有共用 auth，而 main source 沒有 | 本次補回 source；未用 main 原先較弱版本覆蓋線上部署 |
| `birthday-benefits`、`e2e-artifact-retention` | 本次觀察到的入口差異主要是排版，未報成業務故障 |

主要 `api`、`booking-api`、`booking-receipt-api`、`user-test-api`、`test-control-api` 的入口及所有所帶依賴與基準一致；其他沒有列出差異的 bundle 也一致。

## 原有功能檢查範圍

| 原有流程 | 本次驗證與限制 |
| --- | --- |
| 會員登入、停用、強制下線、維護限制 | 既有回歸及新增 canonical auth 行為測試：無 token、issuer／audience／expiry／iat 異常在 DB 讀取前拒絕；管理員使用會員 channel 仍受撤銷／維護限制；DB 驗證失敗 fail closed |
| 會員申請、電話、條款版本與重新同意 | DOM 與 SQL 範圍通過；線上目前有效條款 0 筆，因此正式新會員申請會被有效條款檢查阻擋。屬設定缺口，不能自行捏造條款或繞過同意 |
| 集點卡、票券、點數轉贈 | 點數預算、保留點數、資料變更即時同步、轉贈重複請求及晚到回應等既有測試；新增上限收縮回歸 |
| 一般與多人預約 | 新增／修改、重複 request id、版本衝突、被占用時段保留原單、已完成禁止修改、歷史票券來源等既有測試；新增切換編輯對象競態 |
| 完成服務／票券核銷 | 原子結算、點數保留、終止狀態釋放、地點限制及收據結算的既有 SQL／接線驗證。未在線上消耗會員權益；不能稱已做正式高併發驗收 |
| 收據、無障礙模式 | owner／review 狀態、替換、重複送出、晚到相機／照片、完成後檢視及管理紀錄的 DOM／SQL 驗證 |
| 活動、抽獎、GPS、日曆、固定票券 | 既有 UI 操作、限制、持久化、日期、QA 自動發券隔離及未映射操作檢查；實體定位／相機與 LINE WebView 仍需實機驗收 |
| 通知、排程、整合中心 | 通知去重、測試會員隔離、排程健康與既有接線；未發正式訊息，未以 CI 成功代替實際 LINE 收件 |
| QA 背景執行及清理 | 重入、逾時後晚到任務、背景同步、正式設定保護、名稱相同的正式資源保留等既有測試 |

## 線上資料及歷史證據

- FACT：Supabase 狀態 `ACTIVE_HEALTHY`；public table 未啟用 RLS 數量 0；public SECURITY DEFINER 可由 anon／authenticated 執行數量 0。
- FACT：負點數餘額 0；完成／取消／拒絕預約仍留 pending 票券選擇數量 0；收據與失敗快照 bucket 都是 private。
- FACT：目前會員資料均為測試帳號；資料量小，不能從沒有異常資料推論正式高併發必然安全。
- FACT：會員條款表沒有 active 版本；點數節點／活動票券目前沒有具體服務限制 fixture。因此 latest E2E 的限制案例無法完整實跑。
- FACT：最新會員 E2E `UE2E-MUUN2GAG-F64B3A60`：33 passed、2 skipped，`coverageComplete=false`、`verificationStatus=incomplete`；不能把 terminal `passed` 當完整覆蓋。
- FACT：較早 `UE2E-MUULZRKQ-7C09C62C` 留有 `BOOKING_HUMAN_GROUP` 240 秒逾時及 `BOOKING_ACCESSIBLE_MODE` 同步失敗；最新輪這兩個案例已通過。歷史錯誤並非本輪新重現結果。
- FACT：檢查近 24 小時 Function logs 有 3 筆 503（api／booking-api／booking-cancellation-api）；沒有足夠 error body 或 server log 判定根因。未将預期 401／403／409／413 負面測試回應全部誤報成故障。
- Security advisor：52 個 RLS enabled no policy 資訊提示符合 Edge 封鎖 direct client access 的架構；另有 [pg_net 位於 public 的警告](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)，本次未搬移 extension。

## 驗證與發布狀態

本機檢查結果記錄於本次 PR 描述；Node／DOM／SQL 已執行，不以只有測試名稱或接線存在當行為通過。兩個新增票券 DOM 案例在修正前均實際失敗，修正後均通過。

基準 main CI：[37257276401](https://github.com/yongshengchen0615/yongshengchen0615.github.io/actions/runs/37257276401)，全部六個 lane 成功，Chromium log 有 **101 passed**。這是基準版本的證據。

本機 Chromium 下載完成後因環境 `SIGSEGV` 無法啟動；這不是產品測試成功，也不能從該啟動失敗推論 UI 故障。修正版的 Chromium／Deno 結果由本次 PR CI 提供。

本次建立可審查的修正與檢查報告，不合併 main、不變更正式部署。無 schema migration。前端發布時需使用已更新的 `booking-benefits.js` 版本。

## 待處理的實際事項

1. 審查本次 PR，通過 CI 後發布票券同步與 source 授權修正。
2. 重新部署上述落後的 Edge bundle；取回部署檔案確認依賴內容，再用不同角色／request id 驗證功能。
3. 管理員提供並啟用正式會員條款；不以測試條款代替正式規則。
4. 用隔離測試 fixture 補齊 any／all 與跨端真人操作，保存 complete 的根 run；現有 33／35 結果不等於所有功能已驗證。
5. 503 若再現，保存安全的 error code、action、execution id 與時段，以便判定是否 LINE、維護、測試 Session 或 DB；不記錄 token／secret。
