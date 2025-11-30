// 當頁面載入完成後執行
document.addEventListener('DOMContentLoaded', function() {
    renderEventPage();
});

// 渲染整個活動頁面
function renderEventPage() {
    // 渲染標題區塊
    renderHero();
    
    // 渲染活動時間
    renderTime();
    
    // 渲染活動說明
    renderDescription();
    
    // 渲染參加方式
    renderParticipationSteps();
    
    // 渲染注意事項
    renderNotices();
    
    // 渲染獎品資訊
    renderPrizes();
    
    // 渲染聯絡資訊
    renderContact();
    
    // 渲染頁尾
    renderFooter();
}

// 渲染標題區塊
function renderHero() {
    document.getElementById('eventTitle').textContent = eventConfig.title;
    document.getElementById('eventSubtitle').textContent = eventConfig.subtitle;
    document.getElementById('eventBadge').textContent = eventConfig.badge;
}

// 渲染活動時間
function renderTime() {
    document.getElementById('eventTime').textContent = eventConfig.time;
}

// 渲染活動說明
function renderDescription() {
    document.getElementById('eventDescription').innerHTML = eventConfig.description;
}

// 渲染參加方式
function renderParticipationSteps() {
    const container = document.getElementById('participationSteps');
    container.innerHTML = '';
    
    eventConfig.participationSteps.forEach(step => {
        const stepCard = document.createElement('div');
        stepCard.className = 'step-card';
        
        stepCard.innerHTML = `
            <div class="step-number">${step.step}</div>
            <h3>${step.title}</h3>
            <p>${step.description}</p>
        `;
        
        container.appendChild(stepCard);
    });
}

// 渲染注意事項
function renderNotices() {
    const container = document.getElementById('noticeList');
    container.innerHTML = '';
    
    eventConfig.notices.forEach(notice => {
        const noticeItem = document.createElement('div');
        noticeItem.className = 'notice-item';
        noticeItem.textContent = notice;
        
        container.appendChild(noticeItem);
    });
}

// 渲染獎品資訊
function renderPrizes() {
    const container = document.getElementById('prizeGrid');
    container.innerHTML = '';
    
    // 如果沒有獎品資訊,隱藏整個區塊
    if (!eventConfig.prizes || eventConfig.prizes.length === 0) {
        document.getElementById('prizeSection').style.display = 'none';
        return;
    }
    
    eventConfig.prizes.forEach(prize => {
        const prizeCard = document.createElement('div');
        prizeCard.className = 'prize-card';
        
        prizeCard.innerHTML = `
            <div class="prize-name" style="background: ${prize.color};">
                ${prize.name}
            </div>
            <div class="prize-item">${prize.item}</div>
            <div class="prize-quantity">名額: ${prize.quantity}</div>
        `;
        
        // 設置卡片懸停效果背景色
        prizeCard.style.setProperty('--prize-color', prize.color);
        prizeCard.querySelector('.prize-card::before')?.style.setProperty('background', prize.color);
        
        container.appendChild(prizeCard);
    });
}

// 渲染聯絡資訊
function renderContact() {
    const container = document.getElementById('contactInfo');
    container.innerHTML = '';
    
    const contactItems = [
        { label: '服務電話', value: eventConfig.contact.phone },
        { label: 'Email', value: eventConfig.contact.email },
        { label: 'LINE ID', value: eventConfig.contact.line },
        { label: '服務時間', value: eventConfig.contact.hours }
    ];
    
    contactItems.forEach(item => {
        const contactItem = document.createElement('div');
        contactItem.className = 'contact-item';
        
        contactItem.innerHTML = `
            <strong>${item.label}:</strong>
            <span>${item.value}</span>
        `;
        
        container.appendChild(contactItem);
    });
}

// 渲染頁尾
function renderFooter() {
    document.getElementById('footerText').textContent = eventConfig.footer;
}

// 平滑滾動效果(如果需要添加錨點連結)
function smoothScroll(target) {
    const element = document.querySelector(target);
    if (element) {
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }
}

// 添加進場動畫
function addScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, {
        threshold: 0.1
    });
    
    // 觀察所有 section
    document.querySelectorAll('section').forEach(section => {
        section.style.opacity = '0';
        section.style.transform = 'translateY(20px)';
        section.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(section);
    });
}

// 初始化動畫
setTimeout(addScrollAnimations, 100);
