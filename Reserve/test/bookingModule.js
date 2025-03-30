// bookingModule.js
import { updateTotalAll } from "./bookingUtils.js";
import { mainServices, addonServices } from "./servicesData.js"; // ✅ 引入外部資料

export const BookingModule = (() => {
    // ✅ 是否允許重複加入服務，可外部設定
    let allowDuplicateService = false;

    function setAllowDuplicate(flag) {
        allowDuplicateService = flag;
    }

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
                    ${namesToOptions(names = names)}
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
        const serviceName = button.siblings("select").val();
        const personCard = button.closest(".person-card");
        addServiceByName(personCard, type, serviceName);
    }

    function addServiceByName(personCardEl, type, serviceName) {
        const serviceData = type === "main" ? mainServices : addonServices;
        const listClass = type === "main" ? ".main-service-list" : ".addon-service-list";
        const list = $(personCardEl).find(listClass);
        const timeElement = $(personCardEl).find(".total-time");
        const priceElement = $(personCardEl).find(".total-price");

        const exists = list.find(`li:contains('${serviceName}')`).length > 0;
        if (exists && !allowDuplicateService) {
            alert(`⚠️ 此服務已加入，無法重複選擇！`);
            return;
        }

        const { time, price } = serviceData[serviceName] || {};
        if (!time || !price) return;

        list.append(`
            <li class="list-group-item" data-time="${time}" data-price="${price}">
              ${serviceName}
              <button type="button" class="btn btn-danger btn-sm remove-service">刪除</button>
            </li>
        `);

        const currentTime = parseInt(timeElement.text()) || 0;
        const currentPrice = parseInt(priceElement.text()) || 0;
        timeElement.text(currentTime + time);
        priceElement.text(currentPrice + price);

        updateTotalAll();
    }

    function removeService(button) {
        const item = button.parent();
        const personCard = item.closest(".person-card");
        const removedTime = parseInt(item.attr("data-time")) || 0;
        const removedPrice = parseInt(item.attr("data-price")) || 0;

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
        init,
        checkAtLeastOneServiceSelected,
        addServiceByName,
        setAllowDuplicate
    };
})();
