// bookingTimeModule.js
let flatpickrInstance = null;

export const BookingTimeModule = (() => {
    let bookingStartTime = "09:00";
    let bookingEndTime = "21:00";
    let bufferMinutes = 30;
    let holidays = []; // ['2025-04-01']
    let weeklyHolidays = []; // [0, 3] -> 每週日與週三
    let maxDate = 10;//預約14天以內
    let breakPeriods = []; // [{ start: "12:00", end: "13:00" }]
    const today = new Date().toISOString().split("T")[0];

    function init(startTime = "09:00", endTime = "21:00", buffer = 30) {
        bookingStartTime = startTime;
        bookingEndTime = endTime;
        bufferMinutes = buffer;

        document.getElementById("time-range").textContent = `${startTime} - ${endTime}`;
        document.getElementById("time-bufferMinutes").textContent = `當天預約需提早${bufferMinutes}分鐘`;

        const bookingDateInput = document.getElementById("booking-date");

        flatpickrInstance = flatpickr(bookingDateInput, {
            locale: "zh",
            dateFormat: "Y-m-d",
            minDate: today,
            disable: generateDisabledDates(),
            defaultDate: today,
            maxDate: new Date().fp_incr(maxDate), // 限制最多可預約 14 天內
            onChange: function () {
                updateTimeOptions();
            }
        });

        updateTimeOptions();
    }

    function setHolidays(days = []) {
        holidays = days;
        updateDisabledDates();
    }

    function setWeeklyHolidays(weekdays = []) {
        weeklyHolidays = weekdays;
        updateDisabledDates();
    }

    function setBreakPeriods(periods = []) {
        breakPeriods = periods;
    }

    function updateDisabledDates() {
        if (flatpickrInstance) {
            flatpickrInstance.set("disable", generateDisabledDates());
        }
    }

    function generateDisabledDates() {
        return [
            ...holidays,
            function (date) {
                return weeklyHolidays.includes(date.getDay());
            }
        ];
    }

    function isHoliday(dateStr) {
        return holidays.includes(dateStr);
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

        const timeSelect = document.getElementById("booking-time");
        timeSelect.innerHTML = "";

        if (isHoliday(selectedDate)) {
            timeSelect.innerHTML = '<option disabled>此日為休息日</option>';
            return;
        }

        for (let minutes = 0; minutes < 1440; minutes += timeUnit) {
            if (shouldIncludeTime(minutes, startMinutes, endMinutes, minAllowedMinutes, isToday)) {
                timeSelect.innerHTML += generateOption(minutes);
            }
        }

        if (timeSelect.options.length > 0) {
            timeSelect.selectedIndex = 0;
        } else {
            timeSelect.innerHTML = '<option disabled>⚠️ 無可預約時段</option>';
        }
    }

    function shouldIncludeTime(minutes, startMinutes, endMinutes, minAllowedMinutes, isToday) {
        if (isToday && minutes < minAllowedMinutes) return false;

        // 超出營業時間
        if (startMinutes > endMinutes) {
            if (!(minutes >= startMinutes || minutes <= endMinutes)) return false;
        } else {
            if (minutes < startMinutes || minutes > endMinutes) return false;
        }

        // 是否在休息時段中
        const timeStr = formatMinutes(minutes);
        for (const period of breakPeriods) {
            if (timeStr >= period.start && timeStr < period.end) return false;
        }

        return true;
    }

    function formatMinutes(minutes) {
        const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
        const minute = (minutes % 60).toString().padStart(2, "0");
        return `${hour}:${minute}`;
    }

    function generateOption(minutes) {
        const timeStr = formatMinutes(minutes);
        return `<option value="${timeStr}">${timeStr}</option>`;
    }

    function isValidBookingTime(dateStr, timeStr) {
        if (isHoliday(dateStr)) return false;

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

        const inBusinessHours = startMinutes > endMinutes
            ? selectedMinutes >= startMinutes || selectedMinutes <= endMinutes
            : selectedMinutes >= startMinutes && selectedMinutes <= endMinutes;
        if (!inBusinessHours) return false;

        for (const period of breakPeriods) {
            if (timeStr >= period.start && timeStr < period.end) return false;
        }

        return true;
    }

    function formatDateWithDay(dateStr) {
        const date = new Date(dateStr);
        const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
        return `${dateStr}（${weekdays[date.getDay()]}）`;
    }

    function isValidTimeFormat(timeStr) {
        if (!/^\d{2}:\d{2}$/.test(timeStr)) return false;
        const [hour, minute] = timeStr.split(":").map(Number);
        return hour >= 0 && hour < 24 && minute >= 0 && minute < 60;
    }
    
    return {
        init,
        isValidBookingTime,
        formatDateWithDay,
        setHolidays,
        setWeeklyHolidays,
        setBreakPeriods,
        isValidTimeFormat // ✅ 新增這行
    };
})();
