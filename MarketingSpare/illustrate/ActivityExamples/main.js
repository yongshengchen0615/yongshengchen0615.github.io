// 當頁面載入完成後執行
document.addEventListener('DOMContentLoaded', function() {
    applyTheme(); // 先套用主題
    renderEventPage();
});

// 主題預設配置
const themePresets = {
    "default": {
        colors: {
            primary: "#6366f1",
            secondary: "#8b5cf6",
            accent: "#ec4899",
            warning: "#f59e0b",
            dark: "#1e293b",
            light: "#f8fafc",
            gray: "#64748b"
        },
        gradients: {
            hero: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            bodyBg: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            time: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
            description: "linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)",
            notice: "linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)",
            prize: "linear-gradient(135deg, #d299c2 0%, #fef9d7 100%)"
        },
        typography: {
            heroTitleSize: "3em",
            heroSubtitleSize: "1.4em",
            sectionTitleSize: "2.2em",
            bodyTextSize: "1.1em"
        },
        borderRadius: {
            container: "24px",
            card: "16px",
            button: "50px",
            badge: "50px"
        },
        spacing: {
            sectionPadding: "60px 40px",
            heroPadding: "80px 40px",
            cardPadding: "30px"
        },
        shadows: {
            enabled: true,
            intensity: "medium"
        },
        animations: {
            enabled: true,
            speed: "0.3s",
            floatDuration: "6s"
        }
    },
    
    "elegant-black": {
        colors: {
            primary: "#d4af37",
            secondary: "#b8860b",
            accent: "#ffd700",
            warning: "#f59e0b",
            dark: "#000000",
            light: "#1a1a1a",
            gray: "#808080"
        },
        gradients: {
            hero: "linear-gradient(135deg, #434343 0%, #000000 100%)",
            bodyBg: "linear-gradient(135deg, #1a1a1a 0%, #000000 100%)",
            time: "linear-gradient(135deg, #2c2c2c 0%, #1a1a1a 100%)",
            description: "linear-gradient(135deg, #3a3a3a 0%, #2c2c2c 100%)",
            notice: "linear-gradient(135deg, #4a4a4a 0%, #3a3a3a 100%)",
            prize: "linear-gradient(135deg, #5a5a5a 0%, #4a4a4a 100%)"
        },
        typography: {
            heroTitleSize: "3.2em",
            heroSubtitleSize: "1.5em",
            sectionTitleSize: "2.3em",
            bodyTextSize: "1.1em"
        },
        borderRadius: {
            container: "12px",
            card: "8px",
            button: "4px",
            badge: "4px"
        },
        spacing: {
            sectionPadding: "70px 50px",
            heroPadding: "90px 50px",
            cardPadding: "35px"
        },
        shadows: {
            enabled: true,
            intensity: "heavy"
        },
        animations: {
            enabled: true,
            speed: "0.4s",
            floatDuration: "8s"
        }
    },
    
    "fresh-green": {
        colors: {
            primary: "#10b981",
            secondary: "#059669",
            accent: "#34d399",
            warning: "#fbbf24",
            dark: "#064e3b",
            light: "#ecfdf5",
            gray: "#6b7280"
        },
        gradients: {
            hero: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            bodyBg: "linear-gradient(135deg, #34d399 0%, #10b981 100%)",
            time: "linear-gradient(135deg, #6ee7b7 0%, #34d399 100%)",
            description: "linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)",
            notice: "linear-gradient(135deg, #a7f3d0 0%, #6ee7b7 100%)",
            prize: "linear-gradient(135deg, #6ee7b7 0%, #34d399 100%)"
        },
        typography: {
            heroTitleSize: "3em",
            heroSubtitleSize: "1.4em",
            sectionTitleSize: "2.2em",
            bodyTextSize: "1.1em"
        },
        borderRadius: {
            container: "28px",
            card: "20px",
            button: "60px",
            badge: "60px"
        },
        spacing: {
            sectionPadding: "60px 40px",
            heroPadding: "80px 40px",
            cardPadding: "30px"
        },
        shadows: {
            enabled: true,
            intensity: "medium"
        },
        animations: {
            enabled: true,
            speed: "0.25s",
            floatDuration: "5s"
        }
    },
    
    "minimalist": {
        colors: {
            primary: "#3b82f6",
            secondary: "#2563eb",
            accent: "#60a5fa",
            warning: "#f59e0b",
            dark: "#111827",
            light: "#ffffff",
            gray: "#6b7280"
        },
        gradients: {
            hero: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
            bodyBg: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
            time: "linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)",
            description: "linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%)",
            notice: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
            prize: "linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)"
        },
        typography: {
            heroTitleSize: "2.8em",
            heroSubtitleSize: "1.3em",
            sectionTitleSize: "2em",
            bodyTextSize: "1em"
        },
        borderRadius: {
            container: "8px",
            card: "8px",
            button: "8px",
            badge: "8px"
        },
        spacing: {
            sectionPadding: "50px 30px",
            heroPadding: "70px 30px",
            cardPadding: "25px"
        },
        shadows: {
            enabled: false,
            intensity: "light"
        },
        animations: {
            enabled: false,
            speed: "0.2s",
            floatDuration: "4s"
        }
    },
    
    "cute-pink": {
        colors: {
            primary: "#ec4899",
            secondary: "#f472b6",
            accent: "#fbbf24",
            warning: "#fb923c",
            dark: "#831843",
            light: "#fdf2f8",
            gray: "#9ca3af"
        },
        gradients: {
            hero: "linear-gradient(135deg, #fbbf24 0%, #ec4899 100%)",
            bodyBg: "linear-gradient(135deg, #fde047 0%, #f472b6 100%)",
            time: "linear-gradient(135deg, #fbcfe8 0%, #fbbf24 100%)",
            description: "linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%)",
            notice: "linear-gradient(135deg, #fed7aa 0%, #fde68a 100%)",
            prize: "linear-gradient(135deg, #ddd6fe 0%, #fbcfe8 100%)"
        },
        typography: {
            heroTitleSize: "3.5em",
            heroSubtitleSize: "1.6em",
            sectionTitleSize: "2.4em",
            bodyTextSize: "1.15em"
        },
        borderRadius: {
            container: "32px",
            card: "24px",
            button: "60px",
            badge: "60px"
        },
        spacing: {
            sectionPadding: "65px 45px",
            heroPadding: "85px 45px",
            cardPadding: "35px"
        },
        shadows: {
            enabled: true,
            intensity: "medium"
        },
        animations: {
            enabled: true,
            speed: "0.35s",
            floatDuration: "5s"
        }
    },
    
    "ocean-blue": {
        colors: {
            primary: "#0ea5e9",
            secondary: "#0284c7",
            accent: "#06b6d4",
            warning: "#f59e0b",
            dark: "#0c4a6e",
            light: "#f0f9ff",
            gray: "#64748b"
        },
        gradients: {
            hero: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
            bodyBg: "linear-gradient(135deg, #38bdf8 0%, #0ea5e9 100%)",
            time: "linear-gradient(135deg, #7dd3fc 0%, #38bdf8 100%)",
            description: "linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)",
            notice: "linear-gradient(135deg, #a5f3fc 0%, #67e8f9 100%)",
            prize: "linear-gradient(135deg, #bae6fd 0%, #7dd3fc 100%)"
        },
        typography: {
            heroTitleSize: "3.1em",
            heroSubtitleSize: "1.45em",
            sectionTitleSize: "2.25em",
            bodyTextSize: "1.1em"
        },
        borderRadius: {
            container: "20px",
            card: "16px",
            button: "50px",
            badge: "50px"
        },
        spacing: {
            sectionPadding: "60px 40px",
            heroPadding: "80px 40px",
            cardPadding: "30px"
        },
        shadows: {
            enabled: true,
            intensity: "medium"
        },
        animations: {
            enabled: true,
            speed: "0.3s",
            floatDuration: "7s"
        }
    },
    
    "sunset-orange": {
        colors: {
            primary: "#f97316",
            secondary: "#ea580c",
            accent: "#fb923c",
            warning: "#fbbf24",
            dark: "#7c2d12",
            light: "#fff7ed",
            gray: "#78716c"
        },
        gradients: {
            hero: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
            bodyBg: "linear-gradient(135deg, #fb923c 0%, #f97316 100%)",
            time: "linear-gradient(135deg, #fed7aa 0%, #fdba74 100%)",
            description: "linear-gradient(135deg, #ffedd5 0%, #fed7aa 100%)",
            notice: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
            prize: "linear-gradient(135deg, #fecaca 0%, #fca5a5 100%)"
        },
        typography: {
            heroTitleSize: "3.2em",
            heroSubtitleSize: "1.5em",
            sectionTitleSize: "2.3em",
            bodyTextSize: "1.1em"
        },
        borderRadius: {
            container: "24px",
            card: "16px",
            button: "50px",
            badge: "50px"
        },
        spacing: {
            sectionPadding: "60px 40px",
            heroPadding: "80px 40px",
            cardPadding: "30px"
        },
        shadows: {
            enabled: true,
            intensity: "medium"
        },
        animations: {
            enabled: true,
            speed: "0.3s",
            floatDuration: "6s"
        }
    },
    
    "purple-dream": {
        colors: {
            primary: "#a855f7",
            secondary: "#9333ea",
            accent: "#c084fc",
            warning: "#f59e0b",
            dark: "#581c87",
            light: "#faf5ff",
            gray: "#71717a"
        },
        gradients: {
            hero: "linear-gradient(135deg, #a855f7 0%, #9333ea 100%)",
            bodyBg: "linear-gradient(135deg, #c084fc 0%, #a855f7 100%)",
            time: "linear-gradient(135deg, #e9d5ff 0%, #d8b4fe 100%)",
            description: "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)",
            notice: "linear-gradient(135deg, #ddd6fe 0%, #c4b5fd 100%)",
            prize: "linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%)"
        },
        typography: {
            heroTitleSize: "3.1em",
            heroSubtitleSize: "1.45em",
            sectionTitleSize: "2.25em",
            bodyTextSize: "1.1em"
        },
        borderRadius: {
            container: "26px",
            card: "18px",
            button: "55px",
            badge: "55px"
        },
        spacing: {
            sectionPadding: "65px 40px",
            heroPadding: "85px 40px",
            cardPadding: "32px"
        },
        shadows: {
            enabled: true,
            intensity: "medium"
        },
        animations: {
            enabled: true,
            speed: "0.3s",
            floatDuration: "6.5s"
        }
    }
};

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
    
    // 套用顏色設定
    if (styles.colors) {
        Object.keys(styles.colors).forEach(key => {
            root.style.setProperty(`--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}-color`, styles.colors[key]);
        });
    }
    
    // 套用漸層設定
    if (styles.gradients) {
        Object.keys(styles.gradients).forEach(key => {
            root.style.setProperty(`--gradient-${key}`, styles.gradients[key]);
        });
        
        // 套用背景漸層
        if (styles.gradients.bodyBg) {
            document.body.style.background = styles.gradients.bodyBg;
        }
        
        // 套用 Hero 漸層
        if (styles.gradients.hero) {
            root.style.setProperty('--gradient-1', styles.gradients.hero);
        }
        
        // 套用時間區塊漸層
        if (styles.gradients.time) {
            const timeSection = document.querySelector('.time-section');
            if (timeSection) {
                timeSection.style.background = styles.gradients.time;
            }
        }
        
        // 套用說明區塊漸層
        if (styles.gradients.description) {
            const descSection = document.querySelector('.description-section');
            if (descSection) {
                descSection.style.background = styles.gradients.description;
            }
        }
        
        // 套用注意事項漸層
        if (styles.gradients.notice) {
            const noticeSection = document.querySelector('.notice-section');
            if (noticeSection) {
                noticeSection.style.background = styles.gradients.notice;
            }
        }
        
        // 套用獎品區塊漸層
        if (styles.gradients.prize) {
            const prizeSection = document.querySelector('.prize-section');
            if (prizeSection) {
                prizeSection.style.background = styles.gradients.prize;
            }
        }
    }
    
    // 套用字體設定
    if (styles.typography) {
        if (styles.typography.fontFamily) {
            document.body.style.fontFamily = styles.typography.fontFamily;
        }
        if (styles.typography.heroTitleSize) {
            root.style.setProperty('--hero-title-size', styles.typography.heroTitleSize);
        }
        if (styles.typography.heroSubtitleSize) {
            root.style.setProperty('--hero-subtitle-size', styles.typography.heroSubtitleSize);
        }
        if (styles.typography.sectionTitleSize) {
            root.style.setProperty('--section-title-size', styles.typography.sectionTitleSize);
        }
        if (styles.typography.bodyTextSize) {
            root.style.setProperty('--body-text-size', styles.typography.bodyTextSize);
        }
    }
    
    // 套用圓角設定
    if (styles.borderRadius) {
        Object.keys(styles.borderRadius).forEach(key => {
            root.style.setProperty(`--border-radius-${key}`, styles.borderRadius[key]);
        });
    }
    
    // 套用間距設定
    if (styles.spacing) {
        if (styles.spacing.sectionPadding) {
            root.style.setProperty('--section-padding', styles.spacing.sectionPadding);
        }
        if (styles.spacing.heroPadding) {
            root.style.setProperty('--hero-padding', styles.spacing.heroPadding);
        }
        if (styles.spacing.cardPadding) {
            root.style.setProperty('--card-padding', styles.spacing.cardPadding);
        }
    }
    
    // 套用陰影設定
    if (styles.shadows) {
        if (!styles.shadows.enabled) {
            root.style.setProperty('--shadow-sm', 'none');
            root.style.setProperty('--shadow-md', 'none');
            root.style.setProperty('--shadow-lg', 'none');
            root.style.setProperty('--shadow-xl', 'none');
        } else if (styles.shadows.intensity) {
            const intensities = {
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
            
            const intensity = intensities[styles.shadows.intensity] || intensities.medium;
            Object.keys(intensity).forEach(key => {
                root.style.setProperty(`--shadow-${key}`, intensity[key]);
            });
        }
    }
    
    // 套用動畫設定
    if (styles.animations) {
        if (!styles.animations.enabled) {
            document.body.classList.add('no-animations');
        }
        if (styles.animations.speed) {
            root.style.setProperty('--animation-speed', styles.animations.speed);
        }
        if (styles.animations.floatDuration) {
            root.style.setProperty('--float-duration', styles.animations.floatDuration);
        }
    }
}

