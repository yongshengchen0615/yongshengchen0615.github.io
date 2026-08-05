# 系統架構、耦合分析與重構路線

本文件描述目前會員系統的實際執行架構、資料所有權、安全邊界、已完成的低耦合重構，以及後續拆分順序。部署步驟與 Script Properties 仍以 [`README.md`](README.md) 與 [`setup.html`](setup.html) 為準。

## 1. 執行拓撲

```text
會員 LIFF / 管理 LIFF
        │
        ├─ 讀取各自的 config.json（只含公開設定）
        ├─ 使用 LINE LIFF SDK 取得 ID Token
        └─ 經 shared/gas-api.js 發送有限欄位的請求
                    │
          ┌─────────┴─────────┐
          │                   │
    會員 GAS Web App     管理 GAS Web App
    gas/client/Code.gs   gas/admin/Code.gs
          │                   │
          └─────────┬─────────┘
                    │
             共用 Google Spreadsheet
```

會員端與管理端是兩個不同的 LINE Channel、LIFF App 與 GAS 部署。兩端唯一共用的持久資料是 Google Spreadsheet；任何一端都不能改用另一端的 ID Token audience 或 GAS URL。

兩套 GAS 必須維持獨立。它們共用資料，不共用授權邊界；合併會讓會員端部署取得不必要的管理權限。

## 2. 主要入口與責任

| 入口 | 主要程式 | 現況責任 |
| --- | --- | --- |
| `client/index.html` | `client/script.js`、`client/member-lottery.js` | 會員登入、會員卡、個資、QR 領點、點數紀錄、抽獎券與轉盤 |
| `client/lottery.html` | `client/lottery.js` | 舊抽獎連結的相容 fallback |
| `admin/index.html` | `admin/script.js` | 會員查詢與使用權限 |
| `admin/points.html` | `admin/script.js` | 點數類型、活動 QR 與領點紀錄 |
| `admin/lottery.html` | `admin/script.js` | 集點卡規則、轉盤設定與中獎紀錄 |

共用瀏覽器模組：

- `shared/gas-api.js`：公開設定讀取、request ID、fetch 傳輸、受驗證 iframe fallback 與回應封套。
- `shared/liff-runtime.js`：LIFF context、展示模式與公開設定完整性檢查。
- `shared/lottery-wheel.js`：管理端預覽與會員端轉盤共用 Canvas 繪製。
- `shared/qr-code.js`：管理端本機 QR Code 編碼。
- `shared/module-registry.js`：顯式模組註冊、延遲解析、單例與循環依賴偵測。

前端只負責顯示與送出意圖，不可自行決定中獎結果、會員權限或可領取點數。

## 3. 核心問題分析

### 3.1 `client/script.js` 是會員端 God Object

目前同一個 IIFE 同時管理：

- LIFF 初始化、登入、token 失效恢復；
- 會員同步與個資編輯；
- QR claim 解析、sessionStorage、領點冪等；
- LIFF 掃碼與相機 fallback；
- 點數紀錄載入與畫面；
- 集點卡摘要與抽獎券列表；
- dialog、toast、loading、error view；
- 抽獎模組組裝。

結果是大量全域狀態、busy flag、request version 與 DOM ID 形成時間順序耦合。修改點數紀錄，也可能影響登入、dialog 或抽獎恢復流程。

### 3.2 `admin/script.js` 同時承載三個管理工作區

同一份程式依 `data-admin-page` 切換會員、點數、轉盤三種工作區，卻仍初始化全部狀態、formatter 與操作函式。這讓每個頁面載入不需要的邏輯，也提高跨頁回歸風險。

### 3.3 抽獎程式曾是「拆檔但未解耦」

先前預載功能雖拆成多個檔案，但每個檔案都掛在 `window.MemberLottery*`，再由 `member-lottery-preload.js` 覆寫 `window.MemberLotteryDialog` 並攔截：

- `getLotteryConfig`：改成先抓設定、再先呼叫 `drawLottery`；
- `drawLottery`：改成回傳記憶體中的預載結果。

這個行為正確，但相依關係隱藏在 script 載入順序與全域名稱中。任何模組漏載時，舊版「按下按鈕才打後台」流程可能繼續運作，錯誤不夠明確。

### 3.4 驗證規則重複

抽獎券格式在 `client/script.js`、`member-lottery.js`、pending request store 中重複。會員端、管理端與 GAS 也各自重複 response envelope、ID、日期與點數驗證。

