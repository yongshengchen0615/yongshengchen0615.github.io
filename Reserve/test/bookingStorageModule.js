// bookingStorageModule.js
import { HistoryModule } from "./historyModule.js";
import { updateTotalAll } from "./bookingUtils.js";
import { BookingModule } from "./bookingModule.js";

export const BookingStorageModule = (() => {
    const storageKey = "lastBooking";

    function save(data) {
        // ❌ 不再儲存上次預約資料（改為僅存歷史）
        HistoryModule.saveToHistory(data);
    }

    function load() {
        return null; // ❌ 每次都返回空值，強制刷新不還原
    }

    function clear() {
        localStorage.removeItem(storageKey);
    }

    function restoreToForm(data) {
        if (!data) return;

        const $bookingType = $("#booking-type");
        if (data.bookingType && $bookingType.length) {
            $bookingType.val(data.bookingType).trigger("change");
        }

        $("#name").val(data.name);
        $("#phone").val(data.phone);
        $("#booking-date").val(data.date);
        $("#booking-time").val(data.time);
        $("#num-people").val(data.numPeople).trigger("change");

        const originalFlag = BookingModule.getAllowDuplicate();
        BookingModule.setAllowDuplicate(true);

        const observer = new MutationObserver((mutations, obs) => {
            const cards = $(".person-card");
            if (cards.length === parseInt(data.numPeople)) {
                obs.disconnect();

                cards.each(function (i) {
                    const personData = data.persons[i];
                    const card = this;
                    if (!personData) return;

                    BookingModule.clearServicesInCard(card);

                    personData.main?.forEach(service => {
                        if (service?.name) {
                            BookingModule.addServiceByName(card, "main", service.name);
                        }
                    });

                    personData.addon?.forEach(service => {
                        if (service?.name) {
                            BookingModule.addServiceByName(card, "addon", service.name);
                        }
                    });
                });

                updateTotalAll();
                BookingModule.setAllowDuplicate(originalFlag);
            }
        });

        observer.observe(document.getElementById("people-container"), {
            childList: true,
            subtree: true,
        });
    }

    function generateTestData() {
        const testData = {
            bookingType: "本人預約",
            name: "測試用戶",
            phone: "0912345678",
            date: "2025-04-01",
            time: "14:30",
            numPeople: "2",
            persons: [
                {
                    main: [
                        { name: "腳底按摩60分鐘- $1200" }
                    ],
                    addon: [
                        { name: "肩頸 20分鐘- $450" }
                    ]
                },
                {
                    main: [
                        { name: "全身指壓90分鐘- $1650" }
                    ],
                    addon: [
                        { name: "刮痧 30分鐘- $600" }
                    ]
                }
            ]
        };

        HistoryModule.saveToHistory(testData);
        alert("✅ 假資料已儲存到歷史，可點擊還原測試！");
    }

    return {
        save,
        load,
        clear,
        restoreToForm,
        generateTestData
    };
})();
