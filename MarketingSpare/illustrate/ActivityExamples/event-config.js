// 活動設定檔 - 所有文字內容都可以在這裡修改
const eventConfig = {
    // 主標題區塊
    title: "2025 年度超級優惠活動",
    subtitle: "參加即有機會獲得超值好禮",
    badge: "限時優惠",
    
    // 活動時間
    time: "2025年1月1日 ~ 2025年12月31日",
    
    // 活動說明
    description: `
        <p>歡迎參加我們的年度超級優惠活動!這是一個專為您設計的特別活動,讓您有機會獲得豐富的獎品與優惠。</p>
        <p>活動期間內,只要完成指定任務,就有機會參加抽獎,贏取各式各樣的精美好禮。不論您是新朋友或老朋友,都歡迎一起來參加!</p>
        <p class="highlight">機會難得,千萬不要錯過!</p>
    `,
    
    // 參加方式(步驟)
    participationSteps: [
        {
            step: 1,
            title: "註冊會員",
            description: "首次參加請先註冊成為會員,已是會員請直接登入"
        },
        {
            step: 2,
            title: "完成任務",
            description: "根據活動頁面指示完成相應的任務或消費"
        },
        {
            step: 3,
            title: "獲得抽獎資格",
            description: "完成任務後自動獲得抽獎機會,系統將自動記錄"
        },
        {
            step: 4,
            title: "等待開獎",
            description: "活動結束後將進行抽獎,得獎名單將於官網公佈"
        }
    ],
    
    // 注意事項
    notices: [
        "本活動僅限台灣地區會員參加",
        "每人每日限參加一次,不可重複參加",
        "獎品寄送地址僅限台灣本島,離島地區可能需要額外運費",
        "中獎者需在公告後7日內完成領獎手續,逾期視同放棄",
        "本公司保留活動修改、暫停或終止之權利",
        "若有任何爭議,以本公司最終解釋為準",
        "參加活動即表示同意本活動之各項規定",
        "獎品以實物為準,圖片僅供參考"
    ],
    
    // 獎品資訊
    prizes: [
        {
            name: "頭獎",
            item: "iPhone 15 Pro Max",
            quantity: "1名",
            color: "#FF6B6B"
        },
        {
            name: "二獎",
            item: "iPad Air",
            quantity: "3名",
            color: "#4ECDC4"
        },
        {
            name: "三獎",
            item: "AirPods Pro",
            quantity: "5名",
            color: "#45B7D1"
        },
        {
            name: "參加獎",
            item: "100元購物金",
            quantity: "50名",
            color: "#FFA07A"
        }
    ],
    
    // 聯絡資訊
    contact: {
        phone: "0800-123-456",
        email: "service@example.com",
        line: "@example",
        hours: "週一至週五 09:00-18:00"
    },
    
    // 頁尾文字
    footer: "© 2025 活動主辦單位. All rights reserved."
};
