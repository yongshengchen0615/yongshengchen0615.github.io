$(document).ready(function () {
    const LIFF_ID = "2007061321-g603NNZG"; // 替換為你的 LIFF ID

    // 初始化 LIFF 並強制在 LINE 內開啟
    liff.init({ liffId: LIFF_ID })
        .then(() => {
            if (!liff.isInClient()) {
               // alert("請使用 LINE 開啟此預約系統！");
               // window.location.href = "https://line.me/R/"; // 跳轉到 LINE
            }
        })
        .catch(err => console.error("LIFF 初始化錯誤:", err));

    // 主要服務列表
    const services = [
        { id: 1, name: "全身經絡按摩", duration: 60, price: 1200 },
        { id: 2, name: "足部護理", duration: 45, price: 800 },
        { id: 3, name: "精油按摩", duration: 90, price: 1500 }
    ];

    // 加購服務列表
    const addOns = [
        { id: 101, name: "肩頸放鬆加強", duration: 15, price: 300 },
        { id: 102, name: "足底按摩延長", duration: 30, price: 500 },
        { id: 103, name: "熱石按摩", duration: 20, price: 800 }
    ];

    let selectedServices = [];
    let selectedAddOns = [];

    // 生成服務選單
    services.forEach(service => {
        $("#service").append(new Option(`${service.name} - ${service.duration} 分鐘 ($${service.price})`, service.id));
    });

    addOns.forEach(addOn => {
        $("#addon").append(new Option(`${addOn.name} - ${addOn.duration} 分鐘 (+$${addOn.price})`, addOn.id));
    });

    function updateSummary() {
        let totalPrice = 0;
        $("#selected-services").html("");
        selectedServices.forEach((service, index) => {
            totalPrice += service.price * service.quantity;
            $("#selected-services").append(`
                <div class="service-item">
                    ${service.name} (${service.duration} 分鐘) x ${service.quantity} - $${service.price * service.quantity}
                    <button class="btn btn-danger btn-sm remove-btn" onclick="removeService(${index})">移除</button>
                </div>
            `);
        });

        $("#selected-addons").html("");
        selectedAddOns.forEach((addon, index) => {
            totalPrice += addon.price * addon.quantity;
            $("#selected-addons").append(`
                <div class="addon-item">
                    ${addon.name} (${addon.duration} 分鐘) x ${addon.quantity} - $${addon.price * addon.quantity}
                    <button class="btn btn-danger btn-sm remove-btn" onclick="removeAddon(${index})">移除</button>
                </div>
            `);
        });

        $("#status").html(`總金額：$${totalPrice}`);
    }

    $("#add-service").click(function () {
        const serviceId = parseInt($("#service").val());
        const service = services.find(s => s.id === serviceId);
        if (service) {
            const existingService = selectedServices.find(s => s.id === serviceId);
            if (existingService) {
                existingService.quantity++;
            } else {
                selectedServices.push({ ...service, quantity: 1 });
            }
            updateSummary();
        }
    });

    $("#add-addon").click(function () {
        const addonId = parseInt($("#addon").val());
        const addon = addOns.find(a => a.id === addonId);
        if (addon) {
            const existingAddon = selectedAddOns.find(a => a.id === addonId);
            if (existingAddon) {
                existingAddon.quantity++;
            } else {
                selectedAddOns.push({ ...addon, quantity: 1 });
            }
            updateSummary();
        }
    });

    window.removeService = function (index) {
        selectedServices.splice(index, 1);
        updateSummary();
    };

    window.removeAddon = function (index) {
        selectedAddOns.splice(index, 1);
        updateSummary();
    };

    $("#booking-form").submit(async function (e) {
        e.preventDefault();

        if (selectedServices.length === 0) {
            alert("請至少選擇一個主要服務！");
            return;
        }

        const name = $("#name").val().trim();
        const phone = $("#phone").val().trim();
        const date = $("#date").val();
        const time = $("#time").val();

        const phoneRegex = /^[0-9]{10}$/;
        if (!phoneRegex.test(phone)) {
            alert("請輸入有效的 10 碼手機號碼！");
            return;
        }

        let totalPrice = 0;
        let serviceDetails = selectedServices.map(s => {
            totalPrice += s.price * s.quantity;
            return `${s.name} (${s.quantity} 次) - $${s.price * s.quantity}`;
        }).join("\n");

        let addOnDetails = selectedAddOns.length > 0 ? selectedAddOns.map(a => {
            totalPrice += a.price * a.quantity;
            return `${a.name} (${a.quantity} 次) - $${a.price * a.quantity}`;
        }).join("\n") : "無";

        const message = `📅 預約成功！\n👤 姓名：${name}\n📞 電話：${phone}\n🗓 日期：${date}\n⏰ 時間：${time}\n\n🔹 主要服務：\n${serviceDetails}\n\n➕ 加購服務：\n${addOnDetails}\n\n💰 總金額：$${totalPrice}`;

        console.log("回傳到 LINE 訊息：", message);

        if (liff.isInClient()) {
            await liff.sendMessages([{ type: "text", text: message }]);
            alert("預約成功！訊息已發送到 LINE，視窗將自動關閉。");
            liff.closeWindow();
        } else {
            alert("請在 LINE 內開啟此預約系統！");
            window.location.href = "https://line.me/R/";
        }
    });
});
