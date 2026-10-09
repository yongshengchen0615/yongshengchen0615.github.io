# 2026-10-09 測試資料分析與修正

分析來源：Supabase `dbuquirnaskrwcamdxki` 的現存 QA run/case/step、learning 記錄、收據資料及 Edge Function request logs；程式基準 `ce8cca4`。所有時間為 UTC。

## 現存樣本

| 執行 | 時間 | 案例 | 通過 | 失敗 | 跳過 |
|---|---|---:|---:|---:|---:|
| 系統健康檢查 | 07:21:54–07:22:01 | 10 | 9 | 0 | 1 |
| points 瀏覽器 E2E | 07:23:06–07:24:06 | 28 | 24 | 1 | 3 |
| booking 瀏覽器 E2E | 07:23:01–07:28:55 | 29 | 26 | 2 | 1 |
| 合計 | | 67 | 59 | 3 | 5 |

各失敗案例僅一筆執行樣本，不能據此判定長期趨勢。learning 的 `failure_rate` 經過平滑，不等於原始觀察失敗比例。系統健康檢查缺少啟用的必須同意條款，points 轉移缺少可轉餘額，相關跳過代表覆蓋不足，不能計為通過。

## 問題與改善

| 失敗案例 | 現有證據 | 本次修改 |
|---|---|---|
| `POINTS_HUMAN_REDEEM` | 11,035 ms；對 null 執行 click。QA fixture 只準備票券與點數，正式介面要求已確認且符合資格的預約。 | 為已驗證 points 測試 Session 建立專用 QA 預約，包含 QA 主服務及必要店內服務；回讀正式 eligibility RPC。真人流程明確選取該預約；不足資格時回報前置條件錯誤。 |
| `BOOKING_ACCESSIBLE_SCREENSHOT_RECEIPT` | 33,035 ms；送出後視窗未關閉。對應收據已成功進入 `awaiting_review`，18138 bytes 的 WebP 實際大小與宣告相同，沒有伺服器失敗原因。 | 收據 finalize 成功即關閉並刷新，移除依賴 900 ms 計時器的關閉；保留送出鎖定及重試識別。 |
| `BOOKING_HUMAN_LIFECYCLE` | 240,001 ms；節點逾時。診斷截斷為設定資料前綴，無法確定卡在哪一步。07:21–07:29:30 request logs 中 booking-api 最長 6,415 ms，group-api 最長 4,157 ms，不能將節點逾時直接歸因單次後端請求。 | DOM 等待增加 MutationObserver，減少背景頁面輪詢計時器延後；兩個獨立 bootstrap 請求同時啟動；保留最後操作、錯誤、頁面狀態及 API 耗時，供下一輪定位。 |

背景頁面計時器節流是可重現的風險；歷史 booking lifecycle 的完整根因仍需新診斷資料。並行 bootstrap 預期將這兩次讀取的等待由相加改為接近較慢的一次，尚未量測部署後的實際提升百分比。

## 邊界與驗證

- 只有驗證過的測試會員與 points Session 能使用新增 fixture；正式會員及其他 surface 在資料存取前被拒絕。預約確認依會員、request id、pending 狀態約束，並寫入 QA audit。
- 資格回讀失敗時清除剛建立的 QA 預約。重放已確認 fixture 被拒絕且保留原預約。fixture 設定不扣點；核銷仍經正式介面與既有 RPC。
- 保留 QA 使用紀錄供管理端檢查；未修改 RLS、登入權限、業務規則、正式會員資料或資料表結構。
- 本地 692 項原有 regression 通過；26 項目標 DOM／PostgreSQL 測試通過；新增 7 項測試在最後修改後再次通過，包括完全暫停 timer 的 DOM 等待、取消重開選預約核銷、不可核銷時零寫入、診斷保留與遮蔽、正式帳戶拒絕、真實 PostgreSQL 資格及失敗清理。
- 完整 Chromium、其他整合測試、Deno 型別及 wiring 檢查以 PR 的 GitHub Actions 結果為準。本地 Chromium 在此執行環境啟動時退出，未計為通過。
- 本次尚未取得已登入的 LINE／真機 Session，因此未宣稱部署後的完整線上真人 E2E 通過，亦未改寫歷史失敗記錄。

下一轮应使用 runner `2026-10-09.2` 重跑 points 与 booking，核对上述三节点及跳过项，并比较同样流程、相同设备条件下的 API／节点耗时。
