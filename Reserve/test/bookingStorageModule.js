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
        // ✅ 自動填入今天
        const todayStr = new Date().toISOString().split("T")[0];
        $("#booking-date").val(todayStr);

        // ✅ 立即更新時間選單（會自動帶入合法時間）
        const timeSelect = document.getElementById("booking-time");
        timeSelect.innerHTML = ""; // 清空舊選單

        // 呼叫時間模組刷新選項
        if (typeof BookingTimeModule?.init === "function") {
            BookingTimeModule.init(); // 更新 today 與選單
        }

        // 等待選單完成後填入第一個合法時間
        setTimeout(() => {
            if (timeSelect.options.length > 0) {
                timeSelect.selectedIndex = 0;
            }
        }, 200);

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



    return {
        save,
        load,
        clear,
        restoreToForm
    };
})();
