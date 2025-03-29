// bookingStorageModule.js ✅ callback 版本
export const BookingStorageModule = (() => {
    const storageKey = "lastBooking";

    function save(data) {
        localStorage.setItem(storageKey, JSON.stringify(data));
    }

    function load() {
        const data = localStorage.getItem(storageKey);
        return data ? JSON.parse(data) : null;
    }

    function clear() {
        localStorage.removeItem(storageKey);
    }

    // ✅ 接收 callback
    function restoreToForm(data, callback) {
        if (!data) return;

        $("#booking-type").val(data.bookingType);
        $("#name").val(data.name);
        $("#phone").val(data.phone);
        $("#booking-date").val(data.date);
        $("#booking-time").val(data.time);
        $("#num-people").val(data.numPeople).trigger("change");

        // 改用 MutationObserver 檢查 DOM 生成是否完成
        const observer = new MutationObserver(() => {
            if ($(".person-card").length === parseInt(data.numPeople)) {
                observer.disconnect();

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

                if (typeof callback === "function") callback(); // ✅ 完成後執行 callback
            }
        });

        observer.observe(document.getElementById("people-container"), {
            childList: true,
            subtree: true
        });
    }

    return {
        save,
        load,
        clear,
        restoreToForm
    };
})();
