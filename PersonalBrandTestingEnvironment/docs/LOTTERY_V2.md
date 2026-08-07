# 會員抽獎券與轉盤 V2 架構

## 核心原則

會員抽獎採「先準備、後開獎」的 transaction boundary：開啟抽獎券時只取得最新工作區、驗證票券並建立 Canvas；只有使用者按下中央「點我抽獎」後，才建立 persistent request ID 並呼叫 `drawLottery`。

因此 READY 狀態必須滿足以下條件：

- 已取得最新 `getLotteryConfig`。
- 已確認所選 `cardRoundKey` / `lotteryTypeId` 仍有效。
- 已建立 Canvas 與獎項停止角度。
- `LotteryDraws` 尚未新增紀錄。
- 抽獎券尚未被消耗。
- 後端尚未決定中獎獎項。

公開 facade 維持不變：

```javascript
window.MemberLotteryDialog.configure(options);
window.MemberLotteryDialog.open(ticket);
window.MemberLotteryDialog.refreshTickets(options);
window.MemberLotteryDialog.restorePending();
window.MemberLotteryDialog.hasPending();
window.MemberLotteryDialog.canClose();
window.MemberLotteryDialog.requestClose(options);
```

## 正式資料流

```text
會員選擇抽獎券
  -> Dialog PREPARING
  -> preparation-service force refresh getLotteryConfig
  -> 驗證會員工作區、票券、轉盤類型與獎項設定
  -> workspace-mapper 正規化資料
  -> wheel-animator.prepare() 建立 Canvas 與 prize target angles
  -> Dialog READY

此時沒有 requestId、沒有 drawLottery、沒有 LotteryDraws mutation。

使用者點「點我抽獎」
  -> Controller 立即進入 DRAWING，阻止快速第二次 click
  -> draw-service 呼叫 pending-request-store.ensure(ticket)
  -> 建立或沿用同一 persistent requestId
  -> draw-service 呼叫 drawLottery
  -> 會員 GAS 重新驗證 LINE 身分、會員權限、票券及 authoritative config
  -> GAS 後端決定 prize
  -> GAS append LotteryDraws
  -> authoritative response 回到前端
  -> workspace-mapper 驗證 draw / config / card
  -> 若 configVersion 在 READY 後已更新，wheel-animator 使用 draw 回應中的最新設定重新建立必要圖面
  -> ANIMATING：requestAnimationFrame cubic ease-out
  -> 精準停在後端 prize center
  -> 清除 pending request、invalidate workspace cache
  -> 更新會員卡與票券
  -> RESULT
```

## 模組責任

| 模組 | 唯一責任 |
| --- | --- |
| `contracts.js` | Ticket、request ID、錯誤分類與基本 API contract |
| `pending-request-store.js` | 只保存已正式啟動 draw 的 request ID，支援 reload / retry idempotency |
| `workspace-service.js` | `getLotteryConfig`、in-flight dedupe、5 秒 fresh cache、最多 30 秒 bounded stale preview、invalidate |
| `preparation-service.js` | 最新 workspace / ticket 驗證；**禁止**呼叫 `drawLottery` 或建立 request ID |
| `draw-service.js` | 建立/沿用 request ID、呼叫 `drawLottery`、coalesce 重複 draw、retry 與 definitive error 清理 |
| `workspace-mapper.js` | 嚴格驗證 workspace、lottery config、card 與 authoritative draw result |
| `wheel-animator.js` | Canvas 預繪、停止角度、2.2–3.2 秒 cubic ease-out、reduced-motion |
| `dialog-view.js` | PREPARING / READY / ERROR / RESULT DOM、ARIA、焦點與使用者文案 |
| `demo-provider.js` | 展示模式的 read-only prepare 與 click-time deterministic draw |
| `dialog-controller.js` | `IDLE → PREPARING → READY → DRAWING → ANIMATING → RESULT` orchestration |
| `member-lottery-v2.js` | Composition root，只公開既有 `MemberLotteryDialog` facade |

舊的 `wheel-draw-guard.js` 已移除；結果不再於 PREPARING 階段先存進前端記憶體。

## Pending request 與安全重試

`pending-request-store` 的 request ID 現在只會在使用者實際按下抽獎後建立。

```text
READY
  -> 無 pending request

CLICK
  -> ensure(ticket)
  -> requestId 寫入 sessionStorage
  -> drawLottery(requestId)
```

若請求送出後發生 timeout、網路中斷、bridge fallback 無法確認結果或其他 ambiguous failure：

1. 不清除 pending request。
2. UI 顯示「安全重試」。
3. 下一次使用相同 `cardRoundKey`、`lotteryTypeId`、`requestId` 再呼叫 `drawLottery`。
4. GAS 若已完成第一次 draw，從 `LotteryDraws` replay 原結果，不再次抽獎。
5. 只有後端可明確證明「沒有開獎」的 definitive error 才清除 pending。

重新整理同一個 LIFF/browser tab 時，`restorePending()` 會讀取 sessionStorage，重新取得最新工作區，再使用同一 request ID 查回/完成該次 draw。

