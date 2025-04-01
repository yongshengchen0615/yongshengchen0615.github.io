import { BookingTimeModule ,} from "./js/modules/bookingTimeModule.js";
import { BookingModule } from "./js/modules/bookingModule.js";
import { BookingStorageModule } from "./js/modules/bookingStorageModule.js";
import { updateTotalAll, generateBookingData } from "./js/utils/bookingUtils.js";
import { handleSubmit } from "./js/handlers/submitHandler.js";
import { HistoryModule } from "./js/modules/historyModule.js";
import { TestModeModule } from "./js/modules/testModeModule.js";

$(document).ready(async function () {
    try {
        TestModeModule.init(false);
        if (TestModeModule.isTesting()) {
            document.getElementById("test-tools").classList.remove("d-none");
        
            // 測試按鈕功能綁定
            document.getElementById("inject-test").addEventListener("click", () => {
                TestModeModule.injectTestData();
            });
        
            document.getElementById("clear-all-storage").addEventListener("click", () => {
                if (confirm("⚠️ 確定要清除所有儲存資料嗎？這個動作無法還原。")) {
                    localStorage.clear();
                    alert("✅ 已清除所有儲存資料！");
                    location.reload();
                }
            });
        }
        
        await liff.init({ liffId: "2005939681-WrwevLMV" });
        //  alert("您的使用者編號"+liff.profile.userId);

        // 🛑 不強制登入，允許未登入的使用者使用
        if (!liff.isInClient()) {
            alert("⚠️ 注意：目前不在 LINE 應用內，功能可能無法使用。");
        }
        // 獲取用戶資訊
        liff.getProfile().then(profile => {
            document.getElementById("user-id").textContent = `UserID: ${profile.userId}`;
            // alert("user ID:" + profile.userId);
        }).catch(err => {
            console.error("❌ 獲取用戶資訊失敗:", err);
        });

    } catch (err) {
        console.error("❌ LIFF 初始化失敗", err);
        alert("⚠️ 無法載入 LIFF，請重新整理頁面！");
    }

    // ✅ 初始化「預約時間」模組
    BookingTimeModule.setHolidays([
        '2025-04-07',
         '2025-04-08'
    ]);
    
    BookingTimeModule.setWeeklyHolidays([
        0, // 每週日
        6  // 每週六
      ]);

    BookingTimeModule.setBreakPeriods([
       // { start: "12:00", end: "13:00" }
    ]);
    
    // 預約時間 10:00～22:00，需提前 30 分鐘
    BookingTimeModule.init("9:00", "21:00", 60);
    BookingModule.init("#num-people", "#people-container", 5); //最多5人
    BookingStorageModule.restoreToForm(BookingStorageModule.load());
    // 🔻 ✅ 就放這裡
    $("#clear-history").click(() => {
        BookingStorageModule.clear();
        alert("✅ 已清除上次預約紀錄！");
    });
    HistoryModule.renderHistoryList("#history-container");

    // 初始化時計算一次總額（重要！）
    updateTotalAll();
    handleSubmit(); // ✅ 綁定送出處理
    // ✅ 測試用：清除所有 localStorage 資料
    $("#clear-all-storage").click(() => {
        if (confirm("⚠️ 確定要清除所有儲存資料嗎？這個動作無法還原。")) {
            localStorage.clear();
            alert("✅ 已清除所有儲存資料！");
            location.reload(); // 重新整理畫面
        }
    });
});
