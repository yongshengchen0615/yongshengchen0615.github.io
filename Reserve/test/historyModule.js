// historyModule.js
export const HistoryModule = (() => {
    const STORAGE_KEY = "booking-history";
  
    function saveBooking(summaryText, userId, bookingData = {}) {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      data[userId] = {
        summary: summaryText,
        date: new Date().toISOString(),
        formData: bookingData
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  
    function getBooking(userId) {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      return data[userId] || null;
    }
  
    function deleteBooking(userId) {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      delete data[userId];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  
    function bindHistoryButton(userId) {
        const button = document.createElement("button");
        button.textContent = "📜 查詢上次預約";
        button.className = "btn btn-outline-info w-100 my-2";
      
        button.addEventListener("click", () => {
          const record = getBooking(userId);
          if (!record) {
            alert("尚未有任何預約紀錄！");
            return;
          }
      
          // 顯示紀錄內容
          document.getElementById("history-date").textContent = `🕒 時間：${new Date(record.date).toLocaleString()}`;
          document.getElementById("history-summary").textContent = record.summary;
      
          // 綁定按鈕功能
          document.getElementById("btn-fill").onclick = () => {
            loadFormData(record.formData);
            const modal = bootstrap.Modal.getInstance(document.getElementById("history-modal"));
            modal.hide();
          };
      
          document.getElementById("btn-delete").onclick = () => {
            deleteBooking(userId);
            alert("❌ 已清除上次預約紀錄！");
            const modal = bootstrap.Modal.getInstance(document.getElementById("history-modal"));
            modal.hide();
          };
      
          // 顯示 modal
          const modal = new bootstrap.Modal(document.getElementById("history-modal"));
          modal.show();
        });
      
        document.querySelector("#booking-form").prepend(button);
      }
      
  
    // ✨ 將儲存的資料自動填入表單（只填姓名、電話、基本欄位）
    function loadFormData(data) {
        if (!data) return;
      
        // ✅ 填入基本欄位（立即填）
        $("#name").val(data.name);
        $("#phone").val(data.phone);
        $("#booking-date").val(data.date);
        $("#booking-time").val(data.time);
        $("#booking-type").val(data.type);
        $("#num-people").val(data.numPeople).trigger("change");
      
        // ✅ 等待 #people-container 中 .person-card 全部載入後再填資料
        const maxWaitTime = 3000; // 最多等 3 秒
        let waited = 0;
      
        const checkInterval = setInterval(() => {
          const personCards = $(".person-card");
          if (personCards.length === parseInt(data.numPeople)) {
            clearInterval(checkInterval); // 停止等待
      
            personCards.each(function (index) {
              const p = data.people[index];
              if (!p) return;
      
              const personEl = $(this);
      
              // 填主要服務
              for (let service of p.main) {
                const btn = personEl.find("[data-type='main']");
                btn.siblings("select").val(service);
                btn.click();
              }
      
              // 填加購服務
              for (let service of p.addon) {
                const btn = personEl.find("[data-type='addon']");
                btn.siblings("select").val(service);
                btn.click();
              }
      
              // 填備註
              personEl.find(".person-note").val(p.note);
            });
      
            // ✅ 可加提示
            alert("✅ 已成功填入上次預約內容！");
          }
      
          waited += 100;
          if (waited >= maxWaitTime) {
            clearInterval(checkInterval);
            alert("⚠️ 表單載入超時，無法自動填入。請重新操作。");
          }
        }, 100);
      }
      
      
      
  
    return {
      saveBooking,
      getBooking,
      bindHistoryButton,
      deleteBooking
    };
  })();
  