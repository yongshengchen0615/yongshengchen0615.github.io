// ========== 樣式設定（修改這個參數即可切換整體風格）==========
// 可選值：'default', 'dark', 'light', 'neon'
const THEME = 'default';

// 應用主題 class
document.documentElement.className = `theme-${THEME}`;

// 取得主題色彩（從 CSS 變數）
function getThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    wheelColors: [styles.getPropertyValue('--slice1').trim(), styles.getPropertyValue('--slice2').trim()],
    textColor: styles.getPropertyValue('--text').trim(),
    pointerColor: styles.getPropertyValue('--accent').trim(),
    dividerColor: styles.getPropertyValue('--divider').trim()
  };
}

// 設定指針顏色
if (document.getElementById('pointer')) {
  document.getElementById('pointer').style.color = getThemeColors().pointerColor;
}

// ========== 轉盤抽獎主要邏輯 ==========
// 可選：設定已部署的 Google Apps Script Web App URL
// 範例：https://script.google.com/macros/s/XXXXXXXX/exec
const GAS_ENDPOINT ='https://script.google.com/macros/s/AKfycbyWac7BflzzvIgv3r5ZMMl7WY4v6tFLgTKGxSkDUZ2Z8skDSLQAa6OOoAU3aN2MciAP/exec';
const loadingEl = document.getElementById('loadingOverlay');
const canvas = document.getElementById('wheel');
const ctx = canvas.getContext('2d');
const spinBtn = document.getElementById('spinBtn');
// modal 元素（全畫面顯示中獎結果）
const modal = document.getElementById('resultModal');
const modalPrize = document.getElementById('modalPrize');
const confirmBtn = document.getElementById('confirmBtn');

// 可編輯的獎項與權重（會儲存到 localStorage）
// color: 自訂顏色（選填），例如 '#ff0000' 或 'red'，不填則使用預設交替色
// 移除本地預設獎項，強制僅使用 GAS 資料
let prizes = [];

