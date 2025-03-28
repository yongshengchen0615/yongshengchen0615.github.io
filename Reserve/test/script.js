import { validateName, validatePhone } from "./validation.js";
import { BookingTimeModule } from "./bookingTimeModule.js";
import { BookingModule } from "./bookingModule.js";
import { HistoryModule } from "./historyModule.js";

$(document).ready(async function () {
    try {
        await liff.init({ liffId: "2005939681-WrwevLMV" });

        if (!liff.isInClient()) {
            alert("⚠️ 注意：目前不在 LINE 應用內，功能可能無法使用。");
        }

        liff.getProfile().then(profile => {
            alert("user ID:" + profile.userId);
        }).catch(err => {
            console.error("❌ 獲取用戶資訊失敗:", err);
        });

    } catch (err) {
        console.error("❌ LIFF 初始化失敗", err);
        alert("⚠️ 無法載入 LIFF，請重新整理頁面！");
    }

    // ✅ 初始化預約時間與表單模組
    BookingTimeModule.init("9:00", "21:00");
    BookingModule.init("#num-people", "#people-container", 5); // 最多 5 人

    // ✅ 還原最後一次預約（含 MutationObserver 等待卡片建立）
    HistoryModule.restoreLastBooking();

    // ✅ 計算總金額與總時間
    function updateTotal() {
        let totalTimeAll = 0, totalPriceAll = 0;
        document.querySelectorAll(".person-card").forEach(person => {
            totalTimeAll += parseInt(person.querySelector(".total-time").textContent);
            totalPriceAll += parseInt(person.querySelector(".total-price").textContent);
        });

        $("#total-time-all").text(totalTimeAll);
        $("#total-price-all").text(totalPriceAll);
    }

    updateTotal(); // 初始化時計算一次

    // ✅ 預約表單送出事件處理
    $("#booking-form").submit(function (event) {
        event.preventDefault();

        if (!validateName() || !validatePhone()) {
            alert("請確保姓名與手機格式正確！");
            return;
        }

        if (!BookingModule.checkAtLeastOneServiceSelected()) return;

        const date = BookingTimeModule.formatDateWithDay($("#booking-date").val());
        const time = $("#booking-time").val();

        if (!BookingTimeModule.isValidBookingTime(date, time)) {
            alert("⚠️ 當日預約已超過可預約時間，請選擇其他時段！");
            return;
        }

        const name = $("#name").val();
        const phone = $("#phone").val();
        const numPeople = $("#num-people").val();
        const bookingTypeText = $("#booking-type option:selected").text();

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
            `   等待預約回覆
    - 預約類型：${bookingTypeText}
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
                // ✅ 儲存至 localStorage
                HistoryModule.saveLastBooking({
                    name,
                    phone,
                    bookingTypeText,
                    date: $("#booking-date").val(),
                    time,
                    numPeople,
                    persons: $(".person-card").map(function () {
                        return {
                            mainServices: $(this).find(".main-service-list li").map(function () {
                                return $(this).clone().children("button").remove().end().text().trim();
                            }).get(),
                            addonServices: $(this).find(".addon-service-list li").map(function () {
                                return $(this).clone().children("button").remove().end().text().trim();
                            }).get()
                        };
                    }).get()
                });

                alert("✅ 預約確認訊息已成功傳送！");
                liff.closeWindow(); // 關閉 LINE LIFF 視窗
            })
            .catch(err => {
                alert("⚠️ 發送訊息失敗：" + err);
                console.error(err);
            });
    });
});
