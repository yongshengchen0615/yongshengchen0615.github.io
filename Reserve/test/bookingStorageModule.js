// bookingStorageModule.js
import { HistoryModule } from "./historyModule.js"; // ✅ 加入
import { updateTotalAll } from "./bookingUtils.js";
import { NotificationModule } from './notificationModule.js';

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

        const today = new Date().toISOString().split("T")[0];
        const isToday = data.date === today;

        // ✅ 還原日期與時間前先驗證合法性
        let validTime = BookingTimeModule.isValidBookingTime(data.date, data.time);

        if (!validTime) {
            console.warn("⚠️ 時間已過期，自動調整為今天與合法時間");
            data.date = today;

            const timeSelect = document.getElementById("booking-time");
            if (timeSelect && timeSelect.options.length > 0) {
                data.time = timeSelect.options[0].value;
            } else {
                NotificationModule.show("找不到合法的預約時間，請先選擇日期！", "error");
                return;
            }
        }

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

            updateTotalAll();
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
