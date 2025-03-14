const allowAddOns = true; // 設為 true 允許加購，false 則不允許
let services = [];
let addOns = [];

function fetchData() {
    fetch("data.json")
        .then(response => response.json())
        .then(data => {
            services = data.services;
            addOns = data.addOns;
            populateServices();
        })
        .catch(error => console.error("讀取 JSON 失敗:", error));
}

function populateServices() {
    const serviceSelect = document.getElementById("service");
    serviceSelect.innerHTML = ""; 

    services.forEach(service => {
        const option = document.createElement("option");
        option.value = service.name;
        option.textContent = service.name + ` ${service.price} 元`;
        serviceSelect.appendChild(option);
    });

    if (allowAddOns) {
        const addOnSelect = document.getElementById("add-on");
        addOnSelect.innerHTML = ""; 

        addOns.forEach(addOn => {
            const option = document.createElement("option");
            option.value = addOn.name;
            option.textContent = addOn.name + ` (+${addOn.duration} 分鐘, ${addOn.price} 元)`;
            addOnSelect.appendChild(option);
        });
    } else {
        document.getElementById("add-on-container").style.display = "none";
    }

    updateServiceInfo();
}

function updateServiceInfo() {
    const selectedService = document.getElementById("service").value;
    const serviceInfo = services.find(service => service.name === selectedService) || { duration: 0, price: 0 };

    let totalDuration = serviceInfo.duration;
    let totalPrice = serviceInfo.price;

    if (allowAddOns) {
        const selectedAddOn = document.getElementById("add-on").value;
        const addOnInfo = addOns.find(addOn => addOn.name === selectedAddOn) || { duration: 0, price: 0 };
        totalDuration += addOnInfo.duration;
        totalPrice += addOnInfo.price;
    }

    document.getElementById("service-info").innerHTML = `🕒 總時長：${totalDuration} 分鐘 | 💰 總價格：${totalPrice} 元`;
}

function restrictPastDates() {
    const today = new Date().toISOString().split("T")[0];
    document.getElementById("date").setAttribute("min", today);
}

function restrictPastTimes() {
    const dateInput = document.getElementById("date").value;
    const timeInput = document.getElementById("time");

    if (!dateInput) return;

    const now = new Date();
    const selectedDate = new Date(dateInput);

    if (selectedDate.toDateString() === now.toDateString()) {
        const hours = now.getHours().toString().padStart(2, "0");
        const minutes = Math.ceil(now.getMinutes() / 10) * 10; // 進位到最近的 10 分鐘
        const minTime = `${hours}:${minutes.toString().padStart(2, "0")}`;

        timeInput.setAttribute("min", minTime);
    } else {
        timeInput.removeAttribute("min");
    }
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
    const submitButton = document.getElementById("submit-button");
    submitButton.disabled = true; 

    const dateInput = document.getElementById("date").value;
    const time = document.getElementById("time").value;
    const selectedService = document.getElementById("service").value;
    const serviceInfo = services.find(service => service.name === selectedService) || { duration: 0, price: 0 };

    let selectedAddOn = "不加購";
    let addOnInfo = { duration: 0, price: 0 };

    if (allowAddOns) {
        selectedAddOn = document.getElementById("add-on").value;
        addOnInfo = addOns.find(addOn => addOn.name === selectedAddOn) || { duration: 0, price: 0 };
    }

    const name = document.getElementById("name").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const remarks = document.getElementById("remarks").value.trim(); 

    if (!name || !phone || !dateInput || !time) {
        showMessage("❌ 請填寫完整資訊！", "error");
        submitButton.disabled = false;
        return;
    }

    if (!isValidPhone(phone)) {
        showMessage("❌ 手機號碼格式錯誤，請輸入 09 開頭的 10 碼數字！", "error");
        submitButton.disabled = false;
        return;
    }

    const now = new Date();
    const selectedDateTime = new Date(`${dateInput}T${time}`);

    if (selectedDateTime < now) {
        showMessage("❌ 不能選擇過去的時間！", "error");
        submitButton.disabled = false;
        return;
    }

    const formattedDate = formatDate(dateInput);
    const totalDuration = serviceInfo.duration + addOnInfo.duration;
    const totalPrice = serviceInfo.price + addOnInfo.price;

    let message = `📌 本人預約\n👤 預約人姓名：${name}\n📞 預約人電話：${phone}`;
    message += `\n📅 預約日期：${formattedDate}\n⏰ 預約時間：${time}\n💆 服務內容：${selectedService}`;
    
    if (allowAddOns && selectedAddOn !== "不加購") {
        message += `\n➕ 加購項目：${selectedAddOn} (+${addOnInfo.duration} 分鐘)`;
    }

    message += `\n🕒 總時長：${totalDuration} 分鐘\n💰 總價格：${totalPrice} 元`;

    if (remarks) {
        message += `\n📝 備註：${remarks}`;
    }

    showMessage("✅ 預約成功！已通知官方帳號", "success");
}

function showMessage(message, type) {
    const messageBox = document.getElementById("message-box");
    messageBox.innerText = message;
    messageBox.className = `message-box ${type}`;
    messageBox.style.display = "block";

    setTimeout(() => {
        messageBox.style.display = "none";
    }, 2000);
}

document.getElementById("date").addEventListener("change", restrictPastTimes);
document.addEventListener("DOMContentLoaded", () => {
    fetchData();
    restrictPastDates();
});
