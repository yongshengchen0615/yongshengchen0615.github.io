const allowAddOns = true; // 設為 true 允許加購，false 則不允許

const services = [
    { name: "不選擇", duration: 0, price: 0 },
    { name: "腳底按摩", duration: 40, price: 800 },
    { name: "腳底按摩", duration: 60, price: 1200 },
    { name: "腳底按摩", duration: 80, price: 1600 },
];

const addOns = [
    { name: "不加購", duration: 0, price: 0 },
    { name: "修腳皮", duration: 30, price: 600 },
    
];

function populateServices() {
    const serviceSelect = document.getElementById("service");
    services.forEach(service => {
        const option = document.createElement("option");
        option.value = service.name;
        option.textContent = service.name+" "+service.price+" 元";
        serviceSelect.appendChild(option);
    });

    if (allowAddOns) {
        const addOnSelect = document.getElementById("add-on");
        addOns.forEach(addOn => {
            const option = document.createElement("option");
            option.value = addOn.name;
            option.textContent = `${addOn.name} (+${addOn.duration} 分鐘, ${addOn.price} 元)`;
            addOnSelect.appendChild(option);
        });
    } else {
        document.getElementById("add-on-container").style.display = "none";
    }

    updateServiceInfo();
}

function updateServiceInfo() {
    const selectedService = document.getElementById("service").value;
    const serviceInfo = services.find(service => service.name === selectedService);

    let totalDuration = serviceInfo.duration;
    let totalPrice = serviceInfo.price;

    if (allowAddOns) {
        const selectedAddOn = document.getElementById("add-on").value;
        const addOnInfo = addOns.find(addOn => addOn.name === selectedAddOn);
        totalDuration += addOnInfo.duration;
        totalPrice += addOnInfo.price;
    }

    document.getElementById("service-info").innerHTML = `🕒 總時長：${totalDuration} 分鐘 | 💰 總價格：${totalPrice} 元`;
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
    return /^09\d{8}$/.test(phone); // 確保手機號碼格式為 09 開頭的 10 碼數字
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

    let selectedAddOn = "不加購";
    let addOnInfo = { duration: 0, price: 0 };

    if (allowAddOns) {
        selectedAddOn = document.getElementById('add-on').value;
        addOnInfo = addOns.find(addOn => addOn.name === selectedAddOn);
    }

    let name, phone, bookingTitle, bookerName, bookerPhone;

    if (bookingType === "self") {
        name = document.getElementById('name').value.trim();
        phone = document.getElementById('phone').value.trim();
        bookingTitle = "📌 本人預約";
    } else {
        name = document.getElementById('other-name').value.trim();
        phone = document.getElementById('other-phone').value.trim();
        bookerName = document.getElementById('name').value.trim();
        bookerPhone = document.getElementById('phone').value.trim();
        bookingTitle = "📌 代訂他人";
    }

    const remarks = document.getElementById('remarks').value.trim(); // 獲取備註內容

    if (!name || !phone || !dateInput || !time) {
        showMessage('❌ 請填寫完整資訊！', 'error');
        return;
    }

    if (!isValidPhone(phone)) {
        showMessage('❌ 手機號碼格式錯誤，請輸入 09 開頭的 10 碼數字！', 'error');
        return;
    }

    const formattedDate = formatDate(dateInput);
    const totalDuration = serviceInfo.duration + addOnInfo.duration;
    const totalPrice = serviceInfo.price + addOnInfo.price;

    let message = `${bookingTitle}\n👤 預約人姓名：${name}\n📞 預約人電話：${phone}`;

   // if (bookingType === "other") {
     //   message += `\n👤 代訂人姓名：${bookerName}\n📞 代訂人電話：${bookerPhone}`;
    //}

    message += `\n📅 預約日期：${formattedDate}\n⏰ 預約時間：${time}\n💆 服務內容：${selectedService}`;

    if (allowAddOns && selectedAddOn !== "不加購") {
        message += `\n➕ 加購項目：${selectedAddOn} (+${addOnInfo.duration} 分鐘)`;
    }

    message += `\n🕒 總時長：${totalDuration} 分鐘\n💰 總價格：${totalPrice} 元`;

    if (remarks) {
        message += `\n📝 備註：${remarks}`;
    }

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
