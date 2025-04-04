// bookingDateTypes.js

// 📅 統一管理所有特殊日期類型
export const dateTypes = {
    holiday: [],      // 👉 國定假日（不可預約）
    weeklyOff: [],    // 👉 每週固定休（0=週日~6=週六）
    eventDay: [],     // 👉 特殊活動日
    halfDay: [],      // 👉 半天營業日（如營業到 13:00）
    blockedDay: []    // 👉 其他不可預約日
};

// ✅ 設定工具函式（可選用）
export function setDateTypes(input = {}) {
    for (const key in dateTypes) {
        dateTypes[key] = Array.isArray(input[key]) ? input[key] : [];
    }
}
