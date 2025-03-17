export const BookingTimeModule = (() => {
    const today = new Date().toISOString().split("T")[0];
    let bookingStartTime = "9:00";
    let bookingEndTime = "21:00";

    function init(startTime = "09:00", endTime = "21:00") {
        bookingStartTime = startTime;
        bookingEndTime = endTime;

        document.getElementById("booking-date").setAttribute("min", today);

        document.getElementById("booking-date").addEventListener("change", function () {
            let selectedDate = this.value;
            if (selectedDate < today) {
                alert("⚠️ 無法選擇過去日期！");
                this.value = today;
            }
            updateTimeOptions();
        });

        updateTimeOptions(); // 初始化更新
    }

    function formatDateWithDay(dateStr) {
        const date = new Date(dateStr);
        const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
        return `${dateStr}（${weekdays[date.getDay()]}）`;
    }

    function updateTimeOptions() {
        const selectedDate = document.getElementById("booking-date").value;
        
        const [startHour, startMinute] = bookingStartTime.split(":").map(Number);
        const [endHour, endMinute] = bookingEndTime.split(":").map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;

        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        let timeOptions = "";

        for (let minutes = startHour * 60 + startMinute; minutes <= endHour * 60 + endMinute; minutes += 10) {
            if (selectedDate === today && minutes <= currentMinutes) continue;

            const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
            const minute = String(minutes % 60).padStart(2, "0");
            const formattedTime = `${hour}:${minute}`;

            timeOptions += `<option value="${formattedTime}">${formattedTime}</option>`;
        }

        document.getElementById("booking-time").innerHTML = timeOptions;
    }

    function init(startTime = "09:00", endTime = "21:00") {
        bookingStartTime = startTime;
        bookingEndTime = endTime;

        document.getElementById("booking-date").setAttribute("min", today);
        document.getElementById("booking-date").addEventListener("change", updateTimeOptions);
        updateTimeOptions(); // 第一次初始化
    }

    return {
        init,
        formatDateWithDay
    };
})();
