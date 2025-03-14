document.addEventListener("DOMContentLoaded", function () {
    liff.init({ liffId: "2005939681-WrwevLMV" }) // ✅ 替換成你的 LIFF ID
        .then(() => {
            console.log("LIFF 初始化成功");

            if (!liff.isInClient()) {
                showMessage("請在LINE官方帳號內預約", "error");
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
            showMessage("LIFF 初始化失敗，請稍後再試！", "error");
        });

    function getUserProfile() {
        liff.getProfile().then(profile => {
            document.getElementById("userImage").src = profile.pictureUrl;
            document.getElementById("userName").innerText = `Hello, ${profile.displayName}`;
            document.getElementById("profile").style.display = "block";
        }).catch(err => {
            console.error("獲取用戶資訊失敗", err);
            showMessage("無法獲取用戶資訊，請重新登入", "error");
        });
    }

    function validatePhoneNumber(phone) {
        const phoneRegex = /^09\d{8}$/; // 台灣手機格式：09xxxxxxxx (共 10 位數字)
        return phoneRegex.test(phone);
    }

    function submitBooking() {
        const fullName = document.getElementById("userFullName").value.trim();
        const gender = document.getElementById("gender").value;
        const phone = document.getElementById("phoneNumber").value.trim();
        const service = document.getElementById("service").value;
        const date = document.getElementById("date").value;
        const time = document.getElementById("time").value;

        if (!fullName || !phone || !date || !time) {
            showMessage("請填寫完整資料！", "error");
            return;
        }

        // 🟢 驗證電話號碼格式
        if (!validatePhoneNumber(phone)) {
            showMessage("請輸入正確的手機號碼格式 (09xxxxxxxx)！", "error");
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
            showMessage("請在 LINE 應用內提交預約！", "error");
            return;
        }

        liff.sendMessages([{ type: "text", text: message }])
            .then(() => {
                showMessage("預約已提交！", "success");
                setTimeout(() => liff.closeWindow(), 2000);
            })
            .catch(err => {
                console.error("預約發送失敗", err);
                showMessage("訊息發送失敗，請確認是否在 LINE App 內開啟，並確保 LIFF 權限正確設定！", "error");
            });
    }

    function showMessage(text, type) {
        const messageBox = document.getElementById("messageBox");
        messageBox.innerText = text;
        messageBox.style.display = "block";

        if (type === "success") {
            messageBox.style.backgroundColor = "#d4edda"; // 綠色背景
            messageBox.style.color = "#155724";
            messageBox.style.border = "1px solid #c3e6cb";
        } else {
            messageBox.style.backgroundColor = "#f8d7da"; // 紅色背景
            messageBox.style.color = "#721c24";
            messageBox.style.border = "1px solid #f5c6cb";
        }

        // 自動滾動到訊息框
        messageBox.scrollIntoView({ behavior: "smooth" });
    }
});
