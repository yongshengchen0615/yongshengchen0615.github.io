# Master Access Auth WebApp（方案 A）部署步驟

這個 WebApp 用來做「師傅核准 → 產生一次性授權連結」的認證，不依賴 LINE。

## 1) 建立 Apps Script 專案

1. 到 https://script.google.com 建立新專案
2. 把本資料夾的 `Code.gs` 內容貼到 Apps Script 的 `Code.gs`
3. 綁定一個 Spreadsheet（作為 Invites/Sessions 儲存）
   - 建議：在 Apps Script 編輯器左上角選「專案設定 / 更改專案」或直接在 Spreadsheet 裡用「擴充功能 → Apps Script」建立

## 2) 設定 Script Properties

Apps Script → **Project Settings** → **Script properties** 新增：

- `AUTH_SECRET`：長隨機字串（建議 32+ 字元）
- `MASTER_PASSPHRASE`：師傅管理密碼（用於產生邀請連結）

> 注意：這裡的 `MASTER_PASSPHRASE` 不是客人的密碼，客人不需要輸入任何密碼。

## 3) 部署成 WebApp

1. Deploy → New deployment
2. Type 選 Web app
3. **Execute as：Me**
4. **Who has access：Anyone**（或 Anyone with the link）
5. Deploy 後複製 WebApp URL（以 `/exec` 結尾）

你可以先用瀏覽器打開該 `/exec`，應該會回一段 JSON 並列出 endpoints。

## 4) 把 `/exec` URL 貼回前端設定

把剛剛部署得到的 Auth WebApp `/exec` URL 填到以下兩個檔案的 `AUTH_ENDPOINT`：

- `MasterStatus/Master_10/MasterVacationAdmin/config.json`
- `MasterStatus/Master_10/MasterPublicStatus/config.json`

> `DATE_DB_ENDPOINT` / `VACATION_DATE_DB_ENDPOINT` 維持原本 DateDB 那支即可。

## 5) 使用流程

- 師傅開 `MasterVacationAdmin` → 在「客人看板授權」輸入管理密碼 → 產生連結
- 客人用連結開 `MasterPublicStatus?token=...`
- 首次會把 token 兌換成 session，之後用 session 自動通過

## 常見問題

### 看到 `UNSUPPORTED_POST`
代表你 `AUTH_ENDPOINT` 還是指到 DateDB WebApp（沒有 auth 路由）。請確認已換成新的 Auth WebApp `/exec`。
