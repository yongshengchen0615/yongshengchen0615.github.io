// bookingTimeModule.js
let flatpickrInstance = null;


export const BookingTimeModule = (() => {
    let bookingStartTime = "09:00";
    let bookingEndTime = "21:00";
    let bufferMinutes = 30;
    let holidays = []; // ['2025-04-01']
    let weeklyHolidays = []; // [0, 3] -> 每週日與週三
    let maxDate = 14;//預約14天以內
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
            onChange: function (selectedDates, dateStr, instance) {
                updateTimeOptions();
                showTooltipForDate(dateStr); // ✅ 正確使用 flatpickr 傳入的 dateStr
            },
            // ✅ 新增：標註樣式
            onDayCreate: function (dObj, dStr, fp, dayElem) {
                const dateObj = dayElem.dateObj;
                const date = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}`;

                if (holidays.includes(date)) {
                    dayElem.classList.add("flatpickr-holiday");
                }

                if (weeklyHolidays.includes(dateObj.getDay())) {
                    dayElem.classList.add("flatpickr-weekoff");
                }
            },
            onReady: function (selectedDates, dateStr, instance) {
                attachDateClickTooltip(); // ✅ 綁定日期點擊提示
            },
            onMonthChange: function () {
                attachDateClickTooltip(); // ✅ 月變化後重新綁定
            },
            onYearChange: function () {
                attachDateClickTooltip(); // ✅ 年變化也綁定
            },
            onOpen: function () {
                attachDateClickTooltip();
            },
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

    function showTooltipForDate(dateStr, dayElem) {
        const calendarContainer = flatpickrInstance.calendarContainer;
        const oldTooltip = calendarContainer.querySelector(".date-tooltip");
        if (oldTooltip) oldTooltip.remove();
        if (!dayElem) return;
    
        const tooltip = document.createElement("div");
        tooltip.className = "date-tooltip";
    
        const isWeeklyOff = weeklyHolidays.includes(dayElem.dateObj.getDay());
        const isOutOfRange = (() => {
            const selected = new Date(dateStr);
            const max = new Date(today);
            max.setDate(max.getDate() + maxDate);
            return selected > max;
        })();
    
        // ✅ Tooltip 條件判斷邏輯
        if (isOutOfRange) {
            tooltip.textContent = `⚠️ 僅能選擇 ${maxDate} 天內的日期`;
        } else if (isHoliday(dateStr)) {
            tooltip.textContent = "📅 技師休假日，無法預約";
        } else if (isWeeklyOff) {
            tooltip.textContent = "📌 國定假日，無法預約";
        } else {
            tooltip.textContent = `✅ 可預約時間：${bookingStartTime} - ${bookingEndTime}`;
        }
    
        // 樣式
        tooltip.style.position = "absolute";
        tooltip.style.top = `${dayElem.offsetTop - 36}px`;
        tooltip.style.left = `${dayElem.offsetLeft + dayElem.offsetWidth / 2}px`;
        tooltip.style.transform = "translateX(-50%)";
        tooltip.style.background = "#333";
        tooltip.style.color = "#fff";
        tooltip.style.padding = "4px 8px";
        tooltip.style.borderRadius = "4px";
        tooltip.style.fontSize = "12px";
        tooltip.style.whiteSpace = "nowrap";
        tooltip.style.zIndex = "100";
    
        calendarContainer.appendChild(tooltip);
    
        // ✅ 觸發動畫
        requestAnimationFrame(() => {
            tooltip.classList.add("show");
        });
    }
    



    function attachDateClickTooltip() {
        if (!flatpickrInstance || !flatpickrInstance.calendarContainer) return;

        const days = flatpickrInstance.calendarContainer.querySelectorAll(".flatpickr-day");
        days.forEach(day => {
            day.addEventListener("click", (e) => {
                const dateObj = day.dateObj;
                const date = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}`;
                showTooltipForDate(date, day);
            });
        });
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
