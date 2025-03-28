// submitHandler.js
import { validateName, validatePhone } from "./validation.js";
import { BookingModule } from "./bookingModule.js";
import { BookingTimeModule } from "./bookingTimeModule.js";
import { PreviewModule } from "./previewModule.js";

export function handleSubmit() {
  if (!validateName() || !validatePhone()) {
    alert("請確保姓名與手機格式正確！");
    return;
  }

  if (!BookingModule.checkAtLeastOneServiceSelected()) return;

  const name = $("#name").val();
  const phone = $("#phone").val();
  const date = BookingTimeModule.formatDateWithDay($("#booking-date").val());
  const time = $("#booking-time").val();
  const numPeople = $("#num-people").val();
  const bookingTypeText = $("#booking-type option:selected").text();

  // 檢查時間是否合法
  if (!BookingTimeModule.isValidBookingTime($("#booking-date").val(), time)) {
    alert("⚠️ 當日預約已超過可預約時間，請選擇其他時段！");
    return;
  }

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
  
    const personNote = $(this).find(".person-note").val().trim(); // 新增：取得備註
  
    totalTimeAll += personTime;
    totalPriceAll += personPrice;
  
    bookingDetails.push(`👤 預約人 ${personIndex}：
  - 服務內容：${personServices.join(", ")}
  - 服務總時間：${personTime} 分鐘
  - 服務總金額：$${personPrice} 元
  - 備註：${personNote || "（無）"}`);
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



// 送出前：顯示預覽畫面
PreviewModule.render(summary);
PreviewModule.bindEvents((finalSummary) => {
  // 使用者確認後才真正送出
  liff.sendMessages([{ type: "text", text: finalSummary }])
    .then(() => {
      alert("✅ 預約確認訊息已成功傳送！");
      liff.closeWindow();
    })
    .catch(err => {
      alert("⚠️ 發送訊息失敗：" + err);
      console.error(err);
    });
});
}
