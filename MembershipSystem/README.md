# MembershipSystem — 會員卡 MVP

GitHub Pages 前端 + Google Apps Script（GAS）後端的會員卡系統，包含一般會員端與管理端。

## 資料夾結構

```text
MembershipSystem/
├─ index.html              # 舊入口相容導向 → user/
├─ user/
│  ├─ index.html           # 用戶端頁面
│  ├─ styles.css           # 用戶端樣式
│  └─ app.js               # 用戶端邏輯
├─ admin/
│  ├─ index.html           # 管理端頁面
│  ├─ styles.css           # 管理端樣式
│  └─ app.js               # 管理端邏輯
├─ shared/
│  ├─ config.json          # LIFF / GAS 公開設定
│  └─ common.js            # 設定載入、LIFF 初始化、強制重新登入與 API 共用邏輯
├─ gas/
│  ├─ Code.gs
│  └─ appsscript.json
└─ README.md
```

用戶端與管理端的 HTML / CSS / JS 已完全分開。`shared/` 只放兩邊必須共用的公開設定與 LIFF / API transport 邏輯，避免 Authentication 程式碼重複後產生版本差異。

## 前端設定 `shared/config.json`

```json
{
  "LIFF_ID": "YOUR_LIFF_ID",
  "GAS_WEB_APP_URL": "YOUR_GAS_WEB_APP_URL"
}
```

`common.js` 會先以 `fetch()` 載入並驗證 `config.json`，再初始化 LIFF。`config.json` 會由 GitHub Pages 公開提供，因此只能放前端本來就能公開知道的設定，例如 LIFF ID 與 GAS Web App URL；**不得放 LINE Channel Secret、Access Token、API Secret、Password 或其他秘密。**

## LIFF 重新登入政策

每次完整開啟或重新整理 `user/` / `admin/` 都必須重新建立本次 LIFF 登入狀態。

- 外部瀏覽器 / LINE 內建瀏覽器：初始化 LIFF 後，既有 LIFF session 會先 `liff.logout()`，再執行 `liff.login()`。
- Login callback 使用一次性隨機 nonce，nonce 同時存在 query parameter 與當前 tab 的 `sessionStorage`；兩者一致才視為本次強制登入完成。
- callback 成功後立即刪除 nonce，因此重新整理、再次開啟或切換到另一個前端頁面都會重新走登入流程。
- 偽造 `__membership_reauth` query parameter 無法跳過登入，因為沒有相符的一次性 browser nonce。
- LIFF Browser 不能手動呼叫 `liff.login()`；該環境會在每次頁面開啟時重新執行 `liff.init()`，由 LINE 自動完成登入並重新檢查 ID Token。
- 此政策不保證 LINE 一定顯示帳密輸入畫面；若 LINE 平台本身可使用 SSO，登入畫面可能自動完成，但本系統不會沿用前一次頁面的 LIFF application session。

## URL

- 相容入口：`https://yongshengchen0615.github.io/MembershipSystem/` → 自動導向用戶端。
- 用戶端：`https://yongshengchen0615.github.io/MembershipSystem/user/`
- 管理端：`https://yongshengchen0615.github.io/MembershipSystem/admin/`

既有 LIFF Endpoint 若仍設定為 `https://yongshengchen0615.github.io/MembershipSystem/` 可以保留；根目錄會固定導向 `user/`。

## 功能

### 用戶端 `user/`
- LINE LIFF 登入。
- 每次重新開啟 / 重新整理都重新建立 LIFF 登入狀態。
- 第一次登入自動建立會員資料與唯一會員編號。
- 顯示會員姓名、頭像、會員編號、等級、會員狀態、加入日期與有效期限。
- 用戶端不顯示管理端入口與登出按鈕；管理端使用獨立 `admin/` URL。

### 管理端 `admin/`
- 每次重新開啟 / 重新整理都重新建立 LIFF 登入狀態。
- 頁面可公開載入，但會員資料 API 必須通過 GAS server-side Authentication + Authorization。
- 會員總數 / 有效 / 停權與停用統計。
- 依會員編號或名稱搜尋。
- 修改會員等級、會員狀態、有效期限、管理備註。
- 使用 `expectedUpdatedAt` 做樂觀鎖，降低多人同時修改造成覆寫的風險。

## Domain Model

- **Identity**：LINE `sub`，由 LINE ID Token 驗證取得。
- **Authentication**：LIFF ID Token → GAS → LINE Verify ID Token API。
- **Permission / Authorization**：`Members.canManageMembers` 是管理會員權限，由 GAS server-side 判斷。
- **Membership**：memberNo、tier、membershipStatus、joinedAt、expiresAt。
- **Profile**：displayName、pictureUrl。
- **Audit Event**：會員建立與管理端會員修改事件。

