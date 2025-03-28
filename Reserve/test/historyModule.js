import { parseSummaryToFormData } from "./summaryParser.js";

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

      // 清除舊事件，避免多次綁定
      document.getElementById("btn-fill").onclick = null;
      document.getElementById("btn-delete").onclick = null;

      // 綁定填入按鈕
      document.getElementById("btn-fill").onclick = () => {
        const formData = record.formData && record.formData.people
          ? record.formData
          : parseSummaryToFormData(record.summary);

        loadFormData(formData);

        const modal = bootstrap.Modal.getInstance(document.getElementById("history-modal"));
        modal.hide();
      };

      // 綁定刪除按鈕
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

  // ✅ 載入表單欄位與服務
  function loadFormData(data) {
    if (!data) return;

    $("#name").val(data.name);
    $("#phone").val(data.phone);
    $("#booking-date").val(data.date);
    $("#booking-time").val(data.time);
    $("#booking-type").val(data.type);
    $("#num-people").val(data.numPeople).trigger("change");

    const target = document.getElementById("people-container");

    const observer = new MutationObserver(() => {
      const cards = document.querySelectorAll(".person-card");
      if (cards.length === parseInt(data.numPeople)) {
        observer.disconnect();

        $(".person-card").each(function (index) {
          const p = data.people[index];
          if (!p) return;

          const el = $(this);

          for (let service of p.main) {
            const btn = el.find("[data-type='main']");
            btn.siblings("select").val(service);
            btn.click();
          }

          for (let service of p.addon) {
            const btn = el.find("[data-type='addon']");
            btn.siblings("select").val(service);
            btn.click();
          }

          el.find(".person-note").val(p.note);
        });

        alert("✅ 已成功填入上次預約內容！");
      }
    });

    observer.observe(target, { childList: true });
  }

  return {
    saveBooking,
    getBooking,
    deleteBooking,
    bindHistoryButton,
    loadFormData // 也可供其他模組手動使用
  };
})();
