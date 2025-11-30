# 活動說明網站

一個具有現代化設計感的活動說明網站,所有內容都可以透過設定檔輕鬆修改。

## 檔案結構

```
a1/
├── index.html          # 主要 HTML 結構
├── style.css           # 樣式表
├── main.js            # 渲染邏輯
├── event-config.js    # 設定檔 (修改此檔即可更新內容)
└── README.md          # 說明文件
```

## 功能特色

✨ **現代化設計**
- 漸層背景與動畫效果
- 響應式設計,支援各種裝置
- 平滑的滾動動畫
- 懸停互動效果

📝 **設定檔管理**
- 所有文字內容集中在 `event-config.js`
- 無需修改 HTML 或 CSS
- 輕鬆更新活動資訊

🎨 **區塊設計**
1. 英雄區塊 - 主標題與副標題
2. 活動時間 - 突出顯示時間資訊
3. 活動說明 - 詳細介紹
4. 參加方式 - 步驟卡片
5. 注意事項 - 清單呈現
6. 獎品資訊 - 卡片網格
7. 聯絡資訊 - 聯絡方式
8. 頁尾 - 版權資訊

## 如何使用

### 1. 修改活動內容

編輯 `event-config.js` 檔案:

```javascript
const eventConfig = {
    title: "您的活動標題",
    subtitle: "您的副標題",
    time: "活動時間",
    description: "活動說明 HTML 內容",
    participationSteps: [...],
    notices: [...],
    prizes: [...],
    contact: {...},
    footer: "頁尾文字"
};
```

### 2. 開啟網站

直接用瀏覽器開啟 `index.html` 即可瀏覽。

### 3. 客製化樣式

如需修改顏色或樣式,可編輯 `style.css` 中的 CSS 變數:

```css
:root {
    --primary-color: #6366f1;
    --secondary-color: #8b5cf6;
    --accent-color: #ec4899;
    /* 更多變數... */
}
```

## 設定檔說明

### 基本資訊
- `title`: 主標題
- `subtitle`: 副標題
- `badge`: 徽章文字
- `time`: 活動時間

### 參加方式
```javascript
participationSteps: [
    {
        step: 1,
        title: "步驟標題",
        description: "步驟說明"
    }
]
```

### 獎品資訊
```javascript
prizes: [
    {
        name: "獎項名稱",
        item: "獎品內容",
        quantity: "名額",
        color: "#顏色代碼"
    }
]
```

### 聯絡資訊
```javascript
contact: {
    phone: "電話",
    email: "信箱",
    line: "LINE ID",
    hours: "服務時間"
}
```

## 瀏覽器支援

- Chrome (最新版)
- Firefox (最新版)
- Safari (最新版)
- Edge (最新版)

## 響應式斷點

- 桌面版: > 768px
- 行動版: ≤ 768px

## 注意事項

- 修改 `event-config.js` 後重新整理頁面即可看到變更
- 圖片路徑請使用相對路徑或絕對 URL
- 建議在本地測試後再部署到伺服器

## 進階客製化

### 修改動畫速度
在 `style.css` 中調整 animation-duration:

```css
@keyframes float {
    /* 修改動畫關鍵影格 */
}
```

### 新增區塊
1. 在 `index.html` 新增 section
2. 在 `event-config.js` 新增資料
3. 在 `main.js` 新增渲染函數
4. 在 `style.css` 新增樣式

## 授權

此專案可自由使用和修改。

## 更新日誌

### v1.0.0 (2025-11-30)
- 初始版本發布
- 完整的活動說明頁面
- 設定檔管理系統
