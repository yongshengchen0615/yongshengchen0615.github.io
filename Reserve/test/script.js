import { validateName, validatePhone } from "./validation.js";
import { BookingTimeModule } from "./bookingTimeModule.js";
import { BookingModule } from "./bookingModule.js";

$(document).ready(function () {
// ✅ 初始化 LIFF（先做這一步！）
liff.init({ liffId: "2007061321-g603NNZG" })
    .catch(err => console.error("LIFF 初始化錯誤", err));

    // ✅ 初始化「預約時間」模組
    BookingTimeModule.init("9:00","21:00");
    BookingModule.init("#num-people", "#people-container", 5); //最多5人

    function updateTotal() {
        let totalTimeAll = 0, totalPriceAll = 0;
        document.querySelectorAll(".person-card").forEach(person => {
            totalTimeAll += parseInt(person.querySelector(".total-time").textContent);
            totalPriceAll += parseInt(person.querySelector(".total-price").textContent);
        });

        $("#total-time-all").text(totalTimeAll);
        $("#total-price-all").text(totalPriceAll);
    }

    // 初始化時計算一次總額（重要！）
    updateTotal();
    $("#booking-form").submit(function (event) {
        event.preventDefault();
    
        if (!validateName() || !validatePhone()) {
            alert("請確保姓名與手機格式正確！");
            return;
        }
    
        const date = BookingTimeModule.formatDateWithDay($("#booking-date").val());
        const time = $("#booking-time").val();
        const name = $("#name").val();
        const phone = $("#phone").val();
        const numPeople = $("#num-people").val();
    
        let totalPriceAll = 0;
        let totalTimeAll = 0;
        const bookingDetails = [];
    
        $(".person-card").each(function (index) {
            const personIndex = index + 1;
            let personTime = 0;
            let personPrice = 0;
            const personServices = [];
    
            $(this).find(".main-service-list li, .addon-service-list li").each(function () {
                const serviceText = $(this).clone().children("button").remove().end().text().trim();
                const serviceTime = parseInt($(this).attr("data-time"));
                const servicePrice = parseInt($(this).attr("data-price"));
                personServices.push(serviceText);
                personTime += serviceTime;
                personPrice += servicePrice;
            });
    
            totalTimeAll += personTime;
            totalPriceAll += personPrice;
    
            bookingDetails.push(`👤 預約人 ${personIndex}：
    - 服務內容：${personServices.join(", ")}
    - 服務總時間：${personTime} 分鐘
    - 服務總金額：$${personPrice} 元`);
        });
    
        $("#total-time-all").text(totalTimeAll);
        $("#total-price-all").text(totalPriceAll);
    
        const summary = 
    `✅ 預約成功！
    📅 日期：${date}
    ⏰ 時間：${time}
    👤 姓名：${name}
    📞 電話：${phone}
    👥 人數：${numPeople} 人
    
    ${bookingDetails.join("\n\n")}
    
    ⏳ 總時間：${totalTimeAll} 分鐘
    💰 總金額：$${totalPriceAll} 元`;
    
    liff.sendMessages([{ type: "text", text: summary }])
    .then(() => {
        alert("✅ 預約確認訊息已成功傳送！");
        liff.closeWindow();
    })
    .catch(err => {
        alert("⚠️ 發送訊息失敗：" + err);
        console.error(err);
    });
    });
});
