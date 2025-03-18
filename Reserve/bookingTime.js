const BookingTime = (() => {
    let today = new Date().toISOString().split("T")[0];

    function init() {
        $("#booking-date").attr("min", today);

        $("#booking-date").on("change", function () {
            let selectedDate = $(this).val();
            if (selectedDate < today) {
                alert("⚠️ 無法選擇過去的日期，已自動修正為今天！");
                $(this).val(today);
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
        let selectedDate = $("#booking-date").val();
        let now = new Date();
        let currentMinutes = now.getHours() * 60 + now.getMinutes(); // 當前時間轉換為分鐘數

        let startTime = 9 * 60;  // 09:00 轉換為分鐘
        let endTime = 21 * 60;   // 21:00 轉換為分鐘
        let timeOptions = "";

        for (let minutes = startTime; minutes <= endTime; minutes += 10) {
            let hour = Math.floor(minutes / 60).toString().padStart(2, "0");
            let minute = (minutes % 60).toString().padStart(2, "0");
            let timeValue = `${hour}:${minute}`;

            // ✅ 如果選擇當天，過去時間不顯示
            if (selectedDate === today && minutes <= currentMinutes) {
                continue;
            }

            timeOptions += `<option value="${timeValue}">${timeValue}</option>`;
        }

        $("#booking-time").html(timeOptions);
    }

    return {
        init,
        formatDateWithDay
    };
})();
