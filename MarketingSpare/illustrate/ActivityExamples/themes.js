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