# PersonalBrandTestingEnvironment 完整分析與優化報告

## 1. 分析基準

- Repository：`yongshengchen0615/yongshengchen0615.github.io`
- 範圍：`PersonalBrandTestingEnvironment`
- Base：`main` @ `364cd1cadc9b7d72447dfefcc83f2b92f2b2ff6b`
- 作業分支：`agent/analyze-and-optimize-personal-brand`
- Pull Request：#15
- 基準測試：220 tests passed，0 failed

本報告只把可由 repository 程式碼確認的內容列為事實。Apps Script cold start、正式試算表資料量、LINE WebView 快取、iOS／Android 實際幀率與網路時間，均需部署後實機量測。

## 2. 專案現況摘要

本專案是以 GitHub Pages 提供靜態前端、兩套獨立 Google Apps Script Web App 提供會員與管理功能、Google Spreadsheet 作為資料儲存的 LINE LIFF 應用。

目前架構已具備：

- 會員與管理員 LIFF Channel 分離。
- 會員 GAS 與管理員 GAS 分離部署。
- LINE ID Token audience、issuer、expiry、subject 驗證。
- 成功 Token 驗證短期雜湊快取，不保存原始 Token。
- GAS action、request 欄位與前端 context allowlist。
- requestId 冪等性與 append-only 點數／抽獎紀錄。
- Lottery V2：後端先決定並保存結果，中央按鈕只播放本機動畫。
- fetch 優先、bridge fallback 的 GAS transport。
- 唯讀 GitHub Actions，不由 workflow 修改或推送 `main`。
- 既有完整 Node 回歸測試。

本次沒有發現需要立即停機處理的 P0 權限繞過、重複扣券、重複領點或 Token 洩漏缺陷。確認的問題集中在初始化重入、讀取 Promise 語意、會員歷史跨會員故障範圍，以及讀取型 GAS 長時間持有 ScriptLock。

## 3. 檔案分類與責任

### 3.1 HTML

| 檔案 | 責任 | 正式流程 |
| --- | --- | --- |
| `index.html` | 保留 query/hash 並導向會員端 | 使用中 |
| `setup.html` | LIFF、GAS、Script Properties 與部署說明 | 使用中 |
| `client/index.html` | 會員登入、會員卡、點數、抽獎券、內嵌轉盤 | 使用中 |
| `client/lottery.html` | 舊抽獎 deep link 相容頁 | 相容保留 |
| `client/privacy.html` | 會員資料與隱私說明 | 使用中 |
| `admin/index.html` | 會員與權限管理 | 使用中 |
| `admin/points.html` | 點數類型、QR 活動、領點歷史 | 使用中 |
| `admin/lottery.html` | 轉盤類型、獎項、集點卡節點與抽獎歷史 | 使用中 |

### 3.2 CSS

- `client/styles.css`：會員端、相容抽獎頁、Dialog、Canvas、scanner、legal/setup。
- `admin/styles.css`：三個管理頁共用樣式。

兩者都已有 safe area、reduced-motion、noscript、清單 containment 與行動版基線。

### 3.3 共用前端模組

- `shared/gas-api.js`：config 載入、GAS URL/action/requestId 驗證、fetch timeout、bridge fallback、response envelope 驗證。
- `shared/liff-runtime.js`：LIFF／瀏覽器 context normalization、完整 config 判斷、不可變 context。
- `shared/lottery-wheel.js`：Canvas renderer、高 DPI backing store、文字顏色。
- `shared/module-registry.js`：Lottery V2 內部 dependency registry。
- `shared/qr-code.js`：管理端本機 QR encoder。

### 3.4 會員端

- `client/script.js`：LIFF 啟動、會員同步、個資、領點、scanner、點數歷史、抽獎券 host 整合。
- `client/member-lottery-v2.js`：正式 Lottery V2 composition root。
- `client/lottery/*.js`：合約、pending store、workspace cache、preparation、guard、mapper、animator、view、controller、demo。
- `client/lottery.js`：舊 deep link runtime。
- `client/member-lottery.js`、`member-lottery-preload.js`：未由正式首頁載入的 legacy／回滾參考。

### 3.5 管理端

- `admin/script.js`：依 `data-admin-page` 在同一檔案中切換 members、points、lottery 三個工作區。
- 優點是共用登入、錯誤、formatter 與 transport；缺點是單檔較大、跨頁回歸範圍較廣。此項列為 P2，不在本批次大規模拆分。

### 3.6 GAS

- `gas/client/Code.gs`：會員登入／同步、個資、刪除、點數活動預覽與領取、歷史、集點卡、抽獎。
- `gas/admin/Code.gs`：管理員申請與核准、會員權限、點數類型與活動、轉盤、集點卡節點與歷史。
- `gas/*/appsscript.json`：V8 runtime 與最小必要 scopes。

### 3.7 測試與 CI

