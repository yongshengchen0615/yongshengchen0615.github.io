export const BookingTimeModule = (() => {
    let bookingStartTime = "09:00";
    let bookingEndTime = "21:00";
    let bufferMinutes = 30;
    let bookingStartTimeMinutes = 0; // ✅ 新增：用於隔日判斷
    const today = new Date().toISOString().split("T")[0];

    function init(startTime = "09:00", endTime = "21:00", buffer = 30) {
        bookingStartTime = startTime;
        bookingEndTime = endTime;
        bufferMinutes = buffer;

        const [startHour, startMinute] = startTime.split(":").map(Number);
        const [endHour, endMinute] = endTime.split(":").map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;

        bookingStartTimeMinutes = startMinutes; // ✅ 設定給 generateOption 判斷用

        // ✅ 顯示時間範圍加上跨日提示
        document.getElementById("time-range").textContent = `${startTime} - ${endTime}` +
            (startMinutes > endMinutes ? "" : "");

        document.getElementById("time-bufferMinutes").textContent = `當天預約需提早${bufferMinutes}分鐘`;

        const bookingDate = document.getElementById("booking-date");
        bookingDate.setAttribute("min", today);
        bookingDate.value = today;

        bookingDate.addEventListener("change", function () {
            if (this.value < today) {
                this.value = today;
                alert(`⚠️ 無法選擇過去日期，已自動修正為今天！`);
            }
            updateTimeOptions();
        });

        updateTimeOptions();
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

        if (timeSelect.options.length > 0) {
            timeSelect.selectedIndex = 0;
        }

        if (!timeOptions) {
            console.warn("⚠️ 沒有合法預約時間！");
            console.log({ isToday, nowMinutes, minAllowedMinutes, startMinutes, endMinutes });
        }
    }

    function generateOption(minutes) {
        const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
        const minute = (minutes % 60).toString().padStart(2, "0");
        const label = `${hour}:${minute}`;
        const displayLabel = minutes < bookingStartTimeMinutes ? `${label}` : label;
        return `<option value="${label}">${displayLabel}</option>`;
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
