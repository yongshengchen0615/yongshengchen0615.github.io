// historyModule.js
export const HistoryModule = (() => {
    const STORAGE_KEY = "lastBookingData";

    /**
     * 儲存預約資料至 localStorage
     * @param {Object} data - 預約表單資料
     */
    function saveLastBooking(data) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.error("❌ 儲存預約資料失敗：", e);
        }
    }

    /**
     * 從 localStorage 還原預約資料到表單與服務卡片
     */
    function restoreLastBooking() {
        let lastBooking;
        try {
            lastBooking = JSON.parse(localStorage.getItem(STORAGE_KEY));
        } catch (e) {
            console.error("❌ 預約資料格式錯誤：", e);
            return;
        }

        if (!lastBooking) return;

        // ✅ 基本欄位還原
        $("#name").val(lastBooking.name || "");
        $("#phone").val(lastBooking.phone || "");
        $("#booking-type").val(lastBooking.bookingTypeText === "代訂他人" ? "other" : "self");
        $("#booking-date").val(lastBooking.date || "");
        $("#booking-time").val(lastBooking.time || "");
        $("#num-people").val(lastBooking.numPeople).trigger("change");

        // ✅ 改用 MutationObserver 等待卡片生成
        const expectedCards = lastBooking.numPeople;
        const container = document.querySelector("#people-container");
        if (!container) {
            console.error("❌ 找不到 #people-container");
            return;
        }

        const observer = new MutationObserver(() => {
            const cards = container.querySelectorAll(".person-card");
            if (cards.length === expectedCards) {
                observer.disconnect(); // 停止監聽
                console.log("✅ 所有人數卡片已建立，開始還原服務內容");

                lastBooking.persons?.forEach((person, index) => {
                    const card = $(`.person-card[data-person="${index}"]`);
                    if (!card.length) {
                        console.warn(`⚠️ 找不到 person-card：index ${index}`);
                        return;
                    }

                    // 主服務還原
                    person.mainServices?.forEach(service => {
                        const select = card.find(".main-service");
                        if (select.find(`option[value="${service}"]`).length) {
                            select.val(service);
                            card.find(".add-service[data-type='main']").click();
                        } else {
                            console.warn("⚠️ 主服務不存在：", service);
                        }
                    });

                    // 加購服務還原
                    person.addonServices?.forEach(service => {
                        const select = card.find(".addon-service");
                        if (select.find(`option[value="${service}"]`).length) {
                            select.val(service);
                            card.find(".add-service[data-type='addon']").click();
                        } else {
                            console.warn("⚠️ 加購服務不存在：", service);
                        }
                    });
                });
            }
        });

        observer.observe(container, { childList: true, subtree: true });
    }

    return {
        saveLastBooking,
        restoreLastBooking
    };
})();
