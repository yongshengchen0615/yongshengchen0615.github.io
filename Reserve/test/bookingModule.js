export const BookingModule = (() => {
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
        const serviceOptions = (services) => Object.keys(services)
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
        const type = button.data("type");
        const serviceData = type === "main" ? mainServices : addonServices;
        const serviceName = button.siblings("select").val();
        const listClass = type === "main" ? ".main-service-list" : ".addon-service-list";
        const list = button.closest(".person-card").find(listClass);
        const timeElement = button.closest(".person-card").find(".total-time");
        const priceElement = button.closest(".person-card").find(".total-price");

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
        const item = button.parent();
        const personCard = item.closest(".person-card");
        const removedTime = parseInt(item.attr("data-time"));
        const removedPrice = parseInt(item.attr("data-price"));

        personCard.find(".total-time").text(parseInt(personCard.find(".total-time").text()) - removedTime);
        personCard.find(".total-price").text(parseInt(personCard.find(".total-price").text()) - removedPrice);

        item.remove();
        updateTotal();
    }

    function populateNumPeople(numPeopleSelector, maxPeople) {
        const numPeopleEl = $(numPeopleSelector);
        numPeopleEl.empty();  // ⭐️ 清空舊有選項，避免重複添加
        for (let i = 1; i <= maxPeople; i++) {
            numPeopleEl.append(`<option value="${i}">${i} 人</option>`);
        }
    }

    function bindEvents(numPeopleSelector, peopleContainerSelector) {
        $(document)
            .off("click.booking")
            .on("click.booking", ".add-service", function () {
                addService($(this));
            })
            .on("click.booking", ".remove-service", function () {
                removeService($(this));
            });

        $(numPeopleSelector).off("change.booking").on("change.booking", function () {
            $(peopleContainerSelector).empty();
            const numPeople = parseInt($(this).val());
            for (let i = 0; i < numPeople; i++) {
                $(peopleContainerSelector).append(createPersonForm(i));
            }
            updateTotal();
        }).trigger("change");
    }

    function init(numPeopleSelector, peopleContainerSelector, maxPeople = 5) {
        populateNumPeople(numPeopleSelector, maxPeople);
    bindEvents(numPeopleSelector, peopleContainerSelector);
    }

    return { init };
})();
