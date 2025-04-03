$(function () {
  const $container = $('#event-container');
  const $spinner = $('#loading-spinner');

  const defaultKey = window.defaultEventKey || Object.keys(window.eventList)[0];

  // 主題對應設定
  const themeMap = {
    birthday: 'cute',
    luckyDraw: 'cute',
    spring: 'default'
  };

  const currentTheme = themeMap[defaultKey] || 'default';
  document.body.className = document.body.className
    .split(' ')
    .filter(c => !c.startsWith('theme-'))
    .join(' ');
  if (currentTheme !== 'default') {
    document.body.classList.add(`theme-${currentTheme}`);
  }

  renderEvent(defaultKey);

  function renderEvent(key) {
    const data = window.eventList[key];
    if (!data) return;

    $spinner.show();
    $container.addClass('d-none');

    document.title = data.title;
    $('#event-title').text(data.title);
    $('#event-desc').text(data.description);

    const html = data.sections.map(renderSection).join('');
    $('#event-details').html(html);

    const $buttonContainer = $('#event-buttons');
    $buttonContainer.empty();
    if (Array.isArray(data.buttons)) {
      data.buttons.forEach(btn => {
        const $btn = $('<a></a>')
          .attr('href', btn.link)
          .attr('target', '_blank')
          .addClass('btn btn-success me-2 mb-2')
          .text(btn.text);
        $buttonContainer.append($btn);
      });
    }

    setTimeout(() => {
      $spinner.hide();
      $container.removeClass('d-none');
    }, 300);
  }

  function renderSection(section) {
    switch (section.type) {
      case 'highlight': return `<div class="mt-4">
        <h5 class="fw-bold">${section.title}</h5>
        ${section.items.map(item => `<div class="alert alert-warning">${item}</div>`).join('')}
      </div>`;
      case 'card': return `<div class="mt-4">
        <h5 class="fw-bold">${section.title}</h5>
        <div class="row">
        ${section.items.map(item => `<div class="col-md-4">
          <div class="card mb-3 h-100"><div class="card-body">
            <h6 class="card-title">${item.title}</h6>
            <p class="card-text">${item.desc}</p>
          </div></div></div>`).join('')}
        </div></div>`;
      case 'text': return `<div class="mt-4"><p>${section.content}</p></div>`;
      default: return '';
    }
  }
});
