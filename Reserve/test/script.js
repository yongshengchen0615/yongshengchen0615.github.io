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

        let date = BookingTimeModule.formatDateWithDay($("#booking-date").val());
        let time = $("#booking-time").val();
        let name = $("#name").val();
        let phone = $("#phone").val();
        let numPeople = $("#num-people").val();
        let totalPrice = $("#total-price-all").text();
        let totalTimeAll = 0;
        let bookingDetails = [];

        $(".person-card").each(function (index) {
            const personIndex = index + 1;
            let personTime = 0;
            let personPrice = 0;  // ⭐️ 新增：個人價格總計
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
    - 個人金額：$${personPrice} 元`); // ⭐️ 新增金額於此
        });

        const summary = `✅ 預約成功！
📅 日期：${date}
⏰ 時間：${time}
👤 姓名：${name}
📞 電話：${phone}
👥 人數：${numPeople} 人

${bookingDetails.join("\n\n")}

⏳ 總時間：${totalTimeAll} 分鐘
💰 總金額：$${totalPrice} 元`;

    // 發送訊息至LINE對話框（只會送出介面上現有項目）
    liff.sendMessages([{ type: "text", text: summary }])
        .then(() => liff.closeWindow())
        .catch(err => {
            alert("發送訊息失敗：" + err);
        });

        liff.sendMessages([{ type: "text", text: summary }]).then(() => liff.closeWindow());
    });
});
