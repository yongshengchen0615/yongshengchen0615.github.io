// 當頁面載入完成後執行
document.addEventListener('DOMContentLoaded', withErrorHandling(() => {
    applyTheme();
    renderEventPage();
    initInteractiveAnimations();
}));

// 引入主題配置
// 主題預設配置已移至 themes.js

// 常量定義
const ANIMATION_DELAY = 100;
const RIPPLE_DURATION = 650;

// 工具函數
const $ = (id) => document.getElementById(id);
const $$ = (selector) => document.querySelectorAll(selector);

// 安全的元素操作
function safeSetText(id, text) {
    const el = $(id);
    if (el && typeof text === 'string') {
        el.textContent = text;
    }
}

function safeSetHTML(id, html) {
    const el = $(id);
    if (el && typeof html === 'string') {
        el.innerHTML = html;
    }
}

// 錯誤處理包裝器
function withErrorHandling(fn, fallback = () => {}) {
    return (...args) => {
        try {
            return fn(...args);
        } catch (error) {
            console.error('Error in function:', error);
            return fallback();
        }
    };
}

// 套用主題
function applyTheme() {
    let currentStyles;
    
    // 根據選擇的主題決定使用哪個樣式配置
    if (eventConfig.theme && eventConfig.theme !== "custom" && themePresets[eventConfig.theme]) {
        currentStyles = themePresets[eventConfig.theme];
        console.log(`🎨 已套用主題: ${eventConfig.theme}`);
    } else if (eventConfig.styles) {
        currentStyles = eventConfig.styles;
        console.log('🎨 已套用自訂樣式');
    } else {
        currentStyles = themePresets["default"];
        console.log('🎨 已套用預設主題');
    }
    
    applyCustomStyles(currentStyles);
}

// 套用自訂樣式
function applyCustomStyles(styles) {
    if (!styles) return;
    const root = document.documentElement;

    // 顏色
    if (styles.colors) {
        for (const [key, val] of Object.entries(styles.colors)) {
            root.style.setProperty(`--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}-color`, val);
        }
    }

    // 漸層統一改為 CSS 變數，不直接改各 section style
    if (styles.gradients) {
        for (const [key, val] of Object.entries(styles.gradients)) {
            root.style.setProperty(`--gradient-${key}`, val);
        }
        if (styles.gradients.bodyBg) {
            document.body.style.background = styles.gradients.bodyBg;
        }
        // 保持兼容：將 hero 同步到舊的 --gradient-1
        if (styles.gradients.hero) {
            root.style.setProperty('--gradient-1', styles.gradients.hero);
        }
    }

    // 字體
    if (styles.typography) {
        const t = styles.typography;
        if (t.fontFamily) document.body.style.fontFamily = t.fontFamily;
        if (t.heroTitleSize) root.style.setProperty('--hero-title-size', t.heroTitleSize);
        if (t.heroSubtitleSize) root.style.setProperty('--hero-subtitle-size', t.heroSubtitleSize);
        if (t.sectionTitleSize) root.style.setProperty('--section-title-size', t.sectionTitleSize);
        if (t.bodyTextSize) root.style.setProperty('--body-text-size', t.bodyTextSize);
    }

    // 圓角
    if (styles.borderRadius) {
        for (const [key, val] of Object.entries(styles.borderRadius)) {
            root.style.setProperty(`--border-radius-${key}`, val);
        }
    }

    // 間距
    if (styles.spacing) {
        const s = styles.spacing;
        if (s.sectionPadding) root.style.setProperty('--section-padding', s.sectionPadding);
        if (s.heroPadding) root.style.setProperty('--hero-padding', s.heroPadding);
        if (s.cardPadding) root.style.setProperty('--card-padding', s.cardPadding);
    }

    // 陰影
    if (styles.shadows) {
        if (!styles.shadows.enabled) {
            root.style.setProperty('--shadow-sm', 'none');
            root.style.setProperty('--shadow-md', 'none');
            root.style.setProperty('--shadow-lg', 'none');
            root.style.setProperty('--shadow-xl', 'none');
        } else {
            const map = {
                light: {
                    sm: '0 1px 2px 0 rgb(0 0 0 / 0.03)',
                    md: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
                    lg: '0 10px 15px -3px rgb(0 0 0 / 0.05)',
                    xl: '0 20px 25px -5px rgb(0 0 0 / 0.05)'
                },
                medium: {
                    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
                    md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                    xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)'
                },
                heavy: {
                    sm: '0 1px 2px 0 rgb(0 0 0 / 0.1)',
                    md: '0 4px 6px -1px rgb(0 0 0 / 0.15)',
                    lg: '0 10px 15px -3px rgb(0 0 0 / 0.15)',
                    xl: '0 20px 25px -5px rgb(0 0 0 / 0.2)'
                }
            };
            const intensity = map[styles.shadows.intensity] || map.medium;
            for (const [key, val] of Object.entries(intensity)) {
                root.style.setProperty(`--shadow-${key}`, val);
            }
        }
    }

    // 動畫
    if (styles.animations) {
        if (!styles.animations.enabled) {
            document.body.classList.add('no-animations');
        }
        if (styles.animations.speed) root.style.setProperty('--animation-speed', styles.animations.speed);
        if (styles.animations.floatDuration) root.style.setProperty('--float-duration', styles.animations.floatDuration);
    }
}

