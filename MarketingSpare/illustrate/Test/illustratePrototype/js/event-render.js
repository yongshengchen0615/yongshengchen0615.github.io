$(function () {
  const $container = $('#event-container');
  const $spinner = $('#loading-spinner');
  const $title = $('#event-title');
  const $desc = $('#event-desc');
  const $details = $('#event-details');
  const $buttons = $('#event-buttons');
  const API_URL = 'https://servertest-r18o.onrender.com/api/events';

  const eventIdFromURL = getURLParameter('event');

  fetchEventData();

  function getURLParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
  }

  async function fetchEventData() {
    try {
      $spinner.show();
      $container.addClass('d-none');

      const res = await fetch(API_URL);
      const dataList = await res.json();

      if (!Array.isArray(dataList) || dataList.length === 0) {
        alert('❌ 後台尚無活動資料');
        return;
      }

      let eventData;

      if (eventIdFromURL) {
        eventData = dataList.find(item => item._id === eventIdFromURL);
        if (!eventData) {
          alert('❌ 找不到對應活動 ID');
          return;
        }
      } else {
        eventData = dataList[0]; // 預設顯示第一筆
      }

      renderEvent(eventData);
    } catch (err) {
      console.error('❌ 讀取資料失敗：', err);
      alert('❌ 後台 API 載入錯誤');
    }
  }

  function renderEvent(data) {
    // ✅ 載入主題樣式
    const themeStyle = document.getElementById('theme-style');
    if (data.theme && data.theme !== 'default') {
      themeStyle.href = `assets/theme-${data.theme}.css`;
    } else {
      themeStyle.href = '';
    }

    // ✅ 清除舊主題 class 並套用新主題
    document.body.className = document.body.className
      .split(' ')
      .filter(c => !c.startsWith('theme-'))
      .join(' ');

    if (data.theme && data.theme !== 'default') {
      document.body.classList.add(`theme-${data.theme}`);
    }

    // ✅ 標題與內容
    document.title = data.title;
    $title.text(data.title);
    $desc.text(data.description);

    // ✅ 渲染 sections
    const html = data.sections.map(renderSectionContent).join('');
    $details.html(html);

    // ✅ 渲染按鈕
    $buttons.empty();
    if (Array.isArray(data.buttons)) {
      data.buttons.forEach(btn => {
        const $btn = $('<a></a>')
          .attr('href', btn.link)
          .attr('target', '_blank')
          .addClass('btn btn-cta component-button me-2 mb-2')
          .text(btn.text);
        $buttons.append($btn);
      });
    }

    // ✅ 顯示頁面
    setTimeout(() => {
      $spinner.hide();
      $container.removeClass('d-none');
    }, 300);
  }

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
              <p class="card-text">${item.desc || ''}</p>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  function renderTextSection(section) {
    return `<div class="component-section mt-4">
      ${section.title ? `<h5 class="fw-bold mb-2">${section.title}</h5>` : ''}
      <p>${section.content}</p>
    </div>`;
  }
  
});
