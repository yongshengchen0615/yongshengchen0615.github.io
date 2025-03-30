import { BookingStorageModule } from './bookingStorageModule.js';
// historyModule.js

// 🧮 計算總金額與總時間
function calculateTotal(record) {
    let totalTime = 0;
    let totalPrice = 0;

    record.persons.forEach(p => {
        [...p.main, ...p.addon].forEach(name => {
            const timeMatch = name.match(/(\d{2,3})分鐘/);
            const priceMatch = name.match(/\$(\d+)/);

            if (timeMatch) totalTime += parseInt(timeMatch[1]);
            if (priceMatch) totalPrice += parseInt(priceMatch[1]);
        });
    });

    return { totalTime, totalPrice };
}

// 🧾 簡要摘要文字
function getSummary(data) {
    return `📅 ${data.date} ⏰ ${data.time} 👤 ${data.name}（${data.numPeople}人）`;
}

export const HistoryModule = (() => {
    const historyKey = "bookingHistory";

    function saveToHistory(data) {
        const history = getHistory();
        history.unshift(data);
        localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 10)));
    }

    function getHistory() {
        return JSON.parse(localStorage.getItem(historyKey)) || [];
    }

    function restoreFromHistory(index) {
        const history = getHistory();
        const record = history[index];
        if (record) {
            // ✅ 取今天日期
            const todayStr = new Date().toISOString().split("T")[0];
            record.date = todayStr;
    
            // ✅ 更新時間為第一個合法時段（如有）
            const timeSelect = document.getElementById("booking-time");
            if (timeSelect && timeSelect.options.length > 0) {
                record.time = timeSelect.options[0].value;
            } else {
                alert("⚠️ 找不到適合的預約時間，請先選擇預約日期！");
                return;
            }
    
            BookingStorageModule.restoreToForm(record);
    
            if (typeof updateTotalAll === "function") {
                updateTotalAll();
            }
    
            alert("✅ 已成功還原預約內容！（已調整為今日與合法時間）");
        } else {
            alert("⚠️ 無法還原該筆紀錄！");
        }
    }
    
    
    

    function deleteHistory(index) {
        const history = getHistory();
        history.splice(index, 1);
        localStorage.setItem(historyKey, JSON.stringify(history));
    }

    // ✅ Accordion 樣式渲染預約紀錄
    function renderHistoryList(containerSelector) {
        const container = document.querySelector(containerSelector);
        if (!container) return;

        const history = getHistory();
        container.innerHTML = "";

        if (history.length === 0) {
            container.innerHTML = `<p class="text-muted">暫無預約紀錄</p>`;
            return;
        }

        const accordionId = "historyAccordion";
        const accordion = document.createElement("div");
        accordion.className = "accordion";
        accordion.id = accordionId;

        history.forEach((record, index) => {
            const collapseId = `collapse-${index}`;
            const { totalTime, totalPrice } = calculateTotal(record);
            const summary = getSummary(record);
            const details = record.persons
                .map((p, i) => {
                    const services = [...p.main, ...p.addon].map(s => `・${s}`).join("<br>");
                    return `<strong>👤 預約人 ${i + 1}</strong><br>${services}`;
                })
                .join("<hr>");

            const item = document.createElement("div");
            item.className = "accordion-item";

            item.innerHTML = `
                <h2 class="accordion-header" id="heading-${index}">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
                        ${summary} ｜ ⏳ ${totalTime} 分｜💰 $${totalPrice} 元
                    </button>
                </h2>
                <div id="${collapseId}" class="accordion-collapse collapse" aria-labelledby="heading-${index}" data-bs-parent="#${accordionId}">
                    <div class="accordion-body">
                        <div class="mb-3">${details}</div>
                        <div class="d-flex gap-2 justify-content-end">
                            <button class="btn btn-sm btn-outline-primary restore-btn">還原</button>
                            <button class="btn btn-sm btn-outline-danger delete-btn">刪除</button>
                        </div>
                    </div>
                </div>
            `;

            item.querySelector(".restore-btn").addEventListener("click", () => {
                restoreFromHistory(index);
            });

            item.querySelector(".delete-btn").addEventListener("click", () => {
                deleteHistory(index);
                renderHistoryList(containerSelector);
            });

            accordion.appendChild(item);
        });

        container.appendChild(accordion);
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
