import { BookingTimeModule } from "./js/modules/bookingTimeModule.js";
import { BookingModule } from "./js/modules/bookingModule.js";
import { BookingStorageModule } from "./js/modules/bookingStorageModule.js";
import { updateTotalAll, generateBookingData } from "./js/utils/bookingUtils.js";
import { handleSubmit } from "./js/handlers/submitHandler.js";
import { HistoryModule } from "./js/modules/historyModule.js";
import { TestModeModule } from "./js/modules/testModeModule.js";

$(document).ready(async function () {
    try {
        // ✅ 啟用測試模式
        TestModeModule.init(false);

        // ✅ 顯示測試工具區塊（如果有啟用）
        if (TestModeModule.isTesting()) {
            document.getElementById("test-tools").classList.remove("d-none");

            // 測試資料注入
            const injectBtn = document.getElementById("inject-test");
            if (injectBtn) {
                injectBtn.addEventListener("click", () => {
                    TestModeModule.injectTestData();
                });
            }
        }

        // ✅ 🔁 對所有 .clear-all-storage 按鈕都有效（不管放哪裡、何時出現）
        $(document).on("click", ".clear-all-storage", () => {
            console.log("=====");
            if (confirm("⚠️ 確定要清除所有儲存資料嗎？這個動作無法還原。")) {
                localStorage.clear();
                alert("✅ 已清除所有儲存資料！");
                location.reload();
            }
        });

        // ✅ 初始化 LIFF（若可用）
        if (typeof window.liff !== "undefined" && typeof liff.init === "function") {
            await liff.init({ liffId: "2005939681-vgdMV81W" });
            if (!liff.isInClient()) {
                alert("⚠️ 注意：目前不在 LINE 應用內，功能可能無法使用。");
            }
        } else {
            console.warn("略過 LIFF 初始化（非 LINE 環境或測試模式）");
        }

        // 獲取使用者資訊
        liff.getProfile().then(profile => {
            // 可選：顯示或記錄 userId
            // document.getElementById("user-id").textContent = `UserID: ${profile.userId}`;
        }).catch(err => {
            console.error("❌ 獲取用戶資訊失敗:", err);
        });

    } catch (err) {
        console.error("❌ LIFF 初始化失敗", err);
        alert("⚠️ 無法載入 LIFF，請重新整理頁面！");
    }

    // ✅ 預約時間設定：9:00~21:00，需提前 60 分鐘
    BookingTimeModule.init();

    // ✅ 預約模組初始化（最多5人）
    BookingModule.init("#num-people", "#people-container", 5);

    // ✅ 恢復暫存資料（localStorage）
    BookingStorageModule.restoreToForm(BookingStorageModule.load());

    // ⛳️ 移除不存在的 #clear-history 綁定（清除功能統一由 .clear-all-storage 處理）

    // ✅ 渲染歷史紀錄清單
    HistoryModule.renderHistoryList("#history-container");

    // ✅ 初次計算總金額
    updateTotalAll();

    // ✅ 綁定預約送出行為
    handleSubmit();
});
