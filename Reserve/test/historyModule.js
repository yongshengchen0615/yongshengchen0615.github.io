// historyModule.js
import { BookingStorageModule } from "./bookingStorageModule.js";

export const HistoryModule = (() => {
    const historyKey = "bookingHistory";

    // 儲存新紀錄到歷史中（最多保留10筆）
    function saveToHistory(data) {
        const history = getHistory();
        history.unshift(data);
        const limited = history.slice(0, 10);
        localStorage.setItem(historyKey, JSON.stringify(limited));
    }

    // 取得所有歷史資料
    function getHistory() {
        return JSON.parse(localStorage.getItem(historyKey)) || [];
    }

    // 以 index 還原某筆紀錄
    function restoreFromHistory(index) {
        const history = getHistory();
        const record = history[index];
        if (record) {
            BookingStorageModule.restoreToForm(record);
        }
    }

    // 刪除某筆紀錄
    function deleteHistory(index) {
        const history = getHistory();
        history.splice(index, 1);
        localStorage.setItem(historyKey, JSON.stringify(history));
    }

    // 傳回簡要摘要（可搭配 UI 顯示）
    function getSummary(data) {
        return `📅 ${data.date} ⏰ ${data.time} 👤 ${data.name}（${data.numPeople}人）`;
    }

    // 產出 HTML 清單（可綁定在容器）
    function renderHistoryList(containerSelector) {
        const container = document.querySelector(containerSelector);
        if (!container) return;

        const history = getHistory();
        container.innerHTML = "";

        if (history.length === 0) {
            container.innerHTML = `<p class="text-muted">暫無預約紀錄</p>`;
            return;
        }

        history.forEach((record, index) => {
            const collapseId = `collapse-${index}`;
            const div = document.createElement("div");
            div.className = "history-item border p-2 mb-2 rounded bg-light text-dark";

            const summary = getSummary(record);
            const details = record.persons
                .map((p, i) => {
                    const services = [...p.main, ...p.addon].join("、") || "無";
                    return `👤 預約人 ${i + 1}<br>- ${services}`;
                })
                .join("<hr>");

            div.innerHTML = `
               <div class="history-item border p-2 mb-3 rounded bg-light text-dark">
  <div class="row">
    <!-- 📅 摘要區 -->
    <div class="col-12 col-md-8 mb-2">
      <strong>${summary}</strong>
    </div>

    <!-- 🔘 按鈕區 -->
    <div class="col-12 col-md-4 d-flex flex-wrap justify-content-md-end gap-2">
      <button class="btn btn-sm btn-outline-secondary" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
        🔽 詳細
      </button>
      <button class="btn btn-sm btn-outline-primary restore-btn">還原</button>
      <button class="btn btn-sm btn-outline-danger delete-btn">刪除</button>
    </div>
  </div>

  <!-- 🔽 展開詳細 -->
  <div id="${collapseId}" class="collapse mt-2">
    <div class="card card-body bg-white text-dark small">
      ${details}
    </div>
  </div>
</div>

            `;

            div.querySelector(".restore-btn").addEventListener("click", () => {
                restoreFromHistory(index);
            });

            div.querySelector(".delete-btn").addEventListener("click", () => {
                deleteHistory(index);
                renderHistoryList(containerSelector); // 重新載入
            });

            container.appendChild(div);
        });
    }


    return {
        saveToHistory,
        getHistory,
        restoreFromHistory,
        deleteHistory,
        getSummary,
        renderHistoryList
    };
})();