短期需要保留部分重複以控制改動範圍；長期應透過 action-specific contract test 確保一致，而不是繼續複製貼上。

### 3.5 Transport 與 domain 欄位耦合

`shared/gas-api.js` 同時負責網路傳輸與 `EXTRA_FIELD_NAMES` domain 欄位白名單。每新增一個後台欄位都要改 transport。後續應改為 action contract 驗證，再由 transport 傳送已驗證 payload。

### 3.6 GAS 仍是大型單檔

兩套 `Code.gs` 都同時包含 HTTP dispatch、LINE 驗證、授權、schema migration、repository、點數、集點卡、轉盤與 utility。Apps Script 專案可包含多個 `.gs` 檔案，因此可在不改執行方式的前提下按責任拆分。

## 4. 目標依賴方向

```text
DOM / LIFF / GAS adapter
        ↓
application controller / use case
        ↓
domain contracts / pure validation
        ↓
storage、transport、clock 等介面
```

規則：

1. Domain 與 use-case 模組不可直接讀 DOM 或瀏覽器全域狀態。
2. View adapter 可操作 DOM，但必須由 composition root 注入 `document` 或元素。
3. Service 必須注入 request、storage 與 callback。
4. 只有 composition root 可以解析 `window` 上的外部 SDK 與既有公開 API。
5. 對外 facade 保持小且穩定；內部模組不得各自污染 global namespace。
6. 會員 GAS 與管理 GAS 的授權邊界不得合併。

## 5. 本次已完成的第一階段重構

### 5.1 顯式 module registry

新增 `shared/module-registry.js`：

- 以名稱註冊 factory 與 dependencies；
- 在 `get()` 時延遲解析；
- internal module 定義順序不再重要；
- 同一模組只建立一次；
- 重複註冊、缺少模組、循環依賴都有固定 error code。

### 5.2 抽獎共用 contracts

新增 `client/lottery/contracts.js`，集中：

- 抽獎券 normalization；
- request ID 驗證；
- GAS response envelope 驗證；
- definitive no-draw error 分類；
- client error 建立。

### 5.3 高內聚抽獎元件

| 模組 | 單一責任 |
| --- | --- |
| `pending-request-store.js` | request ID 持久化與 session idempotency |
| `wheel-draw-guard.js` | 記憶體中 prepared result 的所有權與比對 |
| `preparation-service.js` | 設定驗證、預先開獎、錯誤清理與 host card refresh |
| `preparation-view.js` | 「準備中／已就緒」按鈕與文字狀態 |
| `preload-controller.js` | 將 preload use case 接到既有 legacy dialog |
| `member-lottery-preload.js` | 唯一 composition root 與失敗 facade |

內部模組不再建立 `window.MemberLotteryPendingRequestStore`、`window.MemberLotteryPreparationService` 等全域物件。對外仍保留 `window.MemberLotteryDialog`，因此 `client/script.js` 暫時不需要高風險的大規模改寫。

### 5.4 轉盤執行流程

```text
點選抽獎券
  -> controller 驗證 ticket
  -> legacy dialog 顯示 loading
  -> getLotteryConfig 進入 preparation service
  -> 驗證抽獎券仍可使用
  -> 建立或沿用同一 request ID
  -> 先呼叫 drawLottery
  -> 驗證並保存 prepared response
  -> 繪製轉盤並啟用中央按鈕

點選中央按鈕
  -> legacy dialog 使用同一 request ID 要求 drawLottery
  -> controller 只回傳記憶體 prepared response
  -> 不發生網路請求
  -> legacy dialog 只執行轉動、減速、停獎與結果畫面
```

### 5.5 失敗策略

- 暫時性網路錯誤：保留 pending request 與相同 request ID，安全重試。
- 明確未開獎錯誤：清除 pending request 與 prepared response，重新同步卡片。
- 模組初始化失敗：以 unavailable facade 明確拋出 `LOTTERY_BOOTSTRAP_ERROR`，不再靜默退回舊流程。

## 6. Spreadsheet 資料所有權

