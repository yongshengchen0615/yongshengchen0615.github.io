// historyModule.js
export const HistoryModule = (() => {
    function saveLastBooking(data) {
        localStorage.setItem("lastBookingData", JSON.stringify(data));
    }

    function restoreLastBooking() {
        const lastBooking = JSON.parse(localStorage.getItem("lastBookingData"));
        if (!lastBooking) return;

        $("#name").val(lastBooking.name);
        $("#phone").val(lastBooking.phone);
        $("#booking-type").val(lastBooking.bookingTypeText === "代訂他人" ? "other" : "self");
        $("#booking-date").val(lastBooking.date);
        $("#booking-time").val(lastBooking.time);
        $("#num-people").val(lastBooking.numPeople).trigger("change");

        setTimeout(() => {
            lastBooking.persons.forEach((person, index) => {
                const card = $(`.person-card[data-person="${index}"]`);

                person.mainServices.forEach(service => {
                    const select = card.find(".main-service");
                    if (select.find(`option[value="${service}"]`).length) {
                        select.val(service);
                        card.find(".add-service[data-type='main']").click();
                    }
                });

                person.addonServices.forEach(service => {
                    const select = card.find(".addon-service");
                    if (select.find(`option[value="${service}"]`).length) {
                        select.val(service);
                        card.find(".add-service[data-type='addon']").click();
                    }
                });
            });
        }, 300); // ⏳ 等卡片與選單建立完成後填入
    }
    function clearLastBooking() {
        localStorage.removeItem("lastBookingData");
        alert("✅ 上次預約資料已清除！");
    }
    return {
        saveLastBooking,
        restoreLastBooking,
        clearLastBooking
    };
})();
