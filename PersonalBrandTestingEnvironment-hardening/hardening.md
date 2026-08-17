# Security Hardening Review: PERSONA LIFF Member Platform

## Evidence Basis

本分析綁定 14 個現況檔案與更新後集合摘要 `569429a7bbc36b4aa65966c7e94814467a34e2ffa5f53ae80ba6f5cccc4e225b`。我檢查了雙 LIFF、共享 transport、兩個前端控制器、兩套 GAS dispatch/validator、部署文件與主要測試。現有安全邊界是合理的：會員與管理使用不同 LINE audience 和不同 GAS；問題在於 contract ownership 與狀態管理仍分散，讓後續功能增加時容易產生同步漂移。

工作樹的 source evidence 相對 `32e23b995679a046f25a783647d94de3acb811b2` 沒有實質漂移；上一輪記錄的 `client/index.html` 空白變更已由外部移除。

## Constraints

我們採 balanced 假設：優先保留 GitHub Pages、原生 HTML/CSS/JS、雙 GAS 部署、現有 Spreadsheet schema、request ID 冪等與 fetch-first/bridge-fallback。沒有提供實測流量、延遲 SLO 或資料量，因此效能判斷均標示為 source-derived 或 hypothetical，而不是測量結果。

## Opportunity Portfolio

| Opportunity | Evidence | Options | Recommendation | Proposal |
| --- | --- | --- | --- | --- |
| 集中 action contract ownership，拆分大型 composition root，同時維持雙 GAS 權限邊界 | 大型前端控制器、transport domain 白名單、雙 GAS 手工 dispatch（E001–E006） | 1. 目標式抽取；2. 雙 GAS 模組化單體；3. 受管 API 與交易帳本 | 在現有規模與相容性要求下選 Option 2 | [完整提案](proposals/centralize-action-contracts.md) |

## Recommendation Summary

我建議 Option 2「雙 GAS 模組化單體」。我們可以保留目前最重要的安全隔離與部署模型，將 action 定義、欄位驗證、handler 與 response contract 收斂成每個部署各自擁有的 command registry；瀏覽器 transport 只負責 envelope 和傳輸。前端則用每頁 composition root 組裝 session、service、view 與 domain contract，逐步抽離 `client/script.js` 和 `admin/script.js`，不需要一次改寫。

Option 1 適合短期只需要降低單一頁面風險時；它的主要缺點是 control ownership 仍分散。Option 3 只有在 Sheets 鎖競爭、稽核查詢或交易一致性已成為可量測瓶頸時才值得，因為它會引入資料遷移、服務營運與雙權限面重建。

## Implementation Status

已選定並在本機工作樹完成 Option 2 的第一個可回滾批次：會員／管理 action adapter、envelope-only transport、顯式 composition root、每頁 admin module，以及兩套 GAS 各自的 command registry。實作計畫與驗證結果見 [`implementation/modular-dual-gas.md`](implementation/modular-dual-gas.md)。正式 GAS 與前端部署未執行，仍需另外明確授權。