// 渲染整個活動頁面
function renderEventPage() {
    withErrorHandling(() => {
        // 渲染標題區塊
        renderHero();
        
        // 渲染活動時間
        renderTime();
        
        // 渲染活動說明
        renderDescription();
        
        // 渲染參加方式
        renderParticipationSteps();
        
        // 渲染注意事項
        renderNotices();
        
        // 渲染獎品資訊
        renderPrizes();
        
        // 渲染聯絡資訊
        renderContact();
        
        // 渲染頁尾
        renderFooter();
    })();
}

// 渲染標題區塊
function renderHero() {
    safeSetText('eventTitle', eventConfig.title);
    safeSetText('eventSubtitle', eventConfig.subtitle);
    safeSetText('eventBadge', eventConfig.badge);
}

// 渲染活動時間
function renderTime() {
    safeSetText('eventTime', eventConfig.time);
}

// 渲染活動說明
function renderDescription() {
    safeSetHTML('eventDescription', eventConfig.description);
}

// 渲染參加方式
function renderParticipationSteps() {
    const container = $('participationSteps');
    if (!container) return;
    
    container.innerHTML = '';
    const steps = eventConfig.participationSteps || [];
    const frag = document.createDocumentFragment();
    
    steps.forEach(step => {
        const stepCard = document.createElement('div');
        stepCard.className = 'step-card';
        
        stepCard.innerHTML = `
            <div class="step-number">${step.step}</div>
            <h3>${step.title}</h3>
            <p>${step.description}</p>
        `;
        
        frag.appendChild(stepCard);
    });
    container.appendChild(frag);
}

// 渲染注意事項
function renderNotices() {
    const container = $('noticeList');
    if (!container) return;
    
    container.innerHTML = '';
    const notices = eventConfig.notices || [];
    const frag = document.createDocumentFragment();
    
    notices.forEach(notice => {
        const noticeItem = document.createElement('div');
        noticeItem.className = 'notice-item';
        noticeItem.textContent = notice;
        frag.appendChild(noticeItem);
    });
    container.appendChild(frag);
}

// 渲染獎品資訊
function renderPrizes() {
    const container = $('prizeGrid');
    const section = $('prizeSection');
    
    if (!container || !section) return;
    
    // 如果沒有獎品資訊,隱藏整個區塊
    if (!eventConfig.prizes || eventConfig.prizes.length === 0) {
        section.style.display = 'none';
        return;
    }
    
    container.innerHTML = '';
    const frag = document.createDocumentFragment();
    
    eventConfig.prizes.forEach(prize => {
        const prizeCard = document.createElement('div');
        prizeCard.className = 'prize-card';
        
        prizeCard.innerHTML = `
            <div class="prize-name" style="background: ${prize.color};">
                ${prize.name}
            </div>
            <div class="prize-item">${prize.item}</div>
            <div class="prize-quantity">名額: ${prize.quantity}</div>
        `;
        
        // 使用 CSS 變數供 ::before 使用，避免直接選取偽元素
        if (prize.color) prizeCard.style.setProperty('--prize-hover-bg', prize.color);
        frag.appendChild(prizeCard);
    });
    container.appendChild(frag);
}

