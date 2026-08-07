# PERSONA MEMBERS

以原生 HTML、CSS、JavaScript 製作的 LINE LIFF 會員、集點與轉盤抽獎系統。會員端與管理端使用不同的 LINE Login / LIFF Channel、不同的 Google Apps Script（GAS）部署，兩套 GAS 共用同一份 Google Spreadsheet。

## 核心安全邊界

- 會員端只呼叫會員 GAS；管理端只呼叫管理 GAS。
- 兩套 GAS 都會向 LINE 驗證 ID Token，不信任前端提供的 userId、姓名、頭像或角色。
- 管理員權限以獨立 `Admins` 工作表為準，`Members.admin_status` 只保留舊版相容性。
- 點數與抽獎資格皆由 server-side Spreadsheet ledger 推導，前端顯示狀態不是 authority。
- `drawLottery` 不接受前端指定 `prizeId`、winning index 或 probability；獎項只由會員 GAS 根據最新 Lottery Config 決定。
- 抽獎使用 persistent request ID 與 `LotteryDraws` replay 實作 idempotency，timeout / retry 不會重複使用同一抽獎券。

## 目前主要使用流程

### 會員

```text
LIFF init
  -> get ID Token
  -> upsertMember
  -> GAS 向 LINE verify
  -> 會員資料 / 點數 / 集點卡摘要
  -> 掃描集點 QR、查看點數紀錄、查看抽獎券
```

### Lottery V2

正式抽獎只有一套 implementation，整合在 `client/index.html` 的 Dialog 中：

```text
選擇抽獎券
  -> PREPARING
  -> 強制取得最新 getLotteryConfig
  -> 驗證 ticket / lottery config
  -> Canvas 與停止角度完成
  -> READY

此時尚未呼叫 drawLottery，也尚未消耗票券。

點「點我抽獎」
  -> 建立 / 沿用 persistent requestId
  -> drawLottery
  -> GAS 再驗證會員 / ticket / authoritative config
  -> GAS 決定 prize 並 append LotteryDraws
  -> authoritative response
  -> 2.2–3.2 秒自然減速動畫
  -> 精準停在中獎扇區
  -> 更新 card / tickets
  -> RESULT
```

若 draw request 已送出但 response 無法確認，前端保留同一 request ID；「安全重試」會讓 GAS replay 同一次結果，而不是重新抽獎。

詳細 transaction contract：[`docs/LOTTERY_V2.md`](docs/LOTTERY_V2.md)。
效能與實機診斷：[`docs/LOTTERY_READINESS_DIAGNOSTICS.md`](docs/LOTTERY_READINESS_DIAGNOSTICS.md)。

## 專案結構

```text
PersonalBrandTestingEnvironment/
├── index.html                       # 舊根網址相容入口，導向 client/
├── setup.html                       # 瀏覽器版部署指南
├── README.md
├── ARCHITECTURE.md
│
├── client/                          # 會員 LIFF
│   ├── index.html                   # 正式會員首頁 + Lottery V2 dialogs
│   ├── lottery.html                 # 舊抽獎 URL compatibility redirect -> ?panel=tickets
│   ├── privacy.html
│   ├── styles.css
│   ├── script.js                    # 會員 / 點數 / ticket host integration
│   ├── member-lottery-v2.js         # Lottery V2 composition root
│   ├── config.json
│   └── lottery/
│       ├── contracts.js
│       ├── pending-request-store.js
│       ├── workspace-service.js
│       ├── preparation-service.js   # read-only ticket/config preparation
│       ├── draw-service.js          # click-time draw transaction + retry
│       ├── workspace-mapper.js
│       ├── wheel-animator.js
│       ├── dialog-view.js
│       ├── demo-provider.js
│       └── dialog-controller.js
│
├── admin/                           # 管理員 LIFF
│   ├── index.html                   # 會員資料與使用權限
│   ├── points.html                  # 點數類型、QR、領取紀錄
│   ├── lottery.html                 # 集點卡、轉盤設定、抽獎紀錄
│   ├── styles.css
│   ├── script.js
│   └── config.json
│
├── shared/
│   ├── gas-api.js                   # timeout、fetch / bridge transport、request envelope
│   ├── liff-runtime.js
│   ├── module-registry.js
│   ├── lottery-wheel.js             # 共用 Canvas renderer
│   └── qr-code.js
│
├── gas/
│   ├── client/
│   │   ├── Code.gs                  # 會員、領點、歷史、抽獎、刪除資料
│   │   └── appsscript.json
│   └── admin/
│       ├── Code.gs                  # 管理授權、點數與 Lottery 設定
│       └── appsscript.json
│
├── docs/
└── tests/
```

舊的完整 `client/lottery.js`、舊 `client/member-lottery.js` 與 pre-draw `wheel-draw-guard.js` 不再屬於正式架構。`client/lottery.html` 只保留舊連結相容性，不維護第二套 Lottery App。

## 本機預覽

沒有 npm dependency 或 build step。在 `PersonalBrandTestingEnvironment/` 執行：

```bash
python3 -m http.server 8080
```

常用入口：

