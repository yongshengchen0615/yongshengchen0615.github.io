$(function () {
  const $container = $('#event-container');
  const $spinner = $('#loading-spinner');
  const defaultKey = window.defaultEventKey || Object.keys(window.eventList)[0];

  renderEventByKey(defaultKey);

  function renderEventByKey(key) {
    const data = window.eventList[key];
    if (!data) return;

    // 🎨 清除舊主題 class 並加上新主題
    document.body.className = document.body.className
      .split(' ')
      .filter(c => !c.startsWith('theme-'))
      .join(' ');
    if (data.theme && data.theme !== 'default') {
      document.body.classList.add(`theme-${data.theme}`);
    }

    // 🌀 Loading 畫面
    $spinner.show();
    $container.addClass('d-none');

    // 🖼 標題與描述
    document.title = data.title;
    $('#event-title').text(data.title);
    $('#event-desc').text(data.description);

    // 📦 渲染區塊內容
    const html = data.sections.map(renderSectionContent).join('');
    $('#event-details').html(html);

    // 🔘 按鈕內容
    const $buttonContainer = $('#event-buttons').empty();
    if (Array.isArray(data.buttons)) {
      data.buttons.forEach(btn => {
        const $btn = $('<a></a>')
          .attr('href', btn.link)
          .attr('target', '_blank')
          .addClass('btn btn-cta component-button me-2 mb-2')
          .text(btn.text);
        $buttonContainer.append($btn);
      });
    }

    // ✅ 顯示內容
    setTimeout(() => {
      $spinner.hide();
      $container.removeClass('d-none');
    }, 300);
  }

  // 🎯 區塊轉派器
  function renderSectionContent(section) {
    switch (section.type) {
      case 'highlight': return renderHighlightSection(section);
      case 'card': return renderCardSection(section);
      case 'text': return renderTextSection(section);
      default: return '';
    }
  }

  function renderHighlightSection(section) {
    return `<div class="component-section mt-4">
      <h5 class="fw-bold">${section.title}</h5>
      ${section.items.map(item => `<div class="alert alert-warning">${item}</div>`).join('')}
    </div>`;
  }

  function renderCardSection(section) {
    return `<div class="component-section mt-4">
      <h5 class="fw-bold mb-2">${section.title}</h5>
      <div class="d-flex flex-column">
        ${section.items.map(item => `
          <div class="component-card w-100">
            <div class="card-body">
              <h6 class="card-title">${item.title}</h6>
              <p class="card-text">${item.desc}</p>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
  }
  
  
  

  function renderTextSection(section) {
    return `<div class="component-section mt-4">
      <p>${section.content}</p>
    </div>`;
  }
});
