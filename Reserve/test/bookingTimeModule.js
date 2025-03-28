export const BookingTimeModule = (() => {
    let bookingStartTime = "09:00"; // 預設營業起始時間
    let bookingEndTime = "21:00";   // 預設營業結束時間
  
    // 📌 取得今天的日期字串，格式為 YYYY-MM-DD，用來設定最小日期與驗證是否為今天
    function getTodayStr() {
      return new Date().toISOString().split("T")[0];
    }
  
    // 📌 回傳允許最早預約時間（現在 + buffer 時間），預設 buffer 為 30 分鐘
    // @param {number} bufferMinutes - 幾分鐘前為最早可預約時間，預設 30 分鐘
    function getMinAllowedTime(bufferMinutes = 60) {
      return Date.now() + bufferMinutes * 60 * 1000;
    }
  
    // 📌 將分鐘轉換為 <option> 時間格式（例：540 -> 09:00）
    // @param {number} minutes - 要轉換的分鐘數（如 540 代表 9:00）
    function generateOption(minutes) {
      const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
      const min = String(minutes % 60).padStart(2, "0");
      return `<option value="${hour}:${min}">${hour}:${min}</option>`;
    }
  
    // 📌 用來批次處理分鐘範圍，例如 540~1440，每 30 分鐘呼叫 callback 一次
    // @param {number} start - 起始分鐘數
    // @param {number} end - 結束分鐘數
    // @param {Function} callback - 每次迭代呼叫的函式
    // @param {number} timeUnit - 間距時間（預設每 30 分鐘）
    function loopMinutesRange(start, end, callback, timeUnit = 30) {
      for (let minutes = start; minutes <= end; minutes += timeUnit) {
        callback(minutes);
      }
    }
  
    // 📌 產生所有合法的預約時段選項，並更新到 #booking-time 下拉選單
    function updateTimeOptions() {
      const selectedDate = document.getElementById("booking-date").value;
      const isToday = selectedDate === getTodayStr();
      const minAllowedTime = getMinAllowedTime();
  
      const [startHour, startMinute] = bookingStartTime.split(":").map(Number);
      const [endHour, endMinute] = bookingEndTime.split(":").map(Number);
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;
  
      let timeOptions = "";
  
      // 🧮 將分鐘轉為日期物件（供合法時間檢查）
      // @param {number} minutes - 當前分鐘值
      const createDate = (minutes) => {
        const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
        const min = String(minutes % 60).padStart(2, "0");
        return new Date(`${selectedDate}T${hour}:${min}`);
      };
  
      // ✅ 判斷此時間是否可加入選項（符合時間限制與 buffer）
      // @param {number} minutes - 當前分鐘值
      const tryAddOption = (minutes) => {
        const optionDate = createDate(minutes);
        if (isToday && optionDate.getTime() < minAllowedTime) return;
        timeOptions += generateOption(minutes);
      };
  
      // ⏱ 若跨日營業（例如 20:00 ~ 03:00）
      if (startMinutes > endMinutes) {
        loopMinutesRange(startMinutes, 1439, tryAddOption);
        loopMinutesRange(0, endMinutes, tryAddOption);
      } else {
        // ⏰ 一般營業時段
        loopMinutesRange(startMinutes, endMinutes, tryAddOption);
      }
  
      // ❌ 無任何合法選項時顯示提醒
      if (!timeOptions) {
        timeOptions = `<option disabled selected>⚠️ 今日已無可預約時段</option>`;
      }
  
      document.getElementById("booking-time").innerHTML = timeOptions;
    }
  
    // 📌 檢查指定的日期與時間是否為合法預約時間
    // @param {string} dateStr - 預約日期，格式 YYYY-MM-DD
    // @param {string} timeStr - 預約時間，格式 HH:MM
    function isValidBookingTime(dateStr, timeStr) {
      const selectedDateTime = new Date(`${dateStr}T${timeStr}`);
      const selectedMinutes = selectedDateTime.getHours() * 60 + selectedDateTime.getMinutes();
      const minAllowedTime = getMinAllowedTime();
      const isToday = dateStr === getTodayStr();
  
      const [startHour, startMin] = bookingStartTime.split(":").map(Number);
      const [endHour, endMin] = bookingEndTime.split(":").map(Number);
      const startMinutes = startHour * 60 + startMin;
      const endMinutes = endHour * 60 + endMin;
  
      // 🔒 若是今日且小於 buffer 限制，視為無效
      if (isToday && selectedDateTime.getTime() < minAllowedTime) return false;
  
      // ✅ 判斷是否在營業時間範圍內（支援跨日）
      return startMinutes <= endMinutes
        ? selectedMinutes >= startMinutes && selectedMinutes <= endMinutes
        : selectedMinutes >= startMinutes || selectedMinutes <= endMinutes;
    }
  
    // 📌 顯示格式化日期（YYYY-MM-DD + 星期幾）
    // @param {string} dateStr - 日期字串（格式 YYYY-MM-DD）
    function formatDateWithDay(dateStr) {
      const date = new Date(dateStr);
      const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
      return `${dateStr}（${weekdays[date.getDay()]}）`;
    }
  
    // 📌 初始化模組：設定營業時間、預設今天、限制過去不能選，並綁定 onchange 事件
    // @param {string} startTime - 營業起始時間（格式 HH:MM）
    // @param {string} endTime - 營業結束時間（格式 HH:MM）
    function init(startTime = "09:00", endTime = "21:00") {
      const today = getTodayStr();
      bookingStartTime = startTime;
      bookingEndTime = endTime;
  
      document.getElementById("time-range").textContent = `${startTime} - ${endTime}`;
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
  
    return {
      init,
      isValidBookingTime,
      formatDateWithDay
    };
  })();