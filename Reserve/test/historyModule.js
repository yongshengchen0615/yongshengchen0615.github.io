// 📜 historyModule.js（整合混合雙格式版本）
export const HistoryModule = (() => {
    const STORAGE_KEY = "bookingHistory";

    /**
     * 取得歷史預約紀錄陣列
     * @returns {Array<{summary: string, data: object}>}
     */
    function getHistory() {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    }

    /**
     * 渲染紀錄列表，並提供重新填入功能
     * @param {string} containerSelector
     * @param {function} onFillCallback - 點擊重新填入按鈕時執行的 callback(data)
     */
    function renderHistory(containerSelector, onFillCallback) {
        const container = document.querySelector(containerSelector);
        container.innerHTML = "";

        const history = getHistory();
        if (history.length === 0) {
            container.innerHTML = "<p class='text-center text-muted'>尚無任何預約紀錄。</p>";
            return;
        }

        history.reverse().forEach((record, index) => {
            const { summary, data } = record;

            const card = document.createElement("div");
            card.className = "card mb-3 p-3 shadow-sm bg-light text-dark";

            card.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <h5 class="fw-bold">📅 ${data.date} ⏰ ${data.time}</h5>
                    <button class="btn btn-outline-secondary btn-sm fill-form" data-index="${index}">🔁 重新填入</button>
                </div>
                <pre class="bg-white p-2 rounded border text-dark">${summary}</pre>
            `;

            // 綁定點擊事件
            card.querySelector(".fill-form").addEventListener("click", () => {
                if (typeof onFillCallback === 'function') {
                    onFillCallback(data);
                }
            });

            container.appendChild(card);
        });
    }

    function setFormFromHistory(data) {
        $("#name").val(data.name);
        $("#phone").val(data.phone);
        $("#booking-date").val(data.date).trigger("change");
        $("#booking-time").val(data.time);
        $("#booking-type").val(data.bookingType);
        $("#num-people").val(data.numPeople).trigger("change");
    
        setTimeout(() => {
            $(".person-card").each(function (index) {
                const personData = data.people[index];
                const card = $(this);
    
                personData.mainServices.forEach(service => {
                    const btn = card.find(".add-service[data-type='main']");
                    btn.siblings("select").val(service);
                    btn.click();
                });
    
                personData.addonServices.forEach(service => {
                    const btn = card.find(".add-service[data-type='addon']");
                    btn.siblings("select").val(service);
                    btn.click();
                });
            });
        }, 300); // 延遲載入，確保畫面已生成
    }
    
    return {
        renderHistory,
        getHistory,
        setFormFromHistory // ← 新增這行
    };
})();