// 從 Google Apps Script 取得獎項資料
async function fetchPrizesFromGAS() {
  if (!GAS_ENDPOINT) {
    console.error('未設定 GAS_ENDPOINT，請在 app.js 或 localStorage 設定 Web App URL');
    disableSpinWithMessage('未設定資料來源（GAS）');
    return null;
  }
  try {
    showLoading(true);
    const res = await fetch(GAS_ENDPOINT, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // 預期資料格式：[{ label: string, probability: number, color?: string }]
    // probability 可為百分比或權重數值（皆接受）。
    if (!Array.isArray(data)) throw new Error('Invalid JSON: not array');
    // 兼容欄位名稱：probability/weight/概率/機率
    const normalized = data.map((item) => {
      const label = item.label ?? item.name ?? '';
      let weight = item.weight ?? item.probability ?? item.機率 ?? item.概率;
      const color = item.color ?? item.colour ?? item.顏色;
      // 字串百分比轉數值，例如 '12%' -> 12
      if (typeof weight === 'string') {
        const m = weight.trim().match(/^([0-9]+(?:\.[0-9]+)?)%$/);
        weight = m ? parseFloat(m[1]) : parseFloat(weight);
      }
      // 無效或負數則置 0
      if (!Number.isFinite(weight) || weight < 0) weight = 0;
      return { label: String(label || '').trim() || '未命名', weight, color };
    }).filter(p => p.label);

    // 若提供的是百分比（總和約 100），直接作為權重；否則維持數值權重
    const sum = normalized.reduce((s, i) => s + i.weight, 0);
    if (sum <= 0) throw new Error('All weights are zero');
    prizes = normalized;
    return prizes;
  } catch (e) {
    console.error('GAS 讀取失敗：', e);
    disableSpinWithMessage('資料載入失敗，請稍後重試');
    return null;
  } finally {
    showLoading(false);
    updateSpinEnabled();
  }
}

let size = 0;
let cx = 0;
let cy = 0;
let radius = 0;

function resizeCanvas(){
  // 以 .wheel-area 的實際寬度為基準，保持正方形
  const rect = canvas.getBoundingClientRect();
  const cssSize = rect.width; // CSS pixels
  const dpr = window.devicePixelRatio || 1;
  // 設定畫布的實際像素大小
  canvas.width = Math.max(1, Math.floor(cssSize * dpr));
  canvas.height = Math.max(1, Math.floor(cssSize * dpr));
  // 顯示尺寸（CSS）
  canvas.style.width = cssSize + 'px';
  canvas.style.height = cssSize + 'px';
  // 使用高解析度繪製
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 更新繪圖參數（以 CSS pixels 為單位）
  size = cssSize;
  cx = size / 2;
  cy = size / 2;
  radius = size / 2 - Math.max(12, size * 0.03);
}

// 在載入和視窗尺寸變化時重設畫布
window.addEventListener('resize', ()=>{ resizeCanvas(); drawWheel(); });
// 立即執行一次（先嘗試讀取 GAS，再繪製）
(async () => {
  resizeCanvas();
  showLoading(true);
  await fetchPrizesFromGAS();
  drawWheel();
})();

function drawWheel() {
  // 清除以 CSS 像素為單位（canvas.width 為 device pixels，因此除以 dpr）
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  const count = prizes.length;
  const arc = 2 * Math.PI / count;
  const themeColors = getThemeColors();
  for (let i=0;i<count;i++){
    const start = i * arc;
    const end = start + arc;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,radius,start,end,false);
    ctx.closePath();
    // 優先使用臨時閃爍色，再使用自訂色，最後使用預設交替色
    ctx.fillStyle = prizes[i].tempColor || prizes[i].color || themeColors.wheelColors[i % 2];
    ctx.fill();

    // 分片區隔線（由中心到外圈），使用主題 divider 色
    if (count > 0) {
      ctx.save();
      ctx.strokeStyle = themeColors.dividerColor || '#ffffff';
      ctx.lineWidth = Math.max(1, Math.round(size * 0.006));
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(start) * radius, cy + Math.sin(start) * radius);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    // 繪文字
    ctx.translate(cx,cy);
    ctx.rotate(start + arc/2);
    ctx.textAlign = 'right';
    ctx.fillStyle = themeColors.textColor;
    // 字型大小隨畫布大小調整
    const fontSize = Math.max(10, Math.round(size * 0.038));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillText(prizes[i].label, radius - Math.max(12, size * 0.02), Math.round(fontSize/3));
    ctx.restore();
  }
}

// 權重抽樣，回傳索引
function weightedPickIndex(items){
  const total = items.reduce((s,i)=>s+(Number.isFinite(i.weight)?i.weight:0),0);
  let r = Math.random()*total;
  for (let i=0;i<items.length;i++){
    r -= (Number.isFinite(items[i].weight)?items[i].weight:0);
    if (r <= 0) return i;
  }
  return items.length-1;
}

