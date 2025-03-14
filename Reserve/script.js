// 服務選項列表（包含名稱、時間與價格）
const services = [
    { name: "腳底按摩40分鐘", duration: "40 分鐘", price: "800 元" },
    { name: "腳底按摩90分鐘", duration: "90 分鐘", price: "1200 元" },
    { name: "腳底按摩80分鐘", duration: "80 分鐘", price: "1600 元" },
    { name: "全身指壓60分鐘", duration: "60 分鐘", price: "1100 元" },
    { name: "全身指壓90分鐘", duration: "90 分鐘", price: "1650 元" },
    { name: "全身指壓120分鐘", duration: "120 分鐘", price: "2200 元" }
];

// 動態生成服務選單
function populateServices() {
    const serviceSelect = document.getElementById("service");
    services.forEach(service => {
        const option = document.createElement("option");
        option.value = service.name;
        option.textContent = service.name;
        serviceSelect.appendChild(option);
    });

    // 預設顯示第一個服務的資訊
    updateServiceInfo();
}

// 更新服務資訊顯示（時間 & 價格）
function updateServiceInfo() {
    const selectedService = document.getElementById("service").value;
    const serviceInfo = services.find(service => service.name === selectedService);
    document.getElementById("service-info").innerHTML = `🕒 時間：${serviceInfo.duration} | 💰 價格：${serviceInfo.price}`;
}

function showMessage(message, type) {
    const messageBox = document.getElementById('message-box');
    messageBox.innerText = message;
    messageBox.className = `message-box ${type}`;
    messageBox.style.display = "block";

    // 2 秒後隱藏訊息
    setTimeout(() => {
        messageBox.style.display = "none";
        if (type === "success") {
            liff.closeWindow(); // 成功時關閉 LINE MINI App
        }
    }, 2000);
}

function isValidPhone(phone) {
    const phoneRegex = /^09\d{8}$/;  // 台灣手機號碼格式 09XXXXXXXX
    return phoneRegex.test(phone);
}

function submitBooking() {
    const name = document.getElementById('name').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const dateInput = document.getElementById('date').value;
    const time = document.getElementById('time').value;
    const selectedService = document.getElementById('service').value;
    const serviceInfo = services.find(service => service.name === selectedService);

    if (!name || !phone || !dateInput || !time) {
        showMessage('❌ 請填寫完整資訊！', 'error');
        return;
    }

    // 手機號碼格式檢查
    if (!isValidPhone(phone)) {
        showMessage('❌ 手機號碼格式錯誤，請輸入 09 開頭的 10 碼數字！', 'error');
        return;
    }

    // 轉換日期格式 (YYYY-MM-DD → MM/DD(週X))
    const dateObj = new Date(dateInput);
    const month = dateObj.getMonth() + 1; // 月份從 0 開始
    const day = dateObj.getDate();
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    const weekday = weekdays[dateObj.getDay()];
    const formattedDate = `${month}/${day}(${weekday})`;

    const message = `📌 預約通知(請等待預約確認)\n👤 姓名：${name}\n📞 電話：${phone}\n📅 預約日期：${formattedDate}\n⏰ 預約時間：${time}\n💆 服務內容：${selectedService}\n🕒 時間：${serviceInfo.duration}\n💰 價格：${serviceInfo.price}`;

    // 初始化 LIFF
    liff.init({ liffId: "2007061321-g603NNZG" })  // 替換為你的 LIFF ID
        .then(() => {
            if (!liff.isLoggedIn()) {
                liff.login();
            } else {
                liff.sendMessages([{
                    type: "text",
                    text: message
                }]).then(() => {
                    showMessage("✅ 預約成功！已通知官方帳號", "success");
                }).catch(err => {
                    console.error("發送失敗:", err);
                    showMessage("❌ 發送失敗，請稍後再試", "error");
                });
            }
        })
        .catch(err => {
            console.error("LIFF 初始化失敗:", err);
            showMessage("❌ LIFF 初始化失敗，請重新整理", "error");
        });
}

// 初始化服務選單
window.onload = populateServices;
