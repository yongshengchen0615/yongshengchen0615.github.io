// 導入模組
import { validateName, validatePhone } from "./validation.js";
import { BookingTimeModule } from "./bookingTimeModule.js";
import { BookingModule } from "./bookingModule.js";
import { HistoryModule } from "./historyModule.js";

$(document).ready(async function () {
  bindEventListeners(); // 綁定事件

  try {
    const lastBooking = JSON.parse(localStorage.getItem("lastBookingData"));
    if (lastBooking) {
      restoreFormFields(lastBooking);
      setTimeout(() => applyLastBookingServices(lastBooking), 200);
    }
    await initLiff();
  } catch (err) {
    console.error("❌ LIFF 初始化失敗", err);
    alert("⚠️ 無法載入 LIFF，請重新整理頁面！");
  }

  BookingTimeModule.init("9:00", "21:00");
  BookingModule.init("#num-people", "#people-container", 5);
  HistoryModule.restoreLastBooking();
  updateTotal();
});

function bindEventListeners() {
  $("#clear-booking").on("click", () => {
    if (confirm("確定要清除上次預約資料嗎？")) {
      HistoryModule.clearLastBooking();
    }
  });
  $("#booking-form").submit(handleSubmit);
}

function restoreFormFields(data) {
  $("#name").val(data.name);
  $("#phone").val(data.phone);
  $("#booking-type").val(data.bookingTypeText === "代訂他人" ? "other" : "self");
  $("#booking-date").val(data.date);
  $("#booking-time").val(data.time);
  $("#num-people").val(data.numPeople).trigger("change");
}

function applyLastBookingServices(data) {
  data.persons.forEach((person, index) => {
    const card = $(`.person-card[data-person="${index}"]`);
    person.mainServices.forEach(service => {
      card.find(".main-service").val(service);
      card.find(".add-service[data-type='main']").click();
    });
    person.addonServices.forEach(service => {
      card.find(".addon-service").val(service);
      card.find(".add-service[data-type='addon']").click();
    });
  });
}

async function initLiff() {
  await liff.init({ liffId: "2005939681-WrwevLMV" });
  if (!liff.isInClient()) {
    alert("⚠️ 注意：目前不在 LINE 應用內，功能可能無法使用。");
  }
  try {
    const profile = await liff.getProfile();
    alert("user ID:" + profile.userId);
  } catch (err) {
    console.error("❌ 獲取用戶資訊失敗:", err);
  }
}

function updateTotal() {
  let totalTimeAll = 0;
  let totalPriceAll = 0;
  document.querySelectorAll(".person-card").forEach(card => {
    totalTimeAll += parseInt(card.querySelector(".total-time").textContent);
    totalPriceAll += parseInt(card.querySelector(".total-price").textContent);
  });
  $("#total-time-all").text(totalTimeAll);
  $("#total-price-all").text(totalPriceAll);
}

function handleSubmit(event) {
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

  const { totalPriceAll, totalTimeAll, bookingDetails } = collectBookingDetails();
  
  $("#total-time-all").text(totalTimeAll);
  $("#total-price-all").text(totalPriceAll);

  const summary = formatBookingSummary({
    bookingTypeText,
    date,
    time,
    name,
    phone,
    numPeople,
    totalTimeAll,
    totalPriceAll,
    bookingDetails
  });

  liff.sendMessages([{ type: "text", text: summary }])
    .then(() => {
      HistoryModule.saveLastBooking({
        name,
        phone,
        numPeople,
        bookingTypeText,
        date: $("#booking-date").val(),
        time,
        persons: extractServiceData()
      });
      alert("✅ 預約確認訊息已成功傳送！");
      liff.closeWindow();
    })
    .catch(err => {
      alert("⚠️ 發送訊息失敗：" + err);
      console.error(err);
    });
}

function collectBookingDetails() {
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

    bookingDetails.push(`👤 預約人 ${personIndex}：\n    - 服務內容：${personServices.join(", ")}\n    - 服務總時間：${personTime} 分鐘\n    - 服務總金額：$${personPrice} 元`);
  });

  return { totalPriceAll, totalTimeAll, bookingDetails };
}

function extractServiceData() {
  return $(".person-card").map(function () {
    return {
      mainServices: $(this).find(".main-service-list li").map(function () {
        return $(this).clone().children("button").remove().end().text().trim();
      }).get(),
      addonServices: $(this).find(".addon-service-list li").map(function () {
        return $(this).clone().children("button").remove().end().text().trim();
      }).get()
    };
  }).get();
}

function formatBookingSummary({ bookingTypeText, date, time, name, phone, numPeople, totalTimeAll, totalPriceAll, bookingDetails }) {
  return `   等待預約回覆\n    - 預約類型：${bookingTypeText}\n     📅 日期：${date}\n     ⏰ 時間：${time}\n     👤 姓名：${name}\n     📞 電話：${phone}\n     👥 人數：${numPeople} 人\n\n    ${bookingDetails.join("\n\n")}\n\n    ⏳ 總時間：${totalTimeAll} 分鐘\n    💰 總金額：$${totalPriceAll} 元`;
}
