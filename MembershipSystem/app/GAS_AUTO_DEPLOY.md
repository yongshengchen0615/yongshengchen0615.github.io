# MembershipSystem GAS 自動部署

`MembershipSystem/app/gas/**` 已由 GitHub Actions workflow：

```text
.github/workflows/deploy-membership-gas.yml
```

負責部署到既有 Google Apps Script Web App。

## 自動部署條件

只有以下情況會部署：

```text
push 到 main
且
MembershipSystem/app/gas/** 有變更
```

也可以從 GitHub Actions 手動執行 `Deploy MembershipSystem GAS` 做首次驗證或重新部署。

前端 `user/`、`admin/`、`shared/` 的一般修改不會觸發 GAS deploy。

## Source of Truth

啟用後：

```text
MembershipSystem/app/gas/
```

是 MembershipSystem GAS 的唯一正式 source of truth。

`clasp push` 會以 Repository 內容更新 Apps Script project。因此不要在 Apps Script Web Editor 留下未同步回 GitHub 的正式修改；下一次自動部署可能覆蓋它們。

## 一次性設定

### 1. 啟用 Apps Script API

使用部署 GAS 的 Google 帳號登入 Apps Script，確認 Apps Script API 已啟用。

### 2. 取得 Script ID

在 MembershipSystem 的 Apps Script project：

```text
Project Settings
→ IDs
→ Script ID
```

複製 Script ID。

### 3. 建立 clasp OAuth credential

在自己的電腦安裝與 CI 相同版本的 clasp：

```bash
npm install -g @google/clasp@3.3.0
clasp login --no-localhost
```

依 Google OAuth 流程完成授權後，clasp 會建立使用者層級的 `.clasprc.json` OAuth credential。

不要把 `.clasprc.json` commit 到 GitHub，也不要貼到 Issue、PR、Log 或聊天內容。

### 4. 設定 GitHub Actions Secrets

到 Repository：

```text
Settings
→ Secrets and variables
→ Actions
→ Repository secrets
```

新增：

#### `MEMBERSHIP_GAS_SCRIPT_ID`

內容：MembershipSystem Apps Script project 的 Script ID。

#### `MEMBERSHIP_GAS_CLASPRC_JSON`

內容：本機 clasp 登入後產生的完整 `.clasprc.json` JSON。

這個 Secret 含 OAuth credential，必須視為敏感 Credential。

## Deployment ID

不需要另外設定 deployment ID。

Workflow 會讀取：

```text
MembershipSystem/app/shared/config.json
```

中的：

```text
GAS_WEB_APP_URL
```

並從：

```text
https://script.google.com/macros/s/<deploymentId>/exec
```

解析既有 deployment ID。

部署前 workflow 會先用 clasp 列出該 Script ID 的 deployments，確認目前 `config.json` 的 deployment ID 確實屬於同一 Apps Script project。

若不相符，workflow 會 fail closed，不執行 `clasp push`。

## Workflow 安全邊界

Workflow 採以下限制：

- 只在 `main` 的 GAS 路徑變更時自動執行。
- GitHub token 只有 `contents: read`。
- checkout 不保留 GitHub credential。
- `actions/checkout` 與 `actions/setup-node` 使用完整 commit SHA pin。
- `@google/clasp` 固定 `3.3.0`，不使用 `latest`。
- OAuth auth file 只寫入 GitHub Runner 暫存目錄，權限設為 `600`。
- 不把 `.clasprc.json`、client secret、service-account credential 放進 GAS source。
- GAS source 與 `appsscript.json` 先做 syntax / JSON validation。
- 先驗證 Script ID / deployment ID 關係，再允許 push。
- 使用 existing deployment update，不建立新的 Web App URL。
- concurrency 不取消已開始的 production deployment，避免兩個 deploy 互相中斷。

## 首次驗證

Secrets 設定完成後：

```text
GitHub
→ Actions
→ Deploy MembershipSystem GAS
→ Run workflow
```

確認以下步驟全部成功：

```text
Validate deployment secrets
Validate GAS source
Resolve current Web App deployment
Install pinned clasp
Prepare clasp configuration
Verify target deployment belongs to configured script
Show files that will be pushed
Push GAS source
Update existing Web App deployment
Confirm deployment still exists
```

首次成功後，後續只要：

```text
MembershipSystem/app/gas/**
```

有程式變更並進入 `main`，就會自動部署。

## Rollback

若新的 GAS commit 有問題，推薦 rollback：

```text
revert 該 GitHub commit
→ push / merge 回 main
→ workflow 自動重新部署上一版 source
```

不要用修改前端 Permission 或跳過 Authentication 的方式做緊急 workaround。

## Credential Rotation

若 Google OAuth credential 被撤銷、過期或疑似外洩：

1. 在 Google 帳號撤銷舊 clasp OAuth authorization。
2. 重新執行 `clasp login --no-localhost`。
3. 更新 GitHub Secret `MEMBERSHIP_GAS_CLASPRC_JSON`。
4. 手動執行一次 workflow 驗證。
