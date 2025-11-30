# 樣式設定指南

本文件說明如何透過 `event-config.js` 修改網站樣式。

## 快速開始

所有樣式參數都在 `event-config.js` 的 `styles` 物件中設定:

```javascript
const eventConfig = {
    styles: {
        colors: { ... },
        gradients: { ... },
        typography: { ... },
        borderRadius: { ... },
        spacing: { ... },
        shadows: { ... },
        animations: { ... }
    },
    // ... 其他內容設定
};
```

## 樣式參數說明

### 1. 顏色設定 (colors)

控制網站的主要顏色:

```javascript
colors: {
    primary: "#6366f1",      // 主色 - 用於主要按鈕、重點元素
    secondary: "#8b5cf6",    // 次要色 - 用於次要元素
    accent: "#ec4899",       // 強調色 - 用於特別突出的地方
    success: "#10b981",      // 成功色 - 用於成功訊息
    warning: "#f59e0b",      // 警告色 - 用於警告訊息、注意事項
    danger: "#ef4444",       // 危險色 - 用於錯誤訊息
    dark: "#1e293b",         // 深色 - 用於文字
    light: "#f8fafc",        // 淺色 - 用於背景
    gray: "#64748b"          // 灰色 - 用於次要文字
}
```

**範例:**
```javascript
// 改成紅色主題
colors: {
    primary: "#dc2626",
    secondary: "#b91c1c"
}
```

### 2. 漸層設定 (gradients)

控制各區塊的漸層背景:

```javascript
gradients: {
    hero: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",        // 主視覺區塊
    bodyBg: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",      // 整體背景
    time: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",        // 時間區塊
    description: "linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)", // 說明區塊
    notice: "linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)",      // 注意事項
    prize: "linear-gradient(135deg, #d299c2 0%, #fef9d7 100%)"        // 獎品區塊
}
```

**範例:**
```javascript
// 改成綠色系漸層
gradients: {
    hero: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    bodyBg: "linear-gradient(135deg, #34d399 0%, #10b981 100%)"
}
```

**漸層產生器:** 
- https://cssgradient.io/
- https://uigradients.com/

### 3. 字體設定 (typography)

控制文字大小和字體:

```javascript
typography: {
    heroTitleSize: "3em",      // 主標題大小
    heroSubtitleSize: "1.4em", // 副標題大小
    sectionTitleSize: "2.2em", // 區塊標題大小
    bodyTextSize: "1.1em",     // 內文大小
    fontFamily: "-apple-system, BlinkMacSystemFont, ..."
}
```

**範例:**
```javascript
// 放大所有文字
typography: {
    heroTitleSize: "3.5em",
    heroSubtitleSize: "1.6em",
    sectionTitleSize: "2.5em",
    bodyTextSize: "1.2em"
}
```

### 4. 圓角設定 (borderRadius)

控制元素的圓角程度:

```javascript
borderRadius: {
    container: "24px",  // 整體容器圓角
    card: "16px",       // 卡片圓角
    button: "50px",     // 按鈕圓角
    badge: "50px"       // 徽章圓角
}
```

**範例:**
```javascript
// 更圓潤的設計
borderRadius: {
    container: "32px",
    card: "24px",
    button: "60px",
    badge: "60px"
}

// 方正的設計
borderRadius: {
    container: "8px",
    card: "4px",
    button: "4px",
    badge: "4px"
}
```

### 5. 間距設定 (spacing)

控制內距:

```javascript
spacing: {
    sectionPadding: "60px 40px",    // 區塊內距 (上下 左右)
    heroPadding: "80px 40px",       // 主視覺內距
    cardPadding: "30px"             // 卡片內距
}
```

**範例:**
```javascript
// 更寬鬆的間距
spacing: {
    sectionPadding: "80px 60px",
    heroPadding: "100px 60px",
    cardPadding: "40px"
}
```

### 6. 陰影設定 (shadows)

控制陰影效果:

```javascript
shadows: {
    enabled: true,        // 是否啟用陰影
    intensity: "medium"   // 陰影強度: "light", "medium", "heavy"
}
```

**範例:**
```javascript
// 更明顯的陰影
shadows: {
    enabled: true,
    intensity: "heavy"
}

// 無陰影(扁平設計)
shadows: {
    enabled: false
}
```

### 7. 動畫設定 (animations)

