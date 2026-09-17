(() => {
  'use strict';

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();

  function bind() {
    const form = document.getElementById('bookingForm');
    if (!form) return;
    form.addEventListener('submit', () => window.setTimeout(renderDetailedConfirmation, 0));
  }

  function renderDetailedConfirmation() {
    const root = document.getElementById('bookingConfirmSummary');
    const participantCards = [...document.querySelectorAll('#participantCardList .participant-card')];
    if (!root || !participantCards.length) return;

    const existingTime = String(root.querySelector('.booking-confirm-time')?.textContent || selectedDateTimeText()).trim();
    const storeMinutes = detectStoreMinutes();
    const participants = participantCards.map((card, index) => participantFromCard(card, index, storeMinutes));
    if (!participants.length || participants.some((participant) => participant.items.length === 0)) return;

    const overallMinutes = participants.reduce((max, participant) => Math.max(max, participant.totalMinutes), 0);
    const overallAmount = participants.reduce((sum, participant) => sum + participant.amount, 0);

    const box = document.createElement('div');
    box.className = 'group-confirm-summary booking-detailed-confirmation';
    box.dataset.groupConfirm = 'true';

    const heading = document.createElement('strong');
    heading.textContent = `本次預約 ${participants.length} 位`;
    box.appendChild(heading);

    if (existingTime) {
      const time = document.createElement('p');
      time.className = 'booking-confirm-time';
      time.textContent = existingTime;
      box.appendChild(time);
    }

    participants.forEach((participant) => {
      const card = document.createElement('div');
      card.className = 'group-confirm-participant';
      const title = document.createElement('strong');
      title.textContent = participant.label;
      const items = document.createElement('p');
      items.textContent = `預約項目：${participant.items.map((item) => `${item.title}（${item.durationMinutes}分鐘）`).join('、')}`;
      const technician = document.createElement('p');
      technician.textContent = `預約技師：${participant.technician}`;
      const duration = document.createElement('p');
      duration.textContent = `個別總時間：${participant.totalMinutes} 分鐘${storeMinutes > 0 ? `（含店內服務 ${storeMinutes} 分鐘）` : ''}`;
      const amount = document.createElement('p');
      amount.textContent = `個別金額：${formatMoney(participant.amount)}`;
      card.append(title, items, technician, duration, amount);
      box.appendChild(card);
    });

    const totals = document.createElement('div');
    totals.className = 'group-confirm-participant booking-confirm-overall';
    const duration = document.createElement('strong');
    duration.textContent = `整體總服務時間：${overallMinutes} 分鐘`;
    const durationNote = document.createElement('p');
    durationNote.textContent = '以所有預約人中最長的個別總時間計算。';
    const amount = document.createElement('p');
    amount.textContent = `預約總金額：${formatMoney(overallAmount)}`;
    totals.append(duration, durationNote, amount);
    box.appendChild(totals);

    const contact = contactSummary();
    if (contact) {
      const contactBox = document.createElement('div');
      contactBox.className = 'group-confirm-participant booking-confirm-contact';
      const title = document.createElement('strong');
      title.textContent = '預約聯絡資料';
      const value = document.createElement('p');
      value.textContent = contact;
      contactBox.append(title, value);
      box.appendChild(contactBox);
    }

    const noteValue = String(document.getElementById('memberNote')?.value || '').trim();
    if (noteValue) {
      const note = document.createElement('p');
      note.textContent = `備註：${noteValue}`;
      box.appendChild(note);
    }

    root.replaceChildren(box);
  }

  function participantFromCard(card, index, storeMinutes) {
    const technician = String(card.querySelector('.participant-technician-field select option:checked')?.textContent || '現場安排').trim();
    const rows = [...card.querySelectorAll('.selected-service-list .selected-service-item')];
    const items = rows.map((row) => {
      const title = String(row.querySelector('strong')?.textContent || '預約項目').trim();
      const meta = String(row.querySelector('small')?.textContent || '');
      const durationMatch = /(?:服務\s*)?(\d+)\s*分鐘/.exec(meta);
      const amountMatch = /NT\$?\s*([\d,]+)/i.exec(meta);
      return {
        title,
        durationMinutes: Math.max(0, Number(durationMatch?.[1] || 0)),
        amount: Math.max(0, Number(String(amountMatch?.[1] || '0').replace(/,/g, ''))),
      };
    });
    const serviceMinutes = items.reduce((sum, item) => sum + item.durationMinutes, 0);
    const amount = items.reduce((sum, item) => sum + item.amount, 0);
    return {
      label: participantLabel(index),
      technician: technician || '現場安排',
      items,
      amount,
      totalMinutes: items.length ? serviceMinutes + storeMinutes : 0,
    };
  }

  function selectedDateTimeText() {
    const dateText = String(document.getElementById('selectedDateSummary')?.textContent || '').trim();
    const slotText = String(document.querySelector('#slotGrid .slot-button.selected')?.textContent || '').trim();
    return [dateText, slotText].filter(Boolean).join(' ');
  }

  function detectStoreMinutes() {
    const text = String(document.getElementById('selectionSummary')?.textContent || '');
    const match = /含店內服務\s*(\d+)\s*分鐘/.exec(text);
    return Math.max(0, Number(match?.[1] || 0));
  }

  function contactSummary() {
    const source = String(document.querySelector('input[name="bookingContactSource"]:checked')?.value || 'member');
    if (source !== 'custom') {
      const member = String(document.getElementById('bookingMemberContactSummary')?.textContent || '').trim();
      return member ? `使用會員資料：${member}` : '使用會員資料';
    }
    const surname = String(document.getElementById('bookingContactSurname')?.value || '').trim();
    const salutationValue = String(document.getElementById('bookingContactSalutation')?.value || '').trim();
    const salutation = salutationValue === 'mr' ? '先生' : salutationValue === 'ms' ? '小姐' : '';
    const phone = String(document.getElementById('bookingContactPhone')?.value || '').trim();
    return `本次重新填寫：${surname}${salutation}${phone ? ` · ${phone}` : ''}`;
  }

  function participantLabel(index) {
    const names = ['第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九', '第十'];
    return `${names[index] || `第 ${index + 1} `}位預約`;
  }

  function formatMoney(value) {
    return `NT ${Number(value || 0).toLocaleString('zh-Hant-TW')}`;
  }
})();