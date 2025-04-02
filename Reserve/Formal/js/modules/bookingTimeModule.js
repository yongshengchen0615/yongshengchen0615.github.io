import { dateTypes, setDateTypes as updateDateTypes } from "./bookingDateTypes.js";

let flatpickrInstance = null;

export const BookingTimeModule = (() => {
    let bookingStartTime = "09:00";
    let bookingEndTime = "21:00";
    let bufferMinutes = 30;
    let breakPeriods = [];

    const today = new Date().toISOString().split("T")[0];
    const maxDate = 14;

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
            maxDate: new Date().fp_incr(maxDate),
            onChange: function (selectedDates, dateStr) {
                updateTimeOptions();
                const dayElem = findDayElemByDate(dateStr);
                showTooltipForDate(dateStr, dayElem);
            },
            onDayCreate: function (dObj, dStr, fp, dayElem) {
                const dateObj = dayElem.dateObj;
                const dateStr = formatDateObj(dateObj);

                if (dateTypes.holiday.includes(dateStr)) dayElem.classList.add("flatpickr-holiday");
                if (dateTypes.weeklyOff.includes(dateObj.getDay())) dayElem.classList.add("flatpickr-weekoff");
                if (dateTypes.eventDay.includes(dateStr)) dayElem.classList.add("flatpickr-event");
                if (dateTypes.halfDay.includes(dateStr)) dayElem.classList.add("flatpickr-halfday");
                if (dateTypes.blockedDay.includes(dateStr)) {
                    dayElem.classList.add("flatpickr-blocked");
                }
            },

            onReady: attachDateClickTooltip,
            onMonthChange: attachDateClickTooltip,
            onYearChange: attachDateClickTooltip,
            onOpen: attachDateClickTooltip,
        });

        updateTimeOptions();
    }

    function setDateTypes(input) {
        updateDateTypes(input);
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
            ...(Array.isArray(dateTypes.holiday) ? dateTypes.holiday : []),
            ...(Array.isArray(dateTypes.blockedDay) ? dateTypes.blockedDay : []),
            function (date) {
                return Array.isArray(dateTypes.weeklyOff) && dateTypes.weeklyOff.includes(date.getDay());
            }
        ];
    }


    function isHoliday(dateStr) {
        return dateTypes.holiday.includes(dateStr);
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

        if (isHoliday(selectedDate) || dateTypes.weeklyOff.includes(new Date(selectedDate).getDay())) {
            timeSelect.innerHTML = '<option disabled>此日為休息日</option>';
            return;
        }

        const maxMinutes = dateTypes.halfDay.includes(selectedDate) ? (13 * 60) : endMinutes;

        for (let minutes = 0; minutes < 1440; minutes += timeUnit) {
            if (shouldIncludeTime(minutes, startMinutes, maxMinutes, minAllowedMinutes, isToday)) {
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
        if (startMinutes > endMinutes) {
            if (!(minutes >= startMinutes || minutes <= endMinutes)) return false;
        } else {
            if (minutes < startMinutes || minutes > endMinutes) return false;
        }
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

    function formatDateObj(dateObj) {
        return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}`;
    }

    function generateOption(minutes) {
        const timeStr = formatMinutes(minutes);
        return `<option value="${timeStr}">${timeStr}</option>`;
    }

    function isValidBookingTime(dateStr, timeStr) {
        if (dateTypes.holiday.includes(dateStr)) return false;

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

    function findDayElemByDate(dateStr) {
        const days = flatpickrInstance.calendarContainer.querySelectorAll(".flatpickr-day");
        for (const day of days) {
            if (!day.dateObj) continue;
            const dayStr = formatDateObj(day.dateObj);
            if (dayStr === dateStr) return day;
        }
        return null;
    }

    function showTooltipForDate(dateStr, dayElem) {
        if (!dayElem) return;

        const calendarContainer = flatpickrInstance.calendarContainer;
        const oldTooltip = calendarContainer.querySelector(".date-tooltip");
        if (oldTooltip) oldTooltip.remove();

        const tooltip = document.createElement("div");
        tooltip.className = "date-tooltip";

        const dateObj = new Date(dateStr);
        const isOutOfRange = dateObj > new Date(today).fp_incr(maxDate);

        // 🎯 新增 DOM 提示顯示容器
        const dateNoteEl = document.getElementById("date-note");
        if (dateNoteEl) dateNoteEl.textContent = ""; // 先清空

        // 📌 判斷日期種類
        if (isOutOfRange) {
            tooltip.textContent = `⚠️ 僅能選擇 ${maxDate} 天內的日期`;
        } else if (dateTypes.holiday.includes(dateStr)) {
            tooltip.textContent = "技師休假日，無法預約";
        } else if (dateTypes.weeklyOff.includes(dateObj.getDay())) {
            tooltip.textContent = "週末，無法預約";
        } else if (dateTypes.eventDay.includes(dateStr)) {
            tooltip.textContent = "🎉 點數加倍日";
            if (dateNoteEl) dateNoteEl.textContent = "🎉 這天是點數加倍日，預約即贈雙倍點數！";
        } else if (dateTypes.halfDay.includes(dateStr)) {
            tooltip.textContent = `⏰ 半天營業，預約時間至 13:00`;
        } else if (dateTypes.blockedDay.includes(dateStr)) {
            tooltip.textContent = "國定假日暫停預約";
        } else {
            tooltip.textContent = `✅ 可預約時間：${bookingStartTime} - ${bookingEndTime}`;
        }


        // 先加入 DOM 才能正確測量
        calendarContainer.appendChild(tooltip);

        // 測量位置
        const dayRect = dayElem.getBoundingClientRect();
        const calendarRect = calendarContainer.getBoundingClientRect();
        const tooltipWidth = tooltip.offsetWidth;
        const tooltipHeight = tooltip.offsetHeight;

        // 初始位置：置中、上方
        let top = dayElem.offsetTop - tooltipHeight - 8;
        let left = dayElem.offsetLeft + dayElem.offsetWidth / 2;

        // 預測 tooltip 出現在畫面的位置
        const predictedLeft = calendarRect.left + left - tooltipWidth / 2;
        const predictedRight = predictedLeft + tooltipWidth;

        // 取得視窗寬度（或你也可以用 calendarContainer 的寬度）
        const viewportWidth = window.innerWidth;

        // 防止超出畫面右邊
        if (predictedRight > viewportWidth) {
            left -= (predictedRight - viewportWidth); // 左移
        }

        // 防止超出畫面左邊
        if (predictedLeft < 0) {
            left += -predictedLeft; // 右移
        }

        // 若超出上邊界，改顯示在下方
        if (top < 0) {
            top = dayElem.offsetTop + dayElem.offsetHeight + 8;
        }

        Object.assign(tooltip.style, {
            position: "absolute",
            top: `${top}px`,
            left: `${left}px`,
            transform: "translateX(-50%)",
            background: "#333",
            color: "#fff",
            padding: "4px 8px",
            borderRadius: "4px",
            fontSize: "12px",
            whiteSpace: "nowrap",
            zIndex: "100",
        });



        requestAnimationFrame(() => tooltip.classList.add("show"));
    }


    function attachDateClickTooltip() {
        if (!flatpickrInstance || !flatpickrInstance.calendarContainer) return;

        const days = flatpickrInstance.calendarContainer.querySelectorAll(".flatpickr-day");
        days.forEach(day => {
            if (!day.dateObj) return;
            const dateStr = formatDateObj(day.dateObj);
            day.addEventListener("click", () => {
                showTooltipForDate(dateStr, day);
            });
        });
    }

    return {
        init,
        isValidBookingTime,
        formatDateWithDay,
        isValidTimeFormat,
        setBreakPeriods,
        setDateTypes,
    };
})();