控制動畫效果:

```javascript
animations: {
    enabled: true,          // 是否啟用動畫
    speed: "0.3s",         // 動畫速度
    floatDuration: "6s"    // 浮動動畫時長
}
```

**範例:**
```javascript
// 更快的動畫
animations: {
    enabled: true,
    speed: "0.15s",
    floatDuration: "3s"
}

// 禁用動畫
animations: {
    enabled: false
}
```

## 實用範例

### 範例 1: 高雅黑金主題

```javascript
styles: {
    colors: {
        primary: "#d4af37",
        secondary: "#b8860b",
        dark: "#000000"
    },
    gradients: {
        hero: "linear-gradient(135deg, #434343 0%, #000000 100%)",
        bodyBg: "linear-gradient(135deg, #1a1a1a 0%, #000000 100%)"
    },
    shadows: {
        enabled: true,
        intensity: "heavy"
    }
}
```

### 範例 2: 清新綠色主題

```javascript
styles: {
    colors: {
        primary: "#10b981",
        secondary: "#059669",
        accent: "#34d399"
    },
    gradients: {
        hero: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
        time: "linear-gradient(135deg, #34d399 0%, #10b981 100%)",
        description: "linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)"
    }
}
```

### 範例 3: 簡約扁平風格

```javascript
styles: {
    colors: {
        primary: "#3b82f6",
        secondary: "#2563eb"
    },
    borderRadius: {
        container: "8px",
        card: "8px",
        button: "8px",
        badge: "8px"
    },
    shadows: {
        enabled: false
    },
    animations: {
        enabled: false
    }
}
```

### 範例 4: 活潑可愛風格

```javascript
styles: {
    colors: {
        primary: "#ec4899",
        secondary: "#f472b6",
        accent: "#fbbf24"
    },
    gradients: {
        hero: "linear-gradient(135deg, #fbbf24 0%, #ec4899 100%)",
        bodyBg: "linear-gradient(135deg, #fde047 0%, #f472b6 100%)"
    },
    borderRadius: {
        container: "32px",
        card: "24px",
        button: "60px",
        badge: "60px"
    },
    typography: {
        heroTitleSize: "3.5em",
        heroSubtitleSize: "1.6em"
    }
}
```

## 開發者工具即時調整

開啟瀏覽器開發者工具(F12),可以在 Console 中即時調整樣式:

### 1. 更新單一屬性
```javascript
updateStyle('colors', 'primary', '#ff0000')
```

### 2. 快速更改主題色
```javascript
changeThemeColors('#ff5733', '#c70039')
```

### 3. 更改漸層
```javascript
changeGradient('hero', 'linear-gradient(135deg, #ff5733 0%, #c70039 100%)')
```

### 4. 匯出當前設定
```javascript
exportStyles()
```

### 5. 重置為預設
```javascript
resetStyles()
```

## 顏色工具推薦

- **Adobe Color**: https://color.adobe.com/
- **Coolors**: https://coolors.co/
- **Material Design Colors**: https://materialui.co/colors
- **Flat UI Colors**: https://flatuicolors.com/

## 漸層工具推薦

- **CSS Gradient**: https://cssgradient.io/
- **UI Gradients**: https://uigradients.com/
- **Gradient Hunt**: https://gradienthunt.com/

## 注意事項

1. 修改 `event-config.js` 後需要重新整理頁面
2. 顏色請使用十六進位色碼(如 #ff0000)或 RGB/RGBA
3. 大小單位建議使用 em, rem, px, %
4. 測試前建議先備份原始設定
5. 某些樣式可能需要搭配其他樣式才能達到最佳效果

## 疑難排解

**Q: 修改後沒有變化?**
A: 請確認:
1. 已儲存 event-config.js 檔案
2. 已重新整理頁面(Ctrl+F5 強制重新整理)
3. 語法是否正確(括號、引號、逗號)

**Q: 顏色顯示異常?**
A: 請確認顏色代碼格式正確,使用 # 開頭的六位數十六進位色碼

**Q: 動畫無法停止?**
A: 設定 `animations.enabled: false` 並重新整理頁面

## 技術支援

如有任何問題,請參考:
- README.md - 基本使用說明
- 瀏覽器開發者工具 Console - 即時調整測試
- 本檔案 - 詳細樣式設定說明
