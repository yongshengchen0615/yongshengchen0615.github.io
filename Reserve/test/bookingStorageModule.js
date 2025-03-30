import { HistoryModule } from "./historyModule.js";
import { updateTotalAll } from "./bookingUtils.js";
import { BookingModule } from "./bookingModule.js";

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

                    personData.main.forEach(service => {
                        BookingModule.addServiceByName(card, "main", service.name);
                    });

                    personData.addon.forEach(service => {
                        BookingModule.addServiceByName(card, "addon", service.name);
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
            bookingType: "預約他人",
            name: "王先生",
            phone: "0912345678",
            date: "2025-04-01",
            time: "14:30",
            numPeople: "2",
            persons: [
                {
                    main: [
                        { name: "腳底按摩60分鐘- $1200", time: 60, price: 1200 },
                    ],
                    addon: [
                        { name: "肩頸 20分鐘- $450", time: 20, price: 450 }
                    ]
                },
                {
                    main: [
                        { name: "全身指壓90分鐘- $1650", time: 90, price: 1650 }
                    ],
                    addon: [
                        { name: "刮痧 30分鐘- $600", time: 30, price: 600 }
                    ]
                }
            ]
        };

        save(testData);
        alert("✅ 假資料已儲存，可點擊還原測試！");
    }

    return {
        save,
        load,
        clear,
        restoreToForm,
        generateTestData
    };
})();
