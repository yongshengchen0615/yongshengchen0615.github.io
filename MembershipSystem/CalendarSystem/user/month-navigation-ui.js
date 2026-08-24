(() => {
  'use strict';

  const SWIPE_MIN_DISTANCE_PX = 48;
  const SWIPE_MAX_DURATION_MS = 700;
  const SWIPE_HORIZONTAL_DOMINANCE = 1.2;
  const WHEEL_TRIGGER_DISTANCE = 48;
  const WHEEL_COOLDOWN_MS = 420;
  const ANIMATION_CLEANUP_MS = 340;
  const ENTER_NEXT_CLASS = 'month-page-enter-next';
  const ENTER_PREV_CLASS = 'month-page-enter-prev';

  let calendarGrid;
  let monthTitle;
  let prevMonthButton;
  let nextMonthButton;
  let selectedDayModal;
  let touchGesture = null;
  let pendingDirection = '';
  let wheelAccumulator = 0;
  let wheelResetTimer = 0;
  let wheelLockedUntil = 0;
  let animationCleanupTimer = 0;

  window.addEventListener('DOMContentLoaded', () => {
    calendarGrid = document.getElementById('calendarGrid');
    monthTitle = document.getElementById('monthTitle');
    prevMonthButton = document.getElementById('prevMonth');
    nextMonthButton = document.getElementById('nextMonth');
    selectedDayModal = document.getElementById('selectedDayModal');

    if (!calendarGrid || !monthTitle || !prevMonthButton || !nextMonthButton || !selectedDayModal) return;

    prevMonthButton.addEventListener('click', () => setPendingDirection('prev'), true);
    nextMonthButton.addEventListener('click', () => setPendingDirection('next'), true);

    calendarGrid.addEventListener('touchstart', captureTouchStart, { capture: true, passive: true });
    calendarGrid.addEventListener('touchend', captureTouchEnd, { capture: true, passive: true });
    calendarGrid.addEventListener('touchcancel', resetTouchGesture, { capture: true, passive: true });
    calendarGrid.addEventListener('wheel', handleCalendarWheel, { passive: false });

    const monthObserver = new MutationObserver(() => {
      if (!pendingDirection) return;
      playMonthEnterAnimation(pendingDirection);
      pendingDirection = '';
    });
    monthObserver.observe(monthTitle, { childList: true, characterData: true, subtree: true });
  });

  function captureTouchStart(event) {
    if (isSelectedDayModalOpen() || event.touches.length !== 1) {
      resetTouchGesture();
      return;
    }

    const touch = event.touches[0];
    touchGesture = {
      startX: touch.clientX,
      startY: touch.clientY,
      startedAt: Date.now()
    };
  }

  function captureTouchEnd(event) {
    const gesture = touchGesture;
    resetTouchGesture();
    if (!gesture || isSelectedDayModalOpen() || event.changedTouches.length !== 1) return;

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    const duration = Date.now() - gesture.startedAt;

    if (duration > SWIPE_MAX_DURATION_MS) return;
    if (absX < SWIPE_MIN_DISTANCE_PX) return;
    if (absX <= absY * SWIPE_HORIZONTAL_DOMINANCE) return;

    setPendingDirection(deltaX < 0 ? 'next' : 'prev');
  }

  function resetTouchGesture() {
    touchGesture = null;
  }

  function handleCalendarWheel(event) {
    if (isSelectedDayModalOpen() || event.ctrlKey || event.metaKey) return;

    const delta = normalizedWheelDelta(event);
    if (!delta) return;

    event.preventDefault();

    if (Date.now() < wheelLockedUntil) return;

    wheelAccumulator += delta;
    window.clearTimeout(wheelResetTimer);
    wheelResetTimer = window.setTimeout(() => {
      wheelAccumulator = 0;
    }, 180);

    if (Math.abs(wheelAccumulator) < WHEEL_TRIGGER_DISTANCE) return;

    const direction = wheelAccumulator > 0 ? 'next' : 'prev';
    wheelAccumulator = 0;
    wheelLockedUntil = Date.now() + WHEEL_COOLDOWN_MS;
    setPendingDirection(direction);

    if (direction === 'next') nextMonthButton.click();
    else prevMonthButton.click();
  }

  function normalizedWheelDelta(event) {
    let delta = Number(event.deltaY) || 0;
    if (!delta) return 0;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= Math.max(window.innerHeight, 1);
    return delta;
  }

  function setPendingDirection(direction) {
    pendingDirection = direction === 'prev' ? 'prev' : 'next';
  }

  function playMonthEnterAnimation(direction) {
    const className = direction === 'prev' ? ENTER_PREV_CLASS : ENTER_NEXT_CLASS;
    const oppositeClass = direction === 'prev' ? ENTER_NEXT_CLASS : ENTER_PREV_CLASS;

    window.clearTimeout(animationCleanupTimer);
    calendarGrid.classList.remove(ENTER_NEXT_CLASS, ENTER_PREV_CLASS);
    monthTitle.classList.remove(ENTER_NEXT_CLASS, ENTER_PREV_CLASS);

    // Force a new animation frame even when the user changes months repeatedly.
    void calendarGrid.offsetWidth;

    calendarGrid.classList.add(className);
    monthTitle.classList.remove(oppositeClass);
    monthTitle.classList.add(className);

    animationCleanupTimer = window.setTimeout(() => {
      calendarGrid.classList.remove(ENTER_NEXT_CLASS, ENTER_PREV_CLASS);
      monthTitle.classList.remove(ENTER_NEXT_CLASS, ENTER_PREV_CLASS);
    }, ANIMATION_CLEANUP_MS);
  }

  function isSelectedDayModalOpen() {
    return !selectedDayModal.classList.contains('hidden');
  }
})();