- `tests/*.test.js`：GAS、transport、LIFF、HTML/CSS、點數、抽獎、冪等性、legacy compatibility。
- `.github/workflows/validate-personal-brand-project.yml`：全 JS、兩套 GAS、JSON、完整測試。
- `.github/workflows/deploy-personal-brand-lottery.yml`：Lottery V2 專用唯讀驗證。
- `.github/workflows/validate-personal-brand-points.yml`：點數領取專用驗證。

## 4. 架構與資料流

### 4.1 會員登入

```text
client/index.html
→ shared runtime 載入 config
→ liff.init
→ 取得 ID Token
→ client/script.js sendGasRequest(upsertMember)
→ member GAS 驗證 origin、action、config、LINE Token
→ Members 讀寫與存取狀態
→ 回傳公開會員資料、點數與集點卡摘要
→ 前端更新會員證與功能狀態
```

### 4.2 QR 領點

```text
QR claim / liff.state
→ 前端固定同一次 redemption requestId
→ previewPointCampaign
→ 使用者確認／自動領取
→ redeemPointCampaign
→ GAS 在 ScriptLock 內重查會員與活動
→ append PointRedemptions
→ response 組裝失敗時精確回滾本列
→ 前端更新點數、集點卡與歷史 dirty state
```

### 4.3 Lottery V2

```text
會員資料完成
→ 開啟抽獎券清單時去重載入 getLotteryConfig
→ 選券時重用 workspace 做前置驗證
→ 使用固定 requestId 呼叫 drawLottery
→ GAS 重查會員、券、節點、轉盤版本並 append LotteryDraws
→ 前端保存 prepared result
→ 建立 Canvas、文字與停止角度
→ 中央按鈕啟用
→ 點擊後零後端請求，只播放動畫
→ 更新券數、點數卡與結果
```

### 4.4 管理端

```text
admin page
→ liff.init + ID Token
→ admin GAS 驗證獨立 Channel
→ Admins 人工核准狀態
→ 通過後才讀取 Members／Point／Lottery sheets
→ 管理 mutation 於 ScriptLock 內執行
→ 前端以 request version 淘汰 stale response
```

## 5. 已確認問題

### P0

本次沒有確認新的 P0。

既有安全邊界仍保留：

- 前端不能決定獎項。
- 相同 requestId 不重複領點或開獎。
- 管理員未核准時不讀取敏感會員資料。
- Token、requestId、LINE user ID、試算表列號不回傳到不需要的 UI。

### P1-1：會員與管理端啟動流程可重入

`client/script.js` 與 `admin/script.js` 的 `start()` 原本每次都重新執行 config 載入、LIFF 初始化與 boot。錯誤頁快速重試可能建立重疊初始化。

`bootVersion` 能淘汰部分舊資料回應，但不能阻止 `loadConfig()`、`liff.init()` 與模組 configure 本身重疊。

修正：`startPromise` 共用同一個進行中 Promise，完成後才釋放。

### P1-2：重複讀取呼叫未回傳真正的進行中 Promise

會員點數歷史與管理端點數／轉盤歷史原本遇到 loading flag 時直接 `Promise.resolve()`。第二個呼叫端會誤以為刷新已完成。

修正：保存並回傳真正的 in-flight Promise；完成時只清除自己擁有的 Promise。

### P1-3：會員歷史會被其他會員的異常 payload 阻塞

`readMemberPointHistory_` 與 `readMemberLotteryHistory_` 原本先完整解析所有會員資料，再篩選目前會員。其他會員的一筆舊格式或異常 payload 可能使目前會員無法讀取自己的歷史。

修正：

1. 先驗證資料列的 LINE owner 格式。
2. owner 不是目前會員時立即略過。
3. 只對目前會員的 payload、duplicate ID、requestId、活動模式執行完整 fail-closed 驗證。

未知或格式錯誤的 owner 仍 fail closed，不會將不明資料靜默忽略。

### P1-4：會員歷史純讀取流程長時間持有 ScriptLock

`listPointHistory_` 原本從 schema 初始化、會員查找、兩張歷史表掃描、排序到 response 組裝都持有 10 秒 ScriptLock。

修正：

- 使用最多 4 秒的 initialization lock，只負責 get-or-create／schema 初始化。
- 立即釋放後再執行會員 access、ledger 掃描、歷史排序與 response 組裝。
- 領點、個資、刪除、正式抽獎等 mutation 鎖不變。

### P1-5：管理端歷史純讀取流程長時間持有 ScriptLock

`adminListPointHistory_` 與 `adminListLotteryDraws_` 原本把授權、整表讀取、名稱 mapping、排序和 response formatting 全部放在 10 秒 ScriptLock 內。

修正：

