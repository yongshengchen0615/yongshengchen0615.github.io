$(document).ready(function () {
    const mainServices = {
        "全身經絡按摩": { time: 60, price: 1500 },
        "足部護理": { time: 45, price: 1000 },
        "精油SPA": { time: 90, price: 2000 }
    };

    const addonServices = {
        "肩頸放鬆加強": { time: 30, price: 800 },
        "足部去角質": { time: 20, price: 500 },
        "熱石按摩": { time: 40, price: 1200 }
    };

    function createPersonForm(index) {
        let mainServiceOptions = Object.keys(mainServices).map(service => `<option value="${service}">${service}</option>`).join("");
        let addonServiceOptions = Object.keys(addonServices).map(service => `<option value="${service}">${service}</option>`).join("");

        return `
            <div class="person-card shadow p-3 mb-3" data-person="${index}">
                <h5>預約人 ${index + 1}</h5>
                <label class="form-label">選擇主要服務</label>
                <div class="input-group">
                    <select class="form-select main-service">${mainServiceOptions}</select>
                    <button type="button" class="btn btn-outline-primary add-main-service">添加</button>
                </div>
                <ul class="list-group main-service-list mt-2"></ul>

                <label class="form-label mt-2">選擇加購服務</label>
                <div class="input-group">
                    <select class="form-select addon-service">${addonServiceOptions}</select>
                    <button type="button" class="btn btn-outline-secondary add-addon-service">添加</button>
                </div>
                <ul class="list-group addon-service-list mt-2"></ul>

                <div class="mt-2">
                    <h6>⏳ 個人總時間：<span class="total-time text-primary">0</span> 分鐘</h6>
                    <h6>💰 個人總價格：$<span class="total-price text-success">0</span> 元</h6>
                </div>
            </div>
        `;
    }

    function updateTotal() {
        let totalTimeAll = 0, totalPriceAll = 0;
        $(".person-card").each(function () {
            totalTimeAll += parseInt($(this).find(".total-time").text());
            totalPriceAll += parseInt($(this).find(".total-price").text());
        });
        $("#total-time-all").text(totalTimeAll);
        $("#total-price-all").text(totalPriceAll);
    }

    function addService(button, serviceData, listClass) {
        let serviceName = button.siblings("select").val();
        let list = button.closest(".person-card").find(listClass);
        let timeElement = button.closest(".person-card").find(".total-time");
        let priceElement = button.closest(".person-card").find(".total-price");

        if (!serviceData[serviceName]) {
            alert("請選擇有效的服務！");
            return;
        }

        list.append(`
            <li class="list-group-item" data-time="${serviceData[serviceName].time}" data-price="${serviceData[serviceName].price}">
                ${serviceName} (${serviceData[serviceName].time} 分鐘, $${serviceData[serviceName].price})
                <button type="button" class="btn btn-danger btn-sm remove-service">刪除</button>
            </li>
        `);

        timeElement.text(parseInt(timeElement.text()) + serviceData[serviceName].time);
        priceElement.text(parseInt(priceElement.text()) + serviceData[serviceName].price);

        updateTotal();
    }

    $(document).on("click", ".add-main-service", function () {
        addService($(this), mainServices, ".main-service-list");
    });

    $(document).on("click", ".add-addon-service", function () {
        addService($(this), addonServices, ".addon-service-list");
    });

    $(document).on("click", ".remove-service", function () {
        let item = $(this).parent();
        let personCard = item.closest(".person-card");

        let removedTime = parseInt(item.attr("data-time"));
        let removedPrice = parseInt(item.attr("data-price"));

        personCard.find(".total-time").text(parseInt(personCard.find(".total-time").text()) - removedTime);
        personCard.find(".total-price").text(parseInt(personCard.find(".total-price").text()) - removedPrice);

        item.remove();
        updateTotal();
    });

    $("#num-people").change(function () {
        let numPeople = parseInt($(this).val());
        $("#people-container").html("");
        for (let i = 0; i < numPeople; i++) {
            $("#people-container").append(createPersonForm(i));
        }
        updateTotal();
    });

    $("#num-people").trigger("change");

    // 初始化 LINE LIFF
    liff.init({ liffId: "2007061321-g603NNZG" }).then(() => {
        console.log("LIFF 初始化成功");
    });

    $("#booking-form").submit(function (event) {
        event.preventDefault();

        let totalTime = parseInt($("#total-time-all").text());
        let totalPrice = parseInt($("#total-price-all").text());

        if (totalTime === 0 || totalPrice === 0) {
            alert("請至少選擇一項服務！");
            return;
        }

        let name = $("#name").val();
        let phone = $("#phone").val();
        let numPeople = $("#num-people").val();
        let bookingDetails = [];

        $(".person-card").each(function (index) {
            let personIndex = index + 1;
            let services = [];
            $(this).find(".main-service-list li, .addon-service-list li").each(function () {
                services.push($(this).text().replace("刪除", "").trim());
            });

            bookingDetails.push(`👤 預約人 ${personIndex}: \n- 服務內容: ${services.join(", ")}\n`);
        });

        let summary = `✅ 預約成功！\n👤 預約人：${name}\n📞 連絡電話：${phone}\n👥 預約人數：${numPeople} 人\n⏳ 總時間：${totalTime} 分鐘\n💰 總價格：$${totalPrice} 元\n\n${bookingDetails.join("\n")}`;

        $("#status").html(summary.replace(/\n/g, "<br>"));

        if (liff.isInClient()) {
            liff.sendMessages([{ type: "text", text: summary }]).then(() => {
                alert("預約資訊已發送至 LINE！");
                liff.closeWindow();
            });
        }
    });
});
