const API_URL = 'https://servertest-r18o.onrender.com/api/events';
let editId = null;

async function loadEvents() {
  const res = await axios.get(API_URL);
  renderEventList(res.data);
}

async function saveEvent() {
  const title = document.getElementById('title')?.value.trim() || '';
  const description = document.getElementById('description')?.value.trim() || '';
  const theme = document.getElementById('theme')?.value || 'dark';

  const sectionElements = document.querySelectorAll('#sectionList > div');
  const sections = Array.from(sectionElements).map(el => {
    const type = el.querySelector('select')?.value || '';
    const titleInput = el.querySelector('input');
    const sectionTitle = titleInput?.value?.trim() || '';

    if (type === 'highlight') {
      const textarea = el.querySelector('textarea');
      const items = textarea ? textarea.value.trim().split('\n') : [];
      return { type, title: sectionTitle, items };
    
    } else if (type === 'card') {
      const cardRows = el.querySelectorAll('.card-row');
      const items = [];
      cardRows.forEach(row => {
        const inputs = row.querySelectorAll('input');
        const title = inputs[0]?.value.trim() || '(未命名)';
        const desc = inputs[1]?.value.trim() || '';
        items.push({ title, desc });
      });
      return { type, title: sectionTitle, items };
    
    } else if (type === 'text') {
      const textarea = el.querySelector('textarea');
      return {
        type,
        title: sectionTitle,
        content: textarea?.value?.trim() || ''
      };
    }
    

    return {}; // fallback
  });

  const buttonElements = document.querySelectorAll('#buttonList > div');
  const buttons = Array.from(buttonElements).map(el => ({
    text: el.querySelectorAll('input')[0]?.value || '',
    link: el.querySelectorAll('input')[1]?.value || ''
  }));

  const payload = { title, description, theme, sections, buttons };

  try {
    if (editId) {
      await axios.put(`${API_URL}/${editId}`, payload);
      editId = null;
    } else {
      await axios.post(API_URL, payload);
    }

    resetForm();
    loadEvents();
  } catch (error) {
    alert('❌ 儲存失敗，請檢查表單內容或後端狀態');
    console.error('Save error:', error);
  }
}


async function deleteEvent(id) {
  if (confirm('確定要刪除這個活動？')) {
    await axios.delete(`${API_URL}/${id}`);
    loadEvents();
  }
}

async function editEvent(id) {
  const res = await axios.get(API_URL);
  const item = res.data.find(e => e._id === id);
  if (!item) return;

  resetForm();
  document.getElementById('formTitle').textContent = '✏️ 編輯活動';
  document.getElementById('title').value = item.title;
  document.getElementById('description').value = item.description;
  document.getElementById('theme').value = item.theme;

  item.sections.forEach(s => addSection(s));
  item.buttons.forEach(b => addButton(b));

  editId = id;
}

function renderEventList(events) {
  const container = document.getElementById('eventList');
  container.innerHTML = '<h2 class="text-xl font-bold">📋 活動清單</h2>';

  if (events.length === 0) {
    container.innerHTML += '<p class="text-gray-500">尚無資料</p>';
    return;
  }

  events.forEach(event => {
    const div = document.createElement('div');
    div.className = 'bg-white p-4 shadow rounded flex justify-between items-center';

    div.innerHTML = `
     <div>
  <h3 class="font-semibold">${event.title}</h3>
  <p class="text-sm text-gray-600">${event.description}</p>
  <p class="text-xs text-gray-400">ID: <code class="bg-gray-100 px-1 rounded">${event._id}</code></p>
</div>

      <div class="space-x-2">
        <button onclick="editEvent('${event._id}')" class="bg-yellow-500 text-white px-3 py-1 rounded">編輯</button>
        <button onclick="deleteEvent('${event._id}')" class="bg-red-600 text-white px-3 py-1 rounded">刪除</button>
      </div>
    `;
    container.appendChild(div);
  });
}

function resetForm() {
  document.getElementById('title').value = '';
  document.getElementById('description').value = '';
  document.getElementById('theme').value = 'dark';
  document.getElementById('sectionList').innerHTML = '';
  document.getElementById('buttonList').innerHTML = '';
  document.getElementById('formTitle').textContent = '➕ 新增活動';
  editId = null;
}

