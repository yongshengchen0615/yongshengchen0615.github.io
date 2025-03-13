document.addEventListener("DOMContentLoaded", function () {
    liff.init({ liffId: "2005939681-WrwevLMV" }) // ✅ 替換成你的 LIFF ID
        .then(() => {
            console.log("LIFF 初始化成功");

            if (!liff.isInClient()) {
                alert("請在 LINE 應用內開啟此預約系統！");
                return;
            }

            if (!liff.isLoggedIn()) {
                liff.login();
                return;
            }

            getUserProfile();
            document.getElementById("submitBooking").addEventListener("click", submitBooking);
            document.getElementById("closeApp").addEventListener("click", () => liff.closeWindow());
        })
        .catch(err => {
            console.error("LIFF 初始化失敗", err);
        });

    function getUserProfile() {
        liff.getProfile().then(profile => {
            document.getElementById("userImage").src = profile.pictureUrl;
            document.getElementById("userName").innerText = `Hello, ${profile.displayName}`;
            document.getElementById("profile").style.display = "block";
        }).catch(err => {
            console.error("獲取用戶資訊失敗", err);
        });
    }

    function submitBooking() {
        const fullName = document.getElementById("userFullName").value.trim();
        const gender = document.getElementById("gender").value;
        const phone = document.getElementById("phoneNumber").value.trim();
        const service = document.getElementById("service").value;
        const date = document.getElementById("date").value;
        const time = document.getElementById("time").value;

        if (!fullName || !phone || !date || !time) {
            alert("請填寫完整資料！");
            return; 
        }

        // 🟢 取得姓氏
        const lastName = fullName.charAt(0); // 取第一個字作為姓氏
        let title = "先生"; // 預設為男性

        // 🟢 根據性別選擇稱謂
        if (gender === "女") {
            title = "小姐";
        } else if (gender === "其他") {
            title = "女士";
        }

        const formattedName = `${lastName}${title}`; // 組合為「王先生」

        // 🟢 轉換日期為 "3/15(六)" 格式
        const weekDays = ["日", "一", "二", "三", "四", "五", "六"];
        const selectedDate = new Date(date);
        const month = selectedDate.getMonth() + 1;
        const day = selectedDate.getDate();
        const weekDay = `(${weekDays[selectedDate.getDay()]})`;

        // 🟢 確保時間是 24 小時制
        const formattedTime = time;

        const message = `📅 預約確認\n預約人：${formattedName}\n電話：${phone}\n服務：${service}\n日期：${month}/${day}${weekDay}\n時間：${formattedTime}`;

        if (!liff.isInClient()) {
            alert("請在 LINE 應用內提交預約！");
            return;
        }

        liff.sendMessages([{ type: "text", text: message }])
            .then(() => {
                alert("預約已提交！");
                liff.closeWindow();
            })
            .catch(err => {
                console.error("預約發送失敗", err);
                alert("訊息發送失敗，請確認是否在 LINE App 內開啟，並確保 LIFF 權限正確設定！");
            });
    }
});
