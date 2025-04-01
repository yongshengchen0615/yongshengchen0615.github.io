// bookingStorageModule.js
import { HistoryModule } from "./historyModule.js"; // ✅ 加入
import { updateTotalAll } from "../utils/bookingUtils.js";

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
    
        // ✅ bookingType 還原：轉換顯示值與 value 對應
        const typeValue = (data.bookingType === "self" || data.bookingType === "本人預約") ? "self" : "other";
        $("#booking-type").val(typeValue);
    
        // ✅ 其他欄位還原
        $("#name").val(data.name);
        $("#phone").val(data.phone);
        $("#booking-date").val(data.date);
        $("#booking-time").val(data.time);
        $("#num-people").val(data.numPeople).trigger("change");
    
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
                    select.val(service); // 設定選單
                    card.find(".add-service[data-type='main']").click(); // 模擬點擊
                });
    
                // ✅ 還原加購服務
                personData.addon.forEach(service => {
                    const select = card.find(".addon-service");
                    select.val(service);
                    card.find(".add-service[data-type='addon']").click();
                });
    
                // ✅ 還原備註（如果有）
                if (personData.note) {
                    card.find(".person-note").val(personData.note);
                }
            });
    
            updateTotalAll(); // ✅ 確保總金額與時間更新
        }
    
        setTimeout(tryFillServices, 100); // 等待 DOM 建立完成再執行
    }
    
    
    
    

    return {
        save,
        load,
        clear,
        restoreToForm,
    };
})();