// 渲染聯絡資訊
function renderContact() {
    const container = $('contactInfo');
    if (!container) return;
    
    container.innerHTML = '';
    
    const contactItems = [
        { label: 'LINE ID', value: eventConfig.contact?.line },
        { label: '服務時間', value: eventConfig.contact?.hours }
    ];
    
    contactItems.filter(item => item.value).forEach(item => {
        const contactItem = document.createElement('div');
        contactItem.className = 'contact-item';
        
        contactItem.innerHTML = `
            <strong>${item.label}:</strong>
            <span>${item.value}</span>
        `;
        
        container.appendChild(contactItem);
    });
}

// 渲染頁尾
function renderFooter() {
    const footerEl = $('footerText');
    if (footerEl && eventConfig.footer) {
        footerEl.textContent = eventConfig.footer;
    }
}

// 平滑滾動效果(如果需要添加錨點連結)
function smoothScroll(target) {
    const element = document.querySelector(target);
    if (element) {
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }
}

// 添加進場動畫
function addScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, {
        threshold: 0.1
    });
    
    // 觀察所有 section
    document.querySelectorAll('section').forEach(section => {
        section.style.opacity = '0';
        section.style.transform = 'translateY(20px)';
        section.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(section);
    });
}

// 初始化動畫
setTimeout(withErrorHandling(() => {
    if (!eventConfig.styles || !eventConfig.styles.animations || eventConfig.styles.animations.enabled !== false) {
        addScrollAnimations();
    }
}), ANIMATION_DELAY);

// ===== 輔助函數 =====

// 動態更新樣式(可在控制台中使用)
function updateStyle(category, property, value) {
    if (!eventConfig.styles) eventConfig.styles = {};
    if (!eventConfig.styles[category]) eventConfig.styles[category] = {};
    
    eventConfig.styles[category][property] = value;
    applyCustomStyles(eventConfig.styles);
    
    console.log(`✅ 已更新 ${category}.${property} = ${value}`);
}

// 切換主題
function switchTheme(themeName) {
    if (!themePresets[themeName]) {
        console.error(`❌ 主題 "${themeName}" 不存在。可用主題: ${Object.keys(themePresets).join(', ')}`);
        return;
    }
    
    eventConfig.theme = themeName;
    applyTheme();
    console.log(`✅ 已切換到主題: ${themeName}`);
}

// 列出所有可用主題
function listThemes() {
    console.log('📋 可用主題列表:');
    console.log('─'.repeat(50));
    Object.keys(themePresets).forEach(theme => {
        const preset = themePresets[theme];
        console.log(`\n🎨 ${theme}`);
        console.log(`   主色: ${preset.colors.primary}`);
        console.log(`   風格: ${preset.shadows.enabled ? '有陰影' : '扁平'} | ${preset.animations.enabled ? '有動畫' : '靜態'}`);
    });
    console.log('\n使用方式: switchTheme("主題名稱")');
    console.log('範例: switchTheme("elegant-black")');
}

// 快速更改主題色
function changeThemeColors(primaryColor, secondaryColor) {
    if (!eventConfig.styles) eventConfig.styles = { colors: {} };
    if (!eventConfig.styles.colors) eventConfig.styles.colors = {};
    
    eventConfig.styles.colors.primary = primaryColor;
    if (secondaryColor) {
        eventConfig.styles.colors.secondary = secondaryColor;
    }
    
    eventConfig.theme = "custom";
    applyTheme();
    console.log(`✅ 已更新主題色: primary=${primaryColor}${secondaryColor ? ', secondary=' + secondaryColor : ''}`);
}

