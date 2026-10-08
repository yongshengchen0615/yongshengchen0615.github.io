(() => {
  'use strict';
  let current = null, cameraStop = null;
  const openers = new WeakMap();
  function release(stop) {
    if (cameraStop === stop) cameraStop = null;
  }
  function acquire(stop) {
    if (cameraStop && cameraStop !== stop) cameraStop();
    cameraStop = stop;
  }
  function close(element) {
    if (!element) return;
    element.hidden = true;
    element.classList.add('hidden');
    if (current?.element === element) {
      const callback = current.onClose;
      current = null;
      if (cameraStop) { const stop = cameraStop; cameraStop = null; stop(); }
      callback?.();
      document.body.classList.remove('camera-dialog-open');
      const opener = openers.get(element);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    }
  }
  function open(element, { onClose } = {}) {
    if (current && current.element !== element) close(current.element);
    openers.set(element, document.activeElement);
    current = { element, onClose };
    element.hidden = false;
    element.classList.remove('hidden');
    document.body.classList.add('camera-dialog-open');
    element.tabIndex = -1;
    element.focus({ preventScroll: true });
  }
  function mount(element, title) {
    if (element.dataset.cameraDialog) return;
    element.dataset.cameraDialog = 'true';
    element.classList.add('camera-dialog');
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-modal', 'true');
    element.setAttribute('aria-label', title);
    const content = document.createElement('section');
    content.className = 'camera-dialog-card';
    const heading = document.createElement('h2'); heading.textContent = title;
    const closeButton = document.createElement('button');
    closeButton.type = 'button'; closeButton.className = 'camera-dialog-close';
    closeButton.textContent = '×'; closeButton.setAttribute('aria-label', '關閉相機視窗');
    closeButton.addEventListener('click', () => close(element));
    content.append(heading, closeButton, ...Array.from(element.childNodes));
    element.replaceChildren(content);
    document.body.append(element);
    element.addEventListener('click', event => { if (event.target === element) close(element); });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && current?.element?.dataset.cameraDialog) {
      event.preventDefault(); event.stopImmediatePropagation(); close(current.element);
    }
  }, true);
  const stop = () => {
    if (current) close(current.element);
    if (cameraStop) { const callback = cameraStop; cameraStop = null; callback(); }
  };
  window.addEventListener('pagehide', stop);
  window.addEventListener('member:access-ended', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden && cameraStop) { const callback = cameraStop; cameraStop = null; callback(); } });
  window.CameraDialog = Object.freeze({ open, close, mount, acquire, release });
})();
