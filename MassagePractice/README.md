# 學員審核系統

這是一組靜態 `HTML/CSS/JS` 前端加上 Google Apps Script 後端：

- `student/`: 學員使用 LINE Login 登入，送出 LINE UUID、LINE 名稱、LINE 照片到 GAS。
- `teacher/`: 師資輸入管理密鑰後讀取學員名單，設定待審核、通過、未通過，或移除學員。
- `gas/Code.gs`: GAS Web App 後端，負責 LINE token exchange、ID token 驗證、寫入 Google Sheet。

## 檔案

```text
index.html
student/index.html
student/config.json
student/css/styles.css
student/js/api.js
student/js/student.js
teacher/index.html
teacher/config.json
teacher/css/styles.css
teacher/js/api.js
teacher/js/teacher.js
gas/Code.gs
gas/appsscript.json
```

## Google Sheet 欄位

GAS 會建立 `students` 工作表，欄位如下：

```text
uuid, lineUserId, lineName, linePictureUrl, status, createdAt, updatedAt, approvedAt, reviewNote, publicToken
```

`lineUserId` 是 LINE 回傳的使用者 UUID；`uuid` 是系統內部學員 UUID；`publicToken` 只給學員端查自己的審核狀態。

## 部署步驟

1. 建立 Google Sheet，打開「擴充功能 > Apps Script」。
2. 將 `gas/Code.gs` 貼到 Apps Script。若有使用 manifest，將 `gas/appsscript.json` 的內容放到專案設定的 manifest。
3. 在 Apps Script「專案設定 > 指令碼屬性」新增：

```text
LINE_CHANNEL_ID=你的 LINE Login Channel ID
LINE_CHANNEL_SECRET=你的 LINE Login Channel secret
ADMIN_KEY=給師資端使用的長密鑰
```

如果 GAS 不是綁定在 Google Sheet，另外設定：

```text
SPREADSHEET_ID=你的 Google Sheet ID
```

4. 在 Apps Script 執行 `setup()` 一次並完成授權。
5. 「部署 > 新增部署 > 網頁應用程式」：
   - 執行身分：我
   - 存取權：任何人
   - 複製部署後的 `/exec` URL。
6. 修改 `student/config.json`：

```json
{
  "appName": "學員審核系統",
  "lineChannelId": "你的 LINE Login Channel ID",
  "gasWebAppUrl": "你的 GAS Web App /exec URL",
  "studentRedirectUri": "https://你的網域/student/",
  "enableDebug": false
}
```

7. 修改 `teacher/config.json`：

```json
{
  "appName": "學員審核系統",
  "gasWebAppUrl": "你的 GAS Web App /exec URL",
  "enableDebug": false
}
```

8. 到 LINE Developers Console 的 LINE Login channel，把 Callback URL 設成與 `student/config.json` 的 `studentRedirectUri` 完全相同的 URL。
9. 將前端檔案放到 HTTPS 靜態主機，例如 GitHub Pages、Cloudflare Pages、Netlify 或自己的主機。

## 使用方式

- 學員入口：`student/`
- 師資入口：`teacher/`
- 師資輸入 `ADMIN_KEY` 後可以載入名單，並審核或移除學員。

## 注意事項

- `LINE_CHANNEL_SECRET` 和 `ADMIN_KEY` 不要放在前端，只能放在 GAS Script Properties。
- LINE OAuth 的 `redirect_uri` 必須與 LINE Developers Console 登記的 Callback URL 完全一致。
- `student/config.json` 與 `teacher/config.json` 是兩份獨立設定檔，各自從自己的系統目錄讀取；JSON 不能加註解或尾端逗號。
- 前端呼叫 GAS 使用 `Content-Type: text/plain`，避免瀏覽器對 GAS Web App 送出 OPTIONS preflight。
- 正式登入需要 HTTPS URL；直接用 `file://` 打開頁面只能預覽 UI，不能作為 LINE Callback URL。

## 官方文件

- LINE Login Web App 流程：https://developers.line.biz/en/docs/line-login/integrate-line-login/
- LINE Login v2.1 API：https://developers.line.biz/en/reference/line-login/
- Google Apps Script Web Apps：https://developers.google.com/apps-script/guides/web
- Apps Script PropertiesService：https://developers.google.com/apps-script/reference/properties/properties-service
