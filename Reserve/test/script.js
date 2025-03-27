import { validateName, validatePhone } from "./validation.js";
import { BookingTimeModule } from "./bookingTimeModule.js";
import { BookingModule } from "./bookingModule.js";
import { BookingStorage } from "./bookingStorage.js";

$(document).ready(async function () {
    const lastData = BookingStorage.load();
    if (lastData) {
        $("#name").val(lastData.name);
        $("#phone").val(lastData.phone);
        $("#booking-type").val(lastData.bookingType);
        $("#booking-date").val(lastData.date);
        $("#booking-time").val(lastData.time);
        $("#num-people").val(lastData.numPeople).trigger("change");

        // ⏳ 等人數欄位渲染完再加入服務
        setTimeout(() => {
            $(".person-card").each(function (index) {
                const personData = lastData.people[index];
                personData.services.forEach(srv => {
                    const select = srv.type === "main"
                        ? $(this).find(".main-service")
                        : $(this).find(".addon-service");
                    select.val(srv.name);
                    select.siblings(".add-service").click();
                });
            });
        }, 100);
    }


    try {
        await liff.init({ liffId: "2005939681-WrwevLMV" });
        //  alert("您的使用者編號"+liff.profile.userId);

        // 🛑 不強制登入，允許未登入的使用者使用
        if (!liff.isInClient()) {
            alert("⚠️ 注意：目前不在 LINE 應用內，功能可能無法使用。");
        }
        // 獲取用戶資訊
        liff.getProfile().then(profile => {
            alert("user ID:" + profile.userId);
        }).catch(err => {
            console.error("❌ 獲取用戶資訊失敗:", err);
        });

    } catch (err) {
        console.error("❌ LIFF 初始化失敗", err);
        alert("⚠️ 無法載入 LIFF，請重新整理頁面！");
    }

    // ✅ 初始化「預約時間」模組
    BookingTimeModule.init("9:00", "21:00");
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
        // ⭐️ 確保至少選了一個主要服務（只提示一次）
        if (!BookingModule.checkAtLeastOneServiceSelected()) return;

        const date = BookingTimeModule.formatDateWithDay($("#booking-date").val());
        const time = $("#booking-time").val();


        // ⭐️ 新增時間檢查
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

        // ⭐️ 儲存資料到 localStorage
        BookingStorage.save({
            name, phone, bookingType: $("#booking-type").val(), date, time, numPeople,
            people: $(".person-card").map(function () {
                const services = [];
                $(this).find("li").each(function () {
                    services.push({
                        name: $(this).clone().children("button").remove().end().text().trim(),
                        type: $(this).closest("ul").hasClass("main-service-list") ? "main" : "addon"
                    });
                });
                return { services };
            }).get()
        });


        liff.sendMessages([{ type: "text", text: summary }])
            .then(() => {
                alert("✅ 預約確認訊息已成功傳送！");
                liff.closeWindow();  // ⭐️ 使用者確認後立即關閉
            })
            .catch(err => {
                alert("⚠️ 發送訊息失敗：" + err);
                console.error(err);
            });
    });
});
