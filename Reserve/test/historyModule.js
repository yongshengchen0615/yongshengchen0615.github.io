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
                    <div class="mb-3">
                        ${details}
                    </div>
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
            renderHistoryList(containerSelector); // 重新載入
        });

        accordion.appendChild(item);
    });

    container.appendChild(accordion);
}
