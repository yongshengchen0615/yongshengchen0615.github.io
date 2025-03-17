export const BookingTimeModule = (() => {
    const today = new Date().toISOString().split("T")[0];
    let bookingStartTime = "09:00";
    let bookingEndTime = "21:00";

    function init(startTime = "09:00", endTime = "21:00") {
        bookingStartTime = startTime;
        bookingEndTime = endTime;

        const bookingDateEl = document.getElementById("booking-date");
        bookingStartTime = startTime;
        bookingEndTime = endTime;

        bookingDate.setAttribute("min", today);

        bookingDate.addEventListener("change", function () {
            if (this.value < today) {
                alert("⚠️ 無法選擇過去的日期！");
                this.value = today;
            }
            updateTimeOptions();
        });

        updateTimeOptions();
    }

    function formatDateWithDay(dateStr) {
        const date = new Date(dateStr);
        const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
        return `${dateStr}（${weekdays[date.getDay()]}）`;
    }

    function updateTimeOptions() {
        const selectedDate = document.getElementById("booking-date").value;
        const now = new Date();
        const isToday = selectedDate === today;
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

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

    function init(startTime = "09:00", endTime = "21:00") {
        bookingStartTime = startTime;
        bookingEndTime = endTime;
        
        const bookingDate = document.getElementById("booking-date");
        bookingDate.setAttribute("min", today);
        bookingDate.addEventListener("change", updateTimeOptions);

        updateTimeOptions();
    }

    return {
        init,
        formatDateWithDay
    };
})();
