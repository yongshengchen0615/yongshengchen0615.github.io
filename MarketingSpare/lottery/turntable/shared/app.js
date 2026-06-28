// 共用轉盤前台邏輯。各活動資料夾只需要在 config.js 設定 scriptUrl。
const THEME = 'default';
document.documentElement.classList.add(`theme-${THEME}`);

const CFG = window.TURN_ADMIN_CONFIG || {};
const loadingEl = document.getElementById('loadingOverlay');
const canvas = document.getElementById('wheel');
const ctx = canvas.getContext('2d');
const spinBtn = document.getElementById('spinBtn');

let prizes = [];
let size = 0;
let cx = 0;
let cy = 0;
let radius = 0;
let currentRotation = 0;
let spinning = false;
let blinkInterval = null;
let currentWinIndex = -1;
let activeResult = null;
let liffMessageInFlight = false;
let liffInitPromise = null;

function getThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    wheelColors: [
      styles.getPropertyValue('--slice1').trim(),
      styles.getPropertyValue('--slice2').trim()
    ],
    textColor: styles.getPropertyValue('--text').trim(),
    pointerColor: styles.getPropertyValue('--accent').trim(),
    dividerColor: styles.getPropertyValue('--divider').trim()
  };
}

function getScriptUrl() {
  return String(CFG.scriptUrl || localStorage.getItem('gas_endpoint') || '').trim();
}

function getSheetName() {
  return String(CFG.sheetName || '').trim();
}

function getProxyUrl() {
  return String(CFG.proxyUrl || '').trim();
}

function getLiffConfig() {
  const source = CFG.liff || {};
  const sendOn = source.sendOn === 'confirm' ? 'confirm' : 'landed';
  return {
    enabled: source.enabled !== false,
    liffId: String(source.liffId || CFG.liffId || '').trim(),
    sendOn,
    messageTemplate: String(source.messageTemplate || '我中了「{prize}」！').trim() || '我中了「{prize}」！',
    closeAfterSend: !!source.closeAfterSend,
    withLoginOnExternalBrowser: !!source.withLoginOnExternalBrowser
  };
}

function hasLiffLaunchParams() {
  const params = new URLSearchParams(location.search);
  return Array.from(params.keys()).some((key) => (
    key === 'access_token' ||
    key === 'context_token' ||
    key === 'liff.state' ||
    key.startsWith('liff.')
  ));
}

function isLikelyLiffContext(liffConfig) {
  if (hasLiffLaunchParams()) return true;
  if (liffConfig.withLoginOnExternalBrowser) return true;
  return !!window.liff?.isInClient?.();
}

function initLiff() {
  const liffConfig = getLiffConfig();
  if (!liffConfig.enabled) return Promise.resolve({ ready: false, reason: 'disabled' });
  if (!liffConfig.liffId) return Promise.resolve({ ready: false, reason: 'missing_liff_id' });
  if (!window.liff || typeof window.liff.init !== 'function') {
    return Promise.resolve({ ready: false, reason: 'sdk_missing' });
  }
  if (!isLikelyLiffContext(liffConfig)) {
    return Promise.resolve({ ready: false, reason: 'not_liff_context' });
  }
  if (liffInitPromise) return liffInitPromise;

  liffInitPromise = window.liff
    .init({
      liffId: liffConfig.liffId,
      withLoginOnExternalBrowser: liffConfig.withLoginOnExternalBrowser
    })
    .then(() => ({ ready: true }))
    .catch((err) => {
      liffInitPromise = null;
      throw err;
    });

  return liffInitPromise;
}

function describeLiffUnavailable(reason) {
  if (reason === 'disabled') return '';
  if (reason === 'missing_liff_id') return '請先在 config.js 設定 LIFF ID。';
  if (reason === 'sdk_missing') return 'LIFF SDK 尚未載入。';
  if (reason === 'not_liff_context') return '請用 LINE LIFF 連結開啟此頁，才能自動傳送中獎訊息。';
  return 'LIFF 尚未準備完成。';
}

function isLiffSendAvailable() {
  if (!window.liff || typeof window.liff.sendMessages !== 'function') return false;
  if (typeof window.liff.isInClient === 'function' && !window.liff.isInClient()) return false;

  if (typeof window.liff.getContext === 'function') {
    const context = window.liff.getContext();
    if (context?.type && !['utou', 'group', 'room'].includes(context.type)) return false;
    if (Array.isArray(context?.scope) && !context.scope.includes('chat_message.write')) return false;
  }

  return true;
}

