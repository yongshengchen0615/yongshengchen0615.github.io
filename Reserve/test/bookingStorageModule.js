// bookingStorageModule.js
import { HistoryModule } from "./historyModule.js"; // ✅ 加入

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
    
        $("#booking-type").val(data.bookingType);
        $("#name").val(data.name);
        $("#phone").val(data.phone);
        $("#booking-date").val(data.date);
        $("#booking-time").val(data.time);
        $("#num-people").val(data.numPeople).trigger("change");
    
        // 🧠 等待人數生成完畢（最多重試 10 次）
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
    
                personData.main.forEach(service => {
                    const select = card.find(".main-service");
                    select.val(service);
                    card.find(".add-service[data-type='main']").click();
                });
    
                personData.addon.forEach(service => {
                    const select = card.find(".addon-service");
                    select.val(service);
                    card.find(".add-service[data-type='addon']").click();
                });
            });
    
            // ✅ 最後重新統計總金額與時間
            if (window.updateTotalAll) {
                window.updateTotalAll();
            }
        }
    
        setTimeout(tryFillServices, 100);
    }
    

    return {
        save,
        load,
        clear,
        restoreToForm
    };
})();
