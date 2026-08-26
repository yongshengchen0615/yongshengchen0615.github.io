# Operation loading behavior checks

- Bulk create: submitting a valid batch shows `正在建立 N 筆事項` until the bulk modal closes or an error is shown.
- Bulk update: loading appears only after the action enters its disabled/busy state.
- Bulk archive: cancelling the confirmation must not show or retain the loading overlay.
- Successful bulk writes transition to `正在同步日曆` while the authoritative calendar list refreshes.
- Manual `同步資料` uses the same loading overlay.
- `同步失敗` releases the blocking overlay after showing a short failure state.
- A 45-second visual safety timeout prevents a stale overlay from blocking the UI indefinitely; underlying request guards remain authoritative.
