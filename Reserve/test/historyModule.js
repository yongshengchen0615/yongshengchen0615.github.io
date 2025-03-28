// historyModule.js
export const HistoryModule = (() => {
    const STORAGE_KEY = "booking-history";
  
    function saveBooking(summaryText, userId) {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      data[userId] = {
        summary: summaryText,
        date: new Date().toISOString()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  
    function getBooking(userId) {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      return data[userId] || null;
    }
  
    function bindHistoryButton(userId) {
      const button = document.createElement("button");
      button.textContent = "📜 查詢上次預約";
      button.className = "btn btn-outline-info w-100 my-2";
      button.addEventListener("click", () => {
        const record = getBooking(userId);
        if (!record) {
          alert("尚未有任何預約紀錄！");
        } else {
          alert(`📋 上次預約（${new Date(record.date).toLocaleString()}）：\n\n${record.summary}`);
        }
      });
      document.querySelector("#booking-form").prepend(button);
    }
  
    return {
      saveBooking,
      getBooking,
      bindHistoryButton
    };
  })();
  