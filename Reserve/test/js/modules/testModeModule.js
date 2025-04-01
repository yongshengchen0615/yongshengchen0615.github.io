// testModeModule.js
import { BookingStorageModule } from "./bookingStorageModule.js";
export const TestModeModule = (() => {
    let isTestMode = false;
    function injectTestData() {
        const testData = {
            bookingType: "本人預約",
            name: "陳先生",
            phone: "0912345678",
            date: new Date().toISOString().split("T")[0],
            time: "10:00",
            numPeople: 2,
            persons: [
                {
                    main: ["全身指壓60分鐘- $1100", "全身指壓60分鐘- $1100"],
                    addon: ["刮痧 30分鐘- $600"],
                    note: "我喜歡力道強一點"
                },
                {
                    main: ["腳底按摩60分鐘- $1200"],
                    addon: ["肩頸 20分鐘- $450"],
                    note: "請避開膝蓋部位"
                }
            ]
        };
    
        BookingStorageModule.save(testData);
        BookingStorageModule.restoreToForm(testData);
    }

    function init(TestMode) {
        if (!window.liff || !liff.isInClient || !liff.isInClient()) {
            isTestMode = TestMode;
            console.warn("🧪 正在使用測試模式（非 LINE 環境）");

            // 模擬 liff 基本功能
            window.liff = {
                getProfile: async () => ({ userId: "test-user-123", displayName: "測試使用者" }),
                sendMessages: async (messages) => {
                    console.log("🧪 模擬發送訊息內容：", messages);
                    alert("✅ 測試模式：已模擬發送訊息！");
                },
                closeWindow: () => {
                    console.log("🧪 模擬關閉視窗");
                    alert("✅ 測試模式：視窗將不會自動關閉");
                },
                isInClient: () => false,
            };
        }
    }

    function isTesting() {
        return isTestMode;
    }

    return {
        init,
        isTesting,
        injectTestData
    };
})();
