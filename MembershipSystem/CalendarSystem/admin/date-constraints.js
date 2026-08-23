(() => {
  'use strict';

  const BUSINESS_TIME_ZONE = 'Asia/Taipei';

  window.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('itemForm');
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    const formMessage = document.getElementById('formMessage');

    if (!form || !startDate || !endDate || !formMessage) return;

    const syncConstraints = () => {
      const today = businessTodayKey();
      startDate.min = today;

      const start = validDateKey(startDate.value) ? startDate.value : '';
      endDate.min = start && start > today ? start : today;

      startDate.setCustomValidity(
        start && start < today ? '開始日期不能設定已經過去的日期。' : ''
      );

      let endMessage = '';
      if (validDateKey(endDate.value) && endDate.value < today) {
        endMessage = '結束日期不能設定已經過去的日期。';
      } else if (start && validDateKey(endDate.value) && endDate.value < start) {
        endMessage = '結束日期不得早於開始日期。';
      }
      endDate.setCustomValidity(endMessage);
    };

    const blockInvalidSubmit = (event) => {
      syncConstraints();

      const invalidField = !startDate.checkValidity()
        ? startDate
        : (!endDate.checkValidity() ? endDate : null);
      if (!invalidField) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      formMessage.textContent = invalidField.validationMessage || '日期設定不合法。';
      formMessage.classList.remove('hidden');
      invalidField.focus();
    };

    startDate.addEventListener('input', syncConstraints);
    startDate.addEventListener('change', syncConstraints);
    endDate.addEventListener('input', syncConstraints);
    endDate.addEventListener('change', syncConstraints);
    form.addEventListener('submit', blockInvalidSubmit, true);

    document.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('#calendarGrid, #dayModal')) return;
      window.setTimeout(syncConstraints, 0);
    });

    syncConstraints();
  });

  function businessTodayKey() {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: BUSINESS_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());

    const values = {};
    parts.forEach((part) => {
      if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
        values[part.type] = part.value;
      }
    });
    return `${values.year}-${values.month}-${values.day}`;
  }

  function validDateKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  }
})();
