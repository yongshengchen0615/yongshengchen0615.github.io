# 轉盤抽獎遊戲

簡單的前端轉盤抽獎遊戲（靜態頁面）。

現在支援從 Google Apps Script（Google 試算表 Web App）讀取獎項「機率」與「顏色」。

如何執行：

1. 在 macOS 或其他系統上，用瀏覽器開啟 `index.html`。
   - 直接雙擊 `index.html` 或在終端執行：

```bash
open index.html
```

2. 點擊 `開始轉動` 按鈕開始抽獎，結果會顯示在畫面上，紀錄會存到 `localStorage`。
3. 若要清除紀錄，點選 `清除紀錄`。

可擴充：
- 在介面上提供獎項編輯與權重調整。
- 加入聲音、圖片或更精細的動畫曲線。

## 透過 Google Apps Script 讀取獎項

前提：你有一份 Google 試算表，並使用 Apps Script 發佈成 Web App，回傳 JSON。

### 1) 試算表欄位建議
- `label`: 獎項名稱（必填）
- `probability` 或 `weight`: 權重或百分比（數字或字串，如 `12%`）
- `color`: 顏色（可選，十六進位或 CSS 色名，如 `#ff6b6b`、`red`）

可用其他名稱：`機率`、`概率`、`colour`、`顏色` 也會被解析。

### 2) Apps Script 範例

將下列程式放到 Apps Script，並確保部署為「任何人都可存取」的 Web App：

```javascript
function doGet() {
   // 範例：直接回傳固定 JSON；也可以從試算表讀取
   const data = [
      { label: '🔸 腳底按摩券 🦶', probability: 1, color: '#ff6b6b' },
      { label: '再接再厲', probability: 10 },
      { label: '🔸 甜湯🍵', probability: 3, color: '#ffd93d' },
      { label: '再接再厲', probability: 10 },
      { label: '🔸 足湯包 🛁', probability: 6, color: '#a8e6cf' }
   ];
   return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
}
```

若要從試算表讀取，可依欄位列出 `label/probability/color` 後轉為 JSON。

### 3) 在本專案設定 Web App URL

有兩種方式：

- 直接在 `app.js` 設定常數 `GAS_ENDPOINT`（建議）
- 或於瀏覽器 Console 設定：

```javascript
localStorage.setItem('gas_endpoint', 'https://script.google.com/macros/s/XXXXXXXX/exec');
location.reload();
```

### 4) 權重與百分比說明
- 送入 `weight` 或 `probability` 皆可，程式會直接當作抽樣權重使用。
- 若提供百分比字串（如 `12%`），會轉為數字 12；總和約 100 也可正常運作。
- 權重為 0 的獎項不會被抽中。

### 5) 錯誤處理
- 若 Web App 無法存取或資料格式錯誤，會使用本地 `defaultPrizes` 作為後備。
- 可開啟瀏覽器 Console 觀察警告訊息。

## 本地快速測試

```bash
open index.html
```

設定好 `GAS_ENDPOINT` 後重新整理頁面即可看到更新。
