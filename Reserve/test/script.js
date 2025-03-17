import { validateName, validatePhone } from "./validation.js";

document.addEventListener("DOMContentLoaded", () => {
    // ✅ 初始化「預約時間」模組
    BookingTime.init();

    const mainServices = {
        "全身經絡按摩": { time: 60, price: 1500 },
        "足部護理": { time: 45, price: 1000 },
        "精油SPA": { time: 90, price: 2000 }
    };

    const addonServices = {
        "肩頸放鬆加強": { time: 30, price: 800 },
        "足部去角質": { time: 20, price: 500 },
        "熱石按摩": { time: 40, price: 1200 }
    };

    function updateTotal() {
        let totalTimeAll = 0, totalPriceAll = 0;
        document.querySelectorAll(".person-card").forEach(person => {
            totalTimeAll += parseInt(person.querySelector(".total-time").textContent);
            totalPriceAll += parseInt(person.querySelector(".total-price").textContent);
        });

        document.getElementById("total-time-all").textContent = totalTimeAll;
        document.getElementById("total-price-all").textContent = totalPriceAll;
    }

    document.getElementById("booking-form").addEventListener("submit", (event) => {
        event.preventDefault();

        if (!validateName() || !validatePhone()) {
            alert("請確保姓名與手機格式正確！");
            return;
        }

        let date = BookingTime.formatDateWithDay(document.getElementById("booking-date").value);
        let time = document.getElementById("booking-time").value;
        let name = document.getElementById("name").value;
        let phone = document.getElementById("phone").value;
        let numPeople = document.getElementById("num-people").value;
        let totalPrice = document.getElementById("total-price-all").textContent;
        let totalTimeAll = 0;
        let bookingDetails = [];

        document.querySelectorAll(".person-card").forEach((person, index) => {
            let personIndex = index + 1;
            let personTime = parseInt(person.querySelector(".total-time").textContent);
            totalTimeAll += personTime;
            let personServices = [];

            person.querySelectorAll(".main-service-list li, .addon-service-list li").forEach(service => {
                personServices.push(service.textContent.replace("刪除", "").trim());
            });

            bookingDetails.push(`👤 預約人 ${personIndex}：\n- 服務內容：${personServices.join(", ")}\n- 服務總時間：${personTime} 分鐘`);
        });

        let summary = `✅ 預約成功！\n📅 ${date}\n⏰ ${time}\n👤 ${name}\n📞 ${phone}\n👥 ${numPeople} 人\n💰 總價格：$${totalPrice} 元\n⏳ 總服務時間：${totalTimeAll} 分鐘\n\n${bookingDetails.join("\n\n")}`;

        liff.sendMessages([{ type: "text", text: summary }]).then(() => liff.closeWindow());
    });
});