- 會員：`http://localhost:8080/client/?demo=1`
- 舊抽獎 URL 相容測試：`http://localhost:8080/client/lottery.html?demo=1`
- 管理員會員頁：`http://localhost:8080/admin/?demo=1`
- 管理員點數頁：`http://localhost:8080/admin/points.html?demo=1`
- 管理員轉盤頁：`http://localhost:8080/admin/lottery.html?demo=1`

`demo=1` 不會把資料送到 GAS。

## Google Spreadsheet

會員 GAS 與管理 GAS 的 `SPREADSHEET_ID` 必須指向同一份 Spreadsheet。主要工作表包括：

- `Members`
- `Admins`
- `PointTypes`
- `PointCampaigns`
- `PointRedemptions`
- `PointCardSettings`
- `LotteryTypes`
- `LotteryPrizes`
- `LotteryDraws`

不要公開 Spreadsheet 編輯權。可直接修改 `Admins.status` 的人等同最高管理權限。

## 會員 GAS 部署

必要 Script Properties：

| 屬性 | 說明 |
| --- | --- |
| `LINE_CHANNEL_ID` | 會員 LINE Login Channel ID |
| `SPREADSHEET_ID` | 共用 Spreadsheet ID |
| `ALLOWED_ORIGINS` | 例如 `https://yongshengchen0615.github.io`，只填 origin |

可選工作表名稱 properties 需與管理 GAS 對應一致；`MAX_VERIFY_REQUESTS_PER_MINUTE` 預設 `120`。

部署：

1. 建立獨立 Apps Script 專案。
2. 貼入 `gas/client/Code.gs` 與 `appsscript.json`。
3. 設定 Script Properties。
4. 執行一次 `setup()`。
5. 部署為 Web App：執行身分為部署者、可存取者為任何人。
6. 將 `/exec` URL 填入 `client/config.json`。

Health check：

```bash
curl -L "會員_GAS_EXEC_URL?action=health"
```

## 管理 GAS 部署

管理端必須是另一個獨立 Apps Script 專案。必要 properties：

| 屬性 | 說明 |
| --- | --- |
| `LINE_CHANNEL_ID` | 管理員 LINE Login Channel ID |
| `SPREADSHEET_ID` | 與會員 GAS 完全相同 |
| `ALLOWED_ORIGINS` | 正式 GitHub Pages origin |

另外需設定管理工作表、點數/抽獎工作表與 `MEMBER_LIFF_URL` 等相容 properties。首次 `setup()` 會建立必要工作表/secret；管理員第一次登入建立 `pending` row，必須由 Spreadsheet 擁有者手動改為 `approved`。

## 前端公開設定

`client/config.json` 與 `admin/config.json` 只放公開連線資訊，例如：

```json
{
  "BRAND_NAME": "PERSONA",
  "LIFF_ID": "YOUR_LIFF_ID",
  "GAS_WEB_APP_URL": "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
}
```

不要把 API secret、Spreadsheet credential、private key 或 LINE Channel Secret 放進 GitHub Pages。

## 測試

完整 regression suite：

```bash
node --test tests/*.test.js
```

完整 repository validation 亦會檢查：

```bash
# JavaScript syntax
find . -type f -name '*.js' -print0 | sort -z | xargs -0 -n1 node --check

# JSON parse
find . -type f -name '*.json' -print0 | sort -z | \
  xargs -0 -n1 node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))'
```

GitHub Actions：

- `.github/workflows/validate-personal-brand-project.yml`：完整專案 validation。
- `.github/workflows/validate-personal-brand-lottery.yml`：Lottery V2 專項 validation。
- `.github/workflows/validate-personal-brand-points.yml`：點數/claim 專項 regression。

這些 workflow 不會自動 merge `main`。

## Lottery 人工驗收

合併前至少確認：

1. 選券進入 READY 後，`LotteryDraws` 沒有新 row。
2. READY 直接關閉，票券仍可使用。
3. 點中央後才出現 `drawLottery` request 與 `LotteryDraws` row。
4. 快速連點只有一筆 draw。
5. timeout 後安全重試沿用同 request ID。
6. 同一 session reload 可恢復 pending draw。
7. 前端 request 沒有 prize / probability 欄位。
8. authoritative config 在 READY 後變更時仍能正確停獎。
9. iOS / Android LINE LIFF 的返回鍵、safe-area、reduced-motion 與 Canvas 都正常。

## 已知後續擴充點

- 會員 GAS 對 `LotteryDraws` / `PointRedemptions` 的歷史資料仍存在 O(n) 讀取路徑；資料量大時應以量測結果再設計 summary/index，而不是先加入複雜快取。
- 會員 GAS 與管理 GAS 是不同 Apps Script project，`ScriptLock` 不跨 project。現行管理端完整 prize config 使用單次 `setValues(rows)`，本輪沒有發現需立即修改的資料競態；若未來新增多步跨 Sheet transaction，再設計跨專案一致性機制。
- `sessionStorage` 能保護同一 browser/LIFF session 的 reload retry；若產品要求「完全關閉 LIFF 後仍自動恢復未揭曉結果」，應新增 server-side unresolved-draw lookup，而不是把 prize 持久化在前端。

更多系統邊界與資料所有權請參考 [`ARCHITECTURE.md`](ARCHITECTURE.md)。
