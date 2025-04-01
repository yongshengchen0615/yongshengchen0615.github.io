// submitHandler.js
import { validateName, validatePhone } from "../utils/validation.js";
import { BookingModule } from "../modules/bookingModule.js";
import { BookingTimeModule } from "../modules/bookingTimeModule.js";
import { BookingStorageModule } from "../modules/bookingStorageModule.js";
import { updateTotalAll, generateBookingData } from "../utils/bookingUtils.js";

export function handleSubmit() {
    const $form = $("#booking-form");

    $form.on("submit", async function (event) {
        event.preventDefault();

        if (!validateName() || !validatePhone()) {
            alert("請確保姓名與手機格式正確！");
            return;
        }

        if (!BookingModule.checkAtLeastOneServiceSelected()) return;

        const date = BookingTimeModule.formatDateWithDay($("#booking-date").val());
        const time = $("#booking-time").val();
        
        // ✅ 新增：時間格式驗證
        if (!BookingTimeModule.isValidTimeFormat(time)) {
            alert("⚠️ 時間格式錯誤，請選擇有效時間");
            return;
        }
        
        // 原有：檢查是否為可預約時段
        if (!BookingTimeModule.isValidBookingTime($("#booking-date").val(), time)) {
            alert("⚠️ 當日預約已超過可預約時間，請選擇其他時段！");
            return;
        }

        updateTotalAll(); // 確保最新總額顯示
        const bookingData = generateBookingData();

        const bookingTypeText = $("#booking-type option:selected").text();

        const bookingDetails = bookingData.persons.map((p, i) => {
            const services = [...p.main, ...p.addon].join(", ");
            const timeSum = p.main.concat(p.addon)
                .map(name => getTimeFromName(name)).reduce((a, b) => a + b, 0);
            const priceSum = p.main.concat(p.addon)
                .map(name => getPriceFromName(name)).reduce((a, b) => a + b, 0);
                const noteLine = p.note ? `- 備註：${p.note}` : "";

            return `👤 顧客 ${i + 1}：
- 服務內容：${services}
- 服務總時間：${timeSum} 分鐘
- 服務總金額：$${priceSum} 元
${noteLine}
`;

        });
        const totalPrice = $("#total-price-all").text();

        const summary = `等待預約回覆
- 預約類型：${bookingTypeText}
📅 日期：${date}
⏰ 時間：${time}
👤 姓名：${bookingData.name}
📞 電話：${bookingData.phone}
👥 人數：${bookingData.numPeople} 人

${bookingDetails.join("\n\n")}

💰 總金額：$${totalPrice} 元`;

        try {
            await liff.sendMessages([{ type: "text", text: summary }]);
            alert("✅ 預約確認訊息已成功傳送！");
            BookingStorageModule.save(bookingData);
            liff.closeWindow();
        } catch (err) {
            alert("⚠️ 發送訊息失敗：" + err);
            console.error(err);
        }
    });

    // 解析時間與價格
    function getTimeFromName(name) {
        const match = name.match(/(\d{2,3})分鐘/);
        return match ? parseInt(match[1]) : 0;
    }

    function getPriceFromName(name) {
        const match = name.match(/\$(\d+)/);
        return match ? parseInt(match[1]) : 0;
    }
}