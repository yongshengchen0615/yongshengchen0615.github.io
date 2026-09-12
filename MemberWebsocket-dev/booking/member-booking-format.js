(() => {
  'use strict';

  let root = null;
  let observer = null;
  let confirmObserver = null;
  let scheduled = false;
  let confirmTimer = null;

  function scheduleFormat() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      formatAll();
    });
  }

  function scheduleConfirmationFormat() {
    if (confirmTimer !== null) window.clearTimeout(confirmTimer);
    confirmTimer = window.setTimeout(() => {
      confirmTimer = null;
      try {
        formatConfirmation();
      } catch (error) {
        console.warn('booking confirmation format failed', error);
      }
    }, 0);
  }

  function mount() {
    const form = document.getElementById('bookingForm');
    const confirmSummary = document.getElementById('bookingConfirmSummary');
    if (form && confirmSummary) {
      form.addEventListener('submit', scheduleConfirmationFormat);
      confirmObserver = new MutationObserver(scheduleConfirmationFormat);
      confirmObserver.observe(confirmSummary, { childList: true, subtree: true });
    }

    root = document.getElementById('bookingList');
    if (root) {
      observer = new MutationObserver(scheduleFormat);
      observer.observe(root, { childList: true, subtree: true });
      try {
        formatAll();
      } catch (error) {
        console.warn('member booking history format failed', error);
      }
    }
  }

  function formatAll() {
    if (!root) return;
    root.querySelectorAll('.booking-item').forEach((card) => {
      try {
        formatCard(card);
      } catch (error) {
        console.warn('member booking card format failed', error);
      }
    });
  }

  function directChild(parent, predicate) {
    return [...parent.children].find(predicate) || null;
  }

  function formatCard(card) {
    if (card.dataset.memberBookingFormat === '1') return;

    const top = directChild(card, (node) => node.classList?.contains('booking-item-top'));
    const titleBox = top ? directChild(top, (node) => node.tagName === 'DIV') : null;
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

    let serviceList = directChild(card, (node) => node.classList?.contains('booking-service-items'));
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

  function formatConfirmation() {
    const summary = document.getElementById('bookingConfirmSummary');
    if (!summary) return;

    const existingMain = directChild(summary, (node) => node.classList?.contains('booking-confirm-format-main'));
    if (!existingMain) {
      const timeNode = directChild(summary, (node) => node.classList?.contains('booking-confirm-time'));
      const list = directChild(summary, (node) => node.tagName === 'UL');
      const totalNode = directChild(summary, (node) => node.tagName === 'STRONG');

      if (timeNode && list && totalNode) {
        const time = parseConfirmationTime(timeNode.textContent);
        const total = parseConfirmationTotal(totalNode.textContent);
        if (time && total) {
          const warnings = [...summary.children].filter((node) => node.classList?.contains('form-message'));
          const note = [...summary.children].find((node) => (
            node.tagName === 'P'
            && node !== timeNode
            && !node.classList.contains('booking-confirm-contact')
          )) || null;
          const existingContact = directChild(summary, (node) => node.classList?.contains('booking-confirm-contact'));

          const main = document.createElement('div');
          main.className = 'booking-confirm-format-main';
          main.append(
            summaryRow('日期', time.date),
            summaryRow('時間', time.timeRange),
          );

          const servicesLabel = document.createElement('p');
          servicesLabel.className = 'member-booking-format-services-label';
          servicesLabel.textContent = '服務項目';
          main.appendChild(servicesLabel);

          const services = document.createElement('ul');
          services.className = 'booking-confirm-format-services';
          [...list.children].forEach((entry) => {
            const li = document.createElement('li');
            li.textContent = confirmationServiceText(entry.textContent);
            services.appendChild(li);
          });
          main.appendChild(services);

          const totals = document.createElement('div');
          totals.className = 'member-booking-format-totals';
          totals.append(
            summaryRow('總服務時間', `${total.totalMinutes} 分鐘`),
            summaryRow('總金額', total.totalAmount),
          );
          main.appendChild(totals);

          warnings.forEach((warning) => main.appendChild(warning));
          if (note) main.appendChild(note);

          summary.replaceChildren(main);
          if (existingContact) summary.appendChild(existingContact);
        }
      }
    }

    const contact = directChild(summary, (node) => (
      node.classList?.contains('booking-confirm-contact')
      && !node.classList.contains('booking-confirm-contact-formatted')
    ));
    if (contact) formatConfirmationContact(contact);
  }

  function formatConfirmationContact(contact) {
    const parsed = parseConfirmationContact(contact.textContent);
    if (!parsed) return;

    const block = document.createElement('div');
    block.className = 'booking-confirm-contact booking-confirm-contact-formatted';

    const heading = document.createElement('p');
    heading.className = 'member-booking-format-services-label booking-confirm-contact-title';
    heading.textContent = '預約資料';

    block.append(
      heading,
      summaryRow('稱呼', parsed.name),
      summaryRow('電話', `${parsed.phone}（${parsed.sourceLabel}）`),
    );
    contact.replaceWith(block);
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
    const datePattern = '(\\d{4}\\/\\d{1,2}\\/\\d{1,2}(?:（星期[日一二三四五六]）)?)';
    const match = new RegExp(`^${datePattern}\\s+(\\d{2}:\\d{2}–\\d{2}:\\d{2})\\s+·\\s+(.+)\\s+·\\s+(NT\\$[\\d,]+)$`).exec(text);
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

  function parseConfirmationTime(text) {
    const match = /^(\d{4}\/\d{1,2}\/\d{1,2}(?:（星期[日一二三四五六]）)?)\s+(\d{2}:\d{2}–\d{2}:\d{2})$/.exec(String(text || '').trim());
    return match ? { date: match[1], timeRange: match[2] } : null;
  }

  function parseConfirmationTotal(text) {
    const match = /預約共\s*(\d+)\s*分鐘\s*·\s*預約總額：\s*(NT\$[\d,]+)/.exec(String(text || ''));
    return match ? { totalMinutes: Math.max(0, Number(match[1] || 0)), totalAmount: match[2] } : null;
  }

  function confirmationServiceText(text) {
    const raw = String(text || '').trim();
    const price = raw.match(/NT\$[\d,]+/)?.[0] || 'NT$0';
    const title = raw.split('｜')[0].split('（')[0].trim() || '服務項目';
    return `${title} · ${price}`;
  }

  function parseConfirmationContact(text) {
    const match = /^預約資料：(.+?)｜(.+?)（(使用會員資料|本次重新填寫)）$/.exec(String(text || '').trim());
    return match ? { name: match[1], phone: match[2], sourceLabel: match[3] } : null;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();

  window.addEventListener('beforeunload', () => {
    observer?.disconnect();
    confirmObserver?.disconnect();
    if (confirmTimer !== null) window.clearTimeout(confirmTimer);
  });
})();
