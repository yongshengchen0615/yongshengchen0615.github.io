# 🎨 一鍵主題切換指南

## 快速開始

只需修改 `event-config.js` 中的 **一個參數** 即可切換整套樣式!

```javascript
const eventConfig = {
    theme: "default",  // 👈 只需修改這裡!
    // ...其他設定
};
```

## 📌 可用主題

### 1. **default** (預設主題)
```javascript
theme: "default"
```
- 🎨 風格: 現代紫色漸層
- 💎 特色: 活潑、專業、適合各種活動
- 🎯 適用: 通用活動、促銷活動

### 2. **elegant-black** (高雅黑金)
```javascript
theme: "elegant-black"
```
- 🎨 風格: 黑色配金色
- 💎 特色: 高級、奢華、專業
- 🎯 適用: VIP活動、高端產品、週年慶

### 3. **fresh-green** (清新綠色)
```javascript
theme: "fresh-green"
```
- 🎨 風格: 清新綠色系
- 💎 特色: 自然、健康、清爽
- 🎯 適用: 環保活動、健康產品、春季活動

### 4. **minimalist** (簡約扁平)
```javascript
theme: "minimalist"
```
- 🎨 風格: 藍色扁平設計
- 💎 特色: 簡潔、現代、無動畫
- 🎯 適用: 正式活動、企業活動、資訊展示

### 5. **cute-pink** (活潑可愛)
```javascript
theme: "cute-pink"
```
- 🎨 風格: 粉紅配黃色
- 💎 特色: 可愛、活潑、年輕
- 🎯 適用: 女性向活動、兒童活動、節慶

### 6. **ocean-blue** (海洋藍色)
```javascript
theme: "ocean-blue"
```
- 🎨 風格: 藍色海洋系
- 💎 特色: 清涼、專業、舒適
- 🎯 適用: 夏季活動、旅遊、科技產品

### 7. **sunset-orange** (夕陽橘色)
```javascript
theme: "sunset-orange"
```
- 🎨 風格: 橘紅色系
- 💎 特色: 熱情、活力、溫暖
- 🎯 適用: 秋季活動、美食、優惠促銷

### 8. **purple-dream** (紫色夢幻)
```javascript
theme: "purple-dream"
```
- 🎨 風格: 夢幻紫色
- 💎 特色: 浪漫、神秘、優雅
- 🎯 適用: 情人節、美妝、夢幻主題

---

## 🚀 使用方式

### 方法一: 編輯設定檔(推薦)

1. 開啟 `event-config.js`
2. 找到 `theme` 參數
3. 修改為想要的主題名稱
4. 儲存並重新整理頁面

```javascript
// event-config.js
const eventConfig = {
    theme: "elegant-black",  // 改成黑金主題
    // ...
};
```

### 方法二: 即時切換(測試用)

開啟瀏覽器開發者工具(F12),在 Console 輸入:

```javascript
// 切換主題
switchTheme("elegant-black")

// 查看所有主題
listThemes()
```

---

## 🎯 主題對照表

| 主題名稱 | 主色調 | 風格 | 陰影 | 動畫 | 適用場景 |
|---------|--------|------|------|------|---------|
| **default** | 紫色 | 現代 | ✅ | ✅ | 通用 |
| **elegant-black** | 金色 | 高雅 | ✅ | ✅ | 高端活動 |
| **fresh-green** | 綠色 | 清新 | ✅ | ✅ | 健康/環保 |
| **minimalist** | 藍色 | 簡約 | ❌ | ❌ | 正式活動 |
| **cute-pink** | 粉色 | 可愛 | ✅ | ✅ | 女性/兒童 |
| **ocean-blue** | 藍色 | 清涼 | ✅ | ✅ | 夏季/旅遊 |
| **sunset-orange** | 橘色 | 熱情 | ✅ | ✅ | 秋季/促銷 |
| **purple-dream** | 紫色 | 夢幻 | ✅ | ✅ | 浪漫主題 |

---

## 💡 進階功能

### 自訂主題

如果預設主題不符合需求,可以使用 `custom` 主題:

```javascript
const eventConfig = {
    theme: "custom",  // 使用自訂樣式
    
    styles: {
        colors: {
            primary: "#your-color",
            // ...自訂顏色
        },
        gradients: {
            hero: "linear-gradient(...)",
            // ...自訂漸層
        },
        // ...更多自訂設定
    }
};
```

詳細自訂說明請參考 `STYLE-GUIDE.md`

---

## 🎨 主題預覽對比

### 色彩對比

```
default:        紫色 (#6366f1) → 深紫 (#764ba2)
elegant-black:  金色 (#d4af37) → 黑色 (#000000)
fresh-green:    綠色 (#10b981) → 深綠 (#059669)
minimalist:     藍色 (#3b82f6) → 深藍 (#2563eb)
cute-pink:      粉色 (#ec4899) → 黃色 (#fbbf24)
ocean-blue:     天藍 (#0ea5e9) → 深藍 (#0284c7)
sunset-orange:  橘色 (#f97316) → 深橘 (#ea580c)
purple-dream:   紫色 (#a855f7) → 深紫 (#9333ea)
```

### 圓角對比

```
default:        24px (圓潤)
elegant-black:  8px  (方正)
minimalist:     8px  (方正)
cute-pink:      32px (非常圓)
```

### 動畫對比

```
有動畫: default, elegant-black, fresh-green, cute-pink, ocean-blue, sunset-orange, purple-dream
無動畫: minimalist (適合正式場合)
```

---

## 📱 響應式設計

所有主題都支援響應式設計,自動適配:
- 💻 桌面電腦
- 📱 平板
- 📱 手機

---

## 🔧 開發者工具

開啟瀏覽器 Console(F12)可使用:

```javascript
// 查看所有主題
listThemes()

// 切換主題
switchTheme("elegant-black")

// 匯出當前樣式
exportStyles()

// 重置樣式
resetStyles()
```

---

## ❓ 常見問題

**Q: 修改後沒有變化?**
A: 請確認已儲存檔案並重新整理頁面(Ctrl+F5)

**Q: 可以混搭不同主題的元素嗎?**
A: 可以!使用 `custom` 主題並參考其他主題的設定

**Q: 主題切換會影響內容嗎?**
A: 不會,只會改變視覺樣式,內容保持不變

**Q: 可以新增自己的主題嗎?**
A: 可以!在 `main.js` 的 `themePresets` 中新增即可

---

## 📚 相關文件

- `README.md` - 基本使用說明
- `STYLE-GUIDE.md` - 詳細樣式設定指南
- `event-config.js` - 設定檔

---

## 🎉 快速測試

想快速看看效果?在 Console 輸入:

```javascript
// 每3秒自動切換主題
const themes = ["default", "elegant-black", "fresh-green", "cute-pink", "ocean-blue"];
let i = 0;
setInterval(() => {
    switchTheme(themes[i]);
    i = (i + 1) % themes.length;
}, 3000);
```

---

**提示:** 建議先用 Console 測試各種主題,找到最適合的再修改設定檔!
