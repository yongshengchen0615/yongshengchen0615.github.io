// bookingUtils.js

// 📌 更新總時間與總價格
export function updateTotalAll() {
    let totalTimeAll = 0;
    let totalPriceAll = 0;

    document.querySelectorAll(".person-card").forEach(person => {
        totalTimeAll += parseInt(person.querySelector(".total-time").textContent) || 0;
        totalPriceAll += parseInt(person.querySelector(".total-price").textContent) || 0;
    });

    document.getElementById("total-time-all").textContent = totalTimeAll;
    document.getElementById("total-price-all").textContent = totalPriceAll;
}

// 📌 將預約表單資料打包成結構化 JSON（準備儲存與發送用）
export function generateBookingData() {
    const bookingData = {
        bookingType: document.getElementById("booking-type").value,
        name: document.getElementById("name").value,
        phone: document.getElementById("phone").value,
        date: document.getElementById("booking-date").value,
        time: document.getElementById("booking-time").value,
        numPeople: document.getElementById("num-people").value,
        persons: [],
    };

    // 👥 逐一處理每位預約人
    document.querySelectorAll(".person-card").forEach(card => {
        const main = [];
        const addon = [];

        // 🔍 主要服務列表
        card.querySelectorAll(".main-service-list li").forEach(li => {
            main.push({
                name: li.childNodes[0].textContent.trim(),
                time: parseInt(li.dataset.time) || 0,
                price: parseInt(li.dataset.price) || 0
            });
        });

        // 🔍 加購服務列表（✅ 修正：推入 addon）
        card.querySelectorAll(".addon-service-list li").forEach(li => {
            addon.push({
                name: li.childNodes[0].textContent.trim(),
                time: parseInt(li.dataset.time) || 0,
                price: parseInt(li.dataset.price) || 0
            });
        });

        // 加入該位預約人的所有服務
        bookingData.persons.push({ main, addon });
    });

    return bookingData;
}