`tier` 只代表 Membership Level，不會授予管理 Permission。

## Google Sheet Schema

GAS 第一次使用時會自動建立工作表及必要欄位；既有工作表缺欄時也會自動補欄並保留資料。

### `Members`

`lineUserId | memberNo | displayName | pictureUrl | tier | membershipStatus | joinedAt | expiresAt | note | createdAt | updatedAt | canManageMembers`

`canManageMembers`：
- 新會員預設 `FALSE`。
- 手動改成 `TRUE`：下一次 API request 即可使用管理 API。
- 改回 `FALSE`：下一次 API request 即撤銷管理權限。
- 此欄位不由前端 API 修改，只能由可信任的 Spreadsheet 編輯者管理。

### `AuditLogs`

`timestamp | actorLineUserId | actorRole | action | targetLineUserId | result | details`

### Schema 自動建立 / 補欄規則

- Sheet 不存在：自動建立。
- 必要欄位不存在：插入到預期位置。
- 額外自訂欄位：保留。
- 必要欄位被重新排序：回傳 schema error，避免寫錯欄。

## 部署

1. 建立 Google Spreadsheet。
2. 建立 Standalone Apps Script，放入 `gas/Code.gs` 與 `gas/appsscript.json`。
3. Script Properties 設定：
   - `SPREADSHEET_ID`
   - `LINE_CHANNEL_ID`
4. Deploy Web App：Execute as `Me`，Who has access `Anyone`。
5. LINE LIFF Scope 至少開啟 `openid`、`profile`。
6. 編輯 `shared/config.json`：
   - `LIFF_ID`
   - `GAS_WEB_APP_URL`
7. 第一次由用戶端登入，讓 GAS 自動建立會員資料。
8. 若要授予管理權，在 `Members` 該會員列把 `canManageMembers` 設為 `TRUE`。

## Security Notes

- `shared/config.json` 是公開前端資源，禁止放任何 Secret / Token / Password。
- 外部瀏覽器的強制重新登入 callback 使用 cryptographically random nonce + `sessionStorage` 比對，避免直接加 query parameter 跳過 re-auth flow。
- nonce 只用於 browser login handshake，不是 Authentication Token，不會傳送給 GAS，也不會寫入 Log / Sheet。
- 資料夾分離與隱藏管理端入口只負責前端組織與 UX，**不是 Authorization Boundary**。
- 管理端即使直接開啟 `admin/`，`admin.list` / `admin.update` 仍必須由 GAS 驗證有效 LINE ID Token 與 `canManageMembers`。
- 前端不信任 `liff.getProfile()` 作為後端 Identity；只把原始 ID Token 傳給 GAS。
- `canManageMembers` 不存在於 `admin.update` payload 白名單，Client 無法 Mass Assignment 自我升權。
- 不儲存 LINE ID Token / access token / secret，也不寫入 Sheet 或 Log。
- API 以會員編號操作，不把 LINE user ID 暴露給管理端瀏覽器。
- Spreadsheet 編輯權本身是 Permission Administration 的信任邊界，只能分享給可信任管理者。
- 手動修改 `canManageMembers` 目前不會自動寫入 `AuditLogs`；需要完整稽核時可加入 installable `onEdit` trigger。

## 驗證情境

- Forced login / external：已登入狀態開啟頁面 → logout → 新 nonce → `liff.login()` → callback nonce 驗證 → 才可呼叫 API。
- Forced login / refresh：登入完成後重新整理 → 舊 nonce 已刪除 → 再次執行強制登入。
- Forced login / forged callback：手動加入錯誤 `__membership_reauth` → 與 `sessionStorage` 不符 → 不接受 → 重新登入。
- LIFF Browser：每次頁面開啟 → `liff.init()` → LINE 自動登入 → 必須取得有效 ID Token。
- Config：`config.json` 無法讀取、JSON 無效或必要欄位缺失 → 前端顯示設定錯誤，不進入 LIFF / API 流程。
- Root compatibility：`MembershipSystem/` → `user/`。
- Admin entry：用戶端不提供管理端入口；直接開啟 `admin/` 仍需重新登入並通過 server-side Permission。
- Admin navigation：管理端可返回 `user/`，新頁面再次執行登入政策。
- Unauthenticated：無效 / 缺少 ID Token → GAS 拒絕。
- Unauthorized：`canManageMembers != TRUE` → 管理 API 拒絕。
- Privilege escalation：直接輸入 `admin/` URL、修改前端 JS 或偽造 tier → GAS 仍拒絕未授權管理 API。
- Concurrent admin update：`expectedUpdatedAt` 不一致 → `CONFLICT`。
