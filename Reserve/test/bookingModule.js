import { updateTotalAll } from "./bookingUtils.js";
export const BookingModule = (() => {
    const mainServices = {
        "全身指壓60分鐘- $1100": { time: 60, price: 1100, type: "------全身按摩------" },
        "全身指壓90分鐘- $1650": { time: 90, price: 1650, type: "------全身按摩------" },
        "全身指壓120分鐘- $2200": { time: 120, price: 2200, type: "------全身按摩------" },
        "腳底按摩40分鐘- $800": { time: 40, price: 800, type: "---腳底按摩------" },
        "腳底按摩60分鐘- $1200": { time: 60, price: 1200, type: "---腳底按摩------" },
        "腳底按摩80分鐘- $1600": { time: 80, price: 1600, type: "---腳底按摩------" }
    };

    const addonServices = {
        "刮痧 30分鐘- $600": { time: 30, price: 600, type: "------加購服務------" },
        "肩頸 20分鐘- $450": { time: 20, price: 450, type: "------加購服務------" },
    };

    function checkAtLeastOneServiceSelected() {
        let invalidPersons = [];

        $(".person-card").each(function (index) {
            const mainServicesCount = $(this).find(".main-service-list li").length;
    
            if (mainServicesCount === 0) {
                invalidPersons.push(`預約人 ${index + 1}`);
            }
        });
    
        if (invalidPersons.length > 0) {
            alert(`⚠️ ${invalidPersons.join(", ")} 必須至少選擇一個主要服務！`);
            return false;
        }
    
        return true;
    }


    function serviceOptionsGrouped(services) {
        const grouped = {};
        for (const [name, info] of Object.entries(services)) {
            if (!grouped[info.type]) grouped[info.type] = [];
            grouped[info.type].push(name);
        }
    
        return Object.entries(grouped)
            .map(([type, names]) => `
                <optgroup label="${type}">
                    ${namesToOptions(names=names)}
                </optgroup>
            `).join("");
    
        function namesToOptions(names) {
            return names.map(name => `<option value="${name}">${name}</option>`).join("");
        }
    }

    function createPersonForm(index) {
        return `
            <div class="person-card shadow p-3 mb-3" data-person="${index}">
                <h5>預約人 ${index + 1}</h5>
                <label class="form-label">選擇主要服務</label>
                <div class="input-group">
                    <select class="form-select main-service">
                        ${serviceOptionsGrouped(mainServices)}
                    </select>
                    <button type="button" class="btn btn-outline-primary add-service" data-type="main">確認</button>
                </div>
                <ul class="list-group main-service-list mt-2"></ul>

                <label class="form-label mt-2">選擇加購服務</label>
                <div class="input-group">
                    <select class="form-select addon-service">
                        ${serviceOptionsGrouped(addonServices)}
                    </select>
                    <button type="button" class="btn btn-outline-secondary add-service" data-type="addon">確認</button>
                </div>
                <ul class="list-group addon-service-list mt-2"></ul>

                <div class="mt-2">
                    <h6>⏳ 個人總時間：<span class="total-time text-primary">0</span> 分鐘</h6>
                    <h6>💰 個人總價格：$<span class="total-price text-success">0</span> 元</h6>
                </div>
            </div>
        `;
    }

    function addService(button) {
        const type = button.data("type");
        const serviceData = type === "main" ? mainServices : addonServices;
        const serviceName = button.siblings("select").val();
        const listClass = type === "main" ? ".main-service-list" : ".addon-service-list";
        const list = button.closest(".person-card").find(listClass);
        const timeElement = button.closest(".person-card").find(".total-time");
        const priceElement = button.closest(".person-card").find(".total-price");
        const { time, price, type: serviceType } = serviceData[serviceName];

        list.append(`
            <li class="list-group-item" data-time="${time}" data-price="${price}">
                ${serviceName}
                <button type="button" class="btn btn-danger btn-sm remove-service">刪除</button>
            </li>
        `);

        timeElement.text(parseInt(timeElement.text()) + time);
        priceElement.text(parseInt(priceElement.text()) + price);
        updateTotalAll();

    }

    function removeService(button) {
        const item = button.parent();
        const personCard = item.closest(".person-card");
        const removedTime = parseInt(item.attr("data-time"));
        const removedPrice = parseInt(item.attr("data-price"));

        personCard.find(".total-time").text(parseInt(personCard.find(".total-time").text()) - removedTime);
        personCard.find(".total-price").text(parseInt(personCard.find(".total-price").text()) - removedPrice);

        item.remove();
        updateTotalAll();

    }

    function populateNumPeople(numPeopleSelector, maxPeople) {
        const numPeopleEl = $(numPeopleSelector);
        numPeopleEl.empty();
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
            updateTotalAll();

        }).trigger("change");
    }

    function init(numPeopleSelector, peopleContainerSelector, maxPeople = 5) {
        populateNumPeople(numPeopleSelector, maxPeople);
        bindEvents(numPeopleSelector, peopleContainerSelector);
        
    }

    return { 
        init ,
        checkAtLeastOneServiceSelected
    };
})();
