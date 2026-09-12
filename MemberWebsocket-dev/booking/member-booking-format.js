(() => {
  'use strict';

  let root = null;
  let observer = null;
  let scheduled = false;

  function scheduleFormat() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      formatAll();
    });
  }

  function mount() {
    root = document.getElementById('bookingList');
    if (!root) return;
    observer = new MutationObserver(scheduleFormat);
    observer.observe(root, { childList: true, subtree: true });
    formatAll();
  }

  function formatAll() {
    if (!root) return;
    root.querySelectorAll('.booking-item').forEach(formatCard);
  }

  function formatCard(card) {
    if (card.dataset.memberBookingFormat === '1') return;

    const top = card.querySelector(':scope > .booking-item-top');
    const titleBox = top?.querySelector(':scope > div');
    const rawMeta = String(titleBox?.querySelector('span')?.textContent || '').trim();
    if (!top || !titleBox || !rawMeta) return;

    const parsed = parseBookingMeta(rawMeta);
    if (!parsed) return;

    const summary = document.createElement('div');
    summary.className = 'member-booking-format-summary';
    summary.append(
      summaryRow('日期', parsed.date),
      summaryRow('時間', parsed.timeRange),
    );
    titleBox.replaceChildren(summary);

    let serviceList = card.querySelector(':scope > .booking-service-items');
    if (serviceList) {
      [...serviceList.children].forEach((entry) => {
        if (String(entry.textContent || '').trim().startsWith('店內服務 ')) entry.remove();
      });
    } else {
      serviceList = document.createElement('ul');
      serviceList.className = 'booking-service-items';
    }

    if (!serviceList.children.length) {
      const empty = document.createElement('li');
      empty.textContent = '尚無會員服務項目';
      serviceList.appendChild(empty);
    }

    const servicesLabel = document.createElement('p');
    servicesLabel.className = 'member-booking-format-services-label';
    servicesLabel.textContent = '服務項目';

    const totals = document.createElement('div');
    totals.className = 'member-booking-format-totals';
    totals.append(
      summaryRow('總服務時間', `${parsed.totalMinutes} 分鐘`),
      summaryRow('總金額', parsed.totalAmount),
    );

    top.after(servicesLabel);
    servicesLabel.after(serviceList);
    serviceList.after(totals);

    card.classList.add('member-booking-format-card');
    card.dataset.memberBookingFormat = '1';
  }

  function summaryRow(label, value) {
    const row = document.createElement('p');
    row.className = 'member-booking-format-row';
    const key = document.createElement('span');
    key.className = 'member-booking-format-label';
    key.textContent = `${label}：`;
    const content = document.createElement('strong');
    content.className = 'member-booking-format-value';
    content.textContent = value;
    row.append(key, content);
    return row;
  }

  function parseBookingMeta(text) {
    const match = /^(\d{4}\/\d{1,2}\/\d{1,2})\s+(\d{2}:\d{2}–\d{2}:\d{2})\s+·\s+(.+)\s+·\s+(NT\$[\d,]+)$/.exec(text);
    if (!match) return null;

    const durationText = match[3];
    const durationMatch = /(?:目前項目共\s*)?(\d+)\s*分鐘/.exec(durationText);
    if (!durationMatch) return null;

    return {
      date: match[1],
      timeRange: match[2],
      totalMinutes: Math.max(0, Number(durationMatch[1] || 0)),
      totalAmount: match[4],
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();

  window.addEventListener('beforeunload', () => observer?.disconnect());
})();