| 工作表 | 主要寫入者 | 用途 |
| --- | --- | --- |
| `Members` | 會員 GAS、管理 GAS | 會員資料與使用權限 |
| `Admins` | 管理 GAS、試算表擁有者 | 管理員申請與人工核准 |
| `PointTypes` | 管理 GAS | 可發放的點數規則 |
| `PointCampaigns` | 管理 GAS | 已發行 QR 活動與規則快照 |
| `PointRedemptions` | 會員 GAS | 點數領取帳本與終身累計依據 |
| `PointCardSettings` | 管理 GAS | 卡片滿點、期限、抽獎節點與指定轉盤 |
| `LotteryTypes` | 管理 GAS | 轉盤類型生命週期 |
| `LotteryPrizes` | 管理 GAS | 不可變轉盤設定版本與機率 |
| `LotteryDraws` | 會員 GAS | 實際抽獎結果 |

點數餘額與集點卡進度應由帳本重新計算，不由瀏覽器或 `Members` 顯示值當作權威資料。

## 7. 安全與一致性邊界

- `config.json`、LIFF ID、GAS `/exec` URL 是公開資料；秘密只放 GAS Script Properties。
- GAS 必須驗證 ID Token audience、issuer、subject 與時效。
- `ALLOWED_ORIGINS` 只接受完整 origin。
- 回應綁定 request ID；iframe bridge 額外驗證 origin 與一次性 secret。
- 會員與管理 action 白名單分流。
- 領點、抽獎與管理寫入使用 request ID 保持冪等。
- 中獎機率與結果只在會員 GAS 決定；Canvas 動畫只呈現已確認結果。
- 管理員核准只依 `Admins.status`，前端沒有提升權限 API。
- Google Sheets 不是交易型資料庫，跨列寫入必須保留 lock、重讀與唯一性檢查。

## 8. 後續重構順序

### Phase 2：拆 `client/script.js`

保留現有 DOM ID，逐一抽出：

```text
client/app/session-controller.js
client/member/member-service.js
client/member/profile-controller.js
client/points/claim-controller.js
client/points/history-controller.js
client/scanner/point-scanner.js
client/ui/dialog-service.js
client/ui/toast-service.js
client/ui/app-state-view.js
```

先抽 pure normalization 與 use case，再移動 DOM code；不要一次重寫整個會員頁。

### Phase 3：淘汰 legacy `member-lottery.js`

拆成：

```text
lottery/dialog-controller.js
lottery/workspace-mapper.js
lottery/wheel-animator.js
lottery/result-presenter.js
lottery/demo-provider.js
```

完成後，dialog controller 應直接呼叫 `prepare(ticket)` 與 `revealPrepared()`，移除 request interception compatibility layer。

### Phase 4：按頁拆 `admin/script.js`

```text
admin/core/session-controller.js
admin/members/member-admin-controller.js
admin/points/point-type-controller.js
admin/points/campaign-controller.js
admin/lottery/config-controller.js
admin/lottery/history-controller.js
```

每個 HTML 只載入自己的 page controller，共用 session、transport、error mapper 與 view utility。

### Phase 5：按 domain 拆兩套 GAS

會員與管理專案各自拆成：

```text
00_Config.gs
10_Http.gs
20_LineIdentity.gs
30_Authorization.gs
40_Members.gs
50_Points.gs
60_PointCards.gs
70_Lottery.gs
80_SheetRepositories.gs
90_Migrations.gs
99_Utilities.gs
```

不得建立跨部署 runtime import。未導入 build pipeline 前，兩套 GAS 必須仍能各自完整部署。

### Phase 6：API contract 化

以 action-specific validator 取代 transport-level domain field whitelist，並為以下 action 建立 request/response contract test：

- `upsertMember`
- `redeemPointCampaign`
- `getLotteryConfig`
- `drawLottery`
- 管理端會員、點數、轉盤 mutation

## 9. 測試與驗證

本階段新增或保留的關鍵測試：

- 開啟抽獎券時先完成 `getLotteryConfig` 與 `drawLottery`；
- 點擊中央按鈕只取 prepared memory response，不打後台；
- 暫時性錯誤沿用相同 request ID；
- definitive no-draw error 解除 pending state；
- internal lottery modules 不建立個別 global；
- module registry 可亂序定義、維持 singleton、拒絕 duplicate、偵測 cycle；
- GitHub Actions 自動插入與驗證正確 script boundary。

```bash
node --check shared/module-registry.js
node --check client/lottery/*.js
node --check client/member-lottery-preload.js

node --test \
  tests/module-registry.test.js \
  tests/member-lottery-preload.test.js \
  tests/lottery-preload-structure.test.js
```

後續每抽出一個 controller，都應先建立 state-machine 或 contract test，再移除原始程式碼。
