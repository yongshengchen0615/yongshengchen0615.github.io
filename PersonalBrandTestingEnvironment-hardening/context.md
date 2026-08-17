# PERSONA 架構硬化分析脈絡

## 分析範圍

- 原始碼根目錄：`/Users/chenyongsheng/Desktop/github＿io/PersonalBrandTestingEnvironment`
- Git revision：`32e23b995679a046f25a783647d94de3acb811b2`
- 分支：`個人品牌測試環境`
- 工作樹漂移：`none`（不含本分析目錄）
- 漂移內容：上一輪 `client/index.html` 的空白變更已由外部移除；其餘證據檔案與目標 revision 一致，安全邊界沒有實質漂移。
- 風險分類：normal。架構會影響公開 request contract、LIFF 登入、管理授權與持久化邊界，但本輪只產出設計，不部署、不遷移資料。
- 優先順序假設：balanced；保留現有 GitHub Pages、雙 LIFF、雙 GAS 與 Spreadsheet 相容性，比一次性重寫更重要。

## 可驗證接受條件

1. 會員與管理 LIFF 繼續使用不同 LINE Channel、不同 GAS 部署與不同 action allowlist。
2. 前端公開設定、GAS request/response envelope、request ID 與冪等語意保持相容。
3. action payload 的欄位驗證由 action contract 擁有；transport 不再理解 domain 欄位。
4. 會員、點數、轉盤與管理頁面可各自載入 composition root，不再共享單一大型狀態容器。
5. GAS 可按責任拆成多個 `.gs` 檔，但兩個部署仍可各自獨立發布。
6. 提案必須比較安全性、效能、記憶體、可靠性、可維運性、遷移與回滾。
7. 未選定方案前，不修改執行中 source、不建立資料遷移、不部署外部服務。

## 證據清單

集合摘要：`sha256:569429a7bbc36b4aa65966c7e94814467a34e2ffa5f53ae80ba6f5cccc4e225b`

| Evidence | 檔案 | SHA-256 | 用途 |
| --- | --- | --- | --- |
| `E001` | `ARCHITECTURE.md` | `a3edf7175b61c03939830932711d303d0d5e5303f5f744607bca0ba68a5edef2` | 現有拓撲、God Object、雙 GAS 邊界與已記錄重構路線 |
| `E002` | `shared/gas-api.js` | `23ee1969a694a09bdcbeb75fb935e54282f8be01d0e076b6abfd71714ad4ff50` | transport 層的全域 domain 欄位白名單與 fetch/bridge 邊界 |
| `E003` | `client/script.js` | `67798b03609bb4c445f42acaf133e1a4d75c2d4c9da991d2b3979a8eac316e6c` | 會員端登入、個資、點數、掃碼、歷史、UI 與 request 組裝耦合 |
| `E004` | `admin/script.js` | `517c4bd416702715a41067bb47113434c0141c515c0c7b62aeef9ef4f93075a7` | 三個管理頁共用一份大型狀態與條件式事件綁定 |
| `E005` | `gas/client/Code.gs` | `850c00b6cf02bcf5a337131d66f64b3c0c47d3ee11b81094b85cfe0d354a4818` | 會員 action allowlist、dispatch、驗證、domain 與 repository 同檔 |
| `E006` | `gas/admin/Code.gs` | `70be58d12c271ca6aa9442c2c88b12c3fc5e44f2a4fd4f5e4f30e7e30cd95102` | 管理 action allowlist、dispatch、授權、domain 與 repository 同檔 |
| `E007` | `README.md` | `60391a333e95dc4d73bb3d9f3d19da61d0f254d51993704fb46a0e97291d8a93` | 部署相容性、Spreadsheet schema 與雙部署升級順序 |
| `E008` | `client/index.html` | `103b063f2d530be913c54421214742980ad855b8434c09b5d6a7754b1851038c` | 會員端現有 script 載入與 lottery composition root |
| `E009` | `admin/index.html` | `ae877dcd1c3d4ae80f750855c0813e81edf29e444b29f7f95dbcef632bf34d73` | 會員管理頁入口 |
| `E010` | `admin/points.html` | `28bc10e238b725ae84209ad5f3e8652ce3f8a611062ff5a0a2e20b3d74f8585e` | 點數管理頁入口 |
| `E011` | `admin/lottery.html` | `7ac0ead447f9e5108572fcab048d3d5feb37b04fd28142a87400a9ebc8a3a1a1` | 轉盤管理頁入口 |
| `E012` | `tests/frontend-structure.test.js` | `9d7d476f389b7e52baf4296ec97e36c64c2862a4cbae626b28330402a2b6a3bd` | 前端結構與相容邊界測試 |
| `E013` | `tests/client-gas.test.js` | `dc836b1ad92377c9102693e036079f38c65c5a5cc1f9781672f9650634fed495` | 會員 GAS 授權、schema、冪等與資料完整性測試 |
| `E014` | `tests/admin-gas.test.js` | `5e10f0b4d457bf98ec5b3a9e84117a5726337d04a9a65a8da04fb1419f6b4f28` | 管理 GAS 授權、action 與 mutation 測試 |

## 觀察與限制

- `client/script.js` 2,730 行、`admin/script.js` 3,641 行、會員 GAS 4,204 行、管理 GAS 4,459 行。行數本身不是漏洞，但搭配多個責任與共享狀態，是控制漂移的可觀察代理。
- `shared/gas-api.js:6-30` 直接列出會員與管理 domain 欄位；新增 action 欄位會改動所有頁面共用的 transport。
- `gas/client/Code.gs:438-490` 與 `gas/admin/Code.gs:504-568` 已在身分驗證前拒絕非 allowlist action。這是必須保留的現有防線，不是待修漏洞。
- 兩套 GAS 在 `validateRequestEnvelope_` 內依 action 驗證欄位，方向正確，但 action 名稱、欄位解析、dispatch 與測試仍由多處手動同步。
- 基準命令 `node --test tests/*.test.js`：198 tests，197 pass，1 fail。既有失敗為 `tests/frontend-structure.test.js` 的 `.lottery-center-button` CSS 順序契約；本輪未改動該 CSS。
- GitHub connector 確認遠端為公開儲存庫 `yongshengchen0615/yongshengchen0615.github.io`，default branch 為 `main`。未執行任何 GitHub 寫入。
- HAPI MCP Registry 搜尋 LINE、Google Apps Script 與 Sheets 整合後回傳 0 個伺服器，因此方案不依賴未證實的 MCP 整合。
- 沒有執行 Codex Security 漏洞掃描；本分析是以 source evidence 推導結構性硬化機會，不宣稱存在或已修復特定漏洞。
