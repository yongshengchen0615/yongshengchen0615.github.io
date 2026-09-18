(() => {
  'use strict';

  let root = null;
  let observer = null;
  let confirmObserver = null;
  let selectionSummaryObserver = null;
  let servicePickerObserver = null;
  let selectedServiceObserver = null;
  let participantCardObserver = null;
  let scheduled = false;
  let serviceGroupingScheduled = false;
  let confirmTimer = null;
  let selectionSummaryTimer = null;

  function scheduleFormat() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      formatAll();
    });
  }

  function scheduleServiceGrouping() {
    if (serviceGroupingScheduled) return;
    serviceGroupingScheduled = true;
    window.requestAnimationFrame(() => {
      serviceGroupingScheduled = false;
      try {
        groupBookingServices();
      } catch (error) {
        console.warn('booking service grouping failed', error);
      }
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

  function scheduleSelectionSummaryFormat() {
    if (selectionSummaryTimer !== null) window.clearTimeout(selectionSummaryTimer);
    selectionSummaryTimer = window.setTimeout(() => {
      selectionSummaryTimer = null;
      try {
        formatSelectionSummary();
      } catch (error) {
        console.warn('booking selection summary format failed', error);
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

    const selectionSummary = document.getElementById('selectionSummary');
    if (selectionSummary) {
      selectionSummaryObserver = new MutationObserver(scheduleSelectionSummaryFormat);
      selectionSummaryObserver.observe(selectionSummary, { childList: true, subtree: true, characterData: true });
      scheduleSelectionSummaryFormat();
    }

    mountServiceGrouping();

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

  function mountServiceGrouping() {
    const servicePicker = document.getElementById('servicePicker');
    const selectedServiceList = document.getElementById('selectedServiceList');
    const participantCardList = document.getElementById('participantCardList');

    if (servicePicker) {
      servicePickerObserver = new MutationObserver(scheduleServiceGrouping);
      servicePickerObserver.observe(servicePicker, { childList: true });
    }
    if (selectedServiceList) {
      selectedServiceObserver = new MutationObserver(scheduleServiceGrouping);
      selectedServiceObserver.observe(selectedServiceList, { childList: true });
    }
    if (participantCardList) {
      participantCardObserver = new MutationObserver(scheduleServiceGrouping);
      participantCardObserver.observe(participantCardList, { childList: true, subtree: true });
    }
    scheduleServiceGrouping();
  }

  function groupBookingServices() {
    const pickerContainers = new Set([
      document.getElementById('servicePicker'),
      ...document.querySelectorAll('#participantCardList .service-picker-fieldset > .service-picker'),
    ].filter(Boolean));
    const selectedContainers = new Set([
      document.getElementById('selectedServiceList'),
      ...document.querySelectorAll('#participantCardList .selected-service-fieldset > .selected-service-list'),
    ].filter(Boolean));

    pickerContainers.forEach((container) => groupServiceContainer(container, '.service-choice', true));
    selectedContainers.forEach((container) => groupServiceContainer(container, '.selected-service-item', false));
    decorateServiceTypeGroups();
  }

  function groupServiceContainer(container, rowSelector, hideSelected) {
    if (!container) return;

    const directRows = [...container.children].filter((node) => node.matches?.(rowSelector));
    if (!directRows.length) return;

    const visibleRows = directRows.filter((row) => {
      if (hideSelected && row.classList.contains('selected')) {
        row.remove();
        return false;
      }
      return true;
    });

    if (!visibleRows.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state compact';
      const message = document.createElement('strong');
      message.textContent = '可選項目已全部加入目前選擇';
      empty.appendChild(message);
      container.replaceChildren(empty);
      return;
    }

    const groups = new Map();
    for (const row of visibleRows) {
      const typeLabel = serviceTypeFromRow(row);
      const key = typeLabel.toLocaleLowerCase('zh-Hant-TW');
      let group = groups.get(key);
      if (!group) {
        group = { label: typeLabel, rows: [] };
        groups.set(key, group);
      }
      group.rows.push(row);
      stripTypeFromMeta(row);
    }

    const fragment = document.createDocumentFragment();
    for (const group of groups.values()) {
      const section = document.createElement('section');
      section.className = 'service-info service-type-group';
      section.setAttribute('aria-label', `${group.label}服務`);
      applyServiceTypeColor(section, group.label);

      const heading = document.createElement('strong');
      heading.textContent = `${group.label}（${group.rows.length}）`;

      const list = document.createElement('div');
      list.className = rowSelector === '.service-choice' ? 'service-picker' : 'selected-service-list';
      group.rows.forEach((row) => list.appendChild(row));

      section.append(heading, list);
      fragment.appendChild(section);
    }
    container.replaceChildren(fragment);
  }

  function decorateServiceTypeGroups() {
    document.querySelectorAll(
      '#participantCardList .service-picker > .service-info, #participantCardList .selected-service-list > .service-info',
    ).forEach((section) => {
      const heading = [...section.children].find((node) => node.tagName === 'STRONG');
      const label = String(heading?.textContent || '')
        .replace(/（\d+）\s*$/u, '')
        .trim() || '其他';
      section.classList.add('service-type-group');
      applyServiceTypeColor(section, label);
    });
  }

  function applyServiceTypeColor(section, label) {
    const slot = window.BookingServiceTypeColor.slot(label);
    section.dataset.serviceTypeColor = String(slot);
    [...section.classList]
      .filter((name) => name.startsWith('service-type-color-'))
      .forEach((name) => section.classList.remove(name));
    section.classList.add(`service-type-color-${slot}`);
  }

  function serviceTypeFromRow(row) {
    const meta = String(row.querySelector('small')?.textContent || '').trim();
    const match = /^類型\s+(.+?)\s+·\s+服務\s+/u.exec(meta);
    return String(match?.[1] || '其他').trim() || '其他';
  }

  function stripTypeFromMeta(row) {
    const meta = row.querySelector('small');
    if (!meta) return;
    meta.textContent = String(meta.textContent || '').replace(/^類型\s+.+?\s+·\s+(?=服務\s+)/u, '');
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

  function formatSelectionSummary() {
    const summary = document.getElementById('selectionSummary');
    if (!summary || summary.classList.contains('hidden')) return;

    const parsed = parseSelectionSummary(summary.textContent);
    if (!parsed) return;

    const services = [...document.querySelectorAll('#selectedServiceList .selected-service-item')]
      .map((item) => {
        const title = String(item.querySelector('strong')?.textContent || '').trim();
        const meta = String(item.querySelector('small')?.textContent || '');
        const duration = /服務\s*(\d+)\s*分鐘/.exec(meta)?.[1] || '';
        return title ? (duration ? `${title}（${duration}分鐘）` : title) : '';
      })
      .filter(Boolean);
    if (!services.length) return;

    const lines = [
      `服務項目：${services.join('、')}`,
      `總額：NT ${parsed.totalAmount.replace(/^NT\$/, '')}`,
      `總服務時間：${parsed.totalMinutes}分鐘`,
      `最早可預約 ${parsed.minimumDate}`,
    ];

    const fragment = document.createDocumentFragment();
    lines.forEach((line, index) => {
      if (index > 0) fragment.appendChild(document.createElement('br'));
      fragment.appendChild(document.createTextNode(line));
    });
    summary.replaceChildren(fragment);
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

  function parseSelectionSummary(text) {
    const match = /預約共\s*(\d+)\s*分鐘\s*·\s*總額\s*(NT\$[\d,]+)\s*·\s*最早可預約\s*(.+)$/.exec(String(text || '').trim());
    return match ? {
      totalMinutes: Math.max(0, Number(match[1] || 0)),
      totalAmount: match[2],
      minimumDate: match[3],
    } : null;
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
    selectionSummaryObserver?.disconnect();
    servicePickerObserver?.disconnect();
    selectedServiceObserver?.disconnect();
    participantCardObserver?.disconnect();
    if (confirmTimer !== null) window.clearTimeout(confirmTimer);
    if (selectionSummaryTimer !== null) window.clearTimeout(selectionSummaryTimer);
  });
})();