function addSection(data = null) {
  const container = document.getElementById('sectionList');
  const wrapper = document.createElement('div');
  wrapper.className = 'bg-gray-50 p-3 rounded border space-y-2 relative';

  const deleteSectionBtn = document.createElement('button');
  deleteSectionBtn.textContent = '🗑️';
  deleteSectionBtn.title = '刪除此區塊';
  deleteSectionBtn.className = 'absolute top-2 right-2 text-sm bg-red-500 text-white px-2 py-1 rounded';
  deleteSectionBtn.onclick = () => {
    if (confirm('確定要刪除此區塊？')) {
      wrapper.remove();
    }
  };
  

  const typeSelect = document.createElement('select');
  typeSelect.className = 'border p-1 w-full';
  typeSelect.innerHTML = `
    <option value="highlight">重點清單</option>
    <option value="card">卡片內容</option>
    <option value="text">純文字</option>
  `;

  const titleInput = document.createElement('input');
  titleInput.className = 'border p-1 w-full';
  titleInput.placeholder = '區塊標題（如有）';

  const contentContainer = document.createElement('div');

  const createCardRow = (cardData = {}) => {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card-row flex gap-2 mb-2 items-center'; // ✅ 加 class
    

    const cardTitle = document.createElement('input');
    cardTitle.className = 'border p-1 w-5/12';
    cardTitle.placeholder = '卡片標題';
    cardTitle.value = cardData.title || '';

    const cardDesc = document.createElement('input');
    cardDesc.className = 'border p-1 w-5/12';
    cardDesc.placeholder = '卡片說明';
    cardDesc.value = cardData.desc || '';

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑️';
    deleteBtn.className = 'bg-red-500 text-white px-2 py-1 rounded';
    deleteBtn.onclick = () => {
      if (confirm('確定刪除此卡片？')) {
        cardDiv.remove();
      }
    };

    cardDiv.appendChild(cardTitle);
    cardDiv.appendChild(cardDesc);
    cardDiv.appendChild(deleteBtn);
    contentContainer.appendChild(cardDiv);
  };

  const addCardBtn = document.createElement('button');
  addCardBtn.textContent = '+ 新增卡片';
  addCardBtn.type = 'button';
  addCardBtn.className = 'bg-blue-500 text-white px-3 py-1 rounded';
  addCardBtn.onclick = () => createCardRow();

  const highlightTextarea = document.createElement('textarea');
  highlightTextarea.className = 'border p-1 w-full';
  highlightTextarea.placeholder = '輸入內容（每行一項）';

  function renderContentFields() {
    contentContainer.innerHTML = '';

    if (typeSelect.value === 'card') {
      contentContainer.appendChild(addCardBtn);

      if (data && data.type === 'card' && Array.isArray(data.items)) {
        data.items.forEach(i => createCardRow(i));
      }
    } else if (typeSelect.value === 'highlight') {
      highlightTextarea.value = data?.items?.join('\n') || '';
      contentContainer.appendChild(highlightTextarea);
    } else if (typeSelect.value === 'text') {
      highlightTextarea.value = data?.content || '';
      contentContainer.appendChild(highlightTextarea);
    }
  }

  // 初始值設定
  if (data) {
    typeSelect.value = data.type;
    titleInput.value = data.title || '';
  }

  typeSelect.addEventListener('change', () => {
    data = null; // ⚠️ 切換 type 後不再保留舊資料
    renderContentFields();
  });

  renderContentFields();

  wrapper.appendChild(typeSelect);
  wrapper.appendChild(titleInput);
  wrapper.appendChild(contentContainer);
  wrapper.appendChild(deleteSectionBtn); // ✅ 要加這行
  container.appendChild(wrapper);
}



function addButton(data = null) {
  const container = document.getElementById('buttonList');
  const wrapper = document.createElement('div');
  wrapper.className = 'bg-gray-50 p-3 rounded border flex gap-2 items-center';

  const textInput = document.createElement('input');
  textInput.className = 'border p-1 w-1/2';
  textInput.placeholder = '按鈕文字';
  textInput.value = data?.text || '';

  const linkInput = document.createElement('input');
  linkInput.className = 'border p-1 w-1/2';
  linkInput.placeholder = '按鈕連結';
  linkInput.value = data?.link || '';

  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = '🗑️';
  deleteBtn.className = 'bg-red-500 text-white px-2 py-1 rounded';
  deleteBtn.onclick = () => {
    if (confirm('確定要刪除此按鈕？')) {
      wrapper.remove();
    }
  };

  wrapper.appendChild(textInput);
  wrapper.appendChild(linkInput);
  wrapper.appendChild(deleteBtn); // ✅ 正確加入刪除鍵
  container.appendChild(wrapper);
}



// 初始化
loadEvents();
