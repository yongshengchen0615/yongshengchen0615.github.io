(() => {
  'use strict';
  // Presentation only. Scanner callers remain responsible for validating a QR value
  // and must never trigger a business transaction from the decoded payload.
  let active = null;
  function close() {
    const current = active;
    if (!current) return;
    active = null;
    current.stop?.();
    current.panel.hidden = true;
    if (current.next && current.next.parentNode === current.parent) {
      current.parent.insertBefore(current.panel, current.next);
    } else {
      current.parent.append(current.panel);
    }
    current.overlay.remove();
    document.body.style.overflow = current.originalOverflow;
    if (current.opener?.isConnected && current.opener.getClientRects().length) {
      current.opener.focus({ preventScroll: true });
    }
  }
  function open(panel, { title = '掃描 QR Code', opener = document.activeElement, start, stop } = {}) {
    if (!panel || typeof start !== 'function' || typeof stop !== 'function') return false;
    close();
    const overlay = document.createElement('div');
    overlay.className = 'qr-scan-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    overlay.tabIndex = -1;
    const card = document.createElement('section');
    card.className = 'qr-scan-dialog-card';
    const heading = document.createElement('div');
    heading.className = 'qr-scan-dialog-heading';
    const label = document.createElement('h2');
    label.textContent = title;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'qr-scan-dialog-close';
    closeButton.textContent = '關閉';
    closeButton.setAttribute('aria-label', '關閉 QR 掃描視窗');
    heading.append(label, closeButton);
    card.append(heading, panel);
    overlay.append(card);
    active = {
      overlay, panel, opener, stop,
      parent: panel.parentNode, next: panel.nextSibling,
      originalOverflow: document.body.style.overflow
    };
    panel.hidden = false;
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    closeButton.focus({ preventScroll: true });
    Promise.resolve().then(() => {
      if (active?.overlay === overlay && !document.hidden) start();
    });
    return true;
  }
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) close();
  });
  window.addEventListener('pagehide', close);
  window.addEventListener('member-system:session-revoked', close);
  window.QRScanDialog = { open, close, isOpen: panel => Boolean(active && (!panel || panel === active.panel)) };
})();
