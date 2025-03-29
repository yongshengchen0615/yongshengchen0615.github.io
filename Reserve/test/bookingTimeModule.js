export const BookingTimeModule = (() => {
    let bookingStartTime = "09:00";
    let bookingEndTime = "21:00";
    let bufferMinutes = 30; // ✅ 可自訂緩衝時間
    const today = new Date().toISOString().split("T")[0];

    function init(startTime = "09:00", endTime = "21:00", buffer = 30) {
        bookingStartTime = startTime;
        bookingEndTime = endTime;
        bufferMinutes = buffer;

        document.getElementById("time-range").textContent = `${startTime} - ${endTime}`;
        document.getElementById("time-bufferMinutes").textContent=`當天預約需提早${bufferMinutes}分鐘`;
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

        updateTimeOptions(); // 初始化時立即更新選項
    }

    function updateTimeOptions() {
        const timeUnit = 30;
        const selectedDate = document.getElementById("booking-date").value;
        const now = new Date();
        const isToday = selectedDate === today;

        const [startHour, startMinute] = bookingStartTime.split(":").map(Number);
        const [endHour, endMinute] = bookingEndTime.split(":").map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const minAllowedMinutes = isToday ? nowMinutes + bufferMinutes : 0;

        let timeOptions = "";

        const shouldIncludeTime = (minutes) => {
            if (isToday && minutes < minAllowedMinutes) return false;
            if (startMinutes > endMinutes) {
                return minutes >= startMinutes || minutes <= endMinutes;
            } else {
                return minutes >= startMinutes && minutes <= endMinutes;
            }
        };

        for (let minutes = 0; minutes < 1440; minutes += timeUnit) {
            if (shouldIncludeTime(minutes)) {
                timeOptions += generateOption(minutes);
            }
        }

        const timeSelect = document.getElementById("booking-time");
        timeSelect.innerHTML = timeOptions;

        // 自動選第一個合法選項
        if (timeSelect.options.length > 0) {
            timeSelect.selectedIndex = 0;
        }

        // 除錯資訊
        if (!timeOptions) {
            console.warn("⚠️ 沒有合法預約時間！");
            console.log({ isToday, nowMinutes, minAllowedMinutes, startMinutes, endMinutes });
        }
    }

    function generateOption(minutes) {
        const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
        const minute = (minutes % 60).toString().padStart(2, "0");
        return `<option value="${hour}:${minute}">${hour}:${minute}</option>`;
    }

    function isValidBookingTime(dateStr, timeStr) {
        const now = new Date();
        const selectedTime = timeStr.split(":").map(Number);
        const selectedMinutes = selectedTime[0] * 60 + selectedTime[1];
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const isToday = dateStr === today;

        const [startHour, startMinute] = bookingStartTime.split(":").map(Number);
        const [endHour, endMinute] = bookingEndTime.split(":").map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;

        const minAllowedMinutes = isToday ? nowMinutes + bufferMinutes : 0;

        if (selectedMinutes < minAllowedMinutes) return false;

        if (startMinutes > endMinutes) {
            return selectedMinutes >= startMinutes || selectedMinutes <= endMinutes;
        } else {
            return selectedMinutes >= startMinutes && selectedMinutes <= endMinutes;
        }
    }

    function formatDateWithDay(dateStr) {
        const date = new Date(dateStr);
        const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
        return `${dateStr}（${weekdays[date.getDay()]}）`;
    }

    return {
        init,
        isValidBookingTime,
        formatDateWithDay
    };
})();