// 動畫與轉盤控制
let spinning = false;
function spin() {
  if (spinning) return;
  if (!prizes.length) {
    disableSpinWithMessage('尚未載入獎項資料');
    return;
  }
  
  // 如果正在閃爍，停止閃爍
  stopBlink();
  
  spinning = true;
  spinBtn.disabled = true;
  // 不在頁面下方顯示狀態（改為以 modal 顯示結果）

  const pickIndex = weightedPickIndex(prizes);
  const segmentAngle = 360 / prizes.length;
  // 目標角度中心（度數），指針在頂端，canvas 0 度在正右，需轉換
  const targetSegStart = pickIndex * segmentAngle;
  const targetSegCenter = targetSegStart + segmentAngle/2;

  // 為了動畫順暢，設定多圈並加上目標角度（注意 0deg 在畫布右邊）
  const extraSpins = Math.floor(Math.random()*3) + 4; // 4~6圈

  const startRotation = currentRotation || 0;
  // 計算 offset，確保目標角度比 startRotation 大，這樣每次都會沿同一方向（順時針）轉
  const desiredPointerDeg = 270; // 指針在頂端
  const rawTargetDeg = (desiredPointerDeg - targetSegCenter + 360) % 360;
  const offset = (rawTargetDeg - (startRotation % 360) + 360) % 360;
  const targetRotationDeg = startRotation + extraSpins*360 + offset;
  const duration = 4200; // ms
  const startTime = performance.now();

  function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

  function frame(now){
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    const eased = easeOutCubic(t);
    currentRotation = startRotation + (targetRotationDeg - startRotation) * eased;
    // 限制小數位並強制使用 GPU 合成（translateZ(0)），以減少 sub-pixel jitter
    const rounded = Math.round(currentRotation * 100) / 100;
    canvas.style.transform = `rotate(${rounded}deg) translateZ(0)`;
    if (t < 1){
      requestAnimationFrame(frame);
    } else {
      // 計算落在哪個獎項
      const finalRotation = ((currentRotation % 360) + 360) % 360; // 0~360
      // 轉換回 segment index
      const pointerDeg = 270; // pointer 指向 270deg
      const landedDeg = (pointerDeg - finalRotation + 360) % 360;
      const landedIndex = Math.floor(landedDeg / (360 / prizes.length)) % prizes.length;

      const prize = prizes[landedIndex];
      addHistory(prize.label);
      // 顯示閃爍效果，持續到再次點擊開始按鈕
      blinkWinningSlice(landedIndex);
    }
  }

  requestAnimationFrame(frame);
}

function disableSpinWithMessage(msg) {
  spinBtn.disabled = true;
  // 若頁面有提示元素可更新，否則使用簡單 alert
  try {
    alert(msg);
  } catch (e) {}
}

function updateSpinEnabled(){
  spinBtn.disabled = !prizes.length;
}

function showLoading(visible){
  if (!loadingEl) return;
  loadingEl.classList.toggle('hidden', !visible);
}

// 中獎獎項閃爍效果
let blinkInterval = null;
let currentWinIndex = -1;
function blinkWinningSlice(winIndex) {
  currentWinIndex = winIndex;
  let blinkState = false;
  const originalColor = prizes[winIndex].color || getThemeColors().wheelColors[winIndex % 2];
  
  // 清除之前的閃爍
  if (blinkInterval) {
    clearInterval(blinkInterval);
  }
  
  blinkInterval = setInterval(() => {
    // 交替顯示白色與原色
    if (blinkState) {
      prizes[winIndex].tempColor = '#ffffff';
    } else {
      prizes[winIndex].tempColor = originalColor;
    }
    blinkState = !blinkState;
    drawWheel();
  }, 500);
  
  // 解鎖按鈕，讓使用者可以點擊以停止閃爍
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

function addHistory(text){
  // 只將紀錄存入 localStorage，但不在畫面上顯示
  const now = new Date().toLocaleString();
  const item = {text, time: now};
  try{
    const raw = localStorage.getItem('wheel_history');
    const all = raw ? JSON.parse(raw) : [];
    all.unshift(item);
    localStorage.setItem('wheel_history', JSON.stringify(all.slice(0,50)));
  } catch (e) {
    // ignore
  }
}

function loadHistory(){
  try{ return JSON.parse(localStorage.getItem('wheel_history')) || []; }
  catch(e){ return []; }
}

function clearHistory(){
  localStorage.removeItem('wheel_history');
  // 不在頁面顯示任何結果
}

let currentRotation = 0;

// 註冊事件
spinBtn.addEventListener('click', spin);

// 初始繪製
// 移至上方 IIFE 內處理初始繪製

// 注意：獎項請直接在程式碼的 `defaultPrizes` 中修改，UI 上不提供編輯功能
