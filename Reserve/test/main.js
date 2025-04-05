import { loadBookingConfig, bookingConfig } from "./js/data/bookingConfig.js";
import { BookingTimeModule } from "./js/modules/bookingTimeModule.js";
import { BookingModule } from "./js/modules/bookingModule.js";
import { BookingStorageModule } from "./js/modules/bookingStorageModule.js";
import { updateTotalAll } from "./js/utils/bookingUtils.js";
import { handleSubmit } from "./js/handlers/submitHandler.js";
import { HistoryModule } from "./js/modules/historyModule.js";
import { TestModeModule } from "./js/modules/testModeModule.js";

$(document).ready(async function () {
  try {
    // ✅ Step 1：載入後台 API 設定
    await loadBookingConfig();

    // ✅ Step 2：啟用測試模式（非 LINE 環境才啟用）
    TestModeModule.init(false);
    if (TestModeModule.isTesting()) {
      document.getElementById("test-tools").classList.remove("d-none");
      const injectBtn = document.getElementById("inject-test");
      if (injectBtn) {
        injectBtn.addEventListener("click", () => {
          TestModeModule.injectTestData();
        });
      }
    }

    // ✅ Step 3：初始化時間模組與預約模組
    BookingTimeModule.init(bookingConfig); // ⏰ 動態設定時間
    BookingModule.init("#num-people", "#people-container", 5, bookingConfig.services); // 💡 傳入服務資料

    // ✅ Step 4：還原上次預約資料（若有）
    BookingStorageModule.restoreToForm(BookingStorageModule.load());

    // ✅ Step 5：渲染歷史紀錄區塊
    HistoryModule.renderHistoryList("#history-container");

    // ✅ Step 6：初次總金額計算
    updateTotalAll();

    // ✅ Step 7：綁定送出事件
    handleSubmit();

    // ✅ Step 8：綁定清除 localStorage 功能
    $(document).on("click", ".clear-all-storage", () => {
      if (confirm("⚠️ 確定要清除所有儲存資料嗎？這個動作無法還原。")) {
        localStorage.clear();
        alert("✅ 已清除所有儲存資料！");
        location.reload();
      }
    });

    // ✅ Step 9：LIFF 初始化（如在 LINE 中）
    await liff.init({ liffId: "2007061321-g603NNZG" });
    if (!liff.isInClient()) {
      alert("⚠️ 注意：目前不在 LINE 應用內，功能可能無法使用。");
    }

    liff.getProfile().then(profile => {
      // 可記錄 userId 或顯示姓名
      // document.getElementById("user-id").textContent = `UserID: ${profile.userId}`;
    }).catch(err => {
      console.error("❌ 獲取用戶資訊失敗:", err);
    });

  } catch (err) {
    console.error("❌ 系統初始化失敗", err);
    alert("⚠️ 載入設定或初始化失敗，請稍後再試！");
  }
});
