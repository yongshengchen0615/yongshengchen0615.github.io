export const BookingTimeModule = (() => {
    const today = new Date().toISOString().split("T")[0];
    let bookingStartTime = "09:00";
    let bookingEndTime = "21:00";

    function init(startTime = "09:00", endTime = "21:00") {
        document.getElementById("time-range").textContent = `${startTime} - ${endTime}`;

        bookingStartTime = startTime;
        bookingEndTime = endTime;

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

        updateTimeOptions();
    }

    function isValidBookingTime(dateStr, timeStr) {
        const now = new Date();
        const selectedDate = new Date(dateStr);
        const selectedTime = timeStr.split(":").map(Number);
        const selectedMinutes = selectedTime[0] * 60 + selectedTime[1];
    
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const bufferMinutes = 60;
    
        let [startHour, startMinute] = bookingStartTime.split(":").map(Number);
        let [endHour, endMinute] = bookingEndTime.split(":").map(Number);
        let startMinutes = startHour * 60 + startMinute;
        let endMinutes = endHour * 60 + endMinute;
    
        const isToday = dateStr === today;
    
        // ✅ 當天預約需至少提早 30 分鐘
        if (isToday) {
            const minAllowedMinutes = nowMinutes + bufferMinutes;
    
            if (selectedMinutes < minAllowedMinutes) {
                return false;
            }
    
            if (startMinutes > endMinutes) {
                // 跨日營業處理：如 20:00 ~ 03:00
                return selectedMinutes >= startMinutes || selectedMinutes <= endMinutes;
            } else {
                return selectedMinutes >= startMinutes && selectedMinutes <= endMinutes;
            }
        } else {
            // ✅ 未來日期只需符合營業時間
            if (startMinutes > endMinutes) {
                return selectedMinutes >= startMinutes || selectedMinutes <= endMinutes;
            } else {
                return selectedMinutes >= startMinutes && selectedMinutes <= endMinutes;
            }
        }
    }
    
    

    function updateTimeOptions() {
        let timeUnit=30;
        const selectedDate = document.getElementById("booking-date").value;
        const now = new Date();
        const isToday = selectedDate === today;
    
        let [startHour, startMinute] = bookingStartTime.split(":").map(Number);
        let [endHour, endMinute] = bookingEndTime.split(":").map(Number);
        let startMinutes = startHour * 60 + startMinute;
        let endMinutes = endHour * 60 + endMinute;
        let nowMinutes = now.getHours() * 60 + now.getMinutes();
    
        let timeOptions = "";
    
        if (startMinutes > endMinutes) {
            // **跨日營業時間（如 20:00 - 03:00）**
            for (let minutes = startMinutes; minutes < 1440; minutes += timeUnit) {
                if (isToday && minutes <= nowMinutes) continue;
                timeOptions += generateOption(minutes);
            }
            for (let minutes = 0; minutes <= endMinutes; minutes += timeUnit) {
                if (isToday && minutes <= nowMinutes) continue;
                timeOptions += generateOption(minutes);
            }
        } else {
            // **正常營業時間（如 09:00 - 21:00）**
            for (let minutes = startMinutes; minutes <= endMinutes; minutes += timeUnit) {
                if (isToday && minutes <= nowMinutes) continue;
                timeOptions += generateOption(minutes);
            }
        }
    
        document.getElementById("booking-time").innerHTML = timeOptions;
    }

    // ✅ **將 `generateOption()` 定義在 `BookingTimeModule` 內部**
    function generateOption(minutes) {
        const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
        const minute = (minutes % 60).toString().padStart(2, "0");
        return `<option value="${hour}:${minute}">${hour}:${minute}</option>`;
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
