import { validateName, validatePhone } from "./validation.js";
import { BookingTimeModule } from "./bookingTimeModule.js";
import { BookingModule } from "./bookingModule.js";

$(document).ready(async function () {
    await initLIFF();

    BookingTimeModule.init("9:00", "21:00");
    BookingModule.init("#num-people", "#people-container", 5);
    updateTotal();

    $("#booking-form").submit(handleSubmit);
});

async function initLIFF() {
    try {
        await liff.init({ liffId: "2005939681-WrwevLMV" });

        if (!liff.isInClient()) {
            alert("⚠️ 注意：目前不在 LINE 應用內，功能可能無法使用。");
        }

        const profile = await liff.getProfile();
        alert("user ID:" + profile.userId);

    } catch (err) {
        console.error("❌ LIFF 初始化失敗", err);
        alert("⚠️ 無法載入 LIFF，請重新整理頁面！");
    }
}

// ✅ 計算總時間與金額
function updateTotal() {
    let totalTimeAll = 0, totalPriceAll = 0;
    $(".person-card").each(function () {
        totalTimeAll += parseInt($(this).find(".total-time").text());
        totalPriceAll += parseInt($(this).find(".total-price").text());
    });
    $("#total-time-all").text(totalTimeAll);
    $("#total-price-all").text(totalPriceAll);
}

// ✅ 表單送出處理
function handleSubmit(event) {
    event.preventDefault();

    if (!validateName() || !validatePhone()) {
        alert("請確保姓名與手機格式正確！");
        return;
    }

    if (!BookingModule.checkAtLeastOneServiceSelected()) return;

    const date = $("#booking-date").val();
    const time = $("#booking-time").val();

    if (!BookingTimeModule.isValidBookingTime(date, time)) {
        alert("⚠️ 當日預約已超過可預約時間，請選擇其他時段！");
        return;
    }

    const name = $("#name").val();
    const phone = $("#phone").val();
    const bookingTypeText = $("#booking-type option:selected").text();
    const numPeople = $("#num-people").val();
    const dateWithDay = BookingTimeModule.formatDateWithDay(date);

    let totalPriceAll = 0;
    let totalTimeAll = 0;
    const bookingDetails = [];

    $(".person-card").each(function (index) {
        const personIndex = index + 1;
        let personTime = 0, personPrice = 0;
        const personServices = [];

        $(this).find(".main-service-list li, .addon-service-list li").each(function () {
            const text = $(this).clone().children("button").remove().end().text().trim();
            const time = parseInt($(this).attr("data-time"));
            const price = parseInt($(this).attr("data-price"));
            personServices.push(text);
            personTime += time;
            personPrice += price;
        });

        totalTimeAll += personTime;
        totalPriceAll += personPrice;

        bookingDetails.push(`👤 預約人 ${personIndex}：
- 服務內容：${personServices.join(", ")}
- 服務總時間：${personTime} 分鐘
- 服務總金額：$${personPrice} 元`);
    });

    const summary = `等待預約回覆
- 預約類型：${bookingTypeText}
📅 日期：${dateWithDay}
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
}
