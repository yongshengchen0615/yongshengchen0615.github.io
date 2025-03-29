import { validateName, validatePhone } from "./validation.js";
import { BookingTimeModule } from "./bookingTimeModule.js";
import { BookingModule } from "./bookingModule.js";
import { BookingStorageModule } from "./bookingStorageModule.js";

// ✅ 表單重設函式：清空所有欄位與卡片
function resetForm() {
    $("#booking-type").val("");
    $("#name").val("");
    $("#phone").val("");
    $("#booking-date").val("");
    $("#booking-time").val("");
    $("#num-people").val("1").trigger("change");
    $("#person-list").empty();
}

// ✅ 計算總時間與金額
function updateTotal() {
    let totalTimeAll = 0, totalPriceAll = 0;
    document.querySelectorAll(".person-card").forEach(person => {
        totalTimeAll += parseInt(person.querySelector(".total-time").textContent || "0");
        totalPriceAll += parseInt(person.querySelector(".total-price").textContent || "0");
    });

    $("#total-time-all").text(totalTimeAll);
    $("#total-price-all").text(totalPriceAll);
}

// ✅ 頁面載入後執行
$(document).ready(async function () {
    // ▶ LIFF 初始化
    try {
        await liff.init({ liffId: "2005939681-WrwevLMV" });

        if (!liff.isInClient()) {
            alert("⚠️ 注意：目前不在 LINE 應用內，功能可能無法使用。");
        }

        // ▶ 取得用戶資料
        liff.getProfile()
            .then(profile => alert("user ID: " + profile.userId))
            .catch(err => console.error("❌ 獲取用戶資訊失敗:", err));

    } catch (err) {
        console.error("❌ LIFF 初始化失敗", err);
        alert("⚠️ 無法載入 LIFF，請重新整理頁面！");
    }

    // ▶ 預約模組初始化
    BookingTimeModule.init("9:00", "21:00");
    BookingModule.init("#num-people", "#people-container", 5); // 最多5人

    // ▶ 嘗試還原上次預約
    BookingStorageModule.restoreToForm(BookingStorageModule.load());

    // ▶ 清除上次預約事件
    document.getElementById("clear-history").addEventListener("click", () => {
        if (confirm("確定要清除上次預約紀錄嗎？此操作無法還原。")) {
            BookingStorageModule.clear();
            resetForm();
            alert("✅ 已清除上次預約紀錄與畫面資料！");
        }
    });

    // ▶ 初次更新總計
    updateTotal();

    // ▶ 預約送出邏輯
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

        const summary = `
   等待預約回覆
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
                alert("✅ 預約確認訊息已成功傳送！");

                const bookingData = {
                    bookingType: $("#booking-type").val(),
                    name,
                    phone,
                    date: $("#booking-date").val(),
                    time,
                    numPeople,
                    persons: []
                };

                $(".person-card").each(function () {
                    const main = [];
                    const addon = [];

                    $(this).find(".main-service-list li").each(function () {
                        main.push($(this).text().replace("刪除", "").trim());
                    });

                    $(this).find(".addon-service-list li").each(function () {
                        addon.push($(this).text().replace("刪除", "").trim());
                    });

                    bookingData.persons.push({ main, addon });
                });

                BookingStorageModule.save(bookingData); // 儲存到 localStorage
                liff.closeWindow(); // 關閉 LINE 視窗
            })
            .catch(err => {
                alert("⚠️ 發送訊息失敗：" + err);
                console.error(err);
            });
    });
});
