const allowAddOns = true; 
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

    updateServiceInfo(); // 確保初始顯示總時長與價格
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

function submitBooking() {
    const selectedService = document.getElementById("service").value;
    const selectedAddOn = allowAddOns ? document.getElementById("add-on").value : "無";
    const selectedDate = document.getElementById("date").value;
    const selectedTime = document.getElementById("time").value;

    if (!selectedService || !selectedDate || !selectedTime) {
        alert("請選擇完整的服務、日期和時間！");
        return;
    }

    const serviceInfo = services.find(service => service.name === selectedService) || { duration: 0, price: 0 };
    let totalDuration = serviceInfo.duration;
    let totalPrice = serviceInfo.price;

    if (allowAddOns && selectedAddOn !== "無") {
        const addOnInfo = addOns.find(addOn => addOn.name === selectedAddOn) || { duration: 0, price: 0 };
        totalDuration += addOnInfo.duration;
        totalPrice += addOnInfo.price;
    }

    const bookingDetails = {
        服務: selectedService,
        加購: selectedAddOn,
        日期: selectedDate,
        時間: selectedTime,
        總時長: `${totalDuration} 分鐘`,
        總價格: `${totalPrice} 元`
    };

    console.log("預約資訊:", bookingDetails);
    alert("預約成功！\n" + JSON.stringify(bookingDetails, null, 2));
}


// 限制日期不可選過去
function restrictPastDates() {
    const today = new Date().toISOString().split("T")[0];
    document.getElementById("date").setAttribute("min", today);
}

// 產生 10 分鐘單位的時間選擇
function populateTimeOptions() {
    const timeSelect = document.getElementById("time");
    timeSelect.innerHTML = "";

    const now = new Date();
    const selectedDate = document.getElementById("date").value;
    const isToday = selectedDate === now.toISOString().split("T")[0];

    let startHour = 9; // 營業開始時間
    let endHour = 22; // 營業結束時間

    for (let hour = startHour; hour < endHour; hour++) {
        for (let minute = 0; minute < 60; minute += 10) {
            let time = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;

            if (isToday) {
                let selectedTime = new Date(`${selectedDate}T${time}`);
                if (selectedTime < now) {
                    continue; // 不顯示已過去的時間
                }
            }

            let option = document.createElement("option");
            option.value = time;
            option.textContent = time;
            timeSelect.appendChild(option);
        }
    }
}

// 限制時間選擇
document.getElementById("date").addEventListener("change", populateTimeOptions);

// 初始化
document.addEventListener("DOMContentLoaded", () => {
    fetchData();
    restrictPastDates();
    populateTimeOptions();
    updateServiceInfo(); // 確保初始顯示資訊
});