// 渲染整個活動頁面
function renderEventPage() {
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
}

// 渲染標題區塊
function renderHero() {
    document.getElementById('eventTitle').textContent = eventConfig.title;
    document.getElementById('eventSubtitle').textContent = eventConfig.subtitle;
    document.getElementById('eventBadge').textContent = eventConfig.badge;
}

// 渲染活動時間
function renderTime() {
    document.getElementById('eventTime').textContent = eventConfig.time;
}

// 渲染活動說明
function renderDescription() {
    document.getElementById('eventDescription').innerHTML = eventConfig.description;
}

// 渲染參加方式
function renderParticipationSteps() {
    const container = document.getElementById('participationSteps');
    container.innerHTML = '';
    
    eventConfig.participationSteps.forEach(step => {
        const stepCard = document.createElement('div');
        stepCard.className = 'step-card';
        
        stepCard.innerHTML = `
            <div class="step-number">${step.step}</div>
            <h3>${step.title}</h3>
            <p>${step.description}</p>
        `;
        
        container.appendChild(stepCard);
    });
}

// 渲染注意事項
function renderNotices() {
    const container = document.getElementById('noticeList');
    container.innerHTML = '';
    
    eventConfig.notices.forEach(notice => {
        const noticeItem = document.createElement('div');
        noticeItem.className = 'notice-item';
        noticeItem.textContent = notice;
        
        container.appendChild(noticeItem);
    });
}

