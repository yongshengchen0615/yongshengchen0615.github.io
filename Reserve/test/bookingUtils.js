// bookingUtils.js
export function updateTotalAll() {
    let totalTimeAll = 0;
    let totalPriceAll = 0;

    document.querySelectorAll(".person-card").forEach(person => {
        const timeEl = person.querySelector(".total-time");
        const priceEl = person.querySelector(".total-price");

        if (timeEl && priceEl) {
            totalTimeAll += parseInt(timeEl.textContent) || 0;
            totalPriceAll += parseInt(priceEl.textContent) || 0;
        }
    });

    const timeTotal = document.getElementById("total-time-all");
    const priceTotal = document.getElementById("total-price-all");
    if (timeTotal) timeTotal.textContent = totalTimeAll;
    if (priceTotal) priceTotal.textContent = totalPriceAll;
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
            if (li.dataset.name) main.push(li.dataset.name);
        });

        card.querySelectorAll(".addon-service-list li").forEach(li => {
            if (li.dataset.name) addon.push(li.dataset.name);
        });

        bookingData.persons.push({ main, addon });
    });

    return bookingData;
}

