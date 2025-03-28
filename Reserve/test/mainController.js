// mainController.js
import { BookingTimeModule } from "./bookingTimeModule.js";
import { BookingModule } from "./bookingModule.js";
import { handleSubmit } from "./submitHandler.js";
import { HistoryModule } from "./historyModule.js"; // ⬅️ 引入

$(document).ready(async function () {
  try {
    // 初始化 LINE LIFF
    await liff.init({ liffId: "2005939681-WrwevLMV" });

    if (!liff.isInClient()) {
      alert("⚠️ 注意：目前不在 LINE 應用內，功能可能無法使用。");
    }

    liff.getProfile()
      .then(profile => {
        const userInfoDiv = document.getElementById("user-info");
        userInfoDiv.textContent = `👤 使用者 ID：${profile.userId}`;
        userInfoDiv.style.display = "block";

        // 綁定查詢按鈕
        HistoryModule.bindHistoryButton(profile.userId);
      })
  } catch (err) {
    console.error("❌ LIFF 初始化失敗", err);
    alert("⚠️ 無法載入 LIFF，請重新整理頁面！");
  }

  // 初始化預約時間模組與服務模組
  BookingTimeModule.init("9:00", "21:00");
  BookingModule.init("#num-people", "#people-container", 5);

  // 總計重新計算（初始）
  updateTotal();

  // 表單送出綁定
  $("#booking-form").submit(function (event) {
    event.preventDefault();
    handleSubmit(); // 改由 submitHandler 處理
  });
});

// 重新計算所有人總時間與總價
function updateTotal() {
  let totalTimeAll = 0, totalPriceAll = 0;
  document.querySelectorAll(".person-card").forEach(person => {
    totalTimeAll += parseInt(person.querySelector(".total-time").textContent);
    totalPriceAll += parseInt(person.querySelector(".total-price").textContent);
  });

  $("#total-time-all").text(totalTimeAll);
  $("#total-price-all").text(totalPriceAll);
}
