import { dateTypes, setDateTypes as updateDateTypes } from "./bookingDateTypes.js";
import { bookingConfig } from "../data/bookingConfig.js";

let flatpickrInstance = null;

export const BookingTimeModule = (() => {
    function getTodayYMDLocal() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    let today = getTodayYMDLocal();

    const {
        startTime,
        endTime,
        bufferMinutes,
        maxBookingDays,
        breakPeriods,
        dateTypes: configDateTypes
    } = bookingConfig;

    function init() {
        updateDateTypes(configDateTypes); // 載入日期型別設定

        updateDOMText("time-range", `${startTime} - ${endTime}`);
        updateDOMText("time-bufferMinutes", `當天預約需提早${bufferMinutes}分鐘`);

        const bookingDateInput = document.getElementById("booking-date");
        // 重新計算 today（避免跨日）
        today = getTodayYMDLocal();
        const defaultDateStr = getNextAvailableDate(today);

        flatpickrInstance = flatpickr(bookingDateInput, {
            locale: "zh",
            dateFormat: "Y-m-d",
            minDate: today,
            maxDate: new Date().fp_incr(maxBookingDays),
            disable: generateDisabledDates(),
            defaultDate: defaultDateStr,
            onChange: (selectedDates, dateStr) => {
                updateTimeOptions();
                showTooltipForDate(dateStr, findDayElemByDate(dateStr));
                updateDateNoteMessage(dateStr);
            },
            onDayCreate: (dObj, dStr, fp, dayElem) => {
                const dateStr = formatDate(dayElem.dateObj);
                decorateDayElement(dayElem, dateStr);
            },
            onReady: attachDateClickTooltip,
            onMonthChange: attachDateClickTooltip,
            onYearChange: attachDateClickTooltip,
            onOpen: attachDateClickTooltip,
        });

        updateTimeOptions();
        updateDateNoteMessage(defaultDateStr);
    }

    function updateDOMText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function getNextAvailableDate(startDateStr) {
        const startDate = new Date(startDateStr);
        for (let i = 0; i <= maxBookingDays; i++) {
            const checkDate = new Date(startDate);
            checkDate.setDate(checkDate.getDate() + i);
            const dateStr = formatDate(checkDate);
            if (!isDateBlocked(dateStr, checkDate)) return dateStr;
        }
        return startDateStr;
    }

    function isDateBlocked(dateStr, dateObj) {
        return (
            dateTypes.holiday.includes(dateStr) ||
            dateTypes.blockedDay.includes(dateStr) ||
            dateTypes.weeklyOff.includes(dateObj.getDay())
        );
    }

    function updateDateNoteMessage(dateStr) {
        const dateNoteEl = document.getElementById("date-note");
        if (!dateNoteEl) return;

        const dateObj = new Date(dateStr);
        const messages = {
            holiday: "技師休假日，無法預約",
            weeklyOff: "週末，無法預約",
            eventDay: "🎉 這天是點數加倍日，預約即贈雙倍點數！",
            halfDay: "⏰ 半天營業，預約時間至 13:00",
            blockedDay: "國定假日暫停預約"
        };

        let message = "";
        if (dateTypes.eventDay.includes(dateStr)) message = messages.eventDay;
        else if (dateTypes.holiday.includes(dateStr)) message = messages.holiday;
        else if (dateTypes.weeklyOff.includes(dateObj.getDay())) message = messages.weeklyOff;
        else if (dateTypes.halfDay.includes(dateStr)) message = messages.halfDay;
        else if (dateTypes.blockedDay.includes(dateStr)) message = messages.blockedDay;

        dateNoteEl.textContent = message;
    }

    function generateDisabledDates() {
        return [
            ...dateTypes.holiday,
            ...dateTypes.blockedDay,
            date => dateTypes.weeklyOff.includes(date.getDay())
        ];
    }

    function updateTimeOptions() {
        const selectedDate = document.getElementById("booking-date").value;
        const timeSelect = document.getElementById("booking-time");
        timeSelect.innerHTML = "";

        if (isDateBlocked(selectedDate, new Date(selectedDate))) {
            timeSelect.innerHTML = '<option disabled>此日為休息日</option>';
            return;
        }

        const isHalfDay = dateTypes.halfDay.includes(selectedDate);
        const startMins = toMinutes(startTime);
        const endMins = isHalfDay ? 13 * 60 : toMinutes(endTime);

        const now = new Date();
        const isToday = selectedDate === today;
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const minAllowed = isToday ? nowMinutes + bufferMinutes : 0;

        for (let minutes = 0; minutes < 1440; minutes += 30) {
            if (isTimeAvailable(minutes, startMins, endMins, minAllowed)) {
                timeSelect.innerHTML += generateOption(minutes);
            }
        }

        if (!timeSelect.options.length) {
            timeSelect.innerHTML = '<option disabled>⚠️ 無可預約時段</option>';
        } else {
            timeSelect.selectedIndex = 0;
        }
    }

    function isTimeAvailable(mins, start, end, minAllowed) {
        if (mins < minAllowed) return false;

        const timeStr = formatMinutes(mins);
        if (start > end && !(mins >= start || mins <= end)) return false;
        if (start <= end && (mins < start || mins > end)) return false;

        return !breakPeriods.some(period => timeStr >= period.start && timeStr < period.end);
    }

    function decorateDayElement(dayElem, dateStr) {
        const dateObj = dayElem.dateObj;
        if (dateTypes.holiday.includes(dateStr)) dayElem.classList.add("flatpickr-holiday");
        if (dateTypes.weeklyOff.includes(dateObj.getDay())) dayElem.classList.add("flatpickr-weekoff");
        if (dateTypes.eventDay.includes(dateStr)) dayElem.classList.add("flatpickr-event");
        if (dateTypes.halfDay.includes(dateStr)) dayElem.classList.add("flatpickr-halfday");
        if (dateTypes.blockedDay.includes(dateStr)) dayElem.classList.add("flatpickr-blocked");
    }

    function generateOption(mins) {
        const timeStr = formatMinutes(mins);
        return `<option value="${timeStr}">${timeStr}</option>`;
    }

    function formatMinutes(mins) {
        const h = String(Math.floor(mins / 60)).padStart(2, "0");
        const m = String(mins % 60).padStart(2, "0");
        return `${h}:${m}`;
    }

    function toMinutes(timeStr) {
        const [h, m] = timeStr.split(":").map(Number);
        return h * 60 + m;
    }

    function formatDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function findDayElemByDate(dateStr) {
        const days = flatpickrInstance.calendarContainer.querySelectorAll(".flatpickr-day");
        for (const day of days) {
            if (day.dateObj && formatDate(day.dateObj) === dateStr) return day;
        }
        return null;
    }

    function showTooltipForDate(dateStr, dayElem) {
        if (!dayElem) return;

        const tooltip = document.createElement("div");
        tooltip.className = "date-tooltip";

        const dateObj = new Date(dateStr);
        const dateNoteEl = document.getElementById("date-note");
        const isOutOfRange = dateObj > new Date(today).fp_incr(maxBookingDays);

        if (dateNoteEl) dateNoteEl.textContent = "";

        tooltip.textContent =
            isOutOfRange ? `⚠️ 僅能選擇 ${maxBookingDays} 天內的日期` :
            dateTypes.holiday.includes(dateStr) ? "技師休假日，無法預約" :
            dateTypes.weeklyOff.includes(dateObj.getDay()) ? "週末，無法預約" :
            dateTypes.eventDay.includes(dateStr) ? "🎉 點數加倍日" :
            dateTypes.halfDay.includes(dateStr) ? "⏰ 半天營業，預約時間至 13:00" :
            dateTypes.blockedDay.includes(dateStr) ? "國定假日暫停預約" :
            `✅ 可預約時間：${startTime} - ${endTime}`;

        if (dateTypes.eventDay.includes(dateStr) && dateNoteEl) {
            dateNoteEl.textContent = "🎉 這天是點數加倍日，預約即贈雙倍點數！";
        }

        positionTooltip(dayElem, tooltip);
    }

    function positionTooltip(dayElem, tooltip) {
        const container = flatpickrInstance.calendarContainer;
        const rect = dayElem.getBoundingClientRect();
        const calRect = container.getBoundingClientRect();
        const width = tooltip.offsetWidth;
        const height = tooltip.offsetHeight;

        let top = dayElem.offsetTop - height - 8;
        let left = dayElem.offsetLeft + dayElem.offsetWidth / 2;

        if ((calRect.left + left + width / 2) > window.innerWidth) left -= (calRect.left + left + width / 2 - window.innerWidth);
        if ((calRect.left + left - width / 2) < 0) left += (0 - (calRect.left + left - width / 2));
        if (top < 0) top = dayElem.offsetTop + dayElem.offsetHeight + 8;

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

        container.querySelector(".date-tooltip")?.remove();
        container.appendChild(tooltip);
        requestAnimationFrame(() => tooltip.classList.add("show"));
    }

    function attachDateClickTooltip() {
        if (!flatpickrInstance || !flatpickrInstance.calendarContainer) return;
        const days = flatpickrInstance.calendarContainer.querySelectorAll(".flatpickr-day");
        days.forEach(day => {
            if (!day.dateObj) return;
            const dateStr = formatDate(day.dateObj);
            // 避免重複綁定
            if (!day.dataset.tooltipBound) {
                day.addEventListener("click", () => {
                    showTooltipForDate(dateStr, day);
                });
                day.dataset.tooltipBound = "1";
            }
        });
    }

    function isValidBookingTime(dateStr, timeStr) {
        if (!/^\d{2}:\d{2}$/.test(timeStr)) return false;
        if (dateTypes.holiday.includes(dateStr)) return false;

        const now = new Date();
        const [h, m] = timeStr.split(":").map(Number);
        const selectedMins = h * 60 + m;
        const nowMins = now.getHours() * 60 + now.getMinutes();
        const isToday = dateStr === today;

        const startMins = toMinutes(startTime);
        const endMins = toMinutes(endTime);
        const minAllowed = isToday ? nowMins + bufferMinutes : 0;

        if (selectedMins < minAllowed) return false;

        const inBusinessHours = startMins > endMins
            ? selectedMins >= startMins || selectedMins <= endMins
            : selectedMins >= startMins && selectedMins <= endMins;

        if (!inBusinessHours) return false;

        return !breakPeriods.some(period => timeStr >= period.start && timeStr < period.end);
    }

    function formatDateWithDay(dateStr) {
        const date = new Date(dateStr);
        const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
        return `${dateStr}（${weekdays[date.getDay()]}）`;
    }

    // 公開方法：設定日期與時間，並同步 UI 與可選時段
    function setDateTime(dateStr, timeStr) {
        try {
            // 更新 today（避免隔日切換時錯誤）
            today = getTodayYMDLocal();

            const dateInput = document.getElementById("booking-date");
            if (flatpickrInstance) {
                flatpickrInstance.setDate(dateStr, true); // triggerChange = true
            } else if (dateInput) {
                dateInput.value = dateStr;
            }

            // 重新生成時間選單
            updateTimeOptions();

            const timeSelect = document.getElementById("booking-time");
            if (!timeSelect) return;

            // 若指定時間存在則選取，否則選第一個可用
            const idx = Array.from(timeSelect.options).findIndex(opt => opt.value === timeStr);
            if (idx >= 0) {
                timeSelect.selectedIndex = idx;
            } else if (timeSelect.options.length > 0) {
                timeSelect.selectedIndex = 0;
            }

            updateDateNoteMessage(dateStr);
        } catch (e) {
            console.warn("setDateTime 發生例外：", e);
        }
    }

    return {
        init,
        isValidBookingTime,
        formatDateWithDay,
        isValidTimeFormat: time => /^\d{2}:\d{2}$/.test(time),
        findNextAvailableDate: getNextAvailableDate,
        getTodayYMD: getTodayYMDLocal,
        setDateTime,
    };
})();
