export const BookingTime = (() => {
    let today = new Date().toISOString().split("T")[0];

    function init() {
        document.getElementById("booking-date").setAttribute("min", today);

        document.getElementById("booking-date").addEventListener("change", function () {
            let selectedDate = this.value;
            if (selectedDate < today) {
                alert("⚠️ 無法選擇過去的日期，已自動修正為今天！");
                this.value = today;
            }
            updateTimeOptions();
        });

        updateTimeOptions();
    }

    function formatDateWithDay(dateStr) {
        let date = new Date(dateStr);
        let weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
        return `${dateStr}（${weekdays[date.getDay()]}）`;
    }

    function updateTimeOptions() {
        let selectedDate = document.getElementById("booking-date").value;
        let now = new Date();
        let currentMinutes = now.getHours() * 60 + now.getMinutes();

        let startTime = 9 * 60;  // 09:00
        let endTime = 21 * 60;   // 21:00
        let timeOptions = "";

        for (let minutes = startTime; minutes <= endTime; minutes += 10) {
            let hour = Math.floor(minutes / 60).toString().padStart(2, "0");
            let minute = (minutes % 60).toString().padStart(2, "0");
            let timeValue = `${hour}:${minute}`;

            if (selectedDate === today && minutes <= currentMinutes) {
                continue;
            }

            timeOptions += `<option value="${timeValue}">${timeValue}</option>`;
        }

        document.getElementById("booking-time").innerHTML = timeOptions;
    }

    return {
        init,
        formatDateWithDay
    };
})();
