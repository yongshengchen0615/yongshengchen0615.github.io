// bookingStorageModule.js
export const BookingStorageModule = (() => {
    const storageKey = "lastBooking";

    function save(data) {
        localStorage.setItem(storageKey, JSON.stringify(data));
    }

    function load() {
        const data = localStorage.getItem(storageKey);
        return data ? JSON.parse(data) : null;
    }

    function clear() {
        localStorage.removeItem(storageKey);
    }

    function restoreToForm(data) {
        if (!data) return;

        $("#booking-type").val(data.bookingType);
        $("#name").val(data.name);
        $("#phone").val(data.phone);
        $("#booking-date").val(data.date);
        $("#booking-time").val(data.time);
        $("#num-people").val(data.numPeople).trigger("change");

        // 等待預約人卡片動態生成完畢後填入服務
        setTimeout(() => {
            $(".person-card").each(function (i) {
                const personData = data.persons[i];
                if (!personData) return;

                personData.main.forEach(service => {
                    const select = $(this).find(".main-service");
                    select.val(service);
                    $(this).find(".add-service[data-type='main']").click();
                });

                personData.addon.forEach(service => {
                    const select = $(this).find(".addon-service");
                    select.val(service);
                    $(this).find(".add-service[data-type='addon']").click();
                });
            });
        }, 100);
    }
    function renderAllHistoryUI(historyList) {
        const accordionEl = $("#historyAccordion");
        if (!historyList.length) return;
    
        let html = historyList.map((data, i) => {
            const dateFormatted = BookingTimeModule.formatDateWithDay(data.date);
            const persons = data.persons.map((p, idx) => {
                return `
                👤 預約人 ${idx + 1}：
                - 服務內容：${[...p.main, ...p.addon].join(", ")}
                - 服務總時間：${getTotalTime(p)} 分鐘
                - 服務總金額：$${getTotalPrice(p)} 元
                `;
            }).join("\n\n");
    
            return `
            <div class="accordion-item">
                <h2 class="accordion-header">
                    <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#history-${i}">
                        🕓 第 ${i + 1} 筆預約紀錄：${dateFormatted} / ${data.name}
                    </button>
                </h2>
                <div id="history-${i}" class="accordion-collapse collapse">
                    <div class="accordion-body">
    <pre class="text-light" style="white-space:pre-wrap">
    - 預約類型：${data.bookingType === "self" ? "本人預約" : "代訂他人"}
    📅 日期：${dateFormatted}
    ⏰ 時間：${data.time}
    👤 姓名：${data.name}
    📞 電話：${data.phone}
    👥 人數：${data.numPeople} 人
    
    ${persons}
    
    ⏳ 總時間：${getTotalAllTime(data)} 分鐘
    💰 總金額：$${getTotalAllPrice(data)} 元
    </pre>
                    </div>
                </div>
            </div>
            `;
        }).join("");
    
        accordionEl.html(html);
    
        // 工具函式
        function getTotalTime(p) {
            let t = 0;
            [...p.main, ...p.addon].forEach(name => {
                const found = BookingModule.mainServices[name] || BookingModule.addonServices[name];
                if (found) t += found.time;
            });
            return t;
        }
    
        function getTotalPrice(p) {
            let t = 0;
            [...p.main, ...p.addon].forEach(name => {
                const found = BookingModule.mainServices[name] || BookingModule.addonServices[name];
                if (found) t += found.price;
            });
            return t;
        }
    
        function getTotalAllTime(d) {
            return d.persons.reduce((sum, p) => sum + getTotalTime(p), 0);
        }
    
        function getTotalAllPrice(d) {
            return d.persons.reduce((sum, p) => sum + getTotalPrice(p), 0);
        }
    }
    

    return {
        save,
        load,
        clear,
        restoreToForm,
        renderAllHistoryUI
    };
})();