> `sessionStorage` 是 tab/session scoped。若使用者在 request 已送出後直接終止整個 browser/LIFF session，後端紀錄仍安全且不會 double draw，但前端未必能自動恢復原 request ID；該結果仍可由抽獎歷史稽核。若未來要求跨 session 自動恢復，需要另外設計 server-side unresolved-draw lookup，而不應改用不受控的前端結果快取。

## Workspace cache 規則

- Ticket list 可重用短期 cache，避免重複讀取。
- `open(ticket)` 的正式 PREPARING 一律 `force: true`，不可用 stale workspace 作為票券驗證依據。
- `allowStale` 僅供非交易 preview 使用，且有最大 stale age；不得無期限重用 cache。
- `drawLottery` 永遠由 GAS 重新讀取 authoritative server state，因此不信任前端的 `availableDraws`、prize、probability 或 config freshness。
- 開獎完成後 invalidate workspace cache。

## Canvas 與動畫

現行 V2 動畫保留原本合理設計：

- Canvas 只在準備或 authoritative configVersion 改變時重畫。
- 正式旋轉只更新 rotor CSS `transform`，不在每 frame 重畫 Canvas。
- `FINAL_SPIN_TURNS = 3`。
- duration 約 `2200–3200 ms`。
- cubic ease-out：`1 - (1 - progress)^3`。
- target angle 為所中獎項扇區中心。
- `prefers-reduced-motion` 直接對齊同一 authoritative prize。
- 未使用的 waiting-spin path 已移除。

若 draw response 的 `configVersion` 與 READY 時不同，Animator 會先以 authoritative lottery 更新 Canvas/targets，再開始旋轉；不需要再呼叫 `getLotteryConfig`。

## 後端安全邊界

本次 transaction refactor 不改變 GAS schema 或抽獎 authority。

會員 GAS 仍必須：

- 向 LINE 驗證 ID Token，而非信任前端 userId。
- 重新檢查 `Members.status`。
- 從 server-side card ledger 推導可用 ticket。
- 驗證 `cardRoundKey` 對應的 `lotteryTypeId`。
- 從最新 `LotteryPrizes` 讀取 authoritative config。
- 由 GAS 決定 prize；前端 request 不接受 `prizeId`、winning index 或 probability。
- 在 `LotteryDraws` 保存 append-only draw record。
- 以 `(lineUserId, requestId)` replay 同一結果，防止 retry/double click double draw。

管理員 GAS 與會員 GAS 是兩個 Apps Script project，各自的 `ScriptLock` 並不是跨專案 transaction lock。本輪沒有為此做大型改造：目前管理端儲存一版 prizes 採單次 `setValues(rows)`，未發現需要立即修改的已證實 race。跨專案鎖與大規模資料量的讀取優化保留為後續架構議題。

## Legacy URL 相容性

正式抽獎只保留會員首頁的 Lottery V2。

- `client/lottery.html` 保留為舊連結 compatibility redirect。
- 舊網址會保留既有 query/hash，並設定 `panel=tickets` 導向 `client/`。
- 舊完整 `client/lottery.js` 已移除。
- 舊 `client/member-lottery.js` 已移除。
- 不再維護第二套 easing、ticket state、API/recovery 邏輯。

## 自動測試驗收

至少覆蓋：

1. `open(ticket)` 只取得最新 `getLotteryConfig`，不呼叫 `drawLottery`。
2. Invalid ticket 在建立 request ID 前失敗。
3. 中央 click 才建立 pending request / 呼叫 `drawLottery`。
4. 快速連點只產生一個 in-flight draw。
5. timeout 後保留同 request ID。
6. retry 使用相同 request ID。
7. authoritative configVersion 更新可被 mapper/animator 接受。
8. prize mapping 與最終角度一致。
9. result 後 card/ticket 更新且 pending 清除。
10. reduced-motion 仍停在相同 prize。
11. legacy URL 只 redirect，不存在第二套 lottery implementation。
12. module load order 在 Controller 之前載入 DrawService。

完整檢查：

```bash
find PersonalBrandTestingEnvironment -type f -name '*.js' -print0 \
  | sort -z \
  | xargs -0 -n1 node --check

node -e 'const fs=require("node:fs"); for (const f of process.argv.slice(1)) JSON.parse(fs.readFileSync(f,"utf8"));' \
  $(find PersonalBrandTestingEnvironment -type f -name '*.json' | sort)

node --test PersonalBrandTestingEnvironment/tests/*.test.js
```

GitHub Actions 專項 workflow 為 `.github/workflows/validate-personal-brand-lottery.yml`；它只做 validation，不執行部署或自動 merge。

## 人工驗證

正式合併前應在 iOS/Android LINE LIFF 驗證：

- 點選票券進入 READY 後，先查看 `LotteryDraws`，確認沒有新增紀錄。
- 不按中央鍵直接關閉 READY dialog，票券仍存在。
- 點中央鍵後才新增一筆 `LotteryDraws`。
- 連點中央鍵只出現一筆 draw。
- 網路中斷後使用「安全重試」，同 request ID 只有一筆紀錄。
- 重新整理同一 session 可恢復 pending request。
- 動畫由快到慢且精準停在 GAS 回傳 prize。
- 管理員在 READY 與 CLICK 之間更新獎項 config 時，前端以 draw response 的 authoritative config 顯示及停獎。
