# LINE 預約通知

## 行為

- 新增 pending 預約：由管理端官方帳號通知目前 `role=admin`、`status=active` 的管理員。
- pending → confirmed：由會員端官方帳號通知該筆預約所屬會員。
- 重複送出相同預約或重複確認不重寄。取消、拒絕、完成及單純備註修改不寄送這兩種通知。
- 通知包含預約編號、預約人、台北日期與時段、項目及對應 LIFF 連結。
- 不補寄部署前的既有預約。LINE 回傳 accepted 表示平台已接受，不代表使用者已閱讀或一定收到；會員仍須符合 LINE 的好友／可推播條件。

## 架構

預約交易的 deferred trigger 在項目與聯絡資料寫入完成後建立私有 outbox。交易提交後，以 pg_net 喚醒 `booking-line-notifications` Edge Function；每分鐘 cron 補處理待送／逾期任務。

Edge Function 驗證專用密鑰，只從資料庫領取任務，不接受呼叫端指定的收件人、內容或 channel。LINE token 存在 Vault，由僅授權 service_role 的 RPC 讀取，不出現在前端、GitHub 或 pg_net 請求。pg_net 只持有可喚醒此功能的限定密鑰，即使重複喚醒也不能任意發訊。

任務領取以 `FOR UPDATE SKIP LOCKED` 與兩分鐘 lease 防止重複處理；完成結果需符合當次 attempt，舊結果不能覆蓋新嘗試。固定 outbox UUID 作為 LINE retry key，重送保留收件人與訊息快照。網路錯誤、429、5xx 採退避重試，最多五次且限首次嘗試後十二小時內；其他 4xx 留下 failed 紀錄。409 只有帶 accepted-request-id 才視為已接受。

## 部署

1. 依順序套用三個 `20260914065445`、`20260914065806`、`20260914070053` migrations。保留實際部署歷史；最終實作以第三個 migration 的 Edge transport 為準。初始設定停用發送。
2. 在 Vault 設定 `LINE_BOOKING_ADMIN_CHANNEL_ACCESS_TOKEN`、`LINE_BOOKING_MEMBER_CHANNEL_ACCESS_TOKEN`，不得寫入 SQL 檔。專用 `BOOKING_NOTIFICATION_DISPATCH_SECRET` 由 migration 產生；沿用既有 `project_url`。
3. 部署 `functions/booking-line-notifications/index.ts` 與 `delivery.ts`，`verify_jwt=false`；函式自行驗證 x-dispatch-secret。沿用 server 環境 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY。
4. 驗證兩個 token 的 bot info，以及 admins / members 的 LINE profile 對應。LINE Login 與相應 Messaging API channel 須使用可對應相同 user ID 的 provider 設定。
5. 以資料庫擁有者執行 `tests/booking_line_notifications.sql`；整段 transaction 會 rollback，不會送出測試通知。再執行 `node --test MemberWebsocket-dev/tests/booking_line_notifications.test.js`。
6. 通過後：`update booking_notifications.config set enabled=true where id;`。

無須修改前端或重新部署現有預約 API。

## 驗證紀錄（2026-09-14）

- bot info / 既有管理員與會員 profile 均回傳 HTTP 200。
- 資料庫整合測試通過：觸發條件、完整快照、會員歸屬、去重、lease、舊 attempt 拒絕、重試上限、停用管理員與 RPC 權限。
- 四項 Node 測試通過：push payload、固定 retry key、LINE 各類回應、網路錯誤、密鑰比較。
- 所有預約測試資料與模擬發送均 rollback；未發出實際預約測試訊息。正式端到端驗收須以新預約及管理員確認操作檢查兩支 LINE 帳號的實際收件。
- Security Advisor：新表位於私有 schema 且 RLS 拒絕客戶端存取，因此沒有 client policy 屬預期。既有 pg_net 安裝於 public 的平台警告保留，未搬移共用 extension；[平台說明](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)。第二個 migration 的 pg_net 權限撤銷在受管理平台可能無效，因此第三個 migration 完全移除 pg_net 中的 LINE token。

## 維運與回復

以 SQL Console 查詢 `booking_notifications.outbox` 的 status、attempt_count、last_error、line_request_id。`accepted` 為 LINE 接受，`failed` 需查原因；不在前端暴露個資與 token。

暫停新發送：`update booking_notifications.config set enabled=false where id;`。已領取或正在 HTTP 發送的任務仍可能完成。outbox 與預約資料保留，重新啟用可繼續未完成任務。勿刪除 outbox 或替換重試 UUID 後重寄，避免重複通知。

修復 token 或收件問題後，僅對明確尚未接受且仍在十二小時重試窗內的指定任務重設 pending；保留 id / recipient / message_text。超出重試窗的任務先人工查核，避免 LINE 重試鍵失效後重複寄送。

LINE 重試依據：[LINE retry API requests](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)。
