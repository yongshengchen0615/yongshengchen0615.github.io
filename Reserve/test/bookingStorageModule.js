// bookingStorageModule.js
import { HistoryModule } from "./historyModule.js"; // ✅ 加入
import { updateTotalAll } from "./bookingUtils.js";

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
    
            updateTotalAll(); // ✅ 模組化計算總價
        }
    
        setTimeout(tryFillServices, 100);
    }
    
    function injectTestData() {
        const testData = {
            bookingType: "本人預約",
            name: "陳先生",
            phone: "0912345678",
            date: new Date().toISOString().split("T")[0],
            time: "10:00",
            numPeople: 2,
            persons: [
                {
                    main: ["全身指壓60分鐘- $1100","全身指壓60分鐘- $1100"],
                    addon: ["刮痧 30分鐘- $600"]
                },
                {
                    main: ["全身指壓60分鐘- $1100"],
                    addon: ["刮痧 30分鐘- $600"]
                }
            ]
        };
    
        save(testData);
        restoreToForm(testData);
    }

    return {
        save,
        load,
        clear,
        restoreToForm,
        injectTestData
    };
})();