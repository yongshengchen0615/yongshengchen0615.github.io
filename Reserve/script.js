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

    let today = new Date().toISOString().split("T")[0];
    $("#booking-date").attr("min", today);

    function formatDateWithDay(dateStr) {
        let date = new Date(dateStr);
        let weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
        return `${dateStr}（${weekdays[date.getDay()]}）`;
    }

    function generateTimeOptions() {
        let startTime = 9 * 60;
        let endTime = 21 * 60;
        let timeOptions = "";

        for (let minutes = startTime; minutes <= endTime; minutes += 10) {
            let hour = Math.floor(minutes / 60).toString().padStart(2, "0");
            let minute = (minutes % 60).toString().padStart(2, "0");
            timeOptions += `<option value="${hour}:${minute}">${hour}:${minute}</option>`;
        }

        $("#booking-time").html(timeOptions);
    }

    generateTimeOptions();

    function validateName() {
        const namePattern = /^[\u4e00-\u9fa5]{1,5}(先生|小姐)$/;
        let name = $("#name").val().trim();

        if (!namePattern.test(name)) {
            $("#name-error").text("請輸入正確格式，如：王先生 / 李小姐");
            return false;
        } else {
            $("#name-error").text("");
            return true;
        }
    }

    $("#name").on("input", validateName);

    function createPersonForm(index) {
        let serviceOptions = (services) => Object.keys(services)
            .map(service => `<option value="${service}">${service}</option>`).join("");

        return `
            <div class="person-card shadow p-3 mb-3" data-person="${index}">
                <h5>預約人 ${index + 1}</h5>
                <label class="form-label">選擇主要服務</label>
                <div class="input-group">
                    <select class="form-select main-service">${serviceOptions(mainServices)}</select>
                    <button type="button" class="btn btn-outline-primary add-service" data-type="main">添加</button>
                </div>
                <ul class="list-group main-service-list mt-2"></ul>

                <label class="form-label mt-2">選擇加購服務</label>
                <div class="input-group">
                    <select class="form-select addon-service">${serviceOptions(addonServices)}</select>
                    <button type="button" class="btn btn-outline-secondary add-service" data-type="addon">添加</button>
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

    function addService(button) {
        let type = button.data("type");
        let serviceData = type === "main" ? mainServices : addonServices;
        let serviceName = button.siblings("select").val();
        let listClass = type === "main" ? ".main-service-list" : ".addon-service-list";
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

    function removeService(button) {
        let item = button.parent();
        let personCard = item.closest(".person-card");

        let removedTime = parseInt(item.attr("data-time"));
        let removedPrice = parseInt(item.attr("data-price"));

        let timeElement = personCard.find(".total-time");
        let priceElement = personCard.find(".total-price");

        timeElement.text(parseInt(timeElement.text()) - removedTime);
        priceElement.text(parseInt(priceElement.text()) - removedPrice);

        item.remove();
        updateTotal();
    }

    $(document).on("click", ".add-service", function () {
        addService($(this));
    });

    $(document).on("click", ".remove-service", function () {
        removeService($(this));
    });

    $("#num-people").change(function () {
        $("#people-container").html("");
        for (let i = 0; i < parseInt($(this).val()); i++) {
            $("#people-container").append(createPersonForm(i));
        }
        updateTotal();
    }).trigger("change");

    liff.init({ liffId: "2007061321-g603NNZG" });

    $("#booking-form").submit(function (event) {
        event.preventDefault();
        let date = formatDateWithDay($("#booking-date").val());
        let time = $("#booking-time").val();
        let name = $("#name").val();
        let phone = $("#phone").val();
        let numPeople = $("#num-people").val();
        let totalPrice = $("#total-price-all").text();
        let totalTimeAll = 0;
        let bookingDetails = [];

        $(".person-card").each(function (index) {
            let personIndex = index + 1;
            let personTime = parseInt($(this).find(".total-time").text());
            totalTimeAll += personTime;
            let personServices = [];

            $(this).find(".main-service-list li, .addon-service-list li").each(function () {
                personServices.push($(this).text().replace("刪除", "").trim());
            });

            bookingDetails.push(`👤 預約人 ${personIndex}：\n- 服務內容：${personServices.join(", ")}\n- 服務總時間：${personTime} 分鐘`);
        });

        let summary = `✅ 預約成功！\n📅 ${date}\n⏰ ${time}\n👤 ${name}\n📞 ${phone}\n👥 ${numPeople} 人\n💰 總價格：$${totalPrice} 元\n⏳ 總服務時間：${totalTimeAll} 分鐘\n\n${bookingDetails.join("\n\n")}`;

        liff.sendMessages([{ type: "text", text: summary }]).then(() => liff.closeWindow());
    });
});
