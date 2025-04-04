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
    return `📅 ${data.date} ⏰ ${data.time} 👤 ${data.name}（${data.numPeople}位）`;
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

            alert("✅ 已成功加入預約內容！（已調整為今日與可預約時間）");
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
    function renderHistoryList(containerSelector, isDarkMode = false) {
        const container = document.querySelector(containerSelector);
        if (!container) return;

        const history = getHistory();
        container.innerHTML = "";

        if (history.length === 0) {
            container.innerHTML = `<p class="${isDarkMode ? 'text-secondary' : 'text-muted'}">暫無預約紀錄</p>`;
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
                    
                    const noteHtml = p.note ? `<br><span style="color: #996633;">📌 備註：${p.note}</span>` : "";
                    // ⏳ 總時間與💰總金額計算
                    const timeSum = [...p.main, ...p.addon].reduce((sum, name) => {
                        const match = name.match(/(\d{2,3})分鐘/);
                        return match ? sum + parseInt(match[1]) : sum;
                    }, 0);

                    const priceSum = [...p.main, ...p.addon].reduce((sum, name) => {
                        const match = name.match(/\$(\d+)/);
                        return match ? sum + parseInt(match[1]) : sum;
                    }, 0);

                    const summary = `<br>🕒 總時間：${timeSum} 分鐘<br>💰 總金額：$${priceSum} 元`;

                    return `<strong>👤 顧客 ${i + 1}</strong><br>${services}${summary}${noteHtml}`;
                })
                .join("<hr>");

            const item = document.createElement("div");
            item.className = "accordion-item";

            // Header
            const header = document.createElement("h2");
            header.className = "accordion-header";
            header.id = `heading-${index}`;

            const button = document.createElement("button");
            button.className = "accordion-button collapsed fw-semibold";
            button.type = "button";
            button.setAttribute("data-bs-toggle", "collapse");
            button.setAttribute("data-bs-target", `#${collapseId}`);
            button.setAttribute("aria-expanded", "false");
            button.setAttribute("aria-controls", collapseId);
            button.innerHTML = `${summary}  總金額： $${totalPrice} 元`;

            header.appendChild(button);

            // Collapse
            const collapse = document.createElement("div");
            collapse.className = "accordion-collapse collapse";
            collapse.id = collapseId;
            collapse.setAttribute("aria-labelledby", `heading-${index}`);
            collapse.setAttribute("data-bs-parent", `#${accordionId}`);

            // Body
            const body = document.createElement("div");
            body.className = `accordion-body rounded shadow-sm p-3 ${isDarkMode ? 'bg-dark text-light' : 'bg-light'}`;

            const detailDiv = document.createElement("div");
            detailDiv.className = `mb-3 small ${isDarkMode ? 'text-secondary border-light' : 'text-muted border-start'} ps-3`;
            detailDiv.innerHTML = details;

            const btnGroup = document.createElement("div");
            btnGroup.className = "d-flex gap-2 justify-content-end flex-wrap";

            const baseBtnClass = "btn btn-sm px-3 rounded-pill fw-semibold flex-fill min-w-100";


            const restoreBtn = document.createElement("button");
            restoreBtn.className = `${baseBtnClass} ${isDarkMode ? 'btn-outline-light' : 'btn-outline-primary'}`;
            restoreBtn.textContent = "加入預約資料";

            const deleteBtn = document.createElement("button");
            deleteBtn.className = `${baseBtnClass} btn-outline-danger`;
            deleteBtn.textContent = "刪除";

            btnGroup.appendChild(restoreBtn);
            btnGroup.appendChild(deleteBtn);

            body.appendChild(detailDiv);
            body.appendChild(btnGroup);

            collapse.appendChild(body);
            item.appendChild(header);
            item.appendChild(collapse);

            // Events
            restoreBtn.addEventListener("click", () => {
                restoreFromHistory(index);
            });

            deleteBtn.addEventListener("click", () => {
                deleteHistory(index);
                renderHistoryList(containerSelector, isDarkMode);
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