// 渲染獎品資訊
function renderPrizes() {
    const container = document.getElementById('prizeGrid');
    container.innerHTML = '';
    
    // 如果沒有獎品資訊,隱藏整個區塊
    if (!eventConfig.prizes || eventConfig.prizes.length === 0) {
        document.getElementById('prizeSection').style.display = 'none';
        return;
    }
    
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
        
        // 設置卡片懸停效果背景色
        prizeCard.style.setProperty('--prize-color', prize.color);
        prizeCard.querySelector('.prize-card::before')?.style.setProperty('background', prize.color);
        
        container.appendChild(prizeCard);
    });
}

// 渲染聯絡資訊
function renderContact() {
    const container = document.getElementById('contactInfo');
    container.innerHTML = '';
    
    const contactItems = [
       // { label: '服務電話', value: eventConfig.contact.phone },
      //  { label: 'Email', value: eventConfig.contact.email },
        { label: 'LINE ID', value: eventConfig.contact.line },
        { label: '服務時間', value: eventConfig.contact.hours }
    ];
    
    contactItems.forEach(item => {
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
    document.getElementById('footerText').textContent = eventConfig.footer;
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
setTimeout(() => {
    if (!eventConfig.styles || !eventConfig.styles.animations || eventConfig.styles.animations.enabled !== false) {
        addScrollAnimations();
    }
}, 100);

// ===== 輔助函數 =====

// 動態更新樣式(可在控制台中使用)
function updateStyle(category, property, value) {
    if (!eventConfig.styles) eventConfig.styles = {};
    if (!eventConfig.styles[category]) eventConfig.styles[category] = {};
    
    eventConfig.styles[category][property] = value;
    applyCustomStyles();
    
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
