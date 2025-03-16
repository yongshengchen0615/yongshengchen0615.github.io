$(document).ready(function () {
    const LIFF_ID = "2007061321-g603NNZG"; // 替換為你的 LIFF ID

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

    $("#booking-form").submit(function (e) {
        e.preventDefault();
        alert("預約成功！");
    });
});
