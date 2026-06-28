# 轉盤抽獎整合版

這個專案是純靜態前端轉盤抽獎頁，五個活動入口共用同一份前台、後台與樣式檔。

## 目錄結構

- `5points/`：5 點轉盤入口
- `10points/`：10 點轉盤入口
- `15points/`：15 點轉盤入口
- `20points/`：20 點轉盤入口
- `Birthday/`：壽星轉盤入口
- `shared/`：共用前台、後台與樣式

每個活動資料夾保留：

- `index.html`：前台抽獎頁
- `admin.html`：後台管理頁
- `config.js`：該活動的 Apps Script Web App URL 與工作表設定
- `README.md`：活動入口簡述

## 執行方式

直接用瀏覽器開啟任一活動的 `index.html`：

```bash
open 5points/index.html
```

後台管理頁：

```bash
open 5points/admin.html
```

## 設定資料來源

每個活動只需要修改自己的 `config.js`：

```javascript
window.TURN_ADMIN_CONFIG = {
  scriptUrl: 'https://script.google.com/macros/s/XXXXXXXX/exec',
  sheetName: '機率',
  proxyUrl: '',
  noCors: false,
  liff: {
    liffId: '1234567890-AbcdEfgh',
    sendOn: 'landed',
    messageTemplate: '我中了「{prize}」！',
    closeAfterSend: false
  }
};
```

前台與後台都會讀同一份 `config.js`。前台用 `GET` 讀獎項資料；後台用 `GET` 載入資料，並用 `POST` 儲存 `{ sheet, items }`。

## LIFF 傳送中獎訊息

前台會在獎項確定後呼叫 `liff.sendMessages()`，把中獎內容送回目前開啟 LIFF 的 LINE 聊天視窗。若使用者是從官方帳號聊天室開啟 LIFF，訊息就會送到該官方帳號聊天室。

設定方式：

- 在每個活動的 `config.js` 填入 `liff.liffId`
- LINE Developers Console 的 LIFF app 需啟用 `chat_message.write` scope
- `sendOn: 'landed'` 代表轉盤停下、獎項確定後立即送出
- `sendOn: 'confirm'` 代表使用者按結果視窗的「確認」後才送出
- `messageTemplate` 可使用 `{activity}`、`{prize}`、`{landedAt}`

注意：`liff.sendMessages()` 只能送到「開啟此 LIFF app 的聊天室」。如果使用者從外部瀏覽器、Keep Memo、最近使用服務，或非聊天視窗入口開啟，LINE 可能會拒絕傳送。

## Apps Script 回傳格式

前台可接受陣列，或 `{ items: [...] }`：

```json
[
  { "label": "獎項 A", "probability": 10, "color": "#F87171" },
  { "label": "獎項 B", "probability": "20%", "color": "#60A5FA" }
]
```

欄位相容：

- 獎項名稱：`label`、`name`、`獎項`、`名稱`
- 權重：`weight`、`probability`、`機率`、`概率`、`百分比`
- 顏色：`color`、`colour`、`顏色`

權重為 0 的獎項不會被抽中。若資料來源無法讀取或所有權重都是 0，前台會停用開始按鈕。

## 維護方式

共用邏輯只改這三個檔案：

- `shared/app.js`
- `shared/admin.js`
- `shared/style.css`

新增活動時，複製任一活動資料夾，改 `index.html` / `admin.html` 標題與 `config.js` 即可。
