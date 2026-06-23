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
  const proxy = getProxyUrl();
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
      <div class="modal-actions">
        <button id="confirmBtn" class="spin-center small" type="button">確認</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#confirmBtn').addEventListener('click', hideResultModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) hideResultModal();
  });
  return modal;
}

function showResultModal(label) {
  const modal = ensureResultModal();
  const modalPrize = modal.querySelector('#modalPrize');
  if (modalPrize) modalPrize.textContent = label;
  modal.classList.remove('hidden');
}

function hideResultModal() {
  const modal = document.getElementById('resultModal');
  if (modal) modal.classList.add('hidden');
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
