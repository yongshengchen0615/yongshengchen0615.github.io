// bookingUtils.js
export function updateTotalAll() {
    let totalTimeAll = 0;
    let totalPriceAll = 0;

    document.querySelectorAll(".person-card").forEach(person => {
        totalTimeAll += parseInt(person.querySelector(".total-time").textContent);
        totalPriceAll += parseInt(person.querySelector(".total-price").textContent);
    });

    document.getElementById("total-time-all").textContent = totalTimeAll;
    document.getElementById("total-price-all").textContent = totalPriceAll;
}

export function generateBookingData() {
    const bookingData = {
        bookingType: document.getElementById("booking-type").value,
        name: document.getElementById("name").value,
        phone: document.getElementById("phone").value,
        date: document.getElementById("booking-date").value,
        time: document.getElementById("booking-time").value,
        numPeople: document.getElementById("num-people").value,
        persons: [],
    };

    document.querySelectorAll(".person-card").forEach(card => {
        const main = [];
        const addon = [];

        card.querySelectorAll(".main-service-list li").forEach(li => {
            main.push(li.textContent.replace("刪除", "").trim());
        });

        card.querySelectorAll(".addon-service-list li").forEach(li => {
            addon.push(li.textContent.replace("刪除", "").trim());
        });

        bookingData.persons.push({ main, addon });
    });

    return bookingData;
}