function getActivityName() {
  return document.querySelector('h1')?.textContent?.trim() || document.title || '';
}

function formatLiffMessage(result, liffConfig) {
  const replacements = {
    prize: result.label,
    activity: getActivityName(),
    landedAt: result.landedAt
  };

  return liffConfig.messageTemplate.replace(/\{(prize|activity|landedAt)\}/g, (_, key) => replacements[key] || '');
}

async function sendPrizeToLine(result, trigger) {
  const liffConfig = getLiffConfig();
  if (!liffConfig.enabled || !result) return { skipped: true };
  if (liffMessageInFlight) return { skipped: true };

  liffMessageInFlight = true;
  result.lineStatus = 'sending';
  setLiffMessageLoading(trigger === 'confirm');

  try {
    const initResult = await initLiff();
    if (!initResult.ready) {
      const message = describeLiffUnavailable(initResult.reason);
      if (message) setLiffMessageStatus(message, false);
      result.lineStatus = 'unavailable';
      return { failed: !!message };
    }

    if (!isLiffSendAvailable()) {
      setLiffMessageStatus('請從 LINE 聊天視窗開啟 LIFF，並確認已啟用 chat_message.write。', false);
      result.lineStatus = 'unavailable';
      return { failed: true };
    }

    await window.liff.sendMessages([
      {
        type: 'text',
        text: formatLiffMessage(result, liffConfig)
      }
    ]);

    result.lineStatus = 'sent';
    setLiffMessageStatus('已送到 LINE 聊天視窗');
    if (liffConfig.closeAfterSend && window.liff?.isInClient?.()) {
      window.liff.closeWindow();
    }
    return { ok: true };
  } catch (err) {
    console.error('LINE 訊息傳送失敗：', err);
    result.lineStatus = 'failed';
    setLiffMessageStatus('LINE 訊息傳送失敗，請再試一次。', false);
    setLiffMessageRetry();
    return { failed: true };
  } finally {
    liffMessageInFlight = false;
  }
}

function withQuery(url, params) {
  const pairs = Object.entries(params)
    .filter(([, value]) => value)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  if (!pairs.length) return url;
  return url + (url.includes('?') ? '&' : '?') + pairs.join('&');
}

function buildReadUrl() {
  const endpoint = getScriptUrl();
  const url = withQuery(endpoint, { sheet: getSheetName() });
  return proxiedUrl(url, getProxyUrl());
}

function proxiedUrl(url, proxyUrl) {
  const proxy = String(proxyUrl || '').trim();
  if (!proxy) return url;
  return proxy.replace(/\/$/, '') + '/' + url.replace(/^https?:\/\//, '');
}

function normalizeWeight(value) {
  let weight = value;
  if (typeof weight === 'string') {
    const m = weight.trim().match(/^([0-9]+(?:\.[0-9]+)?)%$/);
    weight = m ? parseFloat(m[1]) : parseFloat(weight);
  }
  return Number.isFinite(weight) && weight >= 0 ? weight : 0;
}

function normalizePrize(item) {
  const label = item?.label ?? item?.name ?? item?.獎項 ?? item?.名稱 ?? '';
  const weight = item?.weight ?? item?.probability ?? item?.機率 ?? item?.概率 ?? item?.百分比;
  const color = item?.color ?? item?.colour ?? item?.顏色;
  return {
    label: String(label || '').trim() || '未命名',
    weight: normalizeWeight(weight),
    color
  };
}

async function fetchPrizesFromGAS() {
  if (!getScriptUrl()) {
    disableSpinWithMessage('未設定資料來源');
    return null;
  }

  try {
    showLoading(true);
    const res = await fetch(buildReadUrl(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const payload = await res.json();
    const items = Array.isArray(payload) ? payload : payload?.items;
    if (!Array.isArray(items)) throw new Error('Invalid JSON: not array');

    const normalized = items.map(normalizePrize).filter((prize) => prize.label);
    const sum = normalized.reduce((total, item) => total + item.weight, 0);
    if (!normalized.length || sum <= 0) throw new Error('All weights are zero');

    prizes = normalized;
    return prizes;
  } catch (err) {
    console.error('GAS 讀取失敗：', err);
    disableSpinWithMessage('資料載入失敗');
    return null;
  } finally {
    showLoading(false);
    updateSpinEnabled();
  }
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const cssSize = rect.width;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.floor(cssSize * dpr));
  canvas.height = Math.max(1, Math.floor(cssSize * dpr));
  canvas.style.width = cssSize + 'px';
  canvas.style.height = cssSize + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  size = cssSize;
  cx = size / 2;
  cy = size / 2;
  radius = size / 2 - Math.max(12, size * 0.03);
}

function drawWheel() {
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

  const count = prizes.length;
  if (!count) return;

  const arc = 2 * Math.PI / count;
  const themeColors = getThemeColors();

  for (let i = 0; i < count; i += 1) {
    const start = i * arc;
    const end = start + arc;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end, false);
    ctx.closePath();
    ctx.fillStyle = prizes[i].tempColor || prizes[i].color || themeColors.wheelColors[i % 2];
    ctx.fill();

    ctx.save();
    ctx.strokeStyle = themeColors.dividerColor || '#ffffff';
    ctx.lineWidth = Math.max(1, Math.round(size * 0.006));
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(start) * radius, cy + Math.sin(start) * radius);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + arc / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = themeColors.textColor;
    const fontSize = Math.max(10, Math.round(size * 0.038));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillText(prizes[i].label, radius - Math.max(12, size * 0.02), Math.round(fontSize / 3));
    ctx.restore();
  }
}