// 快速更改漸層
function changeGradient(section, gradient) {
    if (!eventConfig.styles) eventConfig.styles = { gradients: {} };
    if (!eventConfig.styles.gradients) eventConfig.styles.gradients = {};
    
    eventConfig.styles.gradients[section] = gradient;
    eventConfig.theme = "custom";
    applyTheme();
    
    console.log(`✅ 已更新 ${section} 漸層`);
}

// 重置為預設樣式
function resetStyles() {
    delete eventConfig.styles;
    location.reload();
}

// 匯出當前樣式設定
function exportStyles() {
    const stylesJson = JSON.stringify(eventConfig.styles, null, 4);
    console.log('當前樣式設定:');
    console.log(stylesJson);
    return stylesJson;
}

// 在控制台顯示可用的樣式函數
console.log(`
🎨 活動網站樣式控制系統
${'='.repeat(50)}

📌 快速主題切換:
   switchTheme("主題名稱")  - 一鍵切換整套樣式
   listThemes()            - 查看所有可用主題
   
   可用主題:
   • default         - 預設紫色主題
   • elegant-black   - 高雅黑金主題
   • fresh-green     - 清新綠色主題
   • minimalist      - 簡約扁平風格
   • cute-pink       - 活潑可愛風格
   • ocean-blue      - 海洋藍色主題
   • sunset-orange   - 夕陽橘色主題
   • purple-dream    - 紫色夢幻主題
   
   範例: switchTheme("elegant-black")

${'─'.repeat(50)}

🔧 進階自訂函數:
   1. updateStyle(category, property, value)
      範例: updateStyle('colors', 'primary', '#ff5733')
      
   2. changeThemeColors(primaryColor, secondaryColor)
      範例: changeThemeColors('#ff5733', '#c70039')
      
   3. changeGradient(section, gradient)
      範例: changeGradient('hero', 'linear-gradient(135deg, #ff5733 0%, #c70039 100%)')
      
   4. exportStyles()  - 匯出當前樣式設定
   5. resetStyles()   - 重置為預設樣式

提示: 開啟開發者工具(F12)後可直接使用這些函數!
`);

// ===== 酷炫互動動畫 =====
function initInteractiveAnimations() {
    withErrorHandling(() => {
        // Hero 圓形視差效果
        const hero = document.querySelector('.hero-section');
        const circles = document.querySelectorAll('.circle');
        if (hero && circles.length) {
            hero.addEventListener('mousemove', (e) => {
                const rect = hero.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width - 0.5;
                const y = (e.clientY - rect.top) / rect.height - 0.5;
                circles.forEach((c, i) => {
                    const depth = (i + 1) * 8;
                    c.style.transform = `translate(${x * depth}px, ${y * depth}px)`;
                });
            });
            hero.addEventListener('mouseleave', () => {
                circles.forEach(c => { c.style.transform = 'translate(0,0)'; });
            });
        }

        // Prize 卡片傾斜與高光
        const prizeCards = document.querySelectorAll('.prize-card');
        prizeCards.forEach(card => {
            card.addEventListener('mousemove', (e) => {
                const r = card.getBoundingClientRect();
                const cx = e.clientX - r.left;
                const cy = e.clientY - r.top;
                const rotX = ((cy / r.height) - 0.5) * -6; // 上下傾斜
                const rotY = ((cx / r.width) - 0.5) * 6;  // 左右傾斜
                card.style.transform = `translateY(-6px) scale(1.02) rotateX(${rotX}deg) rotateY(${rotY}deg)`;
                card.style.boxShadow = '0 20px 25px -5px rgb(0 0 0 / 0.15)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
                card.style.boxShadow = '';
            });
        });

        // Step 卡片點擊波紋
        const stepCards = document.querySelectorAll('.step-card');
        stepCards.forEach(card => {
            card.addEventListener('click', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const after = card; // 使用 ::after 需設定位置
                const style = after.style;
                style.setProperty('--ripple-x', `${x}px`);
                style.setProperty('--ripple-y', `${y}px`);
                card.classList.remove('ripple-active');
                // 重新觸發動畫
                void card.offsetWidth;
                card.classList.add('ripple-active');
                // 動畫結束移除類別
                setTimeout(() => card.classList.remove('ripple-active'), RIPPLE_DURATION);
            });
        });
    })();
}
