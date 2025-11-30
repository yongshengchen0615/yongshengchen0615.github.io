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
    pointerColor: styles.getPropertyValue('--accent').trim()
  };
}

// 設定指針顏色
if (document.getElementById('pointer')) {
  document.getElementById('pointer').style.color = getThemeColors().pointerColor;
}

// ========== 轉盤抽獎主要邏輯 ==========
const canvas = document.getElementById('wheel');
const ctx = canvas.getContext('2d');
const spinBtn = document.getElementById('spinBtn');
// modal 元素（全畫面顯示中獎結果）
const modal = document.getElementById('resultModal');
const modalPrize = document.getElementById('modalPrize');
const confirmBtn = document.getElementById('confirmBtn');

// 可編輯的獎項與權重（會儲存到 localStorage）
// color: 自訂顏色（選填），例如 '#ff0000' 或 'red'，不填則使用預設交替色
const defaultPrizes = [
  {label: '🔸 腳底按摩券 🦶', weight: 0, color: '#ff6b6b'},  // 大獎：紅色
   {label: '再接再厲', weight: 10},
  {label: '🔸 甜湯🍵', weight: 1, color: '#ffd93d'},  // 二獎：金黃色
    {label: '再接再厲', weight: 10},
  {label: '再接再厲', weight: 10},
  {label: '🔸 足湯包 🛁', weight: 10, color: '#a8e6cf'},  // 三獎：淺綠色
  {label: '再接再厲', weight: 10},
  {label: '再接再厲', weight: 20},
];


let prizes = JSON.parse(JSON.stringify(defaultPrizes));

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
// 立即執行一次
setTimeout(()=>{ resizeCanvas(); drawWheel(); }, 0);

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
  const total = items.reduce((s,i)=>s+i.weight,0);
  let r = Math.random()*total;
  for (let i=0;i<items.length;i++){
    r -= items[i].weight;
    if (r <= 0) return i;
  }
  return items.length-1;
}

// 動畫與轉盤控制
let spinning = false;
function spin() {
  if (spinning) return;
  
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
drawWheel();

// 注意：獎項請直接在程式碼的 `defaultPrizes` 中修改，UI 上不提供編輯功能
