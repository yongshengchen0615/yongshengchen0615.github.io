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

        // 等待預約人卡片生成後加入服務
        setTimeout(() => {
            $(".person-card").each(function (i) {
                const personData = data.persons[i];
                if (!personData) return;

                personData.main.forEach(service => {
                    const select = $(this).find(".main-service");
                    select.val(service);
                    $(this).find(".add-service[data-type='main']").click();
                });

                personData.addon.forEach(service => {
                    const select = $(this).find(".addon-service");
                    select.val(service);
                    $(this).find(".add-service[data-type='addon']").click();
                });
            });
        }, 100);
    }

    return {
        save,
        load,
        clear,
        restoreToForm
    };
})();
