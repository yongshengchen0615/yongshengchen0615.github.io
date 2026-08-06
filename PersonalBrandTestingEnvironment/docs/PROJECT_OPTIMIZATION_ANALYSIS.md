# PersonalBrandTestingEnvironment 專案分析與優化追蹤

## 作業基準

- Repository：`yongshengchen0615/yongshengchen0615.github.io`
- 目錄：`PersonalBrandTestingEnvironment`
- Base branch：`main`
- Base SHA：`364cd1cadc9b7d72447dfefcc83f2b92f2b2ff6b`
- Working branch：`agent/analyze-and-optimize-personal-brand`
- 建立日期：2026-08-06

## 分支與發布限制

- 所有分析、程式碼、測試、CI 與文件修改只提交到本作業分支。
- 不直接修改或推送 `main`。
- 不使用 force push。
- 不建立可自動修改或推送 `main` 的 workflow。
- 不啟用 auto-merge，也不自動合併 PR。
- 若 `main` 更新，只在本分支合併最新 `origin/main`，並重新執行完整驗證。

## 分析範圍

後續將依序盤點並記錄：

1. 會員端與管理員端 HTML、CSS、JavaScript。
2. shared runtime、LIFF 初始化、GAS transport 與公開 config。
3. 點數、集點卡、QR 領點與抽獎流程。
4. 會員 GAS、管理員 GAS、Spreadsheet 資料流、Lock 與冪等性。
5. 測試、GitHub Actions、部署、回滾與 legacy compatibility。
6. 正確性、安全性、效能、UI/UX、無障礙與維護性風險。

## 優先級定義

### P0

資料遺失、重複扣券、重複領點、權限繞過、敏感資訊外洩或正式功能中斷。

### P1

明顯效能、穩定性、錯誤恢復、使用流程、維護性與測試缺口。

### P2

低風險架構改善、程式碼整理、進階效能與後續擴充。

## 目前狀態

- [x] 確認預設分支與最新 `main` SHA。
- [x] 建立獨立作業分支。
- [x] 建立分析追蹤文件。
- [ ] 完成逐檔盤點。
- [ ] 完成架構與資料流分析。
- [ ] 完成 P0／P1／P2 分類。
- [ ] 完成最小可行優化批次。
- [ ] 完成 JavaScript、GAS 與完整 Node 測試。
- [ ] 完成 GitHub Actions 驗證。
- [ ] 更新部署、實機驗證與回滾文件。
- [ ] 將 Draft PR 轉為 Ready for review。

## 驗證基線

預計執行：

```bash
find PersonalBrandTestingEnvironment -type f -name '*.js' -print0 |
  while IFS= read -r -d '' file; do
    node --check "$file"
  done

node --test PersonalBrandTestingEnvironment/tests/*.test.js
```

GAS 將複製為暫存 `.js` 後執行 `node --check`，不修改正式 `.gs` 檔案。

## 注意事項

正式 LINE LIFF、Apps Script cold start、正式 Spreadsheet 資料量、WebView 快取與實際網路耗時無法只由 repository 證明；相關結論必須標示為需要實機或正式環境驗證，不捏造效能數字。
