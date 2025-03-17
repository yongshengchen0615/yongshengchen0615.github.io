export const BookingTimeModule = (() => {
    const today = new Date().toISOString().split("T")[0];
    let bookingStartTime = "09:00";
    let bookingEndTime = "21:00";

    function init(startTime = "09:00", endTime = "21:00") {
        bookingStartTime = startTime;
        bookingEndTime = endTime;

        const bookingDate = document.getElementById("booking-date");
        bookingDate.setAttribute("min", today);
        bookingDate.value = today;

        bookingDate.addEventListener("change", function () {
            if (this.value < today) {
                this.value = today;
                showTempWarning("⚠️ 無法選擇過去日期，已自動修正為今天！");
            }
            updateTimeOptions();
        });

        updateTimeOptions();
    }

    function showTempWarning(message) {
        let warningEl = document.getElementById("date-warning");
        if (!warningEl) {
            warningEl = document.createElement("div");
            warningEl.id = "date-warning";
            warningEl.style.color = "red";
            warningEl.style.fontSize = "0.9rem";
            warningEl.style.marginTop = "0.25rem";
            const bookingDateEl = document.getElementById("booking-date");
            bookingDateEl.parentNode.appendChild(warningEl);
        }
        warningEl.textContent = message;

        setTimeout(() => {
            warningEl.textContent = "";
        }, 2000);  // ⭐️ 2秒後清除提示
    }

    function updateTimeOptions() {
        const selectedDate = document.getElementById("booking-date").value;
        const now = new Date();
        const isToday = selectedDate === today;

        const [startHour, startMinute] = bookingStartTime.split(":").map(Number);
        const [endHour, endMinute] = bookingEndTime.split(":").map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;

        let timeOptions = "";

        for (let minutes = startMinutes; minutes <= endMinutes; minutes += 30) {
            if (isToday && minutes <= (now.getHours() * 60 + now.getMinutes())) continue;

            const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
            const minute = (minutes % 60).toString().padStart(2, "0");
            const formattedTime = `${hour}:${minute}`;

            timeOptions += `<option value="${formattedTime}">${formattedTime}</option>`;
        }

        document.getElementById("booking-time").innerHTML = timeOptions;
    }

    function formatDateWithDay(dateStr) {
        const date = new Date(dateStr);
        const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
        return `${dateStr}（${weekdays[date.getDay()]}）`;
    }

    return {
        init,
        formatDateWithDay
    };
})();