function weightedPickIndex(items) {
  const total = items.reduce((sum, item) => sum + (Number.isFinite(item.weight) ? item.weight : 0), 0);
  if (total <= 0) return -1;

  let r = Math.random() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= Number.isFinite(items[i].weight) ? items[i].weight : 0;
    if (r <= 0) return i;
  }
  return items.length - 1;
}

function spin() {
  if (spinning) return;
  if (!prizes.length) {
    disableSpinWithMessage('尚未載入獎項資料');
    return;
  }

  stopBlink();
  hideResultModal();

  spinning = true;
  spinBtn.disabled = true;

  const pickIndex = weightedPickIndex(prizes);
  if (pickIndex < 0) {
    spinning = false;
    disableSpinWithMessage('獎項權重設定錯誤');
    return;
  }

  const segmentAngle = 360 / prizes.length;
  const targetSegCenter = pickIndex * segmentAngle + segmentAngle / 2;
  const extraSpins = Math.floor(Math.random() * 3) + 4;
  const startRotation = currentRotation || 0;
  const desiredPointerDeg = 270;
  const rawTargetDeg = (desiredPointerDeg - targetSegCenter + 360) % 360;
  const offset = (rawTargetDeg - (startRotation % 360) + 360) % 360;
  const targetRotationDeg = startRotation + extraSpins * 360 + offset;
  const duration = 4200;
  const startTime = performance.now();

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function frame(now) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    const eased = easeOutCubic(t);
    currentRotation = startRotation + (targetRotationDeg - startRotation) * eased;
    const rounded = Math.round(currentRotation * 100) / 100;
    canvas.style.transform = `rotate(${rounded}deg) translateZ(0)`;

    if (t < 1) {
      requestAnimationFrame(frame);
      return;
    }

    const finalRotation = ((currentRotation % 360) + 360) % 360;
    const landedDeg = (desiredPointerDeg - finalRotation + 360) % 360;
    const landedIndex = Math.floor(landedDeg / segmentAngle) % prizes.length;
    const prize = prizes[landedIndex];

    addHistory(prize.label);
    blinkWinningSlice(landedIndex);
    showResultModal(prize.label);
  }

  requestAnimationFrame(frame);
}

function disableSpinWithMessage(message) {
  spinBtn.disabled = true;
  spinBtn.textContent = '無資料';
  spinBtn.title = message;
}

function updateSpinEnabled() {
  spinBtn.disabled = !prizes.length;
  spinBtn.textContent = prizes.length ? '開始' : '無資料';
  spinBtn.title = prizes.length ? '開始轉動' : '尚未載入獎項資料';
}

function showLoading(visible) {
  if (!loadingEl) return;
  loadingEl.classList.toggle('hidden', !visible);
}

