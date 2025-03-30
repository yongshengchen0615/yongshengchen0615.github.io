// bookingStorageModule.js
import { HistoryModule } from "./historyModule.js";
import { updateTotalAll } from "./bookingUtils.js";
import { BookingModule } from "./bookingModule.js";

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

        // 📌 基本欄位還原
        $("#booking-type").val(data.bookingType);
        $("#name").val(data.name);
        $("#phone").val(data.phone);
        $("#booking-date").val(data.date);
        $("#booking-time").val(data.time);
        $("#num-people").val(data.numPeople).trigger("change");

        // 📡 等待卡片渲染完成再插入服務
        const observer = new MutationObserver((mutations, obs) => {
            const cards = $(".person-card");
            if (cards.length === parseInt(data.numPeople)) {
                obs.disconnect(); // 停止觀察

                cards.each(function (i) {
                    const personData = data.persons[i];
                    const card = this;
                    if (!personData) return;

                    // ✅ 靜態插入主服務
                    personData.main.forEach(service => {
                        BookingModule.addServiceByName(card, "main", service.name);
                    });

                    // ✅ 靜態插入加購服務
                    personData.addon.forEach(service => {
                        BookingModule.addServiceByName(card, "addon", service.name);
                    });
                });

                updateTotalAll();
            }
        });

        observer.observe(document.getElementById("people-container"), {
            childList: true,
            subtree: true,
        });
    }

    return {
        save,
        load,
        clear,
        restoreToForm
    };
})();