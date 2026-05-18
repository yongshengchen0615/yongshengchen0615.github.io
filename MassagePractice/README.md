# 學員審核系統

這是一組靜態 `HTML/CSS/JS` 前端加上 Google Apps Script 後端：

- `student/`: 學員使用 LINE Login 登入，或在測試模式使用 `config.json` 的測試學員登入；審核通過後可簽到、簽退，並記錄練習；若師資啟用定位限制，操作前會要求瀏覽器定位。
- `teacher/`: 師資使用 LINE Login 登入，或在測試模式使用 `config.json` 的測試師資登入；GAS 會建立師資資料，手動在 Google Sheet 將師資狀態改為通過後，才能讀取學員名單、審核學員、管理練習對象與項目、設定定位範圍，查看紀錄，或移除學員。
- `gas/Code.gs`: GAS Web App 後端，負責 LINE token exchange、ID token 驗證、寫入 Google Sheet、簽到紀錄與練習紀錄。

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

GAS 也會建立 `attendance` 工作表，欄位如下：

```text
id, studentUuid, lineUserId, lineName, checkInAt, checkOutAt, createdAt, updatedAt, checkInLatitude, checkInLongitude, checkInAccuracyMeters, checkInDistanceMeters, checkOutLatitude, checkOutLongitude, checkOutAccuracyMeters, checkOutDistanceMeters
```

每次簽到會新增一筆紀錄；簽退會補上同一筆紀錄的 `checkOutAt`。

GAS 也會建立練習設定與練習紀錄工作表：

```text
practice_targets: id, name, enabled, createdAt, updatedAt
practice_items: id, name, enabled, createdAt, updatedAt
practice_records: id, studentUuid, lineUserId, lineName, targetId, targetName, itemId, itemName, startedAt, endedAt, createdAt, updatedAt, startLatitude, startLongitude, startAccuracyMeters, startDistanceMeters, endLatitude, endLongitude, endAccuracyMeters, endDistanceMeters
location_settings: id, name, enabled, latitude, longitude, radiusMeters, updatedAt
```

GAS 也會建立 `teachers` 工作表，欄位如下：

```text
uuid, lineUserId, lineName, linePictureUrl, status, createdAt, updatedAt, approvedAt, reviewNote, publicToken
```

師資第一次登入後會新增一列，`status` 預設為 `pending`。手動把該列 `status` 改成 `approved` 後，此 LINE 帳號就可以使用師資系統；可填 `rejected` 表示未通過。

學員開始練習會新增一筆 `practice_records`；結束練習會補上同一筆紀錄的 `endedAt`。

`location_settings` 預設不啟用。師資端儲存定位範圍後，GAS 會在學員簽到、簽退、開始練習、結束練習時檢查學員送出的定位是否落在半徑內，並把距離與定位精準度寫入紀錄。

## 部署步驟

1. 建立 Google Sheet，打開「擴充功能 > Apps Script」。
2. 將 `gas/Code.gs` 貼到 Apps Script。若有使用 manifest，將 `gas/appsscript.json` 的內容放到專案設定的 manifest。
3. 在 Apps Script「專案設定 > 指令碼屬性」新增：

```text
LINE_CHANNEL_ID=你的 LINE Login Channel ID
LINE_CHANNEL_SECRET=你的 LINE Login Channel secret
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
  "enableLineLogin": true,
  "lineChannelId": "你的 LINE Login Channel ID",
  "gasWebAppUrl": "你的 GAS Web App /exec URL",
  "studentRedirectUri": "https://你的網域/student/",
  "testStudent": {
    "lineUserId": "student-001",
    "lineName": "測試學員",
    "linePictureUrl": ""
  },
  "enableDebug": false
}
```

7. 修改 `teacher/config.json`：

```json
{
  "appName": "學員審核系統",
  "enableLineLogin": true,
  "lineChannelId": "你的 LINE Login Channel ID",
  "gasWebAppUrl": "你的 GAS Web App /exec URL",
  "teacherRedirectUri": "https://你的網域/teacher/",
  "testTeacher": {
    "lineUserId": "teacher-001",
    "lineName": "測試師資",
    "linePictureUrl": ""
  },
  "enableDebug": false
}
```

8. 到 LINE Developers Console 的 LINE Login channel，把 Callback URL 加入與 `student/config.json` 的 `studentRedirectUri`、`teacher/config.json` 的 `teacherRedirectUri` 完全相同的 URL。
9. 將前端檔案放到 HTTPS 靜態主機，例如 GitHub Pages、Cloudflare Pages、Netlify 或自己的主機。

既有部署更新此版本後，也要重新貼上 `gas/Code.gs`、執行一次 `setup()`，再建立新版本部署，讓新增欄位、`teachers` 與 `location_settings` 工作表生效。

## 使用方式

- 學員入口：`student/`
- 師資入口：`teacher/`
- `enableLineLogin` 設為 `false` 時，前端不會開啟 LINE OAuth，會改用 `testStudent` 或 `testTeacher` 的資料登入。測試登入建立的 `lineUserId` 會以 `test:student:` 或 `test:teacher:` 前綴寫入 Sheet。
- 學員審核通過後，可以在學員系統按「簽到」與「簽退」，也可以選擇練習對象與練習項目後開始/結束練習；選「其他」時可自行輸入對象或項目。
- 師資第一次進入 `teacher/` 後使用 LINE 或測試登入；登入後到 Google Sheet 的 `teachers` 工作表，把該師資列的 `status` 改成 `approved`，再回到師資頁按「重新檢查」即可載入名單，並審核、管理練習選項、設定定位範圍、查看簽到/練習紀錄或移除學員。
- 師資在「定位範圍」可輸入地點名稱與半徑；座標可用「使用目前定位」帶入，或開啟地圖後直接點選位置再儲存。

## 注意事項

- `LINE_CHANNEL_SECRET` 不要放在前端，只能放在 GAS Script Properties。
- LINE OAuth 的 `redirect_uri` 必須與 LINE Developers Console 登記的 Callback URL 完全一致。
- `enableLineLogin: false` 是測試模式，公開部署前請改回 `true`，避免任何知道網址的人用測試身份寫入資料。
- `student/config.json` 與 `teacher/config.json` 是兩份獨立設定檔，各自從自己的系統目錄讀取；JSON 不能加註解或尾端逗號。
- 學員系統與師資系統頁面不提供彼此切換連結，請分別提供對應入口網址。
- 前端呼叫 GAS 使用 `Content-Type: text/plain`，避免瀏覽器對 GAS Web App 送出 OPTIONS preflight。
- 正式登入需要 HTTPS URL；直接用 `file://` 打開頁面只能預覽 UI，不能作為 LINE Callback URL。
- 瀏覽器定位需要 HTTPS 或 localhost；若學員拒絕定位權限，定位限制啟用時無法簽到、簽退或記錄練習。
- 師資端地圖選點使用 Leaflet 與 OpenStreetMap 圖磚，不需要 Google Maps API key。
- 這是 Web App 端的定位門檻，能阻擋一般不在範圍內的操作，但無法取代專用打卡硬體或 MDM 等防竄改控管。

## 官方文件

- LINE Login Web App 流程：https://developers.line.biz/en/docs/line-login/integrate-line-login/
- LINE Login v2.1 API：https://developers.line.biz/en/reference/line-login/
- Google Apps Script Web Apps：https://developers.google.com/apps-script/guides/web
- Apps Script PropertiesService：https://developers.google.com/apps-script/reference/properties/properties-service
- Leaflet：https://leafletjs.com/
- OpenStreetMap：https://www.openstreetmap.org/
