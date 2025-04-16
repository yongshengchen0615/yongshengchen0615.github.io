import { updateTotalAll } from "../utils/bookingUtils.js";

let mainServices = {};
let addonServices = {};

export const BookingModule = (() => {

    function init(numPeopleSelector, peopleContainerSelector, maxPeople = 5, services) {
        mainServices = services.main;
        addonServices = services.addon;

        populateNumPeople(numPeopleSelector, maxPeople);
        bindEvents(numPeopleSelector, peopleContainerSelector);
    }

    function checkAtLeastOneServiceSelected() {
        let invalidPersons = [];

        $(".person-card").each(function (index) {
            const mainServicesCount = $(this).find(".main-service-list li").length;

            if (mainServicesCount === 0) {
                invalidPersons.push(`顧客 ${index + 1}`);
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
                    ${names.map(name => `<option value="${name}">${name}</option>`).join("")}
                </optgroup>
            `).join("");
    }

    function createPersonForm(index) {
        const template = document.getElementById('person-form-template');
        const clone = template.content.cloneNode(true);

        clone.querySelector('.person-card').dataset.person = index;
        clone.querySelector('h5').textContent = `顧客 ${index + 1}`;

        const mainServiceSelect = clone.querySelector('.main-service');
        mainServiceSelect.innerHTML = serviceOptionsGrouped(mainServices);

        const addonServiceSelect = clone.querySelector('.addon-service');
        addonServiceSelect.innerHTML = serviceOptionsGrouped(addonServices);

        return clone;
    }

    function addService(button) {
        const type = button.data("type");
        const serviceData = type === "main" ? mainServices : addonServices;
        const serviceName = button.siblings("select").val();
        const listClass = type === "main" ? ".main-service-list" : ".addon-service-list";
        const list = button.closest(".person-card").find(listClass);
        const timeElement = button.closest(".person-card").find(".total-time");
        const priceElement = button.closest(".person-card").find(".total-price");

        const isAlreadyAdded = list.find("li").filter(function () {
            return $(this).text().includes(serviceName);
        }).length > 0;

        if (isAlreadyAdded) {
            const confirmAdd = confirm(`⚠️ 服務「${serviceName}」已經加入，是否仍要新增？`);
            if (!confirmAdd) return;
        }

        const { time, price } = serviceData[serviceName];

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

    return {
        init,
        checkAtLeastOneServiceSelected,
    };
})();
