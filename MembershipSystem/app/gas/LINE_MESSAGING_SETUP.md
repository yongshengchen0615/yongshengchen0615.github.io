# LINE 官方帳號推播設定

會員系統的「累計消費分鐘發放」可在分鐘成功寫入後，透過 LINE Messaging API 對該會員發送文字推播。

## 必要設定

1. 在 LINE Developers Console 確認此會員系統使用的 LINE Login / LIFF Channel 與 LINE 官方帳號的 Messaging API Channel 位於**同一個 Provider**。
2. 在 Messaging API Channel 取得 Channel Access Token。
3. 到會員系統 GAS 專案的 **Project Settings → Script Properties** 新增：

```text
LINE_MESSAGING_CHANNEL_ACCESS_TOKEN=<你的 Channel Access Token>
```

Channel Access Token 是 Secret：

- 不可寫入 GitHub Repository。
- 不可放在前端 HTML / JavaScript / config JSON。
- 不可寫入 AuditLogs 或瀏覽器 Log。
- 僅由 GAS `PropertiesService.getScriptProperties()` 讀取。

## 部署

GitHub Pages 更新不會自動更新 GAS Web App。同步以下 GAS 檔案後，必須建立新的 Web App deployment version：

- `Code.gs`
- `MinuteGrantService.gs`
- `LineMessagingService.gs`
- 以及既有 `ProfileManagement.gs` / `TierManagement.gs` / `UsageAdmin.gs`

部署完成後 `doGet()` 的 service version 應為 `1.9.0`。

## 發放流程

```text
Admin LIFF Authentication
→ admin.minutes.grant
→ Server-side requireAdmin_
→ requestId idempotency + ScriptLock
→ Audit requested
→ MinuteGrants processing
→ Members.consumedMinutes += minutes
→ 重新計算 Membership Tier
→ Audit success
→ MinuteGrants recorded
→ LINE push (outside mutation lock)
→ 保存 pushStatus / pushErrorCode
```

LINE 推播失敗不會回滾已完成的分鐘發放。管理端可從「分鐘發放」最近紀錄按「重試推播」。同一筆發放使用固定 `X-Line-Retry-Key`，避免 LINE API 重試造成重複送出。

## 資料表

第一次使用功能時，GAS 會自動建立 `MinuteGrants` Sheet，紀錄發放對象、分鐘、原因、發放前後累計、等級變化、管理員、Audit 與 Push 狀態。

會員端 `member.minutes.grants.list` 僅依伺服器驗證後的 `context.identity.sub` 回傳該會員自己的紀錄，不接受 Client 指定其他會員 ID。