- 最多 4 秒 authorization lock，只做管理員核准驗證與必要 sheet 初始化。
- 釋放後才讀取、驗證、排序與格式化歷史。
- 管理端 mutation、CAS 與 append-only 寫入鎖保持不變。

## 6. 推論問題

以下需要正式資料或裝置驗證，不能只靠 repository 宣稱已解決：

- Apps Script cold start 佔整體 latency 的比例。
- PointRedemptions／LotteryDraws 成長後的整表掃描時間。
- LINE iOS／Android WebView 是否持有舊 GitHub Pages JavaScript。
- 低階 Android Canvas 幀率與 dropped frames。
- Wi-Fi／行動網路切換時 pending draw／claim 的恢復時間。

## 7. P2 後續路線

本次不擴大風險處理以下項目：

1. 將 `admin/script.js` 依頁面拆成 composition root 與三個 controller。
2. 將兩套大型 `Code.gs` 依 auth、members、points、lottery 拆成多個 Apps Script source files。
3. 正式資料量很大時，為歷史建立可驗證的索引／分區／封存策略。
4. 完整發布週期後另開 PR 移除未載入的 legacy lottery files。
5. 加入不含身份資料的 GAS server timing／資料列數量級 telemetry。

這些項目不應與本次正確性及鎖範圍修正混在同一批重寫。

## 8. 修改檔案

- `client/script.js`
- `admin/script.js`
- `gas/client/Code.gs`
- `gas/admin/Code.gs`
- `tests/project-optimization-regression.test.js`
- `docs/PROJECT_OPTIMIZATION_ANALYSIS.md`

## 9. 相容性與安全

本次不變更：

- GAS action 名稱。
- request／response payload。
- Spreadsheet headers／schema。
- LIFF Channel ID 與會員／管理員分流。
- 公開 config 格式。
- `/exec` endpoint 格式。
- requestId 冪等性、append-only ledger 與 mutation Lock。
- Lottery V2 後端權威開獎。
- 舊版 deep link。

## 10. 驗證方式

```bash
find PersonalBrandTestingEnvironment -type f -name '*.js' -print0 |
  while IFS= read -r -d '' file; do
    node --check "$file"
  done
```

```bash
temp_dir="$(mktemp -d)"
find PersonalBrandTestingEnvironment/gas -type f -name '*.gs' -print0 |
  while IFS= read -r -d '' file; do
    target="$temp_dir/$(basename "$(dirname "$file")")-$(basename "$file" .gs).js"
    cp "$file" "$target"
    node --check "$target"
  done
rm -rf "$temp_dir"
```

```bash
node --test PersonalBrandTestingEnvironment/tests/*.test.js
```

新增測試保護：

- 會員與管理端 start Promise 去重。
- 會員／管理端歷史查詢共用 in-flight Promise。
- 會員歷史初始化 lock 在 ledger scan 前釋放。
- 先確認 owner 再解析 owner-specific payload。
- 管理端歷史的 authorization lock 不包住整表排序與格式化。

## 11. 部署

本次修改兩套 GAS，因此 **會員 GAS 與管理員 GAS 都必須重新部署新版本**。

### 11.1 會員 GAS

1. 將分支中的 `gas/client/Code.gs` 同步到會員 Apps Script 專案。
2. 保留既有 `SPREADSHEET_ID`、會員 `LINE_CHANNEL_ID`、`ALLOWED_ORIGINS`、限流設定與其他 Script Properties。
3. 執行既有 setup／health 驗證。
4. 「部署 → 管理部署作業 → 編輯」並建立新版本。
5. 執行身分與存取權限維持原設定。
6. 優先保留既有 `/exec` URL；只有 URL 實際改變時才更新 `client/config.json`。

### 11.2 管理員 GAS

1. 將 `gas/admin/Code.gs` 同步到獨立管理員 Apps Script 專案。
2. 保留 `SPREADSHEET_ID`、管理員 `LINE_CHANNEL_ID`、`MEMBER_LIFF_URL`、`ALLOWED_ORIGINS`、claim secret 與限流設定。
3. 建立既有 Web App 的新版本。
4. 確認管理頁仍指向管理員 GAS `/exec`，不可誤用會員 GAS。

### 11.3 GitHub Pages

1. 人工審查並合併 PR 後等待 Pages 發布。
2. 無痕視窗或 DevTools Disable cache 驗證。
3. LINE iOS、Android 各執行登入、個資、領點、歷史、抽獎券與轉盤。
4. 管理端驗證會員列表、點數歷史、轉盤歷史與 mutation。

## 12. 回滾

- 前端：revert PR merge commit，等待 GitHub Pages 重新發布。
- 會員 GAS：Apps Script 管理部署切回上一版本。
- 管理員 GAS：獨立切回上一版本。
- 本次沒有 Spreadsheet schema migration，不需刪除或回復資料表。
- 不可用刪除 PointRedemptions、LotteryDraws 或 Members 作為回滾方式。
