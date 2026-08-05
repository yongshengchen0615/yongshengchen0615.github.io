# Member Lottery V2 Architecture

## 目標

將原本集中在 `client/member-lottery.js` 的抽獎券驗證、後台預載、資料正規化、DOM 操作、轉盤動畫、展示模式與對話框生命週期拆成明確模組，同時維持既有公開 API：

```javascript
window.MemberLotteryDialog.configure(options);
window.MemberLotteryDialog.open(ticket);
window.MemberLotteryDialog.restorePending();
window.MemberLotteryDialog.hasPending();
window.MemberLotteryDialog.canClose();
window.MemberLotteryDialog.requestClose(options);
```

## 模組責任

| 模組 | 唯一責任 |
| --- | --- |
| `contracts.js` | 抽獎券、request ID、成功回應與錯誤分類契約 |
| `pending-request-store.js` | pending request 的 session persistence 與冪等 request ID |
| `preparation-service.js` | 在轉盤啟用前依序取得設定並呼叫 `drawLottery` |
| `wheel-draw-guard.js` | 保存及解析記憶體中的 prepared draw response |
| `workspace-mapper.js` | 驗證並正規化轉盤、集點卡與抽獎結果資料 |
| `wheel-animator.js` | Canvas 繪製協調、等待旋轉、自然減速及中獎位置對齊 |
| `dialog-view.js` | DOM 查找、畫面狀態、按鈕、焦點及關閉行為 |
| `demo-provider.js` | 展示模式 workspace 與 deterministic draw result |
| `dialog-controller.js` | 協調上述 use cases，不直接實作資料格式、DOM 或動畫細節 |
| `member-lottery-v2.js` | Composition root，只建立並公開 `MemberLotteryDialog` facade |

## 執行流程

```text
使用者選擇抽獎券
  -> controller 驗證 ticket
  -> preparation-service 呼叫 getLotteryConfig
  -> pending-request-store 建立或沿用 request ID
  -> preparation-service 呼叫 drawLottery
  -> wheel-draw-guard 保存 prepared response
  -> workspace-mapper 驗證 workspace
  -> wheel-animator 預先繪製轉盤
  -> dialog-view 啟用中央按鈕

使用者點擊中央按鈕
  -> controller 從 wheel-draw-guard 取得 prepared response
  -> 不再呼叫後台
  -> workspace-mapper 驗證 draw result
  -> wheel-animator 執行自然減速與獎項對齊
  -> pending request 清除
  -> dialog-view 顯示結果
```

## 耦合邊界

- 後台 request 只存在於 `preparation-service.js`。
- DOM ID 只集中在 `dialog-view.js`。
- `requestAnimationFrame` 與旋轉角度只存在於 `wheel-animator.js`。
- 回應資料格式只由 `workspace-mapper.js` 驗證。
- Internal modules 透過 `PersonaModules` 註冊，不新增 `window.MemberLottery*` 全域物件。
- Host application 只依賴 `window.MemberLotteryDialog` facade。

## 零停機啟用

PR 不直接修改目前正式入口。合併到 `main` 後，GitHub Actions 會：

1. 在 checkout 中原子替換會員頁 script boundary。
2. 驗證所有新模組語法。
3. 執行 `PersonalBrandTestingEnvironment/tests/*.test.js`。
4. 驗證 V2 script dependency order。
5. 只有全部成功時才提交 `client/index.html`。

若任一步驟失敗，正式站繼續使用既有 legacy controller。

## 後續清理

V2 穩定後可另開低風險 PR 移除不再載入的 legacy 檔案：

- `client/member-lottery.js`
- `client/member-lottery-preload.js`
- `client/lottery/preparation-view.js`
- `client/lottery/preload-controller.js`

移除前應先確認 production `client/index.html` 已切換至 `member-lottery-v2.js`，並保留至少一次完整抽獎、重新整理 pending request、授權失效與 reduced-motion 的人工驗證紀錄。
