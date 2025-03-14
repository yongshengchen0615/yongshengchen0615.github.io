const services = [
    { name: "足部護理", duration: "60 分鐘", price: "1200 元" },
    { name: "全身指壓", duration: "90 分鐘", price: "1800 元" },
    { name: "精油按摩", duration: "75 分鐘", price: "1500 元" },
    { name: "肩頸放鬆", duration: "45 分鐘", price: "1000 元" },
    { name: "拔罐疏通", duration: "30 分鐘", price: "800 元" },
    { name: "刮痧理療", duration: "40 分鐘", price: "900 元" }
];

function populateServices() {
    const serviceSelect = document.getElementById("service");
    services.forEach(service => {
        const option = document.createElement("option");
        option.value = service.name;
        option.textContent = service.name;
        serviceSelect.appendChild(option);
    });

    updateServiceInfo();
}

function updateServiceInfo() {
    const selectedService = document.getElementById("service").value;
    const serviceInfo = services.find(service => service.name === selectedService);
    document.getElementById("service-info").innerHTML = `🕒 時間：${serviceInfo.duration} | 💰 價格：${serviceInfo.price}`;
}

function toggleBookingFields() {
    const bookingType = document.getElementById("booking-type").value;
    document.getElementById("self-booking").style.display = bookingType === "self" ? "block" : "none";
    document.getElementById("other-booking").style.display = bookingType === "other" ? "block" : "none";
}

function showMessage(message, type) {
    const messageBox = document.getElementById('message-box');
    messageBox.innerText = message;
    messageBox.className = `message-box ${type}`;
    messageBox.style.display = "block";

    setTimeout(() => {
        messageBox.style.display = "none";
        if (type === "success") {
            liff.closeWindow();
        }
    }, 2000);
}

function isValidPhone(phone) {
    return /^09\d{8}$/.test(phone);
}

function formatDate(dateString) {
    const dateObj = new Date(dateString);
    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    const weekday = weekdays[dateObj.getDay()];
    return `${month}/${day}(${weekday})`;
}

function submitBooking() {
    const bookingType = document.getElementById("booking-type").value;
    const dateInput = document.getElementById('date').value;
    const time = document.getElementById('time').value;
    const selectedService = document.getElementById('service').value;
    const serviceInfo = services.find(service => service.name === selectedService);

    let name, phone;

    if (bookingType === "self") {
        name = document.getElementById('name').value.trim();
        phone = document.getElementById('phone').value.trim();
    } else {
        name = document.getElementById('other-name').value.trim();
        phone = document.getElementById('other-phone').value.trim();
    }

    if (!name || !phone || !dateInput || !time) {
        showMessage('❌ 請填寫完整資訊！', 'error');
        return;
    }

    if (!isValidPhone(phone)) {
        showMessage('❌ 手機號碼格式錯誤，請輸入 09 開頭的 10 碼數字！', 'error');
        return;
    }

    const formattedDate = formatDate(dateInput);
    const bookingTitle = bookingType === "self" ? "📌 本人預約通知" : "📌 代訂他人預約通知";

    const message = `${bookingTitle}\n👤 預約人姓名：${name}\n📞 預約人電話：${phone}\n📅 預約日期：${formattedDate}\n⏰ 預約時間：${time}\n💆 服務內容：${selectedService}\n🕒 時間：${serviceInfo.duration}\n💰 價格：${serviceInfo.price}`;

    liff.init({ liffId: "2007061321-g603NNZG" }) 
        .then(() => {
            if (!liff.isLoggedIn()) {
                liff.login();
            } else {
                liff.sendMessages([{ type: "text", text: message }])
                    .then(() => showMessage("✅ 預約成功！已通知官方帳號", "success"))
                    .catch(err => {
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

window.onload = populateServices;