function blinkWinningSlice(winIndex) {
  currentWinIndex = winIndex;
  let blinkState = false;
  const originalColor = prizes[winIndex].color || getThemeColors().wheelColors[winIndex % 2];

  if (blinkInterval) clearInterval(blinkInterval);

  blinkInterval = setInterval(() => {
    prizes[winIndex].tempColor = blinkState ? '#ffffff' : originalColor;
    blinkState = !blinkState;
    drawWheel();
  }, 500);

  spinning = false;
  spinBtn.disabled = false;
}

function stopBlink() {
  if (blinkInterval) {
    clearInterval(blinkInterval);
    blinkInterval = null;
  }
  if (currentWinIndex >= 0) {
    delete prizes[currentWinIndex].tempColor;
    currentWinIndex = -1;
    drawWheel();
  }
}

function ensureResultModal() {
  let modal = document.getElementById('resultModal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'resultModal';
  modal.className = 'modal hidden';
  modal.innerHTML = `
    <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="resultTitle">
      <p class="muted">中獎結果</p>
      <h2 id="resultTitle"><span id="modalPrize"></span></h2>
      <p id="resultNotifyStatus" class="notify-status" aria-live="polite"></p>
      <div class="modal-actions">
        <button id="confirmBtn" class="spin-center small" type="button">確認</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#confirmBtn').addEventListener('click', confirmResultModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) hideResultModal();
  });
  return modal;
}

function showResultModal(label) {
  const modal = ensureResultModal();
  const modalPrize = modal.querySelector('#modalPrize');
  activeResult = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    label,
    landedAt: new Date().toISOString(),
    lineStatus: 'pending'
  };
  modal.dataset.resultId = activeResult.id;
  modal.dataset.prize = label;
  if (modalPrize) modalPrize.textContent = label;
  resetResultModalState();
  modal.classList.remove('hidden');

  if (getLiffConfig().sendOn === 'landed') {
    sendPrizeToLine(activeResult, 'landed').catch((err) => {
      console.error('LINE 訊息傳送失敗：', err);
    });
  }
}

function hideResultModal() {
  const modal = document.getElementById('resultModal');
  if (modal) modal.classList.add('hidden');
}

function resetResultModalState() {
  const modal = ensureResultModal();
  const status = modal.querySelector('#resultNotifyStatus');
  const confirmBtn = modal.querySelector('#confirmBtn');
  if (status) {
    status.textContent = '';
    status.classList.remove('error');
  }
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = '確認';
  }
}

async function confirmResultModal() {
  const liffConfig = getLiffConfig();
  if (!activeResult || (liffConfig.sendOn === 'landed' && activeResult.lineStatus !== 'failed')) {
    hideResultModal();
    return;
  }

  try {
    const outcome = await sendPrizeToLine(activeResult, 'confirm');
    if (outcome?.failed) return;
    hideResultModal();
  } catch (err) {
    console.error('LINE 訊息傳送失敗：', err);
  }
}

function setLiffMessageLoading(showLoadingText) {
  const modal = ensureResultModal();
  const confirmBtn = modal.querySelector('#confirmBtn');
  const status = modal.querySelector('#resultNotifyStatus');
  if (confirmBtn && showLoadingText) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '傳送中';
  }
  if (status) {
    status.textContent = showLoadingText ? 'LINE 訊息傳送中...' : '';
    status.classList.remove('error');
  }
}

function setLiffMessageStatus(message, ok = true) {
  const modal = ensureResultModal();
  const status = modal.querySelector('#resultNotifyStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', !ok);
}

function setLiffMessageRetry() {
  const modal = ensureResultModal();
  const confirmBtn = modal.querySelector('#confirmBtn');
  if (!confirmBtn) return;
  confirmBtn.disabled = false;
  confirmBtn.textContent = '再試一次';
}

function addHistory(text) {
  const item = { text, time: new Date().toLocaleString() };
  try {
    const raw = localStorage.getItem('wheel_history');
    const all = raw ? JSON.parse(raw) : [];
    all.unshift(item);
    localStorage.setItem('wheel_history', JSON.stringify(all.slice(0, 50)));
  } catch (_) {}
}

window.addEventListener('resize', () => {
  resizeCanvas();
  drawWheel();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideResultModal();
});

spinBtn.addEventListener('click', spin);

const pointer = document.getElementById('pointer');
if (pointer) pointer.style.color = getThemeColors().pointerColor;

(async () => {
  resizeCanvas();
  showLoading(true);
  await fetchPrizesFromGAS();
  drawWheel();
})();
