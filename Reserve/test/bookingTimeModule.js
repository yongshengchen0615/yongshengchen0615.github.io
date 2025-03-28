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
        const selectedDateTime = new Date(`${dateStr}T${timeStr}`);
        const nowTime = now.getTime();
    
        const selectedTimeInMin = selectedDateTime.getHours() * 60 + selectedDateTime.getMinutes();
    
        // 允許的時間範圍
        const [startHour, startMin] = bookingStartTime.split(":").map(Number);
        const [endHour, endMin] = bookingEndTime.split(":").map(Number);
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
    
        const bufferMinutes = 30; // 🔐 提前多久不能預約（預設：30分鐘）
        const minAllowedTime = nowTime + bufferMinutes * 60 * 1000;
    
        const isToday = dateStr === getTodayStr();
    
        // ✅ 檢查當日是否選擇過去時間（考慮提前 buffer）
        if (isToday && selectedDateTime.getTime() < minAllowedTime) {
            return false;
        }
    
        // ✅ 營業時間合法性檢查（跨日情況）
        if (startMinutes <= endMinutes) {
            // 正常時段
            return selectedTimeInMin >= startMinutes && selectedTimeInMin <= endMinutes;
        } else {
            // 跨日：如 20:00 ~ 03:00
            return selectedTimeInMin >= startMinutes || selectedTimeInMin <= endMinutes;
        }
    }
    
    // 🔁 補充：動態取得今日字串
    function getTodayStr() {
        const now = new Date();
        return now.toISOString().split("T")[0];
    }
    

    function updateTimeOptions() {
        const timeUnit = 30; // 單位：每 30 分鐘
        const bufferMinutes = 30; // ❗ 提前幾分鐘不可預約
    
        const selectedDate = document.getElementById("booking-date").value;
        const now = new Date();
        const isToday = selectedDate === getTodayStr();
    
        const nowTime = now.getTime();
        const minAllowedTime = nowTime + bufferMinutes * 60 * 1000;
    
        const [startHour, startMinute] = bookingStartTime.split(":").map(Number);
        const [endHour, endMinute] = bookingEndTime.split(":").map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;
    
        let timeOptions = "";
    
        // 🕒 將分鐘轉為 Date 物件（方便比對時間合法性）
        const createDate = (minutes) => {
            const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
            const min = (minutes % 60).toString().padStart(2, "0");
            return new Date(`${selectedDate}T${hour}:${min}`);
        };
    
        if (startMinutes > endMinutes) {
            // 🔁 跨日營業
            for (let minutes = startMinutes; minutes < 1440; minutes += timeUnit) {
                const optionDate = createDate(minutes);
                if (isToday && optionDate.getTime() < minAllowedTime) continue;
                timeOptions += generateOption(minutes);
            }
            for (let minutes = 0; minutes <= endMinutes; minutes += timeUnit) {
                const optionDate = createDate(minutes);
                if (isToday && optionDate.getTime() < minAllowedTime) continue;
                timeOptions += generateOption(minutes);
            }
        } else {
            // ⏰ 正常營業
            for (let minutes = startMinutes; minutes <= endMinutes; minutes += timeUnit) {
                const optionDate = createDate(minutes);
                if (isToday && optionDate.getTime() < minAllowedTime) continue;
                timeOptions += generateOption(minutes);
            }
        }
        // ✅ 加在這裡
    if (!timeOptions) {
        timeOptions = `<option disabled selected>⚠️ 今日已無可預約時段</option>`;
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
