// bookingStorageModule.js
import { HistoryModule } from "./historyModule.js"; // ✅ 加入
import { updateTotalAll } from "../utils/bookingUtils.js";
import { BookingTimeModule } from "./bookingTimeModule.js"; // 新增這行
import { dateTypes } from "./bookingDateTypes.js";

export const BookingStorageModule = (() => {
    const storageKey = "lastBooking";

    function save(data) {
        localStorage.setItem(storageKey, JSON.stringify(data));
        HistoryModule.saveToHistory(data); // ✅ 同步寫入歷史紀錄
    }

    function load() {
        const data = localStorage.getItem(storageKey);
        return data ? JSON.parse(data) : null;
    }

    function clear() {
        localStorage.removeItem(storageKey);
    }

    function restoreToForm(data) {
        if (!data) return;
    
        const todayStr = new Date().toISOString().split("T")[0];
        const dateStr = data.date;
        const dateObj = new Date(dateStr);
        const today = new Date(todayStr);
    
        const isHoliday = dateTypes.holiday.includes(dateStr);
        const isBlocked = dateTypes.blockedDay.includes(dateStr);
        const isWeekend = dateTypes.weeklyOff.includes(dateObj.getDay());
        const isPast = dateObj < today;
    
        // ✅ 若不可預約則自動改為下一個合法日
        let finalDate = dateStr;
        if (isHoliday || isBlocked || isWeekend || isPast) {
            finalDate = BookingTimeModule.findNextAvailableDate(todayStr);
            console.warn(`⚠️ 原預約日期(${dateStr})不可用，改為：${finalDate}`);
            alert(`⚠️ 原預約日期（${dateStr}）無法預約，已自動改為 ${finalDate}`);
        }
    
        // 替換預約資料日期
        $("#booking-type").val((data.bookingType === "self" || data.bookingType === "本人預約") ? "self" : "other");
        $("#name").val(data.name);
        $("#phone").val(data.phone);
        $("#booking-date").val(finalDate);
        $("#booking-time").val(data.time);
        $("#num-people").val(data.numPeople).trigger("change");
    
        data.date = finalDate; // 👈 更新資料中的日期，以利後續同步使用
    
        let attempt = 0;
        const maxAttempts = 10;
    
        function tryFillServices() {
            const cards = $(".person-card");
            if (cards.length !== parseInt(data.numPeople)) {
                if (attempt++ < maxAttempts) {
                    return setTimeout(tryFillServices, 100);
                } else {
                    console.warn("⚠️ 預約卡片數與資料不符，還原中止");
                    return;
                }
            }
    
            cards.each(function (i) {
                const personData = data.persons[i];
                if (!personData) return;
    
                const card = $(this);
    
                // ✅ 還原主要服務
                personData.main.forEach(service => {
                    const select = card.find(".main-service");
                    select.val(service);
                    card.find(".add-service[data-type='main']").click();
                });
    
                // ✅ 還原加購服務
                personData.addon.forEach(service => {
                    const select = card.find(".addon-service");
                    select.val(service);
                    card.find(".add-service[data-type='addon']").click();
                });
    
                // ✅ 還原備註
                if (personData.note) {
                    card.find(".person-note").val(personData.note);
                }
            });
    
            updateTotalAll(); // ✅ 確保總金額與時間更新
        }
    
        setTimeout(tryFillServices, 100);
    }
    
    
    
    

    return {
        save,
        load,
        clear,
        restoreToForm,
    };
})();