// submitHandler.js
import { validateName, validatePhone } from "../utils/validation.js";
import { BookingModule } from "../modules/bookingModule.js";
import { BookingTimeModule } from "../modules/bookingTimeModule.js";
import { BookingStorageModule } from "../modules/bookingStorageModule.js";
import { updateTotalAll, generateBookingData } from "../utils/bookingUtils.js";
import { mainServices, addonServices } from "../data/serviceData.js"; // ✅ 新增

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

        if (!BookingTimeModule.isValidTimeFormat(time)) {
            alert("⚠️ 時間格式錯誤，請選擇有效時間");
            return;
        }

        if (!BookingTimeModule.isValidBookingTime($("#booking-date").val(), time)) {
            alert("⚠️ 當日預約已超過可預約時間，請選擇其他時段！");
            return;
        }

        updateTotalAll();
        const bookingData = generateBookingData();

        const bookingTypeText = $("#booking-type option:selected").text();

        const EXTRA_TIME_BUFFER = 0; // 可視需要獨立移出設定檔

        const bookingDetails = bookingData.persons.map((p, i) => {
            const allServices = [...p.main, ...p.addon];

            // 🔍 從資料中查出 time/price
            const timeSum = allServices
                .map(name => getServiceMeta(name).time)
                .reduce((a, b) => a + b, 0);

            const priceSum = allServices
                .map(name => getServiceMeta(name).price)
                .reduce((a, b) => a + b, 0);

            const noteLine = p.note ? `- 備註：${p.note}` : "";

            return `👤 顧客 ${i + 1}：
- 服務內容：${allServices.join(", ")}
- 服務總時間：${timeSum + EXTRA_TIME_BUFFER} 分鐘
- 服務總金額：$${priceSum} 元
${noteLine}`;
        });

        const totalPrice = $("#total-price-all").text();

        const summary = `
- 預約類型：${bookingTypeText}
📅 日期：${date}
⏰ 時間：${time}
👤 姓名：${bookingData.name}
📞 電話：${bookingData.phone}
👥 人數：${bookingData.numPeople} 人

${bookingDetails.join("\n\n")}

💰 總金額：$${totalPrice} 元

感謝您的預約訊息！
我們會在 24 小時內回覆您，確認最終預約時段。
提醒您：需收到我們的確認回覆，預約才算完成。
若有特定時段偏好，也歡迎一併告知，方便加速安排。
謝謝您的耐心等候，期待與您見面！
`;

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

    /**
     * 根據服務名稱從 main/addon services 取出資料
     * @param {string} name
     * @returns {{ time: number, price: number }}
     */
    function getServiceMeta(name) {
        return mainServices[name] || addonServices[name] || { time: 0, price: 0 };
    }
}
