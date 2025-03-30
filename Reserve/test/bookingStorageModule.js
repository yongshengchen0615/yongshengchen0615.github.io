// bookingStorageModule.js
import { HistoryModule } from "./historyModule.js";
import { updateTotalAll } from "./bookingUtils.js";

export const BookingStorageModule = (() => {
    const storageKey = "lastBooking";

    function save(data) {
        localStorage.setItem(storageKey, JSON.stringify(data));
        HistoryModule.saveToHistory(data);
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
        let timeoutId = null;

        function tryFillServices() {
            const cards = $(".person-card");
            if (cards.length !== parseInt(data.numPeople)) {
                if (attempt++ < maxAttempts) {
                    timeoutId = setTimeout(tryFillServices, 100);
                } else {
                    console.warn("⚠️ 預約卡片數與資料不符，還原中止");
                    return;
                }
                return;
            }

            cards.each(function (i) {
                const personData = data.persons[i];
                if (!personData) return;

                const card = $(this);

                personData.main.forEach(service => {
                    card.find(".main-service").val(service);
                    card.find(".add-service[data-type='main']").click();
                });

                personData.addon.forEach(service => {
                    card.find(".addon-service").val(service);
                    card.find(".add-service[data-type='addon']").click();
                });
            });

            updateTotalAll();
        }

        timeoutId = setTimeout(tryFillServices, 100);
    }

    return {
        save,
        load,
        clear,
        restoreToForm
    };
})();
