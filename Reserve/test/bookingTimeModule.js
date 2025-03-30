// bookingTimeModule.js
export const BookingTimeModule = (() => {
    let bookingStartTime = "09:00";
    let bookingEndTime = "21:00";
    let bufferMinutes = 30;

    // ✅ 自訂公休設定
    const fixedClosedWeekdays = [0,6]; // 每週三 (0=日)
    const specialClosedDates = ["2025-04-02","2025-04-03"]; // 範例：清明節、勞動節

    // ✅ 傳回今天字串
    function getTodayStr() {
        return new Date().toISOString().split("T")[0];
    }

    // ✅ 是否為休息日
    function isDateClosed(date) {
        const weekday = date.getDay();
        const dateStr = date.toLocaleDateString("sv-SE");
        return fixedClosedWeekdays.includes(weekday) || specialClosedDates.includes(dateStr);
    }

    function init(startTime = "09:00", endTime = "21:00", buffer = 30) {
        bookingStartTime = startTime;
        bookingEndTime = endTime;
        bufferMinutes = buffer;

        document.getElementById("time-range").textContent = `${startTime} - ${endTime}`;
        document.getElementById("time-bufferMinutes").textContent = `當天預約需提早${bufferMinutes}分鐘`;

        // ✅ flatpickr 初始化
        flatpickr("#booking-date", {
            dateFormat: "Y-m-d",
            minDate: "today",
            disable: [
                function (date) {
                    return isDateClosed(date);
                }
            ],
            defaultDate: getTodayStr(),
            onChange: function (selectedDates) {
                if (selectedDates.length) {
                    updateTimeOptions();
                }
            }
        });

        updateTimeOptions();
    }

    function updateTimeOptions() {
        const timeSelect = document.getElementById("booking-time");
        const bookingDateInput = document.getElementById("booking-date");

        if (!timeSelect || !bookingDateInput) return;

        const selectedDate = bookingDateInput.value;
        if (!selectedDate) return;

        const dateObj = new Date(selectedDate);
        const now = new Date();
        const isToday = selectedDate === getTodayStr();

        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const minAllowedMinutes = isToday ? nowMinutes + bufferMinutes : 0;

        const [startHour, startMinute] = bookingStartTime.split(":").map(Number);
        const [endHour, endMinute] = bookingEndTime.split(":").map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;

        const timeUnit = 30;
        if (timeUnit <= 0) return;

        let timeOptions = "";

        const shouldIncludeTime = (minutes) => {
            if (isToday && minutes < minAllowedMinutes) return false;
            if (startMinutes > endMinutes) {
                return minutes >= startMinutes || minutes <= endMinutes;
            }
            return minutes >= startMinutes && minutes <= endMinutes;
        };

        for (let minutes = 0; minutes < 1440; minutes += timeUnit) {
            if (shouldIncludeTime(minutes)) {
                timeOptions += generateOption(minutes);
            }
        }

        timeSelect.innerHTML = timeOptions;
        if (timeSelect.options.length > 0) {
            timeSelect.selectedIndex = 0;
        }
    }

    function generateOption(minutes) {
        const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
        const minute = (minutes % 60).toString().padStart(2, "0");
        return `<option value="${hour}:${minute}">${hour}:${minute}</option>`;
    }

    function isValidBookingTime(dateStr, timeStr) {
        const date = new Date(dateStr);
        if (isDateClosed(date)) return false;

        const [hour, minute] = timeStr.split(":").map(Number);
        const selectedMinutes = hour * 60 + minute;
        const isToday = dateStr === getTodayStr();

        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const minAllowedMinutes = isToday ? nowMinutes + bufferMinutes : 0;

        const [startHour, startMinute] = bookingStartTime.split(":").map(Number);
        const [endHour, endMinute] = bookingEndTime.split(":").map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;

        if (selectedMinutes < minAllowedMinutes) return false;

        if (startMinutes > endMinutes) {
            return selectedMinutes >= startMinutes || selectedMinutes <= endMinutes;
        }
        return selectedMinutes >= startMinutes && selectedMinutes <= endMinutes;
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
